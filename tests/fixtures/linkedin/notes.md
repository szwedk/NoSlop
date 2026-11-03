# linkedin.com — logged-out observation (NO fixture; login was not attempted)

Checked 2026-11-02 ~23:13 UTC, Claude Browser pane, desktop viewport 1366x900, logged out.

| URL | What renders |
|---|---|
| https://www.linkedin.com/feed/ | 302 → `https://www.linkedin.com/login/?session_redirect=…`. Title "LinkedIn Login, Sign in \| LinkedIn". One `<main>`, sign-in form ("Sign in with Apple … Email or phone … Password"); the inputs are not named `session_key`/`session_password` in this build. `[data-testid]` values present: only `toasts-title`, `lazy-column`. **Zero** `div[data-testid="mainFeed"]`, zero `[role="listitem"][componentkey^="update-card-focus"]`, zero `.feed-shared-update-v2`. |
| https://www.linkedin.com/pulse/topics/home/ | 302 → `/top-content/` ("Top Content on LinkedIn"), a public topic directory: one `<main>`, zero `[role="listitem"]`, zero `article`, no feed. |

Implication for `adapters/linkedin.js`: gate everything on `div[data-testid="mainFeed"]`; when it is
absent return no items. LinkedIn fixtures must be **synthetic** (README) built from research §2.8
(`div[data-testid="mainFeed"]`, `[role="listitem"][componentkey^="update-card-focus"]`, "Promoted"
text, C2PA icon is UNVERIFIED).

## Adapter-owned synthetic file (added by adapter:linkedin, 2026-11-02)
`synthetic-feed-labels.html` is owned by the linkedin adapter agent; its header documents every label-placement hypothesis
("Written by AI" / "Created with AI" / "AI-assisted" outside the body, the C2PA "Content credentials" button).
