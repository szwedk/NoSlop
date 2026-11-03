// adapters/linkedin.js — extraction on the SYNTHETIC LinkedIn fixtures and engine end-to-end.
// Run: cd /Users/kamilszwed/Projects/NoSlop && node --test tests/adapters/linkedin.test.mjs
// Fixtures: tests/fixtures/linkedin/synthetic-feed.html (fixtures agent) and synthetic-feed-labels.html (this agent);
// both are hand-written from docs/research/platform-dom-and-ai-labels.md §2.8 — nothing here is a live capture.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScripts, CORE_FILES, settle } from '../helpers/load.mjs';

const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/linkedin');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const FILES = [...CORE_FILES, 'adapters/linkedin.js'];
const URL = 'https://www.linkedin.com/feed/';
const URN = (n) => 'urn:li:activity:70000000000000001' + String(n).padStart(2, '0');
const page = (body) => `<!doctype html><html lang="en"><head></head><body>${body}</body></html>`;

const CARD = (n, { text = 'a normal post about my team', slug = 'alice-synthetic', name = 'Alice', label = '', promoted = false } = {}) =>
  `<div role="listitem" componentkey="update-card-focus-${URN(n)}"><div data-testid="update-card">` +
  `<div><a href="https://www.linkedin.com/in/${slug}"><span>${name}</span></a>${promoted ? '<p><span>Promoted</span></p>' : ''}</div>` +
  `<div><span data-testid="expandable-text-box" dir="ltr">${text}</span></div>` +
  (label ? `<div><span>${label}</span></div>` : '') + '</div></div>';
const FEED = (cards) => `<main><div data-testid="mainFeed"><div role="list">${cards}</div></div></main>`;

let ctx;
afterEach(() => { if (ctx && ctx.NoSlop && ctx.NoSlop.engine.running) ctx.NoSlop.engine.stop(); ctx = null; });

async function load(html, url = URL) {
  const c = await loadScripts(FILES, { url, html: page(html) });
  const adapter = c.NoSlop.adapters.pick(c.window.location);
  return Object.assign(c, { adapter });
}
async function boot(html, opts = {}) {
  ctx = await load(html, opts.url);
  if (opts.settings) await ctx.NoSlop.host.patchSettings(opts.settings);
  await ctx.NoSlop.engine.start({ adapter: ctx.adapter, rules: ctx.NoSlop.rules, host: ctx.NoSlop.host });
  await settle();
  return ctx;
}
const card = (n) => ctx.document.querySelector(`[componentkey="update-card-focus-${URN(n)}"]`);
const action = (n) => card(n).getAttribute('data-noslop-action');
const stateOf = (n) => ctx.NoSlop.engine.stateOf(card(n));
const extractAll = (c) => c.adapter.findItems(c.document).map((el) => c.adapter.extract(el));

describe('registration and routing', () => {
  test('registers site "linkedin", matches linkedin.com hosts only, reads selectors from rules', async () => {
    const c = await load('');
    assert.equal(c.adapter.site, 'linkedin');
    assert.equal(c.adapter.placeholder, undefined, 'placeholder replaced');
    assert.equal(c.adapter.hideStrategy, c.NoSlop.rules.sites.linkedin.hideStrategy);
    assert.equal(c.adapter.hideStrategy, 'display-none');
    for (const h of ['www.linkedin.com', 'linkedin.com', 'de.linkedin.com']) assert.ok(c.adapter.matches({ hostname: h }), h);
    for (const h of ['notlinkedin.com', 'linkedin.com.evil.test', 'www.youtube.com', '']) assert.ok(!c.adapter.matches({ hostname: h }), h);
    deq(c.adapter.attributeFilter, ['componentkey', 'data-urn', 'data-id']);
    deq(c.adapter.surfaces(), []);
  });
  test('surface(): feed = home, search / hashtag feeds = search, profiles = profile, single posts = other', async () => {
    const c = await load('');
    const s = (p) => c.adapter.surface({ pathname: p });
    assert.equal(s('/feed/'), 'home'); assert.equal(s('/feed'), 'home'); assert.equal(s('/'), 'home');
    assert.equal(s('/search/results/content/?keywords=ai'), 'search');
    assert.equal(s('/feed/hashtag/aiart/'), 'search');
    assert.equal(s('/in/someone/'), 'profile'); assert.equal(s('/company/example/posts/'), 'profile');
    assert.equal(s('/feed/update/urn:li:activity:1/'), 'other'); assert.equal(s('/posts/someone_slug-1'), 'other');
    assert.equal(s('/messaging/'), 'other');
  });
  test('content.js picks the linkedin adapter on www.linkedin.com and starts the engine', async () => {
    const js = ['rules.js', 'lib/dom.js', 'lib/scorer.js', 'lib/host-extension.js', 'lib/engine.js', 'adapters/youtube.js', 'adapters/x.js', 'adapters/instagram.js', 'adapters/facebook.js', 'adapters/tiktok.js', 'adapters/reddit.js', 'adapters/linkedin.js', 'content.js'];
    const c = await loadScripts(js, { url: URL, html: page(fixture('synthetic-feed.html')) });
    await settle(5);
    assert.equal(c.NoSlop.engine.site, 'linkedin');
    assert.equal(c.document.querySelectorAll('[data-noslop-id]').length, 3);
    c.NoSlop.engine.stop();
  });
  test('no feed (login page / top-content) -> no items, and extract() of a non-card is null', async () => {
    const c = await load('<main><form><input name="session_key"><input name="session_password"></form></main>');
    deq(c.adapter.findItems(c.document), []);
    assert.equal(c.adapter.extract(c.document.querySelector('form')), null);
  });
});

describe('extraction: fixtures agent synthetic-feed.html', () => {
  test('three cards: urn ids, body text, actor handle/name, promoted label, no AI labels', async () => {
    const c = await load(fixture('synthetic-feed.html'));
    const items = extractAll(c);
    assert.equal(items.length, 3);
    deq(items.map((i) => i.id), ['urn:li:activity:7000000000000000001', 'urn:li:activity:7000000000000000002', 'urn:li:activity:7000000000000000003']);
    assert.equal(items[0].text, 'We shipped the migration last night. 14 months, 3 teams, zero downtime. Writing up what broke (a lot) next week.');
    deq(items[0].author, { handle: 'human-engineer-synthetic', id: 'in/human-engineer-synthetic', name: 'Human Engineer' });
    deq(items[0].labels, []);
    deq(items[0].media, ['none']);
    assert.equal(items[0].kind, 'post');
    assert.equal(items[0].surface, 'home');
    assert.ok(items[0].links.some((l) => l.includes('/in/human-engineer-synthetic')));
    // promoted company post: span[aria-hidden="true"]Promoted (Greasy Fork 551021 shape)
    deq(items[1].author, { handle: 'example-saas-synthetic', id: 'company/example-saas-synthetic', name: 'Example SaaS' });
    deq(items[1].labels, [{ type: 'promoted' }]);
    assert.equal(items[1].text, 'Cut your reporting time in half. Book a demo.');
    // style-slop post: no label, text intact
    deq(items[2].labels, []);
    assert.match(items[2].text, /^Most people think leadership is about titles\./);
    deq(items[2].hashtags, []);
  });
});

describe('extraction: synthetic-feed-labels.html', () => {
  test('ids, skeleton skip, outermost-only, hashtags, media', async () => {
    const c = await load(fixture('synthetic-feed-labels.html'));
    const els = c.adapter.findItems(c.document);
    assert.equal(els.length, 8, '7 new-DOM listitems + 1 old-DOM article');
    const items = els.map((el) => c.adapter.extract(el));
    assert.equal(items[5], null, 'skeleton without a URN is skipped');
    const by = Object.fromEntries(items.filter(Boolean).map((i) => [i.id.slice(-3), i]));
    deq(Object.keys(by).sort(), ['101', '102', '103', '104', '105', '107', '201']);
    deq(by['101'].hashtags, ['#sre', '#oncall']);
    deq(by['101'].media, ['none'], 'avatar inside the actor link is not post media');
    deq(by['102'].media, ['image']);
    assert.equal(by['101'].extra.dom, 'new'); assert.equal(by['201'].extra.dom, 'old');
    // findItems(root) also accepts the card itself as root, and does not return nested cards twice
    assert.equal(c.adapter.findItems(els[0]).length, 1);
    assert.equal(c.adapter.findItems(els[0])[0], els[0]);
  });
  test('C2PA icon -> c2pa label (provenance, not platform_ai); "Created with AI" outside the body -> platform_ai', async () => {
    const c = await load(fixture('synthetic-feed-labels.html'));
    const items = extractAll(c).filter(Boolean);
    const by = Object.fromEntries(items.map((i) => [i.id.slice(-3), i]));
    deq(by['102'].labels, [{ type: 'c2pa', id: 'linkedin_c2pa', text: 'Content credentials' }]);
    deq(by['103'].labels, [{ type: 'platform_ai', id: 'linkedin_text', text: 'created with ai' }]);
    deq(by['104'].labels, [], 'self-disclosure in the body is NOT a platform label');
    deq(by['101'].labels, []);
  });
  test('C2PA by exact text when the icon selector is absent; body text never counts as a label', async () => {
    const c = await load(FEED(
      CARD(1, { label: 'Content credentials' }) +
      CARD(2, { text: 'Content credentials are coming to every camera. Written by AI? No, by me.' }) +
      CARD(3, { label: 'Written by AI' })));
    const [a, b, d] = extractAll(c);
    deq(a.labels, [{ type: 'c2pa', id: 'linkedin_c2pa_text', text: 'content credentials' }]);
    deq(b.labels, []);
    deq(d.labels, [{ type: 'platform_ai', id: 'linkedin_text', text: 'written by ai' }]);
  });
  test('"…more" button and @mention inside the body: text stripped, <br> kept as newlines, author is the actor', async () => {
    const c = await load(fixture('synthetic-feed-labels.html'));
    const it = extractAll(c).filter(Boolean).find((i) => i.id.endsWith('107'));
    assert.equal(it.text, 'Big thanks to Mentioned Person for the review.\nFirst line of the story.\nSecond line of the story.');
    deq(it.author, { handle: 'long-poster-synthetic', id: 'in/long-poster-synthetic', name: 'Long Poster' });
    // a text-only "…more" tail (no button) is stripped too and flagged
    const c2 = await load(FEED(CARD(9, { text: 'Short story so far …more' })));
    const it2 = extractAll(c2)[0];
    assert.equal(it2.text, 'Short story so far');
    assert.equal(it2.extra.truncated, true);
  });
  test('old Ember DOM article: id from data-urn, actor from the actor block (not the social header), a11y duplicates dropped, Promoted', async () => {
    const c = await load(fixture('synthetic-feed-labels.html'));
    const it = extractAll(c).filter(Boolean).find((i) => i.id.endsWith('201'));
    assert.equal(it.id, 'urn:li:activity:7000000000000000201');
    deq(it.author, { handle: 'old-ember-synthetic', id: 'in/old-ember-synthetic', name: 'Old Ember' });
    assert.equal(it.text, 'Our new course is live.\nThree modules, zero fluff.\nLink in the comments.');
    deq(it.labels, [{ type: 'promoted' }]);
    deq(it.media, ['image']);
  });
  test('new DOM promoted (p > span, better-linkedin shape) is exact-match only: "Promoted to Director" is not an ad', async () => {
    const c = await load(FEED(CARD(1, { promoted: true }) + CARD(2).replace('<p><span>', '').replace('</span></p>', '')
      .replace('<div><a', '<div><p><span>Promoted to Director at Example</span></p><a')));
    const [ad, notAd] = extractAll(c);
    deq(ad.labels, [{ type: 'promoted' }]);
    deq(notAd.labels, []);
  });
  test('id fallback: a permalink inside the card when no attribute carries the URN', async () => {
    const c = await load('<div class="feed-shared-update-v2" role="article"><a href="/feed/update/urn:li:activity:7000000000000000301/">1h</a>' +
      '<div class="feed-shared-update-v2__description">hello</div></div>');
    const it = extractAll(c)[0];
    assert.equal(it.id, 'urn:li:activity:7000000000000000301');
    assert.equal(it.text, 'hello');
  });
});

describe('engine end-to-end on synthetic-feed-labels.html', () => {
  test('platform label hides with a stub; c2pa and style slop dim; plain and skeleton untouched; disclosure hides', async () => {
    await boot(fixture('synthetic-feed-labels.html'));
    // L103: platform "Created with AI" label -> hide + stub with Show / Never show @handle
    assert.equal(action(3), 'hide');
    const h = card(3);
    assert.ok(h.classList.contains('noslop-hidden') && h.classList.contains('noslop-hidden--display-none'));
    const stub = h.querySelector(':scope > .noslop-stub');
    assert.ok(stub, 'stub inserted');
    assert.match(stub.textContent, /Hidden: AI content/);
    assert.match(stub.textContent, /platform AI label/);
    assert.ok(stub.querySelector('[data-noslop-act="show"]'));
    assert.match(stub.querySelector('[data-noslop-act="never"]').textContent, /Never show @dash-boards-synthetic/);
    assert.ok(stateOf(3).verdict.reasons.includes('label:linkedin_text'));
    assert.equal(stateOf(3).verdict.tier, 0);
    // L101: plain post untouched
    assert.equal(action(1), 'none');
    assert.ok(!card(1).classList.contains('noslop-hidden') && !card(1).classList.contains('noslop-dim'));
    assert.equal(card(1).querySelector('.noslop-stub, .noslop-badge'), null);
    // L102: C2PA = provenance (most often a real camera / Photoshop), not AI -> c2paScore 0.5: untouched in balanced,
    // tier 3 (never persisted as a tier<=1 verdict, never auto-promotes); dims in strict (see the strict test)
    assert.equal(action(2), 'none');
    assert.ok(!card(2).classList.contains('noslop-dim'));
    assert.equal(card(2).querySelector(':scope > .noslop-badge'), null);
    deq(stateOf(2).verdict.reasons, ['label:c2pa']);
    assert.equal(stateOf(2).verdict.tier, 3);
    // L104: self-disclosed + #aiart + Midjourney -> hide at tier 1
    assert.equal(action(4), 'hide');
    assert.equal(stateOf(4).verdict.tier, 1);
    assert.ok(stateOf(4).verdict.reasons.some((r) => r.startsWith('disclosure:')));
    assert.ok(stateOf(4).verdict.reasons.includes('hashtag:#aiart'));
    // L105: style slop -> dim, never hide
    assert.equal(action(5), 'dim');
    assert.ok(!card(5).classList.contains('noslop-hidden'));
    assert.equal(stateOf(5).verdict.tier, 3);
    assert.equal(stateOf(5).verdict.nonStyleScore, 0);
    assert.ok(stateOf(5).verdict.reasons.every((r) => r.startsWith('style:')));
    // L106 skeleton: never processed
    assert.equal(ctx.document.querySelector('[componentkey="update-card-focus-"]').getAttribute('data-noslop-id'), null);
    // L107 plain + old DOM promoted (hideAds off) untouched
    assert.equal(action(7), 'none');
    assert.equal(ctx.document.querySelector('[data-urn]').getAttribute('data-noslop-action'), 'none');
  });
  test('strict mode: style slop still only dims; c2pa dims (0.5 >= 0.4) but never hides', async () => {
    await boot(fixture('synthetic-feed-labels.html'), { settings: { sites: { linkedin: { mode: 'strict' } } } });
    assert.equal(ctx.NoSlop.engine.settings.sites.linkedin.mode, 'strict');
    assert.equal(action(5), 'dim'); assert.equal(action(2), 'dim'); assert.equal(action(3), 'hide'); assert.equal(action(1), 'none');
    assert.ok(card(2).querySelector(':scope > .noslop-badge'));
  });
  test('mode off leaves everything alone', async () => {
    await boot(fixture('synthetic-feed-labels.html'), { settings: { sites: { linkedin: { mode: 'off' } } } });
    assert.equal(ctx.document.querySelector('.noslop-hidden, .noslop-dim, .noslop-stub, .noslop-badge'), null);
  });
  test('surfaces toggles: hideAds hides Promoted cards (new and old DOM) and off again restores them; other toggles are no-ops', async () => {
    await boot(fixture('synthetic-feed-labels.html') + FEED(CARD(8, { promoted: true })));
    const oldAd = ctx.document.querySelector('[data-urn]');
    assert.equal(oldAd.getAttribute('data-noslop-action'), 'none');
    assert.equal(action(8), 'none');
    const surf = (patch) => ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, patch) });
    await surf({ hideAds: true }); await settle();
    assert.equal(oldAd.getAttribute('data-noslop-action'), 'hide');
    assert.equal(action(8), 'hide');
    assert.ok(stateOf(8).verdict.reasons.includes('ad:promoted'));
    assert.match(card(8).querySelector('.noslop-stub').textContent, /promoted/);
    assert.equal(action(1), 'none', 'non-promoted still untouched');
    await surf({ hideAds: false }); await settle();
    assert.equal(oldAd.getAttribute('data-noslop-action'), 'none');
    assert.equal(action(8), 'none');
    assert.equal(card(8).querySelector('.noslop-stub'), null);
    await surf({ hideShorts: true, hideReels: true, hideGrokPosts: true, hideTikTokForYou: true }); await settle();
    assert.equal(ctx.document.querySelector('.noslop-surface'), null, 'linkedin declares no CSS surfaces');
    assert.equal(action(3), 'hide'); assert.equal(action(1), 'none');
  });
  test('Show on the stub un-hides for the session; Never show adds the actor handle to blockedAccounts.linkedin', async () => {
    await boot(fixture('synthetic-feed-labels.html') + FEED(CARD(9, { slug: 'dash-boards-synthetic', name: 'Dash Boards', text: 'another plain post' })));
    assert.equal(action(9), 'none');
    card(3).querySelector('[data-noslop-act="show"]').click();
    await settle();
    assert.equal(action(3), 'none');
    assert.ok(!card(3).classList.contains('noslop-hidden'));
    card(4).querySelector('[data-noslop-act="never"]').click();
    await settle();
    const s = await ctx.NoSlop.host.getSettings();
    deq(s.blockedAccounts.linkedin, ['prompt-pete-synthetic']);
    // block a second author via the API and check the plain post by that author is hidden
    await ctx.NoSlop.host.patchSettings({ blockedAccounts: Object.assign({}, s.blockedAccounts, { linkedin: ['prompt-pete-synthetic', 'dash-boards-synthetic'] }) });
    await settle();
    assert.equal(action(9), 'hide');
    assert.ok(stateOf(9).verdict.reasons.includes('account:block'));
  });
  test('allowedAccounts wins over a platform label', async () => {
    await boot(fixture('synthetic-feed-labels.html'), { settings: { allowedAccounts: { linkedin: ['dash-boards-synthetic'] } } });
    assert.equal(action(3), 'none');
    deq(stateOf(3).verdict.reasons, ['account:allow']);
  });
});

describe('SPA re-render, virtualization and cell reuse', () => {
  test('MutationObserver: cards appended later are processed', async () => {
    await boot(FEED(''));
    ctx.document.querySelector('[role="list"]').insertAdjacentHTML('beforeend', CARD(1, { label: 'Created with AI' }) + CARD(2));
    await settle(5);
    assert.equal(action(1), 'hide'); assert.equal(action(2), 'none');
  });
  test('remove + re-append keeps the hidden state (one stub) and a fresh element for the same id is a cache hit', async () => {
    await boot(fixture('synthetic-feed-labels.html'));
    const e = card(3); const list = e.parentNode;
    e.remove(); await settle();
    list.appendChild(e); await settle(5);
    assert.equal(action(3), 'hide');
    assert.ok(e.classList.contains('noslop-hidden'));
    assert.equal(e.querySelectorAll('.noslop-stub').length, 1, 'exactly one stub');
    const orig = ctx.NoSlop.scorer.score; let calls = 0; ctx.NoSlop.scorer.score = (...a) => { calls++; return orig(...a); };
    list.insertAdjacentHTML('beforeend', CARD(3, { label: 'Created with AI', slug: 'dash-boards-synthetic', name: 'Dash Boards', text: 'Our Q3 numbers, visualised.' }));
    await settle(5);
    ctx.NoSlop.scorer.score = orig;
    assert.equal(calls, 0, 'verdict served from the cache');
    const twins = ctx.document.querySelectorAll(`[componentkey="update-card-focus-${URN(3)}"]`);
    assert.equal(twins.length, 2);
    assert.ok(twins[1].classList.contains('noslop-hidden'));
    ctx.NoSlop.engine.flushStats();
    const hides = ctx.NoSlop.host.__reports.filter((r) => r.action === 'hide' && r.reason === 'label:linkedin_text').reduce((n, r) => n + r.count, 0);
    assert.equal(hides, 1, 'one hide counted per post id');
  });
  test('SPA navigation: pushState to a search page re-reads the surface and processes new cards', async () => {
    await boot(FEED(''));
    assert.equal(ctx.NoSlop.engine.surface, 'home');
    ctx.window.history.pushState({}, '', '/search/results/content/?keywords=ai');
    ctx.document.querySelector('[role="list"]').insertAdjacentHTML('beforeend', CARD(5, { label: 'Created with AI' }));
    await settle(8);
    assert.equal(ctx.NoSlop.engine.surface, 'search');
    assert.equal(action(5), 'hide');
    assert.equal(stateOf(5).item.surface, 'search');
  });
  test('cell reuse: the same element gets a new componentkey + body -> re-verdicted through the observer (attributeFilter)', async () => {
    await boot(FEED(CARD(1, { label: 'Created with AI' })));
    const e = card(1);
    assert.equal(e.getAttribute('data-noslop-action'), 'hide');
    e.setAttribute('componentkey', 'update-card-focus-' + URN(2));
    e.querySelector('[data-testid="update-card"] > div:last-child').remove(); // drop the label block
    e.querySelector('[data-testid="expandable-text-box"]').textContent = 'reused card now showing a human post';
    await settle(6);
    assert.equal(e.getAttribute('data-noslop-id'), URN(2));
    assert.equal(e.getAttribute('data-noslop-action'), 'none');
    assert.ok(!e.classList.contains('noslop-hidden'));
    assert.equal(e.querySelector('.noslop-stub'), null);
    // ...and back: the reused cell now shows a self-disclosed AI post
    e.setAttribute('componentkey', 'update-card-focus-' + URN(3));
    e.querySelector('[data-testid="expandable-text-box"]').textContent = 'Made this video with Sora 2 for the launch. #aivideo';
    await settle(6);
    assert.equal(e.getAttribute('data-noslop-id'), URN(3));
    assert.equal(e.getAttribute('data-noslop-action'), 'hide');
    assert.ok(e.querySelector('.noslop-stub'));
  });
  test('old DOM: data-urn change on a reused article is observed too', async () => {
    await boot('<div class="feed-shared-update-v2" role="article" data-urn="urn:li:activity:7000000000000000401"><div class="feed-shared-update-v2__description">I generated this image with Midjourney #aiart</div></div>');
    const e = ctx.document.querySelector('[role="article"]');
    assert.equal(e.getAttribute('data-noslop-action'), 'hide');
    e.setAttribute('data-urn', 'urn:li:activity:7000000000000000402');
    e.querySelector('.feed-shared-update-v2__description').textContent = 'lunch with the team today';
    await settle(6);
    assert.equal(e.getAttribute('data-noslop-id'), 'urn:li:activity:7000000000000000402');
    assert.equal(e.getAttribute('data-noslop-action'), 'none');
  });
  test('extract() stays correct with the engine stub inserted (re-extraction on sweep)', async () => {
    await boot(FEED(CARD(1, { label: 'Created with AI' })));
    const it = ctx.adapter.extract(card(1));
    assert.equal(it.id, URN(1));
    deq(it.labels, [{ type: 'platform_ai', id: 'linkedin_text', text: 'created with ai' }]);
    assert.equal(it.text, 'a normal post about my team');
    deq(it.author, { handle: 'alice-synthetic', id: 'in/alice-synthetic', name: 'Alice' });
    ctx.NoSlop.engine.processNow();
    assert.equal(card(1).querySelectorAll('.noslop-stub').length, 1);
  });
});
