// Tests for Extension/Resources/adapters/x.js (owner: adapter:x agent).
// Run: cd /Users/kamilszwed/Projects/NoSlop && node --test tests/adapters/x.test.mjs
// Fixtures are SYNTHETIC (tests/fixtures/x/synthetic-*.html): x.com is login-walled, see tests/fixtures/x/notes.md.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScripts, CORE_FILES, settle } from '../helpers/load.mjs';

const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/x');
const FEED = fs.readFileSync(path.join(FIX, 'synthetic-feed.html'), 'utf8');
const STATUS = fs.readFileSync(path.join(FIX, 'synthetic-status.html'), 'utf8');
const FILES = [...CORE_FILES, 'adapters/x.js'];
const HOME = 'https://x.com/home';

let ctx;
async function load(html = FEED, url = HOME) {
  ctx = await loadScripts(FILES, { url, html: `<!doctype html><html><head></head><body>${html}</body></html>` });
  return ctx;
}
async function boot(opts = {}) {
  await load(opts.html || FEED, opts.url || HOME);
  const { NoSlop, window } = ctx;
  if (opts.settings) await NoSlop.host.patchSettings(opts.settings);
  await NoSlop.engine.start({ adapter: NoSlop.adapters.pick(window.location), rules: NoSlop.rules, host: NoSlop.host });
  await settle();
  return ctx;
}
afterEach(() => { if (ctx && ctx.NoSlop && ctx.NoSlop.engine.running) ctx.NoSlop.engine.stop(); });

const adapter = () => ctx.NoSlop.adapters.list().find((a) => a.site === 'x');
const cell = (fx) => ctx.document.querySelector(`[data-testid="cellInnerDiv"][data-fx="${fx}"]`);
const action = (fx) => cell(fx).getAttribute('data-noslop-action');
const extract = (fx) => adapter().extract(cell(fx));
const patchSurfaces = (partial) => ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, partial) });

// ------------------------------------------------------------------ registration / matching
describe('registration', () => {
  test('registers as site "x" with collapse-inner and matches x.com / twitter.com hosts only', async () => {
    await load();
    const a = adapter();
    assert.ok(a && !a.placeholder);
    assert.equal(a.hideStrategy, 'collapse-inner');
    assert.equal(ctx.NoSlop.rules.sites.x.hideStrategy, 'collapse-inner', 'rules.json agrees');
    for (const h of ['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'mobile.twitter.com', 'www.twitter.com']) assert.ok(a.matches({ hostname: h }), h);
    for (const h of ['xcom.evil', 'notx.com', 'twitter.com.evil', 'youtube.com', '']) assert.ok(!a.matches({ hostname: h }), h);
    assert.equal(ctx.NoSlop.adapters.pick(ctx.window.location).site, 'x');
  });
  test('selectors come from rules.sites.x (fallbacks only fill missing keys)', async () => {
    await load();
    const S = adapter()._internal.sel();
    const R = ctx.NoSlop.rules.sites.x;
    for (const k of ['cell', 'article', 'text', 'userName', 'promoted', 'grokLink', 'grokSvgPath', 'statusIdRegex', 'mobileDetect']) assert.equal(S[k], R[k], k);
    assert.ok(S.focalTweet && S.quoteMarker && S.grokPromoCell, 'documented fallbacks present');
  });
});

// ------------------------------------------------------------------ findItems
describe('findItems', () => {
  test('returns only cells that contain a tweet article (separators and Grok promo cells are not items)', async () => {
    await load();
    const items = adapter().findItems(ctx.document.body);
    deq(items.map((c) => c.getAttribute('data-fx')), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c11', 'c12', 'c13']);
    assert.equal(adapter().findItems(ctx.document).length, 11);
  });
  test('a root inside a cell yields that cell (mutation targets are inner divs)', async () => {
    await load();
    const inner = cell('c3').querySelector('article');
    deq(adapter().findItems(inner).map((c) => c.getAttribute('data-fx')), ['c3']);
    deq(adapter().findItems(cell('c3')).map((c) => c.getAttribute('data-fx')), ['c3']);
  });
  test('logged-out page (no primaryColumn, no cells) yields nothing', async () => {
    await load('<div role="dialog"><form><input name="text"></form></div>', 'https://x.com/i/jf/onboarding/web?redirect_after_login=%2Fhome&mode=login');
    deq(adapter().findItems(ctx.document.body), []);
  });
});

// ------------------------------------------------------------------ extraction
describe('extract', () => {
  test('plain tweet: id from the permalink, handle from User-Name, emoji from img alt, hashtags from anchors', async () => {
    await load();
    const it = extract('c1');
    assert.equal(it.id, '2000000000000000001');
    assert.equal(it.kind, 'post');
    deq(it.author, { handle: 'human_one', name: 'Human One' });
    assert.equal(it.text, "went for a walk, saw a heron 🐦 that's the whole post #birds");
    deq(it.hashtags, ['#birds']);
    deq(it.labels, []);
    deq(it.media, ['none']);
    assert.ok(it.links.some((l) => /\/human_one\/status\/2000000000000000001$/.test(l)));
    assert.equal(it.surface, 'home');
    assert.equal(it.extra.page, 'home');
    assert.equal(it.extra.layout, 'desktop');
  });
  test('promoted tweet: kind ad + promoted label (placementTracking wraps the article)', async () => {
    await load();
    const it = extract('c2');
    assert.equal(it.id, '2000000000000000002');
    assert.equal(it.kind, 'ad');
    deq(it.labels, [{ type: 'promoted', id: 'x_promoted' }]);
    assert.equal(it.author.handle, 'brand_two');
    assert.equal(it.extra.socialContext, 'Ad');
  });
  test('"Made with AI" text and the AI-label svg path become platform_ai labels; body text is not scanned for the label', async () => {
    await load();
    const it = extract('c3');
    deq(it.labels, [
      { type: 'platform_ai', id: 'x_made_with_ai', text: 'Made with AI' },
      { type: 'platform_ai', id: 'x_ai_icon', text: 'Made with AI' }
    ]);
    deq(it.media, ['image']);
    assert.equal(it.text, 'new piece, a city made of glass at dawn');
    // a tweet whose BODY says "Made with AI" is self-disclosure, not a platform label
    cell('c1').querySelector('[data-testid="tweetText"]').innerHTML = '<span>Made with AI</span>';
    deq(extract('c1').labels, []);
  });
  test('Grok: share link, quote of @grok, post by @grok -> platform_ai labels gated by hideGrokPosts', async () => {
    await load();
    deq(extract('c4').labels, [{ type: 'platform_ai', id: 'x_grok_share', text: 'Grok' }]);
    deq(extract('c4').extra.grok, { share: true, author: false, quoted: false });
    const c5 = extract('c5');
    deq(c5.labels, [{ type: 'platform_ai', id: 'x_grok_quote', text: 'Grok' }]);
    assert.equal(c5.author.handle, 'quoter_five', 'outer author, not the quoted one');
    assert.equal(c5.text, 'lol look at this', 'outer text only');
    deq(c5.extra.quoted, { handle: 'grok', text: 'Here is the image you asked for.' });
    deq(c5.media, ['image'], 'media of the whole article');
    deq(extract('c13').labels, [{ type: 'platform_ai', id: 'x_grok_author', text: 'Grok' }]);
    assert.equal(extract('c13').author.handle, 'grok');
    // a plain "@grok is this true?" mention in the body is a human asking Grok, not a Grok post
    cell('c1').querySelector('[data-testid="tweetText"]').innerHTML = '<a href="/grok" role="link">@grok</a><span> is this true?</span>';
    deq(extract('c1').labels, []);
    assert.equal(extract('c1').extra.grok, undefined);
    // gate off
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.defaultSettings().surfaces, { hideGrokPosts: false }) });
    await ctx.NoSlop.engine.start({ adapter: adapter(), rules: ctx.NoSlop.rules, host: ctx.NoSlop.host }); await settle();
    assert.equal(adapter()._internal.hideGrokPosts(), false);
    deq(extract('c4').labels, []);
    deq(extract('c5').labels, []);
    deq(extract('c13').labels, []);
    assert.ok(extract('c4').extra.grok, 'the signal is still reported in extra');
  });
  test('hashtags from /hashtag/ anchors (case-folded) and from text', async () => {
    await load();
    deq(extract('c7').hashtags, ['#aiart', '#landscape']);
  });
  test('video, repost social context, self-disclosure text', async () => {
    await load();
    deq(extract('c8').media, ['video']);
    const c12 = extract('c12');
    assert.equal(c12.extra.socialContext, 'Human One reposted');
    assert.equal(c12.author.handle, 'orig_twelve', 'author is the original poster');
    assert.equal(extract('c11').text, 'this clip is AI-generated, made it in an afternoon');
  });
  test('cells without an article return null; an article without its permalink yet is "pending" (undefined)', async () => {
    await load();
    assert.equal(adapter().extract(cell('c9')), null);
    assert.equal(adapter().extract(cell('c10')), null);
    const c1 = cell('c1');
    c1.querySelectorAll('a[href*="/status/"]').forEach((a) => a.removeAttribute('href'));
    assert.equal(adapter().extract(c1), undefined, 'no stable id yet -> pending (never the element); the engine keeps the cell state');
  });
  test('a human quote-tweeting an AI-labelled post is NOT labelled: the quoted label is x_ai_quote, gated on hideGrokPosts', async () => {
    await load();
    // turn c5 (quote of @grok) into a human quoting a human whose post carries X's "Made with AI" label + sparkle icon
    const c5 = cell('c5');
    c5.querySelectorAll('a[href="/grok"]').forEach((a) => { a.setAttribute('href', '/aiguy'); });
    c5.querySelector('[data-testid="tweetText"] span').textContent = 'this is fake, look at the hands';
    const quoted = adapter()._internal.quotedBlock(c5.querySelector('article'), adapter()._internal.sel());
    assert.ok(quoted, 'quoted block found');
    quoted.insertAdjacentHTML('beforeend', '<div class="r-knv0ih"><svg viewBox="0 0 24 24"><g><path d="M12.998 1.94c.18 3.015 1.04 5.156 2.473 6.59 1.433 1.433 3.575 2.293 6.59 2.473z"></path></g></svg><span>Made with AI</span></div>');
    const it = extract('c5');
    assert.equal(it.author.handle, 'quoter_five');
    deq(it.labels.map((l) => l.id), ['x_ai_quote']);
    assert.equal(it.extra.quoted.aiLabel, true);
    const v = ctx.NoSlop.scorer.score(it, ctx.NoSlop.rules, ctx.NoSlop.defaultSettings(), 'x');
    assert.ok(v.reasons.includes('label:x_ai_quote'));
    // with hideGrokPosts off the quoting post carries no label at all and is left alone
    ctx.NoSlop.host.__memory && await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.defaultSettings().surfaces, { hideGrokPosts: false }) });
    await ctx.NoSlop.engine.start({ adapter: adapter(), rules: ctx.NoSlop.rules, host: ctx.NoSlop.host });
    await settle();
    deq(extract('c5').labels, []);
    assert.equal(action('c5'), 'none');
    assert.equal(action('c3'), 'hide', 'the author\'s own Made with AI label is still ungated');
    ctx.NoSlop.engine.stop();
  });
  test('extract() never throws on foreign elements', async () => {
    await load();
    assert.equal(adapter().extract(ctx.document.body), null);
    assert.equal(adapter().extract(ctx.document.querySelector('#layers')), null);
  });
});

// ------------------------------------------------------------------ surface / page detection
describe('surface detection', () => {
  const cases = [
    ['/', 'home', 'home'], ['/home', 'home', 'home'],
    ['/search?q=heron&src=typed_query', 'search', 'search'], ['/explore', 'explore', 'search'], ['/explore/tabs/for-you', 'explore', 'search'],
    ['/human_one', 'profile', 'profile'], ['/human_one/', 'profile', 'profile'], ['/human_one/with_replies', 'profile', 'profile'], ['/human_one/media', 'profile', 'profile'], ['/human_one/likes', 'profile', 'profile'],
    ['/human_one/status/2000000000000000001', 'status', 'watch'], ['/human_one/status/2000000000000000001/photo/1', 'status', 'watch'],
    ['/i/grok', 'grok', 'other'], ['/i/grok/share/abc', 'grok', 'other'], ['/notifications', 'notifications', 'other'], ['/messages', 'messages', 'other'],
    ['/i/lists/123', 'list', 'home'], ['/i/communities/1876728323608338672', 'community', 'home'], ['/i/bookmarks', 'bookmarks', 'other'],
    ['/settings/account', 'other', 'other'], ['/compose/post', 'other', 'other'], ['/login', 'other', 'other'], ['/i/jf/onboarding/web', 'other', 'other']
  ];
  test('page() and surface() for home / search / profile / status and the rest', async () => {
    await load();
    const a = adapter();
    for (const [p, pg, sf] of cases) {
      const loc = new ctx.window.URL('https://x.com' + p);
      assert.equal(a.page(loc), pg, 'page ' + p);
      assert.equal(a.surface(loc), sf, 'surface ' + p);
    }
    assert.equal(a.page({ pathname: '' }), 'home');
    assert.equal(a.surface(null), 'home');
  });
  test('the engine reads the surface at start and after SPA navigation; items carry it', async () => {
    await boot({ url: 'https://x.com/human_one' });
    assert.equal(ctx.NoSlop.engine.surface, 'profile');
    assert.equal(ctx.NoSlop.engine.stateOf(cell('c1')).item.surface, 'profile');
    ctx.window.history.pushState({}, '', '/search?q=heron');
    await settle(8);
    assert.equal(ctx.NoSlop.engine.surface, 'search');
    assert.equal(ctx.NoSlop.engine.stateOf(cell('c1')).item.surface, 'search');
    assert.equal(ctx.NoSlop.engine.stateOf(cell('c1')).item.extra.page, 'search');
  });
});

// ------------------------------------------------------------------ status page
describe('status page', () => {
  test('the focal tweet (tabindex=-1) is skipped; replies are processed; surface is watch/status', async () => {
    await boot({ html: STATUS, url: 'https://x.com/op_one/status/3000000000000000001' });
    assert.equal(ctx.NoSlop.engine.surface, 'watch');
    assert.equal(adapter().extract(cell('focal')), null, 'the opened post is never hidden');
    assert.equal(cell('focal').getAttribute('data-noslop-action'), null);
    assert.equal(action('r1'), 'none');
    assert.equal(action('r2'), 'hide');
    const st = ctx.NoSlop.engine.stateOf(cell('r2'));
    assert.equal(st.item.id, '3000000000000000003');
    assert.equal(st.item.extra.page, 'status');
    assert.ok(st.verdict.reasons.includes('label:x_made_with_ai'));
  });
});

// ------------------------------------------------------------------ engine end-to-end
describe('engine end-to-end on the synthetic home timeline', () => {
  test('platform label -> hidden with a stub; plain -> untouched; style slop -> dimmed; disclosure/hashtag/grok -> hidden', async () => {
    await boot();
    const st = (fx) => ctx.NoSlop.engine.stateOf(cell(fx));
    // hidden
    for (const fx of ['c3', 'c4', 'c5', 'c7', 'c11', 'c13']) assert.equal(action(fx), 'hide', fx);
    assert.ok(st('c3').verdict.reasons.includes('label:x_made_with_ai'));
    assert.ok(st('c3').verdict.reasons.includes('label:x_ai_icon'));
    assert.equal(st('c3').verdict.tier, 0);
    assert.ok(st('c4').verdict.reasons.includes('label:x_grok_share'));
    assert.ok(st('c5').verdict.reasons.includes('label:x_grok_quote'));
    assert.ok(st('c7').verdict.reasons.includes('hashtag:#aiart'));
    assert.ok(st('c11').verdict.reasons.some((r) => r.startsWith('disclosure:')));
    assert.ok(st('c13').verdict.reasons.includes('account:seed'), '@grok is in rules.accounts.x.block');
    const stub = cell('c3').querySelector(':scope > .noslop-stub');
    assert.ok(stub, 'stub inserted as a child of the cell');
    assert.equal(cell('c3').firstElementChild, stub, 'stub is the first child so it is the only visible content');
    assert.match(stub.textContent, /Hidden: AI content/);
    assert.match(stub.textContent, /platform AI label/);
    assert.match(stub.querySelector('[data-noslop-act="never"]').textContent, /Never show @aiposter_three/);
    // untouched
    for (const fx of ['c1', 'c8', 'c12', 'c2']) {
      assert.equal(action(fx), 'none', fx);
      assert.ok(!cell(fx).classList.contains('noslop-hidden') && !cell(fx).classList.contains('noslop-dim'), fx);
      assert.equal(cell(fx).querySelector('.noslop-stub'), null, fx);
    }
    // dimmed, not hidden
    assert.equal(action('c6'), 'dim');
    assert.ok(cell('c6').classList.contains('noslop-dim'));
    assert.ok(!cell('c6').classList.contains('noslop-hidden'));
    assert.equal(cell('c6').querySelector(':scope > .noslop-badge').textContent, 'AI?');
    assert.equal(st('c6').verdict.tier, 3);
    // non-items are left alone
    for (const fx of ['c9', 'c10']) assert.equal(cell(fx).getAttribute('data-noslop-id'), null, fx);
    // video in a hidden cell is paused + muted
    assert.equal(cell('c11').querySelector('video').muted, true);
  });

  test('collapse-inner: the cell stays mounted and is never display:none; its children are collapsed; unhide restores them', async () => {
    await boot();
    const c = cell('c3');
    assert.ok(c.classList.contains('noslop-hidden--collapse-inner'));
    assert.ok(!c.classList.contains('noslop-hidden--display-none'));
    assert.equal(c.style.display, '', 'cell has no inline display');
    assert.notEqual(ctx.window.getComputedStyle(c).display, 'none');
    assert.ok(c.isConnected && c.querySelector('article[data-testid="tweet"]'), 'article still mounted inside the cell');
    const inner = c.querySelector(':scope > [data-noslop-collapsed]');
    assert.ok(inner, 'original first child marked collapsed');
    assert.equal(inner.style.getPropertyValue('display'), 'none');
    assert.equal(inner.style.getPropertyPriority('display'), 'important');
    assert.equal(c.querySelector('.noslop-stub').style.display, '', 'stub not collapsed');
    // Show -> unhide
    c.querySelector('[data-noslop-act="show"]').click();
    await settle();
    assert.equal(action('c3'), 'none');
    assert.equal(c.querySelector('[data-noslop-collapsed]'), null);
    assert.equal(inner.style.getPropertyValue('display'), '');
    assert.equal(c.querySelector('.noslop-stub'), null);
  });

  test('surfaces: hideGrokPosts off -> Grok share / quote shown, @grok still hidden by the account seed; Grok promo cell content toggles', async () => {
    await boot();
    const promo = cell('c10');
    const promoInner = promo.firstElementChild;
    assert.ok(promoInner.classList.contains('noslop-surface'), 'promo content hidden by default (hideGrokPosts: true)');
    assert.equal(promoInner.getAttribute('data-noslop-surface'), 'hideGrokPosts');
    assert.ok(!promo.classList.contains('noslop-surface'), 'the cell itself is never hidden');
    await patchSurfaces({ hideGrokPosts: false });
    await settle(5);
    assert.equal(action('c4'), 'none');
    assert.equal(action('c5'), 'none');
    assert.equal(cell('c4').querySelector('.noslop-stub'), null);
    assert.equal(action('c13'), 'hide', '@grok posts: rules.accounts.x.block seed');
    assert.ok(!ctx.NoSlop.engine.stateOf(cell('c13')).verdict.reasons.some((r) => r.startsWith('label:')));
    assert.ok(!promoInner.classList.contains('noslop-surface'));
    assert.equal(action('c3'), 'hide', 'the Made with AI label is not gated');
    await patchSurfaces({ hideGrokPosts: true });
    await settle(5);
    assert.equal(action('c4'), 'hide');
    assert.equal(action('c5'), 'hide');
    assert.ok(promoInner.classList.contains('noslop-surface'));
  });

  test('surfaces: hideAds hides the promoted tweet', async () => {
    await boot();
    assert.equal(action('c2'), 'none');
    await patchSurfaces({ hideAds: true });
    await settle(5);
    assert.equal(action('c2'), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(cell('c2')).verdict.reasons.includes('ad:promoted'));
    await patchSurfaces({ hideAds: false });
    await settle(5);
    assert.equal(action('c2'), 'none');
  });

  test('dimInsteadOfHide and site mode off', async () => {
    await boot({ settings: { dimInsteadOfHide: true } });
    assert.equal(action('c3'), 'dim');
    assert.equal(action('c1'), 'none');
    await ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.engine.settings.sites, { x: { mode: 'off' } }) });
    await settle(5);
    for (const fx of ['c3', 'c4', 'c6', 'c7']) assert.equal(action(fx), 'none', fx);
    assert.equal(ctx.document.querySelectorAll('.noslop-hidden, .noslop-dim').length, 0);
  });

  test('SPA re-render: remove + re-append keeps the hidden state with exactly one stub and no re-count', async () => {
    await boot();
    const c = cell('c3');
    const parent = c.parentNode;
    const next = c.nextSibling;
    c.remove();
    await settle();
    parent.insertBefore(c, next);
    await settle(6);
    assert.equal(action('c3'), 'hide');
    assert.ok(c.classList.contains('noslop-hidden--collapse-inner'));
    assert.equal(c.querySelectorAll('.noslop-stub').length, 1, 'exactly one stub');
    assert.equal(c.querySelectorAll('[data-noslop-collapsed]').length, 1);
    // a brand-new cell for the same tweet id is hidden straight from the cache
    const orig = ctx.NoSlop.scorer.score; let calls = 0; ctx.NoSlop.scorer.score = (...a) => { calls++; return orig(...a); };
    const clone = c.cloneNode(true);
    clone.querySelectorAll('.noslop-stub, [data-noslop-collapsed]').forEach((n) => { if (n.classList.contains('noslop-stub')) n.remove(); else { n.removeAttribute('data-noslop-collapsed'); n.style.removeProperty('display'); } });
    clone.className = ''; clone.removeAttribute('data-noslop-id'); clone.removeAttribute('data-noslop-action'); clone.setAttribute('data-fx', 'c3b');
    parent.appendChild(clone);
    await settle(6);
    ctx.NoSlop.scorer.score = orig;
    assert.equal(calls, 0, 'cache hit by tweet id');
    assert.equal(action('c3b'), 'hide');
    ctx.NoSlop.engine.flushStats();
    const hides = ctx.NoSlop.host.__reports.filter((r) => r.action === 'hide' && r.reason === 'label:x_made_with_ai').reduce((n, r) => n + r.count, 0);
    assert.equal(hides, 1, 'one hide counted per tweet id');
  });

  test('cell reuse: the same cellInnerDiv gets a different tweet -> re-verdict (hidden -> shown -> hidden)', async () => {
    await boot();
    const reused = cell('c3');
    assert.equal(action('c3'), 'hide');
    const plainInner = cell('c1').firstElementChild.cloneNode(true);
    plainInner.querySelector('a[href*="/status/"]').setAttribute('href', '/human_one/status/2000000000000000099');
    // X's virtualizer swaps the inner content of a mounted cell
    reused.querySelectorAll(':scope > :not(.noslop-stub)').forEach((n) => n.remove());
    reused.appendChild(plainInner);
    ctx.NoSlop.engine.processNow();
    assert.equal(reused.getAttribute('data-noslop-id'), '2000000000000000099');
    assert.equal(reused.getAttribute('data-noslop-action'), 'none');
    assert.ok(!reused.classList.contains('noslop-hidden'));
    assert.equal(reused.querySelector('.noslop-stub'), null, 'stale stub removed');
    assert.equal(plainInner.style.getPropertyValue('display'), '', 'new content not collapsed');
    assert.equal(reused.querySelector('[data-noslop-collapsed]'), null);
    // ...and back to AI content with yet another id, this time through the MutationObserver
    const aiInner = cell('c4').querySelector(':scope > [data-noslop-collapsed]').cloneNode(true); // c4 is hidden: its first child is the stub
    aiInner.removeAttribute('data-noslop-collapsed'); aiInner.style.removeProperty('display');
    aiInner.querySelector('a[href*="/status/"]').setAttribute('href', '/grokfan_four/status/2000000000000000098');
    reused.replaceChildren(aiInner);
    await settle(6);
    assert.equal(reused.getAttribute('data-noslop-id'), '2000000000000000098');
    assert.equal(reused.getAttribute('data-noslop-action'), 'hide');
    assert.equal(reused.querySelectorAll('.noslop-stub').length, 1);
    assert.equal(aiInner.getAttribute('data-noslop-collapsed'), '1');
    assert.ok(ctx.NoSlop.engine.stateOf(reused).verdict.reasons.includes('label:x_grok_share'));
  });

  test('late-arriving cells (timeline append) are picked up by the observer', async () => {
    await boot();
    const list = cell('c1').parentNode;
    list.insertAdjacentHTML('beforeend', cell('c7').outerHTML.replace('data-fx="c7"', 'data-fx="c14"').replace(/2000000000000000007/g, '2000000000000000014').replace(/ class="[^"]*"/g, '').replace(/ data-noslop-[a-z]+="[^"]*"/g, ''));
    const late = cell('c14');
    late.querySelectorAll('.noslop-stub').forEach((n) => n.remove());
    late.querySelectorAll('[data-noslop-collapsed]').forEach((n) => { n.removeAttribute('data-noslop-collapsed'); n.style.removeProperty('display'); });
    await settle(6);
    assert.equal(action('c14'), 'hide');
    assert.equal(ctx.NoSlop.engine.stateOf(late).item.id, '2000000000000000014');
  });

  test('Never show @author adds the handle to blockedAccounts.x and hides every post by them', async () => {
    await boot();
    cell('c1').querySelector('[data-testid="tweetText"]').textContent = 'plain';
    const stub = cell('c3').querySelector('.noslop-stub');
    stub.querySelector('[data-noslop-act="never"]').click();
    await settle(6);
    deq(ctx.NoSlop.engine.settings.blockedAccounts.x, ['aiposter_three']);
    assert.equal(action('c3'), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(cell('c3')).verdict.reasons.includes('account:block'));
  });
});

// ------------------------------------------------------------------ mobile layout (iOS Safari)
describe('mobile layout', () => {
  test('same DOM in a column layout: layout() reports mobile, extraction and verdicts are identical', async () => {
    await load();
    const wrapper = ctx.document.querySelector('#layers + div');
    wrapper.style.flexDirection = 'column';
    const a = adapter();
    a._internal.layout(); // first read is cached for 2 s; the cache was empty, so it reads the column layout
    assert.equal(a.layout(), 'mobile');
    assert.equal(extract('c1').extra.layout, 'mobile');
    assert.equal(extract('c3').extra.layout, 'mobile');
    deq(extract('c3').labels.map((l) => l.id), ['x_made_with_ai', 'x_ai_icon']);
    deq(a.findItems(ctx.document.body).map((c) => c.getAttribute('data-fx')), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c11', 'c12', 'c13']);
    await ctx.NoSlop.engine.start({ adapter: a, rules: ctx.NoSlop.rules, host: ctx.NoSlop.host });
    await settle();
    for (const fx of ['c3', 'c4', 'c5', 'c7', 'c11', 'c13']) assert.equal(action(fx), 'hide', fx);
    assert.equal(action('c6'), 'dim');
    for (const fx of ['c1', 'c2', 'c8', 'c12']) assert.equal(action(fx), 'none', fx);
    assert.ok(cell('c3').classList.contains('noslop-hidden--collapse-inner'));
  });
  test('layout() is unknown when the app wrapper is missing (logged-out page) and never throws', async () => {
    await load('<div role="dialog"></div>');
    assert.equal(adapter().layout(), 'unknown');
  });
});
