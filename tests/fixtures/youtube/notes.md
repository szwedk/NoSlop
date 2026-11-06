# youtube.com (desktop) fixtures — capture notes

Captured 2026-11-02 22:49–23:20 UTC with headless Chromium 152 (UA
`Chrome/152.0.7977.167`), **logged out**, viewport emulated at 1366x900, dark theme.
Real DOM: `node.cloneNode(true)` then svg/style/script/iframe/noscript/template/link removed,
`style`/`srcset`/`tabindex`/`draggable`/`nonce`/`jsaction` attrs removed, `data:`/base64/>1500-char
attribute values replaced by `[stripped]`, comments dropped, whitespace collapsed. Every file starts
with an HTML comment header (url, timestamp, viewport, node count). No personal data.

## Pages and what was on them

### Search `https://www.youtube.com/results?search_query=ai+generated+shorts` (after 2 scrolls)
Counts: `ytd-video-renderer` 6 · `yt-lockup-view-model` 1 (it was an ad) · `ytd-ad-slot-renderer` 5
(`ytd-in-feed-ad-layout-renderer` 5) · `grid-shelf-view-model` 2 (the Shorts shelves) ·
`ytm-shorts-lockup-view-model` 15 (inside `ytm-shorts-lockup-view-model-v2`) · `ytd-reel-shelf-renderer` **0**
(search uses `grid-shelf-view-model` now) · `ytd-item-section-renderer` 7 · `ytd-badge-supported-renderer` 41 ·
`.ytBadgeShapeText` 19 (texts: `Sponsored`, durations, `4K`, empty) · `.badge-shape-wiz__text` **0** (legacy class gone).
Section children order: `ytd-search-pyv-renderer, grid-shelf-view-model, ytd-video-renderer` / `ytd-ad-slot-renderer` / …
Ad slot ancestry: `ytd-ad-slot-renderer < #contents < ytd-search-pyv-renderer < … < ytd-item-section-renderer`.

| File | Nodes | Notes |
|---|---|---|
| `search-video-renderer.html` | 3 `ytd-video-renderer` | attrs `is-search use-search-ui lockup="true" bigger-thumbs-style="BIG"`; title `a#video-title[href^="/watch?v="]` (href carries `&pp=…`), channel `ytd-channel-name a[href^="/@"]` (`/@TrevorNace`, `/@TheoreticallyMedia`, `/@kellanhenneberry`), badges `badge-shape > .ytBadgeShapeText`, `ytd-badge-supported-renderer` (`4K`). |
| `search-lockup-view-model.html` | (merged into `search-ad-slot.html`) | the only `yt-lockup-view-model` on search was the Squarespace ad. |
| `search-ad-slot.html` | 1 `ytd-ad-slot-renderer` | `ytd-ad-slot-renderer > #fulfilled-layout > ytd-in-feed-ad-layout-renderer > #rendering-content > video-display-compact-button-group-layout-view-model > yt-lockup-view-model`. Ad markers: `ad-badge-view-model badge-shape.ytBadgeShapeAd .ytBadgeShapeText` = **"Sponsored"**, `feed-ad-metadata-view-model`, `ad-avatar-view-model`, `button[aria-label="My Ad Center"]`, content id class `content-id-THTWc69K0c4` on `.ytLockupViewModelHost`. |
| `search-shorts-shelf.html` | 2 `grid-shelf-view-model` | each holds `ytm-shorts-lockup-view-model-v2 > ytm-shorts-lockup-view-model` cards (`a.shortsLockupViewModelHostEndpoint[href^="/shorts/"]`, title `h3`/`.shortsLockupViewModelHostMetadataTitle`). Shelf title text "Shorts". |
| `search-ai-labelled-card.html` | 1 `ytm-shorts-lockup-view-model` | the search card for Qqc0pav5wEI (which IS "Made with AI" on its watch page) — **no AI badge on the card** (badges: none). |
| `search-ai-labelled-long-form-card.html` | 1 `ytd-video-renderer` | the card for 5VSjuLoTH-0 (watch page has the title badge + "Made with AI") — badges only `2:29`, `4K`; **no "AI" badge on the card**. Card-level AI badges were not observed anywhere on 2026-11-02 (0 of ~90 cards across search/home/related). |

### Watch `https://www.youtube.com/watch?v=gXtjlubIVgQ` (first search result; NOT AI-labelled, it is Auto-dubbed)
Counts: `#related yt-lockup-view-model` 20 · `ytd-compact-video-renderer` **0** (fully migrated) ·
`ytd-watch-metadata` 1 (children `#above-the-fold`, `ytd-metadata-row-container-renderer`) ·
`ytd-watch-flexy` 1 · `how-this-was-made-section-view-model` 2 (one in `#description-inline-expander`, one in the
`#panels` engagement panel; both 0x0 until the description is expanded) · `ytd-ad-slot-renderer` 1 (in `#related`) ·
`ytd-video-owner-renderer a[href^="/@"]` = `/@TrevorNace`. `#secondary-inner` children: `#panels, #chat-container,
ytd-playlist-panel-renderer#playlist, #inline-panels, #persistent-panel-container, #donation-shelf, #related`.
`#related ytd-item-section-renderer #contents > *` = `ytd-ad-slot-renderer`, `yt-lockup-view-model` ×20, `ytd-continuation-item-renderer`.

| File | Nodes | Notes |
|---|---|---|
| `watch-related-lockups.html` | 3 `yt-lockup-view-model` | title `.yt-lockup-metadata-view-model__heading` / `a.ytLockupMetadataViewModelTitle`, video id in `a[href^="/watch?v="]` AND in class `content-id-<id>` on `.ytLockupViewModelHost`; badges `.ytBadgeShapeText` (`5:39`, `Fundraiser`, `New`…). Related lockups have **no channel link** (`a[href^="/@"]` absent) — channel is plain text in `yt-content-metadata-view-model`. |
| `watch-related-ad-slot.html` | 1 `ytd-ad-slot-renderer` | in `#related`. |
| `watch-metadata.html` | 1 `ytd-watch-metadata` | whole below-player block: `#title h1 yt-formatted-string`, `#owner ytd-video-owner-renderer`, `#description #description-inner ytd-text-inline-expander#description-inline-expander` with `ytd-structured-description-content-renderer#structured-description > #items > …`, `ytd-video-description-infocards-section-renderer`. |
| `watch-how-this-was-made.html` | 2 `how-this-was-made-section-view-model` | **"How this was made" / "Auto-dubbed" / "Audio tracks for some languages were automatically generated. Learn more"** — this is a *false positive* for any `howThisWasMadeSectionViewModel`-only check. |

### Watch `https://www.youtube.com/watch?v=Qqc0pav5wEI` (AI-labelled: "Made with AI")
| File | Nodes | Notes |
|---|---|---|
| `watch-ai-labelled-metadata.html` | 1 `ytd-watch-metadata` | description expanded via `#description-inline-expander #expand` ("more"). Contains the title badge AND the how-this-was-made section. |
| `watch-ai-labelled-badge.html` | 3 | the two `badge-shape` nodes (one in `ytd-watch-metadata #title`, one in the hidden legacy `ytd-video-primary-info-renderer`) + an unrelated comment `<span>` whose text is "AI" (included to show the text-only trap). |
| `watch-ai-labelled-how-this-was-made.html` | 2 | **"How this was made" / "Made with AI" / "Sounds or visuals were altered or fully generated. Learn more"** (link `//support.google.com/youtube/answer/15447836`). First node visible 829x116 after expanding; second (panel copy) 0x0. |

**Title badge DOM (exact):**
```
ytd-watch-metadata #title-row #title > h1 + ytd-badge-supported-renderer[system-icons]
  > yt-badge-supported-renderer.ytBadgeSupportedRendererHost > div.badge-shape.ytBadgeSupportedRendererBadgeShape
  > yt-metadata-badge-renderer.ytMetadataBadgeRendererHost
  > badge-shape.ytBadgeShapeHost.ytBadgeShapeDefault.ytBadgeShapeModern.ytBadgeShapeTypography[role="img"][aria-label="AI: Content was made with AI"]
      > div.ytBadgeShapeIcon[aria-hidden] + div.ytBadgeShapeText[aria-hidden]  →  "AI"
```
Recommended selector: `ytd-watch-metadata badge-shape[aria-label^="AI:"]` (or `.ytBadgeShapeText` text `=== "AI"` scoped to
`ytd-watch-metadata #title`). Do **not** match `.ytBadgeShapeText` text "AI" globally: comments/titles contain "AI" too.
JSON: `metadataBadgeRenderer` with `icon.iconType:"INFO"`, `style:"BADGE_STYLE_TYPE_SIMPLE"`, `label:"AI"`,
`accessibilityData.label:"AI: Content was made with AI"` — see `innertube-snippets.json`.

**Section DOM (exact):** `how-this-was-made-section-view-model.ytwHowThisWasMadeSectionViewModelHost >
.ytwHowThisWasMadeSectionViewModelSectionTitle ("How this was made") + .ytwHowThisWasMadeSectionViewModelBodyHeader
(**"Made with AI"** | **"Auto-dubbed"**) + .ytwHowThisWasMadeSectionViewModelBodyText + .ytwHowThisWasMadeSectionViewModelAttributionText`.
Match on the **BodyHeader** text, never on the element's presence.

**Watch-HTML regex guidance** (for `rules.labels.youtube.watchHtmlRegex` / enrich): the bare word
`howThisWasMadeSectionViewModel` also appears in a renderer-name array in some pages' ytcfg (see snippets), and the
object exists for Auto-dubbed videos. Use `"howThisWasMadeSectionViewModel":\{` **and** require
`"bodyHeader":\{"content":"Made with AI"\}` (or exclude `"Auto-dubbed"`), and/or
`"accessibilityData":\{"label":"AI: Content was made with AI"\}`. Of 27 pages fetched: 15 "Made with AI"
(13 with the title badge, 2 description-only), 10 "Auto-dubbed", 2 without the section (`innertube-snippets.json → surveyed`).
"Altered or synthetic" text did not occur anywhere.

### Home `https://www.youtube.com/` (`/feed/trending` **redirects here** when logged out)
Counts: `ytd-rich-item-renderer` 34 · `ytd-rich-grid-renderer` 1 · `ytd-rich-section-renderer` 3 · `ytd-rich-shelf-renderer` 2 ·
`yt-lockup-view-model` 24 · `ytd-ad-slot-renderer` 4 · `ytm-shorts-lockup-view-model` 10 · `ytd-reel-shelf-renderer` 0 ·
`ytd-video-renderer` 0 · `ytd-grid-video-renderer` 0. `ytd-rich-item-renderer > #content > *` ∈ {`yt-lockup-view-model`,
`ytd-ad-slot-renderer`, `ytm-shorts-lockup-view-model-v2`}. Badge texts included `Sponsored`, `New`, `YouTube featured`,
`Auto-dubbed`, `Earns commission`, `2 products`, durations.

| File | Nodes | Notes |
|---|---|---|
| `home-rich-item-renderer.html` | 3 `ytd-rich-item-renderer` | each `> #content > yt-lockup-view-model`; channel `a[href^="/@"]` present (`/@thisisnickys`, `/@WPLGLocal10`, `/@Kaye.creates`). Hide the OUTER `ytd-rich-item-renderer`. |
| `home-rich-item-ad-slot.html` | 1 | `ytd-rich-item-renderer > #content > ytd-ad-slot-renderer`. |
| `home-shorts-shelf.html` | 1 `ytd-rich-shelf-renderer` | ancestry `ytd-rich-shelf-renderer < #content < ytd-rich-section-renderer < #contents < ytd-rich-grid-renderer`; items `#dismissible > #contents-container > #contents > ytd-rich-item-renderer > #content > ytm-shorts-lockup-view-model-v2 > ytm-shorts-lockup-view-model`; title "Shorts". |
| `home-rich-item-auto-dubbed.html` | 1 | card whose metadata row has `yt-content-metadata-view-model .ytContentMetadataViewModelBadge > yt-badge-view-model > badge-shape > .ytBadgeShapeText` = **"Auto-dubbed"** (no aria-label). This is the slot where a card-level "AI" badge would most likely render if YouTube ships one — none was seen. |

### Channel `https://www.youtube.com/@CreativeAIAds/videos`
`ytd-rich-item-renderer` 1 (`> #content > yt-lockup-view-model`), `yt-page-header-view-model` 1, no channel link inside the
card (channel pages omit it). File `channel-rich-item-renderer.html`. The Videos tab had one video; the channel's AI-labelled
content is all Shorts.

### Shorts `https://www.youtube.com/shorts/Qqc0pav5wEI` (AI-labelled)
Counts: `ytd-shorts` 1 · `ytd-reel-video-renderer` 1 (`#reel-video-renderer`, children `#short-video-container`, `#experiment-overlay`) ·
`yt-reel-player-overlay-view-model` 1 · `ytd-shorts-player-renderer` 0 · `ytd-reel-player-overlay-renderer` 0
(replaced by `ytd-reel-player-overlay-renderer-cow > yt-reel-player-overlay-view-model`). The overlay only renders ~10 s after load.
Ancestry: `yt-reel-player-overlay-view-model < ytd-reel-player-overlay-renderer-cow < #experiment-overlay < ytd-reel-video-renderer#reel-video-renderer < #reel-overlay-container < div#0 < #shorts-inner-container < #shorts-container < ytd-shorts`.

| File | Nodes | Notes |
|---|---|---|
| `shorts-player-overlay-ai-labelled.html` | 1 `yt-reel-player-overlay-view-model` | metapanel `yt-reel-metapanel-view-model` > `yt-reel-channel-bar-view-model` (`@CreativeAIAds`, Subscribe), `yt-shorts-video-title-view-model` (h1), `yt-reel-carousel-view-model` > `button-view-model > button.ytSpecButtonShapeNextHost[aria-label="AI: Content was made with AI"]` whose `.ytSpecButtonShapeNextButtonTextContent` text is **"AI"**, followed by the next-video chip; `reel-action-bar-view-model` (like/dislike/comments/share). |
| `shorts-how-this-was-made.html` | 1 | the "Made with AI" section inside `ytd-shorts #shorts-panel-container ytd-engagement-panel-section-list-renderer ytd-structured-description-content-renderer`. |

Recommended Shorts selector: `yt-reel-player-overlay-view-model button[aria-label^="AI:"]`.
