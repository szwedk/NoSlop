// NoSlop — pure scorer (no DOM). Plain classic script attaching to globalThis.NoSlop.scorer.
// Contract: docs/DESIGN.md §5. NoSlop.scorer.score(item, rules, settings, site) -> verdict
//   verdict = { score, nonStyleScore, styleScore, tier, reasons[], action: 'hide'|'dim'|'none', mode }
// Tiers: 0 platform label (and ads) · 1 disclosure / hashtags / tool names / chatbot residue / prompt metadata / custom
//        2 accounts (user block 1.5, seed 1.0, allow -> none) · 3 style (capped at rules.scoring.styleCap, can only reach 'dim').
// A 'hide' needs nonStyleScore >= mode.hide; a 'dim' needs total >= mode.dim. Style alone therefore never hides.
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});

  const FLAGS = 'iu';
  const compiledCache = new WeakMap(); // rules object identity -> compiled

  let EMOJI_RE, EMOJI_G;
  try { EMOJI_RE = new RegExp('\\p{Extended_Pictographic}', 'u'); EMOJI_G = new RegExp('\\p{Extended_Pictographic}', 'gu'); }
  catch (_) { EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u; EMOJI_G = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu; }

  const HASHTAG_RE = /#([\p{L}\p{N}_]{2,64})/gu;
  const URL_RE = /(?:https?:\/\/|www\.)\S+/gi; // "https://site/page#aiart" is a URL fragment, not a self-label
  const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
  const customCache = new WeakMap(); // settings.customPhrases array identity -> compiled regex (null = none)

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

  function rx(src, flags) {
    try { return new RegExp(src, flags || FLAGS); }
    catch (e) { try { return new RegExp(src, (flags || FLAGS).replace('u', '')); } catch (_) { return null; } }
  }

  /** Build one alternation regex over a term list (longest first) with unicode-safe word boundaries. */
  function termsRegex(terms, inflect) {
    const list = (terms || []).filter(Boolean).map(String).sort((a, b) => b.length - a.length);
    if (!list.length) return null;
    const body = list.map((t) => escapeRe(t.toLowerCase()).replace(/\\ /g, ' ').replace(/ +/g, '\\s+')).join('|');
    const tail = inflect ? '(?:s|es|ed|ing|d)?' : ''; // "fosters", "leveraging", "underscored"
    // '#' and '@' excluded from the left context so "#midjourney" counts as a hashtag, not also as a tool mention.
    return rx('(?<![\\p{L}\\p{N}#@])(?:' + body + ')' + tail + '(?![\\p{L}\\p{N}])', 'giu') || rx('\\b(?:' + body + ')' + tail + '\\b', 'gi');
  }

  function entries(list, defaultScore, kind) {
    const out = [];
    (list || []).forEach((e, i) => {
      if (typeof e === 'string') { const re = rx(e); if (re) out.push({ id: kind + '_' + i, re, score: defaultScore }); return; }
      if (!e || typeof e !== 'object') return;
      if (e.regex) { const re = rx(e.regex); if (re) out.push({ id: e.id || kind + '_' + i, re, score: typeof e.score === 'number' ? e.score : defaultScore, rule: null, params: e, weak: e.weak === true }); }
      else if (e.rule) out.push({ id: e.id || e.rule, re: null, rule: e.rule, score: typeof e.score === 'number' ? e.score : defaultScore, params: e, weak: e.weak === true });
    });
    return out;
  }

  function normTag(t) {
    if (!t) return '';
    let s = String(t).trim().toLowerCase();
    if (!s) return '';
    if (s[0] !== '#') s = '#' + s;
    return s;
  }

  /** Canonical family for a tool term so "sora" and "sora 2" count once. */
  function toolFamily(term) {
    let s = String(term).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s === 'automatic1111' || s === 'a1111') return 'automatic1111';
    s = s.replace(/^(?:google|adobe|openai)/, '');
    s = s.replace(/(?:dreammachine|kontext|video|labs|gen\d|ml|ai|dev|pro)$/, '');
    s = s.replace(/\d+$/, '') || s;
    return s;
  }

  function compile(rules) {
    if (!rules || typeof rules !== 'object') rules = {};
    let c = compiledCache.get(rules);
    if (c) return c;
    const sc = rules.scoring || {};
    const caps = sc.categoryCaps || {};
    const st = rules.style || {};
    const d = rules.disclosure || {};
    const h = rules.hashtags || {};
    const t = rules.toolNames || {};
    const r = rules.chatbotResidue || {};
    const p = rules.promptMetadata || {};
    const eb = st.engagementBait || {};
    const va = st.vocabAlways || {};
    const vc = st.vocabCluster || {};
    const cl = st.closers || {};
    const toolTerms = (t.terms || []).map(String);
    c = {
      modes: Object.assign({ strict: { hide: 0.8, dim: 0.4 }, balanced: { hide: 1.0, dim: 0.6 } }, sc.modes || {}),
      styleCap: typeof sc.styleCap === 'number' ? sc.styleCap : 0.6,
      caps: Object.assign({ label: 1.5, disclosure: 1.0, hashtag: 1.2, hashtagWeak: 0.4, mention: 0.6, tool: 0.8, residue: 1.0, prompt: 1.0, account: 1.5, custom: 1.0, structure: 0.5, engagementBait: 0.4, vocabAlways: 0.5, vocabCluster: 0.2, closers: 0.4, humanTells: -0.6 }, caps),
      labelScore: (rules.labels && typeof rules.labels.score === 'number') ? rules.labels.score : 1.5,
      c2paScore: (rules.labels && typeof rules.labels.c2paScore === 'number') ? rules.labels.c2paScore : 0.6,
      labelTexts: (function () { const m = {}; for (const [site, v] of Object.entries(rules.labels || {})) { if (v && Array.isArray(v.text)) m[site] = new Set(v.text.map((s) => String(s).trim().toLowerCase())); } return m; })(),
      disclosure: entries(d.regex, typeof d.score === 'number' ? d.score : 1.0, 'disclosure'),
      negators: entries((d.negators && d.negators.regex) || [], 0, 'neg').map((e) => e.re),
      critiqueFactor: (d.negators && typeof d.negators.factor === 'number') ? d.negators.factor : 0.5,
      hashStrong: new Set((h.strong || []).map(normTag)), hashWeak: new Set((h.weak || []).map(normTag)),
      hashStrongScore: typeof h.strongScore === 'number' ? h.strongScore : 1.0, hashWeakScore: typeof h.weakScore === 'number' ? h.weakScore : 0.4,
      toolRe: termsRegex(toolTerms), toolEach: typeof t.scoreEach === 'number' ? t.scoreEach : 0.4, toolCap: typeof t.cap === 'number' ? t.cap : 0.8,
      residue: entries(r.regex, typeof r.score === 'number' ? r.score : 0.9, 'residue'),
      prompt: entries(p.regex, typeof p.score === 'number' ? p.score : 0.9, 'prompt'),
      minWords: typeof st.minWords === 'number' ? st.minWords : 6,
      structure: entries(st.structure, 0.2, 'structure'),
      engagement: entries(eb.regex, typeof eb.scoreEach === 'number' ? eb.scoreEach : 0.2, 'engagement'), engagementEach: typeof eb.scoreEach === 'number' ? eb.scoreEach : 0.2, engagementCap: typeof eb.cap === 'number' ? eb.cap : 0.4,
      vocabAlwaysRe: termsRegex(va.terms, va.inflect !== false), vocabAlwaysEach: typeof va.scoreEach === 'number' ? va.scoreEach : 0.12, vocabAlwaysCap: typeof va.cap === 'number' ? va.cap : 0.5,
      vocabClusterRe: termsRegex(vc.terms, vc.inflect !== false), vocabClusterMin: typeof vc.min === 'number' ? vc.min : 2, vocabClusterScore: typeof vc.score === 'number' ? vc.score : 0.2,
      closers: entries(cl.regex, typeof cl.scoreEach === 'number' ? cl.scoreEach : 0.2, 'closer'), closersEach: typeof cl.scoreEach === 'number' ? cl.scoreEach : 0.2, closersCap: typeof cl.cap === 'number' ? cl.cap : 0.4,
      humanTells: entries(st.humanTells, -0.15, 'human'),
      accounts: rules.accounts || {},
      seedScore: (rules.accounts && typeof rules.accounts.seedScore === 'number') ? rules.accounts.seedScore : 1.0,
      seedSets: (function () { const m = {}; for (const [site, v] of Object.entries(rules.accounts || {})) { if (v && Array.isArray(v.block)) m[site] = new Set(v.block.map((x) => normHandle(x))); } return m; })(),
      redditSubScore: (rules.accounts && rules.accounts.reddit && typeof rules.accounts.reddit.score === 'number') ? rules.accounts.reddit.score
        : (rules.accounts && typeof rules.accounts.seedScore === 'number') ? rules.accounts.seedScore : 1.0,
      redditSubs: new Set(((rules.accounts && rules.accounts.reddit && rules.accounts.reddit.subreddits) || []).map((s) => String(s).toLowerCase())),
      redditAppliesTo: new Set((rules.accounts && rules.accounts.reddit && rules.accounts.reddit.appliesTo) || ['home'])
    };
    compiledCache.set(rules, c);
    return c;
  }

  function normHandle(s) {
    if (s == null) return '';
    let v = String(s).trim().toLowerCase();
    v = v.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+|\/+$/g, '');
    v = v.replace(/^(?:r|u|user|in|c|channel)\//, '');
    return v.replace(/^@/, '');
  }

  function authorKeys(item) {
    const a = (item && item.author) || {};
    const out = new Set();
    for (const k of ['handle', 'id', 'name']) { const v = normHandle(a[k]); if (v) out.add(v); }
    return out;
  }

  function inList(list, keys) {
    if (!list || !list.length || !keys.size) return false;
    for (const e of list) { const v = normHandle(e); if (v && keys.has(v)) return true; }
    return false;
  }

  function normalizeText(s) {
    return String(s || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ');
  }

  function wordCount(text) {
    const m = String(text || '').match(WORD_RE);
    return m ? m.length : 0;
  }

  function extractHashtags(text) {
    const out = new Set();
    const src = String(text || '').replace(URL_RE, ' ');
    for (const m of src.matchAll(HASHTAG_RE)) out.add('#' + m[1].toLowerCase());
    return [...out];
  }

  /** settings.customPhrases compiled as whole-word terms (longest first), cached per array identity: a user who types
   *  "ai" must not hide every post containing "said" or "wait". */
  function customPhrasesRegex(settings) {
    const list = settings && settings.customPhrases;
    if (!Array.isArray(list) || !list.length) return null;
    if (customCache.has(list)) return customCache.get(list);
    const re = termsRegex(list.map((p) => String(p || '').trim()).filter(Boolean));
    customCache.set(list, re);
    return re;
  }

  function distinctMatches(re, text) {
    if (!re) return [];
    re.lastIndex = 0;
    const set = new Set();
    let m;
    while ((m = re.exec(text))) { set.add(m[0].toLowerCase().replace(/\s+/g, ' ')); if (!re.global) break; }
    re.lastIndex = 0;
    return [...set];
  }

  // ---- rule-based style checks (ids referenced from rules.json "rule") ----
  const RULES = {
    emoji_bullets(text, words, p) {
      const min = p.min || 3;
      let n = 0;
      for (const line of text.split('\n')) { const s = line.trim(); if (s && EMOJI_RE.test(s[0] + (s[1] || '')) && EMOJI_RE.test(Array.from(s)[0] || '')) n++; }
      return n >= min;
    },
    emoji_density(text, words, p) {
      if (words > (p.maxWords || 120)) return false;
      const set = new Set(Array.from(p.set || ''));
      const seen = new Set();
      for (const ch of Array.from(text)) if (set.has(ch)) seen.add(ch);
      return seen.size >= (p.min || 5);
    },
    em_dash_density(text, words, p) {
      if (words < (p.minWords || 40)) return false;
      const n = (text.match(/—/g) || []).length;
      return n / words * 100 >= (p.perHundredWords || 2);
    },
    parallel_triad(text) {
      const frags = text.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
      for (let i = 0; i + 2 < frags.length; i++) {
        const w = [frags[i], frags[i + 1], frags[i + 2]].map((f) => f.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').split(/\s+/).filter(Boolean));
        if (w.some((x) => x.length < 2 || x.length > 6)) continue;
        if (new Set(w.map((x) => x.join(' '))).size < 3) continue;
        const sameLast = w[0][w[0].length - 1] === w[1][w[1].length - 1] && w[1][w[1].length - 1] === w[2][w[2].length - 1];
        const sameFirst = w[0][0] === w[1][0] && w[1][0] === w[2][0];
        if (sameLast || sameFirst) return true;
      }
      return false;
    },
    one_line_paragraph_stack(text, words, p) {
      const min = p.min || 4, maxWords = p.maxWords || 12;
      let run = 0;
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const isSentence = /[.!?]["')]?$/.test(line) && !/^(?:[-•*>]|\d+[.)]|[a-z][.)]\s)/i.test(line) && !EMOJI_RE.test(Array.from(line)[0]) && (line.match(/[.!?]/g) || []).length <= 1;
        if (isSentence && wordCount(line) <= maxWords) { run++; if (run >= min) return true; } else run = 0;
      }
      return false;
    },
    all_lowercase_long(text, words, p) {
      if (words < (p.minWords || 30)) return false;
      return /\p{L}/u.test(text) && !/\p{Lu}/u.test(text);
    }
  };

  function runEntry(e, text, words) {
    if (e.re) { e.re.lastIndex = 0; const ok = e.re.test(text); e.re.lastIndex = 0; return ok; }
    const fn = RULES[e.rule];
    return fn ? !!fn(text, words, e.params || {}) : false;
  }

  function round(n) { return Math.round(n * 1000) / 1000; }

  function score(item, rules, settings, site) {
    item = item || {};
    settings = settings || {};
    site = site || item.site || 'generic';
    const c = compile(rules || NS.rules || {});
    const siteCfg = settings.sites && settings.sites[site];
    const mode = settings.enabled === false ? 'off' : (siteCfg && siteCfg.mode) || 'balanced';
    const th = c.modes[mode];
    const base = { score: 0, nonStyleScore: 0, styleScore: 0, tier: null, reasons: [], action: 'none', mode };
    if (!th || mode === 'off') return base;

    const keys = authorKeys(item);
    if (inList(settings.allowedAccounts && settings.allowedAccounts[site], keys)) {
      return Object.assign(base, { reasons: ['account:allow'] });
    }

    const reasons = [];
    // `mention` pools the mention-level signals (weak disclosure entries, weak hashtags, a SINGLE tool family) under
    // one cap (0.6 = the balanced dim threshold): mentions dim at most, never hide. Weak hashtags keep their own cap
    // (hashtagWeak 0.4) before pooling, so four topic tags alone stay below dim. Two or more tool families stay in `tool`.
    const parts = { label: 0, ad: 0, c2pa: 0, disclosure: 0, hashtag: 0, hashtagWeak: 0, mention: 0, tool: 0, residue: 0, prompt: 0, account: 0, custom: 0 };
    let tier = null;
    const seen = (t) => { tier = tier == null ? t : Math.min(tier, t); };

    // ---- ads / promoted ----
    const labels = Array.isArray(item.labels) ? item.labels : [];
    const promoted = item.kind === 'ad' || labels.some((l) => l && l.type === 'promoted');
    if (promoted && settings.surfaces && settings.surfaces.hideAds) { parts.ad = c.labelScore; reasons.push('ad:promoted'); seen(0); }

    // ---- tier 0: platform labels ----
    const siteTexts = c.labelTexts[site];
    for (const l of labels) {
      if (!l) continue;
      if (l.type === 'platform_ai') {
        const id = l.id || (l.text && siteTexts && siteTexts.has(String(l.text).trim().toLowerCase()) ? site + '_text' : site + '_label');
        parts.label += c.labelScore; reasons.push('label:' + id); seen(0);
      } else if (l.type === 'c2pa') {
        // Content Credentials mark provenance (most often a real camera or a Photoshop edit), not AI: a weak signal
        // that may dim in strict, is tier 3 (never persisted as a tier<=1 verdict, never auto-promotes).
        parts.c2pa += c.c2paScore; reasons.push('label:c2pa'); seen(3);
      }
    }

    // ---- tier 2: accounts ----
    const blocked = settings.blockedAccounts && settings.blockedAccounts[site];
    if (inList(blocked, keys)) { parts.account += c.labelScore; reasons.push('account:block'); seen(2); }
    else if (c.seedSets[site] && [...keys].some((k) => c.seedSets[site].has(k))) { parts.account += c.seedScore; reasons.push('account:seed'); seen(2); }
    if (site === 'reddit' && c.redditSubs.size) {
      const sub = String((item.extra && (item.extra.subreddit || item.extra.subredditName)) || '').replace(/^r\//i, '').toLowerCase();
      const surface = item.surface || 'other';
      if (sub && c.redditSubs.has(sub) && (c.redditAppliesTo.has(surface) || (item.extra && item.extra.recommended))) {
        parts.account += c.redditSubScore; reasons.push('account:subreddit'); seen(2);
      }
    }

    // ---- tier 1: text signals ----
    const text = normalizeText([item.title, item.text].filter(Boolean).join('\n'));
    const lower = text.toLowerCase();
    let negated = false;
    if (text) for (const re of c.negators) { re.lastIndex = 0; if (re.test(text)) { negated = true; break; } }

    if (text) for (const e of c.disclosure) { if (runEntry(e, text, 0)) { if (e.weak) parts.mention += e.score; else parts.disclosure += e.score; reasons.push('disclosure:' + e.id); } }

    const tags = new Set();
    for (const t of (Array.isArray(item.hashtags) ? item.hashtags : [])) { const n = normTag(t); if (n) tags.add(n); }
    for (const t of extractHashtags(text)) tags.add(t);
    for (const t of tags) {
      if (c.hashStrong.has(t)) { parts.hashtag += c.hashStrongScore; reasons.push('hashtag:' + t); }
      else if (c.hashWeak.has(t)) { parts.hashtagWeak += c.hashWeakScore; reasons.push('hashtag:' + t); }
    }

    if (text && c.toolRe) {
      const fams = new Set();
      for (const m of distinctMatches(c.toolRe, lower)) fams.add(toolFamily(m));
      for (const f of fams) { if (fams.size === 1) parts.mention += c.toolEach; else parts.tool += c.toolEach; reasons.push('tool:' + f); }
    }

    if (text) {
      for (const e of c.residue) if (runEntry(e, text, 0)) { parts.residue += e.score; reasons.push('residue:' + e.id); }
      for (const e of c.prompt) if (runEntry(e, text, 0)) { parts.prompt += e.score; reasons.push('prompt:' + e.id); }
    }

    // custom phrases / hashtags from settings
    const customRe = text ? customPhrasesRegex(settings) : null;
    if (customRe) { for (const m of distinctMatches(customRe, lower)) { if (m) { parts.custom += 1.0; reasons.push('custom:phrase'); } } }
    for (const ct of (Array.isArray(settings.customHashtags) ? settings.customHashtags : [])) {
      const n = normTag(ct);
      if (n && tags.has(n)) { parts.custom += 1.0; reasons.push('custom:' + n); }
    }

    if (negated && (parts.disclosure || parts.hashtag || parts.hashtagWeak || parts.mention || parts.tool)) {
      const f = c.critiqueFactor;
      parts.disclosure *= f; parts.hashtag *= f; parts.hashtagWeak *= f; parts.mention *= f; parts.tool *= f;
      reasons.push('context:critique');
    }

    const cap = (v, k) => Math.min(v, c.caps[k] != null ? c.caps[k] : v);
    const t1 = cap(parts.disclosure, 'disclosure') + cap(parts.hashtag, 'hashtag') + cap(parts.mention + cap(parts.hashtagWeak, 'hashtagWeak'), 'mention') + Math.min(parts.tool, c.toolCap)
      + cap(parts.residue, 'residue') + cap(parts.prompt, 'prompt') + cap(parts.custom, 'custom');
    if (t1 > 0) seen(1);
    const nonStyle = cap(parts.label, 'label') + parts.ad + cap(parts.account, 'account') + t1 + parts.c2pa;

    // ---- tier 3: style (dim only) ----
    let style = 0;
    const words = wordCount(text);
    if (text && words >= c.minWords) {
      let raw = 0;
      for (const e of c.structure) {
        const max = (e.params && e.params.max) || 1;
        if (e.re && max > 1) {
          const n = Math.min(max, distinctMatches(new RegExp(e.re.source, e.re.flags.includes('g') ? e.re.flags : e.re.flags + 'g'), text).length);
          if (n) { raw += n * e.score; reasons.push('style:' + e.id); }
        } else if (runEntry(e, text, words)) { raw += e.score; reasons.push('style:' + e.id); }
      }
      let eng = 0;
      for (const e of c.engagement) { if (e.re) { const n = distinctMatches(new RegExp(e.re.source, e.re.flags.includes('g') ? e.re.flags : e.re.flags + 'g'), text).length; if (n) { eng += n * c.engagementEach; } } }
      if (eng) { raw += Math.min(eng, c.engagementCap); reasons.push('style:engagement_bait'); }
      const va = distinctMatches(c.vocabAlwaysRe, lower);
      if (va.length) { raw += Math.min(va.length * c.vocabAlwaysEach, c.vocabAlwaysCap); reasons.push('style:vocab_always'); }
      const vc = distinctMatches(c.vocabClusterRe, lower);
      if (vc.length >= c.vocabClusterMin) { raw += c.vocabClusterScore; reasons.push('style:vocab_cluster'); }
      let clo = 0;
      for (const e of c.closers) { if (e.re) { const n = distinctMatches(new RegExp(e.re.source, e.re.flags.includes('g') ? e.re.flags : e.re.flags + 'g'), text).length; if (n) clo += n * c.closersEach; } }
      if (clo) { raw += Math.min(clo, c.closersCap); reasons.push('style:closer'); }
      raw = Math.min(raw, c.styleCap);
      if (raw > 0) {
        let neg = 0;
        for (const e of c.humanTells) if (runEntry(e, text, words)) { neg += e.score; reasons.push('style:human_' + e.id); }
        neg = Math.max(neg, c.caps.humanTells != null ? c.caps.humanTells : -0.6);
        raw = Math.max(0, raw + neg);
      }
      style = raw;
      if (style > 0) seen(3);
    }

    const total = nonStyle + style;
    let action = 'none';
    if (nonStyle >= th.hide) action = 'hide';
    else if (total >= th.dim) action = 'dim';
    if (action === 'hide' && settings.dimInsteadOfHide) action = 'dim';

    return { score: round(total), nonStyleScore: round(nonStyle), styleScore: round(style), tier, reasons, action, mode };
  }

  const REASON_LABELS = {
    'label': 'platform AI label', 'ad': 'promoted', 'disclosure': 'self-disclosed AI', 'hashtag': 'AI hashtag', 'tool': 'AI tool mention',
    'residue': 'chatbot residue', 'prompt': 'prompt metadata', 'account': 'blocked account', 'custom': 'your custom rule', 'style': 'AI-style writing', 'context': 'critique context', 'surface': 'hidden surface', 'user': 'you'
  };

  /** Short human label for a reason id ("label:youtube_badge" -> "platform AI label (youtube badge)"). */
  function humanizeReason(id) {
    if (!id) return '';
    const [kind, rest] = String(id).split(':');
    const label = REASON_LABELS[kind] || kind;
    if (kind === 'hashtag' || kind === 'custom') return rest ? label + ' ' + rest : label;
    if (kind === 'account') return rest === 'block' ? 'account you blocked' : rest === 'allow' ? 'allowed account' : 'listed account';
    if (kind === 'tool') return 'mentions ' + rest;
    return rest ? label + ' (' + rest.replace(/_/g, ' ') + ')' : label;
  }

  NS.scorer = { score, compile, wordCount, extractHashtags, normHandle, humanizeReason, _rules: RULES };
})();
