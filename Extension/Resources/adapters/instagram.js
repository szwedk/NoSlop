// NoSlop — instagram.com adapter. Plain classic script, no modules.
// Runs in Safari 17+ (iOS/macOS) and Chrome 121+. Contract: adapters/_template.js + docs/DESIGN.md §4.
//
// Selectors come from NoSlop.rules.sites.instagram, which is seeded from
// docs/research/platform-dom-and-ai-labels.md §2.4 (instagram-feed-blocker selectors.ts HEAD 2026-09-26,
// Instagram Purified gist 2025-07-25, uAssets 2026-11-02). Instagram's class names are atomic and
// regenerated per build, so NOTHING here names a class: only landmarks, roles, data-* and href shapes.
//
// Surfaces handled (desktop and the <~767 px mobile-web layout that iOS Safari gets — research §4 says
// `main[role="main"] article` and `[data-pagelet="story_tray"]` still apply there; only the For you /
// Following switch moves into a header OUTSIDE main, which this adapter never relies on):
//   home feed      main[role="main"] article                         -> kind 'post'
//   reels          main [data-virtualized] > *  (each holds a <video>) -> kind 'short', surface 'reels'
//   explore/profile grid tiles  a[href^="/p/"], a[href^="/reel/"] with an <img>, outside any article
//
// Tier-0 signal: Meta's visible label TEXT ("AI info", "Imagined with AI", "AI-generated profile", …;
// research §1.1) matched as a WHOLE text node inside the post (header or under the media), never as a
// substring of the caption. The label's DOM node is UNVERIFIED (research §5 item 1), hence text matching.
//
// LOCALIZED LABELS: Meta localizes the label and the per-language strings are UNVERIFIED (research §1.1),
// so on a non-English Instagram UI the tier-0 path has NO recall — only hashtags / disclosure / accounts
// work. The adapter therefore reads the label list live from rules.labels.instagram.text (plus .profileText
// and sites.instagram.aiInfoText), which `settings.rulesOverride` can extend, so a user can add their own
// locale's string (e.g. "KI-Info") without a code change. The app/popup should expose that list (see the
// adapter's return-value `requests`).
//
// Hide strategy: 'collapse-inner' (rules.sites.instagram.hideStrategy) — the engine keeps the article
// mounted and hides its children (content.css), so the virtualized feed keeps its height bookkeeping
// (research §3: per-article display:none on Instagram's virtualizer is UNVERIFIED; collapse is the safe
// pattern used for X). Every hidden <video> is paused + muted (CSS hiding does not stop playback). On the
// reels surface the adapter additionally advances to the next reel when the hidden reel is the active one
// and settings allow (settings.reelsAutoAdvance !== false).
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  const dom = () => NS.dom;

  // -------------------------------------------------------------- selectors (rules.sites.instagram)
  // Fallbacks are used only when a key is missing from rules.json; each is listed in the adapter's
  // `requests` so core can merge it. [UNVERIFIED] = not from a fetched selector table.
  const FALLBACK = {
    main: 'main[role="main"]',                                   // research §2.4 [2026-code]
    post: 'main[role="main"] article',                           // research §2.4 [2026-code]
    reelsSurface: 'main[role="main"]:has([data-virtualized] video)', // research §2.4 [2026-code]
    reelsItem: 'main [data-virtualized] > *',                    // research §2.4 (data-virtualized marks the reels list)
    reelsVideo: 'main [data-virtualized] video',                 // research §2.4 [2026-code]
    navReelsLink: 'a[href="/reels/"]',                           // research §2.4 nav blocks (href shape)
    authorLink: 'article header a[href^="/"]',                   // research §2.4 [UNVERIFIED]
    postLink: 'a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"]', // research §2.4 explore grid href shapes
    postIdRegex: '/(?:p|reel|reels)/([A-Za-z0-9_-]+)',
    caption: 'article h1, article [dir="auto"]',                 // research §2.4 [UNVERIFIED]
    // [UNVERIFIED] fallbacks not yet in rules.json (requested):
    hashtagLink: 'a[href^="/explore/tags/"]',                    // caption hashtags are rendered as /explore/tags/<tag>/ links
    tile: 'main[role="main"] a[href^="/p/"], main[role="main"] a[href^="/reel/"]', // explore + profile grid tiles
    sponsoredText: ['Sponsored']                                 // ad disclosure line under the username (en only)
  };
  // Top-level path segments that are NOT usernames (a profile href is /<username>/).
  const RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct', 'tv', 'about', 'legal',
    'emails', 'session', 'nametag', 'challenge', 'api', 'graphql', 'ads', 'press', 'privacy', 'terms', 'web', 'oauth',
    'developer', 'linking', 'lite', 'your_activity', 'archive', 'settings', 'notifications', 'search', 'create', 'live']);

  let memo = null;
  function cfg() {
    const rules = (NS.engine && NS.engine.rules) || NS.rules || {};
    const site = (rules.sites && rules.sites.instagram) || {};
    if (memo && memo.site === site && memo.rules === rules) return memo;
    const sel = Object.assign({}, FALLBACK);
    for (const k of Object.keys(FALLBACK)) if (site[k] != null) sel[k] = site[k];
    let idRe = null;
    try { idRe = new RegExp(sel.postIdRegex, 'u'); } catch (_) { idRe = /\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/u; } // shortcodes are case-sensitive: no 'i'
    const labelSet = new Set();
    const li = (rules.labels && rules.labels.instagram) || {};
    for (const list of [li.text, li.profileText, site.aiInfoText]) {
      if (Array.isArray(list)) for (const s of list) { const t = String(s).trim().toLowerCase(); if (t) labelSet.add(t); }
    }
    const profileSet = new Set((Array.isArray(li.profileText) ? li.profileText : ['AI-generated profile']).map((s) => String(s).trim().toLowerCase()));
    const sponsored = new Set((Array.isArray(sel.sponsoredText) ? sel.sponsoredText : FALLBACK.sponsoredText).map((s) => String(s).trim().toLowerCase()));
    memo = { rules, site, sel, idRe, labelSet, profileSet, sponsored };
    return memo;
  }

  function labelId(text) {
    const t = String(text).trim().toLowerCase();
    if (t === 'ai info') return 'instagram_ai_info';
    if (t === 'imagined with ai') return 'instagram_imagined';
    if (t === 'made with ai') return 'instagram_made_with_ai';
    if (t === 'made with meta ai') return 'instagram_meta_ai';
    if (t === 'ai content') return 'instagram_ai_content';
    if (t === 'ai-generated profile') return 'instagram_ai_profile';
    return 'instagram_text'; // localized / user-added string
  }

  // -------------------------------------------------------------- small helpers
  function pathOf(href) {
    if (!href) return '';
    try { return new URL(href, 'https://www.instagram.com/').pathname; } catch (_) { return String(href).split(/[?#]/)[0]; }
  }
  /** "/alice/" -> "alice"; anything reserved or multi-segment -> ''. */
  function profileHandle(href) {
    const p = pathOf(href);
    const parts = p.split('/').filter(Boolean);
    if (parts.length !== 1) return '';
    const seg = parts[0];
    if (RESERVED.has(seg.toLowerCase())) return '';
    if (!/^[A-Za-z0-9_.]{1,64}$/.test(seg)) return '';
    return seg.toLowerCase();
  }
  function postIdFromHref(href, idRe) {
    const p = pathOf(href);
    const m = idRe.exec(p);
    if (!m) return '';
    const id = m[1];
    if (!id || RESERVED.has(id.toLowerCase()) || id.toLowerCase() === 'audio') return '';
    return id;
  }
  function firstPostId(el, c, preferSelf) {
    if (preferSelf && el.getAttribute) { const own = postIdFromHref(el.getAttribute('href'), c.idRe); if (own) return own; }
    let anchors;
    try { anchors = el.querySelectorAll(c.sel.postLink); } catch (_) { anchors = el.querySelectorAll('a[href]'); }
    let reelId = '';
    for (const a of anchors) {
      const id = postIdFromHref(a.getAttribute('href'), c.idRe);
      if (!id) continue;
      if (/^\/p\//.test(pathOf(a.getAttribute('href')))) return id;
      if (!reelId) reelId = id;
    }
    return reelId;
  }
  function inOurs(node) {
    return !!(node.closest && node.closest('.noslop-stub, .noslop-badge'));
  }

  /**
   * Walk text nodes + aria-labels under `root`, skipping the caption (h1) and our own stub/badge, and
   * return [{type:'platform_ai'|'promoted', id, text}] for whole-node matches of the label strings.
   * Exact whole-node matching is what the research recommends ("match an element whose own text IS the
   * label, not a regex over the whole article") and keeps captions that merely mention "AI info" unflagged.
   */
  function findLabels(root, c, opts) {
    const out = [];
    const seen = new Set();
    const skipCaption = !(opts && opts.includeCaption);
    const doc = root.ownerDocument || document;
    const push = (type, raw) => {
      const t = String(raw).trim();
      const key = type + '|' + t.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(type === 'promoted' ? { type: 'promoted', id: 'instagram_sponsored', text: t } : { type: 'platform_ai', id: labelId(t), text: t });
    };
    const consider = (raw) => {
      const t = String(raw || '').trim().toLowerCase();
      if (!t || t.length > 40) return;
      if (c.labelSet.has(t)) push('platform_ai', raw);
      else if (c.sponsored.has(t)) push('promoted', raw);
    };
    const walker = doc.createTreeWalker(root, 5 /* SHOW_ELEMENT | SHOW_TEXT */, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (n.classList && (n.classList.contains('noslop-stub') || n.classList.contains('noslop-badge'))) return 2; // REJECT
          if (skipCaption && n.tagName === 'H1') return 2;
          return 1; // ACCEPT (so aria-labels are inspected)
        }
        return 1;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) consider(n.nodeValue);
      else if (n.hasAttribute && n.hasAttribute('aria-label')) consider(n.getAttribute('aria-label'));
    }
    return out;
  }

  // Profile-page level "AI-generated profile" label (shown on the profile AND alongside the content —
  // creators.instagram.com 2026-08-31, research §1.1). Memoised for 500 ms because extract() runs per tile.
  let profileLabelMemo = { ts: 0, path: '', value: null };
  function profilePageLabel(c) {
    const path = (globalThis.location && location.pathname) || '';
    const t = Date.now();
    if (profileLabelMemo.path === path && t - profileLabelMemo.ts < 500) return profileLabelMemo.value;
    let value = null;
    let main = null;
    try { main = document.querySelector(c.sel.main); } catch (_) { main = null; }
    if (main && surfaceOf(location) === 'profile') {
      // Look at main's direct header region only (everything that is not a grid tile or an article).
      const header = main.querySelector('header') || main;
      const labels = findLabels(header, c, { includeCaption: true }).filter((l) => l.type === 'platform_ai' && c.profileSet.has(String(l.text).toLowerCase()));
      value = labels.length ? labels[0] : null;
    }
    profileLabelMemo = { ts: t, path, value };
    return value;
  }

  // -------------------------------------------------------------- surface
  function surfaceOf(loc) {
    const p = ((loc && loc.pathname) || '/').replace(/\/+$/, '') || '/';
    if (p === '/') return 'home';
    const parts = p.split('/').filter(Boolean);
    const head = (parts[0] || '').toLowerCase();
    if (head === 'reels' || head === 'reel') return 'reels';
    if (head === 'p') return 'watch';
    if (head === 'explore') return 'search';
    if (head === 'direct' || head === 'accounts' || head === 'stories') return 'other';
    if (parts.length >= 1 && profileHandle('/' + parts[0] + '/')) return 'profile'; // /<user>/, /<user>/reels/, /<user>/tagged/
    return 'other';
  }

  // -------------------------------------------------------------- the adapter
  const adapter = {
    site: 'instagram',
    hideStrategy: 'collapse-inner', // rules.sites.instagram.hideStrategy
    navigateEvents: [],

    matches(loc) {
      return /(^|\.)instagram\.com$/i.test((loc && loc.hostname) || '');
    },

    surface(loc) {
      const s = surfaceOf(loc || globalThis.location);
      // Stamp the surface on <html> so the reels-surface selector in surfaces() can be URL-gated in CSS terms
      // (the home feed may also contain [data-virtualized] wrappers with videos; we must never blank it).
      try {
        const h = document.documentElement;
        if (h && h.getAttribute('data-noslop-ig-surface') !== s) h.setAttribute('data-noslop-ig-surface', s);
      } catch (_) { /* ignore */ }
      return s;
    },

    findItems(root) {
      const c = cfg();
      root = root || document;
      const q = (sel) => { try { return root.querySelectorAll(sel); } catch (_) { return []; } };
      const out = [];
      const seen = new Set();
      const add = (el) => { if (el && el.nodeType === 1 && !seen.has(el)) { seen.add(el); out.push(el); } };
      const selfMatches = (sel) => { try { return root.nodeType === 1 && root.matches(sel); } catch (_) { return false; } };
      // keep the <html> surface stamp fresh even when navigation happened without a history event
      try { adapter.surface(globalThis.location); } catch (_) { /* ignore */ }

      // 1. feed posts: main[role="main"] article (home, profile post view, /p/ page)
      if (selfMatches(c.sel.post)) add(root);
      for (const el of q(c.sel.post)) add(el);

      // 2. reels: every child of the virtualized list that holds a <video>
      if (selfMatches(c.sel.reelsItem) && root.querySelector('video')) add(root);
      for (const el of q(c.sel.reelsItem)) { if (el.tagName !== 'ARTICLE' && el.querySelector('video')) add(el); }

      // 3. grid tiles (explore / profile): post links carrying an image, outside any article or reels list
      const tileOk = (a) => !!a.querySelector('img') && !a.closest('article') && !a.closest('[data-virtualized]');
      if (selfMatches(c.sel.tile) && tileOk(root)) add(root);
      for (const a of q(c.sel.tile)) { if (tileOk(a)) add(a); }
      return out;
    },

    extract(el) {
      const c = cfg();
      const D = dom();
      if (!el || el.nodeType !== 1) return null;
      const surface = (NS.engine && NS.engine.running && NS.engine.surface) || surfaceOf(globalThis.location);
      const isTile = el.tagName === 'A';
      const isReel = !isTile && el.tagName !== 'ARTICLE' && !!el.closest('[data-virtualized]');

      // ---- id (stable shortcode from a /p/<id>/ or /reel/<id>/ link; never the element) ----
      let id = firstPostId(el, c, isTile);
      if (!id && isReel) {
        // Fallback: the media URL path is stable per asset (UNVERIFIED whether reel items carry their own link).
        const v = el.querySelector('video');
        const src = v && (v.currentSrc || v.src || v.getAttribute('src') || v.getAttribute('poster'));
        if (src) { try { id = 'media:' + new URL(src, 'https://www.instagram.com/').pathname; } catch (_) { id = 'media:' + src; } }
      }
      // ---- author (profile link: a single-segment href like /alice/) ----
      let handle = '', name = '';
      const header = el.querySelector('header');
      const scope = header || el;
      let anchors;
      try { anchors = scope.querySelectorAll('a[href^="/"]'); } catch (_) { anchors = []; } // rules.sites.instagram.authorLink minus the 'article header' prefix (reels have no <header>)
      for (const a of anchors) {
        const h = profileHandle(a.getAttribute('href'));
        if (!h) continue;
        handle = h;
        const t = (a.textContent || '').trim();
        if (t && !a.querySelector('img')) { name = t; break; }
      }
      if (!handle && surface === 'profile') handle = profileHandle('/' + ((location.pathname || '').split('/').filter(Boolean)[0] || '') + '/');
      if (!id && !isTile && handle) {
        // Fallback for an article without any /p/ link (UNVERIFIED whether every feed article links to itself):
        // author + the header <time datetime> is stable for one post. Never the element.
        const t = el.querySelector('time[datetime]');
        const dt = t && t.getAttribute('datetime');
        if (dt) id = 't:' + handle + ':' + dt;
      }
      if (!id) return null; // loading skeleton / not ready

      // ---- caption text (not the username, not "128 likes") ----
      let text = '';
      const h1 = el.querySelector('h1');
      if (h1) {
        const spans = [];
        h1.querySelectorAll('[dir="auto"]').forEach((s) => { if (!s.closest('a') && !s.querySelector('[dir="auto"]')) spans.push(D.text(s)); });
        text = spans.filter(Boolean).join('\n');
        if (!text) {
          text = D.text(h1);
          if (name && text.startsWith(name)) text = text.slice(name.length).trim();
          else if (handle && text.toLowerCase().startsWith(handle)) text = text.slice(handle.length).trim();
        }
      } else if (!isTile) {
        const parts = [];
        el.querySelectorAll('[dir="auto"]').forEach((s) => {
          if (header && header.contains(s)) return;
          if (s.closest('a') || s.querySelector('[dir="auto"]')) return;
          const t = D.text(s);
          if (!t || c.labelSet.has(t.toLowerCase()) || c.sponsored.has(t.toLowerCase())) return;
          if (handle && t.toLowerCase() === handle) return;
          parts.push(t);
        });
        text = parts.join('\n');
      }

      // ---- labels: platform AI label text + "Sponsored" ----
      const labels = findLabels(el, c);
      if (isTile && surface === 'profile') { const pl = profilePageLabel(c); if (pl) labels.push(pl); }

      // ---- hashtags: caption text + /explore/tags/<tag>/ links ----
      const tags = new Set(D.hashtags(text));
      let tagLinks;
      try { tagLinks = el.querySelectorAll(c.sel.hashtagLink); } catch (_) { tagLinks = []; }
      for (const a of tagLinks) {
        const seg = pathOf(a.getAttribute('href')).split('/').filter(Boolean)[2];
        if (seg) { try { tags.add('#' + decodeURIComponent(seg).toLowerCase()); } catch (_) { tags.add('#' + seg.toLowerCase()); } }
      }

      // ---- media ----
      let media;
      if (el.querySelector('video')) media = ['video'];
      else {
        let img = null;
        el.querySelectorAll('img').forEach((i) => { if (!img && !(header && header.contains(i))) img = i; });
        media = img ? ['image'] : ['none'];
      }

      const kind = isReel ? 'short' : (isTile && /^\/reel\//.test(pathOf(el.getAttribute('href')))) ? 'video' : 'post';
      return {
        id,
        kind,
        surface: isReel ? 'reels' : surface,
        text,
        author: { handle, name: name || handle },
        hashtags: [...tags],
        links: D.links(el),
        labels,
        media,
        extra: { layout: isTile ? 'tile' : isReel ? 'reel' : 'article' }
      };
    },

    surfaces() {
      const c = cfg();
      return [
        // Reels entry points (left nav on desktop, bottom bar on mobile web): research §2.4 nav blocks.
        { settingKey: 'hideReels', selector: c.sel.navReelsLink },
        // The /reels/ page itself (main holding the virtualized video list), URL-gated by the <html> stamp set in surface().
        { settingKey: 'hideReels', selector: 'html[data-noslop-ig-surface="reels"] ' + c.sel.reelsSurface }
      ];
    },

    // Engine already adds .noslop-hidden--collapse-inner and pauses media; here we (a) pause+mute first so we
    // can tell whether the reel was playing, and (b) advance past a hidden ACTIVE reel when settings allow.
    hide(el, item, verdict, strategy) {
      const D = dom();
      let wasPlaying = false;
      el.querySelectorAll('video').forEach((v) => { try { if (!v.paused) wasPlaying = true; } catch (_) { /* ignore */ } });
      D.stopMedia(el);
      if (!item || item.kind !== 'short') return;
      const s = (NS.engine && NS.engine.settings) || {};
      if (s.reelsAutoAdvance === false) return; // requested default: true (see `requests`)
      const activeId = postIdFromHref((globalThis.location && location.pathname) || '', cfg().idRe);
      const active = wasPlaying || (activeId && activeId === item.id);
      if (!active) return;
      let next = el.nextElementSibling;
      while (next && (next.classList.contains('noslop-stub') || !next.querySelector || !next.querySelector('video'))) next = next.nextElementSibling;
      if (next && typeof next.scrollIntoView === 'function') {
        try { next.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (_) { try { next.scrollIntoView(true); } catch (__) { /* ignore */ } }
      }
    },

    unhide(el) {
      // Nothing to restore: the engine removes its classes/stub; media stays paused (Instagram autoplays muted anyway).
      void el;
    },

    // Exposed for tests / the popup: the label strings currently in force (rules + override).
    labelStrings() { return [...cfg().labelSet]; },
    _surfaceOf: surfaceOf
  };

  NS.adapters.register(adapter);
})();
