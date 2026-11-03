// Scorer unit tests: every tier, caps, modes, allow/block lists, custom rules, critique context, style rules.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
// Values produced inside the jsdom vm context have another realm's prototypes; compare structurally.
const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);
import { loadScripts, CORE_FILES, readRules } from './helpers/load.mjs';

let NoSlop, rules, defaults;
before(async () => {
  ({ NoSlop } = await loadScripts(CORE_FILES));
  rules = NoSlop.rules;
  defaults = NoSlop.defaultSettings();
});

const item = (text, extra = {}) => Object.assign({ id: 'id1', kind: 'post', surface: 'home', text, author: { handle: 'someone' }, hashtags: [], links: [], labels: [], media: ['none'] }, extra);
const withSettings = (patch) => Object.assign(JSON.parse(JSON.stringify(defaults)), patch);
const modeFor = (site, mode) => { const s = withSettings({}); s.sites[site].mode = mode; return s; };
const score = (it, site = 'x', settings = defaults) => NoSlop.scorer.score(it, rules, settings, site);

describe('tier 0: platform labels and ads', () => {
  test('platform_ai label hides with score 1.5 and reason label:<id>', () => {
    const v = score(item('nice sunset', { labels: [{ type: 'platform_ai', id: 'youtube_badge', text: 'AI' }] }), 'youtube');
    assert.equal(v.action, 'hide'); assert.equal(v.tier, 0); assert.equal(v.score, 1.5);
    deq(v.reasons, ['label:youtube_badge']);
  });
  test('label without id but with a known site string gets site_text reason', () => {
    const v = score(item('x', { labels: [{ type: 'platform_ai', text: 'AI info' }] }), 'instagram');
    assert.equal(v.action, 'hide'); assert.ok(v.reasons.includes('label:instagram_text'));
  });
  test('label cap: two labels do not exceed categoryCaps.label', () => {
    const v = score(item('x', { labels: [{ type: 'platform_ai', id: 'a' }, { type: 'platform_ai', id: 'b' }] }), 'x');
    assert.equal(v.score, rules.scoring.categoryCaps.label);
  });
  test('c2pa (Content Credentials = provenance, usually a real camera) is 0.5: none in balanced, dim in strict, tier 3 (never persisted)', () => {
    const v = score(item('x', { labels: [{ type: 'c2pa' }] }), 'linkedin');
    assert.equal(v.action, 'none'); assert.equal(v.tier, 3); assert.equal(v.score, rules.labels.c2paScore); assert.equal(rules.labels.c2paScore, 0.5);
    const s = score(item('x', { labels: [{ type: 'c2pa' }] }), 'linkedin', modeFor('linkedin', 'strict'));
    assert.equal(s.action, 'dim'); assert.equal(s.tier, 3); assert.ok(s.reasons.includes('label:c2pa'));
  });
  test('promoted only hides when surfaces.hideAds', () => {
    const it = item('buy now', { labels: [{ type: 'promoted' }] });
    assert.equal(score(it).action, 'none');
    const v = score(it, 'x', withSettings({ surfaces: Object.assign({}, defaults.surfaces, { hideAds: true }) }));
    assert.equal(v.action, 'hide'); assert.ok(v.reasons.includes('ad:promoted'));
    assert.equal(score(item('x', { kind: 'ad' }), 'x', withSettings({ surfaces: Object.assign({}, defaults.surfaces, { hideAds: true }) })).action, 'hide');
  });
});

describe('tier 1: disclosure, hashtags, tool names, residue, prompt metadata', () => {
  test('self-disclosure hides in balanced', () => {
    for (const t of ['This image was generated with Midjourney.', 'Made with AI ✨', 'AI-generated, not a real place', 'fully AI short film', 'Written by AI, edited by me', 'yes it\'s AI']) {
      const v = score(item(t));
      assert.equal(v.action, 'hide', t); assert.equal(v.tier, 1, t); assert.ok(v.reasons.some((r) => r.startsWith('disclosure:')), t);
    }
  });
  test('critique context multiplies text signals by the negator factor and never hides', () => {
    for (const t of ['I hate AI art', 'so much AI-generated garbage on my feed', 'how to spot AI-generated images', '#aiart is ruining this platform', 'this is AI, obviously. report it']) {
      const v = score(item(t));
      assert.notEqual(v.action, 'hide', t);
      assert.ok(v.reasons.includes('context:critique'), t + ' ' + JSON.stringify(v.reasons));
    }
    const plain = score(item('AI-generated')); const neg = score(item('AI-generated garbage'));
    assert.ok(Math.abs(neg.score - plain.score * rules.disclosure.negators.factor) < 1e-6);
  });
  test('mere mentions score below dim', () => {
    for (const t of ['tried ChatGPT for recipes, meh', 'Google Veo 3 is insane', 'the AI debate is boring']) assert.equal(score(item(t)).action, 'none', t);
  });
  test('strong hashtag from item.hashtags hides, weak hashtags are pooled under the mention cap', () => {
    const v = score(item('pretty', { hashtags: ['#AiArt'] }));
    assert.equal(v.action, 'hide'); assert.ok(v.reasons.includes('hashtag:#aiart'));
    const w = score(item('news #ai #chatgpt #openai #genai'));
    assert.equal(w.nonStyleScore, rules.scoring.categoryCaps.hashtagWeak, 'weak hashtags keep their own cap before pooling'); assert.equal(w.action, 'none');
  });
  test('URL fragments are not hashtags (a link to a page about AI art is not a self-label)', () => {
    for (const t of ['check https://example.com/page#aiart for details', 'link: https://foo.bar/#midjourney', 'https://docs.site/#sora2 docs', 'see www.site.com/x#aivideo']) {
      assert.equal(score(item(t)).action, 'none', t); deq(score(item(t)).reasons.filter((r) => r.startsWith('hashtag:')), [], t);
    }
    deq(NoSlop.scorer.extractHashtags('cool #aiart https://x.com/a#b'), ['#aiart']);
    deq(NoSlop.dom.hashtags('cool #aiart https://x.com/a#b'), ['#aiart']);
  });
  test('mention-level signals do not stack into a hide: weak disclosure + weak hashtag + ONE tool family share the mention cap', () => {
    for (const t of ['Generative AI text-to-image tools made AI art accessible to everyone', 'Suno just dropped v5 and AI music is getting scary good #ai', 'Veo 3 and AI video are everywhere now #ai']) {
      const v = score(item(t));
      assert.notEqual(v.action, 'hide', t + ' -> ' + v.reasons.join(','));
      assert.ok(v.nonStyleScore <= rules.scoring.categoryCaps.mention + 1e-9, t);
    }
    // two or more tool families are a pipeline and still count under `tool`
    assert.equal(score(item('Midjourney, Kling, ElevenLabs, Suno, Udio')).action, 'hide');
  });
  test('"#sora" (Kingdom Hearts / Japanese sky) is weak; #sora2 / #openaisora stay strong', () => {
    assert.equal(score(item('Kingdom Hearts fanart of #sora done in procreate')).action, 'none');
    assert.equal(score(item('#sora 今日の空')).action, 'none');
    assert.equal(score(item('#sora2')).action, 'hide');
    assert.equal(score(item('#openaisora')).action, 'hide');
  });
  test('critique negators: questions, "i think / pretty sure", "it was not", topic flair, plural real photos', () => {
    const human = ['I think this is AI.', 'pretty sure this is AI.', 'honestly this is AI, right?', 'lmao this is AI', 'this is AI. unbelievable people fall for it',
      'AI generated?', 'WRITTEN BY AI? NEVER. I TYPED THIS MYSELF', 'My editor asked me to disclose that this article was written by AI. It was not.',
      'reminder that #midjourney is trained on stolen art', 'Stop tagging my photos #aiphotography, they are real photos', 'this is all AI generated nonsense, mute the word',
      'Studio Ghibli statement on AI-generated images', 'ai-generated subtitles are wrong again youtube', 'Synthetic media literacy class for seniors',
      'Playing with ElevenLabs and HeyGen and Synthesia at work today for the demo (not posting the result)'];
    for (const t of human) assert.notEqual(score(item(t)).action, 'hide', t + ' -> ' + score(item(t)).reasons.join(','));
    // real self-disclosure still hides
    for (const t of ['this is AI.', 'This is AI, by the way, enjoy', 'made this with Midjourney #aiart']) assert.equal(score(item(t)).action, 'hide', t);
  });
  test('hashtags are also extracted from text and de-duplicated across text and item.hashtags', () => {
    const v = score(item('loop #midjourney', { hashtags: ['#midjourney', 'midjourney'] }));
    assert.equal(v.reasons.filter((r) => r === 'hashtag:#midjourney').length, 1);
    assert.equal(v.score, rules.hashtags.strongScore);
  });
  test('hashtag category cap', () => {
    const v = score(item('#aiart #aivideo #midjourney #sora2 #veo3'));
    assert.equal(v.nonStyleScore, rules.scoring.categoryCaps.hashtag);
  });
  test('tool names: 0.4 each per family, capped; "sora" and "sora 2" count once', () => {
    const one = score(item('rendered it in Midjourney'));
    assert.ok(one.reasons.includes('tool:midjourney'));
    const fam = score(item('Sora and Sora 2 side by side'));
    assert.equal(fam.reasons.filter((r) => r.startsWith('tool:')).length, 1);
    const many = score(item('Midjourney, Kling, ElevenLabs, Suno, Udio'));
    assert.equal(many.reasons.filter((r) => r.startsWith('tool:')).length, 5);
    assert.equal(many.nonStyleScore, rules.toolNames.cap); assert.equal(many.action, 'hide');
    assert.equal(score(item('Midjourney and Kling')).action, 'dim');
    assert.equal(score(item('#midjourney')).reasons.filter((r) => r.startsWith('tool:')).length, 0, 'a hashtag is not also a tool mention');
  });
  test('chatbot residue hides (strong) or dims (conversational)', () => {
    assert.equal(score(item('As an AI language model, I cannot browse the web.')).action, 'hide');
    assert.equal(score(item('As of my last knowledge update, the capital is Berlin.')).action, 'hide');
    assert.equal(score(item('Feel free to ask if you need more tips!')).action, 'dim');
    assert.ok(score(item('I hope this helps!')).reasons.includes('residue:hope_this_helps'));
  });
  test('everyday phrases are not strong chatbot leaks', () => {
    for (const t of ['Would you like me to bring anything to the party?', 'Great question! The answer is 42.', 'I hope this message finds you well. We regret to inform you the pool is closed.', 'As requested, here is the recipe my mom gave me']) {
      assert.notEqual(score(item(t)).action, 'hide', t + ' -> ' + score(item(t)).reasons.join(','));
    }
    assert.notEqual(score(item('Hope this helps someone: the bus 42 now stops at Main st'), 'x', modeFor('x', 'strict')).action, 'hide');
    assert.equal(score(item('Would you like me to generate a few alternative headlines for this article?')).action, 'hide');
    assert.equal(score(item('whisk the eggs until fluffy'), 'x', modeFor('x', 'strict')).action, 'none', 'whisk is an English verb');
    assert.ok(score(item('made it in Google Whisk')).reasons.some((r) => r.startsWith('tool:')));
  });
  test('a single prompt-metadata field only dims; a real dump (>= 2 fields) hides', () => {
    assert.equal(score(item('Beer sampler: 4 for $12 at the taproom tonight')).action, 'dim');
    assert.equal(score(item('CFG scale is not a thing in my job')).action, 'dim');
    assert.notEqual(score(item('Minecraft seed: 8675309 has a village at spawn'), 'x', modeFor('x', 'strict')).action, 'hide');
    assert.equal(score(item('Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 12345678')).action, 'hide');
  });
  test('prompt metadata hides', () => {
    assert.equal(score(item('Negative prompt: blurry. Steps: 30, Sampler: Euler a, CFG scale: 7')).action, 'hide');
    assert.equal(score(item('a castle --ar 16:9 --v 7')).action, 'hide');
    assert.equal(score(item('Steps: 10 000 today!')).action, 'none');
  });
  test('residue and prompt categories are capped at 1.0 each', () => {
    const v = score(item('Negative prompt: x. CFG scale: 7. Sampler: Euler a. Seed: 12345678. <lora:a:1>'));
    assert.equal(v.nonStyleScore, rules.scoring.categoryCaps.prompt + 0.5 /* prompt_colon disclosure is separate */);
  });
});

describe('tier 2: accounts', () => {
  test('user block list = 1.5 (handle, @handle, url forms), reason account:block', () => {
    for (const form of ['bob', '@bob', 'https://x.com/bob', '/bob/']) {
      const s = withSettings({ blockedAccounts: Object.assign({}, defaults.blockedAccounts, { x: [form] }) });
      const v = score(item('hello', { author: { handle: 'Bob' } }), 'x', s);
      assert.equal(v.action, 'hide', form); assert.equal(v.tier, 2); assert.equal(v.score, 1.5); deq(v.reasons, ['account:block']);
    }
  });
  test('seed list = 1.0, reason account:seed (x: @grok)', () => {
    const v = score(item('hello', { author: { handle: 'grok' } }), 'x');
    assert.equal(v.action, 'hide'); assert.equal(v.score, 1.0); deq(v.reasons, ['account:seed']);
  });
  test('allow list wins over everything, action none, reason account:allow', () => {
    const s = withSettings({ allowedAccounts: Object.assign({}, defaults.allowedAccounts, { youtube: ['@alice'] }), blockedAccounts: Object.assign({}, defaults.blockedAccounts, { youtube: ['alice'] }) });
    const v = score(item('#aiart made with AI', { labels: [{ type: 'platform_ai', id: 'youtube_badge' }], author: { handle: 'alice' } }), 'youtube', s);
    assert.equal(v.action, 'none'); deq(v.reasons, ['account:allow']); assert.equal(v.score, 0);
  });
  test('reddit AI subreddit seeds apply on /r/popular|/r/all and to RECOMMENDED posts only: dim in balanced (accounts.reddit.score 0.9), hide in strict', () => {
    deq(rules.accounts.reddit.appliesTo, ['popular']);
    const popular = score(item('cool', { extra: { subreddit: 'midjourney' }, surface: 'popular' }), 'reddit');
    assert.equal(popular.action, 'dim'); assert.equal(popular.score, 0.9); assert.ok(popular.reasons.includes('account:subreddit'));
    const strict = score(item('cool', { extra: { subreddit: 'midjourney' }, surface: 'popular' }), 'reddit', withSettings({ sites: Object.assign({}, defaults.sites, { reddit: { mode: 'strict' } }) }));
    assert.equal(strict.action, 'hide');
    // the "/" home feed mixes JOINED communities with recommendations: a subscriber's own r/MachineLearning post is left alone
    const joined = score(item('cool', { extra: { subreddit: 'MachineLearning' }, surface: 'home' }), 'reddit');
    assert.equal(joined.action, 'none');
    const inside = score(item('cool', { extra: { subreddit: 'r/midjourney' }, surface: 'profile' }), 'reddit');
    assert.equal(inside.action, 'none');
    const rec = score(item('cool', { extra: { subreddit: 'StableDiffusion', recommended: true }, surface: 'home' }), 'reddit');
    assert.equal(rec.action, 'dim');
    const recSearch = score(item('cool', { extra: { subreddit: 'StableDiffusion', recommended: true }, surface: 'search' }), 'reddit');
    assert.equal(recSearch.action, 'dim');
  });
  test('author matching uses handle, id or name', () => {
    const s = withSettings({ blockedAccounts: Object.assign({}, defaults.blockedAccounts, { youtube: ['UCabc123'] }) });
    assert.equal(score(item('x', { author: { handle: '@chan', id: 'UCabc123' } }), 'youtube', s).action, 'hide');
  });
});

describe('tier 3: style (dim only)', () => {
  test('style alone never exceeds styleCap and never hides, even in strict', () => {
    const slop = 'In today\'s fast-paced digital landscape, leveraging actionable insights is crucial. Moreover, a holistic approach fosters synergy. Furthermore, it empowers you to navigate the complexities of an ever-evolving paradigm. In conclusion, delve deeper. It\'s not just a tool — it\'s a game-changer. Thoughts?';
    for (const mode of ['balanced', 'strict']) {
      const v = score(item(slop), 'linkedin', modeFor('linkedin', mode));
      assert.equal(v.action, 'dim', mode); assert.equal(v.tier, 3); assert.equal(v.nonStyleScore, 0);
      assert.ok(v.styleScore <= rules.scoring.styleCap + 1e-9); assert.ok(v.reasons.every((r) => r.startsWith('style:')));
    }
  });
  test('style is skipped under minWords', () => {
    const v = score(item('delve tapestry pivotal'));
    assert.equal(v.score, 0); deq(v.reasons, []);
  });
  test('rule-based structure checks fire', () => {
    const r = (t) => score(item(t)).reasons;
    assert.ok(r('🔥 one thing\n✅ two things here\n✅ three things here\n🚀 four').includes('style:emoji_bullets'));
    assert.ok(r('Ship faster. Learn faster. Win faster. That is the whole plan for the year.').includes('style:parallel_triad'));
    assert.ok(r('Not luck.\nNot talent.\nJust showing up every day for years.').includes('style:stacked_negation'));
    assert.ok(r('**Bold claim** here with [a link](https://example.com) and more words').includes('style:markdown_leak'));
    const dashes = 'A thought — then another — and another — plus one more — and a final — point ' + 'word '.repeat(40);
    assert.ok(r(dashes).includes('style:em_dash_density'));
    assert.ok(r('This is one.\nThat is two.\nHere is three.\nThere is four.\nDone now.').includes('style:one_line_paragraph_stack'));
    assert.ok(!r('1. eggs\n2. milk\n3. bread\n4. butter\n5. jam').includes('style:one_line_paragraph_stack'), 'lists are not paragraph stacks');
    assert.ok(r('🔥💡✅🚀💪 short post with lots of slop emoji 🌟⭐👇').includes('style:emoji_density'));
  });
  test('human tells subtract from style but never below zero and never touch tier 0/1', () => {
    const slopHuman = 'lol it\'s not just a tool — it\'s a game-changer tbh, moreover furthermore idk, delve delve';
    const v = score(item(slopHuman));
    assert.ok(v.reasons.some((r) => r.startsWith('style:human_')));
    assert.ok(v.styleScore >= 0);
    const labelled = score(item('lol bruh tbh ngl idk smh ' + slopHuman, { labels: [{ type: 'platform_ai', id: 'x_text' }] }));
    assert.equal(labelled.action, 'hide'); assert.equal(labelled.nonStyleScore, 1.5);
  });
  test('invented_suffix does not fire on "underscore"', () => {
    const v = score(item('This underscores the point we discussed earlier in the meeting'));
    assert.ok(!v.reasons.includes('style:human_invented_suffix'));
  });
  test('engagement bait, closers and vocab are capped per category', () => {
    const bait = score(item('🧵 thread 👇 1/ rt if you agree, follow for more, save this post, tag someone who needs this, bookmark this, read that again'));
    assert.ok(bait.styleScore <= rules.style.engagementBait.cap + 1e-9);
    const vocab = score(item('delve tapestry pivotal crucial meticulous intricate underscore showcase landscape realm leverage seamless groundbreaking'));
    assert.ok(vocab.styleScore <= rules.style.vocabAlways.cap + 1e-9);
    assert.ok(score(item('we will streamline and facilitate and enhance a myriad of things')).reasons.includes('style:vocab_cluster'));
    assert.ok(!score(item('we will streamline this process for everyone next week')).reasons.includes('style:vocab_cluster'));
  });
});

describe('modes, thresholds and settings switches', () => {
  test('mode off -> none with no reasons', () => {
    const v = score(item('#aiart made with AI', { labels: [{ type: 'platform_ai', id: 'x' }] }), 'x', modeFor('x', 'off'));
    deq(v, { score: 0, nonStyleScore: 0, styleScore: 0, tier: null, reasons: [], action: 'none', mode: 'off' });
  });
  test('enabled:false behaves like off', () => {
    assert.equal(score(item('#aiart'), 'x', withSettings({ enabled: false })).action, 'none');
  });
  test('strict vs balanced thresholds', () => {
    const t = 'Synthetic voice test'; // synthetic_media 1.0 ... use a 0.8 signal instead:
    const weakHide = item('Midjourney and Kling, side by side'); // 2 tools = 0.8
    assert.equal(score(weakHide, 'x', modeFor('x', 'balanced')).action, 'dim');
    assert.equal(score(weakHide, 'x', modeFor('x', 'strict')).action, 'hide');
    const weakDim = item('Played with Grok for a bit'); // 0.4
    assert.equal(score(weakDim, 'x', modeFor('x', 'balanced')).action, 'none');
    assert.equal(score(weakDim, 'x', modeFor('x', 'strict')).action, 'dim');
    assert.ok(t);
  });
  test('unknown mode falls back to none, missing site config falls back to balanced', () => {
    assert.equal(score(item('#aiart'), 'x', modeFor('x', 'bogus')).action, 'none');
    assert.equal(score(item('#aiart'), 'threads', defaults).action, 'hide');
  });
  test('dimInsteadOfHide turns hide into dim', () => {
    const v = score(item('x', { labels: [{ type: 'platform_ai', id: 'l' }] }), 'x', withSettings({ dimInsteadOfHide: true }));
    assert.equal(v.action, 'dim'); assert.equal(v.score, 1.5);
  });
  test('custom phrases and hashtags score 1.0 (hide)', () => {
    const s = withSettings({ customPhrases: ['Let that sink in'], customHashtags: ['MyTag'] });
    const p = score(item('ok. LET THAT SINK IN.'), 'x', s);
    assert.equal(p.action, 'hide'); assert.ok(p.reasons.includes('custom:phrase'));
    const h = score(item('post #mytag'), 'x', s);
    assert.equal(h.action, 'hide'); assert.ok(h.reasons.includes('custom:#mytag'));
    assert.equal(score(item('post #mytag'), 'x', defaults).action, 'none');
  });
  test('custom phrases match whole words, not raw substrings ("ai" must not hide "said" / "wait")', () => {
    const s = withSettings({ customPhrases: ['ai', 'bot'] });
    assert.equal(score(item('she said wait, think about it'), 'x', s).action, 'none');
    assert.equal(score(item('this is AI.'), 'x', s).action, 'hide');
    assert.ok(score(item('a bot wrote this'), 'x', s).reasons.includes('custom:phrase'));
  });
  test('rules override via a different rules object compiles separately (cache keyed by identity)', () => {
    const custom = JSON.parse(JSON.stringify(rules));
    custom.hashtags.strong = ['#banana'];
    const v = NoSlop.scorer.score(item('#banana'), custom, defaults, 'x');
    assert.equal(v.action, 'hide');
    assert.equal(NoSlop.scorer.score(item('#banana'), rules, defaults, 'x').action, 'none');
    assert.equal(NoSlop.scorer.compile(custom), NoSlop.scorer.compile(custom), 'compile is cached');
  });
  test('verdict shape and rounding', () => {
    const v = score(item('Made with AI'));
    for (const k of ['score', 'nonStyleScore', 'styleScore', 'tier', 'reasons', 'action', 'mode']) assert.ok(k in v, k);
    assert.equal(v.score, Math.round(v.score * 1000) / 1000);
  });
  test('unicode + case-insensitive matching', () => {
    assert.equal(score(item('MADE WITH AI — żółć')).action, 'hide');
    assert.ok(score(item('Łódź #AIart')).reasons.includes('hashtag:#aiart'));
    assert.equal(score(item("It’s AI generated, curly apostrophe")).action, 'hide');
  });
  test('garbage input never throws', () => {
    assert.equal(score(null).action, 'none');
    assert.equal(score({}).action, 'none');
    assert.equal(NoSlop.scorer.score(item('x'), null, null, null).action, 'none');
    assert.equal(score(item(12345, { hashtags: null, labels: 'nope', author: null })).action, 'none');
  });
  test('humanizeReason gives short labels', () => {
    const h = NoSlop.scorer.humanizeReason;
    assert.equal(h('label:youtube_badge'), 'platform AI label (youtube badge)');
    assert.equal(h('hashtag:#aiart'), 'AI hashtag #aiart');
    assert.equal(h('account:block'), 'account you blocked');
    assert.equal(h('tool:midjourney'), 'mentions midjourney');
  });
});

describe('rules.json integrity', () => {
  test('every regex compiles with iu and every rule id is implemented', () => {
    const r = readRules();
    let n = 0;
    (function walk(o) {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if ((k === 'regex' || /Regex$/.test(k)) && typeof v === 'string') { new RegExp(v, 'iu'); n++; } else walk(v); }
    })(r);
    assert.ok(n > 50);
    const impl = NoSlop.scorer._rules;
    for (const e of [...r.style.structure, ...r.style.humanTells]) if (e.rule) assert.ok(typeof impl[e.rule] === 'function', 'rule ' + e.rule);
  });
  test('seed lists bundle only MIT sources (no AiSList / OpenSlop content)', () => {
    const txt = JSON.stringify(readRules());
    assert.ok(!/raw\.githubusercontent\.com\/Override92|aislist_blocklist\.txt|callmety\/openslop/i.test(txt), 'no AiSList/OpenSlop URLs or files bundled');
    deq(readRules().accounts.youtube.block, []);
  });
});
