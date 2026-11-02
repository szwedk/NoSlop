<p align="center">
    <img src="https://raw.githubusercontent.com/KyleBenzle/SlopBlocker/main/logo.png" width="396" alt="Slop Blocker icon">
</p>
<h1 align="center">Slop Blocker - AI Blocker</h1>

<p align="center">Like an ad blocker, but for AI slop.</p>

<p align="center">
  <img src="./Screenshot.png" width="720" alt="Slop Blocker popup">
</p>

Slop Blocker is a Chrome extension that hides AI-generated content on websites: Google AI Overviews, AI-labeled posts, AI images, chatbot spam in comments, that kind of thing. It runs entirely in your browser. No account, no tracking, no server.

## What it blocks

- **Search AI answers.** Google AI Overviews, Bing Copilot, DuckDuckGo Assist, Brave's summarizer
- **Posts labeled as AI by the site itself.** Instagram / Facebook / Threads ("AI info"), Pinterest ("AI modified"), TikTok, YouTube ("Altered or synthetic content")
- **Amazon's AI review summaries**
- **AI images.** Captions or alt text like "Illustration: Midjourney" or "AI-generated", images served from AI generator sites, and images whose metadata says they were AI-made (C2PA / IPTC)
- **AI audio and video** from sites like Suno, Udio and Sora
- **Chatbot leftovers** in comments and reviews ("As an AI language model...")
- **Ads** that are labeled as AI-generated

## Features

- 5 sensitivity levels, from **Labeled Only** (only things clearly marked as AI) up to **Maximum**
- Turn categories on or off: text, images, video, audio, ads, search answers
- Hide things completely, or leave a small placeholder with a **Reveal** button
- **Not AI** button for when it gets something wrong
- One click to turn it off on a site
- Allowlist, blocklist and per-site sensitivity
- Shows why each thing was blocked
- Custom rules in JSON, with import/export
- Optional: use your own OpenAI, xAI, OpenAI-compatible or local Ollama model as an extra check (off by default)
- Light and dark mode

<p align="center">
  <img src="store/screenshot-1-placeholders.png" width="720" alt="Blocked content with placeholders">
</p>

## Install

**From the Chrome Web Store:** _link coming soon_

**From source:**

```bash
git clone https://github.com/KyleBenzle/slop-blocker.git
cd slop-blocker
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the `.output/chrome-mv3` folder



## Slop Blocker Privacy Policy

**Last updated: October 26, 2026**

Slop Blocker is a Chrome extension designed to identify and filter AI-generated content.

## Data Processing

Slop Blocker accesses webpage content to identify potentially AI-generated text and images.

## Local Storage

The extension stores user preferences, filtering settings, and optional API configurations using browser storage.

## Third-Party AI Services

If users enable external AI detection, selected webpage content may be transmitted to their configured AI provider, such as OpenAI or xAI, for analysis. These providers process information under their respective privacy policies.

## Data Usage

User data is used exclusively to provide the extension's filtering functionality. Slop Blocker does not sell user data or use it for advertising.

## User Control

Users can disable filtering, change their settings, remove configured API credentials, or uninstall the extension.

## Policy Updates

This policy may be updated when the extension's functionality or data practices change.

## A fair warning

Nothing can reliably spot all AI content, and this doesn't pretend to. It mostly goes by labels and clear signs, so some slop will get through. The higher you set the slider, the more it catches, but the more likely it is to hide something a real person made.

Two specific things:
- Missing labels or metadata are never treated as proof of anything.
- Writing style alone is treated as weak evidence.

## Privacy

- Everything runs locally in your browser.
- Your settings and history stay on your computer, and you can clear them anytime.
- To check image metadata, it may re-download the start of an image the page already loaded, without cookies.
- Nothing is sent to me or anyone else.
- The only exception is the optional AI check. If you turn it on, text is sent to the AI provider *you* pick, using *your* API key.
- Forms, text boxes, and email/chat sites are never sent.

Full policy: [store/PRIVACY.md](store/PRIVACY.md)

## Development

```bash
npm run dev        # dev build with live reload
npm run compile    # type check
npm test           # unit tests (Vitest)
npm run test:e2e   # loads the real extension in Chromium (run `npx playwright install chromium` first)
npm run zip        # makes the zip for the Chrome Web Store
```

Built with [WXT](https://wxt.dev), TypeScript, React, and Manifest V3.

Where things are:

```
entrypoints/        background worker, content script, popup, settings page
src/core/           detectors, decision engine, filtering, page observer
src/rules/          built-in site rules (builtin.json)
src/providers/      optional AI providers
tests/fixtures/     a test page for every built-in rule
```

## Adding or fixing a site rule

Sites change their pages all the time, so rules break. If something stops getting blocked, a rule fix is the most useful thing you can send.

Rules are plain JSON in `src/rules/builtin.json`:

```json
{
  "id": "example-ai-label",
  "domains": ["example.com"],
  "category": "image",
  "selector": "span, div",
  "textPattern": "^AI generated$",
  "removalTarget": "article",
  "score": 95,
  "explicit": true,
  "reason": "Example.com AI label",
  "enabled": true
}
```

- `selector` + `textPattern` find the label.
- `removalTarget` is the box that gets hidden.

Please add a small test page in `tests/fixtures/<rule-id>.html` and mark what should be hidden (`data-expect="blocked"`) and what should stay (`data-expect="visible"`). The tests check every rule against its page.

Only add rules for things that are actually labeled or clearly AI. "Mentions AI" isn't enough.

## Known gaps

- C2PA signatures are read but not cryptographically verified
- No AI-model checking of images, video or audio yet (text only)
- On YouTube watch pages, a labeled video hides the title/description area, not the player
- Closed shadow DOM and locked cross-origin iframes can't be filtered
- No subscribable rule lists yet

## License

MIT. See [LICENSE](LICENSE).
