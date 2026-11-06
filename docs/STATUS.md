# NoSlop status

Read with `DESIGN.md` (the contract) and `research/platform-dom-and-ai-labels.md` (the selector evidence).

## 1. Verification

| Step | Result |
|---|---|
| `npm test` (`node --test "tests/**/*.test.mjs"`) | 380 tests, 379 pass, 0 fail, 1 skipped (`tests/build-chrome.test.mjs` "without popup the build refuses", skipped on purpose since popup/ exists) |
| `npm run build:rules -- --check` | rules.js in sync with rules.json `2026-11-02.3` |
| `node --check` on every file under Extension/Resources | all parse |
| `npm run build:chrome` | dist/chrome built: 28 files copied, service worker `sw.js` importScripts background.js, 14 scripts polyfilled, `lib/tiktok-main.js` not polyfilled, web_accessible_resources kept, `nativeMessaging` dropped, `minimum_chrome_version: "121"` |
| `scripts/build-mac.sh` | BUILD SUCCEEDED, `codesign --verify --deep --strict` OK, build/NoSlop.app (Apple Development, team-prefixed App Group) |
| `node tools/check-bundle.mjs build/NoSlop.app` | OK: one appex, `Contents/PlugIns/NoSlop-Extension-macOS.appex/Contents/Resources/manifest.json` + 24 referenced files present and byte-identical to Extension/Resources; the app's `WebExtension` folder reference checked the same way |
| `scripts/build-ios.sh` (signed, with App Group) | BLOCKED by Apple: the portal refuses to issue a profile with App Groups until the account holder accepts the latest Program License Agreement at https://developer.apple.com/account. After that the script works unchanged. |
| `NOSLOP_NO_APP_GROUP=1 scripts/build-ios.sh` | BUILD SUCCEEDED, build/NoSlop-iOS.app + .ipa (sideload build, app/extension settings sync OFF, the app falls back to its own UserDefaults); `check-bundle` OK (`PlugIns/NoSlop-Extension-iOS.appex`, 24 files) |
| `tests/bootstrap.test.mjs` | the full manifest content-script chain boots in jsdom on www.youtube.com, m.youtube.com, x.com, twitter.com, www.instagram.com, www.facebook.com, www.tiktok.com, www.reddit.com, www.linkedin.com with zero errors/warnings; popup messages answered; webview order (host-webview.js first) keeps the webview host; background.js runs in a window-less global; tiktok-main.js loads without `browser`/`chrome` |

`scripts/test.sh` runs all of the above in order (`NOSLOP_SKIP_IOS=1` skips the device build).

Live smoke (`tests/live/REPORT.md`): real www.youtube.com, m.youtube.com and tiktok.com pages, logged out, scripts injected
into the page world by a CDP-driven headless Chromium (no extension install), plus the real reddit captures in jsdom. It
found one engine bug, since fixed (an innerHTML-built stub broke under YouTube's Trusted Types CSP); the report predates the
changes in section 4. x.com / instagram.com / facebook.com / linkedin.com need a logged-in session and are unverified live.
Card hides on youtube.com come from the watch-HTML prefetch and appear a second or two after render.

## 2. Verified against real DOM (captures in tests/fixtures, logged out, 2026-11-02)

* YouTube desktop (21 captures + innertube JSON snippets): feed cards (`ytd-rich-item-renderer`, `ytd-video-renderer`,
  `yt-lockup-view-model`), Shorts shelves (`grid-shelf-view-model`, `ytd-rich-shelf-renderer`), ads (`ytd-ad-slot-renderer`
  + `.ytBadgeShapeAd` "Sponsored"), `content-id-<videoId>` classes, the watch-page AI badge
  `badge-shape[aria-label="AI: Content was made with AI"]`, the "How this was made" section with body header "Made with AI"
  vs the "Auto-dubbed" trap (10 of 27 surveyed watch pages render the same section for auto-dubbing; the bare
  `howThisWasMadeSectionViewModel` key also appears in a renderer-name list). The enrich parser requires the object form plus
  "Made with AI" / the AI help link / the badge label. Shorts overlay AI button verified.
* m.youtube.com (9 captures): search/home/related item selectors, Shorts shelves, the watch badge whose aria-label is exactly
  "AI" (inside `ytm-slim-video-metadata-section-renderer`).
* Card-level "AI" badges on YouTube feed cards: not observed (0 of ~90 cards, including the cards of two labelled videos).
  Feed hiding therefore depends on the enrich (watch-HTML prefetch) path plus the 7-day verdict cache.
* TikTok (3 captures): `article[data-e2e="recommend-list-item-container"]` (video only), the overlay split
  (`anchoring-description-layer` / `cinema-creator-identity` / `anchoring-engagement-vertical`), `explore-item`,
  `xgwrapper-<n>-<videoId>` ids, SSR JSON keys `IsAigc` / `aigcLabelType` / `AIGCDescription` / `ShowAIGC`, the two i18n
  strings "Creator labeled as AI-generated" / "Contains AI-generated media".
* Reddit (4 server-rendered captures): `shreddit-post[id^="t3_"]` attributes, `shreddit-post-flair[slot="post-flair"]` (the
  only AI signal: "Image - ChatGPT", "AI Showcase - Midjourney" ...), `shreddit-ad-post[promoted].promotedlink`.
* Pure logic: scorer (tiers, caps, modes, critique context, style dim-only), golden corpus (227 AI / 250 human items: human
  hide = 0, dim <= 2 %; labelled/disclosed AI hide >= 95 %), engine (virtualized cell reuse, stubs, surfaces, enrich queue,
  cache persistence, auto-promotion, settings epoch), background (settings sync last-writer-wins, stats delta flush, fetch
  proxy limited to https + youtube/tiktok + same-site), popup, host shims, Chrome build.

## 3. Hypotheses not yet verified live

* X / Instagram / Facebook / LinkedIn: every fixture under `tests/fixtures/{x,instagram,facebook,linkedin}` is
  `*** SYNTHETIC ***`. Logged-out pages show none of the feed roots (X onboarding dialog; Instagram/Facebook login forms;
  LinkedIn /feed redirects to /login), so the adapters gate on the feed root and return `[]` otherwise. Structural selectors
  come from code-verified 2026 sources (control-panel-for-twitter, instagram-feed-blocker, "FB - Clean my feeds",
  better-linkedin); the AI-label placements inside them are guesses:
  * X "Made with AI" text + sparkle icon placement; Grok share link / quote / promo-cell handling is from Stevoisiak's
    list (code-verified selectors, unverified page behaviour).
  * Instagram "AI info" / "Imagined with AI" placement, `/explore/tags/` hashtag links, explore tiles, "Sponsored" line.
    Localized Meta strings are unknown: on a non-English UI the tier-0 path has no recall until the user adds the string via
    `settings.rulesOverride` (`{ labels: { instagram: { text: [...] } } }`, a deep merge).
  * Facebook: message/comment/hashtag/reels-shelf selectors, "Visit Meta AI" promo cards, "AI-generated profile". Meta
    moved the label for AI-edited posts into the "..." menu (Sept 2024), so only inline (AI-generated) labels are caught.
  * LinkedIn: "Written by AI" / "Created with AI" / "AI-assisted" exact matches outside the body and the C2PA "Content
    credentials" button (scored 0.6 = dim, never 1.5). Needs a live check before shipping.
* TikTok `[data-e2e="aigc-tag"]` element: never observed (no labelled video reachable logged out); the adapter text-matches
  the verified strings and reads the JSON relay instead. `search-card-video` / `user-post-item` / `browse-*` / `photoLink`
  remain unverified. Search is login-walled.
* Reddit old-reddit (`data-fullname`, `.linkflairlabel`) and the "App" automated-account label: no capture.
  `shreddit-comment` has no verified selector, so comments are not filtered.
* YouTube `labels.youtube.badgeText: ["AI"]` on cards: forward-compatible hook only (section 2).

## 4. Known gaps and open decisions

Open items:

1. iOS signed build with App Groups is blocked until the Apple PLA is accepted (account holder action). The sideload build
   works but app/extension settings sync is off there.
2. Live smoke in Safari with the extension installed is outstanding. First run should check: x.com "Made with AI" placement
   and two adjacent dimmed tweets (`.noslop-dim { position: relative }` has no `!important` because X positions
   `cellInnerDiv` cells absolutely with inline `transform: translateY`, and forcing them into flow stacked dimmed tweets
   over the ones below), instagram.com "AI info" placement, tiktok.com relay injection (`<script data-noslop-tiktok-main>`
   200 vs 404), reddit.com flair hides, and that Safari's isolated world is not subject to the page's Trusted Types policy.
3. An iPhone-UA fetch of `watch?v=<id>&app=desktop` has not been captured; the fixture asserting
   `howThisWasMadeSectionViewModel` in that response is synthetic until then.
4. Instagram localized label strings: the mechanism exists (`settings.rulesOverride.labels.instagram.text`, deep-merged) but
   no editable list UI exposes it; the app's Lists tab could.
5. X: posts by @grok are seed-blocked (`accounts.x.block`) even when `surfaces.hideGrokPosts` is off (a test asserts this);
   X `/status/` pages map to surface `'watch'` (`item.extra.page = 'status'`) because `'status'` is not in the surface union.
6. Engine `stubLabel` option: not added; the youtube adapter retitles the stub in a microtask instead. Facebook
   `extract()` reads `NoSlop.engine.settings` for `hideAds` gating instead of the `ctx.settings` it receives.
7. Reddit comments (`shreddit-comment`) and the "App" account label need captures. TikTok needs a logged-in For You capture
   of an AIGC-labelled video plus one `/api/recommend/item_list` response (`aigc-tag` placement, banner position).
8. Chrome: `activeTab` is not requested; `tabs.query` returns `url` for `host_permissions` hosts. Add it only if Safari iOS
   shows `tab.url` undefined in the popup.

Current behaviour:

* SPA navigation is detected by comparing `location.href` at every flush and sweep tick, plus the Navigation API
  `currententrychange` where it exists; content scripts run in an isolated world, so the `history.pushState` patch never
  fires in production.
* A failed enrich (timeout / 429 / background asleep / host refused) is never cached: nothing is persisted and the id is
  retried after a doubling backoff (60 s, max 3 attempts per page life). `youtube.enrich()` rethrows fetch errors and
  returns `null` only after a successful parse. The prefetch URL carries `&app=desktop` (an iPhone UA is otherwise 302'd to
  m.youtube.com, whose HTML has no label JSON); the `metadataBadgeRenderer` scan stops at `"secondaryResults"` /
  `"watchNextEndScreenRenderer"` so a badge on a related video is never attributed to the fetched one.
* Verdict persistence writes only labels / hashtags / author / extra and a 300-char snippet, at most 1000 newest rows per
  site, 12 s debounce plus flush on `pagehide` / `visibilitychange`, read-merge-write across tabs; a rejected `storageSet`
  halves the row cap. `manifest.json` requests `unlimitedStorage`. Cache entries remember the surface they were scored on.
* `applySurfaces()` runs once per flush / sweep. The safety sweep is 2.5 s, skipped while `document.hidden`, and runs a
  full `findItems`/`extract` pass only after a mutation or URL change. `extract(el, ctx)` receives `{settings, rules,
  surface, site}`; `undefined` means "not ready" (virtualizer placeholder, recycled slot) and keeps the applied state;
  `null` means "not an item".
* Surface `strategy`: facebook's `hideReels` shelf collapses with `height:0;overflow:hidden`. `stubPlacement -> 'before'`
  hides a bare reddit `shreddit-post` / `shreddit-ad-post` shadow host whole (`.noslop-hidden--host`).
* The global switch and `sites.<site>.mode = 'off'` stop surface hides and enrich fetches entirely. Auto-promotion needs
  `author.handle || author.id`; a display name alone never reaches `blockedAccounts`; `label:reddit_flair` never
  promotes. "Show" restores the previous `muted` state and never auto-plays.
* Scorer (golden set: human hide 0 in both modes, dim <= 2 %, every AI category >= 95 %): hashtags are extracted after
  stripping URLs; a `mention` pool (cap 0.6) holds weak disclosure entries, weak hashtags and a single tool family, two or
  more tool families count under `tool` (cap 1.0); `#sora` is weak, `#sora2` / `#openaisora` strong; `whisk` counts only as
  "google whisk" / "whisk ai"; `c2paScore` 0.5 at tier 3 (none in balanced, dim in strict, never persisted, never
  promotes); prompt metadata sampler / cfg_scale / seed / denoise 0.6, steps 0.4; `settings.customPhrases` match whole words.
* Reddit: bare "AI" is not a flair label; `accounts.reddit.score = 0.9` with `appliesTo = ['popular']` plus
  `recommendation-source` posts, so seed-subreddit posts hide in strict and dim in balanced while a subscriber's own feed
  is left alone.
* X: a "Made with AI" label only on the quoted post is `x_ai_quote`, gated on `hideGrokPosts`, so a human calling out a
  fake is not hidden or auto-blocked.
* Settings: `surfaces.hideRedditRecommended`, `reelsAutoAdvance`, `tiktokJsonRelay`, `sites.reddit.flagAppAccounts`
  (opt-in); `rulesOverride` is a deep merge (`null` removes a section). Popup messages `getRecentHidden` / `showItem` /
  `invalidate` / `noslopStatus` go through `runtime.onMessage`. `background.js` pulls shared settings on the minute alarm.
* Swift: `NoSlopSharedStore.defaults` probes the App Group entitlement on iOS before using the suite (otherwise cfprefsd
  drops the writes). `FeedHost.fetchText` always sends a Mac Safari UA. Both app targets register `noslop://`;
  `noslop://open` reloads and brings the app forward. The popup footer link is Safari only; the Chrome build hides it.
  `web_accessible_resources` lists `lib/tiktok-main.js` on `*://*.tiktok.com/*`; the Chrome build never polyfills it.
