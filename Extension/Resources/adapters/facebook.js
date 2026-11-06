// NoSlop — facebook.com adapter. Plain classic script, no modules.
// Runs in Safari 17+ (iOS/macOS) and Chrome 121+. Contract: adapters/_template.js, docs/DESIGN.md §4.
//
// Selectors come from NoSlop.rules.sites.facebook (rules.json), whose _src is
// docs/research/platform-dom-and-ai-labels.md §2.5 ("FB - Clean my feeds" v6.5.0, Greasy Fork 552339;
// uAssets filters.txt 2026-11-02; Stevoisiak GenAI-Blocklist). Facebook class names are atomic and
// regenerated per build, so NOTHING here names a class: anchors are roles, aria-* and href shapes.
//
// Feed unit    : div[role="main"] div[aria-posinset]  (preferred)  or  div[role="main"] div[role="article"]
//                (research §2.5 table "Feed unit"; the userscript "picks whichever the page currently uses").
// Virtualized  : div[aria-posinset] > div[data-virtualized]; data-virtualized="true" = off-screen placeholder
//                whose content was unmounted (gf_552339 line 8321) -> extract() returns null (skeleton).
// AI label     : "AI info" (Meta, since 2024-07-01), "Imagined with AI" (Meta AI images), "AI content" (Stevo's
//                list), legacy "Made with AI" — text-matched on the post-header disclosure line, which is what
//                FB Clean my feeds (`matchesDisclosureLabel(name, "aiInfo")`, gf_552339 lines 7855/9219-9230)
//                and Stevo's `[role="button"]:has-text(/(AI info|AI content)/)` do. The exact DOM node is
//                UNVERIFIED on a live page (research §1.1, §5 open item 1).
// Sponsored    : a[href*="/ads/about/"], a[aria-label="Sponsored"], and the uAssets `__cft__[0]=` length rule
//                (research §2.5 "Sponsored"). Only evaluated when settings.surfaces.hideAds is on.
// Hide         : 'height-zero' — collapse the aria-posinset cell with height:0;overflow:hidden, never unmount it
//                (uAssets recipe, research §3 "Facebook"); the engine's content.css does the CSS, hide() below
//                only neutralises inline heights Facebook's virtualizer may have stamped on the cell.
//
// Logged-out facebook.com is a login page with div[role="main"] but no feed (tests/fixtures/facebook/notes.md):
// every selector here requires aria-posinset / role="article", so the login page yields zero items.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  const dom = NS.dom;

  const SITE = 'facebook';

  // ---- documented FALLBACKS (used only when rules.sites.facebook lacks the key; core asked to merge them) ----
  const FALLBACK = {
    // research §2.5 table rows (same strings as rules.json 2026-11-02.1)
    feedUnitPreferred: 'div[role="main"] div[aria-posinset]',
    feedUnit: 'div[role="main"] div[aria-posinset], div[role="main"] div[role="article"]',
    legacyFeedUnit: 'div[data-pagelet^="FeedUnit"], [id^="hyperfeed_story_id_"]',
    virtualized: 'div[data-virtualized]',
    sponsoredLink: 'a[href*="/ads/about/"], a[aria-label="Sponsored"]',
    sponsoredCftRegex: '__cft__\\[0\\]=[-\\w]{290,}',
    disclosureHeaderText: ['Ad', 'AI info', 'Visit Meta AI', 'Try Meta AI'],
    aiInfoButton: '[role="button"]',
    aiInfoText: ['AI info', 'AI content', 'Imagined with AI'],
    metaAiPromoAlt: 'img[alt*="Meta AI"]',
    authorLink: 'h2 a[href], h3 a[href], h4 a[href], strong a[href]',
    postLink: 'a[href*="/posts/"], a[href*="story_fbid="], a[href*="/videos/"], a[href*="/reel/"], a[href*="/photo"]',
    postIdRegex: '(?:/posts/|story_fbid=|/videos/|/reel/|fbid=|/photo/?\\?[^ ]*fbid=)(\\w+)',
    // --- NOT in rules.json yet (listed under `requests` for core) ---
    // Off-screen placeholder: the virtualizer swaps the unit's content for an empty data-virtualized="true" box
    // (gf_552339 line 8321 `div[data-virtualized="true"]`). Treated as a loading skeleton.
    virtualizedPlaceholder: 'div[data-virtualized="true"]',
    // Authored message blocks (gf_552339 line 4550 `authoredContent`, minus comment selectors). data-ad-preview /
    // data-ad-comet-preview="message" is the post body on www.facebook.com; the two data-ad-rendering-role values
    // are the ad/creative bodies. [UNVERIFIED] beyond that script.
    message: '[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-ad-rendering-role="story_message"], [data-ad-rendering-role="creative_body"]',
    // Comments are nested div[role="article"] inside the post article (gf_552339 line 4550 `[role="comment"]`,
    // `[data-commentid]`; aria-label "Comment by …" is [UNVERIFIED]). Label/text matching never looks inside them.
    comment: '[role="article"] [role="article"], [role="comment"], [data-commentid]',
    // Post media: Facebook's auto alt text starts with "May be an image of" / "May be a graphic of" and photos sit in
    // a[href*="/photo"]; profile pictures are <svg><image> or img with the person's name (so they never match).
    // SYNTHETIC selector (not from a research table); only decides media:['image'] vs ['none'].
    imageMedia: 'a[href*="/photo"] img, a[href*="/photos/"] img, img[alt^="May be"]',
    // Hashtags are rendered as links to /hashtag/<tag> (gf_552339 does not model them; shape [UNVERIFIED]).
    hashtagLink: 'a[href*="/hashtag/"]',
    // "Reels and short videos" shelf: a feed unit whose heading links to the bare /reel/ (or /reel/?s=ifu_see_more)
    // path — gf_552339 lines 9138-9145, 9528-9551 (`a[href="/reel/"]`, `s=ifu_see_more`). A single reel post links to
    // /reel/<id> and does NOT match. Needs CSS :has() (Safari 15.4+, Chrome 105+; both inside our floor).
    reelsShelf: 'div[role="main"] div[aria-posinset]:has(a[href="/reel/"]), div[role="main"] div[aria-posinset]:has(a[href^="/reel/?"])',
    // Meta AI branding link on the header disclosure line (gf_552339 `isNewsMetaAICard`: a[aria-label] whose name is
    // the metaAiBrand entry "Visit Meta AI"; the metaAiCopy entry is "Try Meta AI"). Platform promo units that show
    // Meta AI-imagined samples; labelled as platform AI content (id facebook_meta_ai).
    metaAiHeaderText: ['Visit Meta AI', 'Try Meta AI'],
    // Profile-level label shown "alongside their content" (Instagram creators blog 2026-08-31, research §1.1). Only
    // instagram has it in rules.labels; Meta applies labels across apps, so it is honoured here too. [UNVERIFIED on FB]
    profileLabelText: ['AI-generated profile']
  };

  function rules() { return (NS.rules && NS.rules.sites && NS.rules.sites[SITE]) || {}; }
  function labelRules() { return (NS.rules && NS.rules.labels && NS.rules.labels[SITE]) || {}; }
  function sel(key) { const r = rules(); const v = r[key]; return (typeof v === 'string' && v) ? v : FALLBACK[key]; }
  function list(key) { const r = rules(); const v = r[key]; return Array.isArray(v) && v.length ? v : FALLBACK[key]; }

  let compiled = null; // { rulesRef, postIdRe, cftRe, aiTexts, ... } recompiled when rules object identity changes
  function cfg() {
    const r = rules();
    if (compiled && compiled.rulesRef === r) return compiled;
    const lower = (arr) => arr.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    const labelTexts = Array.isArray(labelRules().text) && labelRules().text.length ? labelRules().text : FALLBACK.aiInfoText;
    compiled = {
      rulesRef: r,
      unitPreferred: sel('feedUnitPreferred'),
      unit: sel('feedUnit'),
      legacy: sel('legacyFeedUnit'),
      anyUnit: sel('feedUnit') + ', ' + sel('legacyFeedUnit'),
      placeholder: sel('virtualizedPlaceholder'),
      message: sel('message'),
      comment: sel('comment'),
      authorLink: sel('authorLink'),
      postLink: sel('postLink'),
      sponsoredLink: sel('sponsoredLink'),
      imageMedia: sel('imageMedia'),
      hashtagLink: sel('hashtagLink'),
      reelsShelf: sel('reelsShelf'),
      metaAiPromoAlt: sel('metaAiPromoAlt'),
      aiButton: sel('aiInfoButton'),
      postIdRe: safeRe(sel('postIdRegex'), 'i'),
      cftRe: safeRe(sel('sponsoredCftRegex'), ''),
      // platform AI label strings: rules.labels.facebook.text ∪ sites.facebook.aiInfoText ∪ profile label
      aiTexts: new Set(lower([].concat(labelTexts, list('aiInfoText'), list('profileLabelText')))),
      metaAiTexts: new Set(lower(list('metaAiHeaderText'))),
      sponsoredTexts: new Set(lower(['Sponsored'].concat(list('disclosureHeaderText').filter((s) => /^ad$/i.test(String(s).trim())))))
    };
    return compiled;
  }
  function safeRe(src, flags) { try { return new RegExp(src, flags); } catch (_) { return null; } }

  function labelId(text) {
    return SITE + '_' + String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /** FNV-1a 32-bit, base36 — synthetic id for units without a permalink (marked extra.idSource='hash'). */
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }

  /** Is `node` inside a comment (nested article) relative to the post `article`? */
  function inComment(node, article, c) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    const own = el.closest('[role="article"], [role="comment"], [data-commentid]');
    if (!own || own === article) return false;
    if (own.matches('[role="comment"], [data-commentid]')) return true;
    // a role="article" that is not the post's own article and sits inside it = a comment
    return article.contains(own);
  }

  /** First text node (outside comments) whose trimmed text equals one of `set`; returns the text or ''. */
  function exactText(root, article, set, c) {
    if (!root || !set.size) return '';
    const doc = root.ownerDocument || document;
    const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
    let n;
    while ((n = walker.nextNode())) {
      const raw = n.nodeValue || '';
      if (raw.length > 40 || !raw.trim()) continue;
      const t = raw.trim().toLowerCase();
      if (set.has(t) && !inComment(n, article, c)) return raw.trim();
    }
    return '';
  }

  /** Post-level AI label: a [role="button"]/button/a/span whose own text is one of the label strings (Stevo / gf_552339),
   *  falling back to any short text node outside comments. */
  function findAiLabel(unit, article, c) {
    const controls = unit.querySelectorAll(c.aiButton + ', button, a[aria-label]');
    for (const ctl of controls) {
      if (inComment(ctl, article, c)) continue;
      const names = [ctl.getAttribute('aria-label') || '', (ctl.textContent || '')];
      for (const name of names) {
        const t = name.trim().toLowerCase();
        if (t && t.length <= 40 && c.aiTexts.has(t)) return name.trim();
      }
    }
    return exactText(unit, article, c.aiTexts, c);
  }

  /** Meta AI promo unit: header disclosure anchor named "Visit Meta AI" / "Try Meta AI" (gf_552339 isNewsMetaAICard). */
  function findMetaAiPromo(unit, article, c) {
    const anchors = unit.querySelectorAll('a[aria-label], a[href]');
    for (const a of anchors) {
      if (inComment(a, article, c)) continue;
      const names = [a.getAttribute('aria-label') || '', a.textContent || ''];
      for (const name of names) { const t = name.trim().toLowerCase(); if (t && c.metaAiTexts.has(t)) return name.trim(); }
    }
    return '';
  }

  function isSponsored(unit, article, c) {
    const links = unit.querySelectorAll('a[href], a[aria-label]');
    for (const a of links) {
      if (inComment(a, article, c)) continue;
      if (a.matches(c.sponsoredLink)) return true;
      const href = a.getAttribute('href') || '';
      if (c.cftRe && href.includes('__cft__') && c.cftRe.test(href) && !/\/groups\//.test(href)) return true; // uAssets length rule
      const name = (a.getAttribute('aria-label') || a.textContent || '').trim().toLowerCase();
      if (name && name.length <= 20 && c.sponsoredTexts.has(name)) return true;
    }
    return false;
  }

  /** Author: first header anchor that is a profile link (not a permalink, hashtag, ad or outbound link). */
  function findAuthor(article, c) {
    const anchors = article.querySelectorAll(c.authorLink);
    for (const a of anchors) {
      if (inComment(a, article, c)) continue;
      const href = a.getAttribute('href') || '';
      if (!href || /\/(?:posts|videos|reel|photo|photos|hashtag|ads|stories|watch|groups\/[^/]+\/(?:posts|permalink))\b|story_fbid=|^https?:\/\/l\.facebook\.com/i.test(href)) continue;
      const name = (a.textContent || '').trim();
      if (!name) continue;
      let path = href;
      let search = '';
      try { const u = new URL(href, 'https://www.facebook.com/'); path = u.pathname; search = u.search; } catch (_) { /* keep raw */ }
      const segs = path.replace(/^\/+|\/+$/g, '').split('/');
      let handle = '', id = '';
      if (segs[0] === 'profile.php') { id = (/[?&]id=(\d+)/.exec(search) || [])[1] || ''; }
      else if (segs[0] === 'people' && segs[2]) { id = segs[2]; handle = ''; }
      else if (segs[0] === 'groups' && segs[2] === 'user' && segs[3]) { id = segs[3]; }
      else if (segs[0]) handle = dom.handle(segs[0]);
      if (!handle && !id) continue;
      return { handle, name, id, href };
    }
    return null;
  }

  /** Message text: authored blocks (gf_552339 authoredContent) outside comments; fallback = top-level [dir="auto"] runs. */
  function findText(article, c) {
    const parts = [];
    const seen = new Set();
    const push = (node) => { const t = dom.text(node); if (t && !seen.has(t)) { seen.add(t); parts.push(t); } };
    const blocks = article.querySelectorAll(c.message);
    for (const b of blocks) { if (!inComment(b, article, c)) push(b); }
    if (parts.length) return parts.join('\n');
    const runs = article.querySelectorAll('[dir="auto"]');
    for (const r of runs) {
      if (inComment(r, article, c)) continue;
      if (r.closest('h1, h2, h3, h4, h5, h6, [role="button"], a, [role="link"]')) continue;
      const parent = r.parentElement && r.parentElement.closest('[dir="auto"]');
      if (parent && article.contains(parent) && !parent.closest('h1, h2, h3, h4, h5, h6, [role="button"], a, [role="link"]')) continue; // nested run: outer already counted
      push(r);
    }
    return parts.join('\n');
  }

  function findPostId(unit, article, c) {
    if (!c.postIdRe) return '';
    const anchors = unit.querySelectorAll(c.postLink);
    for (const a of anchors) {
      if (inComment(a, article, c)) continue;
      const href = a.getAttribute('href') || '';
      if (!href || /\/ads\/about\//.test(href)) continue;
      const m = c.postIdRe.exec(href);
      if (m && m[1]) return m[1];
    }
    return '';
  }

  function findHashtags(article, text, c) {
    const out = new Set(dom.hashtags(text));
    article.querySelectorAll(c.hashtagLink).forEach((a) => {
      if (inComment(a, article, c)) return;
      const m = /\/hashtag\/([\p{L}\p{N}_]{2,64})/u.exec(a.getAttribute('href') || '');
      if (m) out.add('#' + m[1].toLowerCase());
      const t = (a.textContent || '').trim();
      if (t.startsWith('#')) dom.hashtags(t).forEach((h) => out.add(h));
    });
    return [...out];
  }

  function outermostArticle(unit) {
    if (unit.matches('[role="article"]')) return unit;
    const a = unit.querySelector('[role="article"]');
    return a || unit;
  }

  const adapter = {
    site: SITE,
    hideStrategy: 'height-zero', // rules.sites.facebook.hideStrategy (uAssets recipe)
    navigateEvents: [],
    attributeFilter: ['aria-posinset', 'data-virtualized'], // cell reuse / placeholder <-> content swaps

    matches(loc) {
      return /(^|\.)facebook\.com$/i.test((loc && loc.hostname) || '');
    },

    surface(loc) {
      const p = ((loc && loc.pathname) || '/').replace(/\/+$/, '') || '/';
      if (p === '/' || p === '/home.php' || p === '/home') return 'home';
      if (p.startsWith('/search')) return 'search';
      if (p.startsWith('/watch') || p.startsWith('/videos') || /\/videos\//.test(p)) return 'watch';
      if (p.startsWith('/reel') || p.startsWith('/reels')) return 'reels';
      if (p.startsWith('/groups') || p.startsWith('/marketplace') || p.startsWith('/events') || p.startsWith('/gaming') || p.startsWith('/stories') || p.startsWith('/messages') || p.startsWith('/notifications') || p.startsWith('/friends') || p.startsWith('/bookmarks') || p.startsWith('/pages') || p.startsWith('/login') || p.startsWith('/settings')) return 'other';
      if (p.startsWith('/profile.php') || p.startsWith('/people/') || /^\/[A-Za-z0-9.\-]+$/.test(p)) return 'profile';
      return 'other';
    },

    findItems(root) {
      const c = cfg();
      root = root || document;
      const out = [];
      const seen = new Set();
      const add = (el) => { if (el && !seen.has(el)) { seen.add(el); out.push(el); } };
      const toUnit = (el) => {
        // de-duplicate: an article inside an aria-posinset cell (or a comment inside a post) resolves to the outer unit
        const cell = el.closest('[aria-posinset]');
        if (cell) return cell;
        if (el.matches('[role="article"]')) {
          const outer = el.parentElement && el.parentElement.closest('[role="article"]');
          if (outer) return toUnit(outer);
        }
        return el;
      };
      if (root.nodeType === 1 && root.closest) {
        const self = root.closest(c.anyUnit);
        if (self) add(toUnit(self));
      }
      let list;
      try { list = root.querySelectorAll(c.anyUnit); } catch (_) { list = []; }
      for (const el of list) add(toUnit(el));
      return out;
    },

    extract(el) {
      const c = cfg();
      if (!el || el.nodeType !== 1) return null;
      const unit = el;
      // virtualized placeholder: content unmounted while off-screen -> not READY (undefined): the engine keeps a hidden
      // unit hidden instead of restoring its full height as a blank hole until the content remounts
      const ph = unit.querySelector(c.placeholder);
      if (ph && !unit.querySelector('[role="article"]') && !(unit.textContent || '').trim()) return undefined;
      const article = outermostArticle(unit);

      // "Reels and short videos" shelf (no article, heading links to the bare /reel/ path): a surface, not a post.
      // Reported as kind 'shelf' so the scorer leaves it alone; settings.surfaces.hideReels hides it via surfaces().
      if (article === unit && !unit.querySelector('[role="article"]')) {
        let shelf = false;
        try { shelf = unit.matches(c.reelsShelf); } catch (_) { shelf = false; }
        if (shelf) {
          return { id: 'reels-shelf', kind: 'shelf', surface: NS.engine && NS.engine.surface ? NS.engine.surface : 'home', text: '', author: { handle: '', name: '', id: '' },
            hashtags: [], links: dom.links(unit), labels: [], media: ['none'], extra: { idSource: 'shelf', shelf: 'reels' } };
        }
      }

      const author = findAuthor(article, c) || { handle: '', name: '', id: '' };
      const text = findText(article, c);
      if (!text && !author.name && !unit.querySelector('a[href], video, img')) return null; // empty skeleton

      const labels = [];
      const ai = findAiLabel(unit, article, c);
      if (ai) labels.push({ type: 'platform_ai', id: labelId(ai), text: ai });
      const promo = ai ? '' : findMetaAiPromo(unit, article, c);
      if (promo) labels.push({ type: 'platform_ai', id: SITE + '_meta_ai', text: promo });

      const engineSettings = NS.engine && NS.engine.settings;
      const hideAds = !!(engineSettings && engineSettings.surfaces && engineSettings.surfaces.hideAds);
      const sponsored = hideAds ? isSponsored(unit, article, c) : false;
      if (sponsored) labels.push({ type: 'promoted' });

      let id = findPostId(unit, article, c);
      let idSource = 'permalink';
      if (!id) {
        const seed = (author.handle || author.id || author.name) + '|' + text.slice(0, 240) + '|' + (promo || ai || '');
        if (!seed.replace(/\|/g, '').trim()) return null;
        id = 'h' + hash(seed);
        idSource = 'hash';
      }

      const links = dom.links(unit);
      const hasVideo = !!unit.querySelector('video');
      const reel = links.some((l) => /\/reel\/\w/.test(l));
      const video = hasVideo || links.some((l) => /\/videos\/\w/.test(l));
      const hasImage = !!unit.querySelector(c.imageMedia);
      const media = hasVideo || video ? ['video'] : hasImage ? ['image'] : ['none'];

      return {
        id,
        kind: sponsored ? 'ad' : reel ? 'short' : video ? 'video' : 'post',
        surface: NS.engine && NS.engine.surface ? NS.engine.surface : 'home',
        text,
        author: { handle: author.handle || '', name: author.name || '', id: author.id || '' },
        hashtags: findHashtags(article, text, c),
        links,
        labels,
        media,
        extra: { idSource, virtualized: !!unit.querySelector(c.virtualized || FALLBACK.virtualized), metaAiPromo: !!promo }
      };
    },

    surfaces() {
      const c = cfg();
      return [
        // The shelf is an aria-posinset feed unit: collapse it (height:0;overflow:hidden, uAssets recipe), never
        // display:none — unmounting a unit throws the virtualizer's height bookkeeping off (blank gaps / jumps).
        { settingKey: 'hideReels', selector: c.reelsShelf, strategy: 'height-zero' }
      ];
    },

    // height-zero: content.css collapses the cell; here we only neutralise inline heights the virtualizer may have
    // stamped on the aria-posinset cell so the stub (or nothing) is all that remains, and we pause any video.
    hide(el, item, verdict, strategy) {
      if (strategy !== 'height-zero') return;
      const showStub = !(NS.engine && NS.engine.settings && NS.engine.settings.showStubs === false);
      const prev = { height: el.style.getPropertyValue('height'), heightPrio: el.style.getPropertyPriority('height'),
        minHeight: el.style.getPropertyValue('min-height'), minPrio: el.style.getPropertyPriority('min-height') };
      el.setAttribute('data-noslop-fb-prev', JSON.stringify(prev));
      el.style.setProperty('min-height', '0', 'important');
      if (prev.height || !showStub) el.style.setProperty('height', showStub ? 'auto' : '0', 'important');
      el.style.setProperty('overflow', 'hidden', 'important');
      dom.stopMedia(el);
    },

    unhide(el) {
      let prev = null;
      try { prev = JSON.parse(el.getAttribute('data-noslop-fb-prev') || 'null'); } catch (_) { prev = null; }
      el.removeAttribute('data-noslop-fb-prev');
      el.style.removeProperty('overflow');
      el.style.removeProperty('height');
      el.style.removeProperty('min-height');
      if (prev) {
        if (prev.height) el.style.setProperty('height', prev.height, prev.heightPrio || '');
        if (prev.minHeight) el.style.setProperty('min-height', prev.minHeight, prev.minPrio || '');
      }
    },

    // exposed for tests
    _internals: { cfg, FALLBACK, hash, labelId }
  };

  NS.adapters.register(adapter);
})();
