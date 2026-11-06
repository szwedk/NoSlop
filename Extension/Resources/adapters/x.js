// NoSlop — x.com / twitter.com adapter. Plain classic script, no modules.
// Contract: adapters/_template.js + docs/DESIGN.md §4. Registers via NoSlop.adapters.register(adapter).
//
// Selectors come from NoSlop.rules.sites.x (docs/research/platform-dom-and-ai-labels.md §2.1, all [2026-code]
// from insin/control-panel-for-twitter script.js HEAD 2026-10-18 unless noted). FALLBACK below is used only
// when a key is missing from rules.json; every fallback cites its source and is listed in the agent's `requests`
// so core can merge it.
//
// Virtualization (research §3 "X"): the timeline is a virtualized list of absolutely positioned
// [data-testid="cellInnerDiv"] cells (transform: translateY) that are RE-USED while scrolling. Therefore:
//   * the item element is the cell, the item id is the tweet's status id (never the element),
//   * hide strategy is 'collapse-inner' (hide the cell's children, keep the cell mounted — the Control Panel for
//     Twitter `HiddenTweet` recipe, script.js lines ~4346 and ~6314); NEVER display:none the cell,
//   * extract() is cheap and re-run on every mutation so a reused cell gets a fresh verdict (engine §4).
// Mobile (research §2.9): same React DOM in a column layout; CPT detects it from
// getComputedStyle('#layers + div').flexDirection == 'column' (script.js ~8092). Nothing selector-wise differs.
// Logged out (tests/fixtures/x/notes.md): zero [data-testid] elements -> findItems() returns [] and the engine idles.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  const dom = NS.dom;

  // ---------------------------------------------------------------- selectors
  // Fallbacks for keys missing from rules.sites.x. Sources:
  //   [CPT]   insin/control-panel-for-twitter script.js 2026-10-18 (research §2.1 table)
  //   [STEVO] Stevoisiak/GenAI-Blocklist 2026-11-02, docs/research/sources/dl/stevos_list.txt lines 4906-4916
  //   [uBO]   uAssets 2026-11-02 (promoted)
  const FALLBACK = {
    hideStrategy: 'collapse-inner',                                  // research §3 (CPT HiddenTweet recipe)
    primaryColumn: 'div[data-testid="primaryColumn"]',               // [CPT]
    cell: '[data-testid="cellInnerDiv"]',                            // [CPT]
    article: 'article[data-testid="tweet"]',                         // [CPT]
    text: '[data-testid="tweetText"]',                               // [CPT]
    userName: '[data-testid="User-Name"]',                           // [CPT]
    userLink: '[data-testid="User-Name"] a',                         // [CPT] pathname = handle
    socialContext: '[data-testid="socialContext"]',                  // [CPT]
    promoted: '[data-testid="placementTracking"]',                   // [CPT] PROMOTED_TWEET_CONTAINER, [uBO]
    permalink: 'a[href*="/status/"] time',                           // timestamp link (research §3: "permalink")
    statusLink: 'a[href*="/status/"]',
    statusIdRegex: '/status/(\\d+)',
    grokLink: 'a[href^="/i/grok/share/"]',                           // [CPT] hideGrokTweets
    grokSvgPath: 'M12.998 1.94c.18 3.015 1.04 5.156 2.473 6.59 1.433', // [STEVO] 4914 "Tweet with AI label" icon
    grokCommunityLink: 'a[href^="/i/communities/1876728323608338672"]', // [STEVO] 4906
    hashtagLink: '[data-testid="tweetText"] a[href^="/hashtag/"]',   // [STEVO] 4906 (hashtag anchors)
    media: '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], video',
    mobileDetect: '#layers + div',                                   // [CPT] ~8092
    // ---- not yet in rules.json (requested for core to merge) ----
    focalTweet: 'article[data-testid="tweet"][tabindex="-1"]',       // [CPT] 4552/4612 + [STEVO] :not([tabindex="-1"]) — the opened post on /status/ pages
    quoteMarker: 'div[id^="id__"] > div[dir] > span',                // [CPT] getTweetType / getQuotedTweetDetails (~5633): visually hidden "Quote" text; quoted tweet = marker.parentElement.nextElementSibling
    grokProfileLink: 'a[href="/grok"]',                              // [STEVO] 4910 "Posts by or mentioning Grok"
    handleLink: '[data-testid="User-Name"] [tabindex="-1"]',         // [CPT] ~5636: the @handle element inside User-Name
    grokPromoCell: '[data-testid="cellInnerDiv"]:has([data-testid="inlinePrompt-primaryAction"] > [href^="https://grok.com/"])', // [STEVO] 4896 "Top of home feed - Promos for video generation and Grok Build"
    quoteMarkerText: ['Quote', 'Quote Tweet']                        // [CPT] strings table QUOTE / QUOTE_TWEET (English; localized variants may be added via rules)
  };
  // Twitter handles: 1-15 chars [A-Za-z0-9_] (platform rule). Reserved first path segments that are not profiles.
  const HANDLE_RE = /^\/([A-Za-z0-9_]{1,15})(?:\/|$)/;
  const RESERVED = new Set(['home', 'explore', 'search', 'i', 'settings', 'messages', 'notifications', 'compose', 'login', 'signup', 'logout', 'intent', 'hashtag', 'account', 'bookmarks', 'lists', 'jobs', 'communities', 'premium', 'verified', 'tos', 'privacy', 'about', 'download', 'share', 'topics', 'help', 'who_to_follow', 'connect_people', 'grok']);
  const PROFILE_TABS = new Set(['with_replies', 'media', 'likes', 'highlights', 'articles', 'superfollows', 'affiliates', 'lists', 'followers', 'following', 'verified_followers']);
  const COMMUNITY_RE = /\/i\/communities\/(\d+)/;
  const HASHTAG_HREF_RE = /\/hashtag\/([^?#/]+)/;

  let selCache = null, selRules = null;
  function sel() {
    const rules = (NS.engine && NS.engine.rules) || NS.rules || {};
    const site = (rules.sites && rules.sites.x) || {};
    if (selCache && selRules === site) return selCache;
    const out = Object.assign({}, FALLBACK);
    for (const k of Object.keys(site)) { if (site[k] != null && site[k] !== '' && !k.startsWith('_')) out[k] = site[k]; }
    selRules = site; selCache = out;
    return out;
  }
  function labelRules() {
    const rules = (NS.engine && NS.engine.rules) || NS.rules || {};
    return (rules.labels && rules.labels.x) || {};
  }
  function settingsNow() {
    const s = NS.engine && NS.engine.settings;
    if (s) return s;
    return NS.defaultSettings ? NS.defaultSettings() : {};
  }
  /** settings.surfaces.hideGrokPosts (default true per DESIGN §6). Read at extract() time; the engine re-extracts on every settings change. */
  function hideGrokPosts() {
    const s = settingsNow();
    return !(s.surfaces && s.surfaces.hideGrokPosts === false);
  }
  function q(el, selector) { try { return el.querySelector(selector); } catch (_) { return null; } }
  function qa(el, selector) { try { return Array.from(el.querySelectorAll(selector)); } catch (_) { return []; } }
  function pathnameOf(a) {
    try { if (a.pathname) return a.pathname; } catch (_) { /* ignore */ }
    const href = (a.getAttribute && a.getAttribute('href')) || '';
    const m = /^(?:https?:\/\/[^/]+)?(\/[^?#]*)/.exec(href);
    return m ? m[1] : '';
  }

  // ---------------------------------------------------------------- layout (mobile vs desktop)
  let layoutCache = { value: 'unknown', ts: 0 };
  function layout() {
    const t = Date.now();
    if (t - layoutCache.ts < 2000) return layoutCache.value;
    let value = 'unknown';
    try {
      const wrapper = document.querySelector(sel().mobileDetect);
      if (wrapper) {
        const fd = getComputedStyle(wrapper).flexDirection;
        value = fd === 'column' ? 'mobile' : fd ? 'desktop' : 'unknown';
      }
    } catch (_) { value = 'unknown'; }
    layoutCache = { value, ts: t };
    return value;
  }

  // ---------------------------------------------------------------- page / surface
  function page(loc) {
    const p = ((loc && loc.pathname) || '/').replace(/\/+$/, '') || '/';
    if (p === '/' || p === '/home') return 'home';
    if (p.startsWith('/search')) return 'search';
    if (p.startsWith('/explore')) return 'explore';
    if (p.startsWith('/notifications')) return 'notifications';
    if (p.startsWith('/messages')) return 'messages';
    if (p.startsWith('/i/grok')) return 'grok';
    if (p.startsWith('/i/communities')) return 'community';
    if (p.startsWith('/i/lists') || /^\/[A-Za-z0-9_]{1,15}\/lists\//.test(p)) return 'list';
    if (p.startsWith('/i/bookmarks')) return 'bookmarks';
    if (p.startsWith('/i/')) return 'other';
    const m = HANDLE_RE.exec(p);
    if (!m || RESERVED.has(m[1].toLowerCase())) return 'other';
    const rest = p.slice(m[1].length + 1).replace(/^\//, '');
    if (/^status\/\d+/.test(rest)) return 'status';
    if (rest === '' || PROFILE_TABS.has(rest.split('/')[0])) return 'profile';
    return 'other';
  }
  // Item.surface vocabulary is fixed by DESIGN §4 ('home'|'search'|'watch'|'profile'|'reels'|'shorts'|'other');
  // a /status/ page is the single-post view, mapped to 'watch'. page() keeps the finer X-specific name.
  function surface(loc) {
    const pg = page(loc);
    if (pg === 'home' || pg === 'list' || pg === 'community') return 'home';
    if (pg === 'search' || pg === 'explore') return 'search';
    if (pg === 'profile') return 'profile';
    if (pg === 'status') return 'watch';
    return 'other';
  }

  // ---------------------------------------------------------------- text helpers
  /** Tweet text with emoji restored from <img alt> (CPT getQuotedTweetDetails reads IMG.alt the same way). */
  function richText(node) {
    if (!node) return '';
    const parts = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) parts.push(c.nodeValue);
        else if (c.nodeType === 1) {
          const tag = c.nodeName;
          if (tag === 'IMG') parts.push(c.getAttribute('alt') || '');
          else if (tag === 'BR') parts.push('\n');
          else walk(c);
        }
      }
    };
    walk(node);
    return parts.join('').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  }
  /** Exact text-node match of `strings` under root, skipping tweetText subtrees (the label is chrome, not body text)
   *  and the quoted-tweet block (`skipNode`): a human quote-tweeting an AI-labelled post is not posting AI. */
  function hasLabelText(root, strings, skipSel, skipNode) {
    if (!root || !strings || !strings.length) return null;
    const wanted = new Map(strings.map((s) => [String(s).trim().toLowerCase(), String(s)]));
    const doc = root.ownerDocument || document;
    const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
    let n;
    while ((n = walker.nextNode())) {
      const t = (n.nodeValue || '').trim().toLowerCase();
      if (!t || !wanted.has(t)) continue;
      if (skipNode && skipNode.contains(n)) continue;
      if (skipSel && n.parentElement && n.parentElement.closest(skipSel)) continue;
      return wanted.get(t);
    }
    return null;
  }
  function hasSvgPath(root, prefix, skipSel, skipNode) {
    if (!root || !prefix) return false;
    let found = false;
    try {
      root.querySelectorAll('path[d]').forEach((p) => {
        if (found) return;
        if (skipNode && skipNode.contains(p)) return;
        if ((p.getAttribute('d') || '').startsWith(prefix) && !(skipSel && p.closest(skipSel))) found = true;
      });
    } catch (_) { /* ignore */ }
    return found;
  }

  // ---------------------------------------------------------------- tweet structure
  /** The quoted-tweet block inside an article (or null). CPT: the "Quote" marker's parent's next sibling. */
  function quotedBlock(article, S) {
    const markers = qa(article, S.quoteMarker);
    const words = new Set((S.quoteMarkerText || FALLBACK.quoteMarkerText).map((s) => String(s).trim().toLowerCase()));
    for (const m of markers) {
      const t = (m.textContent || '').trim().toLowerCase();
      if (!words.has(t)) continue;
      const block = m.parentElement && m.parentElement.nextElementSibling;
      if (block && q(block, S.userName)) return block;
    }
    // Structural fallback (no marker text match, e.g. another UI language): a second User-Name whose
    // enclosing block does not contain the first one.
    const names = qa(article, S.userName);
    if (names.length < 2) return null;
    let node = names[1];
    while (node && node.parentElement && node.parentElement !== article) {
      if (node.parentElement.contains(names[0])) break;
      node = node.parentElement;
    }
    return node && node !== article && !node.contains(names[0]) ? node : null;
  }
  function inside(node, container) { return !!(container && node && container.contains(node)); }

  function authorFrom(userName, S) {
    const out = { handle: '', name: '' };
    if (!userName) return out;
    const links = qa(userName, 'a[href]');
    for (const a of links) {
      const p = pathnameOf(a);
      const m = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(p);
      if (!m || RESERVED.has(m[1].toLowerCase())) continue;
      if (!out.handle) out.handle = m[1].toLowerCase();
      const t = (a.textContent || '').trim();
      if (t && !t.startsWith('@') && !out.name) out.name = t.replace(/\s+/g, ' ');
    }
    if (!out.handle) {
      // CPT ~5636: the @handle element carries tabindex="-1"
      const h = q(userName, '[tabindex="-1"]');
      const t = h && (h.textContent || '').trim();
      if (t && /^@[A-Za-z0-9_]{1,15}$/.test(t)) out.handle = t.slice(1).toLowerCase();
    }
    return out;
  }

  function statusIdFrom(href, re) {
    const m = re.exec(href || '');
    return m ? m[1] : '';
  }
  function tweetId(article, quoted, S) {
    const re = new RegExp(S.statusIdRegex);
    const textSel = S.text;
    // 1. the timestamp permalink (a[href*="/status/"] > time) outside the quoted block and outside the body text
    for (const t of qa(article, S.permalink)) {
      if (inside(t, quoted) || t.closest(textSel)) continue;
      const a = t.closest('a[href]');
      const id = a && statusIdFrom(a.getAttribute('href'), re);
      if (id) return id;
    }
    // 2. any /status/ link that is not in the body text or the quoted block (e.g. /status/<id>/photo/1)
    for (const a of qa(article, S.statusLink)) {
      if (inside(a, quoted) || a.closest(textSel)) continue;
      const id = statusIdFrom(a.getAttribute('href'), re);
      if (id) return id;
    }
    return '';
  }

  // ---------------------------------------------------------------- adapter
  const adapter = {
    site: 'x',
    hideStrategy: 'collapse-inner', // rules.sites.x.hideStrategy; research §3 (CPT HiddenTweet recipe)
    navigateEvents: [],

    matches(loc) {
      const host = ((loc && loc.hostname) || '').toLowerCase();
      return host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com');
    },

    page,
    surface,
    layout,

    /** Candidate cells. Only cells that contain a tweet article; a root inside a cell yields that cell. */
    findItems(root) {
      const S = sel();
      root = root || document;
      const out = [];
      const seen = new Set();
      const push = (c) => { if (c && !seen.has(c) && q(c, S.article)) { seen.add(c); out.push(c); } };
      if (root.nodeType === 1) {
        const own = root.matches && root.matches(S.cell) ? root : (root.closest ? root.closest(S.cell) : null);
        if (own) push(own);
      }
      for (const c of qa(root, S.cell)) push(c);
      return out;
    },

    extract(el) {
      const S = sel();
      const cell = el.matches && el.matches(S.cell) ? el : (el.closest ? el.closest(S.cell) : el);
      if (!cell) return null;
      const article = q(cell, S.article);
      if (!article) return null;                                   // separators, "Show more", promos, skeletons
      if (article.matches(S.focalTweet)) return null;              // the post the user opened on purpose (CPT/Stevo skip [tabindex="-1"])

      const quoted = quotedBlock(article, S);
      const id = tweetId(article, quoted, S);
      if (!id) return undefined;                                   // no permalink yet (loading): "pending" — the engine keeps the cell's state; never fall back to the element

      // author: first User-Name outside the quoted block
      let userName = null;
      for (const n of qa(article, S.userName)) { if (!inside(n, quoted)) { userName = n; break; } }
      const author = authorFrom(userName, S);

      // body text: first tweetText outside the quoted block
      let textNode = null;
      for (const n of qa(article, S.text)) { if (!inside(n, quoted)) { textNode = n; break; } }
      const text = richText(textNode);
      const quotedTextNode = quoted ? q(quoted, S.text) : null;
      const quotedText = richText(quotedTextNode);
      const quotedAuthor = quoted ? authorFrom(q(quoted, S.userName), S) : null;

      // hashtags: from the text and from X's hashtag anchors (/hashtag/<tag>?src=..., /i/communities/<id>/hashtag/<tag>)
      const tags = new Set(dom.hashtags(text));
      for (const a of qa(article, S.hashtagLink)) {
        if (inside(a, quoted)) continue;
        const m = HASHTAG_HREF_RE.exec(a.getAttribute('href') || '');
        if (m) { try { tags.add('#' + decodeURIComponent(m[1]).toLowerCase()); } catch (_) { tags.add('#' + m[1].toLowerCase()); } }
      }

      // labels
      const labels = [];
      const L = labelRules();
      const promotedWrap = article.closest(S.promoted) || (q(cell, S.promoted) && q(cell, S.promoted).contains(article) ? q(cell, S.promoted) : null);
      if (promotedWrap) labels.push({ type: 'promoted', id: 'x_promoted' });
      // "Made with AI" content-disclosure label (research §1.3; DOM placement UNVERIFIED -> exact text match outside the
      // body text AND outside the quoted block: the quoting author's own content is what is scored)
      const labelTexts = L.text || ['Made with AI'];
      const labelText = hasLabelText(article, labelTexts, S.text, quoted);
      if (labelText) labels.push({ type: 'platform_ai', id: 'x_made_with_ai', text: labelText });
      // The AI-label sparkle icon (Stevoisiak 4914 "Tweet with AI label": path[d^="M12.998 1.94…"])
      const svgPrefix = L.grokSvgPathPrefix || S.grokSvgPath;
      if (hasSvgPath(article, svgPrefix, S.text, quoted)) labels.push({ type: 'platform_ai', id: 'x_ai_icon', text: 'Made with AI' });
      // A label only on the QUOTED post (a human calling out a fake, the canonical critical post on X) is reported as
      // x_ai_quote and gated on hideGrokPosts exactly like x_grok_quote — never as the quoting author's own label.
      const quotedAiLabel = !!(quoted && (hasLabelText(quoted, labelTexts, S.text) || hasSvgPath(quoted, svgPrefix, S.text)));
      if (quotedAiLabel && hideGrokPosts()) labels.push({ type: 'platform_ai', id: 'x_ai_quote', text: 'Made with AI' });

      // Grok signals (gated by settings.surfaces.hideGrokPosts)
      const grokShare = !!q(article, S.grokLink);                                           // CPT hideGrokTweets
      let grokAuthor = false, grokQuoted = false;
      for (const a of qa(article, S.grokProfileLink)) {                                     // Stevoisiak 4910 [href="/grok"]
        if (a.closest(S.text)) continue;                                                     // a plain @grok mention in the body is a human asking Grok
        if (inside(a, quoted)) grokQuoted = true; else if (userName && userName.contains(a)) grokAuthor = true;
      }
      if (!grokQuoted && quotedAuthor && quotedAuthor.handle === 'grok') grokQuoted = true;
      if (!grokAuthor && author.handle === 'grok') grokAuthor = true;
      const grokQuotedShare = !!(quoted && q(quoted, S.grokLink));
      const isGrok = grokShare || grokAuthor || grokQuoted || grokQuotedShare;
      if (isGrok && hideGrokPosts()) {
        const gid = grokShare && !inside(q(article, S.grokLink), quoted) ? 'x_grok_share' : grokAuthor ? 'x_grok_author' : 'x_grok_quote';
        labels.push({ type: 'platform_ai', id: gid, text: 'Grok' });
      }
      let community = '';
      for (const a of qa(article, 'a[href*="/i/communities/"]')) { const m = COMMUNITY_RE.exec(a.getAttribute('href') || ''); if (m) { community = m[1]; break; } }
      const aiCommunity = !!(community && String(L.grokCommunityHref || S.grokCommunityLink || '').includes(community));

      const media = [];
      if (q(article, '[data-testid="tweetPhoto"]')) media.push('image');
      if (q(article, '[data-testid="videoPlayer"], video')) media.push('video');
      if (!media.length) media.push('none');

      const social = dom.text(article, S.socialContext);

      return {
        id,
        kind: promotedWrap ? 'ad' : 'post',
        surface: (NS.engine && NS.engine.running && NS.engine.surface) ? NS.engine.surface : surface(globalThis.location),
        text,
        author,
        hashtags: [...tags],
        links: dom.links(article),
        labels,
        media,
        extra: {
          page: page(globalThis.location),
          layout: layout(),
          socialContext: social || undefined,
          quoted: quoted ? { handle: (quotedAuthor && quotedAuthor.handle) || '', text: quotedText, aiLabel: quotedAiLabel || undefined } : undefined,
          grok: isGrok ? { share: grokShare || grokQuotedShare, author: grokAuthor, quoted: grokQuoted || grokQuotedShare } : undefined,
          community: community || undefined,
          aiCommunity: aiCommunity || undefined
        }
      };
    },

    /** Whole-surface hides. Grok promo cells carry no article, so they are not items; hide their CONTENT (never the cell). */
    surfaces() {
      const S = sel();
      return [
        { settingKey: 'hideGrokPosts', selector: S.grokPromoCell + ' > :not(.noslop-stub)' }
      ];
    },

    // collapse-inner belt-and-braces: content.css already does `.noslop-hidden > :not(.noslop-stub) { display:none }`;
    // the inline style covers hosts where the stylesheet is not injected (WKWebView shim). The cell itself is never
    // display:none and keeps its transform so X's virtualizer bookkeeping stays intact.
    hide(el) {
      for (const c of Array.from(el.children)) {
        if (c.classList && (c.classList.contains('noslop-stub') || c.classList.contains('noslop-badge'))) continue;
        try { c.style.setProperty('display', 'none', 'important'); c.setAttribute('data-noslop-collapsed', '1'); } catch (_) { /* ignore */ }
      }
    },
    unhide(el) {
      for (const c of qa(el, ':scope > [data-noslop-collapsed]')) {
        try { c.style.removeProperty('display'); c.removeAttribute('data-noslop-collapsed'); } catch (_) { /* ignore */ }
      }
    },

    _internal: { sel, page, surface, layout, quotedBlock, richText, hideGrokPosts }
  };

  NS.adapters.register(adapter);
})();
