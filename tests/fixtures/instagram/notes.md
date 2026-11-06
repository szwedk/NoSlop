# instagram.com — logged-out observation (NO fixture; login was not attempted)

Checked 2026-11-02 ~23:10 UTC, headless Chromium 152, desktop viewport 1366x900, logged out.

| URL | What renders |
|---|---|
| https://www.instagram.com/ | Login page: one `<form>` (inputs are present but not named `username`/`password` in the current markup), `a[href*="/accounts/emailsignup/"]`, text "See everyday moments from your close friends. Log into Instagram …". **Zero** `main[role="main"]`, zero `article`, zero `section`. |
| https://www.instagram.com/explore/ | "Popular on Instagram" — `main[role="main"]` exists (1) but contains only topic/hashtag links ("Nycmarathon • 24 posts …"); **zero** `article`, zero `a[href^="/p/"]`, zero `a[href^="/reel/"]`. |

Implication for `adapters/instagram.js`: `main[role="main"] article` is the item root and is absent
when logged out, so `findItems()` returns `[]`. The explore page's `main` without articles must not
be mistaken for a feed. Instagram fixtures must be **synthetic** (README) built from research §2.4
(`main[role="main"] article`, header `a[href^="/"]`, the "AI info" / "Imagined with AI" label text).

## Adapter-owned synthetic files (added by adapter:instagram, 2026-11-02)
`synthetic-reels.html`, `synthetic-explore.html`, `synthetic-mobile-feed.html` are owned by the instagram adapter agent
(headers document every hypothesis). Note that the 3rd article of `synthetic-feed.html` deliberately has no `/p/` link:
the adapter's fallback id for it is `t:<handle>:<time datetime>`.
