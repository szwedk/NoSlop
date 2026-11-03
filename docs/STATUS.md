# NoSlop — integration status (2026-11-02)

Owner: integration pass. This is the honest state of the codebase after merging every agent's work. Read with
`DESIGN.md` (the contract) and `research/platform-dom-and-ai-labels.md` (the selector evidence).

## 1. Verification bar — what ran green

| Step | Result |
|---|---|
| `npm test` (`node --test "tests/**/*.test.mjs"`) | **380 tests, 379 pass, 0 fail, 1 skipped** (the skip is `tests/build-chrome.test.mjs` "without popup the build refuses", intentionally skipped once popup/ landed) — re-run after the fixer pass (§6) |
| `npm run build:rules -- --check` | rules.js in sync with rules.json `2026-11-02.3` |
| `node --check` on every file under Extension/Resources | all parse |
| `npm run build:chrome` | dist/chrome built: 28 files copied, service worker `sw.js` importScripts background.js, 14 scripts polyfilled, `lib/tiktok-main.js` **not** polyfilled, web_accessible_resources kept, `nativeMessaging` dropped, `minimum_chrome_version: "121"` |
| `scripts/build-mac.sh` | **BUILD SUCCEEDED**, `codesign --verify --deep --strict` OK → build/NoSlop.app (Apple Development, team-prefixed App Group) |
| `node tools/check-bundle.mjs build/NoSlop.app` | OK: one appex, `Contents/PlugIns/NoSlop-Extension-macOS.appex/Contents/Resources/manifest.json` + 24 referenced files present and byte-identical to Extension/Resources; the app's `WebExtension` folder reference (Clean Feeds) checked the same way |
| `scripts/build-ios.sh` (signed, with App Group) | **still BLOCKED by Apple** (re-tried after the fixer pass): "PLA Update available … Account Holder KAMIL MAX SZWED must agree to the latest Program License Agreement" → the portal cannot issue a profile with App Groups. Accept it at https://developer.apple.com/account, then the script works unchanged. |
| `NOSLOP_NO_APP_GROUP=1 scripts/build-ios.sh` | **BUILD SUCCEEDED** → build/NoSlop-iOS.app + .ipa (sideload build, app↔extension settings sync OFF; the app now really falls back to its own UserDefaults, see §6); `check-bundle` OK (`PlugIns/NoSlop-Extension-iOS.appex`, 24 files) |
| `tests/bootstrap.test.mjs` | the full manifest content-script chain boots in jsdom on www.youtube.com, m.youtube.com, x.com, twitter.com, www.instagram.com, www.facebook.com, www.tiktok.com, www.reddit.com, www.linkedin.com with zero errors/warnings; popup messages answered; webview order (host-webview.js first) keeps the webview host; background.js runs in a window-less global; tiktok-main.js loads without `browser`/`chrome` |

`scripts/test.sh` runs all of the above in order (`NOSLOP_SKIP_IOS=1` skips the device build).

**Live smoke:** done after this pass on real www.youtube.com, m.youtube.com and tiktok.com pages (Browser pane, scripts injected into the page world, no extension install) and on the real reddit captures in jsdom; see `tests/live/REPORT.md`. It found and fixed one engine bug (stub built with innerHTML broke under YouTube's Trusted Types CSP). x.com / instagram.com / facebook.com / linkedin.com need a logged-in Safari session and are still unverified live. Expect card hides on youtube.com to appear a second or two after render (they come from the watch-HTML prefetch), not instantly.

## 2. What is VERIFIED against real DOM (captures in tests/fixtures, logged out, 2026-11-02)

* **YouTube desktop** (21 real captures + innertube JSON snippets): feed cards (`ytd-rich-item-renderer`,
  `ytd-video-renderer`, `yt-lockup-view-model`), Shorts shelves (`grid-shelf-view-model`, `ytd-rich-shelf-renderer`),
  ads (`ytd-ad-slot-renderer` + `.ytBadgeShapeAd` "Sponsored"), `content-id-<videoId>` classes, the watch-page AI
  badge `badge-shape[aria-label="AI: Content was made with AI"]`, the "How this was made" section with body header
  **"Made with AI"** vs the **"Auto-dubbed"** trap (10 of 27 surveyed watch pages render the same section for auto-dubbing;
  the bare `howThisWasMadeSectionViewModel` key also appears in a renderer-name list) — the enrich parser requires the
  object form + "Made with AI" / the AI help link / the badge label. Shorts overlay AI button verified.
* **m.youtube.com** (9 real captures): search/home/related item selectors, Shorts shelves, the watch badge whose
  aria-label is exactly **"AI"** (inside `ytm-slim-video-metadata-section-renderer`).
* **Card-level "AI" badges on YouTube feed cards: NOT observed** (0 of ~90 cards, including the cards of two labelled
  videos). Feed hiding therefore depends on the enrich (watch-HTML prefetch) path + the 7-day verdict cache.
* **TikTok** (3 real captures): `article[data-e2e="recommend-list-item-container"]` (video only), the overlay split
  (`anchoring-description-layer` / `cinema-creator-identity` / `anchoring-engagement-vertical`), `explore-item`,
  `xgwrapper-<n>-<videoId>` ids, SSR JSON keys `IsAigc` / `aigcLabelType` / `AIGCDescription` / `ShowAIGC`, the two
  i18n strings "Creator labeled as AI-generated" / "Contains AI-generated media".
* **Reddit** (4 real server-rendered captures): `shreddit-post[id^="t3_"]` attributes, `shreddit-post-flair[slot="post-flair"]`
  (the only AI signal: "Image - ChatGPT", "AI Showcase - Midjourney" …), `shreddit-ad-post[promoted].promotedlink`.
* **Pure logic**: scorer (tiers, caps, modes, critique context, style dim-only), golden corpus (227 AI / 250 human items:
  human hide = 0, dim ≤ 2 %; labelled/disclosed AI hide ≥ 95 %), engine (virtualized cell reuse, stubs, surfaces,
  enrich queue, cache persistence, auto-promotion, settings epoch), background (settings sync last-writer-wins, stats
  delta flush, fetch proxy restricted to https + youtube/tiktok + same-site), popup, host shims, Chrome build.

## 3. What is SYNTHETIC (hypotheses, clearly marked in the fixture headers)

* **X / Instagram / Facebook / LinkedIn**: every fixture under `tests/fixtures/{x,instagram,facebook,linkedin}` is
  `*** SYNTHETIC ***`. Logged-out pages show none of the feed roots (X onboarding dialog; Instagram/Facebook login
  forms; LinkedIn /feed → /login), so the adapters gate on the feed root and return `[]` otherwise. Structural
  selectors come from code-verified 2026 sources (control-panel-for-twitter, instagram-feed-blocker, "FB - Clean my
  feeds", better-linkedin); **the AI-label placements inside them are guesses**:
  * X "Made with AI" text + sparkle icon placement; Grok share link / quote / promo-cell handling is from Stevoisiak's
    list (code-verified selectors, unverified page behaviour).
  * Instagram "AI info" / "Imagined with AI" placement, `/explore/tags/` hashtag links, explore tiles, "Sponsored" line.
    Localized Meta strings are unknown: on a non-English UI the tier-0 path has **no recall** until the user adds the
    string via `settings.rulesOverride` (`{ labels: { instagram: { text: [...] } } }`, now a deep merge).
  * Facebook: message/comment/hashtag/reels-shelf selectors, "Visit Meta AI" promo cards, "AI-generated profile".
    Meta moved the label for AI-*edited* posts into the "…" menu (Sept 2024), so only inline (AI-generated) labels are caught.
  * LinkedIn: "Written by AI" / "Created with AI" / "AI-assisted" exact matches outside the body and the C2PA
    "Content credentials" button (scored 0.6 = dim, never 1.5). Keep flagged for a live check before shipping.
* **TikTok `[data-e2e="aigc-tag"]`** element: never observed (no labelled video reachable logged out); the adapter
  text-matches the verified strings and reads the JSON relay instead. `search-card-video` / `user-post-item` /
  `browse-*` / `photoLink` remain unverified. Search is login-walled.
* **Reddit old-reddit** (`data-fullname`, `.linkflairlabel`) and the "App" automated-account label: no capture.
  `shreddit-comment` has no verified selector → comments are not filtered.
* **YouTube `labels.youtube.badgeText: ["AI"]`** on cards: forward-compatible hook only (see §2).

## 4. Cross-agent requests applied in this pass

* rules.json `2026-11-02.2`: every adapter FALLBACK merged (youtube desktop/mobile incl. `shortsItems`, `channelName`,
  `badgeAria`, `watch*`, `howThisWasMadeHeader`; x `focalTweet` / `quoteMarker(Text)` / `grokProfileLink` / `handleLink` /
  `grokPromoCell` / `aiLabelSvgPath` alias; instagram `hashtagLink` / `tile` / `sponsoredText`; facebook
  `virtualizedPlaceholder` / `message` / `comment` / `imageMedia` / `hashtagLink` / `reelsShelf` / `metaAiHeaderText` /
  `profileLabelText` + label "AI-generated profile"; tiktok all verified keys + label text / jsonKeys; reddit attrs /
  slots / oldReddit; linkedin `promotedNew` / localized promoted words / `authorSlugRegex` / `urnAttrs` / `permalink` /
  actor + see-more selectors, "Content credentials" removed from `labels.linkedin.text`). `labels.youtube.watchHtmlRegex`
  now requires the "Made with AI" body header or the badge label; `autoDubExclude` carries the verified "Auto-dubbed"
  strings; `watchHelpLinks` added. `accounts.reddit.score = 0.9` → seed-subreddit posts **hide in strict, dim in balanced**
  (scorer prefers the per-site score for `account:subreddit`).
* Settings (host-extension.js, background.js, Settings.swift, DESIGN §6): `surfaces.hideRedditRecommended`,
  `reelsAutoAdvance`, `tiktokJsonRelay`, `sites.reddit.flagAppAccounts` (opt-in) — exposed in the popup and the Sites tab.
* Engine: popup messages `getRecentHidden` / `showItem` (+ `invalidate`, `noslopStatus`) via `runtime.onMessage` in the
  content script; `NoSlop.engine.invalidate(id)`; `extract(el, ctx)` receives `{settings, rules, surface, site}`; verdict
  cache entries remember the surface they were scored on (fixes the reddit "stays hidden after navigating into /r/<sub>"
  staleness); `rulesOverride` is a deep merge over the bundled rules (a partial override no longer wipes everything;
  `null` removes a section).
* manifest.json: `web_accessible_resources` for `lib/tiktok-main.js` on `*://*.tiktok.com/*`; the Chrome build never
  polyfills that page-world file.
* content.css: youtube watch-banner host polish. `.gitignore`: `dist/`. `scripts/build-mac.sh`: a failed xcodebuild
  now fails the script (it used to copy and "sign OK" a stale product). `scripts/test.sh`: full bar incl. rules check,
  node --check, Chrome build and `tools/check-bundle.mjs`.
* project.yml / Info.plist: `noslop://` URL scheme on both app targets; `NoSlopApp` handles `noslop://open`
  (reload + bring forward). popup footer link works on Safari only; the Chrome build hides it.
* fixtures self-test allows `synthetic-*.html` inside REAL directories; README/notes list the adapter-owned synthetic files.

## 5. Known gaps / decisions still open

1. **iOS signed build with App Groups** is blocked until the Apple PLA is accepted (account holder action). The
   sideload build works but app↔extension settings sync is off there.
2. **Live smoke in Safari with the extension installed** is still outstanding (the page-world smoke in `tests/live/REPORT.md` covered
   youtube.com, m.youtube.com, tiktok.com logged out and the reddit captures). First Safari run should check: x.com "Made with AI"
   placement, instagram.com `AI info` placement, tiktok.com relay injection (`<script data-noslop-tiktok-main>` 200 vs 404),
   reddit.com flair hides, and that Safari's isolated world is not subject to the page's Trusted Types policy.
3. **Instagram localized label strings**: the requested editable "Instagram AI label text" list UI is not built; the
   mechanism exists (`settings.rulesOverride.labels.instagram.text`, deep-merged) and the app's Lists tab could expose it.
4. **X**: posts BY @grok are seed-blocked (`accounts.x.block`) even when `surfaces.hideGrokPosts` is off (test asserts
   this); X `/status/` pages map to surface `'watch'` (`item.extra.page = 'status'`) because `'status'` is not in the
   surface union.
5. **Engine `stubLabel` option** (youtube asked for it to drop a microtask retitle): not added; the adapter's microtask
   works.
6. **Facebook `extract()` reads `NoSlop.engine.settings`** for `hideAds` gating (ctx now also carries settings; the
   adapter was not changed to use it yet).
7. **Reddit comments** (`shreddit-comment`) and the "App" account label need captures before they can be verified.
8. **TikTok**: a logged-in For You capture of an AIGC-labelled video + one `/api/recommend/item_list` response would
   replace the last two hypotheses (`aigc-tag` element placement, banner position).
9. Chrome: `activeTab` was not added; `tabs.query` returns `url` for `host_permissions` hosts. Add it only if Safari iOS
   testing shows `tab.url` undefined in the popup.

## 6. Adversarial review — fixes applied (fixer pass, 2026-11-02)

Three review tracks (correctness under virtualization, false-positive risk, Safari/iOS compatibility) produced 31 findings;
every blocker and major is fixed, the minors too. What changed, by file:

**`lib/engine.js`**
* SPA navigation is now detected world-independently: `location.href` is compared at the top of every flush (route changes
  come with mutation storms) and on every sweep tick, plus the Navigation API `currententrychange` where it exists. The
  content-script `history.pushState` patch never fires in production (isolated worlds) and is kept only as a harmless extra.
  Test: `engine.test.mjs` "SPA navigation WITHOUT the history patch".
* A FAILED enrich (timeout / 429 / background asleep / host refused) is no longer cached as a 7-day negative: `enriched`
  stays false, nothing is persisted, the id is retried after a doubling backoff (60 s, max 3 attempts per page life);
  `youtube.enrich()` rethrows fetch errors and returns `null` only after a successful parse.
* Persistence: only labels / hashtags / author / extra and a 300-char text snippet are written (never the 2000-char
  description), at most 1000 newest rows per site, 12 s debounce + flush on `pagehide` / `visibilitychange`,
  read-merge-write so tabs no longer clobber each other's `verdicts:<site>` key, and a rejected `storageSet` halves the
  row cap instead of silently disabling persistence. `manifest.json` requests `unlimitedStorage` (Safari 5 MB / Chrome 10 MB
  quotas without it; the Chrome build keeps it).
* `applySurfaces()` runs once per flush / sweep (not once per mutation root: measured 60× per flush before); youtube
  memoizes its surface selector list per rules object.
* `extract()` may return `undefined` = "not ready" (facebook virtualizer placeholder, x cell without its permalink, tiktok
  recycled slot): the engine keeps the applied state instead of restoring a hidden unit to a blank hole. `null` still means
  "not an item" and unapplies.
* Surfaces carry an optional `strategy`: facebook's `hideReels` shelf (an `aria-posinset` unit) is collapsed with
  `height:0;overflow:hidden` instead of display:none (`.noslop-surface--height-zero`).
* `adapter.stubPlacement(el,item)` -> `'before'`: a bare reddit `shreddit-post` / `shreddit-ad-post` (shadow host) is hidden
  as a whole (`.noslop-hidden--host`) with the stub as its previous sibling; orphan sibling stubs are pruned.
* The global switch and `sites.<site>.mode = 'off'` are honoured by the engine itself: no surface hides and no enrich
  fetches while inactive (before: a disabled extension still hid Shorts/Reels/Grok cells and prefetched ~1.3 MB of watch
  HTML per YouTube page).
* Auto-promotion needs a stable identifier (`author.handle || author.id`): a display name alone ("Relaxing Music") is never
  written to `blockedAccounts`; `label:reddit_flair` (a per-sub convention) never promotes.
* Bookkeeping: `E.counted` and `E.authorHits` are evicted with the cache LRU (authors LRU 2000, 10 ids each); a verdict
  that becomes `none` leaves the popup's "Hidden on this tab" ring; surface stats are counted once per (element,
  setting); `dom.stopMedia()` returns the previous `{muted, paused}` and "Show" restores `muted` (never auto-plays).
* The safety sweep is 2.5 s, skipped while `document.hidden`, and runs a full `findItems`/`extract` pass only when a
  mutation was observed since the last sweep or the URL changed; otherwise it only re-checks what is applied.

**`content.css`** — `.noslop-dim { position: relative }` lost its `!important`: X positions `cellInnerDiv` cells
absolutely (inline `transform: translateY`), and forcing them into flow stacked two or more dimmed tweets over the tweets
below them. **Not yet verified on a live X timeline** (no browser session on x.com in this swarm) — first live check item.

**`lib/scorer.js` + `rules.json` (2026-11-02.3)** — false-positive fixes, all measured against the golden set (human hide 0
in both modes, dim ≤ 2 %, every AI category ≥ 95 %; residue 25/26 after two corpus items got a second residue cue):
* Hashtags are extracted after stripping URLs (`https://site/page#aiart` is a fragment, not a self-label) in both
  `scorer.extractHashtags` and `dom.hashtags`.
* A new `mention` pool (cap 0.6 = the balanced dim threshold) holds the mention-level disclosure entries (`weak: true`:
  ai_media_noun, generative_ai, text_to_x), weak hashtags (still capped at 0.4 first) and a SINGLE tool family: three
  mentions dim at most; two or more tool families stay under `tool` (cap 1.0 — DESIGN §3 updated from 0.8, the corpus
  'tool' category was built on it).
* Narrow critique negators appended (nonsense / stolen / i think / pretty sure / seems like / lmao / "fall for it",
  "<ai tool>?" and "right?" questions, "it was not", "at work / for the demo"); `real photos` plural; the broad ones the
  review warned against (never / please stop / i made this) were NOT added.
* `#sora` is weak (Kingdom Hearts / Japanese sky); `#sora2`, `#openaisora` stay strong. `whisk` counts only as
  "google whisk" / "whisk ai".
* Reddit: bare `"AI"` removed from `labels.reddit.flairText` (a topic flair on r/Futurology-style subs); the seed-subreddit
  rule follows its source: `accounts.reddit.appliesTo = ['popular']` (adapter surface for /r/popular and /r/all) plus
  `recommendation-source` posts on any surface — a subscriber's own r/MachineLearning posts on "/" are left alone.
* `c2paScore` 0.5 and tier 3 (Content Credentials usually mean a real camera): none in balanced, dim in strict, never
  persisted, never promotes.
* Chatbot residue: `would you like me to` requires an assistant verb, `great question!` lives only in the 0.5 opener,
  `i hope this message finds you well` / `as_requested` / `hope_this_helps` are 0.6 (conversational; the three golden-set
  items that relied on them now carry a second cue). Prompt metadata: sampler / cfg_scale / seed / denoise 0.6, steps 0.4
  ("Beer sampler: 4 for $12" dims, every corpus dump has ≥ 2 fields).
* `settings.customPhrases` compile through `termsRegex` (whole words, cached per array): "ai" no longer hides "said".

**Adapters** — x.js: "Made with AI" text / sparkle icon are matched outside the quoted block; a label only on the quoted
post is `x_ai_quote`, gated on `hideGrokPosts` like `x_grok_quote` (a human calling out a fake is no longer hidden or
auto-blocked). youtube.js: the `metadataBadgeRenderer` scan stops at `"secondaryResults"` / `"watchNextEndScreenRenderer"`
so a future card badge on a RELATED video is never attributed to the fetched one; the prefetch URL carries `&app=desktop`
(an iPhone UA is otherwise 302'd to m.youtube.com, whose HTML has no label JSON). reddit.js: surface `'popular'`,
`stubPlacement`. facebook.js / tiktok.js: "not ready" -> `undefined`.

**Swift / background** — `NoSlopSharedStore.defaults` probes the App Group entitlement on iOS
(`containerURL(forSecurityApplicationGroupIdentifier:)`) before using the suite: the sideload build used to get a live
`UserDefaults` whose writes cfprefsd dropped, so settings reset on every launch. `FeedHost.fetchText` always sends a Mac
Safari UA (host-webview.js no longer forwards the iPhone UA). `background.js` pulls shared settings on the minute alarm
before flushing stats, so a mode / list change made in the Mac app reaches open Safari tabs within a minute.

**Still open from this pass:** live verification on x.com (two adjacent dimmed tweets after the `position` change) and an
iPhone-UA curl of `watch?v=<id>&app=desktop` confirming `howThisWasMadeSectionViewModel` in the response (the fixture for
that regression is synthetic until then); `tests/live/REPORT.md` predates these fixes.
