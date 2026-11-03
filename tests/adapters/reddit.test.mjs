// Tests for Extension/Resources/adapters/reddit.js (owner: adapter:reddit).
// Run: cd /Users/kamilszwed/Projects/NoSlop && node --test tests/adapters/reddit.test.mjs
// Real fixtures: tests/fixtures/reddit/*.html (server-rendered shreddit light DOM, see notes.md there).
// Everything built by post()/ad()/oldThing() below is *** SYNTHETIC *** markup: it reuses the attribute names,
// slot names and nesting observed in the real captures but the ids, texts, flairs and the "App" label placement
// are invented. (Synthetic files cannot live in tests/fixtures/reddit/ because fixtures.test.mjs asserts every
// html file there is marked REAL.)
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadScripts, CORE_FILES, ROOT, settle } from '../helpers/load.mjs';

const J = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (a, b, m) => (m === undefined ? assert.deepEqual(J(a), J(b)) : assert.deepEqual(J(a), J(b), m));
const FILES = [...CORE_FILES, 'adapters/reddit.js'];
const FIX = path.join(ROOT, 'tests/fixtures/reddit');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Style-slop text (same as tests/engine.test.mjs): tier 3 only, can only dim.
const SLOP = "It's not about working harder — it's about working smarter. Moreover, furthermore, additionally, delve into the intricate tapestry. In conclusion, leverage synergy. Thoughts?";

// ---- SYNTHETIC shreddit-post (attribute + slot names from tests/fixtures/reddit/notes.md) ----
function post(id, { title = 'A photo of my cat', body = '', author = 'alice', authorId = 't2_a1', sub = 'cats', type = 'image',
  flair = '', recommended = false, app = false, wrap = true, extraAttrs = '' } = {}) {
  const permalink = `/r/${sub}/comments/${id.replace(/^t3_/, '')}/x/`;
  const inner =
    `<shreddit-post class="block relative" id="${id}" permalink="${permalink}" content-href="https://i.redd.it/${id}.jpeg" ` +
    `post-title="${esc(title)}" post-type="${type}" author="${author}" author-id="${authorId}" subreddit-name="${sub}" ` +
    `subreddit-prefixed-name="r/${sub}" view-context="SubredditFeed" score="1"${recommended ? ' recommendation-source="SIMILAR_SUBREDDITS"' : ''}${extraAttrs}>` +
    `<a slot="full-post-link" href="${permalink}" aria-label="${esc(title)}"></a>` +
    `<span slot="credit-bar"><span slot="authorName"><a aria-label="Author: u/${author}" href="https://www.reddit.com/user/${author}/">u/${author}</a></span>` +
    (app ? '<span class="account-label">App</span>' : '') + `</span>` +
    `<div slot="content"><a slot="title" href="${permalink}" id="post-title-${id}">${esc(title)}</a>` +
    (flair ? `<shreddit-post-flair slot="post-flair" post-id="${id}"><a href="/r/${sub}/?f=flair_name"><span><div aria-label="Flair: ${esc(flair)}"><div> ${esc(flair)} </div></div></span></a></shreddit-post-flair>` : '') +
    (body ? `<div slot="text-body" class="feed-card-text-preview"><p>${esc(body)}</p></div>` : '') +
    (type === 'video' ? `<div slot="post-media-container"><video></video></div>` : type === 'image' ? `<div slot="post-media-container"><img alt=""></div>` : '') +
    `</div></shreddit-post>`;
  return wrap ? `<article class="w-full m-0">${inner}</article>` : inner;
}
function ad(id, { title = 'Buy now', advertiser = 'Roblox', wrap = false } = {}) {
  const inner = `<shreddit-ad-post class="promotedlink block relative" id="${id}" post-id="${id}" promoted ad-type="video" placement="feed" ` +
    `permalink="/user/${advertiser}/comments/${id.replace(/^t3_/, '')}/x/" post-title="${esc(title)}" post-type="video" author="${advertiser}" subreddit-name="u_${advertiser}">` +
    `<faceplate-screen-reader-content>Advertisement: ${esc(title)}</faceplate-screen-reader-content>` +
    `<div slot="credit-bar"><a class="advertiser-name" href="/user/${advertiser}/">${advertiser}</a></div><div slot="title"><div class="headline">${esc(title)}</div></div>` +
    `<div slot="post-media-container"><img slot="poster" alt=""></div></shreddit-ad-post>`;
  return wrap ? `<article>${inner}</article>` : inner;
}
// SYNTHETIC old.reddit.com .thing.link (selectors from research §2.7; data-fullname is the adapter's documented fallback)
function oldThing(id, { title = 'old post', author = 'oldie', sub = 'r/pics', body = '', promoted = false, flair = '' } = {}) {
  return `<div class="thing link${promoted ? ' promotedlink' : ''}" id="thing_${id}" data-fullname="${id}">` +
    `<a class="title" href="/r/${sub.replace(/^r\//, '')}/comments/${id.replace(/^t3_/, '')}/x/">${esc(title)}</a>` +
    (flair ? `<span class="linkflairlabel">${esc(flair)}</span>` : '') +
    `<p class="tagline"><a class="author" href="/user/${author}">${author}</a> <a class="subreddit" href="/${sub}/">${sub}</a></p>` +
    (body ? `<div class="usertext-body"><div class="md"><p>${esc(body)}</p></div></div>` : '') + `</div>`;
}
const feed = (html, attrs = '') => `<shreddit-feed${attrs}>${html}</shreddit-feed>`;

let ctx;
async function load(html = '', url = 'https://www.reddit.com/') {
  ctx = await loadScripts(FILES, { url, html: `<!doctype html><html><body><main>${html}</main></body></html>` });
  return ctx;
}
async function boot(html, opts = {}) {
  await load(html, opts.url || 'https://www.reddit.com/');
  const { NoSlop, window } = ctx;
  if (opts.settings) await NoSlop.host.patchSettings(opts.settings);
  await NoSlop.engine.start({ adapter: NoSlop.adapters.pick(window.location), rules: NoSlop.rules, host: NoSlop.host });
  await settle();
  return ctx;
}
afterEach(() => { if (ctx && ctx.NoSlop && ctx.NoSlop.engine.running) ctx.NoSlop.engine.stop(); });

const A = () => ctx.NoSlop.adapters.pick({ hostname: 'www.reddit.com' });
const postEl = (id) => ctx.document.querySelector(`shreddit-post[id="${id}"], shreddit-ad-post[id="${id}"], .thing[data-fullname="${id}"]`);
const outer = (id) => { const p = postEl(id); return p.parentElement && p.parentElement.tagName === 'ARTICLE' ? p.parentElement : p; };
const action = (id) => outer(id).getAttribute('data-noslop-action');
const stateOf = (id) => ctx.NoSlop.engine.stateOf(outer(id));
const setMode = (mode) => ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.engine.settings.sites, { reddit: { mode } }) });
const setSurface = (k, v) => ctx.NoSlop.host.patchSettings({ surfaces: Object.assign({}, ctx.NoSlop.engine.settings.surfaces, { [k]: v }) });

// ------------------------------------------------------------------------------------------------ registration
describe('registration', () => {
  test('registers as "reddit", replaces the placeholder, matches every *.reddit.com host', async () => {
    await load();
    const a = A();
    assert.ok(a && !a.placeholder);
    assert.equal(a.site, 'reddit');
    for (const h of ['www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'reddit.com', 'sh.reddit.com']) assert.ok(a.matches({ hostname: h }), h);
    for (const h of ['reddit.com.evil.test', 'notreddit.com', 'www.youtube.com']) assert.ok(!a.matches({ hostname: h }), h);
  });
  test('hideStrategy and attributeFilter come from rules.sites.reddit and can be overridden', async () => {
    await load();
    const a = A();
    const r = ctx.NoSlop.rules.sites.reddit;
    assert.equal(a.hideStrategy, 'display-none');
    assert.equal(a.hideStrategy, r.hideStrategy);
    deq(a.attributeFilter, r.attributeFilter);
    assert.ok(a.attributeFilter.includes('post-title') && a.attributeFilter.includes('id'));
    a.hideStrategy = 'height-zero';
    assert.equal(a.hideStrategy, 'height-zero');
    a.hideStrategy = null;
    assert.equal(a.hideStrategy, 'display-none');
  });
  test('content.js picks the reddit adapter on reddit.com and the engine starts', async () => {
    const js = ['rules.js', 'lib/dom.js', 'lib/scorer.js', 'lib/host-extension.js', 'lib/engine.js', 'adapters/youtube.js', 'adapters/reddit.js', 'content.js'];
    const c = await loadScripts(js, { url: 'https://www.reddit.com/r/popular/' });
    await settle();
    assert.equal(c.NoSlop.engine.site, 'reddit');
    assert.equal(c.NoSlop.engine.surface, 'popular');
    c.NoSlop.engine.stop();
  });
});

// ------------------------------------------------------------------------------------------------ surface
describe('surface()', () => {
  test('maps reddit paths to the engine surfaces', async () => {
    await load();
    const s = (pathname, search = '') => A().surface({ pathname, search });
    assert.equal(s('/'), 'home');
    assert.equal(s('/', '?feed=home'), 'home');
    assert.equal(s('/best/'), 'home');
    assert.equal(s('/r/popular/'), 'popular', '/r/popular: nothing is user-chosen, the seed list applies unconditionally');
    assert.equal(s('/r/all'), 'popular');
    assert.equal(s('/r/all/new/'), 'popular');
    assert.equal(s('/', '?feed=following'), 'other', 'following feed is the user\'s own subscriptions');
    assert.equal(s('/r/aiArt/'), 'other', 'inside a subreddit the seed list must not apply');
    assert.equal(s('/r/aiArt/new/'), 'other');
    assert.equal(s('/r/aiArt/comments/1xlvuvl/clawed_monet/'), 'watch');
    assert.equal(s('/comments/1xlvuvl'), 'watch');
    assert.equal(s('/user/WallySchirra/comments/abc/x/'), 'watch');
    assert.equal(s('/search/', '?q=cats'), 'search');
    assert.equal(s('/user/WallySchirra/'), 'profile');
    assert.equal(s('/u/WallySchirra'), 'profile');
    assert.equal(s('/settings'), 'other');
  });
});

// ------------------------------------------------------------------------------------------------ extraction (REAL fixtures)
describe('extraction from the real shreddit captures', () => {
  test('r/aiArt posts: id, title, author, subreddit, flair, media, links; no label (flair is not an exact AI label)', async () => {
    await load(fixture('aiart-shreddit-post.html'), 'https://www.reddit.com/r/aiArt/');
    const a = A();
    const items = a.findItems(ctx.document).map((el) => a.extract(el));
    assert.equal(items.length, 3);
    deq(items.map((i) => i.id), ['t3_1xlvuvl', 't3_1xlky71', 't3_1xmbe07']);
    const [monet, batman, tribal] = items;
    assert.equal(monet.title, 'Clawed Monet');
    deq(monet.author, { handle: 'WallySchirra', name: 'WallySchirra', id: 't2_2nhvyurrfc' });
    assert.equal(monet.extra.subreddit, 'aiArt');
    assert.equal(monet.extra.subredditPrefixed, 'r/aiArt');
    assert.equal(monet.extra.flair, 'Image - ChatGPT');
    assert.equal(monet.text, 'Image - ChatGPT', 'flair is scored as text');
    assert.equal(monet.extra.postType, 'image');
    deq(monet.media, ['image']);
    assert.equal(monet.kind, 'post');
    deq(monet.labels, []);
    deq(monet.hashtags, []);
    assert.ok(monet.links.includes('https://www.reddit.com/r/aiArt/comments/1xlvuvl/clawed_monet/'));
    assert.ok(monet.links.includes('https://i.redd.it/pwd20qpl07zh1.jpeg'));
    assert.equal(monet.extra.recommended, undefined);
    assert.equal(monet.extra.ui, 'shreddit');
    assert.equal(batman.title, '"Big Foot" style pics of Batman characters');
    assert.equal(batman.extra.postType, 'gallery'); deq(batman.media, ['image']);
    assert.equal(tribal.extra.postType, 'crosspost');
    assert.equal(tribal.extra.flair, 'Image - Other: Please edit, or your post may be deleted.');
    assert.ok(tribal.links.includes('https://www.reddit.com/r/FrontierArtSFW/comments/1xlkq19/tribal_angel_graphic/'), 'relative content-href made absolute');
  });
  test('r/midjourney posts: video post-type -> media video, kind video; flair text feeds the scorer', async () => {
    await load(fixture('midjourney-shreddit-post.html'), 'https://www.reddit.com/r/midjourney/');
    const a = A();
    const items = a.findItems(ctx.document).map((el) => a.extract(el));
    deq(items.map((i) => [i.id, i.extra.postType, i.media[0], i.kind]), [
      ['t3_1xlyuah', 'gallery', 'image', 'post'], ['t3_1xm84jy', 'image', 'image', 'post'], ['t3_1xlhpvb', 'video', 'video', 'video']]);
    deq(items.map((i) => i.extra.flair), ['AI Showcase - Midjourney', 'AI Showcase - Midjourney', 'AI Video - Midjourney']);
    deq(items.map((i) => i.author.handle), ['Mordrat_The_Grey', 'Brianshoe', 'Abovethevortex']);
    // what the scorer makes of it inside the subreddit (surface other, balanced): "AI Video" (mention-level disclosure)
    // + the single tool family from the flair line pool under the mention cap (0.6) -> dim, never hide
    const v = ctx.NoSlop.scorer.score(items[2], ctx.NoSlop.rules, ctx.NoSlop.defaultSettings(), 'reddit');
    assert.ok(v.reasons.includes('tool:midjourney'), v.reasons.join(','));
    assert.equal(v.action, 'dim');
    const v0 = ctx.NoSlop.scorer.score(items[0], ctx.NoSlop.rules, ctx.NoSlop.defaultSettings(), 'reddit');
    assert.equal(v0.action, 'none', '"AI Showcase - Midjourney" alone is only a tool mention (0.4)');
  });
  test('shreddit-ad-post: kind ad, promoted label, advertiser as author, id from the post', async () => {
    for (const f of ['aiart-shreddit-ad-post.html', 'midjourney-shreddit-ad-post.html']) {
      await load(fixture(f));
      const a = A();
      const els = a.findItems(ctx.document);
      assert.equal(els.length, 1, f);
      const it = a.extract(els[0]);
      assert.match(it.id, /^t3_[a-z0-9]+$/);
      assert.equal(it.kind, 'ad');
      deq(it.labels, [{ type: 'promoted' }]);
      assert.ok(it.author.handle.length > 0);
      assert.match(it.extra.subreddit, /^u_/);
      assert.equal(it.extra.flair, undefined);
      deq(it.media, ['video']);
      assert.ok(it.title.length > 10);
    }
    const it = A().extract(ctx.document.querySelector('shreddit-ad-post'));
    assert.equal(it.author.handle, ctx.document.querySelector('shreddit-ad-post').getAttribute('author'));
  });
  test('article wrapper: findItems returns the outer article once; extract works on it and on the inner post', async () => {
    await load(fixture('aiart-shreddit-post.html'));
    const a = A();
    assert.equal(a.findItems(ctx.document).length, 3);
    // wrap the first post the way the live feed does (article.w-full > shreddit-post, one post per article)
    const first = ctx.document.querySelector('shreddit-post');
    const art = ctx.document.createElement('article'); art.className = 'w-full';
    first.replaceWith(art); art.appendChild(first);
    const els = a.findItems(ctx.document);
    assert.equal(els.length, 3, 'no duplicate for the wrapped post');
    assert.equal(els[0], art, 'outer article is the engine element');
    assert.equal(a.extract(art).id, 't3_1xlvuvl');
    assert.equal(a.extract(art).extra.wrapped, true);
    assert.equal(a.extract(first).id, 't3_1xlvuvl', 'extract also accepts the inner element');
    deq(a.findItems(first).map((e) => e === art), [true], 'findItems(root=inner post) yields the outer article');
    deq(a.findItems(art).map((e) => e === art), [true]);
    // an article holding several posts is a list, not a card: the posts themselves are the items
    const list = ctx.document.createElement('article');
    const rest = [...ctx.document.querySelectorAll('shreddit-post')].slice(1);
    rest[0].replaceWith(list); list.append(...rest);
    const els2 = a.findItems(ctx.document);
    assert.equal(els2.length, 3);
    assert.ok(els2.includes(rest[0]) && els2.includes(rest[1]) && !els2.includes(list));
  });
  test('skeleton / unrelated elements extract to null', async () => {
    await load('<shreddit-post post-title="loading"></shreddit-post><div class="other">x</div>');
    const a = A();
    assert.equal(a.extract(ctx.document.querySelector('shreddit-post')), null, 'no id yet');
    assert.equal(a.extract(ctx.document.querySelector('.other')), null);
    assert.equal(a.extract(null), null);
  });
});

// ------------------------------------------------------------------------------------------------ extraction (SYNTHETIC)
describe('extraction from synthetic shreddit markup', () => {
  test('text body, hashtags, exact AI flair -> platform_ai label reddit_flair', async () => {
    await load(post('t3_s1', { title: 'My render', body: 'made this with #aiart and #midjourney tonight', flair: 'AI Art', type: 'text' }));
    const it = A().extract(ctx.document.querySelector('article'));
    assert.equal(it.id, 't3_s1');
    assert.equal(it.title, 'My render');
    assert.equal(it.text, 'made this with #aiart and #midjourney tonight\nAI Art');
    deq(it.hashtags, ['#aiart', '#midjourney']);
    deq(it.labels, [{ type: 'platform_ai', id: 'reddit_flair', text: 'AI Art' }]);
    deq(it.media, ['none']);
    const texts = ctx.NoSlop.rules.labels.reddit.flairText;
    assert.ok(texts.includes('AI Art'), 'label string comes from rules.labels.reddit.flairText');
  });
  test('flair label match is exact and case-insensitive; partial flair is text only; bare "AI" is a TOPIC flair (text only, never a label)', async () => {
    await load(post('t3_f1', { flair: 'ai generated' }) + post('t3_f2', { flair: 'Image - ChatGPT' }) + post('t3_f3', { sub: 'Futurology', title: 'EU passes new AI act amendments', flair: 'AI' }));
    const a = A();
    deq(a.extract(outer('t3_f1')).labels.map((l) => l.id), ['reddit_flair']);
    deq(a.extract(outer('t3_f2')).labels, []);
    assert.ok(!ctx.NoSlop.rules.labels.reddit.flairText.includes('AI'));
    const news = a.extract(outer('t3_f3'));
    deq(news.labels, []);
    assert.equal(news.text, 'AI');
    assert.equal(ctx.NoSlop.scorer.score(news, ctx.NoSlop.rules, ctx.NoSlop.defaultSettings(), 'reddit').action, 'none', 'r/Futurology news post with the AI topic flair is left alone');
  });
  test('recommendation-source -> extra.recommended, except inside the following feed', async () => {
    await load(feed(post('t3_r1', { recommended: true })) + feed(post('t3_r2', { recommended: true }), ' reload-url="/svc/shreddit/feeds/home-feed?feed=following"') + feed(post('t3_r3')));
    const a = A();
    assert.equal(a.extract(outer('t3_r1')).extra.recommended, true);
    assert.equal(a.extract(outer('t3_r2')).extra.recommended, undefined);
    assert.equal(a.extract(outer('t3_r3')).extra.recommended, undefined);
  });
  test('"App" account label: recorded in extra, emitted as a label only with settings.sites.reddit.flagAppAccounts', async () => {
    await load(post('t3_app', { app: true }) + post('t3_h', {}));
    const a = A();
    let it = a.extract(outer('t3_app'));
    assert.equal(it.extra.accountLabel, 'App');
    deq(it.labels, [], 'opt-in: no label by default');
    assert.equal(a.extract(outer('t3_h')).extra.accountLabel, undefined);
    await ctx.NoSlop.host.patchSettings({ sites: Object.assign({}, ctx.NoSlop.defaultSettings().sites, { reddit: { mode: 'balanced', flagAppAccounts: true } }) });
    await ctx.NoSlop.engine.start({ adapter: a, rules: ctx.NoSlop.rules, host: ctx.NoSlop.host });
    await settle();
    it = a.extract(outer('t3_app'));
    deq(it.labels, [{ type: 'platform_ai', id: 'reddit_app_account', text: 'App' }]);
    assert.equal(action('t3_app'), 'hide');
    assert.ok(stateOf('t3_app').verdict.reasons.includes('label:reddit_app_account'));
    assert.equal(action('t3_h'), 'none');
  });
  test('generic data attributes from rules.labels.generic.selectors are honoured', async () => {
    await load(post('t3_g1', { extraAttrs: ' data-ai-generated="true"' }));
    deq(A().extract(outer('t3_g1')).labels.map((l) => l.id), ['reddit_generic_attr']);
  });
  test('old.reddit.com .thing.link: id from data-fullname, title/author/subreddit/body, promoted', async () => {
    await load(oldThing('t3_o1', { title: 'Old title', body: 'hello #aiart', sub: 'r/pics', author: 'oldie' }) + oldThing('t3_o2', { promoted: true }) + oldThing('t3_o3', { flair: 'AI Generated' }), 'https://old.reddit.com/');
    const a = A();
    const els = a.findItems(ctx.document);
    assert.equal(els.length, 3);
    const it = a.extract(els[0]);
    assert.equal(it.id, 't3_o1'); assert.equal(it.title, 'Old title'); assert.equal(it.text, 'hello #aiart');
    deq(it.hashtags, ['#aiart']);
    deq(it.author, { handle: 'oldie', name: 'oldie' });
    assert.equal(it.extra.subreddit, 'pics'); assert.equal(it.extra.ui, 'old');
    assert.equal(a.extract(els[1]).kind, 'ad');
    deq(a.extract(els[1]).labels, [{ type: 'promoted' }]);
    deq(a.extract(els[2]).labels, [{ type: 'platform_ai', id: 'reddit_flair', text: 'AI Generated' }]);
  });
  test('falls back to built-in selectors when rules.sites.reddit is missing (rulesOverride)', async () => {
    await load(post('t3_x1', { flair: 'AI Generated' }));
    // rulesOverride is deep-merged over the bundled rules (DESIGN §6); a null section removes it.
    await ctx.NoSlop.host.patchSettings({ rulesOverride: { sites: { reddit: null } } });
    await ctx.NoSlop.engine.start({ adapter: A(), rules: ctx.NoSlop.rules, host: ctx.NoSlop.host });
    await settle();
    assert.equal(ctx.NoSlop.engine.rules.sites.reddit, null);
    assert.equal(ctx.NoSlop.engine.rules.sites.x.cell, '[data-testid="cellInnerDiv"]', 'other sections survive the partial override');
    assert.equal(A().hideStrategy, 'display-none');
    assert.equal(action('t3_x1'), 'hide');
  });
});

// ------------------------------------------------------------------------------------------------ engine end-to-end
describe('engine end-to-end on reddit markup', () => {
  test('labelled post hidden with a stub (display-none on the article), plain post untouched, style slop dimmed not hidden', async () => {
    await boot(post('t3_ai', { flair: 'AI Art', type: 'video' }) + post('t3_plain', { title: 'Look at my dog', body: 'he is a good boy' }) + post('t3_slop', { title: 'Thoughts', body: SLOP, type: 'text' }),
      { url: 'https://www.reddit.com/r/pics/' });
    const h = outer('t3_ai');
    assert.equal(h.tagName, 'ARTICLE');
    assert.equal(h.getAttribute('data-noslop-id'), 't3_ai');
    assert.equal(action('t3_ai'), 'hide');
    assert.ok(h.classList.contains('noslop-hidden') && h.classList.contains('noslop-hidden--display-none'));
    const stub = h.querySelector(':scope > .noslop-stub');
    assert.ok(stub, 'stub inserted');
    assert.match(stub.textContent, /Hidden: AI content/);
    assert.match(stub.textContent, /platform AI label/);
    assert.match(stub.querySelector('[data-noslop-act="never"]').textContent, /Never show @alice/);
    assert.equal(h.querySelector('video').muted, true, 'hidden video muted');
    assert.ok(stateOf('t3_ai').verdict.reasons.includes('label:reddit_flair'));
    assert.equal(stateOf('t3_ai').verdict.tier, 0);
    assert.equal(stub.getAttribute('slot'), null, 'wrapped post: stub stays unslotted on the article');

    const p = outer('t3_plain');
    assert.equal(action('t3_plain'), 'none');
    assert.ok(!p.classList.contains('noslop-hidden') && !p.classList.contains('noslop-dim'));
    assert.equal(p.querySelector('.noslop-stub, .noslop-badge'), null);

    const d = outer('t3_slop');
    assert.equal(action('t3_slop'), 'dim');
    assert.ok(d.classList.contains('noslop-dim') && !d.classList.contains('noslop-hidden'));
    const badge = d.querySelector(':scope > .noslop-badge');
    assert.ok(badge); assert.equal(badge.textContent, 'AI?');
    assert.equal(stateOf('t3_slop').verdict.tier, 3);
  });
  test('bare shreddit-post (no article, a shadow host): the host itself is hidden and the stub sits BEFORE it', async () => {
    await boot(post('t3_bare', { flair: 'AI Art', wrap: false }) + post('t3_wrapped', { flair: 'AI Art' }));
    const e = postEl('t3_bare');
    assert.equal(e.tagName, 'SHREDDIT-POST');
    assert.equal(action('t3_bare'), 'hide');
    assert.equal(A().stubPlacement(e), 'before');
    assert.ok(e.classList.contains('noslop-hidden--host'), 'shadow chrome cannot be reached by the child rule: the host is display:none');
    assert.equal(e.querySelector(':scope > .noslop-stub'), null, 'no unslotted light-DOM child');
    const stub = e.previousElementSibling;
    assert.ok(stub && stub.classList.contains('noslop-stub'), 'stub is the previous sibling');
    assert.equal(stub.getAttribute('data-noslop-for'), 't3_bare');
    assert.ok(ctx.NoSlop.engine.stateOf(e).stub === stub);
    // the article wrapper keeps the default (stub inside, children hidden)
    const w = outer('t3_wrapped');
    assert.equal(w.tagName, 'ARTICLE');
    assert.equal(A().stubPlacement(w), 'inside');
    assert.ok(w.querySelector(':scope > .noslop-stub'));
    assert.ok(!w.classList.contains('noslop-hidden--host'));
    // Show -> unapplied cleanly, sibling stub gone
    stub.querySelector('[data-noslop-act="show"]').click();
    await settle();
    assert.equal(action('t3_bare'), 'none');
    assert.ok(!e.classList.contains('noslop-hidden--host'));
    assert.equal(ctx.document.querySelector('.noslop-stub[data-noslop-for]'), null);
    // a removed host leaves no orphan stub behind
    ctx.NoSlop.engine.invalidate('t3_bare'); ctx.NoSlop.engine._E.sessionAllow.clear();
    ctx.NoSlop.engine.processNow();
    assert.equal(action('t3_bare'), 'hide');
    const stub2 = e.previousElementSibling;
    assert.ok(stub2.classList.contains('noslop-stub'));
    e.remove();
    await settle(5);
    assert.equal(stub2.isConnected, false, 'orphan stub pruned');
  });
  test('real fixture end-to-end: r/midjourney feed in balanced dims the "AI Video" post; strict keeps it at dim (mentions never hide)', async () => {
    await boot(fixture('midjourney-shreddit-post.html'), { url: 'https://www.reddit.com/r/midjourney/' });
    assert.equal(ctx.NoSlop.engine.surface, 'other');
    assert.equal(action('t3_1xlhpvb'), 'dim');
    assert.ok(stateOf('t3_1xlhpvb').verdict.reasons.includes('tool:midjourney'));
    assert.equal(action('t3_1xlyuah'), 'none', 'tool mention alone (0.4) is below the dim threshold');
    assert.ok(stateOf('t3_1xlyuah').verdict.reasons.includes('tool:midjourney'));
    assert.ok(stateOf('t3_1xlyuah').verdict.nonStyleScore < 0.6);
    assert.equal(outer('t3_1xlhpvb').querySelector('video') && outer('t3_1xlhpvb').querySelector('video').muted, null, 'dimmed video keeps playing (no video element in the SSR capture)');
    await setMode('strict');
    await settle();
    assert.equal(action('t3_1xlhpvb'), 'dim', 'strict: "AI Video" + one tool family stay under the mention cap (0.6 < 0.8)');
    assert.equal(action('t3_1xlyuah'), 'dim', 'strict: dim threshold 0.4 = one tool mention');
    assert.ok(!outer('t3_1xlyuah').classList.contains('noslop-hidden'), 'a tool mention alone never hides');
  });
  test('real fixture ads: hidden only when settings.surfaces.hideAds', async () => {
    await boot(fixture('aiart-shreddit-ad-post.html') + fixture('aiart-shreddit-post.html'), { url: 'https://www.reddit.com/r/aiArt/' });
    const adEl = ctx.document.querySelector('shreddit-ad-post');
    const id = adEl.getAttribute('id');
    assert.equal(action(id), 'none');
    await setSurface('hideAds', true);
    await settle();
    assert.equal(action(id), 'hide');
    assert.ok(stateOf(id).verdict.reasons.includes('ad:promoted'));
    assert.equal(action('t3_1xlvuvl'), 'none', 'ordinary post unaffected');
    await setSurface('hideAds', false);
    await settle();
    assert.equal(action(id), 'none');
  });
  test('tier-2 seed subreddit (Stevo list) on /r/popular: strict hides; balanced dims with account:subreddit; inside the subreddit nothing', async () => {
    await boot(post('t3_h1', { sub: 'aiArt', title: 'a nice sunset' }) + post('t3_h2', { sub: 'cats', title: 'a nice cat' }), { url: 'https://www.reddit.com/r/popular/', settings: { sites: { reddit: { mode: 'strict' } } } });
    assert.ok(ctx.NoSlop.rules.accounts.reddit.subreddits.some((s) => s.toLowerCase() === 'aiart'), 'aiArt is in the seed list');
    assert.equal(ctx.NoSlop.engine.surface, 'popular');
    assert.equal(action('t3_h1'), 'hide');
    assert.ok(stateOf('t3_h1').verdict.reasons.includes('account:subreddit'));
    assert.equal(stateOf('t3_h1').verdict.tier, 2);
    assert.equal(action('t3_h2'), 'none');
    await setMode('balanced');
    await settle();
    assert.equal(action('t3_h1'), 'dim', 'accounts.reddit.score 0.9: dim in balanced');
    assert.ok(stateOf('t3_h1').verdict.reasons.includes('account:subreddit'));
    assert.equal(action('t3_h2'), 'none');
    // SOFT navigation into the subreddit WITHOUT going through the (isolated-world) history hook: the engine notices
    // the URL on its next flush, re-reads the surface and re-scores t3_h1 (verdicts are keyed by surface)
    const origPush = ctx.NoSlop.engine._E.historyPatched.pushState;
    origPush.call(ctx.window.history, {}, '', '/r/aiArt/');
    ctx.document.querySelector('main').insertAdjacentHTML('beforeend', post('t3_h3', { sub: 'aiArt', title: 'another sunset' }) + post('t3_h4', { sub: 'aiArt', title: 'suggested', recommended: true }));
    await settle(8);
    assert.equal(ctx.NoSlop.engine.surface, 'other');
    assert.equal(action('t3_h3'), 'none');
    assert.equal(stateOf('t3_h3').item.surface, 'other');
    // ... unless Reddit marks it as a recommendation (recommendation-source), which applies on any surface
    assert.equal(action('t3_h4'), 'dim', 'recommended post from a seed sub');
    assert.ok(stateOf('t3_h4').verdict.reasons.includes('account:subreddit'));
    assert.equal(action('t3_h1'), 'none', 'inside its own subreddit the seed post is no longer dimmed');
    assert.equal(stateOf('t3_h1').item.surface, 'other');
  });
  test('the "/" home feed mixes JOINED communities with recommendations: only recommended seed-sub posts are touched there', async () => {
    await boot(post('t3_j1', { sub: 'MachineLearning', title: 'new paper' }) + post('t3_j2', { sub: 'MachineLearning', title: 'suggested', recommended: true }), { url: 'https://www.reddit.com/?feed=home', settings: { sites: { reddit: { mode: 'strict' } } } });
    assert.equal(ctx.NoSlop.engine.surface, 'home');
    assert.equal(action('t3_j1'), 'none', "a subscriber's own r/MachineLearning post");
    assert.equal(action('t3_j2'), 'hide');
    assert.ok(stateOf('t3_j2').verdict.reasons.includes('account:subreddit'));
  });
  test('following feed: seed subreddits are left alone', async () => {
    await boot(feed(post('t3_fw', { sub: 'midjourney', recommended: true }), ' reload-url="/svc/shreddit/feeds/home-feed?feed=following"'), { url: 'https://www.reddit.com/?feed=following' });
    assert.equal(ctx.NoSlop.engine.surface, 'other');
    assert.equal(action('t3_fw'), 'none');
  });
  test('surfaces toggle: hideRedditRecommended hides shreddit-post[recommendation-source] with a stats bump and is reversible', async () => {
    await boot(post('t3_rec', { recommended: true }) + post('t3_norm'));
    const rec = postEl('t3_rec');
    assert.ok(!rec.classList.contains('noslop-surface'));
    deq(A().surfaces(), [{ settingKey: 'hideRedditRecommended', selector: ctx.NoSlop.rules.sites.reddit.recommended }]);
    await setSurface('hideRedditRecommended', true);
    await settle();
    assert.ok(rec.classList.contains('noslop-surface'));
    assert.equal(rec.getAttribute('data-noslop-surface'), 'hideRedditRecommended');
    assert.ok(!postEl('t3_norm').classList.contains('noslop-surface'));
    ctx.NoSlop.engine.flushStats();
    assert.ok(ctx.NoSlop.host.__reports.some((r) => r.reason === 'surface:hideRedditRecommended' && r.action === 'hide'));
    await setSurface('hideRedditRecommended', false);
    await settle();
    assert.ok(!rec.classList.contains('noslop-surface'));
  });
  test('SPA re-render: remove + re-append keeps the verdict (one stub, cache hit, one stats count)', async () => {
    await boot(post('t3_v1', { flair: 'AI Art' }));
    const e = outer('t3_v1');
    const parent = e.parentNode;
    e.remove();
    await settle();
    parent.appendChild(e);
    await settle(5);
    assert.equal(action('t3_v1'), 'hide');
    assert.equal(e.querySelectorAll('.noslop-stub').length, 1);
    const orig = ctx.NoSlop.scorer.score; let calls = 0; ctx.NoSlop.scorer.score = (...a) => { calls++; return orig(...a); };
    parent.insertAdjacentHTML('beforeend', post('t3_v1', { flair: 'AI Art' }));
    await settle(5);
    ctx.NoSlop.scorer.score = orig;
    assert.equal(calls, 0, 'second mount of the same id comes from the cache');
    const both = ctx.document.querySelectorAll('shreddit-post[id="t3_v1"]');
    assert.equal(both.length, 2);
    assert.ok(both[1].parentElement.classList.contains('noslop-hidden'));
    ctx.NoSlop.engine.flushStats();
    const hides = ctx.NoSlop.host.__reports.filter((r) => r.action === 'hide').reduce((n, r) => n + r.count, 0);
    assert.equal(hides, 1);
  });
  test('cell reuse: attribute changes on the inner shreddit-post (id/post-title/flair) re-verdict the outer card via the observer', async () => {
    await boot(post('t3_c1', { flair: 'AI Art', title: 'first' }));
    const art = outer('t3_c1');
    const inner = art.querySelector('shreddit-post');
    assert.equal(action('t3_c1'), 'hide');
    assert.ok(ctx.NoSlop.engine._E.observer, 'observer installed');
    // reuse: the same elements now show another post (attributes + slotted children change)
    inner.setAttribute('id', 't3_c2'); inner.setAttribute('post-title', 'second, a human post');
    inner.querySelector('shreddit-post-flair').remove();
    await settle(6);
    assert.equal(art.getAttribute('data-noslop-id'), 't3_c2');
    assert.equal(art.getAttribute('data-noslop-action'), 'none');
    assert.ok(!art.classList.contains('noslop-hidden'));
    assert.equal(art.querySelector('.noslop-stub'), null);
    // and back to an AI post
    inner.setAttribute('id', 't3_c3');
    inner.querySelector('[slot="content"]').insertAdjacentHTML('beforeend', '<shreddit-post-flair slot="post-flair"><a><span><div> AI Art </div></span></a></shreddit-post-flair>');
    await settle(6);
    assert.equal(art.getAttribute('data-noslop-id'), 't3_c3');
    assert.equal(art.getAttribute('data-noslop-action'), 'hide');
    assert.equal(art.querySelectorAll('.noslop-stub').length, 1);
  });
  test('late upgrade: a post that gets its id after mount is picked up', async () => {
    await boot('<article><shreddit-post post-title="x" author="a" subreddit-name="cats"><div slot="content"><shreddit-post-flair slot="post-flair"><div>AI Art</div></shreddit-post-flair></div></shreddit-post></article>');
    const art = ctx.document.querySelector('article');
    assert.equal(art.getAttribute('data-noslop-id'), null);
    art.querySelector('shreddit-post').setAttribute('id', 't3_late');
    await settle(6);
    assert.equal(art.getAttribute('data-noslop-action'), 'hide');
  });
  test('Never show @author blocks the author in settings.blockedAccounts.reddit and hides their other posts', async () => {
    await boot(post('t3_n1', { flair: 'AI Art', author: 'botty' }) + post('t3_n2', { author: 'botty' }) + post('t3_n3', { author: 'carol' }));
    assert.equal(action('t3_n2'), 'none');
    outer('t3_n1').querySelector('[data-noslop-act="never"]').click();
    await settle();
    deq((await ctx.NoSlop.host.getSettings()).blockedAccounts.reddit, ['botty']);
    assert.equal(action('t3_n2'), 'hide');
    assert.ok(stateOf('t3_n2').verdict.reasons.includes('account:block'));
    assert.equal(action('t3_n3'), 'none');
  });
  test('mode off unapplies everything; stop() restores the DOM', async () => {
    await boot(post('t3_m1', { flair: 'AI Art' }) + post('t3_m2', { title: 'Thoughts', body: SLOP, type: 'text' }));
    assert.equal(action('t3_m1'), 'hide'); assert.equal(action('t3_m2'), 'dim');
    await setMode('off');
    await settle();
    assert.equal(action('t3_m1'), 'none'); assert.equal(action('t3_m2'), 'none');
    assert.equal(ctx.document.querySelector('.noslop-stub, .noslop-badge'), null);
    await setMode('balanced');
    await settle();
    assert.equal(action('t3_m1'), 'hide');
    ctx.NoSlop.engine.stop();
    assert.equal(outer('t3_m1').getAttribute('data-noslop-id'), null);
    assert.ok(!outer('t3_m1').classList.contains('noslop-hidden'));
  });
  test('old.reddit.com end-to-end: promoted .thing hidden with hideAds, AI-flaired thing hidden, plain thing untouched', async () => {
    await boot(oldThing('t3_oa', { promoted: true }) + oldThing('t3_ob', { flair: 'AI Generated' }) + oldThing('t3_oc'), { url: 'https://old.reddit.com/r/pics/', settings: { surfaces: Object.assign({}, { hideAds: true }) } });
    assert.equal(action('t3_oa'), 'hide');
    assert.equal(action('t3_ob'), 'hide');
    assert.ok(outer('t3_ob').classList.contains('noslop-hidden--display-none'));
    assert.equal(action('t3_oc'), 'none');
  });
});
