// Engine tests against the synthetic markup understood by adapters/_template.js (site "example").
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
// Values produced inside the jsdom vm context have another realm's prototypes; compare structurally.
const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);
import { loadScripts, CORE_FILES, settle } from './helpers/load.mjs';

const FILES = [...CORE_FILES, 'adapters/_template.js'];
const URL = 'https://noslop.example/';

const card = (id, { text = 'a normal post about my cat', author = 'alice', label = '', promoted = false, video = false, kind = 'post', title = '', subreddit = '' } = {}) =>
  `<div data-feed-item data-id="${id}" data-kind="${kind}" data-author="${author}"${label ? ` data-label="${label}"` : ''}${promoted ? ' data-promoted="1"' : ''}${subreddit ? ` data-subreddit="${subreddit}"` : ''}>` +
  (title ? `<h3 class="title">${title}</h3>` : '') + `<div class="text">${text}</div><a href="/p/${id}">link</a>${video ? '<video></video>' : ''}</div>`;

const SLOP = "It's not about working harder — it's about working smarter. Moreover, furthermore, additionally, delve into the intricate tapestry. In conclusion, leverage synergy. Thoughts?";

let ctx;
async function boot(html, opts = {}) {
  ctx = await loadScripts(FILES, { url: opts.url || URL, html: `<!doctype html><html><body><div class="feed">${html}</div><div class="shorts-shelf">shorts</div></body></html>` });
  const { NoSlop, window } = ctx;
  if (opts.settings) await NoSlop.host.patchSettings(opts.settings);
  if (opts.beforeStart) await opts.beforeStart(ctx);
  await NoSlop.engine.start({ adapter: NoSlop.adapters.pick(window.location), rules: NoSlop.rules, host: NoSlop.host });
  await settle();
  return ctx;
}
afterEach(() => { if (ctx && ctx.NoSlop && ctx.NoSlop.engine.running) ctx.NoSlop.engine.stop(); });

const el = (id) => ctx.document.querySelector(`[data-id="${id}"]`);
const stateOf = (id) => ctx.NoSlop.engine.stateOf(el(id));

describe('adapters registry', () => {
  test('register / list / pick, replacing an adapter with the same site', async () => {
    const { NoSlop, window } = await loadScripts(FILES, { url: URL });
    assert.equal(NoSlop.adapters.list().length, 1);
    assert.equal(NoSlop.adapters.pick(window.location).site, 'example');
    assert.equal(NoSlop.adapters.pick({ hostname: 'other.test' }), null);
    NoSlop.adapters.register({ site: 'example', matches: () => false, findItems: () => [], extract: () => null });
    assert.equal(NoSlop.adapters.list().length, 1);
    assert.equal(NoSlop.adapters.pick(window.location), null);
    assert.throws(() => NoSlop.adapters.register({}));
  });
  test('all seven placeholder adapters register and match their hosts; content.js starts the engine on youtube', async () => {
    const js = ['rules.js', 'lib/dom.js', 'lib/scorer.js', 'lib/host-extension.js', 'lib/engine.js', 'adapters/youtube.js', 'adapters/x.js', 'adapters/instagram.js', 'adapters/facebook.js', 'adapters/tiktok.js', 'adapters/reddit.js', 'adapters/linkedin.js', 'content.js'];
    const { NoSlop, window } = await loadScripts(js, { url: 'https://www.youtube.com/' });
    deq(NoSlop.adapters.list().map((a) => a.site), ['youtube', 'x', 'instagram', 'facebook', 'tiktok', 'reddit', 'linkedin']);
    assert.equal(NoSlop.adapters.pick({ hostname: 'm.youtube.com' }).site, 'youtube');
    assert.equal(NoSlop.adapters.pick({ hostname: 'twitter.com' }).site, 'x');
    assert.equal(NoSlop.adapters.pick({ hostname: 'www.reddit.com' }).site, 'reddit');
    assert.ok(window.__noslopStarted);
    await settle();
    assert.equal(NoSlop.engine.running, true);
    assert.equal(NoSlop.engine.site, 'youtube');
    NoSlop.engine.stop();
  });
});

describe('verdict application', () => {
  test('hide: labelled item gets the hide classes, a stub with Show / Never show, and its video paused+muted', async () => {
    await boot(card('p1', { label: 'AI info', video: true }) + card('p2'));
    const h = el('p1');
    assert.ok(h.classList.contains('noslop-hidden'));
    assert.ok(h.classList.contains('noslop-hidden--display-none'));
    assert.equal(h.getAttribute('data-noslop-id'), 'p1');
    assert.equal(h.getAttribute('data-noslop-action'), 'hide');
    const stub = h.querySelector(':scope > .noslop-stub');
    assert.ok(stub, 'stub inserted inside the card');
    assert.match(stub.textContent, /Hidden: AI content/);
    assert.match(stub.textContent, /platform AI label/);
    assert.ok(stub.querySelector('[data-noslop-act="show"]'));
    assert.match(stub.querySelector('[data-noslop-act="never"]').textContent, /Never show @alice/);
    assert.equal(h.querySelector('video').muted, true);
    const n = el('p2');
    assert.equal(n.getAttribute('data-noslop-action'), 'none');
    assert.ok(!n.classList.contains('noslop-hidden') && !n.classList.contains('noslop-dim'));
  });
  test('dim: style slop gets .noslop-dim and a badge', async () => {
    await boot(card('s1', { text: SLOP }));
    const d = el('s1');
    assert.ok(d.classList.contains('noslop-dim'));
    const badge = d.querySelector(':scope > .noslop-badge');
    assert.ok(badge); assert.equal(badge.textContent, 'AI?'); assert.match(badge.title, /AI-style writing/);
    assert.equal(stateOf('s1').verdict.action, 'dim');
  });
  test('showStubs:false hides without a stub (noslop-nostub)', async () => {
    await boot(card('p1', { label: 'AI info' }), { settings: { showStubs: false } });
    assert.ok(el('p1').classList.contains('noslop-nostub'));
    assert.equal(el('p1').querySelector('.noslop-stub'), null);
  });
  test('hide strategies from the adapter: height-zero and collapse-inner', async () => {
    for (const strategy of ['height-zero', 'collapse-inner']) {
      await boot(card('p1', { label: 'AI info' }), { beforeStart: ({ NoSlop }) => { NoSlop.adapters.list()[0].hideStrategy = strategy; } });
      assert.ok(el('p1').classList.contains('noslop-hidden--' + strategy), strategy);
      ctx.NoSlop.engine.stop();
    }
  });
  test('adapter.hide / unhide overrides are invoked', async () => {
    const calls = [];
    await boot(card('p1', { label: 'AI info' }), { beforeStart: ({ NoSlop }) => { const a = NoSlop.adapters.list()[0]; a.hide = (e, it, v, s) => calls.push(['hide', it.id, v.action, s]); a.unhide = (e, it) => calls.push(['unhide', it.id]); } });
    deq(calls, [['hide', 'p1', 'hide', 'display-none']]);
    ctx.NoSlop.engine.stop();
    deq(calls[1], ['unhide', 'p1']);
    delete ctx.NoSlop.adapters.list()[0].hide; delete ctx.NoSlop.adapters.list()[0].unhide;
  });
  test('dimInsteadOfHide dims labelled items', async () => {
    await boot(card('p1', { label: 'AI info' }), { settings: { dimInsteadOfHide: true } });
    assert.ok(el('p1').classList.contains('noslop-dim'));
  });
  test('promoted items hide only with surfaces.hideAds', async () => {
    await boot(card('ad1', { promoted: true }));
    assert.equal(el('ad1').getAttribute('data-noslop-action'), 'none');
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideAds: true }) });
    await settle();
    assert.equal(el('ad1').getAttribute('data-noslop-action'), 'hide');
  });
});

describe('stub actions', () => {
  test('Show unhides this item for the session and survives re-processing', async () => {
    await boot(card('p1', { label: 'AI info' }));
    el('p1').querySelector('[data-noslop-act="show"]').click();
    await settle();
    assert.ok(!el('p1').classList.contains('noslop-hidden'));
    assert.equal(el('p1').getAttribute('data-noslop-action'), 'none');
    assert.ok(stateOf('p1').verdict.reasons.includes('user:show'));
    ctx.NoSlop.engine.processNow();
    assert.equal(el('p1').getAttribute('data-noslop-action'), 'none');
    assert.equal(ctx.NoSlop.engine.cache.get('example:p1').verdict.action, 'hide', 'cache keeps the real verdict');
  });
  test('stub clicks do not propagate to the card', async () => {
    await boot(card('p1', { label: 'AI info' }));
    let bubbled = 0;
    el('p1').addEventListener('click', () => bubbled++);
    el('p1').querySelector('.noslop-stub').click();
    assert.equal(bubbled, 0);
  });
  test('Show restores the muted state stopMedia forced (never auto-plays)', async () => {
    await boot(card('p1', { label: 'AI info', video: true }));
    const v = el('p1').querySelector('video');
    assert.equal(v.muted, true);
    el('p1').querySelector('[data-noslop-act="show"]').click();
    await settle();
    assert.equal(v.muted, false, 'muted restored');
    assert.equal(el('p1').getAttribute('data-noslop-action'), 'none');
  });
  test('Never show @author adds the author to settings.blockedAccounts and hides their other posts', async () => {
    await boot(card('p1', { label: 'AI info', author: 'bob' }) + card('p2', { author: 'bob' }) + card('p3', { author: 'carol' }));
    assert.equal(el('p2').getAttribute('data-noslop-action'), 'none');
    el('p1').querySelector('[data-noslop-act="never"]').click();
    await settle();
    const s = await ctx.NoSlop.host.getSettings();
    deq(s.blockedAccounts.example, ['bob']);
    assert.equal(el('p2').getAttribute('data-noslop-action'), 'hide');
    assert.ok(stateOf('p2').verdict.reasons.includes('account:block'));
    assert.equal(el('p3').getAttribute('data-noslop-action'), 'none');
  });
});

describe('cell reuse and virtualization', () => {
  test('cell reuse: same element gets a new id -> unapplied and re-verdicted', async () => {
    await boot(card('p1', { label: 'AI info' }));
    const e = el('p1');
    assert.equal(e.getAttribute('data-noslop-action'), 'hide');
    e.setAttribute('data-id', 'p9'); e.removeAttribute('data-label'); e.querySelector('.text').textContent = 'my lunch today';
    ctx.NoSlop.engine.processNow();
    assert.equal(e.getAttribute('data-noslop-id'), 'p9');
    assert.equal(e.getAttribute('data-noslop-action'), 'none');
    assert.ok(!e.classList.contains('noslop-hidden'));
    assert.equal(e.querySelector('.noslop-stub'), null);
    // and the other way round: a reused cell that now shows AI content gets hidden
    e.setAttribute('data-id', 'p10'); e.setAttribute('data-label', 'AI info');
    ctx.NoSlop.engine.processNow();
    assert.equal(e.getAttribute('data-noslop-id'), 'p10');
    assert.equal(e.getAttribute('data-noslop-action'), 'hide');
  });
  test('cell reuse through the MutationObserver (mutation inside a processed element)', async () => {
    await boot(card('p1', { label: 'AI info' }));
    const e = el('p1');
    e.setAttribute('data-id', 'p2'); e.removeAttribute('data-label');
    e.querySelector('.text').textContent = 'reused cell with human text';
    await settle(5);
    assert.equal(e.getAttribute('data-noslop-id'), 'p2');
    assert.equal(e.getAttribute('data-noslop-action'), 'none');
  });
  test('virtualization: remove and re-append keeps the verdict from the cache without re-counting stats', async () => {
    await boot(card('p1', { label: 'AI info' }));
    const e = el('p1');
    const feed = e.parentNode;
    e.remove();
    await settle();
    feed.appendChild(e);
    await settle(5);
    assert.equal(e.getAttribute('data-noslop-action'), 'hide');
    assert.ok(e.classList.contains('noslop-hidden'));
    assert.equal(e.querySelectorAll('.noslop-stub').length, 1, 'exactly one stub');
    // a brand-new element for the same id is hidden straight from the cache (no scorer call needed)
    const orig = ctx.NoSlop.scorer.score; let calls = 0; ctx.NoSlop.scorer.score = (...a) => { calls++; return orig(...a); };
    feed.insertAdjacentHTML('beforeend', card('p1', { label: 'AI info' }));
    await settle(5);
    ctx.NoSlop.scorer.score = orig;
    assert.equal(calls, 0, 'cache hit');
    assert.ok(ctx.document.querySelectorAll('[data-id="p1"]')[1].classList.contains('noslop-hidden'));
    ctx.NoSlop.engine.flushStats();
    const hides = ctx.NoSlop.host.__reports.filter((r) => r.action === 'hide').reduce((n, r) => n + r.count, 0);
    assert.equal(hides, 1, 'one hide counted for one id');
  });
  test('skeleton (no id) elements are skipped and picked up once they get an id', async () => {
    await boot('<div data-feed-item data-label="AI info"><div class="text">loading</div></div>');
    const e = ctx.document.querySelector('[data-feed-item]');
    assert.equal(e.getAttribute('data-noslop-id'), null);
    e.setAttribute('data-id', 'late');
    ctx.NoSlop.engine.processNow();
    assert.equal(e.getAttribute('data-noslop-action'), 'hide');
  });
});

describe('observer, navigation, surfaces', () => {
  test('MutationObserver batches appended items and processes them', async () => {
    await boot('');
    const feed = ctx.document.querySelector('.feed');
    feed.insertAdjacentHTML('beforeend', card('a1', { label: 'AI info' }) + card('a2'));
    await settle(5);
    assert.equal(el('a1').getAttribute('data-noslop-action'), 'hide');
    assert.equal(el('a2').getAttribute('data-noslop-action'), 'none');
  });
  test('SPA navigation hook re-reads the surface and re-processes', async () => {
    await boot('');
    assert.equal(ctx.NoSlop.engine.surface, 'home');
    ctx.window.history.pushState({}, '', '/search?q=x');
    ctx.document.querySelector('.feed').insertAdjacentHTML('beforeend', card('n1', { label: 'AI info' }));
    await settle(8);
    assert.equal(ctx.NoSlop.engine.surface, 'search');
    assert.equal(el('n1').getAttribute('data-noslop-action'), 'hide');
    assert.equal(stateOf('n1').item.surface, 'search');
  });
  test('SPA navigation WITHOUT the history patch (isolated worlds): the URL is polled on every flush and on the sweep', async () => {
    let pushState;
    await boot('', { beforeStart: ({ window }) => { pushState = window.history.pushState; } });
    assert.notEqual(ctx.window.history.pushState, pushState, 'engine patched history (harmless extra)');
    let navEvents = 0;
    ctx.window.addEventListener('noslop:navigate', () => navEvents++);
    // the page's router calls the ORIGINAL pushState (captured before start): no event reaches us
    pushState.call(ctx.window.history, {}, '', '/search?q=y');
    assert.equal(navEvents, 0);
    assert.equal(ctx.NoSlop.engine.surface, 'home', 'not yet noticed');
    // a mutation storm accompanies every route change -> noticed at the top of the next flush
    ctx.document.querySelector('.feed').insertAdjacentHTML('beforeend', card('n2', { label: 'AI info' }));
    await settle(8);
    assert.equal(ctx.NoSlop.engine.surface, 'search');
    assert.equal(stateOf('n2').item.surface, 'search');
    assert.equal(el('n2').getAttribute('data-noslop-action'), 'hide');
    // a URL change with NO mutation is caught by the sweep (public checkNavigation = one sweep tick)
    pushState.call(ctx.window.history, {}, '', '/watch?v=1');
    assert.equal(ctx.NoSlop.engine.surface, 'search');
    assert.equal(ctx.NoSlop.engine.checkNavigation(), true);
    assert.equal(ctx.NoSlop.engine.surface, 'watch');
    assert.equal(ctx.NoSlop.engine.checkNavigation(), false, 'same URL: nothing to do');
    await settle(8);
    assert.equal(stateOf('n2').item.surface, 'watch', 'items re-processed after the navigation');
  });
  test('"not ready" (extract -> undefined) keeps the applied state; null unapplies', async () => {
    await boot(card('p1', { label: 'AI info' }));
    const e = el('p1');
    assert.equal(e.getAttribute('data-noslop-action'), 'hide');
    const a = ctx.NoSlop.adapters.list()[0];
    const orig = a.extract;
    a.extract = (node) => (node === e ? undefined : orig.call(a, node));
    ctx.NoSlop.engine.processNow();
    assert.equal(e.getAttribute('data-noslop-action'), 'hide', 'placeholder swap keeps the hide (no blank hole)');
    assert.ok(e.classList.contains('noslop-hidden') && e.querySelector(':scope > .noslop-stub'));
    a.extract = (node) => (node === e ? null : orig.call(a, node));
    ctx.NoSlop.engine.processNow();
    assert.equal(e.getAttribute('data-noslop-action'), null, 'an explicit null unapplies');
    assert.ok(!e.classList.contains('noslop-hidden'));
    a.extract = orig;
  });
  test('surfaces are applied once per flush, not once per mutation root, and the stats bump is once per element', async () => {
    await boot('');
    const a = ctx.NoSlop.adapters.list()[0];
    const orig = a.surfaces; let calls = 0;
    a.surfaces = () => { calls++; return orig.call(a); };
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideShorts: true }) });
    await settle();
    calls = 0;
    const feed = ctx.document.querySelector('.feed');
    let html = ''; for (let i = 0; i < 60; i++) html += card('m' + i);
    feed.innerHTML = html;
    await settle();
    ctx.document.querySelectorAll('[data-feed-item] .text').forEach((t) => { t.textContent = 'edited'; });
    await settle(5);
    assert.ok(calls <= 3, 'adapter.surfaces() calls for one 60-root flush: ' + calls);
    // a settings change re-applies the surface without re-counting it
    ctx.NoSlop.engine.flushStats();
    const before = ctx.NoSlop.host.__reports.filter((r) => r.reason === 'surface:hideShorts').reduce((n, r) => n + r.count, 0);
    assert.equal(before, 1);
    await ctx.NoSlop.host.patchSettings({ showStubs: false });
    await settle();
    ctx.document.querySelector('.shorts-shelf').classList.remove('noslop-surface'); // site re-render drops the class
    ctx.NoSlop.engine.applySurfaces();
    ctx.NoSlop.engine.flushStats();
    const after = ctx.NoSlop.host.__reports.filter((r) => r.reason === 'surface:hideShorts').reduce((n, r) => n + r.count, 0);
    assert.equal(after, 1, 'no re-bump on settings change / re-render');
    a.surfaces = orig;
  });
  test('surface strategy height-zero collapses instead of display:none', async () => {
    await boot('', { beforeStart: ({ NoSlop }) => { const a = NoSlop.adapters.list()[0]; const orig = a.surfaces; a.surfaces = () => orig.call(a).map((s) => (s.settingKey === 'hideShorts' ? Object.assign({}, s, { strategy: 'height-zero' }) : s)); } });
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideShorts: true }) });
    await settle();
    const shelf = ctx.document.querySelector('.shorts-shelf');
    assert.ok(shelf.classList.contains('noslop-surface') && shelf.classList.contains('noslop-surface--height-zero'));
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideShorts: false }) });
    await settle();
    assert.ok(!shelf.classList.contains('noslop-surface') && !shelf.classList.contains('noslop-surface--height-zero'));
  });
  test('surfaces: shorts shelf hidden only when settings.surfaces.hideShorts, with a stats bump', async () => {
    await boot('');
    const shelf = ctx.document.querySelector('.shorts-shelf');
    assert.ok(!shelf.classList.contains('noslop-surface'));
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideShorts: true }) });
    await settle();
    assert.ok(shelf.classList.contains('noslop-surface'));
    assert.equal(shelf.getAttribute('data-noslop-surface'), 'hideShorts');
    ctx.NoSlop.engine.flushStats();
    assert.ok(ctx.NoSlop.host.__reports.some((r) => r.reason === 'surface:hideShorts' && r.action === 'hide'));
    await ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { hideShorts: false }) });
    await settle();
    assert.ok(!shelf.classList.contains('noslop-surface'));
  });
  test('settings change: mode off unapplies everything; back to balanced re-applies', async () => {
    await boot(card('p1', { label: 'AI info' }) + card('s1', { text: SLOP }));
    assert.equal(ctx.NoSlop.engine.handleMessage({ type: 'noslopStatus' }).hidden, 2);
    await ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.engine.settings.sites, { example: { mode: 'off' } }) });
    await settle();
    assert.ok(!el('p1').classList.contains('noslop-hidden'));
    assert.ok(!el('s1').classList.contains('noslop-dim'));
    assert.equal(el('p1').querySelector('.noslop-stub'), null);
    assert.equal(ctx.NoSlop.engine.handleMessage({ type: 'noslopStatus' }).hidden, 0, '"Hidden on this tab" reflects what is hidden');
    assert.equal(ctx.NoSlop.engine.recentHidden().items.length, 0);
    await ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.engine.settings.sites, { example: { mode: 'balanced' } }) });
    await settle();
    assert.ok(el('p1').classList.contains('noslop-hidden'));
    assert.ok(el('s1').classList.contains('noslop-dim'));
  });
  test('stop() restores the DOM and the history functions', async () => {
    await boot(card('p1', { label: 'AI info' }) + card('s1', { text: SLOP }));
    const push = ctx.window.history.pushState;
    ctx.NoSlop.engine.stop();
    assert.ok(!el('p1').classList.contains('noslop-hidden'));
    assert.equal(el('p1').getAttribute('data-noslop-id'), null);
    assert.equal(ctx.document.querySelector('.noslop-stub, .noslop-badge'), null);
    assert.notEqual(ctx.window.history.pushState, push);
    assert.equal(ctx.NoSlop.engine.running, false);
  });
  test('engine waits for document.body when started at document_start', async () => {
    const c = await loadScripts(FILES, { url: URL, html: '<!doctype html><html><head></head><body></body></html>' });
    const { NoSlop, document } = c;
    document.body.remove();
    const p = NoSlop.engine.start({ adapter: NoSlop.adapters.pick(c.window.location), rules: NoSlop.rules, host: NoSlop.host });
    await p;
    assert.equal(NoSlop.engine.running, true);
    const body = document.createElement('body');
    body.innerHTML = '<div class="feed">' + card('b1', { label: 'AI info' }) + '</div>';
    document.documentElement.appendChild(body);
    await settle(5);
    assert.equal(document.querySelector('[data-id="b1"]').getAttribute('data-noslop-action'), 'hide');
    NoSlop.engine.stop();
  });
});

describe('enrich queue', () => {
  test('a "none" item is enriched, re-scored, hidden, counted once, and the enrich result is persisted', async () => {
    const seen = [];
    await boot(card('v1', { text: 'plain title' }) + card('v2', { text: 'another' }) + card('v3', { text: 'third' }), {
      beforeStart: ({ NoSlop }) => { NoSlop.adapters.exampleEnrich = async (item) => { seen.push(item.id); await new Promise((r) => setTimeout(r, 5)); return item.id === 'v1' ? { labels: [{ type: 'platform_ai', id: 'example_watch', text: 'Made with AI' }] } : null; }; }
    });
    assert.ok(ctx.NoSlop.engine._E.inflight.size <= 2, 'concurrency from settings (2)');
    await ctx.NoSlop.engine.waitIdle();
    await settle();
    deq(seen.sort(), ['v1', 'v2', 'v3']);
    assert.equal(el('v1').getAttribute('data-noslop-action'), 'hide');
    assert.ok(stateOf('v1').verdict.reasons.includes('label:example_watch'));
    assert.equal(el('v2').getAttribute('data-noslop-action'), 'none');
    const entry = ctx.NoSlop.engine.cache.get('example:v1');
    assert.equal(entry.enriched, true); assert.ok(entry.enrich.labels);
    assert.equal(ctx.NoSlop.engine.cache.get('example:v2').enriched, true, 'negative results are remembered too');
    // not enriched twice
    ctx.NoSlop.engine.processNow();
    await ctx.NoSlop.engine.waitIdle();
    assert.equal(seen.length, 3);
    await ctx.NoSlop.engine.persistNow();
    const stored = (await ctx.NoSlop.host.storageGet('verdicts:example'))['verdicts:example'];
    assert.ok(stored.some(([k, v]) => k === 'example:v1' && v.enriched && v.enrich.labels));
    ctx.NoSlop.engine.flushStats();
    const hides = ctx.NoSlop.host.__reports.filter((r) => r.action === 'hide' && r.reason === 'label:example_watch');
    assert.equal(hides.length, 1); assert.equal(hides[0].count, 1);
    delete ctx.NoSlop.adapters.exampleEnrich;
  });
  test('enrich respects youtubePrefetch=false for the youtube site and settings.enrich=false generally', async () => {
    let calls = 0;
    await boot(card('v1'), { settings: { enrich: false }, beforeStart: ({ NoSlop }) => { NoSlop.adapters.exampleEnrich = async () => { calls++; return null; }; } });
    await ctx.NoSlop.engine.waitIdle();
    assert.equal(calls, 0);
    delete ctx.NoSlop.adapters.exampleEnrich;
  });
  test('a rejected enrich is a FAILURE, not a negative result: enriched stays false, nothing persisted, retried after a doubling backoff, max 3 attempts', async () => {
    let calls = 0;
    await boot(card('v1'), { beforeStart: ({ NoSlop }) => { NoSlop.engine._E.enrichRetryMs = 60; NoSlop.adapters.exampleEnrich = async () => { calls++; throw new Error('boom'); }; } });
    await ctx.NoSlop.engine.waitIdle();
    const e = ctx.NoSlop.engine.cache.get('example:v1');
    assert.equal(e.enriched, false); assert.equal(e.enrichAttempts, 1); assert.ok(e.enrichFailedAt > 0);
    assert.equal(el('v1').getAttribute('data-noslop-action'), 'none');
    // a re-process before the backoff does not retry
    ctx.NoSlop.engine.processNow(); await ctx.NoSlop.engine.waitIdle();
    assert.equal(calls, 1);
    await ctx.NoSlop.engine.persistNow();
    const stored = (await ctx.NoSlop.host.storageGet('verdicts:example'))['verdicts:example'] || [];
    assert.ok(!stored.some(([k]) => k === 'example:v1'), 'a failure is never persisted');
    await new Promise((r) => setTimeout(r, 260)); await ctx.NoSlop.engine.waitIdle(); // 60 ms, then 120 ms backoffs
    assert.equal(calls, 3, 'retried twice (3 attempts per page life)');
    assert.equal(ctx.NoSlop.engine.cache.get('example:v1').enrichAttempts, 3);
    await new Promise((r) => setTimeout(r, 260)); ctx.NoSlop.engine.processNow(); await ctx.NoSlop.engine.waitIdle();
    assert.equal(calls, 3, 'no fourth attempt');
    // a later SUCCESS clears the failure bookkeeping
    ctx.NoSlop.engine.invalidate('v1');
    ctx.NoSlop.adapters.exampleEnrich = async () => ({ labels: [{ type: 'platform_ai', id: 'example_watch' }] });
    await ctx.NoSlop.engine.waitIdle(); await settle();
    assert.equal(el('v1').getAttribute('data-noslop-action'), 'hide');
    assert.equal(ctx.NoSlop.engine.cache.get('example:v1').enriched, true);
    delete ctx.NoSlop.adapters.exampleEnrich;
  });
  test('enabled:false and sites.<site>.mode "off" stop enrich AND surface hides (not only the scorer)', async () => {
    let calls = 0;
    const enrich = async () => { calls++; return null; };
    await boot(card('v1') + card('v2'), { settings: { enabled: false, surfaces: Object.assign({}, ctx && ctx.NoSlop ? {} : {}, { hideShorts: true }) }, beforeStart: ({ NoSlop }) => { NoSlop.adapters.exampleEnrich = enrich; } });
    await ctx.NoSlop.engine.waitIdle(); await settle();
    assert.equal(ctx.NoSlop.engine.siteActive(), false);
    assert.equal(calls, 0, 'no enrich while disabled');
    assert.equal(ctx.document.querySelectorAll('.noslop-surface').length, 0, 'no surface hides while disabled');
    assert.equal(el('v1').getAttribute('data-noslop-action'), 'none');
    ctx.NoSlop.engine.stop();
    await boot(card('v1'), { settings: { sites: { example: { mode: 'off' } }, surfaces: { hideShorts: true } }, beforeStart: ({ NoSlop }) => { NoSlop.adapters.exampleEnrich = enrich; } });
    await ctx.NoSlop.engine.waitIdle(); await settle();
    assert.equal(calls, 0, 'no enrich with the site off');
    assert.equal(ctx.document.querySelectorAll('.noslop-surface').length, 0);
    // switching back on applies the surface and enriches
    await ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.engine.settings.sites, { example: { mode: 'balanced' } }) });
    await ctx.NoSlop.engine.waitIdle(); await settle();
    assert.ok(calls >= 1);
    assert.equal(ctx.document.querySelectorAll('.noslop-surface').length, 1);
    delete ctx.NoSlop.adapters.exampleEnrich;
  });
});

describe('cache persistence, TTL and LRU', () => {
  test('persisted verdicts (tier <= 1) are stored and reloaded; expired entries are dropped', async () => {
    await boot(card('p1', { label: 'AI info' }) + card('h1'), { settings: { enrich: false } });
    await ctx.NoSlop.engine.persistNow();
    const rows = (await ctx.NoSlop.host.storageGet('verdicts:example'))['verdicts:example'];
    assert.ok(rows.some(([k]) => k === 'example:p1'));
    assert.ok(!rows.some(([k]) => k === 'example:h1'), 'tier null is not persisted');
    // simulate a reload with one expired row
    const expired = ['example:old', { verdict: { action: 'hide', tier: 0, reasons: ['label:x'], score: 1.5 }, enrich: null, enriched: true, ts: Date.now() - 8 * 24 * 3600 * 1000, epoch: rows[0][1].epoch }];
    await ctx.NoSlop.host.storageSet({ 'verdicts:example': rows.concat([expired]) });
    ctx.NoSlop.engine.stop();
    await ctx.NoSlop.engine.start({ adapter: ctx.NoSlop.adapters.pick(ctx.window.location), rules: ctx.NoSlop.rules, host: ctx.NoSlop.host });
    await settle();
    assert.ok(ctx.NoSlop.engine.cache.has('example:p1'));
    assert.ok(!ctx.NoSlop.engine.cache.has('example:old'));
  });
  test('LRU keeps at most 5000 entries', async () => {
    await boot('');
    const feed = ctx.document.querySelector('.feed');
    let html = '';
    for (let i = 0; i < 5100; i++) html += `<div data-feed-item data-id="m${i}"><div class="text">t${i}</div></div>`;
    feed.innerHTML = html;
    ctx.NoSlop.engine.processNow();
    assert.equal(ctx.NoSlop.engine.cache.size, 5000);
    assert.ok(!ctx.NoSlop.engine.cache.has('example:m0'));
    assert.ok(ctx.NoSlop.engine.cache.has('example:m5099'));
  });
});

describe('stats and auto-promotion', () => {
  test('stats are bumped once per id with the primary reason and reported in batches', async () => {
    await boot(card('p1', { label: 'AI info' }) + card('p2', { text: 'made with AI #aiart' }) + card('s1', { text: SLOP }) + card('h1'));
    ctx.NoSlop.engine.processNow(); ctx.NoSlop.engine.processNow();
    ctx.NoSlop.engine.flushStats();
    const r = ctx.NoSlop.host.__reports;
    assert.ok(r.every((e) => e.type === 'stats' && e.site === 'example'));
    const find = (action, reason) => r.find((e) => e.action === action && e.reason === reason);
    assert.equal(find('hide', 'label:example_label').count, 1);
    assert.ok(find('hide', 'disclosure:verb_with_tool') || find('hide', 'hashtag:#aiart'));
    assert.ok(r.some((e) => e.action === 'dim'));
    assert.equal(r.reduce((n, e) => n + e.count, 0), 3);
  });
  test('auto-promotion: 3 tier-1 hits on one author block the author (not when disabled)', async () => {
    await boot(card('a', { text: 'made with AI', author: 'spammer' }) + card('b', { text: '#aiart', author: 'spammer' }));
    let s = await ctx.NoSlop.host.getSettings();
    deq(s.blockedAccounts.example || [], []);
    ctx.document.querySelector('.feed').insertAdjacentHTML('beforeend', card('c', { text: 'fully AI', author: 'spammer' }));
    await settle(5);
    s = await ctx.NoSlop.host.getSettings();
    deq(s.blockedAccounts.example, ['spammer']);
    ctx.NoSlop.engine.stop();
    await boot(card('a', { text: 'made with AI', author: 'spammer' }) + card('b', { text: '#aiart', author: 'spammer' }) + card('c', { text: 'fully AI', author: 'spammer' }), { settings: { autoPromote: { enabled: false, hits: 3 } } });
    await settle(5);
    deq((await ctx.NoSlop.host.getSettings()).blockedAccounts.example || [], []);
  });
  test('auto-promotion ignores style-only and account-based verdicts', async () => {
    await boot(card('a', { text: SLOP, author: 'writer' }) + card('b', { text: SLOP, author: 'writer' }) + card('c', { text: SLOP, author: 'writer' }));
    await settle(5);
    deq((await ctx.NoSlop.host.getSettings()).blockedAccounts.example || [], []);
  });
  test('auto-promotion never promotes on a display NAME alone (a stable handle/id is required)', async () => {
    const named = (id) => `<div data-feed-item data-id="${id}" data-author="" data-author-name="Relaxing Music" data-label="AI info"><div class="text">x</div></div>`;
    await boot(named('a') + named('b') + named('c'));
    await settle(5);
    deq((await ctx.NoSlop.host.getSettings()).blockedAccounts.example || [], [], 'three name-only hits must not block "Relaxing Music" for every channel sharing that name');
    assert.equal(el('a').getAttribute('data-noslop-action'), 'hide', 'the items themselves are still hidden');
  });
  test('per-session maps are bounded: counted / authorHits are evicted with the cache LRU', async () => {
    await boot('');
    const E = ctx.NoSlop.engine._E;
    const feed = ctx.document.querySelector('.feed');
    let html = '';
    for (let i = 0; i < 5100; i++) html += `<div data-feed-item data-id="m${i}" data-author="spam${i % 2500}" data-label="AI info"><div class="text">t${i}</div></div>`;
    feed.innerHTML = html;
    ctx.NoSlop.engine.processNow();
    assert.equal(E.cache.size, 5000);
    assert.ok(E.counted.size <= 5000, 'counted: ' + E.counted.size);
    assert.ok(!E.counted.has('example:m0'), 'evicted with its cache row');
    assert.ok(E.authorHits.size <= 2000, 'authorHits LRU: ' + E.authorHits.size);
    for (const set of E.authorHits.values()) assert.ok(set.size <= 10);
  });
});

describe('persistence hygiene', () => {
  test('persisted enrich rows carry a bounded text snippet, rows are capped, other tabs\' rows are merged (read-merge-write)', async () => {
    const big = 'x'.repeat(2000);
    await boot(card('v1', { text: 'plain' }), { beforeStart: ({ NoSlop }) => { NoSlop.adapters.exampleEnrich = async () => ({ labels: [{ type: 'platform_ai', id: 'example_watch' }], text: big, title: 'T'.repeat(500), hashtags: ['#x'], author: { handle: 'h' }, extra: { autoDubbed: false } }); } });
    await ctx.NoSlop.engine.waitIdle(); await settle();
    assert.equal(ctx.NoSlop.engine.cache.get('example:v1').enrich.text.length, 2000, 'in-memory enrich keeps the full text');
    // another tab wrote its own rows meanwhile
    await ctx.NoSlop.host.storageSet({ 'verdicts:example': [['example:other', { verdict: { action: 'hide', tier: 0, reasons: ['label:x'], score: 1.5 }, enrich: null, enriched: true, ts: Date.now(), epoch: 'z', surface: 'home' }]] });
    await ctx.NoSlop.engine.persistNow();
    const rows = (await ctx.NoSlop.host.storageGet('verdicts:example'))['verdicts:example'];
    const mine = rows.find(([k]) => k === 'example:v1')[1];
    assert.ok(mine.enrich.text.length <= 300, 'text snippet capped: ' + mine.enrich.text.length);
    assert.ok(mine.enrich.title.length <= 200);
    deq(mine.enrich.labels, [{ type: 'platform_ai', id: 'example_watch' }]);
    deq(mine.enrich.hashtags, ['#x']); deq(mine.enrich.author, { handle: 'h' }); deq(mine.enrich.extra, { autoDubbed: false });
    assert.ok(rows.some(([k]) => k === 'example:other'), 'the other tab\'s row survived');
    // a rejected storageSet halves the row cap instead of silently giving up
    const origSet = ctx.NoSlop.host.storageSet;
    ctx.NoSlop.host.storageSet = () => Promise.reject(new Error('QuotaExceededError'));
    await ctx.NoSlop.engine.persistNow();
    assert.equal(ctx.NoSlop.engine._E.persistCap, 500);
    ctx.NoSlop.host.storageSet = origSet;
    delete ctx.NoSlop.adapters.exampleEnrich;
  });
  test('at most persistCap rows (newest first) are written', async () => {
    await boot('');
    ctx.NoSlop.engine._E.persistCap = 50;
    const feed = ctx.document.querySelector('.feed');
    let html = ''; for (let i = 0; i < 120; i++) html += card('m' + i, { label: 'AI info' });
    feed.innerHTML = html;
    ctx.NoSlop.engine.processNow();
    await ctx.NoSlop.engine.persistNow();
    const rows = (await ctx.NoSlop.host.storageGet('verdicts:example'))['verdicts:example'];
    assert.equal(rows.length, 50);
  });
});

describe('host (memory) and rules override', () => {
  test('memory host exposes __memory and round-trips settings and storage', async () => {
    const { NoSlop } = await loadScripts(CORE_FILES);
    assert.equal(NoSlop.host.__memory, true);
    const s = await NoSlop.host.getSettings();
    assert.equal(s.version, 1); assert.equal(s.sites.youtube.mode, 'balanced');
    let seen = null; NoSlop.host.onSettingsChanged((n) => { seen = n; });
    const next = await NoSlop.host.patchSettings({ showStubs: false });
    assert.equal(next.showStubs, false); assert.equal(seen.showStubs, false); assert.ok(next.updatedAt > 0);
    await NoSlop.host.storageSet({ foo: { a: 1 } });
    deq(await NoSlop.host.storageGet('foo'), { foo: { a: 1 } });
    deq(await NoSlop.host.storageGet(['foo', 'bar']), { foo: { a: 1 } });
    NoSlop.host.__fetchText = async (u) => 'html for ' + u;
    assert.equal(await NoSlop.host.fetchText('https://www.youtube.com/watch?v=1'), 'html for https://www.youtube.com/watch?v=1');
  });
  test('settings.rulesOverride replaces the bundled rules', async () => {
    await boot(card('p1', { text: 'the secret word is pumpernickel' }));
    assert.equal(el('p1').getAttribute('data-noslop-action'), 'none');
    const override = JSON.parse(JSON.stringify(ctx.NoSlop.rules));
    override.disclosure.regex.push({ id: 'pump', regex: 'pumpernickel', score: 1.0 });
    await ctx.NoSlop.host.patchSettings({ rulesOverride: override });
    await settle();
    assert.equal(el('p1').getAttribute('data-noslop-action'), 'hide');
    assert.ok(stateOf('p1').verdict.reasons.includes('disclosure:pump'));
  });
});
