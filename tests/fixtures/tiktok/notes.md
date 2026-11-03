# tiktok.com fixtures — capture notes

Captured 2026-11-02 (UTC ~23:00) with the Claude Browser pane (Chromium 152, logged out,
viewport 1366x900). Real DOM, cloned and stripped (svg/style/script/iframe/noscript/template/link
removed, `style`/`srcset`/`tabindex` attrs removed, `data:` URIs replaced by `[stripped]`,
whitespace collapsed). No personal data: the session was never logged in.

## What renders logged out

| URL | Result |
|---|---|
| https://www.tiktok.com/foryou | Feed renders behind a login modal (`[data-e2e="login-modal"]`, title "Log in \| TikTok"). Escape does **not** close it; `[data-e2e="modal-close-inner-button"]` exists on the search page variant only. The For You video plays and its overlay UI is live, but the feed **does not advance** (`[data-e2e="feed-navigation-next"]` clicks were ignored while the modal was up; 14 attempts, 1 distinct video). |
| https://www.tiktok.com/explore | Renders fully after ~15-25 s (first 10 s it is a `[data-e2e="explore-hero-section-skeleton"]`). 24 `[data-e2e="explore-item"]` cards + 5 `[data-e2e="explore-hero-card-N"]`. Login modal also appears but the grid is usable. |
| https://www.tiktok.com/search?q=ai%20generated | **Login-walled**: "Log in to search for popular content" modal, zero result cards, only skeletons. No fixture. |

## Files

| File | Nodes | Selector |
|---|---|---|
| `foryou-feed-items.html` | 3 | `article[data-e2e="recommend-list-item-container"]` (ids `one-column-item-0`, `one-column-item-1`, …). Each contains only `[data-e2e="anchoring-ambient"]` + `[data-e2e="feed-video"]` (the `<video>`/canvas). **The description, author and engagement UI are NOT inside the article** in the 2026 "anchoring/cinema" layout. |
| `foryou-active-video-overlay.html` | 4 | `[data-e2e="anchoring-description-layer"]`, `[data-e2e="anchoring-engagement-vertical"]`, `[data-e2e="cinema-creator-identity"]`, `[data-e2e="anchoring-chrome-host"]` — the fixed overlay for the currently playing video (author `[data-e2e="video-author-avatar"]`, `[data-e2e="video-desc"]` with `[data-e2e^="desc-span-"]` runs + `[data-e2e="search-common-link"]` hashtag links, `[data-e2e="like-count"]`, `comment-count`, `favorite-count`, `share-count`, `[data-e2e="cinema-video-info-follow"]`). |
| `explore-items.html` | 3 | `div[data-e2e="explore-item"][role="button"]` inside `div#explore-item-list[data-e2e="explore-item-list"]`. Card = `a[href*="/video/"]` (absolute `https://www.tiktok.com/@user/video/<id>`), `<img alt="<caption> created by <name> with <sound>">`, `[data-e2e="explore-card-info"]` > `[data-e2e="explore-card-info-left"]` > `[data-e2e="explore-card-like-container"]`. The author link `[data-e2e="explore-card-user-link"]` / `[data-e2e="explore-card-user-unique-id"]` and `[data-e2e="explore-card-desc"]` exist on the page (24 each) but were rendered **outside** the `explore-item` element at capture time (lazy), so they are not in this fixture. |

Observed `data-e2e` values on /foryou (counts): `recommend-list-item-container` 5, `feed-video` 2,
`anchoring-*` (ambient 2, chrome-host, description-layer, engagement-vertical, playback-chrome,
playback-control-play, playback-time, player-column, progress-bar, scroll-controls) 1 each,
`cinema-creator-avatar/identity`, `cinema-playback-control-captions/speed/volume`,
`cinema-video-info-follow`, `video-author-avatar`, `video-desc`, `desc-span-0`, `desc-span-1_0`,
`desc-span-1_3`, `desc-span-2_1`, `multiline-text-content`, `multiline-text-fold-button`,
`like-icon/count`, `comment-icon/count`, `favorite-icon/count`, `share-icon/count`, `more-menu-icon`,
`feed-navigation-prev/next`, `login-modal`, `login-title`, `nav-*`, `search-box`, `top-login-button`.
Class names are hashed (`css-evcxon-7937d88b--ArticleItemContainer`) — never select on them.

## AI label (AIGC)

* **No `[data-e2e*="aigc"]` element and no "AI-generated" text was rendered** on any video the
  logged-out session could reach (the For You feed could not be advanced past video 1, and the
  explore cards do not show labels). The label DOM is therefore still **UNVERIFIED** — adapters must
  treat `[data-e2e="aigc-tag"]` (from DESIGN.md/rules.json) as a hypothesis and fall back to text
  matching on the strings below.
* Exact UI strings, taken verbatim from the page's i18n bundle
  (`#__UNIVERSAL_DATA_FOR_REHYDRATION__` → `__DEFAULT_SCOPE__["webapp.i18n-translation"]`):
  * `Webapp.syntheticMedia_feed_bottomBanner_AIGCLabel` = **"Creator labeled as AI-generated"**
  * `Webapp.aigcInfoPanel_feed_label` = **"Contains AI-generated media"**
  * `Webapp.reportFlowUpdate2_reportPg_optMisinfoAI_title` = "Misinformation or AI-generated content"
  * `Webapp.aigcDisclaimer_searchPg_genera2lLabelTNS_desc` = "Summarized by AI for reference only" (search AI summary, not a content label)
  * `Webapp.seo_popular_disclaimer` = "This is an AI-generated summary of the content…" (SEO text, NOT a content label — exclude)
  * `Webapp.remixToggle_settings_allowRemixToggle_desc` = "Others can create AI-generated content of your posts." (settings, exclude)
* Feature flags seen in `webapp.a-b`: `show_aigc_label_web: {vid: "v1"}`, `show_aigc_toggle`.
* JSON item keys (from the SSR'd `webapp.updated-items` / recommend item list embedded in the
  page source), verbatim context around the key:
  ```
  "item_control":{"can_repost":true},"IsAigc":false,"aigcLabelType":"2","AIGCDescription":"","ShowAIGC":true,"backendSourceEventTracking":"","CategoryType":120
  ```
  Keys: `IsAigc` (bool), `aigcLabelType` (string; value `"2"` observed on a **non**-AI item with
  `IsAigc:false`, so `aigcLabelType` alone is NOT a positive signal — pair it with `IsAigc===true`
  or a non-empty `AIGCDescription`), `AIGCDescription` (string), `ShowAIGC` (bool). Observed on
  every item: `"IsAigc":false`. `moderationAigcLabelType` (listed in DESIGN.md) was **not** present
  in the page source.
