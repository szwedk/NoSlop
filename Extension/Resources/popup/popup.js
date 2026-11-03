// NoSlop — extension popup (docs/DESIGN.md §1 popup/, §6 settings, §7 sync). Plain classic script, no modules.
// Runs inside Safari (iOS/macOS) action popovers and Chrome action popups; needs `browser` (Safari) or `chrome`
// (the Chrome build prepends `globalThis.browser ??= chrome;`). Testable through NoSlop.popup.* with a mocked browser.
//
// Messages this popup sends
//   to background (browser.runtime.sendMessage)           — handled by background.js handle():
//     { type:'popupOpened' }            -> { settings, platform:'ios'|'macos'|null }   (background pulls App Group settings first)
//     { type:'getSettings' }            -> { settings }
//     { type:'patchSettings', patch }   -> { settings }   (patch is a SHALLOW merge: send whole `sites` / `surfaces` / `blockedAccounts` maps)
//     { type:'getStats' }               -> { stats }      (storage.local 'stats': { "<YYYY-MM-DD>": { "<site>": { hide, dim, reasons } } })
//   to the content script of the active tab (browser.tabs.sendMessage(tab.id, msg)) — to be answered by lib/engine.js:
//     { type:'getRecentHidden', limit:20 }
//        -> { site, items:[ { id, action:'hide'|'dim', author, reason, reasonText?, title?, text?, ts } ] }   newest first, at most `limit`
//           id        the item id the engine used as cache key (el.dataset.noslopId)
//           author    author handle/id/name as the stub shows it ("Never show @author"); '' when unknown
//           reason    primary machine reason id (e.g. 'label:youtube_badge'); reasonText = scorer.humanizeReason(reason)
//           text/title a short snippet (<= 140 chars) for display only; ts = Date.now() when the verdict was applied
//     { type:'showItem', id }           -> { ok:true } | { ok:false, error }   (same as the stub's "Show": session allow + unapply + re-process)
//   A tab without the content script (unsupported site, extension disabled for the site, page not yet loaded)
//   rejects tabs.sendMessage; the popup shows an empty list and keeps working.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});

  const SITES = ['youtube', 'x', 'instagram', 'facebook', 'tiktok', 'reddit', 'linkedin'];
  const SITE_NAMES = { youtube: 'YouTube', x: 'X', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', reddit: 'Reddit', linkedin: 'LinkedIn' };
  // Hostname -> site. Mirrors adapters/<site>.js matches() (same regexes) so the popup and content.js agree.
  const HOSTS = [
    [/(^|\.)youtube\.com$/i, 'youtube'],
    [/(^|\.)(x|twitter)\.com$/i, 'x'],
    [/(^|\.)instagram\.com$/i, 'instagram'],
    [/(^|\.)facebook\.com$/i, 'facebook'],
    [/(^|\.)tiktok\.com$/i, 'tiktok'],
    [/(^|\.)reddit\.com$/i, 'reddit'],
    [/(^|\.)linkedin\.com$/i, 'linkedin']
  ];
  const MODE_HINTS = {
    strict: 'Strict hides anything that looks AI-made, including suspicious writing. Expect a few false positives.',
    balanced: 'Balanced hides labelled and disclosed AI content and dims suspicious writing.',
    off: 'Off: nothing is hidden or dimmed on this site.'
  };
  // Same table as lib/scorer.js REASON_LABELS — fallback when the content script sends no reasonText.
  const REASON_LABELS = {
    label: 'platform AI label', ad: 'promoted', disclosure: 'self-disclosed AI', hashtag: 'AI hashtag', tool: 'AI tool mention',
    residue: 'chatbot residue', prompt: 'prompt metadata', account: 'blocked account', custom: 'your custom rule', style: 'AI-style writing',
    context: 'critique context', surface: 'hidden surface', user: 'you'
  };
  const RECENT_LIMIT = 20;
  const TOAST_MS = 1800;

  // ------------------------------------------------------------------ pure helpers (unit-tested)
  function siteFor(url) {
    let host = '';
    try { host = new URL(String(url || '')).hostname; } catch (_) { return null; }
    for (const [re, site] of HOSTS) if (re.test(host)) return site;
    return null;
  }
  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /** { site:{hide,dim}, all:{hide,dim} } for one day of the background's stats object. */
  function countsFor(stats, site, day) {
    const out = { site: { hide: 0, dim: 0 }, all: { hide: 0, dim: 0 } };
    const dayStats = stats && stats[day || todayKey()];
    if (!dayStats || typeof dayStats !== 'object') return out;
    for (const [s, v] of Object.entries(dayStats)) {
      if (!v || typeof v !== 'object') continue;
      const h = Number(v.hide) || 0, d = Number(v.dim) || 0;
      out.all.hide += h; out.all.dim += d;
      if (s === site) { out.site.hide += h; out.site.dim += d; }
    }
    return out;
  }
  // Same normalisation as lib/scorer.js normHandle() (not loaded in the popup; kept in sync by tests/popup.test.mjs).
  function normHandle(s) {
    if (s == null) return '';
    let v = String(s).trim().toLowerCase();
    v = v.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+|\/+$/g, '');
    v = v.replace(/^(?:r|u|user|in|c|channel)\//, '');
    return v.replace(/^@/, '');
  }
  function humanizeReason(id) {
    if (!id) return '';
    const [kind, rest] = String(id).split(':');
    const label = REASON_LABELS[kind] || kind;
    if (kind === 'hashtag' || kind === 'custom') return rest ? label + ' ' + rest : label;
    if (kind === 'account') return rest === 'block' ? 'account you blocked' : rest === 'allow' ? 'allowed account' : 'listed account';
    if (kind === 'tool') return 'mentions ' + rest;
    return rest ? label + ' (' + rest.replace(/_/g, ' ') + ')' : label;
  }
  function isBlocked(settings, site, author) {
    const list = settings && settings.blockedAccounts && settings.blockedAccounts[site];
    const n = normHandle(author);
    return !!n && Array.isArray(list) && list.some((x) => normHandle(x) === n);
  }
  /** New blockedAccounts map with `author` added to (or removed from) `site`. Never mutates the input. */
  function withBlocked(settings, site, author, block) {
    const cur = (settings && settings.blockedAccounts) || {};
    const next = {};
    for (const s of SITES) next[s] = Array.isArray(cur[s]) ? cur[s].slice() : [];
    for (const [s, v] of Object.entries(cur)) if (!(s in next)) next[s] = Array.isArray(v) ? v.slice() : [];
    const n = normHandle(author);
    if (!n) return next;
    const list = next[site] || (next[site] = []);
    const i = list.findIndex((x) => normHandle(x) === n);
    if (block && i < 0) list.push(author);
    if (!block && i >= 0) list.splice(i, 1);
    return next;
  }
  function fmtCount(n) { n = Number(n) || 0; return n >= 10000 ? Math.round(n / 1000) + 'k' : String(n); }
  function snippet(s, max) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // ------------------------------------------------------------------ browser bridge
  function runtime(b) { return (b && b.runtime) ? b : null; }
  function call(fn) {
    // Supports both the promise API (Safari/Firefox `browser`) and the callback API (`chrome`).
    return new Promise((resolve, reject) => {
      try {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; resolve(v); } };
        const fail = (e) => { if (!settled) { settled = true; reject(e instanceof Error ? e : new Error(String(e && e.message || e))); } };
        const r = fn((v) => {
          const err = globalThis.browser && browser.runtime && browser.runtime.lastError || globalThis.chrome && chrome.runtime && chrome.runtime.lastError;
          if (err) fail(new Error(err.message || String(err))); else done(v);
        });
        if (r && typeof r.then === 'function') r.then(done, fail);
      } catch (e) { reject(e); }
    });
  }
  function isSafari() {
    try { return typeof b0.runtime.getURL === 'function' && /^safari-web-extension:/.test(b0.runtime.getURL('')); } catch (_) { return false; }
  }
  let b0 = null; // the runtime object the popup was created with (set by createPopup)
  function makeBridge(b) {
    b0 = b;
    return {
      send(msg) { return call((cb) => b.runtime.sendMessage(msg, cb)); },
      sendToTab(tabId, msg) {
        if (!b.tabs || typeof b.tabs.sendMessage !== 'function' || tabId == null) return Promise.reject(new Error('no tabs API'));
        return call((cb) => b.tabs.sendMessage(tabId, msg, cb));
      },
      activeTab() {
        if (!b.tabs || typeof b.tabs.query !== 'function') return Promise.resolve(null);
        return call((cb) => b.tabs.query({ active: true, currentWindow: true }, cb))
          .then((tabs) => (Array.isArray(tabs) && tabs[0]) || null)
          .catch(() => null);
      },
      onSettingsChanged(cb) {
        const on = b.storage && b.storage.onChanged;
        if (!on || !on.addListener) return () => {};
        const fn = (changes, area) => {
          if (area && area !== 'local') return;
          if (changes && changes.settings && changes.settings.newValue) cb(changes.settings.newValue);
        };
        on.addListener(fn);
        return () => { try { on.removeListener(fn); } catch (_) { /* ignore */ } };
      },
      openTab(url) {
        if (b.tabs && typeof b.tabs.create === 'function') { try { b.tabs.create({ url }); return true; } catch (_) { /* fall through */ } }
        return false;
      }
    };
  }

  // ------------------------------------------------------------------ popup controller
  function createPopup(doc, b) {
    const $ = (id) => doc.getElementById(id);
    const bridge = makeBridge(b);
    const P = {
      settings: null, platform: null, tab: null, site: null, stats: {}, recent: [], recentError: null,
      bridge, unsub: null, toastTimer: null, ready: null
    };

    // ---- rendering
    function toast(msg) {
      const t = $('toast');
      if (!t) return;
      t.textContent = msg;
      t.hidden = false;
      if (P.toastTimer) clearTimeout(P.toastTimer);
      P.toastTimer = setTimeout(() => { t.hidden = true; P.toastTimer = null; }, TOAST_MS);
    }
    function renderMaster() {
      const s = P.settings || {};
      const on = s.enabled !== false;
      const input = $('master-toggle');
      if (input) { input.checked = on; input.setAttribute('aria-checked', on ? 'true' : 'false'); }
      const lbl = $('master-label'); if (lbl) lbl.textContent = on ? 'On' : 'Off';
      const root = $('popup'); if (root) root.setAttribute('data-disabled', on ? 'false' : 'true');
    }
    function renderSite() {
      const name = $('site-name'), unsupported = $('site-unsupported'), group = $('mode-group'), hint = $('mode-hint');
      const supported = !!P.site;
      if (name) name.textContent = supported ? SITE_NAMES[P.site] : (P.tab ? 'Unsupported site' : 'No active tab');
      if (unsupported) unsupported.hidden = supported;
      if (group) {
        group.hidden = !supported;
        group.disabled = !supported;
        group.setAttribute('aria-disabled', supported ? 'false' : 'true');
        const mode = supported && P.settings && P.settings.sites && P.settings.sites[P.site] && P.settings.sites[P.site].mode || 'balanced';
        group.querySelectorAll('input[name="mode"]').forEach((r) => { r.checked = r.value === mode; });
        if (hint) { hint.hidden = !supported; hint.textContent = MODE_HINTS[mode] || ''; }
      }
    }
    function renderCounts() {
      const c = countsFor(P.stats, P.site, todayKey());
      const set = (id, v) => { const el = $(id); if (el) el.textContent = fmtCount(v); };
      set('count-site-hide', c.site.hide); set('count-site-dim', c.site.dim);
      set('count-all-hide', c.all.hide); set('count-all-dim', c.all.dim);
      const cells = doc.querySelectorAll('#counts .counts__cell');
      // "here" cells only make sense on a supported site.
      if (cells[0]) cells[0].hidden = !P.site;
      if (cells[1]) cells[1].hidden = !P.site;
      const dl = $('counts'); if (dl) dl.style.gridTemplateColumns = P.site ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)';
    }
    function renderSurfaces() {
      const sf = (P.settings && P.settings.surfaces) || {};
      doc.querySelectorAll('#surfaces input[data-surface]').forEach((input) => {
        const k = input.getAttribute('data-surface');
        input.checked = !!sf[k];
      });
      // top-level boolean settings (tiktokJsonRelay, reelsAutoAdvance): default true when absent (§6 defaults)
      doc.querySelectorAll('input[data-setting]').forEach((input) => {
        const k = input.getAttribute('data-setting');
        const v = P.settings ? P.settings[k] : undefined;
        input.checked = v == null ? true : !!v;
      });
    }
    function renderRecent() {
      const list = $('recent-list'), empty = $('recent-empty');
      if (!list) return;
      list.textContent = '';
      const items = Array.isArray(P.recent) ? P.recent.slice(0, RECENT_LIMIT) : [];
      if (empty) {
        empty.hidden = items.length > 0;
        if (!items.length) {
          empty.textContent = !P.site ? 'Open a supported site to see what NoSlop hides there.'
            : P.recentError ? 'NoSlop is not running on this tab yet. Reload the page, then reopen this popup.'
              : 'Nothing hidden on this tab yet.';
        }
      }
      for (const it of items) {
        const li = doc.createElement('li');
        li.className = 'recent__item';
        li.setAttribute('data-id', String(it.id));
        const head = doc.createElement('div'); head.className = 'recent__head';
        const author = doc.createElement('span'); author.className = 'recent__author';
        author.textContent = it.author ? '@' + String(it.author).replace(/^@/, '') : (it.title ? snippet(it.title, 60) : 'Unknown author');
        const action = doc.createElement('span'); action.className = 'recent__action';
        action.setAttribute('data-action', it.action === 'dim' ? 'dim' : 'hide');
        action.textContent = it.action === 'dim' ? 'Dimmed' : 'Hidden';
        head.appendChild(author); head.appendChild(action);
        li.appendChild(head);
        const body = it.author && it.title ? it.title : it.text;
        if (body) { const t = doc.createElement('div'); t.className = 'recent__text'; t.textContent = snippet(body, 140); li.appendChild(t); }
        const reasonText = it.reasonText || humanizeReason(it.reason);
        if (reasonText) { const r = doc.createElement('div'); r.className = 'recent__reason'; r.textContent = 'Why: ' + reasonText; li.appendChild(r); }
        const actions = doc.createElement('div'); actions.className = 'recent__actions';
        const show = doc.createElement('button'); show.type = 'button'; show.className = 'chip'; show.setAttribute('data-act', 'show'); show.setAttribute('data-id', String(it.id));
        show.textContent = 'Show again';
        actions.appendChild(show);
        if (it.author) {
          const blocked = isBlocked(P.settings, P.site, it.author);
          const never = doc.createElement('button'); never.type = 'button'; never.className = 'chip' + (blocked ? '' : ' chip--danger');
          never.setAttribute('data-act', blocked ? 'unblock' : 'never'); never.setAttribute('data-author', String(it.author));
          never.textContent = (blocked ? 'Unblock @' : 'Never show @') + String(it.author).replace(/^@/, '');
          actions.appendChild(never);
        }
        li.appendChild(actions);
        list.appendChild(li);
      }
    }
    function renderFooter() {
      const a = $('open-app'), hint = $('open-app-hint'), v = $('version');
      const native = P.platform === 'ios' || P.platform === 'macos' || isSafari();
      if (a) {
        a.href = 'noslop://open';
        a.textContent = native ? 'Open the NoSlop app' : 'NoSlop app';
        a.hidden = !native; // Chrome build: there is no companion app on this device
      }
      if (hint) { hint.hidden = native; hint.textContent = 'Lists and per-site settings are also in the NoSlop app on iPhone and Mac. Chrome keeps its own copy of these settings.'; }
      if (v) {
        const rulesV = NS.rules && NS.rules.version;
        const manifestV = b.runtime && typeof b.runtime.getManifest === 'function' ? (b.runtime.getManifest() || {}).version : '';
        v.textContent = ['NoSlop' + (manifestV ? ' ' + manifestV : ''), rulesV ? 'rules ' + rulesV : ''].filter(Boolean).join(' · ');
      }
    }
    function render() { renderMaster(); renderSite(); renderCounts(); renderSurfaces(); renderRecent(); renderFooter(); }

    // ---- data
    function adoptSettings(s) {
      if (!s || typeof s !== 'object') return;
      P.settings = NS.migrateSettings ? NS.migrateSettings(s) : s;
    }
    function loadSettings() {
      return bridge.send({ type: 'popupOpened' })
        .then((r) => { if (r && r.settings) { adoptSettings(r.settings); P.platform = r.platform || null; return r.settings; } throw new Error('no settings'); })
        .catch(() => bridge.send({ type: 'getSettings' }).then((r) => { if (r && r.settings) adoptSettings(r.settings); }))
        .catch(() => { /* keep whatever we have */ });
    }
    function loadStats() {
      return bridge.send({ type: 'getStats' }).then((r) => { P.stats = (r && r.stats) || {}; }).catch(() => { P.stats = P.stats || {}; });
    }
    function loadTab() {
      return bridge.activeTab().then((tab) => { P.tab = tab; P.site = tab ? siteFor(tab.url || tab.pendingUrl) : null; });
    }
    function loadRecent() {
      P.recentError = null;
      if (!P.tab || !P.site) { P.recent = []; return Promise.resolve(); }
      return bridge.sendToTab(P.tab.id, { type: 'getRecentHidden', limit: RECENT_LIMIT })
        .then((r) => { P.recent = (r && Array.isArray(r.items)) ? r.items.slice(0, RECENT_LIMIT) : []; if (!r) P.recentError = 'no response'; })
        .catch((e) => { P.recent = []; P.recentError = (e && e.message) || 'unreachable'; });
    }
    function patch(partial) {
      return bridge.send({ type: 'patchSettings', patch: partial }).then((r) => {
        if (r && r.settings) { adoptSettings(r.settings); return P.settings; }
        throw new Error((r && r.error) || 'patchSettings failed');
      });
    }

    // ---- actions
    function setEnabled(on) {
      if (P.settings) P.settings.enabled = !!on; // optimistic
      renderMaster();
      return patch({ enabled: !!on }).then(render).catch(() => { toast('Could not save'); return loadSettings().then(render); });
    }
    function setMode(mode) {
      if (!P.site || !['strict', 'balanced', 'off'].includes(mode)) return Promise.resolve();
      const sites = Object.assign({}, (P.settings && P.settings.sites) || {});
      sites[P.site] = Object.assign({}, sites[P.site] || {}, { mode });
      if (P.settings) P.settings.sites = sites;
      renderSite();
      return patch({ sites }).then(render).catch(() => { toast('Could not save'); return loadSettings().then(render); });
    }
    function setFlag(key, on) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) return Promise.resolve();
      const p = {}; p[key] = !!on;
      if (P.settings) P.settings[key] = !!on;
      return patch(p).then(render).catch(() => { toast('Could not save'); return loadSettings().then(render); });
    }
    function setSurface(key, on) {
      const surfaces = Object.assign({}, (P.settings && P.settings.surfaces) || {});
      surfaces[key] = !!on;
      if (P.settings) P.settings.surfaces = surfaces;
      return patch({ surfaces }).then(render).catch(() => { toast('Could not save'); return loadSettings().then(render); });
    }
    function neverShow(author) {
      if (!P.site || !author) return Promise.resolve();
      const blockedAccounts = withBlocked(P.settings, P.site, author, true);
      return patch({ blockedAccounts }).then(() => { toast('Blocked @' + String(author).replace(/^@/, '')); render(); })
        .catch(() => toast('Could not save'));
    }
    function unblock(author) {
      if (!P.site || !author) return Promise.resolve();
      const blockedAccounts = withBlocked(P.settings, P.site, author, false);
      return patch({ blockedAccounts }).then(() => { toast('Unblocked @' + String(author).replace(/^@/, '')); render(); })
        .catch(() => toast('Could not save'));
    }
    function showItem(id) {
      if (!P.tab) return Promise.resolve(false);
      return bridge.sendToTab(P.tab.id, { type: 'showItem', id })
        .then((r) => {
          if (r && r.ok) { P.recent = P.recent.filter((it) => String(it.id) !== String(id)); renderRecent(); toast('Shown again'); return true; }
          toast((r && r.error) || 'Could not show it'); return false;
        })
        .catch(() => { toast('Page not reachable — reload it'); return false; });
    }
    function refreshRecent() { return loadRecent().then(renderRecent); }
    function openApp(ev) {
      // Safari on iOS/macOS: the noslop:// URL scheme is registered by the containing app (project.yml CFBundleURLTypes).
      // Opening it from a popover works through a normal link; nothing else to do. Chrome: link is hidden.
      if (P.platform !== 'ios' && P.platform !== 'macos' && !isSafari()) { if (ev && ev.preventDefault) ev.preventDefault(); toast('Install the NoSlop app from the App Store'); }
    }

    // ---- wiring
    function bind() {
      const master = $('master-toggle');
      if (master) master.addEventListener('change', () => setEnabled(master.checked));
      const group = $('mode-group');
      if (group) group.addEventListener('change', (ev) => { const t = ev.target; if (t && t.name === 'mode' && t.checked) setMode(t.value); });
      const surfaces = $('surfaces');
      if (surfaces) surfaces.addEventListener('change', (ev) => { const t = ev.target; const k = t && t.getAttribute && t.getAttribute('data-surface'); if (k) setSurface(k, t.checked); });
      const flags = $('flags');
      if (flags) flags.addEventListener('change', (ev) => { const t = ev.target; const k = t && t.getAttribute && t.getAttribute('data-setting'); if (k) setFlag(k, t.checked); });
      const list = $('recent-list');
      if (list) list.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
        if (!btn) return;
        ev.preventDefault();
        const act = btn.getAttribute('data-act');
        if (act === 'show') showItem(btn.getAttribute('data-id'));
        else if (act === 'never') neverShow(btn.getAttribute('data-author'));
        else if (act === 'unblock') unblock(btn.getAttribute('data-author'));
      });
      const refresh = $('recent-refresh');
      if (refresh) refresh.addEventListener('click', () => refreshRecent());
      const open = $('open-app');
      if (open) open.addEventListener('click', openApp);
      P.unsub = bridge.onSettingsChanged((s) => { adoptSettings(s); render(); });
      // Escape closes Safari/Chrome popovers natively; nothing to do. Keep focus order: switch, mode, surfaces, list, footer.
    }

    function init() {
      bind();
      const root = $('popup');
      P.ready = Promise.all([loadSettings(), loadTab()])
        .then(() => Promise.all([loadStats(), loadRecent()]))
        .then(() => { render(); if (root) root.setAttribute('data-state', 'ready'); })
        .catch(() => { render(); if (root) root.setAttribute('data-state', 'ready'); });
      return P.ready;
    }
    function destroy() { if (P.unsub) { P.unsub(); P.unsub = null; } if (P.toastTimer) { clearTimeout(P.toastTimer); P.toastTimer = null; } }

    return {
      init, destroy, render, refreshRecent, setEnabled, setMode, setSurface, setFlag, neverShow, unblock, showItem, toast,
      get state() { return P; }
    };
  }

  NS.popup = {
    SITES, SITE_NAMES, HOSTS, RECENT_LIMIT,
    siteFor, todayKey, countsFor, normHandle, humanizeReason, isBlocked, withBlocked, fmtCount, snippet,
    createPopup, instance: null
  };

  // Auto-start in a real popup page (skipped when the page sets <main data-noslop-autoinit="false"> or there is no runtime).
  const b = (typeof browser !== 'undefined' && runtime(browser)) ? browser : (typeof chrome !== 'undefined' && runtime(chrome)) ? chrome : null;
  if (typeof document !== 'undefined' && b) {
    const start = () => {
      const root = document.getElementById('popup');
      if (root && root.getAttribute('data-noslop-autoinit') === 'false') return;
      NS.popup.instance = createPopup(document, b);
      NS.popup.instance.init();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
