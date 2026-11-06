// Tests for adapters/tiktok.js + lib/tiktok-main.js.
// Run: cd /Users/kamilszwed/Projects/NoSlop && node --test tests/adapters/tiktok.test.mjs
// REAL fixtures: tests/fixtures/tiktok/*.html (captured 2026-11-02, see notes.md). Everything built by the
// helpers below (fyArticle / exploreCard / aigc markup / relay payloads) is *** SYNTHETIC ***: modelled on the
// real structure, with the AI-label placements being hypotheses (no label was observable logged out).
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadScripts, CORE_FILES, settle, ROOT } from '../helpers/load.mjs';

const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);

const FIX = path.join(ROOT, 'tests/fixtures/tiktok');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const FORYOU = read('foryou-feed-items.html');
const OVERLAY = read('foryou-active-video-overlay.html');
const EXPLORE = read('explore-items.html');
const FILES = [...CORE_FILES, 'adapters/tiktok.js'];
const URL_FY = 'https://www.tiktok.com/foryou';
const ID0 = '7690108568778870047'; // REAL: active video (overlay more-menu id) = article #0
const ID1 = '7698513320101285134'; // REAL: article #1
const SLOP = "It's not about working harder — it's about working smarter. Moreover, furthermore, additionally, delve into the intricate tapestry. In conclusion, leverage synergy. Thoughts?";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// *** SYNTHETIC *** For You article: same skeleton as the REAL fixture (feed-video > poster <img alt> + div#xgwrapper-<n>-<id> > video).
const fyArticle = (id, alt, extraInner = '') =>
  `<article data-e2e="recommend-list-item-container" data-scroll-index="9" data-test-id="${id}"><div><section data-e2e="feed-video" aria-label="Watch in full screen">` +
  `<div><picture><img alt="${esc(alt)}" src="https://p16.example/poster.jpg"></picture></div>` +
  `<div id="xgwrapper-0-${id}" class="xgplayer-container tiktok-web-player"><div><video src="blob:https://www.tiktok.com/x-${id}"></video></div></div>${extraInner}</section></div></article>`;
// *** SYNTHETIC *** Explore card: same skeleton as the REAL fixture (explore-item > a[href=/@user/video/id] > poster <img alt>).
const exploreCard = (id, user, alt, extraInner = '') =>
  `<div data-e2e="explore-item" role="button" aria-label="Watch in full screen" data-test-id="${id}"><div><div><a href="https://www.tiktok.com/@${user}/video/${id}">` +
  `<div><picture><img alt="${esc(alt)}" src="https://p16.example/cover.jpg"></picture></div>${extraInner}</a></div></div></div>`;
// *** SYNTHETIC *** AI-label hypotheses: [data-e2e="aigc-tag"] (rules.json guess) and the verbatim i18n string as a banner.
const AIGC_TAG = '<span data-e2e="aigc-tag">AI-generated</span>';
const AIGC_BANNER = '<div class="banner">Creator labeled as AI-generated</div>';
const NEXT_BTN = '<button type="button" data-e2e="feed-navigation-next" aria-label="Go to next video">next</button>';

let ctx;
async function load(opts = {}) {
  ctx = await loadScripts(FILES, { url: opts.url || URL_FY, html: `<!doctype html><html><head></head><body><div id="feed">${opts.body || ''}</div></body></html>`, browser: opts.browser, beforeScripts: opts.beforeScripts });
  return ctx;
}
async function boot(opts = {}) {
  await load(opts);
  const { NoSlop, window } = ctx;
  if (opts.settings) await NoSlop.host.patchSettings(opts.settings);
  if (opts.beforeStart) await opts.beforeStart(ctx);
  await NoSlop.engine.start({ adapter: NoSlop.adapters.pick(window.location), rules: NoSlop.rules, host: NoSlop.host });
  await settle();
  return ctx;
}
afterEach(() => { if (ctx && ctx.NoSlop && ctx.NoSlop.engine && ctx.NoSlop.engine.running) ctx.NoSlop.engine.stop(); });

const adapter = () => ctx.NoSlop.adapters.pick(ctx.window.location);
const $ = (s) => ctx.document.querySelector(s);
const $$ = (s) => [...ctx.document.querySelectorAll(s)];
const byTest = (id) => $(`[data-test-id="${id}"]`);
const articleOf = (id) => $(`[id="xgwrapper-0-${id}"]`).closest('article');
const action = (el) => el.getAttribute('data-noslop-action');
const stateOf = (el) => ctx.NoSlop.engine.stateOf(el);
const relayMsg = (items) => ctx.window.postMessage({ source: 'noslop-tiktok', v: 1, items }, '*');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('registration and surfaces', () => {
  test('registers as "tiktok", matches tiktok.com hosts only, maps paths to surfaces', async () => {
    await load();
    const a = adapter();
    assert.equal(a.site, 'tiktok');
    assert.ok(!a.placeholder);
    assert.ok(a.matches({ hostname: 'www.tiktok.com' }) && a.matches({ hostname: 'm.tiktok.com' }) && a.matches({ hostname: 'tiktok.com' }));
    assert.ok(!a.matches({ hostname: 'tiktok.com.evil.test' }) && !a.matches({ hostname: 'www.youtube.com' }));
    const sf = (pathname) => a.surface({ pathname });
    assert.equal(sf('/foryou'), 'home'); assert.equal(sf('/'), 'home'); assert.equal(sf('/following'), 'home'); assert.equal(sf('/explore'), 'home');
    assert.equal(sf('/search'), 'search'); assert.equal(sf('/search/video'), 'search');
    assert.equal(sf('/@ryanemerson23/video/7690108568778870047'), 'watch'); assert.equal(sf('/@maria3espinoza/photo/7699682543993441567'), 'watch');
    assert.equal(sf('/@ryanemerson23'), 'profile'); assert.equal(sf('/upload'), 'other');
    assert.equal(ctx.document.documentElement.getAttribute('data-noslop-tiktok-page'), 'foryou', 'surface() stamps the REAL location\'s page kind on <html>');
  });
});

describe('extraction from the REAL fixtures', () => {
  test('For You: id from div#xgwrapper-<n>-<id>, caption/hashtags from the poster alt, overlay merged into the active article, empty slot skipped', async () => {
    await load({ body: FORYOU + OVERLAY });
    const a = adapter();
    const items = a.findItems(ctx.document);
    assert.equal(items.length, 3, 'three article[data-e2e="recommend-list-item-container"]');
    assert.equal(a._activeId(), ID0, 'the overlay more-menu id names the active video');
    const [i0, i1, i2] = items.map((el) => a.extract(el));
    assert.equal(i2, undefined, 'the empty third article is a skeleton / recycled slot: "not ready", the engine keeps its state');
    assert.equal(i0.id, ID0); assert.equal(i1.id, ID1);
    assert.equal(i0.kind, 'video'); deq(i0.media, ['video']); assert.equal(i0.surface, 'home');
    // active article: caption + author + hashtags from the fixed overlay (not inside the article)
    assert.match(i0.text, /Wowl @DAZValen really left everyone/);
    assert.equal(i0.author.handle, 'ryanemerson23');
    for (const t of ['#indosiarbawadangdutberkelasberkvalitas', '#dacademy7indosiar', '#dacademyindosiar']) assert.ok(i0.hashtags.includes(t), t);
    assert.equal(i0.extra.active, true); assert.equal(i0.extra.forYou, true);
    // non-active article: only the poster alt is available
    assert.equal(i1.text, '3 at a time is crazy 😂 #funny #prank #joke #pranks');
    deq(i1.hashtags, ['#funny', '#prank', '#joke', '#pranks']);
    assert.equal(i1.author.handle, '');
    assert.equal(i1.extra.active, false);
    deq(i0.labels, []); deq(i1.labels, []);
    assert.equal(a.hideStrategy, 'collapse-inner', 'snap feed on the page -> collapse-inner');
  });
  test('Explore: id + handle from the video link, caption and display name parsed from the alt, display-none strategy', async () => {
    await load({ url: 'https://www.tiktok.com/explore', body: EXPLORE });
    const a = adapter();
    const items = a.findItems(ctx.document).map((el) => a.extract(el));
    assert.equal(items.length, 3);
    deq(items.map((i) => i.id), ['7700250538566241558', '7698262935436659990', '7699682543993441567']);
    deq(items.map((i) => i.author.handle), ['americanewshub1', 'tiktrendzuk0', 'maria3spinoza']);
    deq(items.map((i) => i.author.name), ['America News Hub🇺🇲', 'TikTrendzUK', 'Maria Espinoza']);
    assert.ok(items[0].text.startsWith('Have you noticed how Michelle Obama'));
    assert.ok(!/created by/.test(items[0].text), 'the "created by <name> with <sound>" suffix is stripped');
    for (const t of ['#michelleobama', '#news', '#fyp', '#foryoupage', '#creatorsearchinsights']) assert.ok(items[0].hashtags.includes(t), t);
    assert.equal(items[1].text, 'DIY Crunchy Cotton Slime!');
    assert.ok(items[0].links.includes('https://www.tiktok.com/@americanewshub1/video/7700250538566241558'));
    assert.ok(items.every((i) => i.labels.length === 0 && i.kind === 'video' && i.media[0] === 'video'));
    assert.equal(a.hideStrategy, 'display-none', 'no snap feed -> display-none');
  });
});

describe('platform labels (tier 0)', () => {
  test('[data-e2e="aigc-tag"] element, exact label text outside the caption; a caption saying "AI-generated" is NOT a platform label', async () => {
    await load({ url: 'https://www.tiktok.com/explore', body: fyArticle('1', 'cat video', AIGC_TAG) + exploreCard('2', 'bob', 'sunset timelapse', AIGC_BANNER) + exploreCard('3', 'eve', '', '<div data-e2e="explore-card-desc">AI-generated</div>') + exploreCard('4', 'kim', 'walk', '<div>Contains AI-generated media</div>') });
    const a = adapter();
    const by = (id) => a.extract(byTest(id));
    deq(by('1').labels, [{ type: 'platform_ai', id: 'tiktok_aigc_tag', text: 'AI-generated' }]);
    deq(by('2').labels, [{ type: 'platform_ai', id: 'tiktok_label_text', text: 'Creator labeled as AI-generated' }]);
    const i3 = by('3');
    deq(i3.labels, []); assert.equal(i3.text, 'AI-generated', 'caption text is kept for the tier-1 disclosure regex');
    deq(by('4').labels, [{ type: 'platform_ai', id: 'tiktok_label_text', text: 'Contains AI-generated media' }]);
    // the scorer turns these into tier-0 hides with the expected reason ids
    const v = ctx.NoSlop.scorer.score(by('1'), ctx.NoSlop.rules, ctx.NoSlop.defaultSettings(), 'tiktok');
    assert.equal(v.action, 'hide'); assert.equal(v.tier, 0); assert.ok(v.reasons.includes('label:tiktok_aigc_tag'));
    const v3 = ctx.NoSlop.scorer.score(i3, ctx.NoSlop.rules, ctx.NoSlop.defaultSettings(), 'tiktok');
    assert.equal(v3.tier, 1, 'self-disclosure, not a platform label');
  });
});

describe('JSON relay (MAIN world -> content script)', () => {
  test('window messages fill the id map; IsAigc / AIGCDescription / moderationAigcLabelType count, aigcLabelType "2" alone does not; foreign messages are ignored', async () => {
    await load({ body: fyArticle('1', 'x') + fyArticle('2', 'y') + fyArticle('3', 'z') + fyArticle('4', 'w') + fyArticle('6', 'ad') });
    const a = adapter();
    relayMsg([
      { id: '1', IsAigc: true, aigcLabelType: '1', author: { uniqueId: 'BotFarm', nickname: 'Bot Farm', id: '99' } },
      { id: '2', IsAigc: false, aigcLabelType: '2', AIGCDescription: '', ShowAIGC: true }, // REAL shape of a non-AI item (notes.md)
      { id: '3', AIGCDescription: 'Made with AI tools' },
      { id: '4', moderationAigcLabelType: '1' },
      { id: '6', ad_info: { id: 'x' }, author: 'promo_account' }
    ]);
    ctx.window.postMessage({ source: 'someone-else', items: [{ id: '5', IsAigc: true }] }, '*');
    await settle();
    assert.equal(a._relay.get('1').aigc, 'is_aigc');
    assert.equal(a._relay.get('2').aigc, null);
    assert.equal(a._relay.get('3').aigc, 'aigc_description');
    assert.equal(a._relay.get('4').aigc, 'moderation_label');
    assert.ok(!a._relay.has('5'));
    const i1 = a.extract(byTest('1'));
    deq(i1.labels, [{ type: 'platform_ai', id: 'tiktok_json', text: 'aigc:is_aigc' }]);
    deq(i1.author, { handle: 'botfarm', name: 'Bot Farm', id: '99' });
    deq(i1.extra.aigc, { aigcLabelType: '1', IsAigc: true });
    deq(a.extract(byTest('2')).labels, []);
    deq(a.extract(byTest('6')).labels, [{ type: 'promoted' }]);
    assert.equal(a.extract(byTest('6')).author.handle, 'promo_account');
  });
  test('lib/tiktok-main.js wraps fetch and XMLHttpRequest for the item_list endpoints and posts the picked fields', async () => {
    const payload = { statusCode: 0, itemList: [
      { id: '7001', IsAigc: true, aigcLabelType: '1', AIGCDescription: 'desc', ShowAIGC: true, author: { uniqueId: 'a', nickname: 'A', id: '9' }, video: { id: 'big' } },
      { id: '7002', IsAigc: false, aigcLabelType: '2', ad_info: { x: 1 }, author: 'str_handle', authorId: '77' },
      { noId: true }
    ] };
    class FakeXHR {
      constructor() { this.responseType = ''; this._l = {}; }
      open(m, u) { this._u = u; }
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
      send() { this.responseText = JSON.stringify(payload); setTimeout(() => { for (const f of this._l.load || []) f.call(this, { type: 'load' }); }, 0); }
    }
    const fetchCalls = [];
    const c = await loadScripts(['lib/tiktok-main.js'], { url: URL_FY, beforeScripts: (window) => {
      window.fetch = async (input) => { fetchCalls.push(input); return { ok: true, clone() { return { json: async () => payload }; } }; };
      window.XMLHttpRequest = FakeXHR;
    } });
    const msgs = [];
    c.window.addEventListener('message', (ev) => { if (ev.data && ev.data.source === 'noslop-tiktok') msgs.push(ev.data); });
    assert.equal(c.window.__noslopTiktokMain, true);
    const res = await c.window.fetch('https://www.tiktok.com/api/recommend/item_list/?aid=1965&count=12');
    assert.equal(res.ok, true, 'the original response is returned untouched');
    await c.window.fetch('https://www.tiktok.com/api/other/thing/');
    await c.window.fetch({ url: '/api/post/item_list/?secUid=abc' }); // Request-like input
    await settle(3);
    assert.equal(fetchCalls.length, 3);
    assert.equal(msgs.length, 2, 'only the two item_list calls relayed');
    deq(msgs[0], { source: 'noslop-tiktok', v: 1, items: [
      { id: '7001', aigcLabelType: '1', moderationAigcLabelType: undefined, IsAigc: true, AIGCDescription: 'desc', ShowAIGC: true, isAd: false, author: { uniqueId: 'a', nickname: 'A', id: '9' } },
      { id: '7002', aigcLabelType: '2', moderationAigcLabelType: undefined, IsAigc: false, AIGCDescription: '', ShowAIGC: false, isAd: true, author: { uniqueId: 'str_handle', id: '77', nickname: '' } }
    ] });
    const x = new c.window.XMLHttpRequest();
    x.open('GET', '/api/post/item_list/?secUid=1');
    x.send();
    const y = new c.window.XMLHttpRequest();
    y.open('GET', '/api/comment/list/?aweme_id=1');
    y.send();
    await settle(3);
    assert.equal(msgs.length, 3, 'XHR to item_list relayed, comment list not');
    assert.equal(msgs[2].items[0].id, '7001');
  });
  test('the content script injects <script src=runtime.getURL("lib/tiktok-main.js")> once; settings.tiktokJsonRelay=false disables it', async () => {
    const before = (window) => { window.browser = { runtime: { getURL: (p) => 'safari-web-extension://noslop-test/' + p } }; };
    await boot({ body: fyArticle('1', 'x'), beforeScripts: before });
    assert.equal(ctx.NoSlop.host.__memory, true, 'no storage on the stub runtime -> memory host');
    const tags = $$('script[data-noslop-tiktok-main]');
    assert.equal(tags.length, 1);
    assert.equal(tags[0].getAttribute('src'), 'safari-web-extension://noslop-test/lib/tiktok-main.js');
    ctx.NoSlop.engine.processNow(); ctx.NoSlop.engine.processNow();
    assert.equal($$('script[data-noslop-tiktok-main]').length, 1, 'injected once');
    ctx.NoSlop.engine.stop();
    await boot({ body: fyArticle('1', 'x'), beforeScripts: before, settings: { tiktokJsonRelay: false } });
    assert.equal($$('script[data-noslop-tiktok-main]').length, 0);
  });
  test('the SSR rehydration JSON seeds the map before any fetch happens', async () => {
    const ssr = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' + JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.updated-items': { itemList: [
      { id: '7', IsAigc: true, aigcLabelType: '1', AIGCDescription: '', ShowAIGC: true, author: { uniqueId: 'gen_account' } },
      { id: '8', IsAigc: false, aigcLabelType: '2', AIGCDescription: '', ShowAIGC: true, author: { uniqueId: 'human' } }
    ] } } }) + '</script>';
    await boot({ body: ssr + fyArticle('7', 'first') + fyArticle('8', 'second') });
    assert.equal(action(byTest('7')), 'hide');
    assert.ok(stateOf(byTest('7')).verdict.reasons.includes('label:tiktok_json'));
    assert.match(byTest('7').querySelector('[data-noslop-act="never"]').textContent, /Never show @gen_account/);
    assert.equal(action(byTest('8')), 'none');
    assert.equal(stateOf(byTest('8')).item.author.handle, 'human', 'author from the JSON even without a label');
  });
});

describe('engine end-to-end on the For You feed (snap feed)', () => {
  test('labelled item hidden (collapse-inner + stub + muted video), plain items untouched, a late relay label re-verdicts a cached item', async () => {
    await boot({ body: FORYOU + OVERLAY + fyArticle('900', 'relaxing lo-fi beats', AIGC_TAG) });
    const h = byTest('900');
    assert.equal(action(h), 'hide');
    assert.ok(h.classList.contains('noslop-hidden') && h.classList.contains('noslop-hidden--collapse-inner'));
    const stub = h.querySelector(':scope > .noslop-stub');
    assert.ok(stub); assert.match(stub.textContent, /Hidden: AI content/); assert.match(stub.textContent, /platform AI label/);
    assert.equal(h.querySelector('video').muted, true);
    assert.equal(action(articleOf(ID0)), 'none'); assert.equal(action(articleOf(ID1)), 'none');
    assert.ok(!articleOf(ID1).classList.contains('noslop-hidden') && !articleOf(ID1).classList.contains('noslop-dim'));
    // the JSON relay arrives after the engine already cached "none" for ID1 -> cache dropped, re-scored, hidden
    assert.equal(ctx.NoSlop.engine.cache.get('tiktok:' + ID1).verdict.action, 'none');
    relayMsg([{ id: ID1, IsAigc: true, aigcLabelType: '1', author: { uniqueId: 'prankbot', nickname: 'Prank Bot' } }]);
    await wait(150); await settle(3);
    assert.equal(action(articleOf(ID1)), 'hide');
    assert.ok(stateOf(articleOf(ID1)).verdict.reasons.includes('label:tiktok_json'));
    assert.match(articleOf(ID1).querySelector('[data-noslop-act="never"]').textContent, /Never show @prankbot/);
    ctx.NoSlop.engine.flushStats();
    const hides = ctx.NoSlop.host.__reports.filter((r) => r.action === 'hide');
    assert.equal(hides.reduce((n, r) => n + r.count, 0), 2, 'two hides counted, once each');
  });
  test('hidden ACTIVE video: feed auto-advances (next button), overlay blanked, player kept paused; Show restores', async () => {
    await load({ body: FORYOU + OVERLAY + NEXT_BTN });
    relayMsg([{ id: ID0, IsAigc: true, author: { uniqueId: 'ryanemerson23' } }]);
    await settle();
    let clicks = 0;
    $('[data-e2e="feed-navigation-next"]').addEventListener('click', () => clicks++);
    await ctx.NoSlop.engine.start({ adapter: adapter(), rules: ctx.NoSlop.rules, host: ctx.NoSlop.host });
    await settle();
    const a0 = articleOf(ID0);
    assert.equal(action(a0), 'hide');
    assert.ok(clicks >= 1, 'auto-advanced via [data-e2e="feed-navigation-next"]');
    assert.ok(adapter()._advanced >= 1);
    const overlays = $$('[data-e2e="anchoring-description-layer"], [data-e2e="anchoring-engagement-vertical"], [data-e2e="cinema-creator-identity"], [data-e2e="anchoring-chrome-host"]');
    assert.ok(overlays.length >= 4);
    assert.ok(overlays.every((o) => o.style.visibility === 'hidden'), 'overlay of the hidden active video is blanked');
    const v = a0.querySelector('video');
    assert.equal(v.muted, true);
    v.muted = false; v.dispatchEvent(new ctx.window.Event('play'));
    assert.equal(v.muted, true, 'player restart is re-muted/paused while hidden');
    // Show -> unhide restores the overlay and drops the guard
    a0.querySelector('[data-noslop-act="show"]').click();
    await settle();
    assert.equal(action(a0), 'none');
    assert.ok(overlays.every((o) => o.style.visibility === ''), 'overlay restored');
    v.muted = false; v.dispatchEvent(new ctx.window.Event('play'));
    assert.equal(v.muted, false, 'guard removed on unhide');
  });
  test('a label that only renders in the overlay once the video is active re-verdicts the cached article', async () => {
    await boot({ body: FORYOU + OVERLAY });
    const a0 = articleOf(ID0);
    assert.equal(action(a0), 'none');
    // *** SYNTHETIC *** placement hypothesis: the "bottom banner" label string inside the description layer
    $('[data-e2e="anchoring-description-layer"]').insertAdjacentHTML('beforeend', AIGC_BANNER);
    await settle(6);
    assert.equal(action(a0), 'hide');
    assert.ok(stateOf(a0).verdict.reasons.includes('label:tiktok_label_text'));
    // the overlay moving on to another video does not un-hide it (evidence is a union per id)
    $('[data-e2e="anchoring-description-layer"] .banner').remove();
    $('[data-e2e="more-menu-icon"]').setAttribute('data-more-menu-item-id', ID1);
    await settle(6);
    ctx.NoSlop.engine.processNow();
    assert.equal(action(a0), 'hide');
    assert.equal(action(articleOf(ID1)), 'none');
  });
  test('SPA re-render (remove + re-append) keeps the hide with exactly one stub; cell reuse re-verdicts', async () => {
    await boot({ body: fyArticle('900', 'x', AIGC_TAG) + fyArticle('901', 'plain') });
    const e = byTest('900');
    assert.equal(action(e), 'hide');
    const feed = e.parentNode;
    e.remove(); await settle();
    feed.appendChild(e); await settle(5);
    assert.equal(action(e), 'hide');
    assert.ok(e.classList.contains('noslop-hidden'));
    assert.equal(e.querySelectorAll('.noslop-stub').length, 1);
    // cell reuse: the same article now shows another video (new player id, new poster, no label)
    e.querySelector('[data-e2e="aigc-tag"]').remove();
    e.querySelector('[id^="xgwrapper-"]').id = 'xgwrapper-0-77001';
    e.querySelector('img').setAttribute('alt', 'my lunch today');
    await settle(6);
    assert.equal(e.getAttribute('data-noslop-id'), '77001');
    assert.equal(action(e), 'none');
    assert.ok(!e.classList.contains('noslop-hidden'));
    assert.equal(e.querySelector('.noslop-stub'), null);
    // ...and back to AI content in the same cell
    e.querySelector('[id^="xgwrapper-"]').id = 'xgwrapper-0-77002';
    e.querySelector('section').insertAdjacentHTML('beforeend', AIGC_TAG);
    ctx.NoSlop.engine.processNow();
    assert.equal(e.getAttribute('data-noslop-id'), '77002');
    assert.equal(action(e), 'hide');
    assert.equal(action(byTest('901')), 'none');
  });
});

describe('engine end-to-end on the Explore grid', () => {
  test('style slop is dimmed (not hidden), labelled card hidden with display-none, fixture cards never hidden', async () => {
    await boot({ url: 'https://www.tiktok.com/explore', body: EXPLORE + exploreCard('11', 'writer', SLOP) + exploreCard('12', 'bob', 'sunset timelapse', AIGC_BANNER) + exploreCard('13', 'kim', 'walk in the park') });
    const d = byTest('11');
    assert.equal(action(d), 'dim');
    assert.ok(d.classList.contains('noslop-dim') && !d.classList.contains('noslop-hidden'));
    assert.ok(d.querySelector(':scope > .noslop-badge'));
    assert.ok(stateOf(d).verdict.reasons.some((r) => r.startsWith('style:')));
    const h = byTest('12');
    assert.equal(action(h), 'hide');
    assert.ok(h.classList.contains('noslop-hidden--display-none'));
    assert.match(h.querySelector('[data-noslop-act="never"]').textContent, /Never show @bob/);
    assert.equal(action(byTest('13')), 'none');
    const real = $$('[data-e2e="explore-item"]').filter((el) => !el.hasAttribute('data-test-id'));
    assert.equal(real.length, 3);
    assert.ok(real.every((el) => !el.classList.contains('noslop-hidden')), 'no real explore card is hidden');
    assert.equal(action(real[1]), 'none'); assert.equal(action(real[2]), 'none');
  });
  test('blocked account (Never show) hides the author\'s other cards; allow list wins', async () => {
    await boot({ url: 'https://www.tiktok.com/explore', body: exploreCard('21', 'spam_studio', 'a', AIGC_BANNER) + exploreCard('22', 'spam_studio', 'b') + exploreCard('23', 'other', 'c') });
    assert.equal(action(byTest('22')), 'none');
    byTest('21').querySelector('[data-noslop-act="never"]').click();
    await settle(3);
    deq((await ctx.NoSlop.host.getSettings()).blockedAccounts.tiktok, ['spam_studio']);
    assert.equal(action(byTest('22')), 'hide');
    assert.ok(stateOf(byTest('22')).verdict.reasons.includes('account:block'));
    assert.equal(action(byTest('23')), 'none');
  });
});

describe('surfaces', () => {
  test('hideTikTokForYou: /foryou redirects to /following and the feed is blanked meanwhile; /following is left alone', async () => {
    const nav = [];
    await boot({ body: FORYOU + OVERLAY, beforeStart: ({ NoSlop, window }) => { NoSlop.adapters.pick(window.location)._navigate = (u) => nav.push(u); } });
    assert.equal(ctx.document.documentElement.getAttribute('data-noslop-tiktok-page'), 'foryou');
    deq(nav, []);
    assert.ok($$('.noslop-surface').length === 0);
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideTikTokForYou: true }) });
    await settle();
    deq(nav, ['/following']);
    const arts = $$('article[data-e2e="recommend-list-item-container"]');
    assert.ok(arts.every((el) => el.classList.contains('noslop-surface') && el.getAttribute('data-noslop-surface') === 'hideTikTokForYou'));
    ctx.NoSlop.engine.flushStats();
    assert.ok(ctx.NoSlop.host.__reports.some((r) => r.reason === 'surface:hideTikTokForYou' && r.action === 'hide'));
    ctx.NoSlop.engine.processNow();
    deq(nav, ['/following'], 'redirect is throttled, not spammed');
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideTikTokForYou: false }) });
    await settle();
    assert.equal($$('.noslop-surface').length, 0);
    ctx.NoSlop.engine.stop();
    const nav2 = [];
    await boot({ url: 'https://www.tiktok.com/following', body: FORYOU, settings: { surfaces: Object.assign({}, ctx.NoSlop.defaultSettings().surfaces, { hideTikTokForYou: true }) }, beforeStart: ({ NoSlop, window }) => { NoSlop.adapters.pick(window.location)._navigate = (u) => nav2.push(u); } });
    deq(nav2, []);
    assert.equal($$('.noslop-surface').length, 0);
    assert.equal(ctx.document.documentElement.getAttribute('data-noslop-tiktok-page'), 'home');
  });
  test('mode off unapplies everything; dimInsteadOfHide dims labelled items', async () => {
    await boot({ body: fyArticle('900', 'x', AIGC_TAG) });
    await ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.engine.settings.sites, { tiktok: { mode: 'off' } }) });
    await settle();
    assert.ok(!byTest('900').classList.contains('noslop-hidden'));
    await ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.engine.settings.sites, { tiktok: { mode: 'balanced' } }), dimInsteadOfHide: true });
    await settle();
    assert.ok(byTest('900').classList.contains('noslop-dim'));
  });
});
