// Tests for Extension/Resources/adapters/youtube.js (owner: adapter:youtube agent).
// Run: cd /Users/kamilszwed/Projects/NoSlop && node --test tests/adapters/youtube.test.mjs
// Fixtures are the REAL 2026-11-02 captures in tests/fixtures/youtube (www) and tests/fixtures/myoutube (m.).
// Card-level "AI" badges were not observed on any real card that day, so the badge cases below inject a badge
// into a real card — every such injection is marked SYNTHETIC.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadScripts, CORE_FILES, ROOT, settle } from '../helpers/load.mjs';

const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => (m === undefined ? assert.deepEqual(J(a), J(b)) : assert.deepEqual(J(a), J(b), m));
const FILES = [...CORE_FILES, 'adapters/youtube.js'];
const FX = path.join(ROOT, 'tests/fixtures');
const fx = (rel) => fs.readFileSync(path.join(FX, rel), 'utf8');
const SNIPPETS = JSON.parse(fx('youtube/innertube-snippets.json'));

const DESKTOP = 'https://www.youtube.com/';
const MOBILE = 'https://m.youtube.com/';
const SLOP = "It's not about working harder — it's about working smarter. Moreover, furthermore, additionally, delve into the intricate tapestry. In conclusion, leverage synergy. Thoughts?";
// SYNTHETIC: the exact watch-page badge markup (youtube/notes.md "Title badge DOM") placed in the card's metadata badge
// slot (yt-content-metadata-view-model .ytContentMetadataViewModelBadge — the slot the real "Auto-dubbed" badge uses).
const SYNTH_BADGE = '<span class="ytContentMetadataViewModelBadge"><yt-badge-view-model><badge-shape class="ytBadgeShapeHost ytBadgeShapeDefault ytBadgeShapeTypography" role="img" aria-label="AI: Content was made with AI"><div class="ytBadgeShapeIcon" aria-hidden="true"></div><div class="ytBadgeShapeText" aria-hidden="true">AI</div></badge-shape></yt-badge-view-model></span>';
const SYNTH_BADGE_TEXT_ONLY = '<badge-shape class="ytBadgeShapeHost"><div class="ytBadgeShapeText">AI</div></badge-shape>';

const page = (inner) => `<!doctype html><html><head></head><body>${inner}</body></html>`;
const homeGrid = (...parts) => `<ytd-rich-grid-renderer><div id="contents">${parts.join('')}</div></ytd-rich-grid-renderer>`;
const section = (inner) => `<ytd-rich-section-renderer><div id="content">${inner}</div></ytd-rich-section-renderer>`;

/** Fake www.youtube.com/watch HTML built from the VERBATIM innertube fragments in innertube-snippets.json. */
const NEUTRAL_DESC = 'Weekend trip to the coast with the family. Thanks for watching, see you next week.';
function watchHtml({ section = 'madeWithAI', badge = false, nameList = false, handle = 'CreativeAIAds', name = 'Creative AI Ads', channelId = 'UCabcdefghijklmnopqrstuv', description = NEUTRAL_DESC } = {}) {
  const player = `var ytInitialPlayerResponse = {"videoDetails":{"videoId":"x","title":"t","shortDescription":${JSON.stringify(description)},"channelId":"${channelId}"},"microformat":{"playerMicroformatRenderer":{"ownerProfileUrl":"http:\\/\\/www.youtube.com\\/@${handle}","ownerChannelName":${JSON.stringify(name)},"externalChannelId":"${channelId}"}}};`;
  const parts = [];
  if (nameList) parts.push(SNIPPETS.falsePositive_rendererNameList.fragment);
  if (badge) parts.push('"videoPrimaryInfoRenderer":{' + SNIPPETS.titleBadge.fragment + '}');
  if (section === 'madeWithAI') parts.push(SNIPPETS.madeWithAI.fragment);
  if (section === 'autoDubbed') parts.push(SNIPPETS.autoDubbed_NOT_AI.fragment);
  return `<!DOCTYPE html><html><head><script>${player}</script><script>var ytInitialData = {"contents":[${parts.join(',')}]};</script></head><body></body></html>`;
}

let ctx;
async function boot(url, html, opts = {}) {
  ctx = await loadScripts(FILES, { url, html: page(html) });
  const { NoSlop, window } = ctx;
  NoSlop.host.__fetchText = opts.fetchText || (() => Promise.resolve('')); // never hit the network
  if (opts.settings) await NoSlop.host.patchSettings(opts.settings);
  if (opts.beforeStart) await opts.beforeStart(ctx);
  if (opts.start !== false) {
    await NoSlop.engine.start({ adapter: NoSlop.adapters.pick(window.location), rules: NoSlop.rules, host: NoSlop.host });
    await settle();
  }
  return ctx;
}
afterEach(() => { if (ctx && ctx.NoSlop && ctx.NoSlop.engine.running) ctx.NoSlop.engine.stop(); });
const adapter = () => ctx.NoSlop.adapters.list().find((a) => a.site === 'youtube');
const items = (root) => adapter().findItems(root || ctx.document.body).map((el) => [el, adapter().extract(el)]);
const byId = (id) => ctx.document.querySelector(`[data-noslop-id="${id}"]`);
const action = (id) => byId(id) && byId(id).getAttribute('data-noslop-action');
const surfacesOn = (key, on) => ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { [key]: on }) });

// ---------------------------------------------------------------------------------------------- registration
describe('registration, matching, surfaces', () => {
  test('registers as youtube, matches www/m/bare hosts only, reads the surface from the path', async () => {
    await boot(DESKTOP, '', { start: false });
    const a = adapter();
    assert.ok(a && !a.placeholder);
    assert.equal(a.hideStrategy, 'display-none');
    for (const h of ['www.youtube.com', 'm.youtube.com', 'youtube.com']) assert.ok(a.matches({ hostname: h }), h);
    for (const h of ['music.youtube.com', 'studio.youtube.com', 'youtube.com.evil.test', 'x.com']) assert.ok(!a.matches({ hostname: h }), h);
    deq([['/', 'home'], ['/feed/subscriptions', 'home'], ['/results?search_query=x', 'search'], ['/watch', 'watch'], ['/shorts/abc', 'shorts'], ['/@CreativeAIAds/videos', 'profile'], ['/channel/UCx', 'profile'], ['/playlist', 'other']].map(([p]) => a.surface({ pathname: p.split('?')[0] })),
      ['home', 'home', 'search', 'watch', 'shorts', 'profile', 'profile', 'other']);
    deq(a.navigateEvents, ['yt-navigate-finish', 'yt-page-data-fetched']);
    assert.ok(a.surfaces().every((s) => s.settingKey === 'hideShorts' && s.selector));
    assert.equal(a.videoIdFrom('/watch?v=gXtjlubIVgQ&pp=ygUT'), 'gXtjlubIVgQ');
    assert.equal(a.videoIdFrom('/shorts/Qqc0pav5wEI'), 'Qqc0pav5wEI');
    assert.equal(a.videoIdFrom('/playlist?list=PL123'), '');
  });
});

// ---------------------------------------------------------------------------------------------- desktop extraction
describe('www.youtube.com extraction (real fixtures)', () => {
  test('home grid: outer ytd-rich-item-renderer is the item (never the inner lockup); id, title, channel, ad, auto-dub', async () => {
    await boot(DESKTOP, homeGrid(fx('youtube/home-rich-item-renderer.html'), fx('youtube/home-rich-item-ad-slot.html'), fx('youtube/home-rich-item-auto-dubbed.html')), { start: false });
    const list = items();
    assert.equal(list.length, 5);
    assert.ok(list.every(([el]) => el.tagName === 'YTD-RICH-ITEM-RENDERER'), 'only outer renderers');
    const [, first] = list[0];
    assert.equal(first.id, 'ybKm7W5pW2Y');
    assert.equal(first.kind, 'video');
    assert.equal(first.surface, 'home');
    assert.match(first.title, /^How I Create AI Videos in 8 Minutes/);
    deq(first.author, { handle: 'thisisnickys', name: 'Nicky Saunders' });
    deq(first.labels, []);
    deq(first.media, ['video']);
    deq(first.links, ['https://www.youtube.com/watch?v=ybKm7W5pW2Y']);
    deq(list[1][1].author, { handle: 'WPLGLocal10', name: 'WPLG Local 10' });
    deq(list[2][1].author, { handle: 'Kaye.creates', name: 'kaye.creatives' });
    const [, ad] = list[3];
    assert.equal(ad.kind, 'ad'); assert.equal(ad.id, 'cWEVjeSQTzA');
    deq(ad.labels, [{ type: 'promoted', text: 'Sponsored' }]);
    const [, dub] = list[4];
    assert.equal(dub.id, 'JIcbuGB7r70');
    deq(dub.labels, [], 'the "Auto-dubbed" badge is NOT an AI label');
    assert.equal(dub.extra.autoDubbed, true);
    assert.equal(dub.author.handle, 'tehnar_obxodit');
  });

  test('search: ytd-video-renderer id from href (no content-id), legacy /channel/ link -> author.id, snippet as text', async () => {
    await boot('https://www.youtube.com/results?search_query=ai+generated+shorts', fx('youtube/search-video-renderer.html') + fx('youtube/search-ai-labelled-long-form-card.html'), { start: false });
    const list = items();
    deq(list.map(([el]) => el.tagName), ['YTD-VIDEO-RENDERER', 'YTD-VIDEO-RENDERER', 'YTD-VIDEO-RENDERER', 'YTD-VIDEO-RENDERER']);
    deq(list.map(([, it]) => it.id), ['gXtjlubIVgQ', 'f8FHas1dmt8', 'ygeCgN-SfE8', '5VSjuLoTH-0']);
    const [, a] = list[0];
    assert.equal(a.surface, 'search');
    assert.match(a.title, /^Disable YouTube Shorts AND AI Videos/);
    deq(a.author, { handle: 'TrevorNace', name: 'Trevor Nace' });
    assert.match(a.text, /tired of YouTube Shorts/);
    const [, lf] = list[3];
    deq(lf.author, { name: 'OA beats', id: 'UCcsH4RqgPXGaIff07psJolQ' });
    deq(lf.labels, [], 'a title full of "AI" words is not a label (the card of a labelled video carries no badge)');
  });

  test('search ad slot: ytd-ad-slot-renderer is the item, kind ad + promoted, id from the lockup content-id', async () => {
    await boot('https://www.youtube.com/results?search_query=x', '<ytd-item-section-renderer><div id="contents"><ytd-search-pyv-renderer><div id="contents">' + fx('youtube/search-ad-slot.html') + '</div></ytd-search-pyv-renderer></div></ytd-item-section-renderer>', { start: false });
    const list = items();
    const ads = list.filter(([, it]) => it && it.kind === 'ad');
    assert.ok(ads.length >= 1);
    assert.ok(ads.every(([, it]) => it.id === 'THTWc69K0c4' && it.labels.some((l) => l.type === 'promoted')));
    assert.ok(list.every(([el]) => !el.parentElement.closest('ytd-ad-slot-renderer')), 'the lockup inside the ad slot is not a separate item');
  });

  test('watch #related: yt-lockup-view-model is the outer item; id from content-id-*; channel is plain text (name only)', async () => {
    await boot('https://www.youtube.com/watch?v=gXtjlubIVgQ', '<div id="related">' + fx('youtube/watch-related-lockups.html') + fx('youtube/watch-related-ad-slot.html') + '</div>', { start: false });
    const list = items().filter(([, it]) => it);
    deq(list.map(([el, it]) => [el.tagName, it.id, it.kind]), [['YT-LOCKUP-VIEW-MODEL', 'RhK-ZiI5i-Y', 'video'], ['YT-LOCKUP-VIEW-MODEL', 'ca7ufSI1Qxg', 'video'], ['YT-LOCKUP-VIEW-MODEL', 'ldG5lDokk5Y', 'video']]);
    deq(list[0][1].author, { name: 'The Phone Guardian' });
    deq(list[1][1].author, { name: 'More Perfect Union' });
    assert.equal(list[0][1].surface, 'watch');
  });

  test('shorts shelves: home shelf items are ytd-rich-item-renderer kind short; search shelf cards are ytm-shorts-lockup-view-model; shelves are not items', async () => {
    await boot(DESKTOP, homeGrid(section(fx('youtube/home-shorts-shelf.html'))) + fx('youtube/search-shorts-shelf.html'), { start: false });
    const list = items();
    const home = list.filter(([el]) => el.tagName === 'YTD-RICH-ITEM-RENDERER');
    assert.equal(home.length, 5);
    assert.ok(home.every(([, it]) => it.kind === 'short' && /^[A-Za-z0-9_-]{11}$/.test(it.id)));
    assert.equal(home[0][1].id, '3Th55LtZRgE');
    assert.match(home[0][1].title, /^Kling AI Finally Nailed/);
    const search = list.filter(([el]) => el.tagName === 'YTM-SHORTS-LOCKUP-VIEW-MODEL');
    assert.ok(search.length >= 8);
    assert.ok(search.every(([, it]) => it.kind === 'short'));
    assert.ok(search.some(([, it]) => it.hashtags.includes('#shorts')), 'hashtags from the title');
    assert.ok(list.every(([el]) => !/SHELF/.test(el.tagName)), 'no shelf element is an item');
  });

  test('channel page: cards have no channel link, the handle comes from the URL and the view count is not a name', async () => {
    await boot('https://www.youtube.com/@CreativeAIAds/videos', fx('youtube/channel-rich-item-renderer.html'), { start: false });
    const [[, it]] = items();
    assert.equal(it.id, 'dNXJV2vtpfc');
    assert.equal(it.surface, 'profile');
    deq(it.author, { handle: 'CreativeAIAds' });
  });

  test('a skeleton (lockup without content) and non-video cards yield null', async () => {
    await boot(DESKTOP, homeGrid('<ytd-rich-item-renderer><div id="content"><yt-lockup-view-model></yt-lockup-view-model></div></ytd-rich-item-renderer>'), { start: false });
    const list = items();
    assert.equal(list.length, 1);
    assert.equal(list[0][1], null);
  });

  test('SYNTHETIC card badge: .ytBadgeShapeText "AI" / aria-label "AI: …" -> platform_ai youtube_badge (once); title text never counts', async () => {
    await boot(DESKTOP, homeGrid(fx('youtube/home-rich-item-renderer.html')), { start: false });
    const cards = ctx.document.querySelectorAll('ytd-rich-item-renderer');
    cards[0].querySelector('yt-content-metadata-view-model').insertAdjacentHTML('beforeend', SYNTH_BADGE);
    cards[1].querySelector('yt-content-metadata-view-model').insertAdjacentHTML('beforeend', SYNTH_BADGE_TEXT_ONLY);
    const list = items();
    deq(list[0][1].labels, [{ type: 'platform_ai', id: 'youtube_badge', text: 'AI' }]);
    deq(list[1][1].labels, [{ type: 'platform_ai', id: 'youtube_badge', text: 'AI' }]);
    deq(list[2][1].labels, [], 'How I Made a $1M … With AI + Blender: title only');
  });
});

// ---------------------------------------------------------------------------------------------- mobile extraction
describe('m.youtube.com extraction (real fixtures)', () => {
  test('home: ytm-rich-item-renderer wraps yt-lockup-view-model; channel name from the metadata row', async () => {
    await boot(MOBILE, fx('myoutube/home-rich-item-renderer.html') + fx('myoutube/home-shorts-shelf-section.html'), { start: false });
    const list = items();
    const rich = list.filter(([el]) => el.tagName === 'YTM-RICH-ITEM-RENDERER');
    deq(rich.map(([, it]) => [it.id, it.kind, it.author.name]), [['EWBsU0fSgPs', 'video', 'Roboverse'], ['Er70qu-N2Aw', 'video', 'Dat Girl From Ohio'], ['BimAST5xZV0', 'video', 'Trevor Nace']]);
    assert.equal(rich[0][1].extra.mobile, true);
    const shorts = list.filter(([el]) => el.tagName === 'YTM-SHORTS-LOCKUP-VIEW-MODEL');
    assert.equal(shorts.length, 4);
    assert.ok(shorts.every(([, it]) => it.kind === 'short'));
    assert.equal(shorts[0][1].id, 'GbA6YDZOj9U');
  });

  test('search: ytm-video-with-context-renderer (incl. a Short rendered as a result), related items, byline author', async () => {
    await boot('https://m.youtube.com/results?search_query=ai', fx('myoutube/search-video-with-context-renderer.html') + fx('myoutube/search-shorts-shelf.html'), { start: false });
    const list = items();
    const vw = list.filter(([el]) => el.tagName === 'YTM-VIDEO-WITH-CONTEXT-RENDERER');
    deq(vw.map(([, it]) => [it.id, it.kind]), [['XX3JzfYo1Rk', 'video'], ['qaV3Dmkj9cQ', 'short'], ['RhK-ZiI5i-Y', 'video']]);
    deq(vw[0][1].author, { handle: 'Yourivanhofwegen', name: 'Youri van Hofwegen' });
    deq(vw[1][1].hashtags, ['#shorts']);
    assert.ok(list.filter(([el]) => el.tagName === 'YTM-SHORTS-LOCKUP-VIEW-MODEL').length >= 8);
    ctx = await boot('https://m.youtube.com/watch?v=Qqc0pav5wEI', '<ytm-item-section-renderer section-identifier="related-items"><lazy-list>' + fx('myoutube/watch-related-video-with-context.html') + '</lazy-list></ytm-item-section-renderer>', { start: false });
    const rel = items();
    deq(rel.map(([, it]) => it.id), ['aHzhBJwSJSU', 'iJiBJAJRRkk', 'kmFlzDzVXkc']);
    assert.equal(rel[0][1].author.handle, 'Wokobuccicoach');
  });
});

// ---------------------------------------------------------------------------------------------- watch page banner
describe('watch page (never hidden; strict-mode banner)', () => {
  const WATCH_AI = 'https://www.youtube.com/watch?v=Qqc0pav5wEI';
  test('desktop strict: labelled video -> banner host above the title, hidden+stub retitled, metadata untouched', async () => {
    await boot(WATCH_AI, '<ytd-watch-flexy>' + fx('youtube/watch-ai-labelled-metadata.html') + '</ytd-watch-flexy>', { settings: { sites: { youtube: { mode: 'strict' } } } });
    const meta = ctx.document.querySelector('ytd-watch-metadata');
    const host = meta.firstElementChild;
    assert.equal(host.getAttribute('data-noslop-watch'), '1', 'host is the first child of ytd-watch-metadata');
    assert.equal(host.getAttribute('data-noslop-id'), 'Qqc0pav5wEI');
    assert.equal(host.getAttribute('data-noslop-action'), 'hide');
    assert.ok(host.classList.contains('noslop-hidden'));
    const stub = host.querySelector(':scope > .noslop-stub');
    assert.ok(stub);
    await settle();
    assert.equal(stub.querySelector('.noslop-stub__label').textContent, 'AI-labelled video');
    assert.match(stub.textContent, /platform AI label/);
    assert.match(stub.querySelector('[data-noslop-act="never"]').textContent, /Never show @CreativeAIAds/);
    assert.ok(!meta.classList.contains('noslop-hidden') && !meta.hasAttribute('data-noslop-id'), 'the metadata block itself is not an item');
    assert.equal(ctx.document.querySelectorAll('[data-noslop-id]').length, 1);
    const st = ctx.NoSlop.engine.stateOf(host);
    assert.equal(st.item.kind, 'video'); assert.equal(st.item.surface, 'watch');
    assert.match(st.item.title, /^Kling AI 2\.6 vs Veo 3\.1/);
    assert.ok(st.item.labels.some((l) => l.id === 'youtube_badge') && st.item.labels.some((l) => l.id === 'youtube_watch'), 'title badge + "Made with AI" section');
    assert.ok(st.item.hashtags.includes('#veo3'), 'hashtags from the description');
    assert.ok(st.verdict.reasons.includes('label:youtube_badge'));
    assert.equal(st.verdict.tier, 0);
  });
  test('desktop balanced: no banner host at all; switching to strict adds it, back to balanced removes it', async () => {
    await boot(WATCH_AI, fx('youtube/watch-ai-labelled-metadata.html'));
    assert.equal(ctx.document.querySelector('[data-noslop-watch]'), null);
    assert.equal(ctx.document.querySelectorAll('[data-noslop-id]').length, 0);
    await ctx.NoSlop.host.patchSettings({ sites: { youtube: { mode: 'strict' } } });
    await settle();
    assert.equal(ctx.document.querySelector('[data-noslop-watch]').getAttribute('data-noslop-action'), 'hide');
    await ctx.NoSlop.host.patchSettings({ sites: { youtube: { mode: 'balanced' } } });
    await settle();
    assert.equal(ctx.document.querySelector('[data-noslop-watch]'), null);
    assert.equal(ctx.document.querySelector('.noslop-stub'), null);
  });
  test('desktop strict, auto-dubbed video: section present but "Auto-dubbed" -> no label, no hide', async () => {
    await boot('https://www.youtube.com/watch?v=gXtjlubIVgQ', fx('youtube/watch-metadata.html'), { settings: { sites: { youtube: { mode: 'strict' } } } });
    const host = ctx.document.querySelector('[data-noslop-watch]');
    assert.ok(host);
    const st = ctx.NoSlop.engine.stateOf(host);
    deq(st.item.labels, [], 'the "Auto-dubbed" section is not a label');
    assert.equal(st.item.extra.autoDubbed, true);
    assert.equal(st.item.text, '', 'the description is never scored as prose on the watch page');
    deq(st.item.author, { handle: 'TrevorNace', name: 'Trevor Nace', id: 'UCU5pjAzVVE68WbU9KbAB6QA' });
    assert.notEqual(host.getAttribute('data-noslop-action'), 'hide');
    assert.ok(st.verdict.reasons.every((r) => !r.startsWith('label:')));
    assert.equal(ctx.document.querySelector('.noslop-stub'), null);
    // (in strict mode the scorer's mention-level rule may still DIM on the title "… AI Videos …": that is core policy)
  });
  test('desktop strict: stale metadata (video-id attribute != URL) and a pending SPA navigation are skipped', async () => {
    await boot('https://www.youtube.com/watch?v=AAAAAAAAAAA', fx('youtube/watch-ai-labelled-metadata.html'), { settings: { sites: { youtube: { mode: 'strict' } } } });
    const host = ctx.document.querySelector('[data-noslop-watch]');
    assert.ok(host);
    assert.equal(host.getAttribute('data-noslop-id'), null, 'metadata still shows Qqc0pav5wEI: not attributed to AAAAAAAAAAA');
    assert.equal(ctx.NoSlop.engine.cache.has('youtube:AAAAAAAAAAA'), false);
    // navigate to the id the DOM shows, but mark the navigation as pending: skipped until yt-navigate-finish
    ctx.window.history.pushState({}, '', '/watch?v=Qqc0pav5wEI');
    assert.equal(adapter()._nav.pending, true);
    ctx.NoSlop.engine.processNow();
    assert.equal(ctx.document.querySelector('[data-noslop-watch]').getAttribute('data-noslop-id'), null);
    ctx.window.dispatchEvent(new ctx.window.Event('yt-navigate-finish'));
    await settle();
    assert.equal(ctx.document.querySelector('[data-noslop-watch]').getAttribute('data-noslop-action'), 'hide');
  });
  test('mobile strict: badge-shape[aria-label="AI"] in ytm-slim-video-metadata-section-renderer -> banner', async () => {
    await boot('https://m.youtube.com/watch?v=Qqc0pav5wEI', fx('myoutube/watch-ai-labelled-metadata.html'), { settings: { sites: { youtube: { mode: 'strict' } } } });
    const meta = ctx.document.querySelector('ytm-slim-video-metadata-section-renderer');
    const host = meta.firstElementChild;
    assert.equal(host.getAttribute('data-noslop-watch'), '1');
    assert.equal(host.getAttribute('data-noslop-action'), 'hide');
    const st = ctx.NoSlop.engine.stateOf(host);
    deq(st.item.labels, [{ type: 'platform_ai', id: 'youtube_badge', text: 'AI' }]);
    assert.equal(st.item.author.handle, 'CreativeAIAds');
    assert.ok(!meta.classList.contains('noslop-hidden'));
  });
  test('mobile strict: the lazily loaded description panel "Made with AI" section counts too', async () => {
    await boot('https://m.youtube.com/watch?v=Qqc0pav5wEI', '<ytm-slim-video-metadata-section-renderer><ytm-slim-video-information-renderer><h2>Some title</h2></ytm-slim-video-information-renderer></ytm-slim-video-metadata-section-renderer><ytm-engagement-panel>' + fx('myoutube/watch-how-this-was-made.html') + '</ytm-engagement-panel>', { settings: { sites: { youtube: { mode: 'strict' } } } });
    const st = ctx.NoSlop.engine.stateOf(ctx.document.querySelector('[data-noslop-watch]'));
    deq(st.item.labels, [{ type: 'platform_ai', id: 'youtube_watch', text: 'Made with AI' }]);
  });
});

// ---------------------------------------------------------------------------------------------- engine end-to-end
describe('engine end-to-end on the desktop home fixture', () => {
  async function bootHome(opts = {}) {
    await boot(DESKTOP, homeGrid(fx('youtube/home-rich-item-renderer.html'), fx('youtube/home-rich-item-ad-slot.html'), section(fx('youtube/home-shorts-shelf.html'))), Object.assign({
      beforeStart: ({ document }) => {
        const cards = document.querySelectorAll('ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer');
        cards[0].querySelector('yt-content-metadata-view-model').insertAdjacentHTML('beforeend', SYNTH_BADGE); // SYNTHETIC labelled card
        cards[2].querySelector('a.ytLockupMetadataViewModelTitle, .yt-lockup-metadata-view-model__heading').textContent = SLOP; // SYNTHETIC style-slop title
      }
    }, opts));
  }
  test('labelled card hidden with a stub on the OUTER renderer, plain card untouched, style-slop card dimmed not hidden', async () => {
    await bootHome();
    const hidden = byId('ybKm7W5pW2Y');
    assert.equal(hidden.tagName, 'YTD-RICH-ITEM-RENDERER');
    assert.equal(action('ybKm7W5pW2Y'), 'hide');
    assert.ok(hidden.classList.contains('noslop-hidden') && hidden.classList.contains('noslop-hidden--display-none'));
    assert.ok(!hidden.querySelector('yt-lockup-view-model').classList.contains('noslop-hidden'), 'inner lockup carries no classes');
    const stub = hidden.querySelector(':scope > .noslop-stub');
    assert.ok(stub);
    assert.match(stub.textContent, /Hidden: AI content — platform AI label \(youtube badge\)/);
    assert.match(stub.querySelector('[data-noslop-act="never"]').textContent, /Never show @thisisnickys/);
    assert.equal(action('XkIyY7WXA04'), 'none');
    assert.ok(!byId('XkIyY7WXA04').classList.contains('noslop-hidden') && !byId('XkIyY7WXA04').classList.contains('noslop-dim'));
    assert.equal(action('zZ1bgIaoPas'), 'dim');
    assert.ok(byId('zZ1bgIaoPas').classList.contains('noslop-dim'));
    assert.ok(byId('zZ1bgIaoPas').querySelector(':scope > .noslop-badge'));
    const v = ctx.NoSlop.engine.stateOf(byId('zZ1bgIaoPas')).verdict;
    assert.equal(v.nonStyleScore, 0, 'style only');
    assert.ok(v.reasons.every((r) => r.startsWith('style:')));
    assert.equal(action('cWEVjeSQTzA'), 'none', 'ad untouched while hideAds is off');
    ctx.NoSlop.engine.flushStats();
    assert.ok(ctx.NoSlop.host.__reports.some((r) => r.action === 'hide' && r.reason === 'label:youtube_badge' && r.count === 1));
  });
  test('hideAds hides the ad slot card (promoted) through the pipeline', async () => {
    await bootHome();
    await surfacesOn('hideAds', true);
    await settle();
    assert.equal(action('cWEVjeSQTzA'), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(byId('cWEVjeSQTzA')).verdict.reasons.includes('ad:promoted'));
  });
  test('hideShorts: the shelf and every /shorts/ card get .noslop-surface; off restores them', async () => {
    await bootHome();
    const shelf = ctx.document.querySelector('ytd-rich-shelf-renderer[is-shorts]');
    assert.ok(!shelf.classList.contains('noslop-surface'));
    await surfacesOn('hideShorts', true);
    await settle();
    assert.ok(shelf.classList.contains('noslop-surface'));
    assert.equal(shelf.getAttribute('data-noslop-surface'), 'hideShorts');
    const shortCards = [...ctx.document.querySelectorAll('ytd-rich-item-renderer')].filter((el) => el.querySelector('a[href^="/shorts/"]'));
    assert.ok(shortCards.length >= 5);
    assert.ok(shortCards.every((el) => el.classList.contains('noslop-surface')));
    assert.ok(!byId('XkIyY7WXA04').classList.contains('noslop-surface'), 'a long-form card is not a Shorts surface');
    await surfacesOn('hideShorts', false);
    await settle();
    assert.ok(!shelf.classList.contains('noslop-surface'));
    assert.ok(shortCards.every((el) => !el.classList.contains('noslop-surface')));
  });
  test('SPA re-render: remove + re-append keeps the hide with exactly one stub; a fresh element for the same id is hidden from the cache', async () => {
    await bootHome();
    const el = byId('ybKm7W5pW2Y');
    const parent = el.parentNode;
    el.remove();
    await settle();
    parent.appendChild(el);
    await settle(5);
    assert.equal(el.getAttribute('data-noslop-action'), 'hide');
    assert.equal(el.querySelectorAll('.noslop-stub').length, 1);
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.noslop-stub').forEach((s) => s.remove());
    clone.classList.remove('noslop-hidden', 'noslop-hidden--display-none'); clone.removeAttribute('data-noslop-id'); clone.removeAttribute('data-noslop-action');
    const orig = ctx.NoSlop.scorer.score; let calls = 0; ctx.NoSlop.scorer.score = (...a) => { calls++; return orig(...a); };
    parent.appendChild(clone);
    await settle(5);
    ctx.NoSlop.scorer.score = orig;
    assert.equal(calls, 0, 'verdict served from the id cache');
    assert.equal(clone.getAttribute('data-noslop-action'), 'hide');
  });
  test('cell reuse: a lockup re-rendered for another video id is unapplied and re-verdicted (both directions)', async () => {
    await bootHome();
    const el = byId('ybKm7W5pW2Y');
    const hostEl = el.querySelector('[class*="content-id-"]');
    hostEl.className = hostEl.className.replace('content-id-ybKm7W5pW2Y', 'content-id-NEWID000001');
    el.querySelectorAll('a[href*="/watch?v="]').forEach((a) => a.setAttribute('href', '/watch?v=NEWID000001'));
    el.querySelector('badge-shape[aria-label^="AI:"]').remove();
    ctx.NoSlop.engine.processNow();
    assert.equal(el.getAttribute('data-noslop-id'), 'NEWID000001');
    assert.equal(el.getAttribute('data-noslop-action'), 'none');
    assert.ok(!el.classList.contains('noslop-hidden'));
    assert.equal(el.querySelector('.noslop-stub'), null);
    // the other way round, via the MutationObserver this time
    const plain = byId('XkIyY7WXA04');
    const h = plain.querySelector('[class*="content-id-"]');
    h.className = h.className.replace('content-id-XkIyY7WXA04', 'content-id-NEWID000002');
    plain.querySelectorAll('a[href*="/watch?v="]').forEach((a) => a.setAttribute('href', '/watch?v=NEWID000002'));
    plain.querySelector('yt-content-metadata-view-model').insertAdjacentHTML('beforeend', SYNTH_BADGE); // SYNTHETIC
    await settle(5);
    assert.equal(plain.getAttribute('data-noslop-id'), 'NEWID000002');
    assert.equal(plain.getAttribute('data-noslop-action'), 'hide');
  });
  test('Never show @channel from the stub blocks the channel; a later card of that channel is hidden by account', async () => {
    await bootHome();
    byId('ybKm7W5pW2Y').querySelector('[data-noslop-act="never"]').click();
    await settle(5);
    assert.ok(ctx.NoSlop.engine.settings.blockedAccounts.youtube.includes('thisisnickys'));
    const other = byId('XkIyY7WXA04');
    other.querySelectorAll('a[href^="/@"]').forEach((a) => a.setAttribute('href', '/@thisisnickys'));
    const h = other.querySelector('[class*="content-id-"]'); h.className = h.className.replace('content-id-XkIyY7WXA04', 'content-id-NEWID000003');
    other.querySelectorAll('a[href*="/watch?v="]').forEach((a) => a.setAttribute('href', '/watch?v=NEWID000003'));
    ctx.NoSlop.engine.processNow();
    assert.equal(other.getAttribute('data-noslop-action'), 'hide');
    assert.ok(ctx.NoSlop.engine.stateOf(other).verdict.reasons.includes('account:block'));
  });
});

describe('engine end-to-end on m.youtube.com', () => {
  test('mobile home: SYNTHETIC badge card hidden on the outer ytm-rich-item-renderer; hideShorts hides the shelf section and Shorts results', async () => {
    await boot(MOBILE, fx('myoutube/home-rich-item-renderer.html') + fx('myoutube/home-shorts-shelf-section.html') + '<ytm-search><lazy-list>' + fx('myoutube/search-video-with-context-renderer.html') + '</lazy-list></ytm-search>', {
      beforeStart: ({ document }) => { document.querySelector('ytm-rich-item-renderer yt-content-metadata-view-model').insertAdjacentHTML('beforeend', SYNTH_BADGE_TEXT_ONLY); }
    });
    const el = byId('EWBsU0fSgPs');
    assert.equal(el.tagName, 'YTM-RICH-ITEM-RENDERER');
    assert.equal(action('EWBsU0fSgPs'), 'hide');
    assert.ok(el.querySelector(':scope > .noslop-stub'));
    assert.equal(action('Er70qu-N2Aw'), 'none');
    const shelfSection = ctx.document.querySelector('ytm-rich-section-renderer');
    const shortResult = byId('qaV3Dmkj9cQ');
    await surfacesOn('hideShorts', true);
    await settle();
    assert.ok(shelfSection.classList.contains('noslop-surface'));
    assert.ok(shortResult.classList.contains('noslop-surface'), 'ytm-video-with-context-renderer with a /shorts/ link');
    assert.ok(!byId('XX3JzfYo1Rk').classList.contains('noslop-surface'));
  });
});

// ---------------------------------------------------------------------------------------------- enrich
describe('enrich: watch-page prefetch', () => {
  test('parseWatchHtml: "Made with AI" section / title badge label, auto-dub and renderer-name-list false positives excluded, owner + description', async () => {
    await boot(DESKTOP, '', { start: false });
    const p = adapter().parseWatchHtml;
    const ai = p(watchHtml({ section: 'madeWithAI', badge: true, description: 'Kling 2.6 vs Veo 3.1 — same prompt. #veo3 #klingai' }), { author: {} });
    deq(ai.labels, [{ type: 'platform_ai', id: 'youtube_watch', text: 'Made with AI' }, { type: 'platform_ai', id: 'youtube_badge', text: 'AI: Content was made with AI' }]);
    deq(ai.author, { handle: 'CreativeAIAds', name: 'Creative AI Ads', id: 'UCabcdefghijklmnopqrstuv' });
    assert.match(ai.text, /^Kling 2\.6 vs Veo 3\.1/);
    deq(ai.hashtags, ['#veo3', '#klingai']);
    assert.equal(ai.extra.autoDubbed, false);
    const banner = p(watchHtml({ section: 'madeWithAI', description: 'Kling 2.6 vs Veo 3.1 — same prompt. #veo3 #klingai' }), { author: {}, extra: { watchPage: true } });
    assert.equal(banner.text, undefined, 'watch-page banner host gets hashtags but no description prose');
    deq(banner.hashtags, ['#veo3', '#klingai']);
    const dub = p(watchHtml({ section: 'autoDubbed', nameList: true }), { author: {} });
    deq(dub.labels, [], 'Auto-dubbed section + bare key in the renderer-name list are not labels');
    assert.equal(dub.extra.autoDubbed, true);
    const none = p(watchHtml({ section: 'none', nameList: true }), { author: {} });
    deq(none.labels, []);
    const descOnly = p(watchHtml({ section: 'madeWithAI', badge: false }), { author: {} });
    deq(descOnly.labels.map((l) => l.id), ['youtube_watch'], 'description-tier label without the title badge');
    assert.equal(p('', {}), null);
    assert.equal(p(null, {}), null);
    // fields the card already has are not overwritten
    const keep = p(watchHtml({}), { author: { handle: 'already', name: 'Already' } });
    deq(keep.author, { id: 'UCabcdefghijklmnopqrstuv' });
    // the help-link discriminator works even when the body header is localized (synthetic, de-DE wording)
    const localized = watchHtml({ section: 'madeWithAI' }).replace('"Made with AI"', '"Mit KI erstellt"');
    deq(p(localized, {}).labels.map((l) => l.id), ['youtube_watch']);
    const localizedDub = watchHtml({ section: 'autoDubbed' }).replace('"Auto-dubbed"', '"Automatisch synchronisiert"');
    deq(p(localizedDub, {}).labels, []);
  });

  test('cards without a badge are prefetched (www URL, cached by id, concurrency from settings); a "Made with AI" page hides the card', async () => {
    const urls = [];
    const fetchText = (url) => {
      urls.push(url);
      const id = /v=([^&]+)/.exec(url)[1];
      return Promise.resolve(id === 'ybKm7W5pW2Y' ? watchHtml({ section: 'madeWithAI', badge: true }) : id === 'XkIyY7WXA04' ? watchHtml({ section: 'autoDubbed' }) : watchHtml({ section: 'none' }));
    };
    await boot(DESKTOP, homeGrid(fx('youtube/home-rich-item-renderer.html'), fx('youtube/home-rich-item-ad-slot.html')), { fetchText });
    assert.ok(ctx.NoSlop.engine._E.inflight.size <= 2);
    await ctx.NoSlop.engine.waitIdle();
    await settle();
    // &app=desktop: YouTube's own "Desktop site" switch, so an iPhone UA (fetch cannot set User-Agent) is not 302'd to m.youtube.com
    deq(urls.sort(), ['https://www.youtube.com/watch?v=XkIyY7WXA04&app=desktop', 'https://www.youtube.com/watch?v=ybKm7W5pW2Y&app=desktop', 'https://www.youtube.com/watch?v=zZ1bgIaoPas&app=desktop'], 'one fetch per video; the ad is not fetched');
    assert.equal(action('ybKm7W5pW2Y'), 'hide');
    const st = ctx.NoSlop.engine.stateOf(byId('ybKm7W5pW2Y'));
    assert.ok(st.verdict.reasons.includes('label:youtube_watch'));
    assert.equal(st.verdict.tier, 0);
    assert.match(byId('ybKm7W5pW2Y').querySelector('.noslop-stub').textContent, /platform AI label \(youtube watch\)/);
    assert.equal(action('XkIyY7WXA04'), 'none', 'auto-dubbed page is not an AI label');
    assert.equal(ctx.NoSlop.engine.cache.get('youtube:XkIyY7WXA04').enrich.extra.autoDubbed, true);
    // re-processing never refetches (engine cache) — and a second card for the same id is served from it
    ctx.NoSlop.engine.processNow();
    await ctx.NoSlop.engine.waitIdle();
    assert.equal(urls.length, 3);
    await ctx.NoSlop.engine.persistNow();
    const stored = (await ctx.NoSlop.host.storageGet('verdicts:youtube'))['verdicts:youtube'];
    assert.ok(stored.some(([k, v]) => k === 'youtube:ybKm7W5pW2Y' && v.enriched && v.enrich.labels.length));
    // the persisted enrich never carries the 2000-char description: a bounded snippet only (storage.local quota)
    for (const [, v] of stored) if (v.enrich && v.enrich.text) assert.ok(v.enrich.text.length <= 300, 'persisted enrich text is capped');
  });

  test('parseWatchHtml: an AI badge only inside the RELATED (secondaryResults) renderers is not attributed to the fetched video', async () => {
    await boot(DESKTOP, '', { start: false });
    const p = adapter().parseWatchHtml;
    const secondary = ',"secondaryResults":{"results":[{"compactVideoRenderer":{"videoId":"other",' + SNIPPETS.titleBadge.fragment + '}}]}';
    const related = watchHtml({ section: 'none' }).replace(']};</script>', ']' + secondary + '};</script>');
    assert.ok(related.includes('"secondaryResults"') && related.includes('"metadataBadgeRenderer":{'), 'fixture carries a badge after secondaryResults');
    deq(p(related, { author: {} }).labels, [], 'badge in a related compactVideoRenderer must yield no label');
    // the same badge BEFORE secondaryResults (videoPrimaryInfoRenderer) still counts
    const primary = watchHtml({ section: 'none', badge: true }).replace(']};</script>', ']' + secondary + '};</script>');
    deq(p(primary, { author: {} }).labels.map((l) => l.id), ['youtube_badge']);
  });

  test('youtubePrefetch=false disables the fetch; a FAILING fetch is not a result: not enriched, not persisted, retried after the backoff', async () => {
    let calls = 0;
    await boot(DESKTOP, homeGrid(fx('youtube/home-rich-item-renderer.html')), { settings: { youtubePrefetch: false }, fetchText: () => { calls++; return Promise.resolve(watchHtml({})); } });
    await ctx.NoSlop.engine.waitIdle();
    assert.equal(calls, 0);
    assert.equal(action('ybKm7W5pW2Y'), 'none');
    ctx.NoSlop.engine.stop();
    let n = 0;
    await boot(DESKTOP, homeGrid(fx('youtube/home-rich-item-renderer.html')), {
      beforeStart: ({ NoSlop }) => { NoSlop.engine._E.enrichRetryMs = 60; },
      fetchText: (url) => {
        if (/v=([^&]+)/.exec(url)[1] !== 'ybKm7W5pW2Y') return Promise.resolve(watchHtml({ section: 'none' }));
        n++;
        return n === 1 ? Promise.reject(new Error('http 429')) : Promise.resolve(watchHtml({ section: 'madeWithAI', badge: true }));
      }
    });
    await ctx.NoSlop.engine.waitIdle();
    await settle();
    assert.equal(action('ybKm7W5pW2Y'), 'none', 'failed fetch leaves the card alone');
    const e = ctx.NoSlop.engine.cache.get('youtube:ybKm7W5pW2Y');
    assert.equal(e.enriched, false); assert.equal(e.enrichAttempts, 1); assert.ok(e.enrichFailedAt > 0);
    await ctx.NoSlop.engine.persistNow();
    const stored = (await ctx.NoSlop.host.storageGet('verdicts:youtube'))['verdicts:youtube'] || [];
    const row = stored.find(([k]) => k === 'youtube:ybKm7W5pW2Y');
    assert.ok(!row || row[1].enriched === false, 'a failure is never persisted as a 7-day negative (the DOM verdict row may persist, enriched:false)');
    await new Promise((r) => setTimeout(r, 100));
    await ctx.NoSlop.engine.waitIdle();
    await settle();
    assert.equal(n, 2, 'retried after the backoff');
    assert.equal(action('ybKm7W5pW2Y'), 'hide', 'the label found on the retry hides the card');
    assert.equal(ctx.NoSlop.engine.cache.get('youtube:ybKm7W5pW2Y').enriched, true);
  });

  test('related lockups get their channel handle from the watch HTML, so blocked channels are hidden there too', async () => {
    await boot('https://www.youtube.com/watch?v=gXtjlubIVgQ', '<div id="related">' + fx('youtube/watch-related-lockups.html') + '</div>', {
      settings: { blockedAccounts: { youtube: ['@ThePhoneGuardian'] } },
      fetchText: (url) => Promise.resolve(watchHtml({ section: 'none', handle: /RhK-ZiI5i-Y/.test(url) ? 'ThePhoneGuardian' : 'someoneelse', name: 'n' }))
    });
    await ctx.NoSlop.engine.waitIdle();
    await settle();
    assert.equal(action('RhK-ZiI5i-Y'), 'hide');
    const st = ctx.NoSlop.engine.stateOf(byId('RhK-ZiI5i-Y'));
    assert.equal(st.item.author.handle, 'ThePhoneGuardian');
    assert.equal(st.item.author.name, 'The Phone Guardian', 'the card name is kept');
    assert.ok(st.verdict.reasons.includes('account:block'));
    assert.equal(action('ca7ufSI1Qxg'), 'none');
  });

  test('description self-disclosure from the watch HTML reaches the scorer (tier 1)', async () => {
    await boot(DESKTOP, homeGrid(fx('youtube/home-rich-item-renderer.html')), {
      fetchText: (url) => Promise.resolve(watchHtml({ section: 'none', description: /ybKm7W5pW2Y/.test(url) ? 'Every shot in this video was generated with Sora. #aiart #sora' : 'Vlog from our trip. Thanks for watching!' }))
    });
    await ctx.NoSlop.engine.waitIdle();
    await settle();
    assert.equal(action('ybKm7W5pW2Y'), 'hide');
    const st = ctx.NoSlop.engine.stateOf(byId('ybKm7W5pW2Y'));
    assert.equal(st.verdict.tier, 1);
    assert.ok(st.verdict.reasons.some((r) => r === 'hashtag:#aiart' || r.startsWith('disclosure:') || r === 'tool:sora'));
    assert.equal(action('XkIyY7WXA04'), 'none');
  });
});
