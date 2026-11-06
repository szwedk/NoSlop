# m.youtube.com fixtures — capture notes

Captured 2026-11-02 22:57–23:03 UTC with headless Chromium 152 in a **mobile emulation preset**
(375x812, Android 14 / Pixel 8 Chrome 152 Mobile UA — the harness cannot emulate iOS Safari; the
`ytm-*` DOM is the same app Safari on iPhone gets), logged out, then reset to desktop. Same stripping
as the desktop fixtures. Each file has a comment header with url/timestamp/viewport.

### Search `https://m.youtube.com/results?search_query=ai+generated+shorts` (after 2 scrolls)
Counts: `ytm-video-with-context-renderer` 20 · `grid-shelf-view-model` 2 (Shorts shelves, 4 `ytm-shorts-lockup-view-model` each) ·
`ytm-shorts-lockup-view-model` 8 · `ytm-reel-shelf-renderer` **0** · `ytm-rich-item-renderer` 0 (search does not use it) ·
`ytm-item-section-renderer` 1 (`lazy-list > ytm-video-with-context-renderer | grid-shelf-view-model`) · `ytm-search` 1 ·
`ytm-section-list-renderer` 1 · `ad-slot-renderer` 0 · `ytm-badge` 0 · `badge-shape` 26 = `.ytBadgeShapeText` 26 (durations, `4K`).

| File | Nodes | Notes |
|---|---|---|
| `search-video-with-context-renderer.html` | 3 `ytm-video-with-context-renderer.item.adaptive-feed-item` | `ytm-media-item > a.media-item-thumbnail-container[href^="/watch?v="]`, `ytm-thumbnail-cover`, `ytm-thumbnail-overlay-time-status-renderer > badge-shape`, `ytw-channel-thumbnail-with-link-renderer`, title `h3` / `.media-item-headline`, byline `ytm-badge-and-byline-renderer` ("Youri van Hofwegen•362K views•3 months ago"), channel `a[href^="/@"]` (`/@Yourivanhofwegen`, `/@ShekharNova07`, `/@ThePhoneGuardian`), `ytm-badge-supported-renderer > yt-metadata-badge-renderer` (4K), `ytm-bottom-sheet-renderer` menu. The third node had an inline preview (`ytm-video-preview`) running. The second node is a Short (`/shorts/` href) rendered as a normal result. |
| `search-shorts-shelf.html` | 2 `grid-shelf-view-model` | `ytm-shorts-lockup-view-model` cards: `a.shortsLockupViewModelHostEndpoint[href^="/shorts/"]`, `.shortsLockupViewModelHostThumbnailParentContainer`, title + view count. |

### Watch `https://m.youtube.com/watch?v=Qqc0pav5wEI` (AI-labelled)
Counts: `ytm-watch` 1 · `ytm-slim-video-metadata-section-renderer` 1 (children `ytm-slim-video-information-renderer`,
`ytm-slim-video-action-bar-renderer`) · `ytm-single-column-watch-next-results-renderer` 1 · `ytm-item-section-renderer` 2
(`[section-identifier=null]` with `yt-video-metadata-carousel-view-model`; **`[section-identifier="related-items"]`** with
`lazy-list > ytm-video-with-context-renderer ×12, ytm-continuation-item-renderer`) · `ytm-compact-autoplay-renderer` 0 ·
`ytm-badge-supported-renderer` 5 · `yt-metadata-badge-renderer` 3 · `.ytBadgeShapeText` 15 (texts: **`AI`**, durations, `New`).
The watch HTML had **0** `"howThisWasMadeSectionViewModel":{` — mobile loads the description panel lazily over
`/youtubei/v1/next`; the section only appears after tapping "more" (1 node afterwards).

| File | Nodes | Notes |
|---|---|---|
| `watch-ai-labelled-metadata.html` | 1 `ytm-slim-video-metadata-section-renderer` | title `h2`/`.slim-video-information-title`, owner `@CreativeAIAds` (`a[href^="/@"]`), and the AI badge: `span.slim-video-subtitle-substring.slim-video-information-inline-badge > ytm-badge-supported-renderer.ytmBadgeSupportedRendererHost > yt-metadata-badge-renderer > badge-shape.ytBadgeShapeHost.ytBadgeShapeDefault.ytBadgeShapeTypography[role="img"][aria-label="AI"] > .ytBadgeShapeIcon + .ytBadgeShapeText` = **"AI"**. NOTE the mobile aria-label is just **"AI"** (desktop: "AI: Content was made with AI"). |
| `watch-related-video-with-context.html` | 3 `ytm-video-with-context-renderer` | from `ytm-item-section-renderer[section-identifier="related-items"] > lazy-list`. |
| `watch-how-this-was-made.html` | 1 `how-this-was-made-section-view-model` | same classes as desktop (`ytwHowThisWasMadeSectionViewModel*`): "How this was made" / **"Made with AI"** / "Sounds or visuals were altered or fully generated. Learn more". Ancestry: `… < ytm-structured-description-content-renderer < … < ytm-engagement-panel-section-list-renderer < ytm-engagement-panel < panel-container < ytm-app#app`. |
| `watch-description-panel.html` | 1 `ytm-engagement-panel-section-list-renderer` | the whole expanded description panel (`yt-video-title-header-view-model`, `ytm-video-description-header-renderer`, `ytw-sentiment-factoid-renderer`, `ytm-expandable-video-description-body-renderer`, the how-this-was-made section, `ytm-video-description-infocards-section-renderer`). |

Recommended mobile selectors: `ytm-slim-video-metadata-section-renderer badge-shape[aria-label="AI"]` (exact match — the
desktop prefix form is absent) and `how-this-was-made-section-view-model .ytwHowThisWasMadeSectionViewModelBodyHeader`
text "Made with AI" (ignore "Auto-dubbed").

### Home `https://m.youtube.com/` (after 2 scrolls)
Counts: `.tab-content[tab-identifier="FEwhat_to_watch"]` 1 · `ytm-rich-grid-renderer` 1 · `ytm-rich-item-renderer` 7
(every one `> yt-lockup-view-model`) · `ytm-rich-section-renderer` 3 (children: a `div`, `ytm-backstage-post-thread-renderer`,
`grid-shelf-view-model`) · `ytm-shorts-lockup-view-model` 4 · `ytm-rich-shelf-renderer` 0 · `ytm-reel-shelf-renderer` 0 ·
`ytm-video-with-context-renderer` 0 · `ad-slot-renderer` 0 · `ytm-feed-nudge-renderer` 0 · `.ytBadgeShapeText` 7 (durations only).

| File | Nodes | Notes |
|---|---|---|
| `home-rich-item-renderer.html` | 3 `ytm-rich-item-renderer` | each wraps `yt-lockup-view-model` (same component as desktop: `a[href^="/watch?v="]`, `.yt-lockup-metadata-view-model__heading`, `content-id-<id>` class). No `a[href^="/@"]` channel link inside (channel is text). |
| `home-shorts-shelf-section.html` | 1 `ytm-rich-section-renderer.rich-section-single-column` | `> … > grid-shelf-view-model > … ytm-shorts-lockup-view-model` (Shorts shelf; ancestry `… < .rich-grid-renderer-contents < ytm-rich-grid-renderer.rich-grid-single-column < ytm-tab-renderer < .tab-content < … < ytm-single-column-browse-results-renderer.modern-tabs < ytm-browse < ytm-app#app`). Research's `ytm-rich-section-renderer:has(ytm-reel-shelf-renderer)` must be widened to `:has(grid-shelf-view-model)`. |
| `home-community-post-section.html` | 1 `ytm-rich-section-renderer` | `ytm-backstage-post-thread-renderer` community post in the feed. |
