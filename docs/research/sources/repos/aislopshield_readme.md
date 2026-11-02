# AI Slop Shield

A tiny Firefox extension that hides videos YouTube itself labels as **altered or synthetic content** ("Made with AI") from your feeds, search results, and recommendations — and blocks direct visits to labeled watch pages.

![License](https://img.shields.io/badge/license-MIT-blue)
![Firefox](https://img.shields.io/badge/browser-Firefox-orange)

## Why

YouTube labels creator-disclosed and auto-detected AI content, but the label is small and easy to miss. This extension uses YouTube's own signal — the official disclosure — instead of crowd-sourced channel blocklists. If YouTube says it's AI, it disappears.

## What it does

- **Hides AI-labeled video cards** on the home feed, search results, the watch-page sidebar, and grids
- **Blocks watch pages** of labeled videos: playback is paused and an overlay offers *Watch anyway* or *Go back*
- **Manual channel blocklist**: on any watch page, open the floating panel and click **Block this channel** — all videos from that channel are hidden everywhere (catches unlabeled AI channels the disclosure system misses). Unblock from the same panel at any time
- **Blocked list**: every blocked video is logged (title, URL, time, reason) to localStorage, viewable in the floating panel
- **Watch-page fallback**: when the disclosure only exists in the page's embedded JSON (common), the extension fetches the page HTML and checks for it
- **Blocked list**: every blocked video is logged (title, URL, time) to localStorage. A floating button in the corner of YouTube shows the count and opens a panel where you can view, copy, or clear the list
- 100% client-side, no external requests (beyond youtube.com itself), no data collection

## Install (temporary / development)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select the `manifest.json` file in this repo

## How detection works

| Surface | Method |
|---|---|
| Feed / search / sidebar cards | Scans for the visible "AI" badge (`.ytBadgeShapeText`) or "Altered or synthetic / Made with AI" text; also hides cards from channels on your manual blocklist |
| Watch page | Checks for the `how-this-was-made` disclosure panel or "AI" title badge in the DOM; falls back to fetching the page HTML and matching the embedded `howThisWasMadeSectionViewModel` disclosure. Blocked channels get the same treatment |

A `MutationObserver` re-scans as YouTube loads content dynamically, so infinite scroll and SPA navigation are covered.

## Limitations

- Automatic detection relies on YouTube's labeling. Videos a creator fails to disclose (and YouTube's systems don't catch) will not be auto-blocked — use **Block this channel** for those.
- Feed cards without a visible badge are not pre-checked — that would require fetching every watch page, which this extension deliberately avoids for performance and privacy.
- Label selectors are specific to YouTube's current DOM and may break when YouTube updates its frontend. PRs welcome.
- Label text matching is English-only for now.

## Privacy

The extension stores its blocked-video log in `localStorage` on `youtube.com` only. The one extra request it makes is a same-origin fetch of a watch page you are already visiting. Nothing is sent anywhere else.

## License

MIT
