// adapters/instagram.js tests (owner: adapter:instagram). Fixtures are SYNTHETIC (tests/fixtures/instagram/*.html):
// instagram.com is a login wall when logged out, so markup is hand-built from research §2.4 and marked as such.
// Run: cd /Users/kamilszwed/Projects/NoSlop && node --test tests/adapters/instagram.test.mjs
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadScripts, CORE_FILES, ROOT, settle } from '../helpers/load.mjs';

// Values produced inside the jsdom vm context have another realm's prototypes; compare structurally.
const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);

const FILES = [...CORE_FILES, 'adapters/instagram.js'];
const FIX = (name) => fs.readFileSync(path.join(ROOT, 'tests/fixtures/instagram', name), 'utf8');
const FEED = FIX('synthetic-feed.html');          // shared fixture (fixtures agent): 3 articles
const MOBILE = FIX('synthetic-mobile-feed.html'); // mine: hashtag links, style slop, Sponsored, localized label
const REELS = FIX('synthetic-reels.html');        // mine: [data-virtualized] list with 3 videos
const EXPLORE = FIX('synthetic-explore.html');    // mine: profile/explore grid tiles + profile label
const page = (inner) => `<!doctype html><html lang="en"><head></head><body>${inner}</body></html>`;
const HOME = 'https://www.instagram.com/';
// The shared fixture's 3rd article has no /p/ link: the adapter falls back to author + <time datetime>.
const ID3 = 't:meta_ai_fan:2026-11-02T06:00:00.000Z';

let ctx;
async function load(inner, url = HOME) {
  ctx = await loadScripts(FILES, { url, html: page(inner) });
  ctx.adapter = ctx.NoSlop.adapters.pick(ctx.window.location);
  return ctx;
}
async function boot(inner, { url = HOME, settings = null, beforeStart = null } = {}) {
  await load(inner, url);
  const { NoSlop, window } = ctx;
  if (settings) await NoSlop.host.patchSettings(settings);
  if (beforeStart) await beforeStart(ctx);
  await NoSlop.engine.start({ adapter: ctx.adapter, rules: NoSlop.rules, host: NoSlop.host });
  await settle();
  return ctx;
}
afterEach(() => { if (ctx && ctx.NoSlop && ctx.NoSlop.engine.running) ctx.NoSlop.engine.stop(); });

const items = (root) => ctx.adapter.findItems(root || ctx.document.body).map((el) => ({ el, item: ctx.adapter.extract(el) }));
const byId = (id) => ctx.document.querySelector(`[data-noslop-id="${id}"]`);
const articleWithLink = (id) => ctx.document.querySelector(`a[href^="/p/${id}/"]`).closest('article');

describe('registration and routing', () => {
  test('registers a real (non-placeholder) adapter and matches instagram hosts only', async () => {
    await load('');
    const a = ctx.adapter;
    assert.equal(a.site, 'instagram');
    assert.ok(!a.placeholder);
    assert.equal(a.hideStrategy, 'collapse-inner');
    assert.equal(a.hideStrategy, ctx.NoSlop.rules.sites.instagram.hideStrategy, 'strategy from rules.sites.instagram');
    for (const h of ['www.instagram.com', 'instagram.com', 'm.instagram.com']) assert.ok(a.matches({ hostname: h }), h);
    for (const h of ['instagram.com.evil.test', 'www.youtube.com', 'notinstagram.com', '']) assert.ok(!a.matches({ hostname: h }), h);
  });
  test('surface(): home / explore=search / reels / watch / profile / other', async () => {
    await load('');
    const s = (p) => ctx.adapter.surface({ pathname: p });
    assert.equal(s('/'), 'home');
    assert.equal(s('/explore/'), 'search');
    assert.equal(s('/explore/search/'), 'search');
    assert.equal(s('/reels/'), 'reels');
    assert.equal(s('/reels/SYNTHR0002/'), 'reels');
    assert.equal(s('/reel/SYNTHR0002/'), 'reels');
    assert.equal(s('/p/SYNTH000001/'), 'watch');
    assert.equal(s('/render.farm.ai/'), 'profile');
    assert.equal(s('/render.farm.ai/reels/'), 'profile');
    assert.equal(s('/direct/inbox/'), 'other');
    assert.equal(s('/accounts/login/'), 'other');
    assert.equal(ctx.document.documentElement.getAttribute('data-noslop-ig-surface'), 'other', 'surface is stamped on <html>');
  });
  test('logged-out pages yield no items (login form; explore with topic links only)', async () => {
    await load('<div><form><input name="u"><input type="password"></form><a href="/accounts/emailsignup/">Sign up</a></div>');
    assert.equal(items().length, 0);
    await load('<main role="main"><div><div><a href="/explore/tags/nycmarathon/"><span>Nycmarathon • 24 posts</span></a></div></div></main>', 'https://www.instagram.com/explore/');
    assert.equal(items().length, 0, 'explore topic links without <img> are not tiles');
  });
});

describe('extraction: home feed articles (shared synthetic-feed fixture)', () => {
  test('id / author / caption / hashtags / labels / media', async () => {
    await load(FEED);
    const list = items();
    assert.equal(list.length, 3);
    const [a, b, c] = list.map((x) => x.item);
    deq(list.map((x) => x.item.id), ['SYNTH000001', 'SYNTH000002', ID3]);
    deq(list.map((x) => x.item.kind), ['post', 'post', 'post']);
    deq(list.map((x) => x.item.surface), ['home', 'home', 'home']);
    // author from the header profile link
    assert.equal(a.author.handle, 'human_photos'); assert.equal(a.author.name, 'human_photos');
    assert.equal(b.author.handle, 'dreamscapes.ai');
    assert.equal(c.author.handle, 'meta_ai_fan');
    // caption text excludes the username and the likes line
    assert.equal(a.text, 'sunday market haul 🍎');
    assert.match(b.text, /^A floating monastery above the clouds/);
    assert.ok(!/128 likes|human_photos/.test(a.text));
    deq(b.hashtags, ['#aiart', '#midjourney', '#aiartcommunity']);
    deq(a.hashtags, []);
    // tier-0 labels: whole text node equal to the platform string
    deq(a.labels, []);
    deq(b.labels, [{ type: 'platform_ai', id: 'instagram_ai_info', text: 'AI info' }]);
    deq(c.labels, [{ type: 'platform_ai', id: 'instagram_imagined', text: 'Imagined with AI' }]);
    deq(a.media, ['image']);
    assert.ok(a.links.some((l) => /\/p\/SYNTH000001\//.test(l)));
    assert.equal(a.extra.layout, 'article');
  });
  test('a caption that merely mentions the label words is NOT a platform label; an aria-label is', async () => {
    await load('<main role="main"><article><header><a href="/talker/"><span dir="auto">talker</span></a></header><section><h1><a href="/talker/">talker</a> <span dir="auto">instagram added an AI info label to my friend\'s post lol</span></h1></section><a href="/p/SYNTHX0001/c/0/">comments</a></article>' +
      '<article><header><a href="/iconic/"><span dir="auto">iconic</span></a><div role="img" aria-label="AI info"></div></header><section><h1><a href="/iconic/">iconic</a> <span dir="auto">hello</span></h1></section><a href="/p/SYNTHX0002/">x</a></article></main>');
    const [p, q] = items().map((x) => x.item);
    deq(p.labels, []);
    assert.match(p.text, /AI info label/);
    deq(q.labels, [{ type: 'platform_ai', id: 'instagram_ai_info', text: 'AI info' }]);
  });
  test('skeleton article without any post link or media id is skipped (null)', async () => {
    await load('<main role="main"><article><div><header></header><div role="progressbar" data-visualcompletion="loading-state"></div></div></article></main>');
    const list = items();
    assert.equal(list.length, 1);
    assert.equal(list[0].item, null);
  });
  test('findItems includes the root itself when the root is an article (observer roots)', async () => {
    await load(FEED);
    const art = ctx.document.querySelector('article');
    const found = ctx.adapter.findItems(art);
    assert.equal(found.length, 1);
    assert.equal(found[0], art);
    assert.equal(ctx.adapter.findItems(art.querySelector('section')).length, 0);
  });
});

describe('extraction: mobile-web layout (header outside main)', () => {
  test('hashtags from /explore/tags/ links, Sponsored -> promoted, localized label has no tier-0 recall by default', async () => {
    await load(MOBILE);
    const list = items();
    deq(list.map((x) => x.item.id), ['SYNTHM0001', 'SYNTHM0002', 'SYNTHM0003', 'SYNTHM0004']);
    const [tagged, slop, ad, de] = list.map((x) => x.item);
    deq(tagged.hashtags, ['#aiart', '#cityscape']);
    assert.match(tagged.text, /golden hour/);
    assert.match(slop.text, /working smarter/);
    deq(ad.labels, [{ type: 'promoted', id: 'instagram_sponsored', text: 'Sponsored' }]);
    assert.ok(!/Sponsored/.test(ad.text));
    deq(de.labels, [], 'a non-English label string is invisible to tier-0 until the user adds it (documented gap)');
    assert.equal(de.text, 'Abendlicht über der Spree');
    assert.ok(ctx.adapter.labelStrings().includes('ai info'));
  });
  test('rules.labels.instagram.text is read live: a rulesOverride adding "KI-Info" gives the localized post a label', async () => {
    await load(MOBILE);
    const rules = JSON.parse(JSON.stringify(ctx.NoSlop.rules));
    rules.labels.instagram.text.push('KI-Info');
    await ctx.NoSlop.host.patchSettings({ rulesOverride: rules });
    await ctx.NoSlop.engine.start({ adapter: ctx.adapter, rules: ctx.NoSlop.rules, host: ctx.NoSlop.host });
    await settle();
    assert.ok(ctx.adapter.labelStrings().includes('ki-info'));
    const de = byId('SYNTHM0004');
    assert.equal(de.getAttribute('data-noslop-action'), 'hide');
    deq(ctx.NoSlop.engine.stateOf(de).item.labels, [{ type: 'platform_ai', id: 'instagram_text', text: 'KI-Info' }]);
  });
});

describe('extraction: reels and grid tiles', () => {
  test('reels: each [data-virtualized] child with a <video> is a short with id from its /reel/ link', async () => {
    await load(REELS, 'https://www.instagram.com/reels/SYNTHR0001/');
    const list = items();
    deq(list.map((x) => x.item.id), ['SYNTHR0001', 'SYNTHR0002', 'SYNTHR0003']);
    for (const { item } of list) { assert.equal(item.kind, 'short'); assert.equal(item.surface, 'reels'); deq(item.media, ['video']); assert.equal(item.extra.layout, 'reel'); }
    const [r1, r2] = list.map((x) => x.item);
    assert.equal(r1.author.handle, 'surf_daily');
    assert.equal(r1.text, 'dawn patrol, 4 ft and glassy');
    deq(r1.labels, []);
    assert.equal(r2.author.handle, 'neon.dreams.ai');
    assert.match(r2.text, /cyber city flythrough/);
    assert.ok(!/AI info/.test(r2.text), 'label text is not part of the caption');
    deq(r2.hashtags, ['#aivideo']);
    deq(r2.labels, [{ type: 'platform_ai', id: 'instagram_ai_info', text: 'AI info' }]);
    assert.equal(ctx.document.querySelectorAll('a[href="/reels/"]').length, 1, 'nav entry point present');
  });
  test('reels: without a /reel/ link the media path is the (fallback) id', async () => {
    await load('<main role="main"><div data-virtualized="1"><div><video src="https://scontent.example/o1/v/t2/ABC.mp4"></video><span dir="auto">hi</span></div><div><span>no video, not an item</span></div></div></main>', 'https://www.instagram.com/reels/');
    const list = items();
    assert.equal(list.length, 1);
    assert.equal(list[0].item.id, 'media:/o1/v/t2/ABC.mp4');
  });
  test('grid tiles (profile): id from the tile href, author from the path, profile-level AI label applied to every tile', async () => {
    await load(EXPLORE, 'https://www.instagram.com/render.farm.ai/');
    const list = items();
    deq(list.map((x) => x.item.id), ['SYNTHE0001', 'SYNTHE0002', 'SYNTHE0003', 'SYNTHE0004']);
    deq(list.map((x) => x.item.kind), ['post', 'post', 'video', 'post']);
    for (const { el, item } of list) {
      assert.equal(el.tagName, 'A');
      assert.equal(item.surface, 'profile');
      assert.equal(item.author.handle, 'render.farm.ai');
      assert.equal(item.text, '');
      deq(item.media, ['image']);
      assert.equal(item.extra.layout, 'tile');
      deq(item.labels, [{ type: 'platform_ai', id: 'instagram_ai_profile', text: 'AI-generated profile' }]);
    }
  });
  test('grid tiles (explore): no author, no profile label; feed-article links never become tiles', async () => {
    await load(EXPLORE.replace(/<header>[\s\S]*?<\/header>/, ''), 'https://www.instagram.com/explore/');
    const list = items();
    assert.equal(list.length, 4);
    for (const { item } of list) { assert.equal(item.surface, 'search'); assert.equal(item.author.handle, ''); deq(item.labels, []); }
    await load(FEED);
    assert.ok(items().every((x) => x.el.tagName === 'ARTICLE'), 'the /p/ links inside articles are not tiles');
  });
});

describe('engine end-to-end on the home feed', () => {
  test('labelled post hidden with a stub (collapse-inner), plain post untouched, hashtag post hidden', async () => {
    await boot(FEED);
    const plain = byId('SYNTH000001'), labelled = byId('SYNTH000002'), imagined = byId(ID3);
    assert.equal(plain.getAttribute('data-noslop-action'), 'none');
    assert.ok(!plain.classList.contains('noslop-hidden') && !plain.classList.contains('noslop-dim'));
    assert.equal(plain.querySelector('.noslop-stub'), null);

    assert.equal(labelled.getAttribute('data-noslop-action'), 'hide');
    assert.ok(labelled.classList.contains('noslop-hidden'));
    assert.ok(labelled.classList.contains('noslop-hidden--collapse-inner'));
    assert.equal(labelled.tagName, 'ARTICLE', 'the article stays mounted');
    const stub = labelled.querySelector(':scope > .noslop-stub');
    assert.ok(stub, 'stub is the article\'s first child');
    assert.equal(labelled.firstElementChild, stub);
    assert.match(stub.textContent, /Hidden: AI content/);
    assert.match(stub.textContent, /platform AI label/);
    assert.match(stub.querySelector('[data-noslop-act="never"]').textContent, /Never show @dreamscapes\.ai/);
    const v = ctx.NoSlop.engine.stateOf(labelled).verdict;
    assert.equal(v.tier, 0);
    assert.ok(v.reasons.includes('label:instagram_ai_info'), v.reasons.join(','));
    assert.ok(v.reasons.includes('hashtag:#aiart'));

    assert.equal(imagined.getAttribute('data-noslop-action'), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(imagined).verdict.reasons.includes('label:instagram_imagined'));
  });
  test('mobile feed: #aiart post hidden, style-slop caption dimmed (not hidden), ad hidden only with hideAds', async () => {
    await boot(MOBILE);
    const tagged = byId('SYNTHM0001'), slop = byId('SYNTHM0002'), ad = byId('SYNTHM0003'), de = byId('SYNTHM0004');
    assert.equal(tagged.getAttribute('data-noslop-action'), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(tagged).verdict.reasons.includes('hashtag:#aiart'));
    assert.equal(slop.getAttribute('data-noslop-action'), 'dim');
    assert.ok(slop.classList.contains('noslop-dim') && !slop.classList.contains('noslop-hidden'));
    const badge = slop.querySelector(':scope > .noslop-badge');
    assert.ok(badge); assert.equal(badge.textContent, 'AI?');
    assert.equal(ctx.NoSlop.engine.stateOf(slop).verdict.tier, 3);
    assert.equal(ad.getAttribute('data-noslop-action'), 'none');
    assert.equal(de.getAttribute('data-noslop-action'), 'none', 'localized label: no recall without the user\'s string');
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideAds: true }) });
    await settle();
    assert.equal(byId('SYNTHM0003').getAttribute('data-noslop-action'), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(byId('SYNTHM0003')).verdict.reasons.includes('ad:promoted'));
  });
  test('blocked account (Never show) hides the author\'s other posts; allowed account is never hidden', async () => {
    await boot(FEED + MOBILE.replace(/SYNTHM000(\d)/g, 'SYNTHB000$1').replace(/prompt\.palace/g, 'dreamscapes.ai'));
    assert.equal(byId('SYNTHB0001').getAttribute('data-noslop-action'), 'hide');
    byId('SYNTH000002').querySelector('[data-noslop-act="never"]').click();
    await settle();
    deq((await ctx.NoSlop.host.getSettings()).blockedAccounts.instagram, ['dreamscapes.ai']);
    assert.ok(ctx.NoSlop.engine.stateOf(byId('SYNTHB0001')).verdict.reasons.includes('account:block'));
    await ctx.NoSlop.host.patchSettings({ blockedAccounts: { instagram: [] }, allowedAccounts: { instagram: ['dreamscapes.ai'] } });
    await settle();
    assert.equal(byId('SYNTH000002').getAttribute('data-noslop-action'), 'none', 'allow list wins even over a platform label');
  });
  test('Show on the stub unhides for the session', async () => {
    await boot(FEED);
    byId('SYNTH000002').querySelector('[data-noslop-act="show"]').click();
    await settle();
    const art = articleWithLink('SYNTH000002');
    assert.equal(art.getAttribute('data-noslop-action'), 'none');
    assert.ok(!art.classList.contains('noslop-hidden'));
    assert.equal(art.querySelector('.noslop-stub'), null);
  });
});

describe('virtualization: SPA re-render and cell reuse', () => {
  test('remove + re-append keeps the hidden state with exactly one stub and no extra stats', async () => {
    await boot(FEED);
    const art = byId('SYNTH000002');
    const parent = art.parentNode, next = art.nextSibling;
    art.remove();
    await settle();
    parent.insertBefore(art, next);
    await settle(5);
    assert.equal(art.getAttribute('data-noslop-action'), 'hide');
    assert.ok(art.classList.contains('noslop-hidden--collapse-inner'));
    assert.equal(art.querySelectorAll('.noslop-stub').length, 1);
    // a fresh element for the same post id is hidden straight from the verdict cache
    const orig = ctx.NoSlop.scorer.score; let calls = 0; ctx.NoSlop.scorer.score = (...a) => { calls++; return orig(...a); };
    parent.insertAdjacentHTML('beforeend', art.outerHTML.replace(/<div class="noslop-stub[\s\S]*?<\/div>/, ''));
    await settle(5);
    ctx.NoSlop.scorer.score = orig;
    assert.equal(calls, 0, 'cache hit by post id');
    const copies = ctx.document.querySelectorAll('[data-noslop-id="SYNTH000002"]');
    assert.equal(copies.length, 2);
    assert.ok(copies[1].classList.contains('noslop-hidden'));
    ctx.NoSlop.engine.flushStats();
    const hides = ctx.NoSlop.host.__reports.filter((r) => r.action === 'hide').reduce((n, r) => n + r.count, 0);
    assert.equal(hides, 2, 'one hide per post id (SYNTH000002 + the Imagined-with-AI post)');
  });
  test('cell reuse: the same article element re-rendered for another post is re-verdicted', async () => {
    await boot(FEED);
    const art = byId('SYNTH000002');
    assert.equal(art.getAttribute('data-noslop-action'), 'hide');
    // Instagram re-renders the article's inner tree for a different post (plain, no label, new links)
    const plainInner = byId('SYNTH000001').innerHTML.replace(/SYNTH000001/g, 'SYNTH000009').replace(/human_photos/g, 'bakery.stories');
    art.innerHTML = plainInner;
    await settle(6);
    assert.equal(art.getAttribute('data-noslop-id'), 'SYNTH000009');
    assert.equal(art.getAttribute('data-noslop-action'), 'none');
    assert.ok(!art.classList.contains('noslop-hidden'));
    assert.equal(art.querySelector('.noslop-stub'), null);
    assert.equal(ctx.NoSlop.engine.stateOf(art).item.author.handle, 'bakery.stories');
    // ... and back to an AI-labelled post
    art.innerHTML = byId(ID3).innerHTML.replace(/meta_ai_fan/g, 'meta_ai_fan2').replace(/<div class="noslop-stub[\s\S]*?<\/div>/, '');
    await settle(6);
    assert.equal(art.getAttribute('data-noslop-id'), 't:meta_ai_fan2:2026-11-02T06:00:00.000Z');
    assert.equal(art.getAttribute('data-noslop-action'), 'hide');
    assert.equal(art.querySelectorAll(':scope > .noslop-stub').length, 1);
  });
  test('SPA navigation: pushState to a profile re-reads the surface and processes tiles with the profile label', async () => {
    await boot(FEED);
    assert.equal(ctx.NoSlop.engine.surface, 'home');
    ctx.window.history.pushState({}, '', '/render.farm.ai/');
    ctx.document.querySelector('main').outerHTML = EXPLORE;
    await settle(8);
    assert.equal(ctx.NoSlop.engine.surface, 'profile');
    assert.equal(ctx.document.documentElement.getAttribute('data-noslop-ig-surface'), 'profile');
    const tile = byId('SYNTHE0001');
    assert.ok(tile);
    assert.equal(tile.getAttribute('data-noslop-action'), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(tile).verdict.reasons.includes('label:instagram_ai_profile'));
    assert.equal(ctx.document.querySelectorAll('.noslop-stub').length, 4);
  });
});

describe('reels: hiding, media, auto-advance, surfaces', () => {
  const REEL_URL = 'https://www.instagram.com/reels/SYNTHR0002/';
  function spyScroll(c) {
    const calls = [];
    c.window.Element.prototype.scrollIntoView = function () { calls.push(this); };
    return calls;
  }
  test('a labelled reel is collapsed, its video paused+muted, and the player advances to the next reel', async () => {
    let calls;
    await boot(REELS, { url: REEL_URL, beforeStart: (c) => { calls = spyScroll(c); } });
    const list = ctx.document.querySelector('[data-virtualized]');
    const [r1, r2, r3] = list.children;
    assert.equal(r1.getAttribute('data-noslop-action'), 'none');
    assert.equal(r2.getAttribute('data-noslop-action'), 'hide');
    assert.ok(r2.classList.contains('noslop-hidden--collapse-inner'));
    assert.equal(r2.querySelector('video').muted, true);
    assert.equal(r2.querySelector('video').paused, true);
    assert.equal(r1.querySelector('video').muted, false, 'other reels untouched');
    assert.equal(calls.length, 1, 'advanced once');
    assert.equal(calls[0], r3, 'scrollIntoView on the next reel');
    assert.equal(r3.getAttribute('data-noslop-action'), 'none');
  });
  test('no advance when the hidden reel is not the active one, or when settings.reelsAutoAdvance is false', async () => {
    let calls;
    await boot(REELS, { url: 'https://www.instagram.com/reels/SYNTHR0001/', beforeStart: (c) => { calls = spyScroll(c); } });
    assert.equal(ctx.document.querySelector('[data-virtualized]').children[1].getAttribute('data-noslop-action'), 'hide');
    assert.equal(calls.length, 0);
    ctx.NoSlop.engine.stop();
    await boot(REELS, { url: REEL_URL, settings: { reelsAutoAdvance: false }, beforeStart: (c) => { calls = spyScroll(c); } });
    assert.equal(ctx.document.querySelector('[data-virtualized]').children[1].getAttribute('data-noslop-action'), 'hide');
    assert.equal(calls.length, 0);
  });
  test('surfaces: hideReels hides the Reels nav entry and the /reels/ surface, but never the home feed', async () => {
    await boot(REELS, { url: REEL_URL });
    const nav = ctx.document.querySelector('a[href="/reels/"]');
    const main = ctx.document.querySelector('main[role="main"]');
    assert.ok(!nav.classList.contains('noslop-surface') && !main.classList.contains('noslop-surface'));
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideReels: true }) });
    await settle();
    assert.ok(nav.classList.contains('noslop-surface'));
    assert.equal(nav.getAttribute('data-noslop-surface'), 'hideReels');
    assert.ok(main.classList.contains('noslop-surface'), 'the reels page main is hidden');
    for (const v of main.querySelectorAll('video')) assert.equal(v.muted, true);
    ctx.NoSlop.engine.flushStats();
    assert.ok(ctx.NoSlop.host.__reports.some((r) => r.reason === 'surface:hideReels' && r.action === 'hide'));
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideReels: false }) });
    await settle();
    assert.ok(!nav.classList.contains('noslop-surface') && !main.classList.contains('noslop-surface'));
    ctx.NoSlop.engine.stop();
    // Home feed that happens to contain a [data-virtualized] wrapper with a video: hideReels must not blank it.
    await boot(MOBILE.replace('<main role="main"><div>', '<main role="main"><div data-virtualized="1"><div><video></video></div>'), { settings: { surfaces: { hideReels: true } } });
    assert.ok(ctx.document.querySelector('a[href="/reels/"]').classList.contains('noslop-surface'));
    assert.ok(!ctx.document.querySelector('main[role="main"]').classList.contains('noslop-surface'));
    assert.equal(byId('SYNTHM0001').getAttribute('data-noslop-action'), 'hide', 'feed still processed');
  });
  test('mode off unapplies reels and articles; strict/balanced thresholds come from settings.sites.instagram', async () => {
    await boot(FEED, { settings: { sites: { instagram: { mode: 'off' } } } });
    assert.equal(ctx.document.querySelectorAll('.noslop-hidden, .noslop-stub').length, 0);
    await ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.engine.settings.sites, { instagram: { mode: 'strict' } }) });
    await settle();
    assert.equal(byId('SYNTH000002').getAttribute('data-noslop-action'), 'hide');
    assert.equal(ctx.NoSlop.engine.stateOf(byId('SYNTH000002')).verdict.mode, 'strict');
  });
});

describe('full script stack', () => {
  test('content.js picks the instagram adapter on www.instagram.com and the engine starts', async () => {
    const js = ['rules.js', 'lib/dom.js', 'lib/scorer.js', 'lib/host-extension.js', 'lib/engine.js', 'adapters/youtube.js', 'adapters/x.js', 'adapters/instagram.js', 'adapters/facebook.js', 'adapters/tiktok.js', 'adapters/reddit.js', 'adapters/linkedin.js', 'content.js'];
    const c = await loadScripts(js, { url: HOME, html: page(FEED) });
    await settle(3);
    assert.equal(c.NoSlop.engine.running, true);
    assert.equal(c.NoSlop.engine.site, 'instagram');
    assert.equal(c.document.querySelector('[data-noslop-id="SYNTH000002"]').getAttribute('data-noslop-action'), 'hide');
    c.NoSlop.engine.stop();
  });
});
