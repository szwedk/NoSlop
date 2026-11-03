// Validates the DOM fixtures in tests/fixtures/** (owner: fixtures agent).
// Run: cd /Users/kamilszwed/Projects/NoSlop && node --test tests/fixtures/
// Every assertion here was checked against the live page on 2026-11-02; see <site>/notes.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REAL = ['youtube', 'myoutube', 'tiktok', 'reddit'];
const SYNTHETIC = ['x', 'instagram', 'facebook', 'linkedin'];

function load(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { virtualConsole: new VirtualConsole() });
  return { html, doc: dom.window.document, $: (s) => dom.window.document.querySelector(s), $$: (s) => [...dom.window.document.querySelectorAll(s)] };
}
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

test('every fixture is small, headed and free of stripped content', () => {
  for (const site of [...REAL, ...SYNTHETIC]) {
    const dir = path.join(ROOT, site);
    assert.ok(fs.existsSync(path.join(dir, 'notes.md')), `${site}/notes.md exists`);
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(html.length < 200 * 1024, `${site}/${f} < 200 KB`);
      assert.ok(html.startsWith(`<!-- NoSlop fixture: ${site}/`), `${site}/${f} has the header comment`);
      assert.ok(!/<(script|style|iframe)\b/i.test(html), `${site}/${f} has no script/style/iframe`);
      if (REAL.includes(site) && !/^synthetic-/.test(f)) assert.ok(!/<svg\b/i.test(html), `${site}/${f} has no svg (stripped at capture)`);
      assert.ok(!/\bsrc="data:/i.test(html), `${site}/${f} has no data: URIs`);
      // A REAL directory may hold adapter-owned synthetic-*.html files as long as they carry the SYNTHETIC marker.
      if (SYNTHETIC.includes(site) || /^synthetic-/.test(f)) assert.ok(/\*\*\* SYNTHETIC \*\*\*/.test(html), `${site}/${f} is marked SYNTHETIC`);
      else assert.ok(/REAL (DOM capture|server-rendered HTML)/.test(html), `${site}/${f} is marked REAL`);
    }
  }
});

// ---------------------------------------------------------------- youtube.com (desktop)
test('youtube: search results', () => {
  let { $$ } = load('youtube/search-video-renderer.html');
  const vr = $$('ytd-video-renderer');
  assert.equal(vr.length, 3);
  for (const el of vr) {
    assert.ok(el.querySelector('a#video-title[href^="/watch?v="]'), 'title link');
    assert.ok(el.querySelector('ytd-channel-name a[href^="/@"]'), 'channel link');
    assert.ok(el.querySelector('badge-shape .ytBadgeShapeText'), 'badge-shape text');
  }
  assert.equal($$('.badge-shape-wiz__text').length, 0, 'legacy badge class is gone');

  ({ $$ } = load('youtube/search-ad-slot.html'));
  assert.equal($$('ytd-ad-slot-renderer').length, 1);
  assert.equal($$('ytd-ad-slot-renderer ytd-in-feed-ad-layout-renderer yt-lockup-view-model').length, 1);
  assert.ok($$('.ytBadgeShapeText').some((b) => text(b) === 'Sponsored'), '"Sponsored" badge');
  assert.ok($$('.ytLockupViewModelHost').some((h) => [...h.classList].some((c) => c.startsWith('content-id-'))), 'content-id-* class');

  ({ $$ } = load('youtube/search-shorts-shelf.html'));
  assert.equal($$('grid-shelf-view-model').length, 2);
  assert.ok($$('ytm-shorts-lockup-view-model-v2 > ytm-shorts-lockup-view-model').length >= 8, 'shorts lockups');
  assert.ok($$('a[href^="/shorts/"]').length >= 8);
});

test('youtube: AI-labelled videos show NO card-level badge (2026-11-02)', () => {
  let { $$ } = load('youtube/search-ai-labelled-card.html');
  assert.equal($$('ytm-shorts-lockup-view-model').length, 1);
  assert.ok($$('a[href*="Qqc0pav5wEI"]').length >= 1);
  assert.equal($$('badge-shape[aria-label^="AI"]').length, 0);
  ({ $$ } = load('youtube/search-ai-labelled-long-form-card.html'));
  assert.equal($$('ytd-video-renderer').length, 1);
  assert.ok($$('a[href*="5VSjuLoTH-0"]').length >= 1);
  assert.ok(!$$('.ytBadgeShapeText').some((b) => text(b) === 'AI'));
});

test('youtube: watch page (Auto-dubbed, NOT AI)', () => {
  let { $$ } = load('youtube/watch-related-lockups.html');
  const lk = $$('yt-lockup-view-model');
  assert.equal(lk.length, 3);
  for (const el of lk) {
    assert.ok(el.querySelector('a[href^="/watch?v="]'));
    assert.ok([...el.querySelector('.ytLockupViewModelHost').classList].some((c) => /^content-id-[\w-]{11}$/.test(c)), 'content-id-<videoId>');
    assert.ok(el.querySelector('.yt-lockup-metadata-view-model__heading, a.ytLockupMetadataViewModelTitle'), 'title');
  }
  ({ $$ } = load('youtube/watch-related-ad-slot.html'));
  assert.equal($$('ytd-ad-slot-renderer').length, 1);

  ({ $$ } = load('youtube/watch-metadata.html'));
  assert.equal($$('ytd-watch-metadata').length, 1);
  assert.equal($$('ytd-video-owner-renderer a[href^="/@"]')[0].getAttribute('href'), '/@TrevorNace');
  assert.ok($$('#description-inline-expander how-this-was-made-section-view-model').length >= 1);
  assert.equal($$('badge-shape[aria-label^="AI:"]').length, 0, 'no AI title badge on an auto-dubbed video');

  ({ $$ } = load('youtube/watch-how-this-was-made.html'));
  assert.equal($$('how-this-was-made-section-view-model').length, 2);
  for (const el of $$('how-this-was-made-section-view-model')) {
    assert.equal(text(el.querySelector('.ytwHowThisWasMadeSectionViewModelSectionTitle')), 'How this was made');
    assert.equal(text(el.querySelector('.ytwHowThisWasMadeSectionViewModelBodyHeader')), 'Auto-dubbed');
  }
});

test('youtube: watch page with the platform "Made with AI" label', () => {
  let { $$ } = load('youtube/watch-ai-labelled-metadata.html');
  assert.equal($$('ytd-watch-metadata').length, 1);
  const badge = $$('ytd-watch-metadata #title badge-shape[aria-label="AI: Content was made with AI"]');
  assert.equal(badge.length, 1);
  assert.equal(text(badge[0].querySelector('.ytBadgeShapeText')), 'AI');
  assert.equal(badge[0].getAttribute('role'), 'img');
  assert.ok(badge[0].closest('yt-metadata-badge-renderer') && badge[0].closest('ytd-badge-supported-renderer'));
  const hdrs = $$('how-this-was-made-section-view-model .ytwHowThisWasMadeSectionViewModelBodyHeader').map(text);
  assert.ok(hdrs.includes('Made with AI'), hdrs.join('|'));

  ({ $$ } = load('youtube/watch-ai-labelled-badge.html'));
  assert.equal($$('badge-shape[aria-label^="AI:"]').length, 2);

  ({ $$ } = load('youtube/watch-ai-labelled-how-this-was-made.html'));
  assert.equal($$('how-this-was-made-section-view-model').length, 2);
  assert.equal(text($$('.ytwHowThisWasMadeSectionViewModelBodyHeader')[0]), 'Made with AI');
  assert.match(text($$('.ytwHowThisWasMadeSectionViewModelBodyText')[0]), /^Sounds or visuals were altered or fully generated\. Learn more$/);
  assert.ok($$('a[href*="support.google.com/youtube/answer/15447836"]').length >= 1);
});

test('youtube: innertube JSON snippets', () => {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'youtube/innertube-snippets.json'), 'utf8'));
  const realKey = /"howThisWasMadeSectionViewModel":\{/;
  const madeWithAI = /"bodyHeader":\{"content":"Made with AI"\}/;
  assert.match(j.madeWithAI.fragment, realKey);
  assert.match(j.madeWithAI.fragment, madeWithAI);
  assert.match(j.autoDubbed_NOT_AI.fragment, realKey);
  assert.doesNotMatch(j.autoDubbed_NOT_AI.fragment, madeWithAI);
  assert.match(j.autoDubbed_NOT_AI.fragment, /"bodyHeader":\{"content":"Auto-dubbed"\}/);
  assert.doesNotMatch(j.falsePositive_rendererNameList.fragment, realKey, 'bare renderer-name list must not match the object-key regex');
  assert.match(j.falsePositive_rendererNameList.fragment, /howThisWasMadeSectionViewModel/);
  assert.match(j.titleBadge.fragment, /"metadataBadgeRenderer":\{"icon":\{"iconType":"INFO"\},"style":"BADGE_STYLE_TYPE_SIMPLE","label":"AI"/);
  assert.match(j.titleBadge.fragment, /"accessibilityData":\{"label":"AI: Content was made with AI"\}/);
  assert.equal(j.surveyed.madeWithAI_withTitleBadge.length, 13);
  assert.equal(j.surveyed.autoDubbed_only.length, 10);
});

test('youtube: home grid, shorts shelf, ads, channel page', () => {
  let { $$ } = load('youtube/home-rich-item-renderer.html');
  const items = $$('ytd-rich-item-renderer');
  assert.equal(items.length, 3);
  for (const el of items) {
    assert.ok(el.querySelector(':scope > #content > yt-lockup-view-model'), 'rich item wraps a lockup');
    assert.ok(el.querySelector('a[href^="/watch?v="]'));
    assert.ok(el.querySelector('a[href^="/@"]'), 'home cards carry a channel link');
  }
  ({ $$ } = load('youtube/home-rich-item-ad-slot.html'));
  assert.equal($$('ytd-rich-item-renderer > #content > ytd-ad-slot-renderer').length, 1);

  ({ $$ } = load('youtube/home-shorts-shelf.html'));
  assert.equal($$('ytd-rich-shelf-renderer').length, 1);
  assert.ok($$('ytd-rich-shelf-renderer ytd-rich-item-renderer > #content > ytm-shorts-lockup-view-model-v2 > ytm-shorts-lockup-view-model').length >= 1);
  assert.equal($$('ytd-reel-shelf-renderer').length, 0, 'home shorts shelf is ytd-rich-shelf-renderer now');

  ({ $$ } = load('youtube/home-rich-item-auto-dubbed.html'));
  const dub = $$('yt-content-metadata-view-model .ytContentMetadataViewModelBadge badge-shape .ytBadgeShapeText').map(text);
  assert.ok(dub.includes('Auto-dubbed'), dub.join('|'));

  ({ $$ } = load('youtube/channel-rich-item-renderer.html'));
  assert.equal($$('ytd-rich-item-renderer > #content > yt-lockup-view-model').length, 1);
  assert.equal($$('a[href^="/@"]').length, 0, 'channel-page cards have no channel link');
});

test('youtube: Shorts player overlay with the AI label', () => {
  let { $$ } = load('youtube/shorts-player-overlay-ai-labelled.html');
  assert.equal($$('yt-reel-player-overlay-view-model').length, 1);
  const btn = $$('yt-reel-player-overlay-view-model yt-reel-carousel-view-model button[aria-label="AI: Content was made with AI"]');
  assert.equal(btn.length, 1);
  assert.equal(text(btn[0].querySelector('.ytSpecButtonShapeNextButtonTextContent')), 'AI');
  assert.ok($$('yt-reel-channel-bar-view-model a[href^="/@"]').length >= 1);
  assert.ok($$('yt-shorts-video-title-view-model h1, yt-shorts-video-title-view-model h2').length >= 1);
  ({ $$ } = load('youtube/shorts-how-this-was-made.html'));
  assert.equal(text($$('.ytwHowThisWasMadeSectionViewModelBodyHeader')[0]), 'Made with AI');
});

// ---------------------------------------------------------------- m.youtube.com
test('myoutube: search results and shorts shelf', () => {
  let { $$ } = load('myoutube/search-video-with-context-renderer.html');
  const items = $$('ytm-video-with-context-renderer');
  assert.equal(items.length, 3);
  for (const el of items) {
    assert.ok(el.querySelector('ytm-media-item a[href^="/watch?v="], ytm-media-item a[href^="/shorts/"]'), 'media link');
    assert.ok(el.querySelector('ytm-badge-and-byline-renderer'), 'byline');
    assert.ok(el.querySelector('ytm-thumbnail-overlay-time-status-renderer badge-shape'), 'duration badge');
  }
  assert.ok($$('a[href^="/@"]').length >= 2, 'channel links');
  ({ $$ } = load('myoutube/search-shorts-shelf.html'));
  assert.equal($$('grid-shelf-view-model').length, 2);
  assert.equal($$('ytm-shorts-lockup-view-model').length, 8);
  assert.equal($$('ytm-reel-shelf-renderer').length, 0, 'search shelf is grid-shelf-view-model, not ytm-reel-shelf-renderer');
});

test('myoutube: watch page with the AI label', () => {
  let { $$ } = load('myoutube/watch-ai-labelled-metadata.html');
  assert.equal($$('ytm-slim-video-metadata-section-renderer').length, 1);
  const badge = $$('.slim-video-information-inline-badge badge-shape[aria-label="AI"]');
  assert.equal(badge.length, 1, 'mobile aria-label is exactly "AI"');
  assert.equal(text(badge[0].querySelector('.ytBadgeShapeText')), 'AI');
  assert.ok(badge[0].closest('ytm-badge-supported-renderer'));
  assert.ok($$('a[href^="/@"]').some((a) => a.getAttribute('href') === '/@CreativeAIAds'));

  ({ $$ } = load('myoutube/watch-related-video-with-context.html'));
  assert.equal($$('ytm-video-with-context-renderer').length, 3);

  ({ $$ } = load('myoutube/watch-how-this-was-made.html'));
  assert.equal($$('how-this-was-made-section-view-model').length, 1);
  assert.equal(text($$('.ytwHowThisWasMadeSectionViewModelBodyHeader')[0]), 'Made with AI');

  ({ $$ } = load('myoutube/watch-description-panel.html'));
  assert.equal($$('ytm-structured-description-content-renderer how-this-was-made-section-view-model').length, 1);
});

test('myoutube: home feed', () => {
  let { $$ } = load('myoutube/home-rich-item-renderer.html');
  assert.equal($$('ytm-rich-item-renderer').length, 3);
  assert.equal($$('ytm-rich-item-renderer > yt-lockup-view-model').length, 3);
  assert.equal($$('a[href^="/watch?v="]').length >= 3, true);
  ({ $$ } = load('myoutube/home-shorts-shelf-section.html'));
  assert.equal($$('ytm-rich-section-renderer').length, 1);
  assert.equal($$('ytm-rich-section-renderer grid-shelf-view-model').length, 1);
  assert.ok($$('ytm-shorts-lockup-view-model').length >= 1);
  ({ $$ } = load('myoutube/home-community-post-section.html'));
  assert.equal($$('ytm-rich-section-renderer ytm-backstage-post-thread-renderer').length, 1);
});

// ---------------------------------------------------------------- tiktok.com
test('tiktok: For You items, active-video overlay, explore cards', () => {
  let { $$ } = load('tiktok/foryou-feed-items.html');
  const items = $$('article[data-e2e="recommend-list-item-container"]');
  assert.equal(items.length, 3);
  assert.equal($$('[data-e2e="video-desc"]').length, 0, 'description is NOT inside the article in the 2026 layout');

  ({ $$ } = load('tiktok/foryou-active-video-overlay.html'));
  assert.equal($$('[data-e2e="anchoring-description-layer"]').length >= 1, true);
  assert.ok($$('[data-e2e="video-desc"]').length >= 1);
  assert.ok($$('[data-e2e="video-author-avatar"]').length >= 1);
  assert.ok($$('[data-e2e="cinema-creator-identity"]').length >= 1);
  assert.ok($$('[data-e2e^="desc-span-"]').length >= 1);
  assert.ok($$('[data-e2e="like-count"]').length >= 1);
  assert.equal($$('[data-e2e*="aigc"]').length, 0, 'no AIGC label element was rendered for the captured (non-AI) video');

  ({ $$ } = load('tiktok/explore-items.html'));
  assert.equal($$('div[data-e2e="explore-item"]').length, 3);
  assert.equal($$('div[data-e2e="explore-item"] a[href*="/video/"]').length, 3);
  assert.equal($$('[data-e2e="explore-card-like-container"]').length, 3);
});

// ---------------------------------------------------------------- reddit.com
for (const sub of ['aiart', 'midjourney']) {
  test(`reddit: r/${sub} shreddit-post + shreddit-ad-post`, () => {
    let { $$ } = load(`reddit/${sub}-shreddit-post.html`);
    const posts = $$('shreddit-post');
    assert.equal(posts.length, 3);
    for (const p of posts) {
      for (const a of ['id', 'permalink', 'post-title', 'author', 'subreddit-name', 'subreddit-prefixed-name', 'post-type', 'score', 'created-timestamp']) assert.ok(p.hasAttribute(a), `attr ${a}`);
      assert.match(p.id, /^t3_[a-z0-9]+$/);
      assert.ok(p.querySelector(':scope > a[slot="full-post-link"]'));
      assert.ok(p.querySelector(':scope > a[slot="title"]'));
      const flair = p.querySelector('shreddit-post-flair[slot="post-flair"]');
      assert.ok(flair, 'flair slot');
      assert.ok(text(flair).length > 0, 'flair text');
    }
    const flairs = posts.map((p) => text(p.querySelector('[slot="post-flair"]')));
    assert.ok(flairs.some((f) => (sub === 'aiart' ? /^Image - /.test(f) : /Midjourney/.test(f))), flairs.join('|'));
    assert.equal(new Set(posts.map((p) => p.getAttribute('post-type'))).size, 3, 'three distinct post-type values');

    ({ $$ } = load(`reddit/${sub}-shreddit-ad-post.html`));
    const ad = $$('shreddit-ad-post');
    assert.equal(ad.length, 1);
    assert.ok(ad[0].hasAttribute('promoted'));
    assert.ok(ad[0].classList.contains('promotedlink'));
    assert.match(ad[0].getAttribute('permalink'), /^\/user\//);
    assert.match(text(ad[0].querySelector('faceplate-screen-reader-content')), /^Advertisement:/);
    assert.equal($$('shreddit-post').length, 0);
  });
}

// ---------------------------------------------------------------- synthetic (login-walled sites)
test('x (SYNTHETIC): timeline cells', () => {
  const { $$ } = load('x/synthetic-timeline.html');
  assert.equal($$('div[data-testid="primaryColumn"] section > h1 + div[aria-label] > div > [data-testid="cellInnerDiv"]').length, 3);
  assert.equal($$('article[data-testid="tweet"]').length, 3);
  assert.equal($$('[data-testid="tweetText"]').length, 3);
  assert.equal($$('[data-testid="placementTracking"] article[data-testid="tweet"]').length, 1);
  assert.equal($$('a[href^="/i/grok/share/"]').length, 1);
  assert.ok($$('[data-testid="User-Name"] a').every((a) => /^\/[A-Za-z0-9_]+/.test(a.getAttribute('href'))));
});
test('instagram (SYNTHETIC): feed articles', () => {
  const { $$ } = load('instagram/synthetic-feed.html');
  assert.equal($$('main[role="main"] article').length, 3);
  assert.equal($$('main[role="main"] article header a[href^="/"]').length >= 3, true);
  // adapters should match an element whose own text IS the label, not a regex over the whole article
  assert.equal($$('article header span').filter((s) => text(s) === 'AI info').length, 1);
  assert.equal($$('article span').filter((s) => text(s) === 'Imagined with AI').length, 1);
});
test('facebook (SYNTHETIC): feed units', () => {
  const { $$ } = load('facebook/synthetic-feed.html');
  assert.equal($$('div[role="navigation"] ~ div[role="main"]').length, 1);
  assert.equal($$('div[role="main"] div[aria-posinset]').length, 3);
  assert.equal($$('div[aria-posinset] > div[data-virtualized] > div[role="article"]').length, 3);
  assert.equal($$('a[href*="/ads/about/"][aria-label="Sponsored"]').length, 1);
  assert.equal($$('div[role="article"] span').filter((s) => s.children.length === 0 && text(s) === 'AI info').length, 1);
});
test('linkedin (SYNTHETIC): feed cards', () => {
  const { $$ } = load('linkedin/synthetic-feed.html');
  assert.equal($$('div[data-testid="mainFeed"] [role="listitem"][componentkey^="update-card-focus"]').length, 3);
  assert.equal($$('span[data-testid="expandable-text-box"]').length, 3);
  assert.equal($$('span[aria-hidden="true"]').filter((s) => text(s) === 'Promoted').length, 1);
});
