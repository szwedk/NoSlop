// adapters/facebook.js tests. jsdom via tests/helpers/load.mjs.
// Fixtures: tests/fixtures/facebook/synthetic-feed.html (fixtures agent) and synthetic-feed-cases.html (ours).
// Both are SYNTHETIC (facebook.com is a login wall when logged out — see tests/fixtures/facebook/notes.md).
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadScripts, CORE_FILES, ROOT, settle } from '../helpers/load.mjs';

const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);
const FILES = [...CORE_FILES, 'adapters/facebook.js'];
const URL = 'https://www.facebook.com/';
const fixture = (name) => fs.readFileSync(path.join(ROOT, 'tests/fixtures/facebook', name), 'utf8');
const page = (body) => '<!doctype html><html><head></head><body>' + body + '</body></html>';

let ctx;
async function boot(body, opts = {}) {
  ctx = await loadScripts(FILES, { url: opts.url || URL, html: page(body) });
  const { NoSlop, window } = ctx;
  if (opts.settings) await NoSlop.host.patchSettings(opts.settings);
  await NoSlop.engine.start({ adapter: NoSlop.adapters.pick(window.location), rules: NoSlop.rules, host: NoSlop.host });
  await settle();
  return ctx;
}
afterEach(() => { if (ctx && ctx.NoSlop && ctx.NoSlop.engine.running) ctx.NoSlop.engine.stop(); });

const unit = (n) => ctx.document.querySelector(`[aria-posinset="${n}"]`);
const action = (n) => unit(n).getAttribute('data-noslop-action');
const adapter = () => ctx.NoSlop.adapters.list()[0];

async function extractAll(file) {
  ctx = await loadScripts(FILES, { url: URL, html: page(fixture(file)) });
  const a = adapter();
  const els = a.findItems(ctx.document);
  const items = new Map();
  for (const el of els) items.set(el.getAttribute('aria-posinset'), a.extract(el));
  return { a, els, items };
}

describe('registration, matching, surfaces', () => {
  test('registers as "facebook" with the height-zero strategy and matches facebook.com hosts only', async () => {
    const { NoSlop } = await loadScripts(FILES, { url: URL });
    const a = NoSlop.adapters.list()[0];
    assert.equal(a.site, 'facebook');
    assert.equal(a.placeholder, undefined);
    assert.equal(a.hideStrategy, 'height-zero');
    assert.equal(NoSlop.rules.sites.facebook.hideStrategy, 'height-zero');
    for (const h of ['www.facebook.com', 'facebook.com', 'm.facebook.com', 'web.facebook.com']) assert.ok(a.matches({ hostname: h }), h);
    for (const h of ['facebook.com.evil.test', 'instagram.com', 'notfacebook.com', '']) assert.ok(!a.matches({ hostname: h }), h || '(empty)');
  });
  test('surface() from the pathname', async () => {
    const { NoSlop } = await loadScripts(FILES, { url: URL });
    const a = NoSlop.adapters.list()[0];
    const s = (p) => a.surface({ pathname: p });
    assert.equal(s('/'), 'home'); assert.equal(s('/home.php'), 'home');
    assert.equal(s('/search/posts/?q=x'), 'search');
    assert.equal(s('/watch/'), 'watch'); assert.equal(s('/someone/videos/123'), 'watch');
    assert.equal(s('/reel/123'), 'reels'); assert.equal(s('/reels/'), 'reels');
    assert.equal(s('/groups/abc'), 'other'); assert.equal(s('/marketplace/'), 'other'); assert.equal(s('/login/'), 'other');
    assert.equal(s('/zuck'), 'profile'); assert.equal(s('/profile.php?id=4'), 'profile');
  });
  test('surfaces() exposes the Reels shelf under hideReels', async () => {
    const { NoSlop } = await loadScripts(FILES, { url: URL });
    const list = NoSlop.adapters.list()[0].surfaces();
    assert.equal(list.length, 1);
    assert.equal(list[0].settingKey, 'hideReels');
    assert.match(list[0].selector, /aria-posinset/);
  });
  test('logged-out login page (div[role="main"] without a feed) yields zero items', async () => {
    // shape from tests/fixtures/facebook/notes.md: role="main" wraps the login form, no aria-posinset / role="article"
    const { NoSlop, document } = await loadScripts(FILES, { url: URL, html: page('<div role="main"><form><input name="email"><input name="pass"></form><a href="/login/">Log in</a></div>') });
    deq(NoSlop.adapters.list()[0].findItems(document), []);
  });
});

describe('extraction: fixtures agent synthetic-feed.html', () => {
  test('three units; id / author / text / hashtags / labels', async () => {
    const { els, items } = await extractAll('synthetic-feed.html');
    assert.equal(els.length, 3, 'one item per aria-posinset cell (inner role="article" de-duplicated)');
    assert.ok(els.every((el) => el.hasAttribute('aria-posinset')), 'items are the aria-posinset cells');
    const p1 = items.get('1');
    assert.equal(p1.id, 'pfbid0synthetic1');
    deq(p1.author, { handle: 'human.poster', name: 'Human Poster', id: '' });
    assert.equal(p1.text, 'Garden update: the tomatoes finally came in. Recipe thread below.');
    deq(p1.hashtags, []); deq(p1.labels, []); deq(p1.media, ['none']); assert.equal(p1.kind, 'post');
    assert.equal(p1.extra.idSource, 'permalink');
    const p2 = items.get('2');
    assert.equal(p2.author.handle, 'brandpage');
    assert.equal(p2.extra.idSource, 'hash', 'no permalink in the ad unit -> synthetic hash id');
    assert.match(p2.id, /^h[0-9a-z]+$/);
    deq(p2.labels, [], 'sponsored is NOT detected while hideAds is off');
    const p3 = items.get('3');
    assert.equal(p3.id, 'pfbid0synthetic3');
    deq(p3.author, { handle: 'ai.dreamworks.page', name: 'AI Dreamworks', id: '' });
    deq(p3.hashtags, ['#aiart', '#stablediffusion']);
    deq(p3.labels, [{ type: 'platform_ai', id: 'facebook_ai_info', text: 'AI info' }]);
    deq(p3.media, ['image']);
    assert.ok(p3.links.some((l) => l.includes('/photo/?fbid=synthetic3')));
  });
  test('hash ids are stable across re-extraction of the same content', async () => {
    const { a, els } = await extractAll('synthetic-feed.html');
    const first = a.extract(els[1]).id;
    assert.equal(a.extract(els[1]).id, first);
    els[1].querySelector('[data-ad-preview="message"] div').textContent = 'Different text now.';
    assert.notEqual(a.extract(els[1]).id, first);
  });
});

describe('extraction: synthetic-feed-cases.html', () => {
  test('labels: AI info button, Imagined with AI, AI-generated profile; comments never count', async () => {
    const { items } = await extractAll('synthetic-feed-cases.html');
    deq(items.get('2').labels, [{ type: 'platform_ai', id: 'facebook_ai_info', text: 'AI info' }]);
    assert.equal(items.get('2').kind, 'video'); deq(items.get('2').media, ['video']); assert.equal(items.get('2').id, '9900000001');
    deq(items.get('5').labels, [{ type: 'platform_ai', id: 'facebook_imagined_with_ai', text: 'Imagined with AI' }]);
    deq(items.get('8').labels, [{ type: 'platform_ai', id: 'facebook_ai_generated_profile', text: 'AI-generated profile' }]);
    const c6 = items.get('6');
    deq(c6.labels, [], '"AI info" inside a nested comment article is ignored');
    deq(c6.hashtags, [], '#aiart inside a comment is ignored');
    assert.equal(c6.text, 'Finished the mural today. Six weeks of scaffolding and three colours of blue.');
    deq(c6.author, { handle: '', name: 'Honest Painter', id: '100099887766554' }, 'profile.php?id= author -> author.id');
    assert.equal(c6.id, 'pfbid0case6comment', 'story_fbid permalink');
  });
  test('hashtags come from /hashtag/ links and text; plain post has none', async () => {
    const { items } = await extractAll('synthetic-feed-cases.html');
    deq(items.get('7').hashtags, ['#aiart', '#midjourney']);
    deq(items.get('1').hashtags, []);
    assert.equal(items.get('1').text, 'Took the dog to the lake this morning, she refused to get out of the water lol');
  });
  test('virtualized placeholder (data-virtualized="true", empty) is "not ready" -> undefined (the engine keeps a hidden unit hidden)', async () => {
    const { items } = await extractAll('synthetic-feed-cases.html');
    assert.equal(items.get('9'), undefined);
  });
  test('the Reels shelf is kind "shelf" and never a post', async () => {
    const { items } = await extractAll('synthetic-feed-cases.html');
    const sh = items.get('10');
    assert.equal(sh.kind, 'shelf'); assert.equal(sh.id, 'reels-shelf'); deq(sh.labels, []);
  });
  test('sponsored detection only when settings.surfaces.hideAds: /ads/about/ link and the uAssets __cft__ length rule', async () => {
    ctx = await loadScripts(FILES, { url: URL, html: page(fixture('synthetic-feed-cases.html')) });
    const { NoSlop, document } = ctx;
    const a = adapter();
    const u4 = document.querySelector('[aria-posinset="4"]'), u11 = document.querySelector('[aria-posinset="11"]'), u1 = document.querySelector('[aria-posinset="1"]');
    deq(a.extract(u4).labels, []); deq(a.extract(u11).labels, []);
    await NoSlop.host.patchSettings({ surfaces: Object.assign({}, NoSlop.defaultSettings().surfaces, { hideAds: true }) });
    await NoSlop.engine.start({ adapter: a, rules: NoSlop.rules, host: NoSlop.host });
    await settle();
    const i4 = a.extract(u4), i11 = a.extract(u11), i1 = a.extract(u1);
    deq(i4.labels, [{ type: 'promoted' }]); assert.equal(i4.kind, 'ad');
    deq(i11.labels, [{ type: 'promoted' }], '__cft__[0]= of 290+ chars marks the unit sponsored');
    assert.equal(i11.id, 'pfbid0case11cft', 'id parsed before the query string');
    deq(i1.labels, []); assert.equal(i1.kind, 'post');
  });
  test('findItems(root) includes a unit that is the root or contains the root', async () => {
    ctx = await loadScripts(FILES, { url: URL, html: page(fixture('synthetic-feed-cases.html')) });
    const a = adapter();
    const u2 = unit('2');
    deq(a.findItems(u2).map((e) => e.getAttribute('aria-posinset')), ['2']);
    deq(a.findItems(u2.querySelector('[data-ad-preview="message"]')).map((e) => e.getAttribute('aria-posinset')), ['2']);
    deq(a.findItems(u2.querySelector('[role="article"]')).map((e) => e.getAttribute('aria-posinset')), ['2']);
  });
  test('works with role="article" units when aria-posinset is absent (permalink / group pages)', async () => {
    ctx = await loadScripts(FILES, { url: 'https://www.facebook.com/groups/abc', html: page('<div role="main"><div role="feed">' +
      '<div role="article"><h4><a href="/someone"><strong>Someone</strong></a></h4><a href="/groups/abc/posts/777"><span>1h</span></a>' +
      '<div data-ad-preview="message"><div dir="auto">group text</div></div>' +
      '<div role="article" aria-label="Comment by X"><div dir="auto">a comment</div></div></div></div></div>') });
    const a = adapter();
    const els = a.findItems(ctx.document);
    assert.equal(els.length, 1, 'the comment article folds into its post');
    const it = a.extract(els[0]);
    assert.equal(it.id, '777'); assert.equal(it.text, 'group text'); assert.equal(it.author.handle, 'someone');
  });
});

describe('engine end-to-end on the synthetic feed', () => {
  test('labelled unit hidden with a stub (height-zero), plain unit untouched, slop dimmed, video paused', async () => {
    await boot(fixture('synthetic-feed-cases.html'));
    const h = unit('2');
    assert.equal(action(2), 'hide');
    assert.ok(h.classList.contains('noslop-hidden') && h.classList.contains('noslop-hidden--height-zero'));
    assert.equal(h.getAttribute('data-noslop-id'), '9900000001');
    const stub = h.querySelector(':scope > .noslop-stub');
    assert.ok(stub); assert.match(stub.textContent, /Hidden: AI content/); assert.match(stub.textContent, /platform AI label/);
    assert.match(stub.querySelector('[data-noslop-act="never"]').textContent, /Never show @dream\.factory\.page/);
    assert.equal(h.querySelector('video').muted, true);
    assert.equal(h.style.getPropertyValue('overflow'), 'hidden');
    assert.equal(h.style.getPropertyValue('min-height'), '0');
    // plain
    assert.equal(action(1), 'none');
    assert.ok(!unit(1).classList.contains('noslop-hidden') && !unit(1).classList.contains('noslop-dim'));
    assert.equal(unit(1).querySelector('.noslop-stub, .noslop-badge'), null);
    // style slop -> dim only
    assert.equal(action(3), 'dim');
    assert.ok(unit(3).classList.contains('noslop-dim') && !unit(3).classList.contains('noslop-hidden'));
    assert.ok(unit(3).querySelector(':scope > .noslop-badge'));
    const v3 = ctx.NoSlop.engine.stateOf(unit(3)).verdict;
    assert.ok(v3.reasons.some((r) => r.startsWith('style:')) && !v3.reasons.some((r) => /^(label|hashtag|disclosure):/.test(r)));
    // other labelled / hashtag units
    assert.equal(action(5), 'hide'); assert.equal(action(8), 'hide'); assert.equal(action(7), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(unit(7)).verdict.reasons.includes('hashtag:#aiart'));
    // the comment-only "AI info" post stays
    assert.equal(action(6), 'none');
    // placeholder untouched, shelf untouched
    assert.equal(unit(9).getAttribute('data-noslop-id'), null);
    assert.equal(action(10), 'none');
  });
  test('hidden cell: inline height from the virtualizer is neutralised while hidden and restored on unhide', async () => {
    await boot(fixture('synthetic-feed-cases.html').replace('<div aria-posinset="2" ', '<div aria-posinset="2" style="height: 640px; min-height: 100px" '));
    const h = unit(2);
    assert.equal(action(2), 'hide');
    assert.equal(h.style.getPropertyValue('height'), 'auto');
    assert.equal(h.style.getPropertyPriority('height'), 'important');
    assert.equal(h.style.getPropertyValue('min-height'), '0');
    ctx.NoSlop.engine.stop();
    assert.equal(h.style.getPropertyValue('height'), '640px');
    assert.equal(h.style.getPropertyValue('min-height'), '100px');
    assert.equal(h.style.getPropertyValue('overflow'), '');
    assert.equal(h.getAttribute('data-noslop-fb-prev'), null);
  });
  test('showStubs:false collapses the cell to height 0', async () => {
    await boot(fixture('synthetic-feed-cases.html'), { settings: { showStubs: false } });
    const h = unit(2);
    assert.ok(h.classList.contains('noslop-nostub'));
    assert.match(h.style.getPropertyValue('height'), /^0(px)?$/);
    assert.equal(h.querySelector('.noslop-stub'), null);
  });
  test('sponsored units hide only when surfaces.hideAds is on (and unhide when it is turned off)', async () => {
    await boot(fixture('synthetic-feed-cases.html'));
    assert.equal(action(4), 'none'); assert.equal(action(11), 'none');
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideAds: true }) });
    await settle();
    assert.equal(action(4), 'hide'); assert.equal(action(11), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(unit(4)).verdict.reasons.includes('ad:promoted'));
    assert.equal(ctx.NoSlop.engine.stateOf(unit(4)).item.kind, 'ad');
    assert.equal(action(1), 'none');
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideAds: false }) });
    await settle();
    assert.equal(action(4), 'none'); assert.equal(action(11), 'none');
  });
  test('surfaces: the Reels shelf is hidden only with hideReels', async () => {
    await boot(fixture('synthetic-feed-cases.html'));
    const shelf = unit(10);
    assert.ok(!shelf.classList.contains('noslop-surface'));
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideReels: true }) });
    await settle();
    assert.ok(shelf.classList.contains('noslop-surface'));
    assert.equal(shelf.getAttribute('data-noslop-surface'), 'hideReels');
    assert.ok(!unit(2).classList.contains('noslop-surface'), 'a single reel/video post is not the shelf');
    assert.ok(!unit(1).classList.contains('noslop-surface'));
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideReels: false }) });
    await settle();
    assert.ok(!shelf.classList.contains('noslop-surface'));
  });
  test('SPA re-render: remove + re-append keeps the hidden state with exactly one stub and no re-count', async () => {
    await boot(fixture('synthetic-feed-cases.html'));
    const h = unit(2);
    const feed = h.parentNode;
    const next = h.nextSibling;
    h.remove();
    await settle();
    feed.insertBefore(h, next);
    await settle(5);
    assert.equal(action(2), 'hide');
    assert.ok(h.classList.contains('noslop-hidden--height-zero'));
    assert.equal(h.querySelectorAll('.noslop-stub').length, 1);
    // a fresh clone of the same post (React re-mount) is hidden straight from the cache
    const orig = ctx.NoSlop.scorer.score; let calls = 0; ctx.NoSlop.scorer.score = (...a) => { calls++; return orig(...a); };
    const clone = h.cloneNode(true);
    clone.querySelectorAll('.noslop-stub').forEach((n) => n.remove());
    clone.classList.remove('noslop-hidden', 'noslop-hidden--height-zero'); clone.removeAttribute('data-noslop-id'); clone.removeAttribute('data-noslop-action'); clone.removeAttribute('style'); clone.removeAttribute('data-noslop-fb-prev');
    feed.appendChild(clone);
    await settle(5);
    ctx.NoSlop.scorer.score = orig;
    assert.equal(calls, 0, 'cache hit by post id');
    assert.equal(clone.getAttribute('data-noslop-action'), 'hide');
    assert.equal(clone.querySelectorAll('.noslop-stub').length, 1);
    ctx.NoSlop.engine.flushStats();
    const hides = ctx.NoSlop.host.__reports.filter((r) => r.action === 'hide' && r.reason === 'label:facebook_ai_info').reduce((n, r) => n + r.count, 0);
    assert.equal(hides, 1, 'one hide counted for one post id');
  });
  test('cell reuse: the virtualizer swaps another post into a hidden cell -> unapplied and re-verdicted (both directions)', async () => {
    await boot(fixture('synthetic-feed-cases.html'));
    const cell = unit(2);
    const humanArticle = unit(1).querySelector('[data-virtualized]').innerHTML;
    const aiArticle = cell.querySelector('[data-virtualized]').innerHTML;
    assert.equal(action(2), 'hide');
    // reuse for a human post (same cell element, new content + posinset)
    cell.setAttribute('aria-posinset', '99');
    cell.querySelector('[data-virtualized]').innerHTML = humanArticle.replace('pfbid0case1human', 'pfbid0reused1');
    await settle(5);
    assert.equal(cell.getAttribute('data-noslop-id'), 'pfbid0reused1');
    assert.equal(cell.getAttribute('data-noslop-action'), 'none');
    assert.ok(!cell.classList.contains('noslop-hidden'));
    assert.equal(cell.querySelector('.noslop-stub'), null);
    assert.equal(cell.style.getPropertyValue('overflow'), '', 'adapter.unhide ran');
    // and back to an AI-labelled post
    cell.querySelector('[data-virtualized]').innerHTML = aiArticle.replace('9900000001', '9900000002');
    await settle(5);
    assert.equal(cell.getAttribute('data-noslop-id'), '9900000002');
    assert.equal(cell.getAttribute('data-noslop-action'), 'hide');
    assert.equal(cell.querySelectorAll('.noslop-stub').length, 1);
  });
  test('placeholder cell that later receives content is picked up', async () => {
    await boot(fixture('synthetic-feed-cases.html'));
    const ph = unit(9);
    assert.equal(ph.getAttribute('data-noslop-id'), null);
    const box = ph.querySelector('[data-virtualized]');
    box.setAttribute('data-virtualized', 'false');
    box.innerHTML = unit(2).querySelector('[data-virtualized]').innerHTML.replace(/<div class="noslop-stub[\s\S]*?<\/div>/, '').replace('9900000001', '9900000009');
    box.querySelectorAll('.noslop-stub').forEach((n) => n.remove());
    await settle(5);
    assert.equal(ph.getAttribute('data-noslop-id'), '9900000009');
    assert.equal(ph.getAttribute('data-noslop-action'), 'hide');
  });
  test('Show on the stub reveals the post; Never show blocks the author and hides their other posts', async () => {
    const extra = '<div aria-posinset="13" aria-setsize="13"><div data-virtualized="false"><div role="article"><h4><a href="/dream.factory.page"><strong>Dream Factory</strong></a></h4><a href="/dream.factory.page/posts/pfbid0other"><span>1m</span></a><div data-ad-preview="message"><div dir="auto">another one, no label</div></div></div></div></div>';
    await boot(fixture('synthetic-feed-cases.html').replace('</div></div></div>\n', extra + '</div></div></div>\n'));
    assert.equal(action(13), 'none');
    unit(2).querySelector('[data-noslop-act="show"]').click();
    await settle();
    assert.equal(action(2), 'none');
    assert.ok(!unit(2).classList.contains('noslop-hidden'));
    unit(5).querySelector('[data-noslop-act="show"]');
    // block the author via the stub of unit 8 (its author has a handle)
    unit(8).querySelector('[data-noslop-act="never"]').click();
    await settle(5);
    deq((await ctx.NoSlop.host.getSettings()).blockedAccounts.facebook, ['synth.persona']);
    // now block dream.factory.page the same way through the engine API used by the stub
    await ctx.NoSlop.host.patchSettings({ blockedAccounts: Object.assign({}, ctx.NoSlop.engine.settings.blockedAccounts, { facebook: ['synth.persona', 'dream.factory.page'] }) });
    await settle(5);
    assert.equal(action(13), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(unit(13)).verdict.reasons.includes('account:block'));
  });
  test('mode off unapplies everything; stop() leaves the DOM clean', async () => {
    await boot(fixture('synthetic-feed-cases.html'));
    await ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.engine.settings.sites, { facebook: { mode: 'off' } }) });
    await settle();
    assert.equal(ctx.document.querySelector('.noslop-hidden, .noslop-dim, .noslop-stub, .noslop-badge'), null);
    await ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.engine.settings.sites, { facebook: { mode: 'balanced' } }) });
    await settle();
    assert.equal(action(2), 'hide'); assert.equal(action(3), 'dim');
    ctx.NoSlop.engine.stop();
    assert.equal(ctx.document.querySelector('.noslop-hidden, .noslop-dim, .noslop-stub, .noslop-badge, [data-noslop-id], [data-noslop-fb-prev]'), null);
  });
  test('MutationObserver: units appended later are processed', async () => {
    await boot('<div role="main"><div role="feed"></div></div>');
    const feed = ctx.document.querySelector('[role="feed"]');
    const doc = new ctx.window.DOMParser().parseFromString(fixture('synthetic-feed-cases.html'), 'text/html');
    feed.appendChild(ctx.document.importNode(doc.querySelector('[aria-posinset="2"]'), true));
    feed.appendChild(ctx.document.importNode(doc.querySelector('[aria-posinset="1"]'), true));
    await settle(5);
    assert.equal(action(2), 'hide'); assert.equal(action(1), 'none');
  });
});
