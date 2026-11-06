# Platform feed DOM + AI-disclosure signals (web), as of 2026-11-02

Scope: instagram.com, x.com, youtube.com (+ m.youtube.com), facebook.com, tiktok.com, reddit.com, linkedin.com.
Method: primary platform docs and blogs; selectors pulled from the CURRENT source of actively maintained extensions/userscripts (see SOURCES.md), with repo + file + commit date recorded. Anything not confirmed from a primary source or live code is marked **UNVERIFIED**.

Source snapshots used (HEAD commit dates fetched from the GitHub API on 2026-11-02):

| Repo | HEAD | File(s) read |
|---|---|---|
| insin/control-panel-for-twitter | 7e6a8b07c3, 2026-10-18 | `script.js` (304 KB) |
| insin/control-panel-for-youtube | 2dfe741b9a, 2026-10-18 | `page.js` (266 KB), `content.js`, `README.md` |
| ajayyy/DeArrow | 482cf997c9, 2026-10-17 | `src/thumbnails/thumbnailRenderer.ts` |
| ajayyy/SponsorBlock | 454c2d8545, 2026-10-18 | (not needed; watch-page only) |
| amitbl/blocktube | d8a1bdba06, 2026-02-07 | `src/scripts/inject.js`, `seed.js` (filters the InnerTube JSON, almost no DOM selectors) |
| uBlockOrigin/uAssets | 205b2124e0, 2026-11-02 | `filters/filters.txt`, `filters/annoyances-others.txt` |
| shbernal/instagram-feed-blocker | db1c2041c1, 2026-09-26 | `src/content/selectors.ts`, `blocking.css`, `blockingStyles.ts` |
| fx-biocoder/better-linkedin | 1ab1be6a59, 2026-10-19 | `content-feed.js` |
| mashdot/ai-slop-shield (YouTube AI-label hider) | pushed 2026-08-21 | `content.js`, `README.md` |
| Gokul-Nath-github/youtube-ai-filter | pushed 2026-07-23 | `content.js` |
| Greasy Fork 552339 "FB - Clean my feeds" v6.5.0 | fetched 2026-11-02 | bundled source |
| Greasy Fork 516666 "Reddit Advanced Content Filter" v3.2.0 | fetched 2026-11-02 | source |
| Greasy Fork 589405 "Shreddit" v0.6.5 | fetched 2026-11-02 | source |
| Greasy Fork 551021 "Hide LinkedIn Promoted Posts with CSS" v1.1.4 (2025-10) | fetched 2026-11-02 | source |
| gist viki53 "Instagram Purified" v1.4.0 | last active 2025-07-25 | userstyle CSS |

---

## 0. Decision-relevant summary

1. **Only YouTube gives a feed-card-level AI signal today.** Since 2026-05-27 YouTube renders one label format for photorealistic/meaningfully-altered AI content: below the player on long-form, as an overlay on Shorts, and (per two open-source hiders) an "AI" badge in `.ytBadgeShapeText` on cards plus a `how-this-was-made-section-view-model` element / `howThisWasMadeSectionViewModel` JSON key on watch pages. Everything else (Meta "AI info", X "Made with AI", TikTok "AI-generated", LinkedIn C2PA icon) is a per-post/per-media label whose web DOM hook could **not** be verified from a primary source; plan on **localized text matching inside the post container** plus a fallback to platform JSON.
2. **The platforms' own "AI slop" controls are not exposed to the web DOM** (TikTok's "AI-generated content" slider in Manage Topics; YouTube's July-2025 "inauthentic content" monetization policy; Reddit's "App" account label). They are user settings/policies, not DOM signals.
3. **Feed containers are stable enough to build on**: X `[data-testid="cellInnerDiv"]` > `article[data-testid="tweet"]`; YouTube `ytd-rich-item-renderer` (now wrapping `yt-lockup-view-model`), `ytd-video-renderer`, `yt-lockup-view-model` in #related; m.youtube `ytm-rich-item-renderer`, `ytm-video-with-context-renderer`; Instagram `main[role="main"] article`; Facebook `div[role="main"] div[aria-posinset]` / `div[role="article"]`; Reddit `shreddit-post`; LinkedIn `[role="listitem"][componentkey^="update-card-focus"]` inside `div[data-testid="mainFeed"]`. TikTok web is UNVERIFIED (only `data-e2e=` attributes are known to be stable).
4. **Hiding technique matters on X and Facebook** (virtualized / absolutely positioned lists). Control Panel for Twitter hides the *first child* of `cellInnerDiv` (class `HiddenTweet` → `display:none`), never the cell. uBlock's own Facebook rules collapse feed units with `height:0 !important; overflow:hidden !important` instead of `display:none`. YouTube and LinkedIn tolerate plain `display:none` on the card.
5. **m.youtube.com is a different DOM (ytm-*)**, x.com mobile is the same React app in a column layout, instagram.com mobile is the same app with some chrome moved out of `<main>`. Control Panel for Twitter/YouTube ship as iOS Safari extensions, proving the Safari Web Extension content-script route works on these sites.

---

## 1. Platform-native AI labels (what exists, what the DOM shows)

### 1.1 Meta — Instagram / Facebook / Threads: "AI info"

Primary sources:
- Meta newsroom, "Our Approach to Labeling AI-Generated Content and Manipulated Media" (2024-04-05, with updates dated 2024-07-01 and 2024-09-12): https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/
  - April 2024 label: **"Made with AI"**. July 1 2024: renamed to **"AI info"** across apps because minor retouching was triggering it. September 12 2024: for content Meta detects was only *modified/edited* by AI, the "AI info" label is **moved into the post's "…" menu**; content detected as *generated* by AI keeps the visible label. Meta AI's own photorealistic images get **"Imagined with AI"**. Triggers: "industry standard indicators" (Meta's Feb 2024 post names the "AI generated" fields of **C2PA and IPTC**) and user self-disclosure.
- Meta Transparency Center, "Labeling AI Content" (updated 2025-02-19): https://transparency.meta.com/governance/tracking-impact/labeling-ai-content — label applies to organic content on Facebook, Instagram and Threads; "methodology is still evolving and may not capture labels on some content edited with AI".
- Instagram creators blog, 2026-08-31, "Bringing More Transparency to AI-Generated Profiles": https://creators.instagram.com/blog/ai-generated-profile-label — profile-level **"AI-generated profile"** label (renamed from "AI creator label"); creator-applied via a profile toggle; shown on the profile *and alongside their content*, but **not** on a post that already carries a created/edited-with-AI label; Instagram detects unlabeled AI profiles, notifies them and may limit reach in recommendations.

What this means for the web DOM:
- The visible label text is **"AI info"** (English). Localized strings exist (Meta localizes the label) but the exact per-language strings were not found in a primary source → **UNVERIFIED**; harvest them from `<html lang>` + the live page per locale.
- DOM element/attribute for the label: **UNVERIFIED** (no public source documents it; Instagram/Facebook class names are atomic and regenerated per build). Practical, code-verified approach: "FB - Clean my feeds" v6.5.0 (Greasy Fork 552339) ships a feature `NF_AI_INFO_POSTS: 'Posts labeled "AI info"'` and detects it by **text-matching the post-header disclosure line** against a locale table whose English entries are `["Ad", "AI info", "Visit Meta AI|Meta AI branding", "Try Meta AI|Free AI creation tools"]` (`matchesDisclosureLabel(name, "aiInfo")`). So on facebook.com: find the post container (`div[role="main"] div[aria-posinset]`), look for a header text node equal to "AI info" (or a locale equivalent), hide the unit.
- Caveat: since Sept 2024, AI-*edited* posts hide the label inside the "…" menu — invisible to a content script without opening the menu. Only AI-*generated* posts keep the inline label.
- Facebook also surfaces Meta AI promotional units ("Try Meta AI", "Meta AI prompts") that the same script hides; those are platform promos, not user content.

### 1.2 YouTube

Primary sources:
- Help: "Understanding 'How this content was made' disclosures on YouTube" https://support.google.com/youtube/answer/15447836?hl=en — viewer-facing label named **"Made with AI"** ("content that has been meaningfully altered or synthetically generated with Gen AI tools"); appears "in the video player or the description"; expanded description has a **"How this content was made"** section; for some C2PA disclosures the label may be on the player itself; YouTube "may proactively apply a label to undisclosed content".
- Help: "Disclosing use of altered or synthetic content" https://support.google.com/youtube/answer/14328491?hl=en — creator answers the **"AI use"** Yes/No question under *Attributes* in Studio; label in the **player** for AI music or photorealistic AI, in the **expanded description** for non-photorealistic/animated; auto-labels for content made with YouTube GenAI tools, content carrying **C2PA** metadata, or content its systems detect; auto labels from YT tools/C2PA/manual review **cannot be removed**; disclosure "doesn't limit an audience or affect monetization eligibility".
- Help: "'Captured with a camera' disclosure" https://support.google.com/youtube/answer/15446725 — separate authenticity label, requires C2PA 2.1+ at capture; absence means nothing.
- Blog, 2026-05-27, "Improving AI labels for viewers and creators": https://blog.youtube/news-and-events/improving-ai-labels-viewers-creators/ — **single label format** for photorealistic / meaningfully altered or generated content: **directly below the player, above the description** on long-form; **overlay on the video** for Shorts; unrealistic/animated/slightly altered stays in the expanded description. From May 2026 YouTube's internal signals **auto-apply the label on "significant photorealistic AI use"** when the creator did not disclose. Disputes via Studio. Permanent (unchangeable) for Veo/Dream Screen output and for C2PA metadata indicating fully generative AI. Does not change recommendations or monetization. (Secondary: TechCrunch https://techcrunch.com/2026/05/27/youtube-will-now-automatically-label-ai-videos/ ; MBW https://www.musicbusinessworldwide.com/youtube-will-now-automatically-detect-and-label-ai-videos/ — likeness detection opened to all eligible creators 18+.)
- Monetization policy, "YouTube channel monetization policies" https://support.google.com/youtube/answer/1311392?hl=en — **2025-07-15 update** renamed "repetitious content" to **"inauthentic content"** ("includes content that is repetitive or mass-produced"). Not allowed: "Image slideshows, templated storylines, or scrolling text with minimal or no narrative"; "AI-generated content made with generic or unoriginal templates giving the impression of mass production"; stitching "inconsistent AI clips to surprise or shock viewers"; AI personas posing as health/legal/financial/political experts. This is a **channel-level monetization policy, not a viewer-facing badge**.
- Data API: `status.containsSyntheticMedia` added 2024-10-30 (https://developers.google.com/youtube/v3/revision_history) — a server-side way to check a video ID (quota cost applies).

Web DOM signals (from open-source hiders; verify on live DOM before shipping):
- **ai-slop-shield** `content.js` (github.com/mashdot/ai-slop-shield, 2026-08-21):
  - Card containers: `ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model`
  - Badge: `.ytBadgeShapeText, .badge-shape-wiz__text` whose trimmed text is exactly **"AI"**, or matches `/altered or synthetic|altered content|synthetic content|made with ai|ai-generated|generated by ai|altered or fully generated/i`
  - Watch page: element `how-this-was-made-section-view-model`; fallback: fetch the watch HTML and regex `/howThisWasMadeSectionViewModel|made with AI/` in the embedded JSON. README states "Feed cards without a visible badge are not pre-checked".
  - Title/channel: `#video-title, h3, .yt-lockup-metadata-view-model__heading`; `ytd-watch-metadata a[href^="/@"]`, `ytd-video-owner-renderer a[href^="/@"]`.
- **youtube-ai-filter** `content.js` (2026-07-23): strings `altered or synthetic content`, `how this was made`, `ai-generated`, `synthetic content`, `generated with ai`, `made with ai`; badge containers `ytd-badge-supported-renderer`, `yt-badge-shape`, `[class*='badge-shape']`, `#description-inner`; Shorts player `ytd-shorts-player-renderer`.
- The innertube key `howThisWasMadeSectionViewModel` is the best machine-readable signal (it is in `ytInitialData` of the watch page and in `/youtubei/v1/next` responses). Whether feed `yt-lockup-view-model` data carries an AI badge field is **UNVERIFIED**; ai-slop-shield relies on the rendered "AI" badge only.
- Label on **m.youtube.com** DOM: **UNVERIFIED** (no source; expect a `ytm-badge`/badge-shape text "AI" and the same JSON key on `/youtubei/v1/next`).

### 1.3 X (Twitter)

- **"Made with AI" content-disclosure label.** Leaked as a post-level toggle by researcher Nima Owji 2026-02-23 (Social Media Today https://www.socialmediatoday.com/news/x-formerly-twitter-tests-ai-content-labels/812913 ; The Tech Portal https://thetechportal.com/2026/02/23/x-could-soon-introduce-a-made-with-ai-label-to-flag-synthetic-and-manipulated-content/). Reported live ~2026-03-02 (exchange4media https://www.exchange4media.com/digital-news/x-rolls-out-ai-content-labels-as-it-seeks-to-stabilise-advertising-revenue-152469.html ; PiunikaWeb https://piunikaweb.com/2026/03/02/x-twitter-made-with-ai-paid-partnership-labels-live/ — both 403 to fetch, **UNVERIFIED** beyond search snippets). Composer "Content disclosure" popup has two toggles: "Disclose paid promotion" and "Made with AI" (Gigazine https://gigazine.net/gsc_news/en/20260225-x-ai-labels). roboin.io (2026-03-03, updated 2026-03-24, verification 2026-06-10) https://roboin.io/article/en/2026/03/24/why-x-tags-posts-as-made-with-ai-and-how-to-remove-it-testing-the-conditions/ : X **auto-applies** the label on some images (ChatGPT output labeled; **Grok and Gemini output NOT labeled** in their test); auto labels are greyed out / cannot be removed; label "may sometimes appear at the bottom of a post". Buffer docs: label accepted only on original posts, not reposts.
- **Official X help page** (help.x.com manipulated-media / Made-with-AI article): returned HTTP 403 to fetch → exact official wording **UNVERIFIED**.
- **Grok media**: Social Media Today (2026-02-23): "X already watermarks images and videos generated by its Grok chatbot" (visible watermark; no disclosure requirement). Wikipedia's Content Credentials table lists Grok Imagine as having **no C2PA conformance** (consistent with roboin's "Grok doesn't support C2PA") → do not expect C2PA on Grok output.
- **Community Notes "AI generated" tag**: no evidence found in any source → treat as **nonexistent/UNVERIFIED**. (A Grok-account post from 2026-03 claims unlabeled synthetic content on sensitive topics loses revenue sharing for 90 days — secondhand, x.com not fetchable.)
- **Grok attribution in DOM (verified from code)**: Control Panel for Twitter's `hideGrokTweets` hides any tweet containing `a[href^="/i/grok/share/"]` (shared Grok conversations). Other Grok hooks present in script.js: `[data-testid="grokImgGen"]`, `[data-testid="GrokDrawer"]`, nav `a[href="/i/grok"]`, and the localized "Grok actions" menu string table (37 languages, e.g. `GROK_ACTIONS: 'Grok actions'`).
- DOM hook for the "Made with AI" label: **UNVERIFIED**. Strategy: inside `article[data-testid="tweet"]`, text-match "Made with AI" (and localized variants; Japanese screenshots show the same English string per roboin) in the metadata row near the timestamp/`socialContext`.

### 1.4 TikTok

- Newsroom 2025-11-24 (dated by TikTok) "More ways to spot, shape and understand AI-generated content": https://newsroom.tiktok.com/en-us/more-ways-to-spot-shape-and-understand-ai-generated-content — testing an **"AI-generated content" control inside "Manage topics"** (Settings > Content preferences > Manage topics; a slider per TechCrunch https://techcrunch.com/2025/11/18/tiktok-now-lets-you-choose-how-much-ai-generated-content-you-want-to-see/); **invisible watermarking** ("a robust technological 'watermark' that only we can read") added to AI Editor Pro output and to uploads carrying **C2PA Content Credentials**; "over 1.3 billion" videos labeled; labels now say whether applied by detection, creator, or TikTok AI tools.
- Newsroom 2023-09-19 "New labels for disclosing AI-generated content": https://newsroom.tiktok.com/en-us/new-labels-for-disclosing-ai-generated-content — label text **"AI-generated"**; auto-applied to AI-effect content; creators can self-label.
- Exact strings reported by secondary guides: auto label **"AI-generated"**; creator label **"Creator labeled as AI-generated"** (older coverage: "Content labeled as AI-generated" bottom-left of the video). TikTok's help article (https://www.tiktok.com/support/faq_detail?id=7636670084747893268) is JS-rendered and returned no text → exact strings **UNVERIFIED**.
- The Manage Topics slider is a server-side ranking preference; **nothing of it is exposed in the DOM**. It reduces, does not remove.
- Web DOM: **UNVERIFIED** (no maintained open-source TikTok web feed filter found; Greasy Fork's TikTok listing was blocked). Known stable hooks are `data-e2e="…"` attributes (e.g. `video-user-name`, `user-post-item`, `search-card-video`, `followers-count`), while class names are hashed (`tiktok-1anth1x-DivVideoDescription`) — Apify 2025-01-29 https://blog.apify.com/tiktok-scraper-python/. The commonly cited `[data-e2e="recommend-list-item-container"]` for For-You items could not be confirmed.

### 1.5 Reddit

- **No site-wide AI-content label on posts.** The only platform-level label is the **"App" account label** for permitted automated accounts, announced in r/redditdev "Keeping Reddit Human: A New App Label for Automated Accounts" (2026-03-25; label live from 2026-03-31; TechCrunch https://techcrunch.com/2026/03/25/reddit-bots-new-human-verification-requirements ; Social Media Today https://www.socialmediatoday.com/news/reddit-implements-new-app-label-to-identify-bot-profiles/815758/). TechCrunch: "using AI to write posts or comments is not against Reddit's policies, though community moderators may set their own rules."
- Per-subreddit "AI" flairs/rules exist (e.g. r/wallpaper requires tagging); a 2026 index claims only ~3.6% of 250 large subs have an AI-disclosure rule (secondary, unverified). Flair text is the only DOM signal: `shreddit-post` → flair element (**UNVERIFIED** selector; inspect `[slot="post-flair"]`/`shreddit-post-flair`).

### 1.6 LinkedIn

- Help "Content credentials" https://www.linkedin.com/help/linkedin/answer/a6282984 — image/video cryptographically signed with **C2PA** shows the **"C2PA icon"** (community calls it the "Cr" badge); clicking shows: "whether AI was used to generate or edit any part of the content", app/device, created by, issued by, issued on. Images/videos only; rolling out gradually; "not yet possible to identify and label all AI-generated and modified content". The icon marks *provenance*, not necessarily AI — the assertion inside says whether AI was used.
- DOM hook for the icon: **UNVERIFIED** (likely an `svg`/`button` with aria-label "Content credentials" inside the media container).

---

## 2. Feed-item DOM anchors a content script can rely on today

Legend: **[2026-code]** = taken from a repo/script whose HEAD is 2025-10 or later; **[older]** = 2024–mid-2025 source; **[UNVERIFIED]** = not confirmed by any fetched source.

### 2.1 x.com (Control Panel for Twitter `script.js`, HEAD 2026-10-18)

| Purpose | Selector | Note |
|---|---|---|
| Primary column | `div[data-testid="primaryColumn"]` | [2026-code] |
| Home/list timeline root | `div[data-testid="primaryColumn"] section > h1 + div[aria-label] > div` (`Selectors.TIMELINE`) | children = timeline items [2026-code] |
| Timeline cell | `[data-testid="cellInnerDiv"]` | each item; CPT iterates `$timeline.children` and `closest('[data-testid="cellInnerDiv"]')` [2026-code] |
| Tweet | `[data-testid="tweet"]` (an `<article>`) | [2026-code] |
| Tweet text | `[data-testid="tweetText"]` | [2026-code] |
| Author / handle | `[data-testid="User-Name"] a` (pathname = handle) | [2026-code] |
| Social context ("X reposted", "Promoted") | `[data-testid="socialContext"]` | [2026-code] |
| Promoted tweet container | `[data-testid="placementTracking"]` (`PROMOTED_TWEET_CONTAINER`) | [2026-code] |
| Promoted trend | `[data-testid="trend"]:has(path[d="M19.498 3h-15c…"])` | [2026-code] |
| Verified tick | `svg[data-testid="icon-verified"]` | [2026-code] |
| Reply separator | `.HiddenTweet + [role="separator"]` | [2026-code] |
| Grok share link in tweet | `a[href^="/i/grok/share/"]` | hideGrokTweets [2026-code] |
| Grok drawer / image gen | `[data-testid="GrokDrawer"]`, `[data-testid="grokImgGen"]` | [2026-code] |
| Mobile nav / header | `#layers nav`, `div[data-testid="TopNavBar"]` | [2026-code] |
| Mobile detection | `getComputedStyle(document.querySelector('#layers + div')).flexDirection == 'column'` | [2026-code] |
| uBO promoted (text) | `div[style^="transform"] h2 > div[style^="-webkit-line-clamp"] > span:has-text(/^(Promoted Post|…)$/):upward(3)` | uAssets 2026-11-02 |
| "Made with AI" label | — | [UNVERIFIED] text-match inside tweet |

### 2.2 youtube.com desktop (Control Panel for YouTube `page.js` HEAD 2026-10-18; CleanWatch issue #20 merged 2026-06-13; ai-slop-shield 2026-08-21)

| Surface | Selector | Note |
|---|---|---|
| Home grid item | `ytd-rich-item-renderer` | wraps a nested `yt-lockup-view-model` ("Home nests a yt-lockup-view-model inside"); hide the **outer** `ytd-rich-item-renderer` to avoid empty grid slots [2026-code] |
| Home sections/shelves | `ytd-rich-section-renderer`, `ytd-rich-shelf-renderer`, `ytd-reel-shelf-renderer` (Shorts shelf) | [2026-code] |
| Search result | `ytd-video-renderer` | still legacy as of 2026-06 [2026-code] |
| Watch-page related | `ytd-compact-video-renderer, yt-lockup-view-model` (CPT: "TODO Remove ytd-compact-video-renderer after confirming all Related videos have moved to yt-lockup-view-model") | [2026-code] |
| New card component | `yt-lockup-view-model` | "re-rendered from scratch … empty on initial render" (CPY); re-observe `#content` [2026-code] |
| Title (new) | `a.ytLockupMetadataViewModelTitle`, `.yt-lockup-metadata-view-model__heading` | CleanWatch/FreshView 2026 |
| Title (legacy) | `#video-title` | [older, still present in search] |
| Channel link (new) | `yt-content-metadata-view-model a` | [2026-code] |
| Channel link (legacy) | `#text.ytd-channel-name a` | [2026-code] |
| Views/date row (new) | `.ytContentMetadataViewModelDelimiter` family | CleanWatch 2026 |
| Ad slot | `ytd-ad-slot-renderer` | [2026-code] |
| Badges | `.yt-badge-shape--thumbnail-live`, `.ytBadgeShapeThumbnailLive`, `.yt-badge-shape--membership`, `.ytBadgeShapeCommerce` | [2026-code] |
| AI badge | `.ytBadgeShapeText` / `.badge-shape-wiz__text` text == "AI" | ai-slop-shield [2026-code] |
| AI watch-page panel | `how-this-was-made-section-view-model`; JSON `howThisWasMadeSectionViewModel` | ai-slop-shield [2026-code] |
| Shorts player | `ytd-shorts`, `ytd-reel-video-renderer`, `yt-reel-player-overlay-view-model`, `ytd-shorts-player-renderer` | [2026-code] |
| Continuation (infinite scroll) | `ytd-continuation-item-renderer` | [2026-code] |
| Watch metadata | `ytd-watch-metadata`, `ytd-watch-flexy` | [2026-code] |
| DeArrow thumbnail hooks | `yt-thumbnail-view-model`, `.yt-thumbnail-view-model__image`, `ytd-img-shadow` | DeArrow 2026-10-17 |

JSON-level hooks (uAssets 2026-11-02, BlockTube 2026-02): `ytInitialData`, `/youtubei/v1/*` responses; ad entries `adSlotRenderer`, `adPlacements`, `playerAds`; Shorts ads `reelWatchEndpoint.adClientParams.isAd` (`/reel_watch_sequence`). BlockTube filters `itemSectionRenderer.contents` etc. by `author.displayName` / `metadataBadgeRenderer.style` before render — a network/JSON interception layer, which is the most robust approach on YouTube and sidesteps DOM churn.

### 2.3 m.youtube.com (separate DOM; CPY `page.js`, `mobile = location.hostname == 'm.youtube.com'`)

| Surface | Selector |
|---|---|
| Home item | `.tab-content[tab-identifier="FEwhat_to_watch"] ytm-rich-item-renderer` (may nest `yt-lockup-view-model`) |
| Subscriptions item | `.tab-content[tab-identifier="FEsubscriptions"] ytm-rich-item-renderer` |
| Search result | `ytm-search ytm-video-with-context-renderer` |
| Watch related | `ytm-item-section-renderer[section-identifier="related-items"] > lazy-list > ytm-video-with-context-renderer`, `ytm-compact-autoplay-renderer` |
| Shorts shelf | `ytm-rich-section-renderer:has(ytm-reel-shelf-renderer)`, `ytm-rich-section-renderer:has(ytm-shorts-lockup-view-model)`, `ytm-search lazy-list > ytm-reel-shelf-renderer`, `ytm-video-with-context-renderer:has(a[href^="/shorts"])` |
| Shorts item | `ytm-shorts-lockup-view-model` (data at `.data.onTap.innertubeCommand`) |
| Ads | `ytm-rich-item-renderer:has(> ad-slot-renderer)`, `ytm-paid-content-overlay-renderer`, `#mealbar\:3 > ytm-mealbar.mealbar-promo-renderer` (uAssets) |
| Badges | `ytm-badge[data-type="BADGE_STYLE_TYPE_MEMBERS_ONLY"]`, `ytm-thumbnail-overlay-time-status-renderer[data-style="LIVE"|"UPCOMING"]` |
| Other | `ytm-rich-section-renderer`, `ytm-rich-shelf-renderer`, `ytm-backstage-post-thread-renderer` (community posts), `ytm-feed-nudge-renderer`, `ytm-app`, `ytm-pivot-bar-item-renderer` |
| AI badge | [UNVERIFIED] — expect badge-shape text "AI" / same JSON key |

### 2.4 instagram.com (instagram-feed-blocker `selectors.ts`, HEAD 2026-09-26; Instagram Purified gist 2025-07-25; uAssets 2026-11-02)

| Purpose | Selector | Note |
|---|---|---|
| Main landmark | `main[role="main"]` | [2026-code] |
| Feed post | `main[role="main"] article` | [2026-code] |
| Feed wrapper (holds infinite-scroll loader) | `main[role="main"] div:has(> div > div > div > article)` | depth-pinned, brittle [2026-code] |
| For you / Following tabs | `main[role="main"] div:has(> [role="tablist"])` | wide layout only; <~767px the switch is a dropdown in a header **outside** `main` [2026-code] |
| Stories tray | `[data-pagelet="story_tray"]` | [2026-code] |
| Right-rail suggestions | `main[role="main"] div:has(> div > div > div > a[href="/explore/people/"])` | [2026-code] |
| Reels surface | `main[role="main"]:has([data-virtualized] video)`; reels videos `main [data-virtualized] video` | **`data-virtualized`** attribute marks the virtualized list [2026-code] |
| Explore grid | `main[role="main"] > div > div:has(a[href^="/p/"]):not(:has(input))` | [2026-code] |
| Suggested posts (after "caught up" marker) | `main article + div:has(img[src$="/images/instagram/xig/web/illo-confirm-refresh-light.png"]) ~ article` | [older, 2025-07] |
| Loading spinner | `main div[data-visualcompletion="loading-state"][role="progressbar"]` | [older] |
| Login wall | `#react-root ~ div[role="presentation"]:has(a[href^="/accounts/"][href*="signup/"])` | uAssets |
| Nav blocks | `div[data-visualcompletion="ignore-dynamic"] > div:has(> span > div > a[href="/reels/"])` | [older] |
| Post author / caption / "AI info" | — | [UNVERIFIED]; use `article header a[href^="/"]` for author and text-match "AI info" |

Design note from that repo: "Instagram's class names are atomic and regenerated per build, so nothing here names a class. The anchors are landmarks, roles, `data-pagelet`, and `href` shapes." `!important` is required because "Instagram's own rules are author origin too".

### 2.5 facebook.com (FB - Clean my feeds v6.5.0, fetched 2026-11-02; uAssets 2026-11-02)

| Purpose | Selector | Note |
|---|---|---|
| Main column | `div[role="navigation"] ~ div[role="main"]` | |
| Feed unit | `div[role="main"] div[aria-posinset]` (preferred) or `div[role="main"] div[role="article"]` | script picks whichever the page currently uses |
| Virtualized wrapper | `div[data-virtualized]` (`div[aria-posinset] > div[data-virtualized]`) | |
| Sponsored | `a[href*="/ads/about/"]`; `a[aria-label="Sponsored"|"広告"]`; `__cft__[0]=` tracking param length (uAssets `:matches-attr(href="/__cft__\[0\]=[-\w]{290,}/")`) | |
| Disclosure header line | text in `["Ad","AI info","Visit Meta AI","Try Meta AI"]` (en) | **"AI info" detection lives here** |
| Right rail | `[role="complementary"]`, `#right_rail_container` | |
| Legacy | `div[data-pagelet^="FeedUnit"]`, `#hyperfeed_story_id_*` | [older, 2022-era] |

### 2.6 tiktok.com — [UNVERIFIED]

Only known-stable pattern: `[data-e2e="…"]` attributes (class names are hashed). No currently maintained open-source feed filter found; inspect the live For You page for the item container and the "AI-generated" label text before building.

### 2.7 reddit.com (Reddit Advanced Content Filter 3.2.0; Shreddit 0.6.5; uAssets)

| Purpose | Selector | Note |
|---|---|---|
| Post (new UI) | `shreddit-post` (custom element, shadow DOM); may be wrapped in `article` ("Reddit can wrap one shreddit-post in an article: process the outer card once") | observed attributes: `post-title`, `subreddit-prefixed-name`, `subreddit-name`, `permalink`, `content-href`, `id` |
| Feed | `shreddit-feed` | |
| Title / body slots | `[slot="title"]`, `[slot="text-body"]`, `[slot="comment-count"]` | light-DOM slotted content |
| Ads | `shreddit-ad-post`, `[data-testid="ad-post"]` | Shreddit |
| Old reddit | `.thing.link`, `.usertext-body`, `[id^="t3"].promotedlink` | |
| 2018-redesign remnants | `div[data-testid="post-container"]`, `span[data-testid="post-title"]`, `a[data-click-id="comments"]` | [older] |
| Post flair ("AI") | — | [UNVERIFIED] |

### 2.8 linkedin.com (better-linkedin `content-feed.js` HEAD 2026-10-19; Greasy Fork 551021 v1.1.4 2025-10)

| Purpose | Selector | Note |
|---|---|---|
| Feed root (new) | `div[data-testid="mainFeed"]` | [2026-code] |
| Post (new) | `[role="listitem"][componentkey^="update-card-focus"]` | [2026-code] |
| Post body (new) | `span[data-testid="expandable-text-box"]` | [2026-code] |
| Post (old Ember DOM) | `.feed-shared-update-v2[role="article"]` | [older, 2025-10]; LinkedIn has been migrating away from Ember |
| Promoted (old) | `span[aria-hidden="true"]` with text `Promoted` | [older] |
| C2PA icon | — | [UNVERIFIED] |

---

## 3. How each site renders; implications for MutationObserver + hiding

- **All seven are SPAs with client-side routing and infinite scroll.** Content scripts must (a) inject CSS at `document_start`, (b) run a `MutationObserver` on the feed root (not `document`) and re-scan on route changes (`yt-navigate-finish`/`yt-page-data-fetched` on YouTube; URL polling or `history` patching elsewhere).
- **X**: Dworf/x-no-scroll README (https://github.com/Dworf/x-no-scroll-chrome-extension): "X's timeline is a *virtualized* list", "posts are absolutely-positioned cells (`transform: translateY(...)`) inside a fixed-height container", "off-screen posts are unmounted", which "defeats the browser's native scroll anchoring". A hider that sets `display:none` on `cellInnerDiv` fights the virtualizer's own height bookkeeping (it measures cells and positions siblings by cumulative height; a zero-height cell leaves X's layout math and the DOM out of sync, producing blank gaps/jumps). **Workaround used by Control Panel for Twitter (code-verified)**: classify each `$timeline.children` item, toggle class `HiddenTweet` on `$item.firstElementChild` (the content *inside* the cell), hide with CSS `.HiddenTweet { display:none !important }` and also `.HiddenTweet + [role="separator"]`; the cell itself stays mounted so the virtualizer re-measures it as near-zero height. Cells are **reused** when scrolling (asp0902 PR #329: "re-reads the post id for each cell"), so cache decisions by tweet id/`permalink`, not by element, and re-classify on every mutation.
- **Facebook**: feed units are `div[aria-posinset]` wrapped in `div[data-virtualized]`. uBlock's own filters hide feed ads with `:style(height: 0 !important; overflow: hidden !important;)` rather than `display:none` (uAssets filters.txt line ~298 and the `__cft__` rules) — the same "collapse, don't unmount" workaround. The FB Clean my feeds maintainer has an open "Feed blanks" bug (https://github.com/Artificial-Sweetener/facebook-clean-my-feeds/issues/10, 2026-05) with no root cause found — expect fragility.
- **Instagram**: the feed and reels are virtualized (dev.to 2025: "list items are removed from the DOM when they scroll out of the viewport"; the reels list carries `data-virtualized`). instagram-feed-blocker hides *whole sections* with `display:none !important` and additionally pauses `video` elements from JS ("CSS hides a video but does not stop it"). Whether per-`article` `display:none` breaks the home feed's virtualizer is **UNVERIFIED**; the safe pattern is the same as X: collapse the article's inner content (or `height:0; overflow:hidden; visibility:hidden`) and keep the `article` mounted, and always pause/mute the hidden `<video>`.
- **YouTube**: not virtualized — the grid/list appends `ytd-rich-item-renderer`s and loads more via `ytd-continuation-item-renderer`. Control Panel for YouTube, CleanWatch and ai-slop-shield all use plain `display:none !important` on the outer card. Two gotchas: `yt-lockup-view-model` is "re-rendered from scratch … empty on initial render" (observe its `#content` and re-apply), and YouTube re-uses components across SPA navigations, so stamp decisions by video id (`a[href*="/watch?v="]`, `/shorts/`), not by element.
- **Reddit (shreddit)**: Lit-based custom elements with shadow DOM; `shreddit-post` attributes (`post-title`, `permalink`, …) are readable from light DOM; the userscript sets `.raf-filtered{display:none!important}` without reported virtualization problems. Watch `attributeFilter` on `post-title`, `permalink`, `id`, `slot` because elements get re-used.
- **LinkedIn**: better-linkedin toggles `post.style.display = 'none'` on the listitem; no virtualization issues reported.
- **TikTok web**: For You is a full-screen snap feed; hiding an item needs the player to *advance* (skip) rather than collapse — **UNVERIFIED** mechanics.

Hiding recipe that works across the virtualized sites: keep the container mounted; set `data-<app>-hidden` on it; CSS `[data-x-hidden] > * { display:none !important }` (X/IG) or `[data-x-hidden] { height:0 !important; overflow:hidden !important; min-height:0 !important }` (FB); pause media; optionally render a one-line "hidden: AI-labeled" placeholder so the user can un-hide (ai-slop-shield and DeAlter both show placeholders).

---

## 4. Mobile web on iOS Safari

- **x.com**: same React bundle; "mobile" is a layout mode detected by CPT from `flexDirection == 'column'` of `#layers + div` (not UA). `data-testid` hooks (`tweet`, `cellInnerDiv`, `tweetText`, `placementTracking`) are shared; nav moves to `#layers nav`, header to `div[data-testid="TopNavBar"]`; some menus become `[role="dialog"]`/`sheetDialog` instead of `[role="menu"]`/`Dropdown`. Control Panel for Twitter is distributed for "desktop and mobile browsers" (incl. Safari iOS) — proof the Safari Web Extension content-script path works on x.com.
- **instagram.com**: same app; below ~767px the For you/Following switch becomes a dropdown in a header **outside `main`**; `main[role="main"] article` and `[data-pagelet="story_tray"]` still apply (instagram-feed-blocker comments). Mobile web aggressively shows "open in app" interstitials (uAssets login-wall rule above).
- **m.youtube.com**: **separate DOM** (`ytm-*` elements, `lazy-list`, `.tab-content[tab-identifier=…]`), see §2.3. Desktop `ytd-*` selectors do not match. Control Panel for YouTube handles both from one script keyed on hostname; it ships a `safari/` project.
- **facebook.com**: iOS Safari gets the www React DOM (`div[role="main"] div[aria-posinset]`) — consistent with the uAssets rules not being host-split, but **UNVERIFIED** on a real device; `m.facebook.com` redirects (UNVERIFIED).
- **tiktok.com / reddit.com / linkedin.com** mobile web: UNVERIFIED; Reddit mobile web is the same shreddit DOM (same `www.reddit.com` host).

---

## 5. Open items (could not verify; check on a live logged-in page before shipping)

1. Exact DOM node/attribute of Meta's "AI info" label on instagram.com and facebook.com, and its localized strings.
2. Exact DOM placement of X's "Made with AI" label and whether it is present in the `/graphql` timeline JSON (likely a field on `legacy`/`tweet` — unverified).
3. TikTok web For You item container, the AI label string on web, and whether labels are in the `/api/recommend/item_list` JSON.
4. YouTube card-level AI badge presence in `richItemRenderer`/`lockupViewModel` JSON (vs. only on the watch page).
5. LinkedIn C2PA icon DOM; Reddit flair DOM.
6. Behaviour of per-article `display:none` on Instagram's home feed virtualizer.
