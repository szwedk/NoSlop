// NoSlop — youtube adapter: www.youtube.com (desktop, ytd-*/yt-lockup-view-model) and m.youtube.com (ytm-*).
// Plain classic script (Safari 17+ iOS/macOS, Chrome 121+); attaches to globalThis.NoSlop and registers itself.
// Contract: adapters/_template.js, docs/DESIGN.md §4. Selectors come from NoSlop.rules.sites.youtube (research tables
// docs/research/platform-dom-and-ai-labels.md §2.2 / §2.3); the few fallbacks below are taken from the REAL 2026-11-02
// captures in tests/fixtures/youtube/notes.md and tests/fixtures/myoutube/notes.md and are listed under `requests`
// so core can merge them into rules.json.
//
// Signals (tier 0 = platform label, see rules.labels.youtube and docs/research/platform-dom-and-ai-labels.md §1.2):
//   * card badge `.ytBadgeShapeText` / `.badge-shape-wiz__text` whose text is exactly "AI" (or matches badgeRegex) —
//     forward-compatible hook (ai-slop-shield); 0 of ~90 real cards carried it on 2026-11-02.
//   * watch page: `badge-shape[aria-label="AI: Content was made with AI"]` in `ytd-watch-metadata #title` (mobile:
//     `badge-shape[aria-label="AI"]` in ytm-slim-video-metadata-section-renderer) and the
//     how-this-was-made-section-view-model whose BodyHeader is "Made with AI" — NEVER the element's mere presence,
//     because the same section says "Auto-dubbed" for auto-dubbed audio (10 of 27 surveyed pages).
//   * enrich(item): fetch https://www.youtube.com/watch?v=<id> through the host and read the ytInitialData JSON:
//     `"howThisWasMadeSectionViewModel":{ … "bodyHeader":{"content":"Made with AI"} …}` (the bare key also sits in a
//     renderer-name array in some pages' ytcfg, so the object form + body header / help-link is required), the
//     title badge `accessibilityData.label "AI: Content was made with AI"`, plus the owner handle and description.
// Hiding: display-none on the OUTER renderer (ytd-rich-item-renderer, never the inner lockup) so grids keep their
// layout; in #related the yt-lockup-view-model itself is the outer element. The currently playing video is never
// hidden: on the watch surface, in strict mode only, a banner stub is placed above the title (an empty host element
// goes through the normal pipeline so Show / Never show @channel and the verdict cache keep working).
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  const dom = () => NS.dom;

  const MOBILE_HOST = 'm.youtube.com';
  const WATCH_HOST_ATTR = 'data-noslop-watch';
  const WATCH_HOST_CLASS = 'noslop-youtube-watch-host';
  const WATCH_BANNER_LABEL = 'AI-labelled video';
  const NAV_GRACE_MS = 3000;      // after a SPA navigation, wait for yt-navigate-finish (or this long) before trusting watch-page DOM
  const MAX_DESCRIPTION = 2000;
  const ID_RE_SRC = '(?:[?&]v=|/shorts/|/watch/)([A-Za-z0-9_-]{11})'; // = rules.sites.youtube.*.videoIdRegex
  const CONTENT_ID_RE = /(?:^|\s)content-id-([A-Za-z0-9_-]{11})(?:\s|$)/;

  // ---- documented FALLBACKS (not yet in rules.json; see `requests`) -------------------------------------------
  // _src: tests/fixtures/youtube/notes.md + tests/fixtures/myoutube/notes.md (REAL captures 2026-11-02).
  const FALLBACK = {
    desktop: {
      // search Shorts shelf = grid-shelf-view-model > ytm-shorts-lockup-view-model-v2 > ytm-shorts-lockup-view-model
      // (no ytd-rich-item-renderer wrapper, unlike the home shelf); search ads are a top-level ytd-ad-slot-renderer.
      item: 'ytm-shorts-lockup-view-model, ytd-ad-slot-renderer',
      shortsShelf: 'grid-shelf-view-model:has(ytm-shorts-lockup-view-model), ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
      shortsItems: 'ytd-rich-item-renderer:has(a[href^="/shorts/"]), ytd-video-renderer:has(a[href^="/shorts/"]), yt-lockup-view-model:has(a[href^="/shorts/"])',
      // related lockups and channel-page cards have NO channel link: the channel is the first metadata row's text.
      channelName: 'yt-content-metadata-view-model .ytContentMetadataViewModelMetadataRow:first-child .ytContentMetadataViewModelMetadataText, ytd-channel-name #text',
      // exact watch-page badge: badge-shape[role=img][aria-label="AI: Content was made with AI"]; mobile form is "AI".
      badgeAria: 'badge-shape[aria-label^="AI:"], badge-shape[aria-label="AI"]',
      adBadge: '.ytBadgeShapeAd, ad-badge-view-model',
      adSlot: 'ytd-ad-slot-renderer',
      snippet: '.metadata-snippet-text',
      shortsLockupTitle: '.shortsLockupViewModelHostMetadataTitle',
      watchMetadata: 'ytd-watch-metadata',
      watchTitle: '#title h1',
      watchBadgeScope: '#title',
      watchVideoIdAttr: 'video-id',
      howThisWasMadeHeader: 'how-this-was-made-section-view-model .ytwHowThisWasMadeSectionViewModelBodyHeader'
    },
    mobile: {
      item: '',
      shortsShelf: 'ytm-rich-section-renderer:has(grid-shelf-view-model), grid-shelf-view-model:has(ytm-shorts-lockup-view-model)',
      shortsItems: 'ytm-rich-item-renderer:has(a[href^="/shorts/"]), ytm-video-with-context-renderer:has(a[href^="/shorts/"])',
      channelName: 'ytm-badge-and-byline-renderer .ytmBadgeAndBylineRendererItemByline, yt-content-metadata-view-model .ytContentMetadataViewModelMetadataRow:first-child .ytContentMetadataViewModelMetadataText',
      badgeAria: 'badge-shape[aria-label="AI"], badge-shape[aria-label^="AI:"]',
      adBadge: '.ytBadgeShapeAd, ad-badge-view-model',
      adSlot: 'ad-slot-renderer',
      snippet: '',
      shortsLockupTitle: '.shortsLockupViewModelHostMetadataTitle',
      watchMetadata: 'ytm-slim-video-metadata-section-renderer',
      watchTitle: 'h2, .slim-video-information-title',
      watchBadgeScope: '.slim-video-information-inline-badge, ytm-slim-video-information-renderer',
      watchChannel: 'a[href^="/@"], .slim-video-information-channel',
      watchVideoIdAttr: '',
      howThisWasMadeHeader: 'how-this-was-made-section-view-model .ytwHowThisWasMadeSectionViewModelBodyHeader'
    }
  };

  // ---- small helpers ----------------------------------------------------------------------------------------
  const reCache = new Map();
  function re(src, flags) {
    if (!src) return null;
    const key = flags + '/' + src;
    if (reCache.has(key)) return reCache.get(key);
    let r = null;
    try { r = new RegExp(src, flags || 'iu'); } catch (_) { try { r = new RegExp(src, (flags || 'iu').replace('u', '')); } catch (__) { r = null; } }
    reCache.set(key, r);
    return r;
  }
  function join() { return Array.prototype.filter.call(arguments, (s) => s && String(s).trim()).join(', '); }
  function safeMatches(el, sel) { try { return !!(sel && el && el.matches && el.matches(sel)); } catch (_) { return false; } }
  function safeQuery(root, sel) { try { return sel ? root.querySelector(sel) : null; } catch (_) { return null; } }
  function safeQueryAll(root, sel) { try { return sel ? Array.from(root.querySelectorAll(sel)) : []; } catch (_) { return []; } }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function textOf(el) { return el ? clean(dom().text(el)) : ''; }

  function location_() { return globalThis.location || { hostname: '', pathname: '/', search: '' }; }
  function isMobile(loc) { return ((loc || location_()).hostname || '') === MOBILE_HOST; }
  function siteRules() { return (NS.rules && NS.rules.sites && NS.rules.sites.youtube) || {}; }
  function labelRules() { return (NS.rules && NS.rules.labels && NS.rules.labels.youtube) || {}; }
  let cfgMemo = null;
  function cfg(loc) {
    const mobile = isMobile(loc);
    const r = siteRules();
    const site = (mobile ? r.mobile : r.desktop) || {};
    if (cfgMemo && cfgMemo.site === site && cfgMemo.mobile === mobile) return cfgMemo;
    // rules.json (sites.youtube.<desktop|mobile>) wins over the documented FALLBACK for every key it defines
    // (except `item`, which is always the union via itemSelector()); FALLBACK fills what rules lack.
    const base = mobile ? FALLBACK.mobile : FALLBACK.desktop;
    const fb = Object.assign({}, base);
    for (const k of Object.keys(base)) { if (k !== 'item' && typeof site[k] === 'string' && site[k].trim()) fb[k] = site[k]; }
    cfgMemo = { mobile, site, fb };
    return cfgMemo;
  }
  function itemSelector(c) { return join(c.site.item, c.fb.item); }
  function settings() { return (NS.engine && NS.engine.settings) || null; }
  function modeIsStrict() {
    const s = settings();
    return !!(s && s.enabled !== false && s.sites && s.sites.youtube && s.sites.youtube.mode === 'strict');
  }
  function currentSurface() {
    return (NS.engine && NS.engine.running && NS.engine.surface) ? NS.engine.surface : adapter.surface(location_());
  }

  function videoIdFrom(href, c) {
    if (!href) return '';
    const r = re(c.site.videoIdRegex || ID_RE_SRC, 'i') || re(ID_RE_SRC, 'i');
    const m = r.exec(String(href));
    return m ? m[1] : '';
  }
  function videoIdFromLocation(loc) {
    loc = loc || location_();
    let id = '';
    try { id = new URLSearchParams(loc.search || '').get('v') || ''; } catch (_) { id = ''; }
    if (!id) id = videoIdFrom((loc.pathname || '') + (loc.search || ''), cfg(loc));
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  }
  function contentId(el) {
    // `content-id-<videoId>` on .ytLockupViewModelHost (fixtures notes: "Video id is available without parsing hrefs").
    const probe = (node) => { const m = node && typeof node.className === 'string' ? CONTENT_ID_RE.exec(node.className) : null; return m ? m[1] : ''; };
    return probe(el) || probe(safeQuery(el, '[class*="content-id-"]'));
  }

  // ---- SPA navigation bookkeeping (stale watch-page DOM guard) -------------------------------------------------
  const nav = { pending: false, at: 0, hooked: false };
  function hookNav() {
    if (nav.hooked || typeof globalThis.addEventListener !== 'function') return;
    nav.hooked = true;
    const start = () => { nav.pending = true; nav.at = Date.now(); };
    const finish = () => { nav.pending = false; };
    for (const ev of ['noslop:navigate', 'popstate', 'yt-navigate-start']) globalThis.addEventListener(ev, start);
    for (const ev of ['yt-navigate-finish', 'yt-page-data-updated']) globalThis.addEventListener(ev, finish);
  }
  function navSettled() { return !nav.pending || (Date.now() - nav.at) > NAV_GRACE_MS; }

  // ---- extraction pieces --------------------------------------------------------------------------------------
  function isAdElement(el, c) {
    if (safeMatches(el, c.fb.adSlot) || safeQuery(el, c.fb.adSlot)) return true;
    if (c.mobile && safeMatches(el, c.site.ads)) return true;
    if (safeQuery(el, c.fb.adBadge)) return true;
    return false;
  }

  function titleOf(el, c) {
    const t = textOf(safeQuery(el, c.site.title)) || textOf(safeQuery(el, c.fb.shortsLockupTitle));
    return t;
  }

  function authorOf(el, c) {
    const out = { handle: '', name: '', id: '' };
    const anchors = safeQueryAll(el, join(c.site.channel, 'a[href^="/@"]', 'a[href^="/channel/"]'));
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      let m;
      if (!out.handle && (m = /^(?:https?:\/\/[^/]+)?\/@([^/?#]+)/.exec(href))) out.handle = decodeURIComponentSafe(m[1]);
      else if (!out.id && (m = /^(?:https?:\/\/[^/]+)?\/channel\/(UC[A-Za-z0-9_-]{21,})/.exec(href))) out.id = m[1];
      if (!out.name) { const t = clean(a.textContent); if (t && t.length <= 100 && !/^go to channel/i.test(t)) out.name = t; }
    }
    if (!out.name) {
      const n = safeQuery(el, c.fb.channelName);
      const t = clean(n && n.textContent).split(/\s*[•·]\s*/)[0];
      // channel pages omit the channel row, so the first metadata text is the view count there — never a name
      if (t && t.length <= 100 && !/^[\d.,]+\s*[KMB]?$/i.test(t) && !/\b(?:views?|watching|ago)\b/i.test(t)) out.name = t;
    }
    if (!out.handle && !out.id && currentSurface() === 'profile') {
      // channel pages omit the channel link inside their own cards (channel-rich-item-renderer.html): take it from the URL
      const m = /^\/@([^/?#]+)/.exec(location_().pathname || '');
      if (m) out.handle = decodeURIComponentSafe(m[1]);
    }
    const a = {};
    if (out.handle) a.handle = out.handle;
    if (out.name) a.name = out.name;
    if (out.id) a.id = out.id;
    return a;
  }
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }

  function pushLabel(labels, label) {
    if (!labels.some((l) => l.type === label.type && (l.id || '') === (label.id || ''))) labels.push(label);
  }

  /** Platform AI labels inside `scope` (badge text / aria form) + how-this-was-made headers inside `sectionScope`. */
  function labelsOf(scope, sectionScope, c, extra) {
    const lr = labelRules();
    const labels = [];
    const badgeTexts = new Set((lr.badgeText || ['AI']).map((s) => String(s).trim().toLowerCase()));
    const badgeRe = re(lr.badgeRegex, 'iu');
    const dubRe = re(lr.autoDubExclude, 'iu');
    const watchTexts = new Set((lr.watchText || []).map((s) => String(s).trim().toLowerCase()));
    if (scope) {
      // rules.sites.youtube.<mode>.badge: '.ytBadgeShapeText, .badge-shape-wiz__text' (desktop) — ai-slop-shield recipe
      for (const b of safeQueryAll(scope, c.site.badge)) {
        const t = clean(b.textContent);
        if (!t || t.length > 80) continue;
        if (dubRe && dubRe.test(t)) { extra.autoDubbed = true; continue; }
        if (badgeTexts.has(t.toLowerCase()) || (badgeRe && badgeRe.test(t))) pushLabel(labels, { type: 'platform_ai', id: 'youtube_badge', text: t });
      }
      for (const b of safeQueryAll(scope, c.fb.badgeAria)) {
        const t = clean(b.getAttribute('aria-label'));
        if (dubRe && dubRe.test(t)) { extra.autoDubbed = true; continue; }
        pushLabel(labels, { type: 'platform_ai', id: 'youtube_badge', text: t });
      }
    }
    if (sectionScope) {
      for (const h of safeQueryAll(sectionScope, c.fb.howThisWasMadeHeader)) {
        const t = clean(h.textContent);
        if (!t) continue;
        if (dubRe && dubRe.test(t)) { extra.autoDubbed = true; continue; }
        if (watchTexts.has(t.toLowerCase()) || /made with ai/i.test(t) || (badgeRe && badgeRe.test(t))) pushLabel(labels, { type: 'platform_ai', id: 'youtube_watch', text: t });
      }
    }
    return labels;
  }

  // ---- watch-page banner host ----------------------------------------------------------------------------------
  function watchContainer(c) { return safeQuery(document, c.fb.watchMetadata); }
  function relabelStub(host) {
    const lbl = host && host.querySelector(':scope > .noslop-stub .noslop-stub__label');
    if (lbl && lbl.textContent !== WATCH_BANNER_LABEL) lbl.textContent = WATCH_BANNER_LABEL;
  }
  /** Create / remove the empty banner host above the title; returns it when it should be processed. */
  function ensureWatchHost(c) {
    let host = safeQuery(document, '[' + WATCH_HOST_ATTR + ']');
    const wanted = currentSurface() === 'watch' && modeIsStrict();
    if (!wanted) { if (host) host.remove(); return null; }
    const container = watchContainer(c);
    if (!container) { if (host) host.remove(); return null; }
    if (host && host.parentElement !== container) { host.remove(); host = null; }
    if (!host) {
      host = document.createElement('div');
      host.className = WATCH_HOST_CLASS;
      host.setAttribute(WATCH_HOST_ATTR, '1');
      host.setAttribute('role', 'presentation');
      container.insertBefore(host, container.firstChild);
    }
    return host;
  }
  function extractWatch(host, c) {
    const container = host.parentElement;
    if (!container || currentSurface() !== 'watch' || !modeIsStrict()) return null;
    const id = videoIdFromLocation();
    if (!id) return null;
    // Stale-DOM guards: right after a SPA navigation the metadata still shows the previous video for a moment
    // (that would cache the previous video's label under the new id). Desktop stamps ytd-watch-metadata[video-id].
    if (!navSettled()) return null;
    const attrId = c.fb.watchVideoIdAttr ? container.getAttribute(c.fb.watchVideoIdAttr) : '';
    if (attrId && attrId !== id) return null;
    relabelStub(host);
    const extra = { videoId: id, watchPage: true, mobile: c.mobile };
    const badgeScope = safeQuery(container, c.fb.watchBadgeScope) || container;
    const labels = labelsOf(badgeScope, document, c, extra);
    const title = textOf(safeQuery(container, c.fb.watchTitle));
    // The banner reacts to platform labels and explicit hashtags only: the description is NOT fed to the scorer as
    // text here (a description that merely talks about AI would dim the banner host in strict mode). Cards still get
    // the description through enrich().
    const description = c.mobile ? '' : textOf(safeQuery(container, c.site.description)).slice(0, MAX_DESCRIPTION);
    const text = '';
    if (description) extra.description = description.slice(0, 300);
    // rules channelWatch: 'ytd-watch-metadata a[href^="/@"], ytd-video-owner-renderer a[href^="/@"]' (ai-slop-shield);
    // mobile: the owner row text is "@handle" (.slim-video-information-channel, myoutube/notes.md).
    const author = authorOf(container, c);
    if (!author.handle) {
      const ch = safeQuery(container, c.fb.watchChannel);
      const m = /^@([^/?#\s]+)$/.exec(clean(ch && ch.textContent));
      if (m) author.handle = decodeURIComponentSafe(m[1]);
    }
    return {
      id, kind: 'video', surface: 'watch', title, text, author,
      hashtags: dom().hashtags(title + ' ' + description),
      links: ['https://www.youtube.com/watch?v=' + id],
      labels, media: ['video'], extra
    };
  }

  // ---- watch-HTML parser (enrich) ------------------------------------------------------------------------------
  const SECTION_KEY = '"howThisWasMadeSectionViewModel":{'; // object form only (innertube-snippets.json: falsePositive_rendererNameList)
  const BADGE_KEY = '"metadataBadgeRenderer":{';
  // The badge scan must not run into the related / watch-next renderers of the same JSON: a card-level AI badge on a
  // RELATED video (forward-compatible hook, none exist today) would otherwise be attributed to the video being enriched.
  const SECONDARY_KEYS = ['"secondaryResults"', '"watchNextEndScreenRenderer"'];
  function primaryRegionEnd(html) {
    let end = html.length;
    for (const k of SECONDARY_KEYS) { const i = html.indexOf(k); if (i !== -1 && i < end) end = i; }
    return end;
  }
  const HELP_AI = 'answer/15447836';     // "Understanding 'How this content was made' disclosures" (language-independent)
  const HELP_AUTODUB = 'answer/15569972'; // auto-dubbed audio help article (innertube-snippets.json autoDubbed_NOT_AI)
  function unescapeJson(s) { try { return JSON.parse('"' + s + '"'); } catch (_) { return String(s).replace(/\\\//g, '/'); } }
  function jsonString(src, key) {
    const m = new RegExp('"' + key + '":"((?:[^"\\\\]|\\\\.)*)"').exec(src);
    return m ? unescapeJson(m[1]) : '';
  }

  /** Parse a www.youtube.com/watch HTML document into a partial Item (labels/author/text/extra) or null. Pure. */
  function parseWatchHtml(html, item) {
    if (!html || typeof html !== 'string') return null;
    const lr = labelRules();
    const dubRe = re(lr.autoDubExclude, 'iu');
    const badgeRe = re(lr.badgeRegex, 'iu');
    const watchTexts = new Set((lr.watchText || []).map((s) => String(s).trim().toLowerCase()));
    const labels = [];
    const extra = { enriched: 'watch-html', autoDubbed: false };

    let idx = 0;
    while ((idx = html.indexOf(SECTION_KEY, idx)) !== -1) {
      const win = html.slice(idx, idx + 3000);
      const header = jsonString(win, 'bodyHeader":\\{"content');
      const isDub = (dubRe && header && dubRe.test(header)) || win.indexOf(HELP_AUTODUB) !== -1;
      if (isDub) extra.autoDubbed = true;
      else if (win.indexOf(HELP_AI) !== -1 || (header && (watchTexts.has(header.toLowerCase()) || /made with ai/i.test(header) || (badgeRe && badgeRe.test(header))))) {
        pushLabel(labels, { type: 'platform_ai', id: 'youtube_watch', text: header || 'Made with AI' });
      }
      idx += SECTION_KEY.length;
    }
    idx = 0;
    const badgeEnd = primaryRegionEnd(html);
    while ((idx = html.indexOf(BADGE_KEY, idx)) !== -1 && idx < badgeEnd) {
      const win = html.slice(idx, idx + 600);
      const label = jsonString(win, 'label');
      const acc = /"accessibilityData":\{"label":"((?:[^"\\]|\\.)*)"/.exec(win);
      const accText = acc ? unescapeJson(acc[1]) : '';
      const isAi = (label && (label.trim().toLowerCase() === 'ai' || (badgeRe && badgeRe.test(label)))) || /^AI: /.test(accText) || (badgeRe && accText && badgeRe.test(accText));
      if (isAi && !(dubRe && (dubRe.test(label) || dubRe.test(accText)))) pushLabel(labels, { type: 'platform_ai', id: 'youtube_badge', text: accText || label });
      idx += BADGE_KEY.length;
    }

    // owner (ytInitialPlayerResponse.microformat first: unique to this video; videoOwnerRenderer as fallback)
    const author = {};
    const have = (item && item.author) || {};
    let m = /"ownerProfileUrl":"[^"]*?\\?\/@((?:[^"\\\/]|\\.)+)"/.exec(html);
    if (!m) {
      const oi = html.indexOf('"videoOwnerRenderer":{');
      if (oi !== -1) m = /"canonicalBaseUrl":"\\?\/@((?:[^"\\\/]|\\.)+)"/.exec(html.slice(oi, oi + 4000));
    }
    if (m && !have.handle) author.handle = decodeURIComponentSafe(unescapeJson(m[1]));
    const name = jsonString(html, 'ownerChannelName');
    if (name && !have.name) author.name = name;
    const cid = jsonString(html, 'externalChannelId') || jsonString(html, 'channelId');
    if (cid && /^UC[A-Za-z0-9_-]{21,}$/.test(cid) && !have.id) author.id = cid;
    const desc = jsonString(html, 'shortDescription');
    const text = desc ? desc.slice(0, MAX_DESCRIPTION) : '';

    const partial = { labels, extra };
    if (Object.keys(author).length) partial.author = author;
    if (text) {
      partial.hashtags = dom().hashtags(text);
      // the watch-page banner host never scores description prose (see extractWatch); cards do
      if (!(item && item.extra && item.extra.watchPage)) partial.text = text;
    }
    return partial;
  }

  const inflight = new Map(); // videoId -> Promise (dedupes concurrent card + banner enrich for one id)
  let surfacesMemo = null;
  // `app=desktop` is YouTube's own "Desktop site" switch: an iPhone Safari UA (fetch cannot set User-Agent) is otherwise
  // 302-redirected to m.youtube.com, whose watch HTML carries no howThisWasMadeSectionViewModel / badge JSON
  // (tests/live/REPORT.md). Without persist_app it does not change the user's m.youtube.com preference.
  const WATCH_URL = (id) => 'https://www.youtube.com/watch?v=' + encodeURIComponent(id) + '&app=desktop';

  // ---- the adapter --------------------------------------------------------------------------------------------
  const adapter = {
    site: 'youtube',
    hideStrategy: 'display-none', // rules.sites.youtube.hideStrategy
    navigateEvents: ['yt-navigate-finish', 'yt-page-data-fetched'], // rules.sites.youtube.*.navigateEvents (CPY page.js)
    attributeFilter: ['href'],   // a reused card changes its link; everything else is childList (yt-lockup re-renders)

    matches(loc) {
      const host = (loc && loc.hostname) || '';
      return /^(?:www\.|m\.)?youtube\.com$/i.test(host);
    },

    surface(loc) {
      const p = ((loc || location_()).pathname) || '/';
      if (p === '/' || p === '' || p.startsWith('/feed/')) return 'home';
      if (p.startsWith('/results')) return 'search';
      if (p.startsWith('/watch')) return 'watch';
      if (p.startsWith('/shorts/')) return 'shorts';
      if (/^\/(?:@|channel\/|c\/|user\/)/.test(p)) return 'profile';
      return 'other';
    },

    findItems(root) {
      hookNav();
      const doc = globalThis.document;
      root = root || doc;
      const c = cfg();
      const sel = itemSelector(c);
      const out = [];
      const seen = new Set();
      const push = (el) => { if (el && !seen.has(el)) { seen.add(el); out.push(el); } };
      const outermost = (el) => { let t = el; for (;;) { const p = t.parentElement && t.parentElement.closest(sel); if (!p) return t; t = p; } };
      if (root.nodeType === 1) {
        // a mutation inside a card (yt-lockup-view-model re-rendered "from scratch") must re-process its OUTER renderer
        let anc = null;
        try { anc = root.closest(sel); } catch (_) { anc = null; }
        if (anc) push(outermost(anc));
      }
      for (const el of safeQueryAll(root, sel)) {
        if (el.hasAttribute(WATCH_HOST_ATTR)) continue;
        const p = el.parentElement;
        let nested = false;
        try { nested = !!(p && p.closest(sel)); } catch (_) { nested = false; }
        if (!nested) push(el);
      }
      const host = ensureWatchHost(c);
      if (host && (root === doc || root === doc.body || root === host || (root.contains && root.contains(host)) || root === host.parentElement)) push(host);
      return out;
    },

    extract(el) {
      if (!el || el.nodeType !== 1) return null;
      const c = cfg();
      if (el.hasAttribute(WATCH_HOST_ATTR)) return extractWatch(el, c);
      const extra = { mobile: c.mobile };
      const ad = isAdElement(el, c);
      const link = safeQuery(el, c.site.videoLink || 'a[href*="/watch?v="], a[href^="/shorts/"]');
      const href = link ? (link.getAttribute('href') || '') : '';
      const id = contentId(el) || videoIdFrom(href, c);
      if (!id) return null; // skeleton / empty lockup / non-video card (playlist, channel, post)
      extra.videoId = id;
      const isShort = /\/shorts\//.test(href) || safeMatches(el, 'ytm-shorts-lockup-view-model') || !!safeQuery(el, 'ytm-shorts-lockup-view-model');
      const kind = ad ? 'ad' : isShort ? 'short' : 'video';
      const title = titleOf(el, c);
      const snippet = textOf(safeQuery(el, c.fb.snippet));
      const text = snippet;
      const labels = labelsOf(el, el, c, extra);
      if (ad) pushLabel(labels, { type: 'promoted', text: 'Sponsored' });
      const author = authorOf(el, c);
      return {
        id, kind,
        surface: currentSurface(),
        title, text, author,
        hashtags: dom().hashtags(title + ' ' + text),
        links: href ? [absolute(href)] : [],
        labels,
        media: [ad && !href ? 'none' : 'video'],
        extra
      };
    },

    surfaces() {
      const c = cfg();
      if (surfacesMemo && surfacesMemo.c === c) return surfacesMemo.list; // memoized per rules object (runs once per flush / sweep)
      // Every selector is its own entry so an unsupported `:has()` cannot take the others down (engine try/catches each).
      const list = [c.site.shortsShelf, c.fb.shortsShelf, c.site.shortsItems, c.fb.shortsItems];
      const out = [];
      const seen = new Set();
      for (const group of list) for (const sel of String(group || '').split(/,(?![^()]*\))/)) { const s = sel.trim(); if (s && !seen.has(s)) { seen.add(s); out.push({ settingKey: 'hideShorts', selector: s }); } }
      surfacesMemo = { c, list: out };
      return out;
    },

    hide(el, item) {
      if (item && item.extra && item.extra.watchPage) {
        // the engine inserts its stub right after this call; retitle it on the next microtask (never hide the video)
        Promise.resolve().then(() => relabelStub(el));
      }
    },

    /** Prefetch the watch page (default on; settings.youtubePrefetch / youtubePrefetchConcurrency, cached by id by the engine).
     *  A fetch FAILURE (timeout, 429, background asleep, host refused) is rethrown so the engine retries with a backoff
     *  instead of caching a 7-day "no label"; null is returned only after a successful HTML parse found nothing. */
    enrich(item, ctx) {
      if (!item || !item.id || item.kind === 'ad') return null;
      const host = (ctx && ctx.host) || NS.host;
      if (!host || typeof host.fetchText !== 'function') return null;
      const id = String(item.id);
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
      if (inflight.has(id)) return inflight.get(id).then((html) => parseWatchHtml(html, item));
      const p = Promise.resolve().then(() => host.fetchText(WATCH_URL(id), { timeout: 10000 }))
        .then((html) => { if (typeof html !== 'string' || !html) throw new Error('youtube enrich: empty response'); return html; });
      inflight.set(id, p);
      p.then(() => inflight.delete(id), () => inflight.delete(id));
      return p.then((html) => parseWatchHtml(html, item));
    },

    // exposed for tests / other agents
    parseWatchHtml,
    videoIdFrom(href) { return videoIdFrom(href, cfg()); },
    _fallback: FALLBACK,
    _nav: nav
  };

  function absolute(href) {
    try { return new URL(href, 'https://' + ((location_().hostname) || 'www.youtube.com')).href; } catch (_) { return href; }
  }

  NS.adapters.register(adapter);
})();
