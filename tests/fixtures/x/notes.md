# x.com — logged-out observation (NO fixture; login was not attempted)

Checked 2026-11-02 ~23:10 UTC, Claude Browser pane, desktop viewport 1366x900, logged out.

| URL | What renders |
|---|---|
| https://x.com/home | Redirects to `https://x.com/i/jf/onboarding/web?redirect_after_login=%2Fhome&mode=login`. A single `[role="dialog"]` ("See what's happening · Continue with phone / Google / Apple · Email or username · Continue") and one `<form>`. **Zero** `[data-testid]` elements of any kind: no `cellInnerDiv`, no `article[data-testid="tweet"]`, no `primaryColumn`, no `BottomBar`. |
| https://x.com/explore | Same onboarding redirect (`redirect_after_login=%2Fexplore`), same dialog, zero `[data-testid]`. |

Implication for `adapters/x.js`: when `document.querySelector('[data-testid="primaryColumn"]')`
is null the adapter has nothing to do; `findItems()` must return `[]` and the engine should idle
(the 1 s safety sweep is enough). Do not treat the onboarding `[role="dialog"]` as a cell.
Real tweet fixtures for X must be **synthetic** (see README) — build them from the selector table in
docs/research/platform-dom-and-ai-labels.md §2.1 (`[data-testid="cellInnerDiv"]` >
`article[data-testid="tweet"]`, `[data-testid="tweetText"]`, `[data-testid="User-Name"]`,
`[data-testid="placementTracking"]`, `a[href^="/i/grok/share/"]`).
