# facebook.com — logged-out observation (NO fixture; login was not attempted)

Checked 2026-11-02 ~23:12 UTC, Claude Browser pane, desktop viewport 1366x900, logged out.

| URL | What renders |
|---|---|
| https://www.facebook.com/ | Login page. `div[role="main"]` = 1 (wraps the login form), `<form>` with `input[name="email"]` and `input[name="pass"]`, `a[href*="/login/"]`. **Zero** `div[role="feed"]`, zero `div[aria-posinset]`, zero `div[role="article"]`. |
| https://www.facebook.com/watch/ | Public "Facebook Video" shell: `div[role="main"]` = 2, a `[role="dialog"]` login prompt, two login forms, hashtag chips ("Explore … AEWDynamite …"). Still **zero** `div[role="feed"]` / `div[aria-posinset]` / `div[role="article"]`. |

Implication for `adapters/facebook.js`: key off `div[role="feed"]` / `div[aria-posinset]` /
`div[role="article"]` only; `div[role="main"]` alone is present on the login page and must not
trigger work. Facebook fixtures must be **synthetic** (README) built from research §2.5 (feed unit
`div[role="main"] div[aria-posinset]`, `div[role="article"]`, "Sponsored" text, "AI info" label text),
and hide with `height:0;overflow:hidden` on the cell (DESIGN.md §4 `height-zero`).
