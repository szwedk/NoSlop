// NoSlop — reddit.com adapter (new "shreddit" DOM + old.reddit.com). Plain classic script (no modules).
// Contract: adapters/_template.js + docs/DESIGN.md §4. Registers via NoSlop.adapters.register(adapter).
//
// Selectors come from NoSlop.rules.sites.reddit (docs/research/platform-dom-and-ai-labels.md §2.7:
// Greasy Fork 516666 "Reddit Advanced Content Filter" 3.2.0, Greasy Fork 589405 "Shreddit" 0.6.5, uAssets,
// Stevoisiak GenAI-Blocklist line 3855 for `recommendation-source` / the following-feed exclusion) and were
// checked against the REAL server-rendered captures in tests/fixtures/reddit/*.html (notes.md there).
// FALLBACK below mirrors rules.json so the adapter still works under a partial settings.rulesOverride;
// the keys marked [FALLBACK ONLY] are not in rules.json yet and are listed in the agent's `requests`.
//
// What this adapter extracts from one `shreddit-post` / `shreddit-ad-post` (all light-DOM attributes/slots):
//   id        attr `id` (t3_…; ads also carry `post-id`)            -> item.id (stable post id, never the element)
//   title     attr `post-title` (fallback: a[slot="title"] text)
//   body      [slot="text-body"] text (text posts / post detail page)
//   flair     shreddit-post-flair[slot="post-flair"] text, e.g. "Image - ChatGPT", "AI Showcase - Midjourney"
//             -> appended to item.text as its own line so the disclosure / tool-name regexes score it
//                ("AI Video - Midjourney" scores disclosure + tool = dim in balanced, hide in strict);
//             -> emitted as a tier-0 label {type:'platform_ai', id:'reddit_flair'} ONLY when the flair text is
//                exactly one of rules.labels.reddit.flairText ("AI Art", "AI Generated", "AIGC", …): a mod-defined
//                AI flair is an explicit self-label. Bare "AI" is NOT in that list: large subs use it as a TOPIC flair
//                (r/Futurology, r/singularity news posts), so it only reaches the text scorer. Flair is a subreddit
//                convention, not a Reddit-wide label (research §1.5), which is why fuzzy flair matches are left to the
//                text scorer and why the engine never auto-promotes an author on label:reddit_flair.
//   author    attr `author` (handle) + `author-id`; ads: the advertiser (permalink /user/<advertiser>/…)
//   subreddit attr `subreddit-name` / `subreddit-prefixed-name` -> item.extra.subreddit (bare name)
//   media     attr `post-type`: image|gallery|gif -> 'image', video -> 'video', else from the media container
//   kind      shreddit-ad-post (or `promoted` attr / [data-testid="ad-post"]) -> 'ad' (+ label {type:'promoted'}),
//             post-type video -> 'video', else 'post'
//   recommended  attr `recommendation-source` present and not inside the following feed
//                (shreddit-feed[reload-url$="?feed=following"]) -> item.extra.recommended (Stevoisiak rule)
//   "App" account label (automated accounts, research §1.5): an exact "App" text node in the credit bar
//             -> item.extra.accountLabel = 'App' always; emitted as a label {type:'platform_ai', id:'reddit_app_account'}
//             only when settings.sites.reddit.flagAppAccounts === true (rules.labels.reddit._note: opt-in; the label
//             marks automation, not AI content). NOT present in any captured post, so the DOM placement is UNVERIFIED.
//
// Tier-2 subreddit seed list (rules.accounts.reddit.subreddits, Stevoisiak MIT): the scorer applies it on
// item.surface === 'popular' (/r/popular, /r/all — rules.accounts.reddit.appliesTo: nothing there is user-chosen)
// or when item.extra.recommended is set (shreddit-post[recommendation-source], the exact scope of the source rule
// "Recommended posts from AI subreddits"). The "/" home feed mixes the user's JOINED communities with
// recommendations, so a subscriber's own r/MachineLearning posts are left alone there; inside the subreddit itself
// (surface 'other') the list never applies. The verdict is the scorer's: accounts.reddit.score 0.9 -> hide in
// strict, dim in balanced.
//
// Surface map (adapter.surface): "/" , "/?feed=…", "/best|hot|new|top|rising" -> 'home'; "/r/popular", "/r/all" ->
// 'popular'; "?feed=following" -> 'other' (user-chosen subscriptions; Stevoisiak excludes it); "/search" -> 'search';
// "…/comments/<id>…" -> 'watch' (post detail + comments page: the post header is the same shreddit-post);
// "/user/<u>" , "/u/<u>" -> 'profile'; "/r/<sub>" -> 'other'.
//
// Hiding: strategy 'display-none' (rules.sites.reddit.hideStrategy). The feed wraps each post in
// `article` ("Reddit can wrap one shreddit-post in an article: process the outer card once" — 516666), so
// findItems() returns the OUTER article when present: hiding its children hides the whole custom element
// including its shadow-DOM chrome. When a shreddit-post / shreddit-ad-post stands alone (ads sit in a
// faceplate-batch with no article; the post-detail header can too), the engine's child-hiding CSS cannot reach
// the shadow tree (vote bar, header, comment row would stay visible), so stubPlacement() asks the engine to put
// the stub BEFORE the element and hide the host itself (.noslop-hidden--host).
// Comments (`shreddit-comment`) are NOT filtered: no verified selector in the research tables.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  const dom = () => NS.dom;

  // Mirror of rules.json sites.reddit (research §2.7). Used only when rules.sites.reddit is missing a key.
  const FALLBACK = {
    hideStrategy: 'display-none',
    post: 'shreddit-post',
    feed: 'shreddit-feed',
    attrs: {
      title: 'post-title', subredditPrefixed: 'subreddit-prefixed-name', subreddit: 'subreddit-name',
      permalink: 'permalink', contentHref: 'content-href', id: 'id', author: 'author',
      recommendationSource: 'recommendation-source', postType: 'post-type',
      authorId: 'author-id',   // [FALLBACK ONLY] observed on every captured post (fixtures notes.md)
      adPostId: 'post-id',     // [FALLBACK ONLY] shreddit-ad-post (fixtures notes.md)
      adType: 'ad-type',       // [FALLBACK ONLY] shreddit-ad-post, "video" (fixtures notes.md)
      promoted: 'promoted'     // [FALLBACK ONLY] boolean attr on shreddit-ad-post (fixtures notes.md)
    },
    attributeFilter: ['post-title', 'permalink', 'id', 'slot', 'subreddit-name', 'author'],
    slots: {
      title: '[slot="title"]', body: '[slot="text-body"]', comments: '[slot="comment-count"]',
      flair: '[slot="post-flair"], shreddit-post-flair, [slot="flair"]',
      creditBar: '[slot="credit-bar"]',          // [FALLBACK ONLY] author/credit line (fixtures notes.md)
      media: '[slot="post-media-container"]'     // [FALLBACK ONLY] media container (fixtures notes.md)
    },
    ad: 'shreddit-ad-post, [data-testid="ad-post"]',
    recommended: 'shreddit-post[recommendation-source]',
    followingFeed: 'shreddit-feed[reload-url$="?feed=following"]',
    oldReddit: {
      post: '.thing.link', body: '.usertext-body', promoted: '[id^="t3"].promotedlink',
      title: 'a.title', author: 'a.author', subreddit: 'a.subreddit',
      idAttr: 'data-fullname',   // [FALLBACK ONLY] old reddit `div.thing[data-fullname="t3_…"]` (UNVERIFIED, no capture)
      flair: '.linkflairlabel'   // [FALLBACK ONLY] old reddit link flair (UNVERIFIED, no capture)
    }
  };

  let cfgCache = { src: null, cfg: null };
  function rulesObj() {
    const eng = NS.engine;
    return (eng && eng.rules) || NS.rules || {};
  }
  /** Merged selector config: rules.sites.reddit over FALLBACK (deep for attrs/slots/oldReddit). */
  function cfg() {
    const r = rulesObj();
    const site = (r.sites && r.sites.reddit) || null;
    if (cfgCache.src === site && cfgCache.cfg) return cfgCache.cfg;
    const merged = Object.assign({}, FALLBACK, site || {});
    merged.attrs = Object.assign({}, FALLBACK.attrs, (site && site.attrs) || {});
    merged.slots = Object.assign({}, FALLBACK.slots, (site && site.slots) || {});
    merged.oldReddit = Object.assign({}, FALLBACK.oldReddit, (site && site.oldReddit) || {});
    if (!Array.isArray(merged.attributeFilter) || !merged.attributeFilter.length) merged.attributeFilter = FALLBACK.attributeFilter;
    cfgCache = { src: site, cfg: merged };
    return merged;
  }
  function labelsCfg() {
    const r = rulesObj();
    return (r.labels && r.labels.reddit) || {};
  }
  function genericLabelSelectors() {
    const r = rulesObj();
    const g = r.labels && r.labels.generic;
    return (g && Array.isArray(g.selectors) && g.selectors.length) ? g.selectors.join(', ') : '';
  }
  function settingsObj() {
    const eng = NS.engine;
    return (eng && eng.settings) || {};
  }

  function safeMatches(el, sel) {
    try { return !!(el && el.matches && sel && el.matches(sel)); } catch (_) { return false; }
  }
  function safeQuery(el, sel) {
    try { return (el && sel) ? el.querySelector(sel) : null; } catch (_) { return null; }
  }
  function attr(el, name) { return (el && name && el.getAttribute(name)) || ''; }
  function absUrl(href) {
    if (!href) return '';
    try { return new URL(href, globalThis.location && globalThis.location.href ? globalThis.location.href : 'https://www.reddit.com/').href; } catch (_) { return href; }
  }
  function exactIn(text, list) {
    const t = String(text || '').trim().toLowerCase();
    return !!t && (list || []).some((s) => String(s).trim().toLowerCase() === t);
  }

  // ------------------------------------------------------------------ element resolution
  function isPost(el) { return safeMatches(el, cfg().post); }
  function isAd(el) { return safeMatches(el, cfg().ad) || (el && el.hasAttribute && el.hasAttribute(cfg().attrs.promoted)); }
  function isOld(el) { return safeMatches(el, cfg().oldReddit.post); }
  function postSelector() { return cfg().post + ', ' + cfg().ad; }

  /** The element the engine stamps / hides: the wrapping article when there is one, else the post itself. */
  function outerOf(post) {
    const p = post.parentElement;
    if (p && p.tagName === 'ARTICLE') {
      // Only when the article wraps exactly this one post (a multi-post article would be a list, not a card).
      let n = 0;
      for (const c of p.children) { if (isPost(c) || isAd(c)) n++; }
      if (n === 1) return p;
    }
    return post;
  }
  /** From an engine element back to the shreddit post: itself, or its direct shreddit child. */
  function postOf(el) {
    if (!el || el.nodeType !== 1) return null;
    if (isPost(el) || isAd(el)) return el;
    if (el.tagName === 'ARTICLE') {
      for (const c of el.children) { if (isPost(c) || isAd(c)) return c; }
    }
    return null;
  }

  // ------------------------------------------------------------------ extraction helpers
  function mediaOf(post, postType) {
    const t = String(postType || '').toLowerCase();
    if (t === 'image' || t === 'gallery' || t === 'gif') return ['image'];
    if (t === 'video' || t === 'hosted:video' || t === 'rich:video' || t === 'multi_media') return ['video'];
    const c = cfg();
    if (safeQuery(post, 'video, img[slot="poster"]')) return ['video'];
    const mc = safeQuery(post, c.slots.media);
    if (mc && safeQuery(mc, 'img')) return ['image'];
    return ['none'];
  }

  function flairOf(post) {
    const c = cfg();
    const node = safeQuery(post, c.slots.flair);
    return node ? dom().text(node) : '';
  }

  function appLabelOf(post) {
    const labels = labelsCfg().accountLabel;
    if (!Array.isArray(labels) || !labels.length) return '';
    const bar = safeQuery(post, cfg().slots.creditBar);
    if (!bar) return '';
    return dom().hasExactText(bar, labels) ? labels[0] : '';
  }

  function inFollowingFeed(post) {
    const sel = cfg().followingFeed;
    try { return !!(sel && post.closest && post.closest(sel)); } catch (_) { return false; }
  }

  function extractShreddit(el, post) {
    const c = cfg();
    const A = c.attrs;
    const ad = isAd(post);
    const id = attr(post, A.id) || attr(post, A.adPostId);
    if (!id) return null; // loading skeleton / not upgraded yet
    const title = attr(post, A.title) || dom().text(post, c.slots.title);
    const body = dom().text(post, c.slots.body);
    const flair = ad ? '' : flairOf(post);
    const author = attr(post, A.author);
    const postType = attr(post, A.postType) || (ad ? attr(post, A.adType) : '');
    const subreddit = attr(post, A.subreddit);
    const subredditPrefixed = attr(post, A.subredditPrefixed) || (subreddit ? 'r/' + subreddit : '');
    const recommended = !ad && post.hasAttribute(A.recommendationSource) && !inFollowingFeed(post);
    const accountLabel = ad ? '' : appLabelOf(post);

    const labels = [];
    if (ad) labels.push({ type: 'promoted' });
    const L = labelsCfg();
    if (flair && exactIn(flair, L.flairText)) labels.push({ type: 'platform_ai', id: 'reddit_flair', text: flair });
    if (accountLabel) {
      const s = settingsObj();
      const optIn = !!(s.sites && s.sites.reddit && s.sites.reddit.flagAppAccounts);
      if (optIn) labels.push({ type: 'platform_ai', id: 'reddit_app_account', text: accountLabel });
    }
    const gen = genericLabelSelectors();
    if (gen && (safeMatches(post, gen) || safeQuery(post, gen))) labels.push({ type: 'platform_ai', id: 'reddit_generic_attr' });

    const links = [];
    const permalink = attr(post, A.permalink);
    const contentHref = attr(post, A.contentHref);
    if (permalink) links.push(absUrl(permalink));
    if (contentHref) links.push(absUrl(contentHref));

    const text = [body, flair].filter(Boolean).join('\n');
    const media = mediaOf(post, postType);
    return {
      id,
      kind: ad ? 'ad' : (media[0] === 'video' ? 'video' : 'post'),
      surface: NS.engine && NS.engine.surface ? NS.engine.surface : 'other',
      title,
      text,
      author: { handle: author, name: author, id: attr(post, A.authorId) },
      hashtags: dom().hashtags(title + ' ' + body),
      links,
      labels,
      media,
      extra: {
        ui: 'shreddit',
        subreddit,
        subredditPrefixed,
        flair: flair || undefined,
        postType: postType || undefined,
        recommended: recommended || undefined,
        accountLabel: accountLabel || undefined,
        wrapped: el !== post || undefined
      }
    };
  }

  function extractOld(el) {
    const o = cfg().oldReddit;
    let id = attr(el, o.idAttr);
    if (!id) { const raw = attr(el, 'id'); id = raw.replace(/^thing_/, ''); }
    if (!/^t3_/.test(id)) return null;
    const title = dom().text(el, o.title);
    const body = dom().text(el, o.body);
    const flair = dom().text(el, o.flair);
    const author = dom().text(el, o.author);
    const subPrefixed = dom().text(el, o.subreddit);
    const subreddit = subPrefixed.replace(/^\/?r\//i, '').replace(/\/$/, '');
    const ad = safeMatches(el, o.promoted) || el.classList.contains('promotedlink');
    const labels = [];
    if (ad) labels.push({ type: 'promoted' });
    if (flair && exactIn(flair, labelsCfg().flairText)) labels.push({ type: 'platform_ai', id: 'reddit_flair', text: flair });
    const media = safeQuery(el, 'video') ? ['video'] : safeQuery(el, 'img, .thumbnail') ? ['image'] : ['none'];
    return {
      id,
      kind: ad ? 'ad' : 'post',
      surface: NS.engine && NS.engine.surface ? NS.engine.surface : 'other',
      title,
      text: [body, flair].filter(Boolean).join('\n'),
      author: { handle: author, name: author },
      hashtags: dom().hashtags(title + ' ' + body),
      links: dom().links(el).slice(0, 8),
      labels,
      media,
      extra: { ui: 'old', subreddit, subredditPrefixed: subPrefixed, flair: flair || undefined }
    };
  }

  // ------------------------------------------------------------------ adapter
  let hideStrategyOverride = null;
  let attributeFilterOverride = null;
  const adapter = {
    site: 'reddit',
    // Read from rules (rulesOverride-aware) unless a caller assigns a value, as the engine tests do.
    get hideStrategy() { return hideStrategyOverride || cfg().hideStrategy || 'display-none'; },
    set hideStrategy(v) { hideStrategyOverride = v || null; },
    get attributeFilter() { return attributeFilterOverride || cfg().attributeFilter; },
    set attributeFilter(v) { attributeFilterOverride = Array.isArray(v) ? v : null; },
    navigateEvents: [],

    matches(loc) {
      const host = (loc && loc.hostname) || '';
      return /(^|\.)reddit\.com$/i.test(host);
    },

    surface(loc) {
      const p = ((loc && loc.pathname) || '/').replace(/\/+$/, '') || '/';
      const q = (loc && loc.search) || '';
      if (/comments\//.test(p) || /^\/comments\b/.test(p)) return 'watch';
      if (/^\/search\b/.test(p)) return 'search';
      if (/^\/(?:user|u)\/[^/]+/.test(p)) return 'profile';
      if (/[?&]feed=following\b/.test(q)) return 'other';
      if (/^\/r\/(?:popular|all)(?:\/|$)/i.test(p)) return 'popular';
      if (p === '/' || /^\/(?:best|hot|new|top|rising)$/.test(p)) return 'home';
      return 'other';
    },

    findItems(root) {
      root = root || document;
      const sel = postSelector();
      const out = [];
      const seen = new Set();
      const push = (post) => { const o = outerOf(post); if (!seen.has(o)) { seen.add(o); out.push(o); } };
      if (root.nodeType === 1 && (isPost(root) || isAd(root))) push(root);
      let list;
      try { list = root.querySelectorAll(sel); } catch (_) { list = []; }
      for (const p of list) push(p);
      const oldSel = cfg().oldReddit.post;
      if (root.nodeType === 1 && isOld(root) && !seen.has(root)) { seen.add(root); out.push(root); }
      try { root.querySelectorAll(oldSel).forEach((e) => { if (!seen.has(e)) { seen.add(e); out.push(e); } }); } catch (_) { /* ignore */ }
      return out;
    },

    extract(el) {
      if (!el || el.nodeType !== 1) return null;
      const post = postOf(el);
      if (post) return extractShreddit(el, post);
      if (isOld(el)) return extractOld(el);
      return null;
    },

    surfaces() {
      // hideRedditRecommended is not in the settings schema yet (off unless the user opts in via a future toggle).
      return [{ settingKey: 'hideRedditRecommended', selector: cfg().recommended }];
    },

    // A bare shreddit-post / shreddit-ad-post is a shadow host: a stub inside it would be an unslotted light-DOM
    // child (not rendered) and `.noslop-hidden > :not(.noslop-stub)` cannot hide the shadow-rendered chrome, so the
    // engine puts the stub before the element and hides the host itself. The article wrapper keeps the default.
    stubPlacement(el) {
      return (el && el.tagName !== 'ARTICLE' && (isPost(el) || isAd(el))) ? 'before' : 'inside';
    }
  };

  NS.adapters.register(adapter);
})();
