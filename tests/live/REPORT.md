# NoSlop live smoke — real pages, no extension install (2026-11-02)

Evidence for DESIGN.md §10 "live smoke". Everything below ran in a CDP-driven Chromium with the REAL content-script
chain evaluated in the page world; nothing was installed.

## 0. Summary

| Page | Result |
|---|---|
| www.youtube.com `/results?search_query=made+with+veo+3+ai+generated` (desktop DOM, 800 px viewport) | **32 processed · 18 hidden · 6 dimmed · 8 untouched**, 18 stubs rendered, 17/17 watch-HTML prefetches 200, **4 real tier-0 label hits**, 0 errors |
| www.youtube.com `sora 2 ai video` reached by YouTube's own **SPA navigation** (search box, no reload) | engine survived pushState, re-read surface, **32 processed · 15 hidden · 8 dimmed**, 34/34 prefetches, 3+1 tier-0 hits, 0 errors; popup messages (`noslopStatus` → hidden 45, `getRecentHidden`) answered |
| m.youtube.com same query, `resize_window` mobile preset (375×812, Android UA) | ytm-* DOM, **28 processed · 15 hidden · 10 dimmed · 3 untouched**, 15 stubs, 0 unprocessed cards, 0 errors; prefetch had to be rewritten to m.youtube.com (harness-only) and those pages carry **no label JSON** |
| www.reddit.com/r/aiArt/ | **NOT reachable: the harness browser refused reddit.com.** Substitute: the same live bundle run in jsdom on the 4 REAL server-rendered captures → subreddit-based verdicts confirmed (§4) |
| www.tiktok.com/explore (logged out) | renders behind a login modal; **8 explore cards processed, 0 hidden, 0 dimmed, 0 errors**; ids/authors/captions/hashtags extracted; no AIGC label element or string on the page; SSR seed found 0 items with AIGC keys |

**One real bug found and fixed** (minimal, in the responsible file): `lib/engine.js` built the hidden-item stub with
`innerHTML`; youtube.com (www and m) ships `Content-Security-Policy: require-trusted-types-for 'script'`, so the very
first hide threw `Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment`,
the promise chain in `start()` rejected ("[NoSlop] engine failed to start") and every subsequent sweep re-threw on the same
cards (hide verdicts existed, nothing was ever applied: processed 1, hidden 0). `makeStub` now builds the same DOM with
`createElement`/`textContent`; 360 tests still green (359 pass, 1 intentional skip). Whether Chrome/WebKit enforce the
page's Trusted Types policy inside an extension's isolated world is unverified — the fix removes the dependency either way.

## 1. Harness: `tools/live-inject.mjs`

`node tools/live-inject.mjs [--serve 8765]` concatenates, in `manifest.json` content_scripts order,
`rules.js, lib/dom.js, lib/scorer.js, lib/host-extension.js, <STUB HOST>, lib/engine.js, adapters/youtube.js … adapters/linkedin.js, content.js`
plus `content.css` as a `<style data-noslop-live-css>`, a preamble that records `error`/`unhandledrejection`/`console.warn`
mentioning NoSlop into `NoSlop.live.errors`, and a collector `NoSlop.live.collect()` → `$TMPDIR/noslop-live.js`
(312 KB, syntax-checked with `new Function`) + four `noslop-live.part-NN.js` chunks (whole scripts, never split).

STUB HOST = DESIGN §6 surface, in memory: `defaultSettings()` with `youtubePrefetch: true`, `fetchText` = `window.fetch`
with `credentials: 'same-origin'`, `__fetchLog[]` (url, status, bytes, ms, rewritten, error), `__reports[]` for stats.
Harness-only workaround: a cross-origin same-site URL (m.youtube.com asking for https://www.youtube.com/watch?v=…) is
retried with the host rewritten to `location.host` and logged as `rewritten`; the real extension fetches through
background.js and never hits CORS.

### 1.1 Getting 320 KB into a real page (what did NOT work, so nobody repeats it)

| Transport | Outcome |
|---|---|
| `fetch('http://127.0.0.1:8765/noslop-live.js')` from youtube.com | **Failed to fetch** even with CORS `*` and the Private-Network-Access preflight answered (`Access-Control-Allow-Private-Network: true`): Chrome's Local Network Access gate has no prompt in the harness |
| `<iframe src="http://127.0.0.1:8765/relay.html">` + `postMessage` | iframe renders blank (same LNA gate on subframes) |
| `window.open(relay)` from a real click, relay posts to `window.opener` | the harness turns popups into a **same-tab navigation** (no opener; the YouTube tab was replaced) |
| system clipboard (`pbcopy`) + `cmd+v` into a textarea; `navigator.clipboard.readText()` | key event carries no paste command; `clipboard-read` permission is `denied` |
| bare `eval(src)` on youtube.com | `EvalError: … violates this document's Trusted Type assignment requirements` |
| **URL fragment (WORKS)**: `navigate` to `http://127.0.0.1:8765/relay.html?mode=hash&target=<url>`; the relay forwards the tab to `<url>#noslop=<url-safe base64 of the bundle>` (427 KB fragment, never sent to the server); in the page: decode `location.hash` — or `performance.getEntriesByType('navigation')[0].name` when the SPA already rewrote the URL (m.youtube.com does) — and `eval` through `trustedTypes.createPolicy('noslop-live-…', {createScript: s => s})` (youtube's CSP names no `trusted-types` allow-list, so creating a policy is permitted) | used for every page below (`hashUrl()` / `hashEvalSnippet()` in the tool) |

## 2. www.youtube.com — desktop DOM

### 2.1 Query 1 `made with veo 3 ai generated` (fresh document, hash transport)

* Engine: `site youtube`, `surface search`, running; 32 elements carry `data-noslop-id` (kinds: short 15, video 16, ad 1).
* **hidden 18 · dimmed 6 · none 8 · stubs 18**; `surfacesHidden 0` (hideShorts off); verdict cache 32.
* Prefetch (enrich): 17 fetches of `https://www.youtube.com/watch?v=<id>`, all HTTP 200, ~1.17–1.34 MB each, 577–1377 ms,
  concurrency 2 (`youtubePrefetchConcurrency`), queue drained within the 8 s wait. Card verdicts that depend on the
  watch HTML (labels, description hashtags, owner handle) arrived 1–3 s after render, as DESIGN §10 predicts.
* **Tier-0 hits from the watch HTML (`label:youtube_watch` + `label:youtube_badge`, 4 videos)**:
  "Kling AI 2.6 vs Veo 3.1: Which Looks Real?" (@CreativeAIAds), "How to create VIRAL AI Vlog videos with Google VEO 3"
  (@MoeLueker), "Kling AI 4.0 Tutorial | How to Make Cinematic AI Videos" (@FILMCRUX), "3-Step Workflow To Make
  Ultra-Realistic AI Ads" (@HiggsfieldAI). The parser's object-form + "Made with AI" body-header requirement held: no
  auto-dub false hit was seen (none of the 17 pages was auto-dubbed).
* Reasons histogram (all verdicts): tool:veo 19, disclosure:ai_media_noun 15, hashtag:#veo3 10, context:critique 10,
  hashtag:#aivideo 6, tool:sora 5, disclosure:ai_generated 4, disclosure:verb_with_tool 4, tool:kling 4,
  label:youtube_badge 4, label:youtube_watch 4, hashtag:#ai 3, disclosure:text_to_x 3, disclosure:ai_made 2,
  hashtag:#artificialintelligence 2, hashtag:#klingai 2, hashtag:#sora2 2, tool:seedance 2, (1 each) disclosure:fully_ai,
  disclosure:prompt_in_comments, hashtag:#aishorts, hashtag:#aitools, hashtag:#chatgpt, hashtag:#kling, hashtag:#openai,
  style:emoji_bullets, style:engagement_bait, style:markdown_leak, tool:hailuo, tool:wan.
* Hidden titles (score): A.I. Has Officially Gone Too Far | Google Veo 3 is INSANE (1.8, @EditedByGeo) · AI image to video
  test with Kling, Filmora vs Veo 3 (1.085) · Sora 2 vs Veo 3 – Gymnast Example (1.785, @TechTutorZones) · Kling AI 2.6 vs
  Veo 3.1: Which Looks Real? (4.71, label) · Google VEO 3 vs Kling vs Sora Showdown (1.085) · Veo 3.1 Vs Sora 2: Which One
  is the Best AI Video Generator? (1.505, @TenorshareOfficial) · AI Recreates GTA 6 from Screenshot (1.4) · AI video made
  with google veo 3. (1.4) · AI Generated Video just lived up with Sound (3.0) · Epic Fight Scenes Created with Google Veo 3
  (1.4) · How to create VIRAL AI Vlog videos with Google VEO 3 (1.9, label) · The BEST 3D Animation from Veo 3 (1.3,
  @TheReelRobot) · This AI-Generated War Scene Looks Shockingly Real (1.4, @WhatIfAtlasMaps) · How To Use Google's Veo 3
  AI Video Generator in Gemini AI Ultra (1.295, **@CNET**) · Google's new AI video tool Veo 3 is WILD! (1.4, @Impekable) ·
  Kling AI 4.0 Tutorial (2.515, label, @FILMCRUX) · 100+ Veo 3 AI Videos – Indistinguishable from Reality (1.4, @AIrtVids) ·
  3-Step Workflow To Make Ultra-Realistic AI Ads (1.9, label, @HiggsfieldAI).
* Dimmed: AI Character Swap … Wan 2.2 Animate (0.9) · How to Use Google VEO 3 for FREE Tutorial (0.865) · Google's Veo 3 vs
  OpenAI's Sora Same Text Prompt (0.63) · I Make Animated Videos 100% FREE Using AI (0.9) · This AI Video Looks TOO REAL!
  (0.9) · How to make long AI videos using Google Video 3 (0.665).
* Untouched (correct): the Squarespace/OpenArt sponsored slot (kind ad, hideAds off), "Google Veo 3 Tutorial: Make
  Cinematic AI Video…" (Kevin Stratvert, desktop verdict none), "Sora 2 Tutorial: How to Generate Videos Easily" (Artlist).
* Stub text as rendered: `Hidden: AI content — platform AI label (youtube watch) · Show · Never show @CreativeAIAds`,
  `Hidden: AI content — AI hashtag #ai · Show · Never show @EditedByGeo`, `Hidden: AI content — self-disclosed AI (ai media
  noun) · Show` (no author when the card has no channel link: search Shorts lockups).
* Screenshot (0.6 scale): the Shorts shelf shows five compact "Hidden: AI content — …" stubs in place of the
  cards; lower, two stubs sit in the grid next to a dimmed card (opacity .35) carrying the "AI?" badge top-right. Files:
  `tests/live/screenshots/youtube-search-veo3-shorts-shelf.jpg`
  and `tests/live/screenshots/youtube-search-veo3-grid.jpg`.

### 2.2 Query 2 `sora 2 ai video` via the SPA (search box + Enter, no reload)

* `__noslopLiveInjected` still true, URL changed by pushState, `surface search`, 32 new elements processed (cache 60),
  **hidden 15 · dimmed 8 · none 9**; prefetch 33 → 34 fetches, all 200; 0 errors. After one scroll the grid re-rendered
  (processed 29, dimmed 7): the engine re-applied on the new nodes with no duplicate stubs (`stubs 15`).
* Tier-0 hits: "Security Camera Captured This Unbelievable Moment | sora 2" (@lucasaiacademy, 4.42), "Sora 1 vs Sora 2: The
  Future of AI Video" (@Aidailydoseofficial, 3.305), @HiggsfieldAI again (cache hit), and after scroll "Sora 2 AI is WILD for
  this… (Banned AI Disney Pixar Film Trailers)" (`label:youtube_watch`).
* Reasons: tool:sora 21, disclosure:ai_media_noun 14, hashtag:#sora2 10, context:critique 10, hashtag:#aivideo 7,
  hashtag:#sora 7, hashtag:#ai 5, hashtag:#openai 5, hashtag:#veo3 4, tool:seedance 4, tool:veo 4, style:engagement_bait 4,
  disclosure:ai_generated 4, label:youtube_badge 3, label:youtube_watch 3, style:em_dash_density 3, hashtag:#aitools 3, …
* Popup contract exercised in-page: `NoSlop.engine.handleMessage({type:'noslopStatus'})` → `{ok:true, running:true,
  site:'youtube', surface:'search', hidden:45}`; `recentHidden(5)` newest-first rows with reason + title; 33 stats events
  reached `host.report` (1.5 s debounce).
* Screenshot: top of results shows the sponsored OpenArt slot and the untouched Artlist tutorial, then the Shorts shelf
  as four stubs ("self-disclosed …", "platform AI labe…"). File `tests/live/screenshots/youtube-search-sora2-spa.jpg`.

### 2.3 Selectors / paths that did NOT match on www.youtube.com, and why

* `.ytBadgeShapeText` = "AI" and `badge-shape[aria-label^="AI:"]` on **cards**: 0 of 64 cards across both queries — as the
  research says, feed cards carry no AI badge; all 8 tier-0 hits came from the watch-HTML prefetch.
* `ytd-ad-slot-renderer`: 5 present, **4 never got `data-noslop-id`** — `extract()` returns null when the slot has no
  `/watch?v=` link (external-landing "Sponsored" ads). Harmless with `hideAds` off, but with `hideAds` on these slots would
  NOT be hidden (the youtube adapter's `surfaces()` lists only Shorts). → request for adapter:youtube below.
* One inner `yt-lockup-view-model` (`/watch?v=_BUE-O-ELdI`) is unprocessed by design: its outer `ytd-video-renderer` holds
  the id (`findItems` keeps the outermost match).
* Scrolling in the headless viewport did not trigger YouTube's continuation (domItems stayed 37); lazy-load was not exercised.

### 2.4 False positives / questionable verdicts (balanced mode, defaults)

1. **CNET — "How To Use Google's Veo 3 AI Video Generator in Gemini AI Ultra" → HIDDEN** (1.295 desktop; 1.995 on mobile
   where `prompt_in_comments` and `text_to_x` also fired on the description). A human-presented tutorial from a news
   outlet. `context:critique` did fire (factor 0.35) but two strong description hashtags (#veo3, #aivideo → 2.0 × 0.35 = 0.7)
   + weak tags (0.28) + mention-level disclosure (0.175) + tool (0.14) still clear the 1.0 hide bar. Same mechanism:
   "Sora 2 has already been nerfed #sora #ai" (1.8: #sora strong 1.0 + tool:sora 0.4 + #ai 0.4, no critique word), "A.I.
   Has Officially Gone Too Far | Veo 3 is INSANE" (1.8, reaction/commentary), "Can You Guess Real vs Sora 2 Videos?"
   (@synthesia-io, 1.33, a quiz). Pattern: **a strong tool/brand hashtag (#veo3, #sora, #sora2) + the tool mention of the
   same product double-counts** (hashtag 1.0 + tool 0.4), so any video ABOUT Veo/Sora that tags itself is hidden even in a
   critique context. Suggestion for core (not applied): when the only strong hashtags are tool/brand tags
   (`#veo3 #sora #sora2 #kling #midjourney …`) and a critique/tutorial/review negator matched, cap hashtag+tool at < 1.0
   together, or move brand tags to `weak` while keeping self-label tags (#aiart, #aigenerated, #aivideo) strong.
2. Dim-level: Kevin Stratvert "Google Veo 3 Tutorial" (0.735, mobile only), CNET "How to Use Sora 2 … Guide" (0.84),
   "Kling 3.0 vs Seedance 2.0 vs Veo 3.1 vs Sora 2 comparison" (0.735), "I Used N8N to Automate a $10M/yr AI Influencer"
   (0.915) — all human tutorials/reviews; dim is tolerable, hide would not be. Note the first two are within 0.3 of hiding.
3. No false positive among the 8 tier-0 label hits; no auto-dub false hit.

## 3. m.youtube.com — mobile DOM (viewport 375×812, Android UA)

* `site youtube` (adapter matched `m.youtube.com`), `surface search`; 28 `ytm-*` cards (14 shorts in the Shorts shelf, 14
  videos) → **processed 28 · hidden 15 · dimmed 10 · none 3 · stubs 15 · unprocessed 0 · errors 0**.
* Enrich: all 15 fetches to `https://www.youtube.com/watch?v=…` failed cross-origin on the first attempt (`Failed to
  fetch`) and succeeded on the harness rewrite to `https://m.youtube.com/watch?v=…` (200, 0.8–1.2 MB, 0.9–1.4 s).
  **The mobile watch HTML produced 0 `label:youtube_*` hits** — @CreativeAIAds, whose www page carried the label, was hidden
  here only on text signals (3.21 vs 4.71). The real extension fetches www through background.js, so this is a harness
  artefact, but it is also a fact: `parseWatchHtml` cannot read labels from m.youtube.com watch pages.
* Hashtag/handle extraction from the description worked on the mobile HTML (owner handles, #veo3 etc.).
* The hash fragment was already stripped by the mobile app before my snippet ran; the `PerformanceNavigationTiming.name`
  fallback carried the bundle (427 097 chars).
* Rendering: stubs appear as compact rows in the single column and inside the 2-column Shorts shelf; a dimmed top result
  shows the `AI?` badge over the thumbnail (screenshot `tests/live/screenshots/m-youtube-mobile.jpg`,
  `…-n4kcc2.jpg`). One wrinkle: the mobile hero result (Kevin Stratvert, dimmed) still played its preview under the dim
  layer — dim does not pause media (by design; only hide calls `stopMedia`).
* Untouched (correct): "✨NEW✨ Veo in YT Create" (@YouTube Creators), two tutorial cards.
* Selectors with 0 matches here: `ytm-compact-autoplay-renderer`, `ytm-rich-item-renderer` (search page uses
  `ytm-video-with-context-renderer` + the shelf's `ytm-shorts-lockup-view-model`), card badges (none exist).

## 4. www.reddit.com/r/aiArt/ — blocked in the harness; jsdom substitute on REAL captures

The harness browser refused reddit.com outright (both via the relay and a direct `navigate`). Substitute evidence: the identical
live bundle (`$TMPDIR/noslop-live.js`, stub host, `fetch` rejected) evaluated in jsdom on the four REAL
server-rendered captures in `tests/fixtures/reddit/`, at the subreddit URL and at the home URL:

| Capture | @ `/r/aiArt/` (surface other) | @ `/` (surface home) |
|---|---|---|
| aiart-shreddit-post.html (3 posts, flairs "Image - ChatGPT" ×2, "Image - Other: …") | processed 3 · **none 3** (seed list does not apply inside the subreddit; flairs are not in `labels.reddit.flairText`) | processed 3 · **dimmed 3**, reason `account:subreddit` (0.9 = dim in balanced, hide in strict) |
| midjourney-shreddit-post.html (3 posts, flairs "AI Showcase - Midjourney" ×2, "AI Video - Midjourney") | processed 3 · dimmed 1 ("ascension is calling": disclosure:ai_media_noun + tool:midjourney 0.9) · none 2 | processed 3 · **hidden 3** (account:subreddit 0.9 + tool:midjourney 0.4 [+ style]) → 1.42–1.8, 3 stubs |
| aiart / midjourney shreddit-ad-post.html | processed 1 · none (kind ad, hideAds off) | same |

So "subreddit-based verdicts" hold exactly as documented in DESIGN §4/§5 and STATUS §4: on the home feed only. Expectation
check for the task: on `/r/aiArt/` itself the engine deliberately does nothing unless a flair/text signal fires. 0 errors.
A live reddit run still needs a browser that may open reddit.com (Safari/Chrome with the built extension).

## 5. www.tiktok.com/explore — logged out

* Page renders the explore grid with a "Log in to TikTok" modal on top (its "Skip" opens a sign-up flow; not followed).
  `site tiktok`, `surface home`, `hideStrategy display-none` (no For You articles), `data-noslop-tiktok-page="home"`.
* **8 `[data-e2e="explore-item"]` cards processed · 0 hidden · 0 dimmed · 0 errors.** Sample item: id 7699512822467710230,
  author {handle capcuts001, name "Alexandra ✨"} from the `created by … with …` alt text, text "Try it here ⬆️ #CapCut
  #capcutpioneer #pioneertemplate", hashtags from the caption, media video, labels []. The other 7 captions were ordinary
  (air force, pitbull, kids, dance) — nothing AI-labelled in this logged-out sample, so 0 verdicts is the right answer.
* JSON relay: no extension runtime → `lib/tiktok-main.js` injection is skipped by design (`relayScript false`);
  `seedFromSsr()` ran on `#__UNIVERSAL_DATA_FOR_REHYDRATION__` (present) and found **0 items with IsAigc/aigcLabelType
  keys** — the explore SSR blob does not embed item lists. `relaySize 0`, `knownSize 8`.
* Selector census (`rules.sites.tiktok`, matches on this page): item 8, exploreItem 8, videoLink 8, description 8
  (`explore-card-desc`), author 8, authorLink 16, posterImg 22, playerWrapper 1, ssrJson 1; **0**: forYouItem, overlay,
  activeMenu, feedNext, hashtagLink (`search-common-link` only exists in the For You overlay; explore hashtags come from
  the alt text), descriptionSpans, photoLink, searchItem, profileItem, `aigcTag` / labels.tiktok.selectors
  (`[data-e2e="aigc-tag"]`, `[data-e2e="aigc-label"]`) and none of the six label strings occur on the page. The
  `[data-e2e="aigc-tag"]` hypothesis therefore remains unverified (no labelled video reachable logged out).
* Scrolling loaded no further cards while the modal is up (8 stayed 8).

## 6. Engine fix applied (lib/engine.js, `makeStub`)

Before: `d.innerHTML = '<span class="noslop-stub__label">…'` → on youtube.com every hide threw under
`require-trusted-types-for 'script'`, the engine's start promise rejected, and the 1 s sweep kept re-throwing (observed:
`[NoSlop] engine failed to start: Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML'
assignment`, processed 1 / hidden 0 with 18 hide verdicts pending). After: identical markup (same classes, separators,
whitespace, `data-noslop-act` buttons) built with `createElement`/`textContent`/`append`; `dom.escapeHtml` is no longer
needed there. `npm test`: 360 tests, 359 pass, 1 skipped (unchanged). This was the only HTML sink in the chain
(`grep innerHTML|outerHTML|insertAdjacentHTML` over lib/, adapters/, content.js, popup/ → one hit).

## 7. Not done / limits of this run

* reddit.com live (blocked in the harness) — jsdom substitute only (§4). linkedin/x/instagram/facebook were not in scope.
* youtube.com continuation (infinite scroll) and the watch page / Shorts player were not exercised; `hideShorts`,
  `hideAds`, strict mode and the "Never show" button were not toggled live (the stub buttons render and are wired; not clicked).
* TikTok For You / search / a labelled video need a logged-in session; the page-world relay needs the real extension
  (`runtime.getURL`).
