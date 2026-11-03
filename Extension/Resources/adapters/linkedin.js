// NoSlop — linkedin.com adapter. Plain classic script (Safari 17+ iOS/macOS, Chrome 121+), no modules.
// Contract: adapters/_template.js and docs/DESIGN.md §4. Registers via NoSlop.adapters.register(adapter).
//
// Selectors come from NoSlop.rules.sites.linkedin, which was seeded from
// docs/research/platform-dom-and-ai-labels.md §2.8 (fx-biocoder/better-linkedin content-feed.js HEAD 2026-10-19;
// Greasy Fork 551021 "Hide LinkedIn Promoted Posts with CSS" v1.1.4, 2025-10):
//   feed root (new DOM)   div[data-testid="mainFeed"]                                   [2026-code]
//   post (new DOM)        [role="listitem"][componentkey^="update-card-focus"]          [2026-code]
//   post body (new DOM)   span[data-testid="expandable-text-box"]                       [2026-code]
//   post (old Ember DOM)  .feed-shared-update-v2[role="article"]                        [older, 2025-10]
//   promoted (old DOM)    span[aria-hidden="true"] with the exact text "Promoted"       [older]
//   C2PA icon             button/svg[aria-label*="Content credentials"]                 [UNVERIFIED]
// Keys that are missing from rules.json fall back to the FALLBACK table below; every fallback is marked
// [UNVERIFIED] or cites its source, and the full list is reported to core in this agent's `requests`.
//
// What LinkedIn gives us (docs/research/platform-dom-and-ai-labels.md §1.6):
//   * The only platform-native marker is the C2PA "Content credentials" icon on images/videos
//     (linkedin.com/help/linkedin/answer/a6282984). It marks PROVENANCE, not AI: the assertion behind it
//     ("whether AI was used to generate or edit any part of the content") is only shown in a popover after a
//     click, which a content script cannot read without user interaction. We therefore emit {type:'c2pa'},
//     which the scorer weights at rules.labels.c2paScore (0.6 -> dim), never as a 1.5 platform_ai label.
//     Its DOM hook is UNVERIFIED (no primary source shows the markup); we match the aria-label selector from
//     rules and, as a second chance, the exact label strings in rules.labels.linkedin.c2paText.
//   * "Written by AI" / "Created with AI" / "AI-assisted" (rules.labels.linkedin.text, strings from the
//     0xBapen label list, facts only) are matched as EXACT text of a node OUTSIDE the post body, so a post
//     that merely says "this was AI-assisted" in its text is scored by the disclosure regexes instead.
//   * Everything else is tier 1-3 text scoring on the post body (self-disclosure, hashtags, tool names,
//     style), which is where most LinkedIn slop is caught.
//
// Hiding: better-linkedin sets post.style.display='none' on the listitem with no virtualization issues
// reported (§3), so hideStrategy is 'display-none' (rules.sites.linkedin.hideStrategy) and the engine's
// CSS classes are enough — no hide()/unhide() override.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  const dom = NS.dom;
  const SITE = 'linkedin';

  // Fallbacks for keys missing from rules.sites.linkedin. Sources / verification status per key.
  const FALLBACK = {
    hideStrategy: 'display-none',
    feedRoot: 'div[data-testid="mainFeed"]',                                                   // §2.8 [2026-code]
    post: '[role="listitem"][componentkey^="update-card-focus"], .feed-shared-update-v2[role="article"]',
    body: 'span[data-testid="expandable-text-box"], .feed-shared-update-v2__description, .update-components-text',
    promotedOld: 'span[aria-hidden="true"]',                                                  // Greasy Fork 551021 [older]
    promotedNew: 'p > span',                                                                  // better-linkedin removePromotedPosts() [2026-code]
    promotedText: ['Promoted'],
    // better-linkedin content-feed.js `promotedWords` (es / pt / it variants) [2026-code]
    promotedTextLocalized: ['Promocionado', 'Promovido', 'Post sponsorizzato'],
    authorLink: 'a[href*="/in/"], a[href*="/company/"]',
    authorSlugRegex: '/(in|company|school|showcase)/([^/?#]+)',
    // Older Ember DOM actor block; the research pack has no primary source for these class names. [UNVERIFIED]
    actorOld: '.update-components-actor__container, .update-components-actor',
    actorName: '.update-components-actor__name, .update-components-actor__title',
    // Older Ember DOM "...more" toggle and the screen-reader duplicate spans next to it. [UNVERIFIED]
    seeMore: 'button.feed-shared-inline-show-more-text__see-more-less-toggle',
    a11yDuplicate: '.visually-hidden',
    postIdAttr: 'componentkey',
    urnAttrs: ['componentkey', 'data-urn', 'data-id'],                                        // data-urn / data-id: older Ember DOM [UNVERIFIED]
    permalink: 'a[href*="urn:li:"]',
    urnRegex: 'urn:li:(?:activity|ugcPost|share):(\\d+)',
    c2paIcon: 'button[aria-label*="Content credentials" i], svg[aria-label*="Content credentials" i]' // [UNVERIFIED]
  };

  function siteRules() {
    const r = NS.rules && NS.rules.sites && NS.rules.sites[SITE];
    return r && typeof r === 'object' ? r : {};
  }
  function rule(key) {
    const v = siteRules()[key];
    return v == null || v === '' ? FALLBACK[key] : v;
  }
  function labelRules() {
    const l = NS.rules && NS.rules.labels && NS.rules.labels[SITE];
    return l && typeof l === 'object' ? l : {};
  }

  // Compiled once per regex source (rules can be swapped by settings.rulesOverride).
  const reCache = new Map();
  function re(src, flags) {
    const k = src + '/' + (flags || '');
    let r = reCache.get(k);
    if (r === undefined) {
      try { r = new RegExp(src, flags || ''); } catch (_) { r = null; }
      reCache.set(k, r);
    }
    return r;
  }
  const urnRe = () => re(rule('urnRegex'), 'i') || re(FALLBACK.urnRegex, 'i');
  const slugRe = () => re(rule('authorSlugRegex'), 'i') || re(FALLBACK.authorSlugRegex, 'i');

  function safeDecode(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }
  function norm(s) { return String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }
  function lowerSet(list) { return new Set((Array.isArray(list) ? list : []).map((s) => norm(s).toLowerCase()).filter(Boolean)); }
  function matchesSel(el, sel) { try { return !!(el && el.nodeType === 1 && sel && el.matches(sel)); } catch (_) { return false; } }
  function closestSel(el, sel) { try { return el && el.closest && sel ? el.closest(sel) : null; } catch (_) { return null; } }

  // Our own nodes (stub / badge) are inserted INSIDE the card by the engine: never read them back.
  function isOurs(el) { return !!(el.classList && (el.classList.contains('noslop-stub') || el.classList.contains('noslop-badge'))); }

  // ---------------------------------------------------------------- id
  // Stable post id = the activity/ugcPost/share URN, read from `componentkey`
  // ("update-card-focus-urn:li:activity:NNN", new DOM) or data-urn / data-id (older DOM), else from a
  // permalink inside the card. No URN = loading skeleton -> null (the engine skips it until it gets one).
  function postId(el) {
    const r = urnRe();
    if (!r) return null;
    const attrs = rule('urnAttrs');
    for (const a of (Array.isArray(attrs) ? attrs : FALLBACK.urnAttrs)) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const m = r.exec(v);
      if (m) return m[0].toLowerCase();
    }
    const link = el.querySelector(rule('permalink'));
    if (link) {
      const m = r.exec(safeDecode(link.getAttribute('href') || ''));
      if (m) return m[0].toLowerCase();
    }
    return null;
  }

  // ---------------------------------------------------------------- text
  const BLOCK_TAG = /^(?:P|DIV|LI|UL|OL|H[1-6]|BLOCKQUOTE|TR|SECTION|ARTICLE|HEADER|FOOTER|PRE)$/;
  const SKIP_TAG = /^(?:BUTTON|SCRIPT|STYLE|TEMPLATE|NOSCRIPT|SVG)$/;
  const MORE_TAIL = /[\s ]*(?:…|\.\.\.)?[\s ]*(?:see\s+)?more[\s ]*$/i;

  // Post body text with line breaks preserved (<br> and block boundaries -> '\n'), skipping buttons
  // (the "…more" toggle), screen-reader duplicates and our own nodes. LinkedIn keeps the full text in the DOM
  // behind a CSS line clamp (the "…more" toggle only changes the clamp), so textContent already is the
  // expanded text when the markup follows the old Ember shape; the new DOM's expandable-text-box is assumed
  // to do the same [UNVERIFIED]. The style rules (one_line_paragraph_stack, emoji_bullets, ...) need the
  // newlines, which is why dom.text()'s whitespace collapsing is not used here.
  function bodyText(root) {
    const out = [];
    const dup = rule('a11yDuplicate');
    const walk = (n) => {
      if (n.nodeType === 3) { out.push(n.nodeValue || ''); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (SKIP_TAG.test(tag) || isOurs(n) || matchesSel(n, dup)) return;
      if (tag === 'BR') { out.push('\n'); return; }
      const block = BLOCK_TAG.test(tag);
      if (block) out.push('\n');
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (block) out.push('\n');
    };
    walk(root);
    let s = out.join('').replace(/ /g, ' ').replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    let truncated = false;
    // A bare "…more" rendered as text (not a <button>) ends up at the tail: strip it and remember.
    if (/(?:…|\.\.\.)\s*(?:see\s+)?more$/i.test(s)) { s = s.replace(MORE_TAIL, '').trim(); truncated = true; }
    return { text: s, truncated };
  }

  // ---------------------------------------------------------------- author
  function linkName(a) {
    const nameEl = a.querySelector(rule('actorName'));
    const src = nameEl || a;
    const { text } = bodyText(src);
    const first = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
    if (first) return first;
    // aria-label="View Alice Doe's profile" / "View Example Co's page" (synthetic fixture shape; HYPOTHESIS)
    const m = /^view\s+(.+?)(?:['’]s)?\s+(?:profile|page)$/i.exec(norm(a.getAttribute('aria-label')));
    return m ? m[1] : '';
  }

  function authorFrom(a) {
    const href = a.getAttribute('href') || '';
    const m = slugRe().exec(href);
    if (!m) return null;
    const slug = safeDecode(m[2]).toLowerCase();
    return { handle: slug, id: m[1].toLowerCase() + '/' + slug, name: linkName(a) };
  }

  // Actor = first author link that is not inside the post body (mentions in the text also match
  // a[href*="/in/"]). Older DOM: prefer the link inside the actor container, because a social header
  // ("Alice commented on this") can carry another /in/ link above the actor. [actorOld UNVERIFIED]
  function actor(el, body) {
    const sel = rule('authorLink');
    const actorRoot = el.querySelector(rule('actorOld'));
    if (actorRoot && !(body && body.contains(actorRoot))) {
      for (const a of actorRoot.querySelectorAll(sel)) { const au = authorFrom(a); if (au) return au; }
    }
    for (const a of el.querySelectorAll(sel)) {
      if (body && body.contains(a)) continue;
      if (isOurs(a) || closestSel(a, '.noslop-stub')) continue;
      const au = authorFrom(a);
      if (au) return au;
    }
    return { handle: '', name: '' };
  }

  // ---------------------------------------------------------------- labels
  function promotedWords() {
    const s = lowerSet(rule('promotedText'));
    for (const w of FALLBACK.promotedTextLocalized) s.add(w.toLowerCase());
    return s;
  }

  // Promoted: old DOM span[aria-hidden="true"] whose text is exactly "Promoted" (Greasy Fork 551021); new DOM
  // `p > span` (better-linkedin). better-linkedin also accepts "Promoted ..." prefixes; we require an EXACT match
  // because headlines like "Promoted to Director" live in the same p > span shape.
  function isPromoted(el, body) {
    const words = promotedWords();
    const sel = rule('promotedOld') + ', ' + rule('promotedNew');
    let nodes;
    try { nodes = el.querySelectorAll(sel); } catch (_) { return false; }
    for (const n of nodes) {
      if (body && body.contains(n)) continue;
      if (isOurs(n) || closestSel(n, '.noslop-stub, .noslop-badge')) continue;
      const t = norm(n.textContent);
      if (!t || t.length > 150) continue;
      if (words.has(t.toLowerCase())) return true;
    }
    return false;
  }

  // Exact-text label scan over text nodes OUTSIDE the body (and outside our stub/badge).
  // Returns the first matching string from `wanted` (lower-cased set) or ''.
  function findLabelText(el, body, wanted) {
    if (!wanted.size) return '';
    const doc = el.ownerDocument || document;
    const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
    let n;
    while ((n = walker.nextNode())) {
      const t = norm(n.nodeValue).toLowerCase();
      if (!t || t.length > 40 || !wanted.has(t)) continue;
      const p = n.parentElement;
      if (body && body.contains(n)) continue;
      if (p && (isOurs(p) || closestSel(p, '.noslop-stub, .noslop-badge'))) continue;
      return t;
    }
    return '';
  }

  function labelsOf(el, body) {
    const labels = [];
    const L = labelRules();
    if (isPromoted(el, body)) labels.push({ type: 'promoted' });

    // C2PA "Content credentials" (provenance; scored at c2paScore). Icon selector [UNVERIFIED], then exact text.
    const c2paText = lowerSet(L.c2paText && L.c2paText.length ? L.c2paText : ['Content credentials']);
    let icon = null;
    try { icon = el.querySelector(rule('c2paIcon')); } catch (_) { icon = null; }
    if (icon) {
      labels.push({ type: 'c2pa', id: 'linkedin_c2pa', text: norm(icon.getAttribute('aria-label')) || 'Content credentials' });
    } else {
      const t = findLabelText(el, body, c2paText);
      if (t) labels.push({ type: 'c2pa', id: 'linkedin_c2pa_text', text: t });
    }

    // Platform "AI" text labels (rules.labels.linkedin.text minus the C2PA strings, which are provenance only).
    const aiText = lowerSet(L.text);
    for (const s of c2paText) aiText.delete(s);
    const hit = findLabelText(el, body, aiText);
    if (hit) labels.push({ type: 'platform_ai', id: 'linkedin_text', text: hit });
    return labels;
  }

  // ---------------------------------------------------------------- media
  function mediaOf(el) {
    if (el.querySelector('video')) return ['video'];
    const authorSel = rule('authorLink');
    const actorSel = rule('actorOld');
    for (const img of el.querySelectorAll('img')) {
      if (closestSel(img, authorSel) || closestSel(img, actorSel)) continue;    // avatar / company logo
      if (/\b(?:profile|avatar|logo)\b/i.test(img.getAttribute('alt') || '')) continue; // heuristic
      if (closestSel(img, '.noslop-stub, .noslop-badge')) continue;
      return ['image'];
    }
    return ['none'];
  }

  // ---------------------------------------------------------------- adapter
  const adapter = {
    site: SITE,
    hideStrategy: 'display-none', // = rules.sites.linkedin.hideStrategy (plain property: the engine reads it, tests may assign it)
    navigateEvents: [],
    // Observe these attributes so a reused card (new componentkey / data-urn) is re-extracted and re-verdicted.
    attributeFilter: ['componentkey', 'data-urn', 'data-id'],

    matches(loc) {
      return /(^|\.)linkedin\.com$/i.test((loc && loc.hostname) || '');
    },

    surface(loc) {
      const p = ((loc && loc.pathname) || '/').replace(/\/+$/, '') || '/';
      if (p === '/' || p === '/feed') return 'home';
      if (p.startsWith('/search')) return 'search';
      if (p.startsWith('/feed/hashtag')) return 'search';
      if (/^\/(?:in|company|school|showcase)\//.test(p)) return 'profile';
      return 'other'; // /feed/update/<urn>, /posts/<slug>, /pulse/..., /messaging, ...
    },

    // Candidate cards under `root` (root itself included when it is an unprocessed card). The componentkey
    // prefix / old article class is the gate; outside a feed (login page, /top-content) nothing matches.
    // Only outermost cards are returned, so a reshared post nested in another card is scored as part of its parent.
    findItems(root) {
      const r = root || document;
      const sel = rule('post');
      const out = [];
      if (r.nodeType === 1 && matchesSel(r, sel) && !r.hasAttribute('data-noslop-id')) out.push(r);
      let list;
      try { list = r.querySelectorAll(sel); } catch (_) { return out; }
      for (const el of list) {
        if (el.parentElement && closestSel(el.parentElement, sel)) continue; // nested
        out.push(el);
      }
      return out;
    },

    extract(el) {
      if (!el || el.nodeType !== 1) return null;
      const id = postId(el);
      if (!id) return null; // skeleton / not ready
      let body = null;
      try { body = el.querySelector(rule('body')); } catch (_) { body = null; }
      const { text, truncated } = body ? bodyText(body) : { text: '', truncated: false };
      const author = actor(el, body);
      const labels = labelsOf(el, body);
      const isOld = matchesSel(el, rule('postOld') || '.feed-shared-update-v2[role="article"]');
      return {
        id,
        kind: 'post',
        surface: (NS.engine && NS.engine.running && NS.engine.surface) ? NS.engine.surface : adapter.surface(globalThis.location),
        text,
        author,
        hashtags: dom.hashtags(text),
        links: dom.links(el),
        labels,
        media: mediaOf(el),
        extra: { urn: id, dom: isOld ? 'old' : 'new', truncated: truncated || undefined, hasBody: !!body }
      };
    },

    // LinkedIn has no Shorts/Reels-style surface with a verified selector; promoted posts are handled by the
    // scorer through settings.surfaces.hideAds (label {type:'promoted'} -> 'ad:promoted'), not by a CSS surface.
    surfaces() {
      return [];
    }
  };

  NS.adapters.register(adapter);
})();
