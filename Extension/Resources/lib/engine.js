// NoSlop — engine: observer, pipeline, hiding, caching, stats (docs/DESIGN.md §4). Plain classic script.
// Public: NoSlop.engine.start({adapter, rules, host}) -> Promise, .stop(), .processNow(root)
//         NoSlop.adapters.register(adapter) / .list() / .pick(location)
// Adapter contract: see adapters/_template.js.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});

  // ------------------------------------------------------------------ adapters registry
  const registry = [];
  NS.adapters = {
    register(adapter) {
      if (!adapter || typeof adapter.matches !== 'function' || !adapter.site) throw new Error('NoSlop adapter needs {site, matches()}');
      const i = registry.findIndex((a) => a.site === adapter.site);
      if (i >= 0) registry.splice(i, 1, adapter); else registry.push(adapter);
      return adapter;
    },
    list() { return registry.slice(); },
    pick(location) {
      const loc = location || globalThis.location;
      for (const a of registry) { try { if (a.matches(loc)) return a; } catch (_) { /* ignore */ } }
      return null;
    },
    _clear() { registry.length = 0; }
  };

  // ------------------------------------------------------------------ constants
  const STUB = 'noslop-stub';
  const BADGE = 'noslop-badge';
  const HIDDEN = 'noslop-hidden';
  const DIM = 'noslop-dim';
  const SURFACE = 'noslop-surface';
  const NOSTUB = 'noslop-nostub';
  const STRATEGIES = ['display-none', 'height-zero', 'collapse-inner'];
  const SURFACE_STRATEGIES = ['display-none', 'height-zero'];
  const LRU_MAX = 5000;
  const PERSIST_MAX = 1000;          // persisted rows per site (newest by ts); halved on every rejected storageSet
  const PERSIST_TEXT_MAX = 300;      // persisted enrich text is a bounded snippet, never the 2000-char description
  const TTL_MS = 7 * 24 * 3600 * 1000;
  const SWEEP_MS = 2500;
  const STATS_DEBOUNCE_MS = 1500;
  const PERSIST_DEBOUNCE_MS = 12000;
  const ENRICH_RETRY_MS = 60000;     // first retry after a FAILED enrich (doubles per attempt); tests override E.enrichRetryMs
  const ENRICH_MAX_ATTEMPTS = 3;     // per page life
  const AUTHOR_HITS_MAX = 2000;      // LRU of authors tracked for auto-promotion
  const AUTHOR_IDS_MAX = 10;         // ids remembered per author

  const dom = () => NS.dom;
  const scorer = () => NS.scorer;

  // ------------------------------------------------------------------ state
  const E = {
    running: false, adapter: null, host: null, rulesBase: null, rules: null, settings: null, site: '',
    epoch: '0:0', epochCounter: 0,
    cache: new Map(),            // key -> { verdict, enrich, enriched, ts, epoch, surface, enrichAttempts?, enrichFailedAt? }
    state: new WeakMap(),        // element -> { id, key, item, verdict, action, stub, badge, media }
    counted: new Map(),          // key -> action already counted in stats (evicted with the cache)
    sessionAllow: new Set(),     // keys the user chose "Show" for
    authorHits: new Map(),       // site:author -> Set(ids) for auto-promotion (LRU AUTHOR_HITS_MAX, AUTHOR_IDS_MAX each)
    promoted: new Set(),
    surfaceCounted: new WeakMap(), // element -> Set(settingKey) already counted in stats
    statsBuf: new Map(),         // "action|reason" -> count
    statsTimer: null, persistTimer: null, flushTimer: null, sweepTimer: null, navTimers: [], retryTimers: new Set(),
    pending: new Set(), observer: null, unsubSettings: null, historyPatched: null, navListeners: [], navApiListener: null, lifecycleListeners: [],
    queue: [], inflight: new Set(), idleResolvers: [], surface: 'other', bodyWaiter: null,
    lastHref: '',                // location.href at the last navigation check (world-independent SPA detection)
    mutated: false,              // a foreign mutation was observed since the last sweep
    persistCap: PERSIST_MAX, enrichRetryMs: ENRICH_RETRY_MS,
    recent: [],                  // newest-first ring of {key,id,action,author,reason,reasonText,title?,text?,ts} for the popup
    messageListener: null
  };

  function now() { return Date.now(); }
  function log() { /* console.debug('[NoSlop]', ...arguments); */ }

  function settingsOf() { return E.settings || (NS.defaultSettings ? NS.defaultSettings() : {}); }
  function cacheKey(id) { return E.site + ':' + id; }
  function computeEpoch() { return String((E.settings && E.settings.updatedAt) || 0) + ':' + E.epochCounter; }
  /** The global switch and the per-site mode 'off' are honoured by the engine itself (surfaces, enrich), not only by the scorer. */
  function siteActive() {
    const s = settingsOf();
    if (s.enabled === false) return false;
    const sc = s.sites && s.sites[E.site];
    return !(sc && sc.mode === 'off');
  }

  // ------------------------------------------------------------------ cache (LRU + persistence)
  function cacheGet(key) {
    const v = E.cache.get(key);
    if (!v) return null;
    if (now() - (v.ts || 0) > TTL_MS) { E.cache.delete(key); E.counted.delete(key); return null; }
    E.cache.delete(key); E.cache.set(key, v); // touch
    return v;
  }
  function cacheSet(key, entry) {
    entry.ts = entry.ts || now();
    if (E.cache.has(key)) E.cache.delete(key);
    E.cache.set(key, entry);
    while (E.cache.size > LRU_MAX) { const first = E.cache.keys().next().value; E.cache.delete(first); E.counted.delete(first); }
    if ((entry.verdict && entry.verdict.tier != null && entry.verdict.tier <= 1) || entry.enriched) persistSoon();
  }
  function persistSoon() {
    if (E.persistTimer || !E.host) return;
    E.persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
  }
  /** What re-scoring needs from an enrich partial: labels / hashtags / author / extra and a bounded text snippet. */
  function persistableEnrich(en) {
    if (!en || typeof en !== 'object') return null;
    const out = {};
    if (Array.isArray(en.labels)) out.labels = en.labels;
    if (Array.isArray(en.hashtags)) out.hashtags = en.hashtags;
    if (en.author && typeof en.author === 'object') out.author = en.author;
    if (en.extra && typeof en.extra === 'object') out.extra = en.extra;
    if (en.title) out.title = snippet(en.title, 200);
    if (en.text) out.text = snippet(en.text, PERSIST_TEXT_MAX);
    return out;
  }
  function persistableRows() {
    const t = now();
    const rows = new Map();
    for (const [key, v] of E.cache) {
      if (t - (v.ts || 0) > TTL_MS) continue;
      const keep = (v.verdict && v.verdict.tier != null && v.verdict.tier <= 1) || v.enriched;
      if (!keep) continue;
      rows.set(key, { verdict: v.verdict || null, enrich: persistableEnrich(v.enrich), enriched: !!v.enriched, ts: v.ts, epoch: v.epoch || E.epoch, surface: v.surface || null });
    }
    return rows;
  }
  /** Read-merge-write: other tabs write the same 'verdicts:<site>' key, so merge their rows (newest ts wins) before writing. */
  function persistNow() {
    if (E.persistTimer) { clearTimeout(E.persistTimer); E.persistTimer = null; }
    if (!E.host || !E.site) return Promise.resolve();
    const storageKey = 'verdicts:' + E.site;
    const mine = persistableRows();
    const t = now();
    return Promise.resolve().then(() => E.host.storageGet(storageKey)).catch(() => null).then((r) => {
      const stored = r && r[storageKey];
      if (Array.isArray(stored)) {
        for (const row of stored) {
          if (!Array.isArray(row) || row.length !== 2 || !row[1] || typeof row[1] !== 'object') continue;
          const [key, v] = row;
          if (t - (v.ts || 0) > TTL_MS) continue;
          const cur = mine.get(key);
          if (!cur || (cur.ts || 0) < (v.ts || 0)) mine.set(key, v);
        }
      }
      const rows = [...mine].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0)).slice(-E.persistCap);
      return Promise.resolve().then(() => E.host.storageSet({ [storageKey]: rows })).catch(() => {
        // quota (or any) failure: keep fewer rows next time instead of silently never persisting again
        E.persistCap = Math.max(100, Math.floor(E.persistCap / 2));
      });
    });
  }
  function loadCache() {
    if (!E.host) return Promise.resolve();
    return Promise.resolve(E.host.storageGet('verdicts:' + E.site)).then((r) => {
      const rows = r && r['verdicts:' + E.site];
      if (!Array.isArray(rows)) return;
      const t = now();
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 2) continue;
        const [key, v] = row;
        if (!v || t - (v.ts || 0) > TTL_MS) continue;
        const entry = { verdict: v.epoch === E.epoch ? v.verdict : null, enrich: v.enrich || null, enriched: !!v.enriched, ts: v.ts, epoch: v.epoch, surface: v.surface || null };
        E.cache.set(key, entry);
      }
    }).catch(() => { /* ignore */ });
  }

  // ------------------------------------------------------------------ stats
  function primaryReason(verdict) {
    const rs = (verdict && verdict.reasons) || [];
    return rs.find((r) => !/^(?:context:|style:human_)/.test(r)) || rs[0] || 'unknown';
  }
  function bump(action, reason) {
    if (!action || action === 'none') return;
    const k = action + '|' + (reason || 'unknown');
    E.statsBuf.set(k, (E.statsBuf.get(k) || 0) + 1);
    if (!E.statsTimer) E.statsTimer = setTimeout(flushStats, STATS_DEBOUNCE_MS);
  }
  function flushStats() {
    if (E.statsTimer) { clearTimeout(E.statsTimer); E.statsTimer = null; }
    if (!E.statsBuf.size || !E.host) return;
    const buf = E.statsBuf; E.statsBuf = new Map();
    for (const [k, count] of buf) {
      const i = k.indexOf('|');
      try { E.host.report({ type: 'stats', site: E.site, action: k.slice(0, i), reason: k.slice(i + 1), count }); } catch (_) { /* ignore */ }
    }
  }
  function countVerdict(key, verdict) {
    const action = verdict.action;
    const prev = E.counted.get(key);
    if (prev === action) return;
    E.counted.set(key, action);
    if (action !== 'none') bump(action, primaryReason(verdict));
  }

  // ------------------------------------------------------------------ scoring helpers
  function scoreItem(item) {
    try { return scorer().score(item, E.rules, settingsOf(), E.site); }
    catch (e) { log('score failed', e); return { score: 0, tier: null, reasons: [], action: 'none' }; }
  }
  function mergeEnrich(item, partial) {
    if (!partial || typeof partial !== 'object') return item;
    if (Array.isArray(partial.labels)) {
      const seen = new Set((item.labels || []).map((l) => l.type + '|' + (l.id || '') + '|' + (l.text || '')));
      item.labels = (item.labels || []).slice();
      for (const l of partial.labels) { const k = l.type + '|' + (l.id || '') + '|' + (l.text || ''); if (!seen.has(k)) { seen.add(k); item.labels.push(l); } }
    }
    if (Array.isArray(partial.hashtags)) item.hashtags = [...new Set([...(item.hashtags || []), ...partial.hashtags])];
    if (partial.text && !item.text) item.text = partial.text;
    if (partial.title && !item.title) item.title = partial.title;
    if (partial.extra) item.extra = Object.assign({}, item.extra || {}, partial.extra);
    if (partial.author) item.author = Object.assign({}, item.author || {}, partial.author);
    return item;
  }

  // ------------------------------------------------------------------ apply / unapply
  function strategyFor() {
    const a = E.adapter;
    let s = a && a.hideStrategy;
    if (!s && E.rules && E.rules.sites && E.rules.sites[E.site]) s = E.rules.sites[E.site].hideStrategy;
    return STRATEGIES.includes(s) ? s : 'display-none';
  }

  function authorHandle(item) {
    const a = (item && item.author) || {};
    return a.handle || a.id || a.name || '';
  }

  function makeStub(item, verdict, key, el) {
    const d = document.createElement('div');
    d.className = STUB;
    d.setAttribute('role', 'note');
    d.setAttribute('data-noslop-stub', '1');
    const reason = scorer().humanizeReason(primaryReason(verdict));
    const author = authorHandle(item);
    // Built with createElement/textContent, never innerHTML: youtube.com (www + m) ships
    // `Content-Security-Policy: require-trusted-types-for 'script'`, and an innerHTML assignment throws
    // "This document requires 'TrustedHTML' assignment" (live smoke 2026-11-02, tests/live/REPORT.md).
    const mk = (tag, cls, text, attrs) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      for (const k in (attrs || {})) n.setAttribute(k, attrs[k]);
      return n;
    };
    const sep = () => mk('span', 'noslop-stub__sep', '·');
    const btn = (act, text) => mk('button', 'noslop-stub__btn', text, { type: 'button', 'data-noslop-act': act });
    d.append(mk('span', 'noslop-stub__label', 'Hidden: AI content'), mk('span', 'noslop-stub__reason', ' — ' + reason), ' ', sep(), ' ', btn('show', 'Show'));
    if (author) d.append(' ', sep(), ' ', btn('never', 'Never show @' + author));
    d.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-noslop-act]') : null;
      ev.stopPropagation();
      if (!btn) return;
      ev.preventDefault();
      const act = btn.getAttribute('data-noslop-act');
      if (act === 'show') {
        E.sessionAllow.add(key);
        recentDrop(key);
        unapply(el);
        processElement(el);
      } else if (act === 'never' && author) {
        neverShow(author);
      }
    }, true);
    return d;
  }

  function neverShow(author) {
    const s = settingsOf();
    const blocked = Object.assign({}, s.blockedAccounts || {});
    const list = Array.isArray(blocked[E.site]) ? blocked[E.site].slice() : [];
    const norm = scorer().normHandle(author);
    if (!list.some((x) => scorer().normHandle(x) === norm)) list.push(author);
    blocked[E.site] = list;
    return Promise.resolve(E.host.patchSettings({ blockedAccounts: blocked })).catch(() => { /* ignore */ });
  }

  function makeBadge(verdict) {
    const b = document.createElement('span');
    b.className = BADGE;
    b.setAttribute('data-noslop-badge', '1');
    b.textContent = 'AI?';
    b.title = 'NoSlop: possible AI slop — ' + (verdict.reasons || []).map((r) => scorer().humanizeReason(r)).join(', ');
    return b;
  }

  // ------------------------------------------------------------------ recent-hidden ring (popup "Hidden on this tab")
  const RECENT_MAX = 50;
  function snippet(s, max) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }
  function recentPush(item, verdict, key) {
    const i = E.recent.findIndex((r) => r.key === key);
    if (i >= 0) E.recent.splice(i, 1);
    const reason = primaryReason(verdict);
    const row = { key, id: String(item.id), action: verdict.action, author: authorHandle(item), reason, reasonText: scorer().humanizeReason(reason), ts: now() };
    if (item.title) row.title = snippet(item.title, 140);
    if (item.text) row.text = snippet(item.text, 140);
    E.recent.unshift(row);
    while (E.recent.length > RECENT_MAX) E.recent.pop();
  }
  function recentDrop(key) {
    const i = E.recent.findIndex((r) => r.key === key);
    if (i >= 0) E.recent.splice(i, 1);
  }
  function recentHidden(limit) {
    const n = Math.max(1, Math.min(RECENT_MAX, Number(limit) || 20));
    return { site: E.site, items: E.recent.slice(0, n).map((r) => { const o = Object.assign({}, r); delete o.key; return o; }) };
  }
  function idSelector(id) {
    try { return '[data-noslop-id="' + (globalThis.CSS && CSS.escape ? CSS.escape(String(id)) : String(id).replace(/["\\]/g, '\\$&')) + '"]'; } catch (_) { return null; }
  }
  /** Same as the stub's "Show": allow this id for the session, unapply and re-process every element showing it. */
  function showItem(id) {
    if (!E.running) return { ok: false, error: 'engine not running' };
    if (id == null || id === '') return { ok: false, error: 'missing id' };
    const key = cacheKey(String(id));
    E.sessionAllow.add(key);
    recentDrop(key);
    const sel = idSelector(id);
    let n = 0;
    if (sel) document.querySelectorAll(sel).forEach((el) => { unapply(el); processElement(el); n++; });
    return { ok: true, count: n };
  }
  /** Drop the cached verdict (and enrich) for one id so the next extract re-scores it (adapters call this when evidence grows). */
  function invalidate(id) {
    if (id == null) return false;
    const key = cacheKey(String(id));
    const had = E.cache.delete(key);
    E.counted.delete(key);
    reprocessId(id);
    return had;
  }

  /** Where the stub goes: 'inside' (el.firstChild, default) or 'before' (previous sibling; el itself is display:none —
   *  for shadow hosts such as a bare reddit shreddit-post whose shadow chrome CSS cannot reach). */
  function stubPlacementFor(el, item) {
    const a = E.adapter;
    let p = 'inside';
    try { p = typeof a.stubPlacement === 'function' ? a.stubPlacement(el, item) : a.stubPlacement; } catch (_) { p = 'inside'; }
    return p === 'before' && el.parentNode ? 'before' : 'inside';
  }

  function apply(el, item, verdict, key) {
    const action = verdict.action;
    const st = { id: String(item.id), key, item, verdict, action, stub: null, badge: null, strategy: null, media: null, stubPlacement: 'inside' };
    if (action === 'hide' || action === 'dim') recentPush(item, verdict, key);
    if (action === 'hide') {
      const strategy = strategyFor();
      st.strategy = strategy;
      const a = E.adapter;
      if (a && typeof a.hide === 'function') {
        try { a.hide(el, item, verdict, strategy); } catch (e) { log('adapter.hide failed', e); }
      }
      el.classList.add(HIDDEN, HIDDEN + '--' + strategy);
      if (settingsOf().showStubs !== false) {
        const stub = makeStub(item, verdict, key, el);
        st.stubPlacement = stubPlacementFor(el, item);
        if (st.stubPlacement === 'before') {
          stub.setAttribute('data-noslop-for', st.id);
          el.parentNode.insertBefore(stub, el);
          el.classList.add(HIDDEN + '--host');
        } else {
          el.insertBefore(stub, el.firstChild);
        }
        st.stub = stub;
      } else {
        el.classList.add(NOSTUB);
      }
      st.media = dom().stopMedia(el);
    } else if (action === 'dim') {
      el.classList.add(DIM);
      const badge = makeBadge(verdict);
      el.insertBefore(badge, el.firstChild);
      st.badge = badge;
    }
    el.setAttribute('data-noslop-id', st.id);
    el.setAttribute('data-noslop-action', action);
    E.state.set(el, st);
    return st;
  }

  function unapply(el) {
    const st = E.state.get(el);
    el.classList.remove(HIDDEN, DIM, NOSTUB, HIDDEN + '--host');
    for (const s of STRATEGIES) el.classList.remove(HIDDEN + '--' + s);
    el.querySelectorAll(':scope > .' + STUB + ', :scope > .' + BADGE).forEach((n) => n.remove());
    if (st) {
      if (st.stub && st.stub.parentNode) st.stub.remove();
      if (st.badge && st.badge.parentNode) st.badge.remove();
      const a = E.adapter;
      if (st.action === 'hide' && a && typeof a.unhide === 'function') { try { a.unhide(el, st.item); } catch (e) { /* ignore */ } }
      // restore `muted` that stopMedia forced (never auto-play: the site decides that)
      if (Array.isArray(st.media)) for (const m of st.media) { try { if (m && m.el && !m.muted && m.el.muted) m.el.muted = false; } catch (_) { /* ignore */ } }
    }
    el.removeAttribute('data-noslop-id');
    el.removeAttribute('data-noslop-action');
    E.state.delete(el);
  }

  function stillApplied(el, st) {
    if (st.action === 'hide') {
      if (!el.classList.contains(HIDDEN)) return false;
      if (settingsOf().showStubs !== false) {
        if (!st.stub) return false;
        if (st.stubPlacement === 'before' ? st.stub.nextElementSibling !== el : st.stub.parentNode !== el) return false;
      }
      return true;
    }
    if (st.action === 'dim') return el.classList.contains(DIM) && !!(st.badge && st.badge.parentNode === el);
    return true;
  }
  /** A 'before' stub whose hidden element was removed by the site would stay behind as an orphan: drop those. */
  function pruneOrphanStubs() {
    let list;
    try { list = document.querySelectorAll('.' + STUB + '[data-noslop-for]'); } catch (_) { return; }
    list.forEach((s) => {
      const n = s.nextElementSibling;
      if (!n || n.getAttribute('data-noslop-id') !== s.getAttribute('data-noslop-for')) s.remove();
    });
  }

  // ------------------------------------------------------------------ pipeline
  function enrichAllowed() {
    const a = E.adapter;
    if (!a || typeof a.enrich !== 'function') return false;
    if (!siteActive()) return false;
    const s = settingsOf();
    if (E.site === 'youtube' && s.youtubePrefetch === false) return false;
    if (s.enrich === false) return false;
    return true;
  }
  /** Not yet enriched, and (after a FAILED attempt) past the backoff and under the attempt cap. */
  function enrichDue(entry) {
    if (!entry) return true;
    if (entry.enriched) return false;
    const attempts = entry.enrichAttempts || 0;
    if (!attempts) return true;
    if (attempts >= ENRICH_MAX_ATTEMPTS) return false;
    return now() - (entry.enrichFailedAt || 0) >= E.enrichRetryMs * Math.pow(2, attempts - 1);
  }

  function processElement(el) {
    if (!E.running || !el || el.nodeType !== 1) return null;
    if (el.classList.contains(STUB) || el.classList.contains(BADGE)) return null;
    let item = null;
    // extract(el, ctx): ctx carries the live settings / rules / surface so adapters need not reach into NS.engine.
    //   null      -> not an item (separator, promo, ...): any applied state is removed
    //   undefined -> not READY (virtualizer placeholder, cell without its permalink yet): keep whatever is applied
    try { item = E.adapter.extract(el, { settings: settingsOf(), rules: E.rules, surface: E.surface, site: E.site }); } catch (e) { log('extract failed', e); item = null; }
    const prev = E.state.get(el);
    if (item === undefined) return prev ? prev.verdict : null;
    if (!item || item.id == null || item.id === '') { if (prev) unapply(el); return null; }
    const id = String(item.id);
    if (prev && prev.id !== id) unapply(el); // cell reuse: the element now shows another post
    const key = cacheKey(id);

    let entry = cacheGet(key);
    if (entry && entry.enrich) mergeEnrich(item, entry.enrich);
    let verdict;
    if (entry && entry.verdict && entry.epoch === E.epoch && entry.surface === (item.surface || E.surface)) verdict = entry.verdict;
    else {
      verdict = scoreItem(item);
      entry = entry || { enrich: null, enriched: false };
      // Surface-dependent verdicts (reddit account:subreddit applies on 'popular' / recommended posts only) are keyed by the
      // surface they were scored on, so an SPA navigation into /r/<sub> re-scores the same post.
      entry.verdict = verdict; entry.epoch = E.epoch; entry.ts = now(); entry.surface = item.surface || E.surface;
      cacheSet(key, entry);
    }
    if (E.sessionAllow.has(key) && verdict.action !== 'none') {
      verdict = Object.assign({}, verdict, { action: 'none', reasons: (verdict.reasons || []).concat('user:show') });
    }

    const cur = E.state.get(el);
    if (cur && cur.id === id && cur.action === verdict.action && stillApplied(el, cur)) {
      cur.item = item; cur.verdict = verdict;
    } else {
      if (cur) unapply(el);
      apply(el, item, verdict, key);
    }
    countVerdict(key, verdict);
    if (verdict.action === 'none') recentDrop(key); // a re-scored item that is visible again leaves "Hidden on this tab"
    autoPromote(item, verdict);
    if (verdict.action === 'none' && !E.sessionAllow.has(key) && enrichAllowed() && enrichDue(entry)) enqueueEnrich(key, id, item);
    return verdict;
  }

  /** Process the items under `root` (no surface pass: callers batch applySurfaces() once per flush / sweep). */
  function processRoot(root) {
    if (!E.running) return 0;
    root = root || document.body;
    if (!root) return 0;
    let n = 0;
    if (root.nodeType === 1 && root.hasAttribute('data-noslop-id')) { processElement(root); n++; }
    let els = [];
    try { els = E.adapter.findItems(root) || []; } catch (e) { log('findItems failed', e); }
    for (const el of els) { processElement(el); n++; }
    return n;
  }
  /** Public: one full pass (items + surfaces). */
  function processNow(root) {
    const n = processRoot(root);
    if (E.running) applySurfaces();
    return n;
  }

  // ------------------------------------------------------------------ auto-promotion
  function autoPromote(item, verdict) {
    const s = settingsOf();
    const ap = s.autoPromote || {};
    if (ap.enabled === false || verdict.action !== 'hide' || verdict.tier == null || verdict.tier > 1) return;
    // never promote on list verdicts, ads, or a subreddit flair (a per-sub convention, not a platform label)
    if ((verdict.reasons || []).some((r) => r.startsWith('account:') || r.startsWith('ad:') || r === 'label:reddit_flair')) return;
    // only a STABLE identifier may be promoted: a display name alone would block every account sharing that name
    const a = (item && item.author) || {};
    const author = a.handle || a.id || '';
    if (!author) return;
    const norm = scorer().normHandle(author);
    if (!norm) return;
    const hits = Math.max(1, ap.hits || 3);
    const k = E.site + ':' + norm;
    let set = E.authorHits.get(k);
    if (set) E.authorHits.delete(k); else set = new Set();
    E.authorHits.set(k, set); // LRU touch
    while (E.authorHits.size > AUTHOR_HITS_MAX) E.authorHits.delete(E.authorHits.keys().next().value);
    set.add(String(item.id));
    while (set.size > AUTHOR_IDS_MAX) set.delete(set.values().next().value);
    if (set.size < hits || E.promoted.has(k)) return;
    const blocked = (s.blockedAccounts && s.blockedAccounts[E.site]) || [];
    const allowed = (s.allowedAccounts && s.allowedAccounts[E.site]) || [];
    if (blocked.some((x) => scorer().normHandle(x) === norm) || allowed.some((x) => scorer().normHandle(x) === norm)) return;
    E.promoted.add(k);
    neverShow(author);
  }

  // ------------------------------------------------------------------ surfaces
  function countSurface(el, settingKey) {
    let set = E.surfaceCounted.get(el);
    if (!set) { set = new Set(); E.surfaceCounted.set(el, set); }
    if (set.has(settingKey)) return; // once per (element, setting): a re-render or a settings change must not re-count
    set.add(settingKey);
    bump('hide', 'surface:' + settingKey);
  }
  function surfaceOff(el) {
    el.classList.remove(SURFACE);
    for (const s of SURFACE_STRATEGIES) el.classList.remove(SURFACE + '--' + s);
    el.removeAttribute('data-noslop-surface');
  }
  /** Surface entries: { settingKey, selector, strategy? } — strategy 'height-zero' collapses instead of display:none
   *  (facebook feed units must stay mounted for the virtualizer's height bookkeeping). Runs once per flush / sweep. */
  function applySurfaces() {
    if (!E.running) return;
    const a = E.adapter;
    let list = [];
    try { list = (a && typeof a.surfaces === 'function') ? (a.surfaces() || []) : []; } catch (_) { list = []; }
    const s = settingsOf();
    const active = siteActive();
    for (const sf of list) {
      if (!sf || !sf.selector || !sf.settingKey) continue;
      const on = active && !!(s.surfaces && s.surfaces[sf.settingKey]);
      const strategy = SURFACE_STRATEGIES.includes(sf.strategy) ? sf.strategy : 'display-none';
      let els;
      try { els = document.querySelectorAll(sf.selector); } catch (_) { continue; }
      els.forEach((el) => {
        if (on) {
          if (!el.classList.contains(SURFACE)) {
            el.classList.add(SURFACE, SURFACE + '--' + strategy);
            el.setAttribute('data-noslop-surface', sf.settingKey);
            countSurface(el, sf.settingKey);
          }
          dom().stopMedia(el);
        } else if (el.classList.contains(SURFACE) && el.getAttribute('data-noslop-surface') === sf.settingKey) {
          surfaceOff(el);
        }
      });
    }
  }
  function clearSurfaces() {
    document.querySelectorAll('.' + SURFACE).forEach(surfaceOff);
  }

  // ------------------------------------------------------------------ enrich queue
  function concurrency() {
    const s = settingsOf();
    const n = Number(s.enrichConcurrency || s.youtubePrefetchConcurrency || 2);
    return Math.max(1, Math.min(8, isFinite(n) ? n : 2));
  }
  function enqueueEnrich(key, id, item) {
    if (E.inflight.has(key) || E.queue.some((j) => j.key === key)) return;
    E.queue.push({ key, id, item });
    pump();
  }
  function pump() {
    while (E.running && E.inflight.size < concurrency() && E.queue.length) {
      const job = E.queue.shift();
      E.inflight.add(job.key);
      Promise.resolve()
        .then(() => E.adapter.enrich(job.item, { host: E.host, rules: E.rules, settings: settingsOf(), site: E.site }))
        .then((partial) => onEnriched(job, partial), (err) => onEnrichFailed(job, err))
        .then(() => { E.inflight.delete(job.key); pump(); settleIdle(); });
    }
    settleIdle();
  }
  function reprocessId(id) {
    const sel = idSelector(id);
    if (sel && E.running) document.querySelectorAll(sel).forEach((el) => processElement(el));
  }
  /** A successful enrich (a partial, or null = "nothing found") is a 7-day negative/positive result. */
  function onEnriched(job, partial) {
    if (!E.running) return;
    const entry = cacheGet(job.key) || { verdict: null, enrich: null, enriched: false, ts: now() };
    entry.enriched = true;
    delete entry.enrichAttempts; delete entry.enrichFailedAt;
    entry.enrich = partial && typeof partial === 'object' ? partial : null;
    if (entry.enrich) {
      mergeEnrich(job.item, entry.enrich);
      entry.verdict = scoreItem(job.item);
      entry.epoch = E.epoch;
      entry.surface = job.item.surface || E.surface;
    }
    entry.ts = now();
    cacheSet(job.key, entry);
    reprocessId(job.id);
  }
  /** A FAILED enrich (timeout, 429, background asleep, host refused) is NOT a result: never persisted as `enriched`,
   *  retried after a doubling backoff (E.enrichRetryMs, ENRICH_MAX_ATTEMPTS per page life). */
  function onEnrichFailed(job, err) {
    if (!E.running) return;
    log('enrich failed', err);
    const entry = cacheGet(job.key) || { verdict: null, enrich: null, enriched: false, ts: now() };
    entry.enriched = false;
    entry.enrichAttempts = (entry.enrichAttempts || 0) + 1;
    entry.enrichFailedAt = now();
    cacheSet(job.key, entry);
    if (entry.enrichAttempts >= ENRICH_MAX_ATTEMPTS) return;
    const delay = E.enrichRetryMs * Math.pow(2, entry.enrichAttempts - 1);
    const t = setTimeout(() => { E.retryTimers.delete(t); if (E.running) reprocessId(job.id); }, delay);
    E.retryTimers.add(t);
  }
  function settleIdle() {
    if (!E.queue.length && !E.inflight.size && E.idleResolvers.length) {
      const rs = E.idleResolvers.splice(0); rs.forEach((r) => r());
    }
  }
  function waitIdle() {
    if (!E.queue.length && !E.inflight.size) return Promise.resolve();
    return new Promise((resolve) => E.idleResolvers.push(resolve));
  }

  // ------------------------------------------------------------------ observer / scheduling
  function isOurs(node) {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el) return false;
    if (el.classList && (el.classList.contains(STUB) || el.classList.contains(BADGE))) return true;
    return !!(el.closest && el.closest('.' + STUB + ', .' + BADGE));
  }
  function onMutations(records) {
    for (const r of records) {
      if (isOurs(r.target)) continue;
      if (r.type === 'childList') {
        let addedForeign = false;
        for (const n of r.addedNodes) { if (n.nodeType === 1 && !isOurs(n)) { E.pending.add(n); addedForeign = true; } else if (n.nodeType === 3) addedForeign = true; }
        if (r.removedNodes.length || addedForeign) E.pending.add(r.target);
      } else {
        E.pending.add(r.target);
      }
    }
    if (E.pending.size) { E.mutated = true; schedule(); }
  }
  function schedule() {
    if (E.flushTimer != null || !E.running) return;
    const ric = globalThis.requestIdleCallback;
    if (typeof ric === 'function') E.flushTimer = { ric: ric(flushPending, { timeout: 300 }) };
    else E.flushTimer = { t: setTimeout(flushPending, 0) };
  }
  function flushPending() {
    if (E.flushTimer && E.flushTimer.t) clearTimeout(E.flushTimer.t);
    else if (E.flushTimer && E.flushTimer.ric && globalThis.cancelIdleCallback) { try { cancelIdleCallback(E.flushTimer.ric); } catch (_) { /* ignore */ } }
    E.flushTimer = null;
    if (!E.running) { E.pending.clear(); return; }
    checkNavigation(); // every route change comes with a mutation storm: the cheapest place to notice it
    const nodes = [...E.pending]; E.pending.clear();
    if (!nodes.length) return;
    if (nodes.length > 150 || nodes.includes(document.body) || nodes.includes(document.documentElement)) { processRoot(document.body); afterPass(); return; }
    const roots = new Set();
    for (const n of nodes) {
      const el = n.nodeType === 1 ? n : n.parentElement;
      if (!el || !el.isConnected) continue;
      const owner = el.closest('[data-noslop-id]');
      roots.add(owner || el);
    }
    for (const r of roots) {
      if (!r.isConnected) continue;
      if (r.hasAttribute('data-noslop-id')) processElement(r);
      processRoot(r);
    }
    afterPass();
  }
  /** Once per flush / sweep, never per mutation root: document-wide surface selectors and orphan-stub cleanup. */
  function afterPass() {
    if (!E.running) return;
    pruneOrphanStubs();
    applySurfaces();
  }

  function installObserver() {
    if (E.observer || !document.body) return;
    const a = E.adapter;
    const root = (a && typeof a.observeRoot === 'function' && a.observeRoot()) || document.body;
    const attrs = (a && Array.isArray(a.attributeFilter) && a.attributeFilter.length) ? a.attributeFilter : null;
    E.observer = new MutationObserver(onMutations);
    const opts = { childList: true, subtree: true };
    if (attrs) { opts.attributes = true; opts.attributeFilter = attrs; }
    E.observer.observe(root, opts);
  }

  /** Safety sweep. Full pass only when a mutation was observed since the last sweep or the URL changed; otherwise a
   *  cheap re-check of what is already applied (classes / stubs dropped by a site re-render, media in hidden surfaces). */
  function startSweep() {
    if (E.sweepTimer) return;
    E.sweepTimer = setInterval(() => {
      if (!E.running) return;
      if (document.hidden || (document.visibilityState && document.visibilityState !== 'visible')) return;
      if (checkNavigation()) return; // onNavigate scheduled the full passes
      if (E.mutated) { E.mutated = false; processRoot(document.body); afterPass(); return; }
      document.querySelectorAll('[data-noslop-id]').forEach((el) => { const st = E.state.get(el); if (st && !stillApplied(el, st)) processElement(el); });
      document.querySelectorAll('.' + SURFACE).forEach((el) => dom().stopMedia(el));
      afterPass();
    }, SWEEP_MS);
  }

  function currentHref() { try { return String(location.href); } catch (_) { return ''; } }
  /** World-independent SPA detection: the page's own history.pushState never goes through a content script's History
   *  wrapper (isolated worlds), so the URL is compared on every flush and sweep. Returns true when it changed. */
  function checkNavigation() {
    if (!E.running) return false;
    const href = currentHref();
    if (href === E.lastHref) return false;
    onNavigate();
    return true;
  }
  function onNavigate() {
    if (!E.running) return;
    E.lastHref = currentHref();
    try { E.surface = (E.adapter && typeof E.adapter.surface === 'function') ? E.adapter.surface(location) : 'other'; } catch (_) { E.surface = 'other'; }
    E.navTimers.forEach(clearTimeout); E.navTimers = [];
    E.navTimers.push(setTimeout(() => processNow(document.body), 0));
    E.navTimers.push(setTimeout(() => processNow(document.body), 500));
  }

  function hookNavigation() {
    // Harmless extra: only works when the page's router shares our History object (tests, page-world injection).
    const h = globalThis.history;
    if (h && !E.historyPatched) {
      const orig = { pushState: h.pushState, replaceState: h.replaceState };
      const wrap = (fn) => function () { const r = fn.apply(this, arguments); try { globalThis.dispatchEvent(new Event('noslop:navigate')); } catch (_) { /* ignore */ } return r; };
      try { h.pushState = wrap(orig.pushState); h.replaceState = wrap(orig.replaceState); E.historyPatched = orig; } catch (_) { /* ignore */ }
    }
    const events = ['noslop:navigate', 'popstate', 'hashchange'].concat((E.adapter && E.adapter.navigateEvents) || []);
    for (const ev of events) { globalThis.addEventListener(ev, onNavigate); E.navListeners.push(ev); }
    // Navigation API (Chrome 102+, Safari 26): currententrychange fires after any same-document navigation commits.
    const nav = globalThis.navigation;
    if (nav && typeof nav.addEventListener === 'function' && !E.navApiListener) {
      E.navApiListener = () => { checkNavigation(); };
      try { nav.addEventListener('currententrychange', E.navApiListener); } catch (_) { E.navApiListener = null; }
    }
    E.lastHref = currentHref();
    try { E.surface = (E.adapter && typeof E.adapter.surface === 'function') ? E.adapter.surface(location) : 'other'; } catch (_) { E.surface = 'other'; }
  }
  function unhookNavigation() {
    for (const ev of E.navListeners) globalThis.removeEventListener(ev, onNavigate);
    E.navListeners = [];
    if (E.navApiListener && globalThis.navigation) { try { globalThis.navigation.removeEventListener('currententrychange', E.navApiListener); } catch (_) { /* ignore */ } }
    E.navApiListener = null;
    if (E.historyPatched && globalThis.history) {
      try { globalThis.history.pushState = E.historyPatched.pushState; globalThis.history.replaceState = E.historyPatched.replaceState; } catch (_) { /* ignore */ }
      E.historyPatched = null;
    }
    E.navTimers.forEach(clearTimeout); E.navTimers = [];
  }

  // Flush stats + the verdict cache when the tab goes away or to the background (the persist debounce is 12 s).
  function hookLifecycle() {
    if (E.lifecycleListeners.length || typeof document === 'undefined') return;
    const flush = () => { if (!E.running) return; flushStats(); persistNow(); };
    const onVis = () => { if (document.hidden) flush(); };
    try {
      globalThis.addEventListener('pagehide', flush); E.lifecycleListeners.push(['pagehide', flush, globalThis]);
      document.addEventListener('visibilitychange', onVis); E.lifecycleListeners.push(['visibilitychange', onVis, document]);
    } catch (_) { /* ignore */ }
  }
  function unhookLifecycle() {
    for (const [ev, fn, target] of E.lifecycleListeners) { try { target.removeEventListener(ev, fn); } catch (_) { /* ignore */ } }
    E.lifecycleListeners = [];
  }

  function whenBody(fn) {
    if (document.body) { fn(); return; }
    const mo = new MutationObserver(() => { if (document.body) { mo.disconnect(); E.bodyWaiter = null; fn(); } });
    mo.observe(document.documentElement, { childList: true });
    E.bodyWaiter = mo;
    document.addEventListener('DOMContentLoaded', () => { if (E.bodyWaiter === mo) { mo.disconnect(); E.bodyWaiter = null; fn(); } }, { once: true });
  }

  // ------------------------------------------------------------------ settings
  /** rulesOverride is a PARTIAL rules object deep-merged over the bundled rules (objects recurse, arrays and scalars replace). */
  function mergeRules(base, over) {
    if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
    const out = Object.assign({}, base || {});
    for (const [k, v] of Object.entries(over)) {
      const b = out[k];
      out[k] = (v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b)) ? mergeRules(b, v) : v;
    }
    return out;
  }
  function adoptSettings(s) {
    E.settings = NS.migrateSettings ? NS.migrateSettings(s) : (s || {});
    const over = E.settings.rulesOverride;
    E.rules = (over && typeof over === 'object' && !Array.isArray(over) && Object.keys(over).length) ? mergeRules(E.rulesBase, over) : E.rulesBase;
    E.epoch = computeEpoch();
  }
  function onSettingsChanged(s) {
    if (!E.running) return;
    E.epochCounter++;
    adoptSettings(s);
    for (const v of E.cache.values()) v.verdict = null;
    document.querySelectorAll('[data-noslop-id]').forEach((el) => unapply(el));
    clearSurfaces();
    if (!siteActive()) E.recent = []; // nothing is hidden on this tab any more
    processRoot(document.body);
    afterPass();
  }

  // ------------------------------------------------------------------ public API
  function start(opts) {
    opts = opts || {};
    if (E.running) stop();
    const adapter = opts.adapter || NS.adapters.pick(globalThis.location);
    if (!adapter) return Promise.reject(new Error('NoSlop: no adapter for this page'));
    E.adapter = adapter;
    E.site = adapter.site;
    E.host = opts.host || NS.host;
    E.rulesBase = opts.rules || NS.rules || {};
    E.cache = new Map(); E.counted = new Map(); E.sessionAllow = new Set(); E.authorHits = new Map(); E.promoted = new Set();
    E.surfaceCounted = new WeakMap(); E.persistCap = PERSIST_MAX; E.mutated = false;
    E.queue = []; E.inflight = new Set(); E.pending = new Set(); E.statsBuf = new Map(); E.recent = [];
    return Promise.resolve(E.host.getSettings()).catch(() => null).then((s) => {
      adoptSettings(s);
      return loadCache();
    }).then(() => {
      E.running = true;
      try { E.unsubSettings = E.host.onSettingsChanged(onSettingsChanged); } catch (_) { E.unsubSettings = null; }
      installMessageListener();
      hookLifecycle();
      whenBody(() => {
        if (!E.running) return;
        installObserver();
        hookNavigation();
        startSweep();
        processNow(document.body);
      });
      return NS.engine;
    });
  }

  function stop() {
    E.running = false;
    if (E.observer) { E.observer.disconnect(); E.observer = null; }
    if (E.bodyWaiter) { E.bodyWaiter.disconnect(); E.bodyWaiter = null; }
    if (E.sweepTimer) { clearInterval(E.sweepTimer); E.sweepTimer = null; }
    if (E.flushTimer) { if (E.flushTimer.t) clearTimeout(E.flushTimer.t); E.flushTimer = null; }
    for (const t of E.retryTimers) clearTimeout(t);
    E.retryTimers.clear();
    unhookNavigation();
    unhookLifecycle();
    removeMessageListener();
    if (E.unsubSettings) { try { E.unsubSettings(); } catch (_) { /* ignore */ } E.unsubSettings = null; }
    try { document.querySelectorAll('[data-noslop-id]').forEach((el) => unapply(el)); clearSurfaces(); pruneOrphanStubs(); } catch (_) { /* ignore */ }
    E.pending.clear(); E.queue = []; E.inflight = new Set(); E.recent = [];
    flushStats();
    persistNow();
    settleIdle();
  }

  // ------------------------------------------------------------------ popup <-> content-script messages
  // {type:'getRecentHidden', limit} -> { site, items[] } ; {type:'showItem', id} -> {ok} ; {type:'invalidate', id} -> {ok}.
  // Unknown types return undefined (no sendResponse) so background-bound messages are unaffected.
  function handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return undefined;
    switch (msg.type) {
      case 'getRecentHidden': return recentHidden(msg.limit);
      case 'showItem': return showItem(msg.id);
      case 'invalidate': return { ok: invalidate(msg.id) };
      case 'noslopStatus': return { ok: true, running: E.running, site: E.site, surface: E.surface, hidden: E.recent.length };
      default: return undefined;
    }
  }
  function installMessageListener() {
    if (E.messageListener) return;
    const b = (typeof browser !== 'undefined' && browser && browser.runtime && browser.runtime.onMessage) ? browser
      : (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.onMessage) ? chrome : null;
    if (!b) return;
    const fn = (msg, sender, sendResponse) => {
      let r;
      try { r = handleMessage(msg); } catch (e) { r = { ok: false, error: e && e.message ? e.message : String(e) }; }
      if (r === undefined) return undefined;
      try { sendResponse(r); } catch (_) { /* port closed */ }
      return true;
    };
    try { b.runtime.onMessage.addListener(fn); E.messageListener = { b, fn }; } catch (_) { E.messageListener = null; }
  }
  function removeMessageListener() {
    if (!E.messageListener) return;
    try { E.messageListener.b.runtime.onMessage.removeListener(E.messageListener.fn); } catch (_) { /* ignore */ }
    E.messageListener = null;
  }

  NS.engine = {
    start, stop, processNow,
    flushPending, flushStats, persistNow, waitIdle, applySurfaces, checkNavigation,
    showItem, invalidate, recentHidden, handleMessage, siteActive,
    get running() { return E.running; },
    get settings() { return E.settings; },
    get rules() { return E.rules; },
    get cache() { return E.cache; },
    get site() { return E.site; },
    get surface() { return E.surface; },
    stateOf(el) { return E.state.get(el) || null; },
    _E: E
  };
})();
