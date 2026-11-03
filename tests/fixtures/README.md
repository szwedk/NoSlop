# tests/fixtures — real DOM captures for the NoSlop adapters

Owner: the **fixtures** agent. Captured **2026-11-02** (22:45–23:25 UTC) with the Claude Browser pane
(Chromium 152; UA `… Claude/4.4212.0 Chrome/152.0.7977.167 Safari/537.36`; mobile preset = Android 14 /
Pixel 8 Chrome 152 Mobile), **always logged out**, dark theme. Nothing here contains account data;
the only names are public channel handles / usernames on public posts and the advertiser names of
public ads.

Load them in tests with jsdom exactly as `tests/fixtures/fixtures.test.mjs` does
(`new JSDOM('<!doctype html><body>' + html)`), or via `tests/helpers/load.mjs` `{ html }`.
Run the fixture self-test with `cd /Users/kamilszwed/Projects/NoSlop && node --test tests/fixtures/fixtures.test.mjs`
(18 tests). Every `*.html` file begins with an HTML comment header giving the source URL, timestamp,
viewport, node count and what was stripped.

## Real vs synthetic

| Site | Status | Why |
|---|---|---|
| `youtube/` | **REAL** (21 html + `innertube-snippets.json`) | youtube.com works logged out. |
| `myoutube/` | **REAL** (9 html) | m.youtube.com, mobile preset. |
| `tiktok/` | **REAL** (3 html) | For You and Explore render behind a login modal; search is login-walled. |
| `reddit/` | **REAL server-rendered HTML** (4 html) | reddit.com is blocked in the Browser pane and the full page serves reCAPTCHA to curl; the feed-pagination endpoint `/svc/shreddit/community-more-posts/hot/?name=<sub>` returns the same `shreddit-post` light DOM with no challenge. |
| `x/`, `instagram/`, `facebook/`, `linkedin/` | **SYNTHETIC** (header says `*** SYNTHETIC ***`) + `notes.md` with what the logged-out page really shows. Besides the fixtures agent's `synthetic-feed.html` / `synthetic-timeline.html`, the adapter agents added: `x/synthetic-feed.html` (13 cells: plain, promoted, Made-with-AI text+icon, Grok share, quote of @grok, style slop, #AIart anchor, video, separator-only cell, Grok promo cell, self-disclosure, repost, post by @grok) and `x/synthetic-status.html` (focal tweet tabindex=-1 + two replies); `instagram/synthetic-reels.html`, `synthetic-explore.html`, `synthetic-mobile-feed.html` (the 3rd article of `synthetic-feed.html` deliberately has no /p/ link: the adapter's fallback id is `t:<handle>:<time datetime>`); `linkedin/synthetic-feed-labels.html` (its header documents every label hypothesis). A `synthetic-*.html` file is also allowed inside a REAL directory as long as it carries the SYNTHETIC marker (reddit keeps its synthetic markup inline in `tests/adapters/reddit.test.mjs`). | login walls; we did not log in. The synthetic files use only the code-verified selectors from `docs/research/platform-dom-and-ai-labels.md` §2.1/2.4/2.5/2.8; the AI-label placements inside them are explicitly marked as hypotheses. |

Capture method (real files): in the page, `node.cloneNode(true)`; remove `svg, style, script, iframe,
noscript, template, link`; drop `style`, `srcset`, `tabindex`, `draggable`, `spellcheck`, `nonce`,
`jsaction`, `jsname` attributes; replace `data:` / base64 / >1500-char attribute values with
`[stripped]`; drop comments and whitespace-only text nodes; collapse whitespace. Files are chunked
at 140 KB if needed (none needed it; largest is 80 KB). Reddit files were produced the same way from
the fetched HTML with jsdom.

## Headline findings (details + exact strings in each `notes.md`)

**YouTube is the only site with a verified platform AI label, and it is NOT on feed cards.**
* Watch page (desktop): `ytd-watch-metadata #title badge-shape[aria-label="AI: Content was made with AI"]`
  (`.ytBadgeShapeText` = `AI`, `role="img"`), plus `how-this-was-made-section-view-model` whose
  `.ytwHowThisWasMadeSectionViewModelBodyHeader` is **"Made with AI"** and body
  "Sounds or visuals were altered or fully generated. Learn more" (`youtube/watch-ai-labelled-*.html`).
* **Trap:** the same `how-this-was-made-section-view-model` / `howThisWasMadeSectionViewModel` JSON object
  is rendered for **"Auto-dubbed"** videos ("Audio tracks for some languages were automatically generated")
  — 10 of 27 surveyed watch pages. The bare key string also appears in a renderer-name list in some pages'
  ytcfg. Match `"bodyHeader":{"content":"Made with AI"}` or the badge `accessibilityData.label
  "AI: Content was made with AI"`, never the key alone (`youtube/innertube-snippets.json`,
  `youtube/watch-how-this-was-made.html` = the Auto-dubbed negative case).
* Some labelled videos have the section but **no title badge** (2 of 15) — description-tier labels.
* Shorts (desktop): `yt-reel-player-overlay-view-model yt-reel-carousel-view-model button[aria-label="AI: Content was made with AI"]`
  with text `AI` (`youtube/shorts-player-overlay-ai-labelled.html`).
* m.youtube.com watch: `ytm-slim-video-metadata-section-renderer .slim-video-information-inline-badge badge-shape[aria-label="AI"]`
  — note the mobile aria-label is just **"AI"**; the section appears only after tapping "more"
  (`myoutube/watch-ai-labelled-metadata.html`, `myoutube/watch-how-this-was-made.html`).
* Cards: 0 of ~90 cards (search `ytd-video-renderer`, home/related `yt-lockup-view-model`, Shorts
  `ytm-shorts-lockup-view-model`) showed an "AI" badge, including the cards of two labelled videos
  (`youtube/search-ai-labelled-card.html`, `youtube/search-ai-labelled-long-form-card.html`). Card badges seen:
  durations, `4K`, `New`, `LIVE`, `Sponsored`, `Fundraiser`, `YouTube featured`, `Earns commission`, `Auto-dubbed`
  (the `Auto-dubbed` one sits in `yt-content-metadata-view-model .ytContentMetadataViewModelBadge`, the slot a future
  card "AI" badge would use — `youtube/home-rich-item-auto-dubbed.html`). So card-level hiding needs the watch-HTML
  **enrich** path or the verdict cache; `rules.labels.youtube.badgeText:["AI"]` is a forward-compatible hook only.
* Structure changes vs the research tables: search Shorts shelf is `grid-shelf-view-model` (not
  `ytd-reel-shelf-renderer`); home Shorts shelf is `ytd-rich-shelf-renderer > … > ytd-rich-item-renderer > #content >
  ytm-shorts-lockup-view-model-v2`; `ytd-compact-video-renderer` is gone from #related (all `yt-lockup-view-model`);
  `.badge-shape-wiz__text` no longer exists (use `.ytBadgeShapeText`); ads are
  `ytd-ad-slot-renderer > #fulfilled-layout > ytd-in-feed-ad-layout-renderer > … > yt-lockup-view-model` with a
  `badge-shape.ytBadgeShapeAd` "Sponsored"; `/feed/trending` redirects to Home when logged out; m.youtube search and
  home Shorts shelves are `grid-shelf-view-model` (no `ytm-reel-shelf-renderer` seen).
* Video id is available without parsing hrefs: class `content-id-<videoId>` on `.ytLockupViewModelHost`.

**TikTok**: `article[data-e2e="recommend-list-item-container"]` is confirmed as the For You item (5 per
page) but in the 2026 "anchoring/cinema" layout it contains only the video; description/author/engagement
live in fixed overlays (`[data-e2e="anchoring-description-layer"]`, `[data-e2e="cinema-creator-identity"]`,
`[data-e2e="anchoring-engagement-vertical"]`). Explore cards are `div[data-e2e="explore-item"]`. **No AIGC
label element was observed** (`[data-e2e*="aigc"]` = 0) because the logged-out feed cannot be advanced;
exact label strings from the i18n bundle: **"Creator labeled as AI-generated"**
(`syntheticMedia_feed_bottomBanner_AIGCLabel`) and **"Contains AI-generated media"**
(`aigcInfoPanel_feed_label`). Item JSON keys: `IsAigc`, `aigcLabelType`, `AIGCDescription`, `ShowAIGC`
(`aigcLabelType:"2"` occurred on a non-AI item — pair with `IsAigc`). `moderationAigcLabelType` not seen.
Search requires login.

**Reddit**: no site-wide AI label; the only signal is the flair in
`shreddit-post > shreddit-post-flair[slot="post-flair"]` (e.g. `Image - ChatGPT`, `AI Showcase - Midjourney`,
`AI Video - Midjourney`). Posts are `article.w-full > shreddit-post[id^="t3_"]` with everything readable from
attributes (`post-title`, `permalink`, `author`, `subreddit-name`, `post-type`, `score`…); ads are
`faceplate-batch > shreddit-ad-post[promoted].promotedlink` (no `data-testid="ad-post"` in SSR HTML) with
`faceplate-screen-reader-content` "Advertisement: …".

**X / Instagram / Facebook / LinkedIn logged out**: X redirects to an onboarding dialog with zero
`[data-testid]` elements; Instagram is a login form (`main[role="main"]` absent on `/`, present but
article-less on `/explore/`); Facebook is a login form (`div[role="main"]` present, no `div[role="feed"]` /
`div[aria-posinset]` / `div[role="article"]`); LinkedIn `/feed` 302s to `/login` (`div[data-testid="mainFeed"]`
absent). Adapters must gate on the feed-root selectors and return no items otherwise — see each `notes.md`.

## Requests for other agents (also returned in the agent output)
* core (`rules.json` / scorer / engine): see the YouTube "Auto-dubbed" trap above — `labels.youtube.watchSection`
  presence must not score; require the "Made with AI" body header / badge aria-label. `autoDubExclude` should be
  the literal `Auto-dubbed` + "Audio tracks for some languages were automatically generated". Add the mobile
  aria-label `AI` and desktop `AI: Content was made with AI` to `labels.youtube`.
* youtube adapter: site selectors to update per the structure-changes bullet; Shorts overlay selector;
  use `content-id-*` for ids.
* tiktok adapter: items vs overlay split; treat `[data-e2e="aigc-tag"]` as unverified; text-match the two strings.
* reddit adapter: flair selector + `shreddit-ad-post[promoted]`.
* package.json / core: `node --test tests/` (a bare directory) fails on Node 26 ("Cannot find module …/tests");
  use a glob such as `node --test "tests/**/*.test.mjs"`.
