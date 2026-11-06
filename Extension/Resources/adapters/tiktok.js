// NoSlop — tiktok.com adapter. Plain classic script; contract: adapters/_template.js, docs/DESIGN.md §4.
//
// Surfaces: For You (/, /foryou), Following (/following), Explore (/explore), Search (/search), video pages
// (/@user/video/<id>) and profiles (/@user). Selectors come from NoSlop.rules.sites.tiktok; every key that
// rules.json lacks (or that the REAL captures in tests/fixtures/tiktok corrected) has a documented fallback in
// FALLBACK below — core is asked (return value `requests`) to merge those into rules.json.
//
// What the REAL captures (tests/fixtures/tiktok/notes.md, 2026-11-02) established:
//   * For You item = article[data-e2e="recommend-list-item-container"]; it holds ONLY the player:
//     [data-e2e="feed-video"] > ... > div#xgwrapper-<n>-<videoId> > video, plus the poster <img alt="<caption>">.
//     Description / author / engagement live in FIXED OVERLAYS outside the article, for the ACTIVE video only:
//     [data-e2e="anchoring-description-layer"] ([data-e2e="video-desc"] with [data-e2e^="desc-span-"] runs and
//     [data-e2e="search-common-link"] hashtag links), [data-e2e="cinema-creator-identity"] ([data-e2e="video-author-avatar"]
//     href="/@handle"), [data-e2e="anchoring-chrome-host"] whose [data-e2e="more-menu-icon"] carries
//     data-more-menu-item-id="<videoId>" — that attribute tells us WHICH article the overlay belongs to.
//   * Explore card = div[data-e2e="explore-item"] > a[href="https://www.tiktok.com/@handle/video/<id>"] with
//     <img alt="<caption> created by <name> with <sound>">.
//   * NO AIGC label element was observable logged out: [data-e2e="aigc-tag"] (rules.json) stays a HYPOTHESIS; the
//     verbatim UI strings from the i18n bundle are "Creator labeled as AI-generated" and "Contains AI-generated media".
//   * Item JSON keys: IsAigc (bool), aigcLabelType (string; "2" seen on a NON-AI item), AIGCDescription, ShowAIGC;
//     moderationAigcLabelType (Stevoisiak GenAI-Blocklist line 4404) was not present in the page source.
//
// Evidence model: a video's evidence (labels, author) arrives from three places at different times — the article
// itself, the overlay (only while active) and the MAIN-world JSON relay (lib/tiktok-main.js, behind
// settings.tiktokJsonRelay, default on). extract() therefore keeps a per-id UNION of everything seen so far and, when
// that union grows, drops the engine's cached verdict for the id so the next pass re-scores (the engine otherwise
// reuses the cached verdict for the whole epoch). Evidence never shrinks, so an item does not un-hide when the overlay
// moves on to the next video.
//
// Hiding: grid pages (explore/search/profile) use display-none. The snap-scrolling For You feed uses collapse-inner —
// the article stays mounted at its slot height, its video is paused+muted (and re-paused if the player restarts it),
// the overlay of a hidden active video is blanked, and the feed auto-advances to the next item (click
// [data-e2e="feed-navigation-next"], else scrollIntoView on the next article).
// Surfaces: settings.surfaces.hideTikTokForYou hides the For You articles and redirects /foryou (and /) to /following.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  const SITE = 'tiktok';
  const RELAY_SOURCE = 'noslop-tiktok';
  const RELAY_SCRIPT = 'lib/tiktok-main.js';
  const KNOWN_MAX = 3000;
  const ADVANCE_THROTTLE_MS = 600;
  const REDIRECT_THROTTLE_MS = 10000;

  const dom = () => NS.dom;
  const engine = () => NS.engine;
  const rulesSite = () => {
    const r = (NS.engine && NS.engine.rules) || NS.rules || {};
    return (r.sites && r.sites[SITE]) || {};
  };
  const rulesLabels = () => {
    const r = (NS.engine && NS.engine.rules) || NS.rules || {};
    return (r.labels && r.labels[SITE]) || {};
  };

  // Fallbacks for keys missing from rules.sites.tiktok. Each line names its source.
  const FALLBACK = {
    item: '[data-e2e="recommend-list-item-container"], [data-e2e="search-card-video"], [data-e2e="user-post-item"]', // rules.json (search/profile UNVERIFIED, Apify 2025-01-29)
    forYouItem: '[data-e2e="recommend-list-item-container"]',        // REAL: fixtures/tiktok/foryou-feed-items.html
    exploreItem: '[data-e2e="explore-item"]',                        // REAL: fixtures/tiktok/explore-items.html (missing from rules.json)
    playerWrapper: '[id^="xgwrapper-"]',                             // REAL: id="xgwrapper-0-7690108568778870047" (missing from rules.json)
    videoLink: 'a[href*="/video/"]',                                 // rules.json; REAL on explore cards
    videoIdRegex: '/video/(\\d+)',                                   // rules.json
    photoLink: 'a[href*="/photo/"]',                                 // UNVERIFIED (photo-mode posts use /photo/<id>)
    overlay: '[data-e2e="anchoring-description-layer"], [data-e2e="anchoring-engagement-vertical"], [data-e2e="cinema-creator-identity"], [data-e2e="anchoring-chrome-host"]', // REAL: fixtures/tiktok/foryou-active-video-overlay.html
    activeMenu: '[data-e2e="more-menu-icon"][data-more-menu-item-id]', // REAL: overlay fixture, value = active videoId
    description: '[data-e2e="video-desc"], [data-e2e="browse-video-desc"], [data-e2e="explore-card-desc"]', // video-desc REAL (overlay fixture); browse-video-desc rules.json; explore-card-desc notes.md (rendered lazily)
    authorLink: '[data-e2e="video-author-avatar"], [data-e2e="explore-card-user-link"]', // video-author-avatar REAL (overlay fixture); explore-card-user-link notes.md
    author: '[data-e2e="video-author-uniqueid"], [data-e2e="video-user-name"], [data-e2e="browse-username"], [data-e2e="explore-card-user-unique-id"]', // rules.json + notes.md
    hashtagLink: '[data-e2e="search-common-link"][href^="/tag/"]',   // REAL: overlay fixture
    feedNext: '[data-e2e="feed-navigation-next"]',                   // REAL: notes.md (observed data-e2e list)
    aigcTag: '[data-e2e="aigc-tag"], [data-e2e="aigc-label"]',       // rules.json — HYPOTHESIS, UNVERIFIED
    ssrJson: '#__UNIVERSAL_DATA_FOR_REHYDRATION__',                  // REAL: notes.md (SSR JSON with IsAigc / aigcLabelType)
    posterImg: 'picture img[alt], img[alt]'                          // REAL: poster <img alt="<caption>"> in both fixtures
  };
  // Verbatim UI strings (notes.md, i18n bundle): the first two are also in rules.labels.tiktok.text.
  const FALLBACK_LABEL_TEXT = ['AI-generated', 'Creator labeled as AI-generated', 'Content labeled as AI-generated', 'Contains AI-generated media'];

  // Keys whose rules.json value is a selector LIST: the fixtures added members rules.json lacks, so use the union.
  const UNION_KEYS = new Set(['item', 'description', 'author', 'authorLink', 'aigcTag']);
  const selCache = new Map();
  function sel(key) {
    const r = rulesSite();
    const v = r[key];
    const fromRules = (typeof v === 'string' && v.trim()) ? v.trim() : '';
    if (!fromRules) return FALLBACK[key];
    if (!UNION_KEYS.has(key)) return fromRules;
    const ck = key + '\u0001' + fromRules;
    let u = selCache.get(ck);
    if (!u) {
      const parts = [];
      for (const p of (fromRules + ', ' + (FALLBACK[key] || '')).split(/\s*,\s*/)) { const t = p.trim(); if (t && !parts.includes(t)) parts.push(t); }
      u = parts.join(', ');
      selCache.set(ck, u);
    }
    return u;
  }
  function itemSelector() {
    const item = sel('item'), explore = sel('exploreItem');
    return item.includes(explore) ? item : item + ', ' + explore;
  }
  function aigcSelector() {
    const l = rulesLabels();
    const fromLabels = Array.isArray(l.selectors) ? l.selectors.filter((s) => typeof s === 'string' && s.trim()).join(', ') : '';
    return fromLabels || sel('aigcTag');
  }
  let labelTextSet = null, labelTextSrc = null;
  function labelTexts() {
    const l = rulesLabels();
    const list = (Array.isArray(l.text) ? l.text : []).concat(FALLBACK_LABEL_TEXT);
    const key = list.join('\u0001');
    if (labelTextSrc !== key) { labelTextSrc = key; labelTextSet = new Set(list.map((s) => String(s).trim().toLowerCase()).filter(Boolean)); }
    return labelTextSet;
  }
  const reCache = new Map();
  function regex(src) {
    let re = reCache.get(src);
    if (!re) { try { re = new RegExp(src, 'i'); } catch (_) { re = /\/video\/(\d+)/i; } reCache.set(src, re); }
    return re;
  }
  function q(root, selector) { try { return root.querySelector(selector); } catch (_) { return null; } }
  function qa(root, selector) { try { return Array.from(root.querySelectorAll(selector)); } catch (_) { return []; } }
  function is(el, selector) { try { return !!(el && el.matches && el.matches(selector)); } catch (_) { return false; } }

  // ------------------------------------------------------------------ surfaces / paths
  function cleanPath(p) { return (String(p || '/').replace(/\/+$/, '') || '/'); }
  function isForYouPath(p) { p = cleanPath(p); return p === '/' || /^\/(?:foryou|for-you)$/i.test(p); }
  function surfaceOf(loc) {
    const p = cleanPath(loc && loc.pathname);
    if (isForYouPath(p) || /^\/following$/i.test(p) || /^\/explore(?:\/|$)/i.test(p)) return 'home';
    if (/^\/search(?:\/|$)/i.test(p)) return 'search';
    if (/\/(?:video|photo)\/\d+/i.test(p)) return 'watch';
    if (/^\/@[^/]+$/.test(p)) return 'profile';
    return 'other';
  }
  function markPage() {
    const html = document.documentElement;
    if (!html) return;
    const v = isForYouPath(location.pathname) ? 'foryou' : surfaceOf(location);
    if (html.getAttribute('data-noslop-tiktok-page') !== v) html.setAttribute('data-noslop-tiktok-page', v);
  }

  // ------------------------------------------------------------------ evidence store (per video id)
  // known: id -> { labels: Map(labelKey -> label), author: {handle,name,id}, promoted: bool }
  const known = new Map();
  function knownFor(id) {
    let k = known.get(id);
    if (!k) {
      k = { labels: new Map(), author: {}, promoted: false, scoredKey: null };
      known.set(id, k);
      while (known.size > KNOWN_MAX) { const first = known.keys().next().value; known.delete(first); }
    }
    return k;
  }
  function labelKey(l) { return l.type + '|' + (l.id || '') + '|' + (l.text || ''); }
  function evidenceKey(k) {
    return [...k.labels.keys()].sort().join(',') + '#' + (k.author.handle || '') + '#' + (k.author.id || '') + '#' + (k.promoted ? 'ad' : '');
  }
  /** Merge fresh evidence into the union; drop the engine's cached verdict when the union grew since the last score. */
  function mergeEvidence(id, labels, author, promoted) {
    const k = knownFor(id);
    for (const l of labels) { const key = labelKey(l); if (!k.labels.has(key)) k.labels.set(key, l); }
    if (author) { for (const f of ['handle', 'name', 'id']) if (author[f] && !k.author[f]) k.author[f] = author[f]; }
    if (promoted) k.promoted = true;
    const key = evidenceKey(k);
    if (k.scoredKey !== null && k.scoredKey !== key) {
      const e = engine();
      if (e && e.running && e.site === SITE) { try { e.cache.delete(SITE + ':' + id); } catch (_) { /* ignore */ } }
    }
    k.scoredKey = key;
    return k;
  }

  // ------------------------------------------------------------------ JSON relay (MAIN world -> here)
  const relay = new Map(); // id -> { aigc: reasonId|null, raw, author, isAd }
  let relayInjected = false, ssrSeeded = false, reprocessTimer = null;

  function relaySettingOn() {
    const e = engine();
    const s = e && e.settings;
    return !s || s.tiktokJsonRelay !== false; // settings flag, default on (request: add tiktokJsonRelay:true to defaults)
  }
  /** Which JSON fields count as a platform label. aigcLabelType alone does NOT (notes.md: "2" seen with IsAigc:false). */
  function aigcReason(j) {
    if (!j || typeof j !== 'object') return null;
    if (j.IsAigc === true || j.isAigc === true) return 'is_aigc';
    const d = j.AIGCDescription != null ? j.AIGCDescription : j.aigcDescription;
    if (typeof d === 'string' && d.trim()) return 'aigc_description';
    const m = j.moderationAigcLabelType;
    if (m != null && String(m) !== '' && String(m) !== '0') return 'moderation_label';
    return null;
  }
  function authorFromJson(j) {
    const a = j && j.author;
    if (!a) return {};
    if (typeof a === 'string') return { handle: dom().handle(a), id: j.authorId ? String(j.authorId) : '' };
    return { handle: dom().handle(a.uniqueId || a.unique_id || ''), name: a.nickname ? String(a.nickname) : '', id: a.id ? String(a.id) : '' };
  }
  function ingestJsonItems(items) {
    let changed = 0, touchedKnown = false;
    for (const j of Array.isArray(items) ? items : []) {
      if (!j || j.id == null || j.id === '') continue;
      const id = String(j.id);
      const info = { aigc: aigcReason(j), author: authorFromJson(j), isAd: !!(j.isAd || j.ad_info || j.adInfo), raw: { aigcLabelType: j.aigcLabelType, moderationAigcLabelType: j.moderationAigcLabelType, IsAigc: j.IsAigc, AIGCDescription: j.AIGCDescription, ShowAIGC: j.ShowAIGC } };
      relay.set(id, info);
      while (relay.size > KNOWN_MAX) { const first = relay.keys().next().value; relay.delete(first); }
      changed++;
      if (known.has(id)) { mergeEvidence(id, info.aigc ? [jsonLabel(info)] : [], info.author, info.isAd); touchedKnown = true; }
    }
    if (touchedKnown) scheduleReprocess(); // ids the engine already scored: their cache entry was dropped above
    return changed;
  }
  function jsonLabel(info) { return { type: 'platform_ai', id: 'tiktok_json', text: 'aigc:' + info.aigc }; }
  function scheduleReprocess() {
    const e = engine();
    if (!e || !e.running || e.site !== SITE || reprocessTimer) return;
    reprocessTimer = setTimeout(() => { reprocessTimer = null; try { e.processNow(document.body); } catch (_) { /* ignore */ } }, 50);
  }
  function onMessage(ev) {
    // jsdom delivers no source/origin; browsers do — reject anything not from this very window.
    if (ev.source && ev.source !== globalThis) return;
    if (ev.origin && ev.origin !== location.origin) return;
    const d = ev.data;
    if (!d || typeof d !== 'object' || d.source !== RELAY_SOURCE || !Array.isArray(d.items)) return;
    if (ingestJsonItems(d.items)) scheduleReprocess();
  }
  try { globalThis.addEventListener('message', onMessage); } catch (_) { /* ignore */ }

  function ensureRelay() {
    if (relayInjected || !relaySettingOn()) return;
    const rt = (globalThis.browser && globalThis.browser.runtime) || (globalThis.chrome && globalThis.chrome.runtime) || null;
    if (!rt || typeof rt.getURL !== 'function') { relayInjected = true; return; } // no extension runtime (tests / webview without resources)
    relayInjected = true;
    try {
      if (document.querySelector('script[data-noslop-tiktok-main]')) return;
      const s = document.createElement('script');
      s.async = false;
      s.setAttribute('data-noslop-tiktok-main', '1');
      s.src = rt.getURL(RELAY_SCRIPT);
      s.addEventListener('load', () => { try { s.remove(); } catch (_) { /* ignore */ } });
      // If the page's CSP blocks extension script URLs the element errors out; the DOM path still works.
      (document.head || document.documentElement).appendChild(s);
    } catch (_) { /* ignore */ }
  }

  /** Seed the relay map from the SSR JSON blob (first batch of items is rendered without a fetch). */
  function seedFromSsr() {
    if (ssrSeeded) return;
    ssrSeeded = true;
    const node = q(document, sel('ssrJson'));
    if (!node) return;
    let json = null;
    try { json = JSON.parse(node.textContent || ''); } catch (_) { return; }
    const found = [];
    const seen = new Set();
    let budget = 20000;
    (function walk(v, depth) {
      if (--budget < 0 || v == null || typeof v !== 'object' || depth > 14 || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
      if ((v.id != null) && ('IsAigc' in v || 'aigcLabelType' in v || 'AIGCDescription' in v || 'moderationAigcLabelType' in v)) found.push(v);
      for (const key in v) { if (Object.prototype.hasOwnProperty.call(v, key)) walk(v[key], depth + 1); }
    })(json, 0);
    if (found.length) ingestJsonItems(found);
  }

  // ------------------------------------------------------------------ active video / overlay
  function activeId() {
    const m = q(document, sel('activeMenu'));
    return m ? String(m.getAttribute('data-more-menu-item-id') || '') : '';
  }
  function articleFor(id) {
    if (!id) return null;
    const w = q(document, '[id^="xgwrapper-"][id$="-' + id + '"]');
    const a = w ? w.closest(sel('forYouItem')) : null;
    if (a) return a;
    const mm = q(document, sel('forYouItem') + ' [data-more-menu-item-id="' + id + '"]');
    return mm ? mm.closest(sel('forYouItem')) : null;
  }
  function activeArticle() { return articleFor(activeId()); }
  function overlayRoots() { return qa(document, sel('overlay')); }

  const overlayHidden = new Set();
  function syncOverlay() {
    const e = engine();
    const a = activeArticle();
    const st = a && e ? e.stateOf(a) : null;
    const shouldHide = !!(st && st.action === 'hide');
    const roots = overlayRoots();
    for (const r of roots) {
      if (shouldHide) { if (!overlayHidden.has(r)) { try { r.style.setProperty('visibility', 'hidden', 'important'); } catch (_) { /* ignore */ } overlayHidden.add(r); } }
      else if (overlayHidden.has(r)) { try { r.style.removeProperty('visibility'); } catch (_) { /* ignore */ } overlayHidden.delete(r); }
    }
    if (!shouldHide) for (const r of overlayHidden) { try { r.style.removeProperty('visibility'); } catch (_) { /* ignore */ } overlayHidden.delete(r); }
  }

  // ------------------------------------------------------------------ extraction helpers
  function videoIdOf(el) {
    const w = is(el, sel('playerWrapper')) ? el : q(el, sel('playerWrapper'));
    if (w) { const m = /^xgwrapper-\d+-(\d+)$/.exec(w.id || ''); if (m) return m[1]; }
    const re = regex(sel('videoIdRegex'));
    for (const a of qa(el, sel('videoLink'))) { const m = re.exec(a.getAttribute('href') || ''); if (m) return m[1]; }
    for (const a of qa(el, sel('photoLink'))) { const m = /\/photo\/(\d+)/.exec(a.getAttribute('href') || ''); if (m) return m[1]; }
    const mm = q(el, '[data-more-menu-item-id]');
    if (mm) return String(mm.getAttribute('data-more-menu-item-id') || '');
    return '';
  }
  function handleFromHref(href) {
    const m = /\/@([A-Za-z0-9_.-]{1,64})(?:[/?#]|$)/.exec(href || '');
    return m ? m[1].toLowerCase() : '';
  }
  /** Explore/search poster alt = "<caption> created by <name> with <sound>" (REAL); For You alt = bare caption (REAL). */
  function parseAlt(alt) {
    const s = String(alt || '').replace(/\s+/g, ' ').trim();
    const m = /^([\s\S]*?)\s*created by (.+?) with ([\s\S]+)$/.exec(s);
    if (m) return { text: m[1].trim(), name: m[2].trim().replace(/^@/, ''), sound: m[3].trim() };
    return { text: s, name: '', sound: '' };
  }
  function posterAlt(el) {
    for (const img of qa(el, sel('posterImg'))) {
      if (img.closest('.noslop-stub, .noslop-badge')) continue;
      if (is(img, '[data-e2e="video-author-avatar"] img, [data-e2e="cinema-creator-avatar"] img')) continue;
      const alt = img.getAttribute('alt') || '';
      if (alt.trim()) return alt;
    }
    return '';
  }
  /** Exact-text platform label anywhere under root EXCEPT inside the caption (a caption saying "AI-generated" is tier-1 disclosure, not a platform label). */
  function labelTextIn(root) {
    if (!root) return '';
    const wanted = labelTexts();
    const doc = root.ownerDocument || document;
    let walker;
    try { walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */); } catch (_) { return ''; }
    const descSel = sel('description');
    let n;
    while ((n = walker.nextNode())) {
      const t = (n.nodeValue || '').trim();
      if (!t || t.length > 64) continue;
      if (!wanted.has(t.toLowerCase())) continue;
      const p = n.parentElement;
      if (p && (p.closest(descSel) || p.closest('.noslop-stub, .noslop-badge'))) continue;
      return t;
    }
    return '';
  }
  function domLabels(roots) {
    const out = [];
    const tagSel = aigcSelector();
    for (const r of roots) {
      if (!r) continue;
      const tag = is(r, tagSel) ? r : q(r, tagSel);
      if (tag) { out.push({ type: 'platform_ai', id: 'tiktok_aigc_tag', text: dom().text(tag) || 'AI-generated' }); return out; } // the tag's own text is not a second label
    }
    for (const r of roots) {
      const t = labelTextIn(r);
      if (t) { out.push({ type: 'platform_ai', id: 'tiktok_label_text', text: t }); break; }
    }
    return out;
  }
  function overlayAuthor(roots) {
    for (const r of roots) {
      const a = is(r, sel('authorLink')) ? r : q(r, sel('authorLink'));
      if (a) { const h = handleFromHref(a.getAttribute('href') || ''); if (h) return { handle: h, name: (q(a, 'img[alt]') && q(a, 'img[alt]').getAttribute('alt')) || '' }; }
      const u = q(r, sel('author'));
      if (u) { const h = dom().handle(dom().text(u)); if (h) return { handle: h }; }
    }
    return {};
  }
  function overlayHashtags(roots) {
    const out = [];
    for (const r of roots) for (const a of qa(r, sel('hashtagLink'))) {
      const m = /\/tag\/([^/?#]+)/.exec(a.getAttribute('href') || '');
      if (m) { try { out.push('#' + decodeURIComponent(m[1]).toLowerCase()); } catch (_) { out.push('#' + m[1].toLowerCase()); } }
    }
    return out;
  }

  // ------------------------------------------------------------------ hide helpers (For You)
  const pinned = new WeakMap(); // article -> { videos: [[video, fn]], minHeight: bool }
  let lastAdvance = 0;
  let io = null;
  function advance(fromEl) {
    const t = Date.now();
    if (t - lastAdvance < ADVANCE_THROTTLE_MS) return false;
    lastAdvance = t;
    const btn = q(document, sel('feedNext'));
    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && typeof btn.click === 'function') { try { btn.click(); adapter._advanced++; return true; } catch (_) { /* ignore */ } }
    let n = fromEl ? fromEl.nextElementSibling : null;
    while (n && !is(n, sel('forYouItem'))) n = n.nextElementSibling;
    if (n && typeof n.scrollIntoView === 'function') { try { n.scrollIntoView({ block: 'start' }); adapter._advanced++; return true; } catch (_) { /* ignore */ } }
    return false;
  }
  function ensureIO() {
    if (io !== null) return io;
    if (typeof globalThis.IntersectionObserver !== 'function') { io = false; return io; }
    try {
      io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting || en.intersectionRatio < 0.5) continue;
          const e = engine();
          const st = e ? e.stateOf(en.target) : null;
          if (st && st.action === 'hide') advance(en.target);
        }
      }, { threshold: [0.5] });
    } catch (_) { io = false; }
    return io;
  }
  function pinVideos(el) {
    const rec = { videos: [], minHeight: false };
    for (const v of qa(el, 'video, audio')) {
      const fn = () => { try { v.muted = true; if (typeof v.pause === 'function') v.pause(); } catch (_) { /* ignore */ } };
      try { v.addEventListener('play', fn); v.addEventListener('playing', fn); } catch (_) { /* ignore */ }
      fn();
      rec.videos.push([v, fn]);
    }
    try {
      const h = el.getBoundingClientRect ? el.getBoundingClientRect().height : 0;
      if (h > 0) { el.style.setProperty('min-height', Math.round(h) + 'px', 'important'); rec.minHeight = true; }
    } catch (_) { /* ignore */ }
    pinned.set(el, rec);
  }
  function unpinVideos(el) {
    const rec = pinned.get(el);
    if (!rec) return;
    for (const [v, fn] of rec.videos) { try { v.removeEventListener('play', fn); v.removeEventListener('playing', fn); } catch (_) { /* ignore */ } }
    if (rec.minHeight) { try { el.style.removeProperty('min-height'); } catch (_) { /* ignore */ } }
    pinned.delete(el);
  }

  // ------------------------------------------------------------------ redirect (hideTikTokForYou)
  let lastRedirect = 0;
  function maybeRedirect() {
    const e = engine();
    const s = e && e.settings;
    if (!s || !s.surfaces || !s.surfaces.hideTikTokForYou) return;
    if (!isForYouPath(location.pathname)) return;
    const t = Date.now();
    if (t - lastRedirect < REDIRECT_THROTTLE_MS) return;
    lastRedirect = t;
    try { adapter._navigate('/following'); } catch (_) { /* ignore */ }
  }

  /** Per-pass housekeeping; the engine calls surfaces() on every processNow (mutations, navigation, 1 s sweep). */
  function tick() {
    markPage();
    seedFromSsr();
    ensureRelay();
    maybeRedirect();
    syncOverlay();
    const e = engine();
    const a = activeArticle();
    if (a && e) { const st = e.stateOf(a); if (st && st.action === 'hide') advance(a); }
  }

  // ------------------------------------------------------------------ adapter
  const adapter = {
    site: SITE,
    navigateEvents: [],
    // The engine watches these attributes: the overlay's data-more-menu-item-id flips when the active video changes,
    // xgwrapper ids change on cell reuse, poster alt/href change when a card is recycled.
    attributeFilter: ['data-more-menu-item-id', 'id', 'alt', 'href'],
    _navigate(url) { try { location.replace(url); } catch (_) { /* ignore */ } },
    _advanced: 0,
    _relay: relay,
    _known: known,
    _ingest: ingestJsonItems,
    _activeId: activeId,

    /** collapse-inner while a snap feed is on the page (For You / Following), display-none for grids. */
    get hideStrategy() { return q(document, sel('forYouItem')) ? 'collapse-inner' : 'display-none'; },

    matches(loc) { return /(^|\.)tiktok\.com$/i.test((loc && loc.hostname) || ''); },

    surface(loc) { try { markPage(); } catch (_) { /* ignore */ } return surfaceOf(loc || location); },

    findItems(root) {
      root = root || document;
      seedFromSsr(); ensureRelay(); // idempotent; must run BEFORE the first batch is scored (surfaces() runs after)
      // A mutation inside the active-video overlay (outside any article) means the active article's evidence changed.
      if (root !== document && root.nodeType === 1) {
        const ov = root.closest ? root.closest(sel('overlay')) : null;
        if (ov) { const a = activeArticle(); return a ? [a] : []; }
      }
      return qa(root, itemSelector());
    },

    extract(el) {
      if (!el || el.nodeType !== 1) return null;
      const id = videoIdOf(el);
      if (!id) return undefined; // skeleton / recycled slot without a player yet (REAL: the third fixture article is empty) -> "pending": the engine keeps the slot's state
      const active = activeId() === id;
      const roots = active ? overlayRoots() : [];
      const forYou = is(el, sel('forYouItem'));

      // text: overlay caption for the active video, else the poster alt (REAL in both layouts), else in-card description
      let text = '';
      let altName = '';
      if (active) { for (const r of roots) { text = dom().text(r, sel('description')); if (text) break; } }
      if (!text) { const parsed = parseAlt(posterAlt(el)); text = parsed.text; altName = parsed.name; }
      if (!text) text = dom().text(el, sel('description'));

      // author
      let author = overlayAuthor(active ? roots.concat([el]) : [el]);
      if (!author.handle) { for (const a of qa(el, sel('videoLink') + ', ' + sel('photoLink'))) { const h = handleFromHref(a.getAttribute('href') || ''); if (h) { author = { handle: h }; break; } } }
      if (!author.handle && surfaceOf(location) === 'profile') author = { handle: handleFromHref(location.pathname) };
      if (altName && !author.name) author.name = altName;

      // labels: DOM (card + overlay when active) + JSON relay; merged into the per-id union
      const labels = domLabels(active ? [el].concat(roots) : [el]);
      const info = relay.get(id);
      let promoted = false;
      if (info) {
        if (info.aigc) labels.push(jsonLabel(info));
        if (info.isAd) promoted = true;
        author = Object.assign({}, info.author.handle ? { handle: info.author.handle } : {}, info.author.name ? { name: info.author.name } : {}, info.author.id ? { id: info.author.id } : {}, author);
      }
      const k = mergeEvidence(id, labels, author, promoted);
      const allLabels = [...k.labels.values()];
      if (k.promoted && !allLabels.some((l) => l.type === 'promoted')) allLabels.push({ type: 'promoted' });

      const tags = new Set(dom().hashtags(text));
      if (active) for (const t of overlayHashtags(roots)) tags.add(t);
      const kind = qa(el, sel('photoLink')).length && !qa(el, sel('videoLink')).length ? 'post' : 'video';
      return {
        id,
        kind,
        surface: (engine() && engine().running && engine().surface) || surfaceOf(location),
        text,
        author: { handle: k.author.handle || '', name: k.author.name || '', id: k.author.id || '' },
        hashtags: [...tags],
        links: dom().links(el),
        labels: allLabels,
        media: ['video'],
        extra: { forYou, active, aigc: info ? info.raw : undefined }
      };
    },

    surfaces() {
      try { tick(); } catch (_) { /* ignore */ }
      return [
        // Visual hide while the redirect to /following is in flight; the html attribute is set by markPage().
        { settingKey: 'hideTikTokForYou', selector: 'html[data-noslop-tiktok-page="foryou"] ' + sel('forYouItem') }
      ];
    },

    hide(el, item, verdict, strategy) {
      if (!is(el, sel('forYouItem'))) return;
      pinVideos(el);
      const o = ensureIO();
      if (o) { try { o.observe(el); } catch (_) { /* ignore */ } }
      if (activeId() === String(item.id)) advance(el);
      syncOverlay();
    },

    unhide(el) {
      unpinVideos(el);
      if (io) { try { io.unobserve(el); } catch (_) { /* ignore */ } }
      syncOverlay();
    }
  };

  NS.adapters.register(adapter);
})();
