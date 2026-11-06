# NoSlop

NoSlop hides AI-generated content and "AI slop" in social feeds. One codebase ships an iPhone app and a
Mac app that each wrap the same Safari Web Extension (plain JS, no bundler), plus a Chrome build of the
same extension folder. There is no account, no backend and no ML model: a rules file, per-site DOM
adapters and a pure scorer run inside the browser.

## What it can and cannot do

- iPhone: no app can see or change what the native Instagram, X or YouTube apps show. NoSlop filters
  those sites in Safari (instagram.com, x.com, m.youtube.com). Home-Screen web apps do not run Safari
  extensions. Private Browsing needs its own per-extension toggle.
- Mac: X, Instagram and YouTube have no native apps, so Safari (or the Chrome build) covers everything.
- High-precision signals can hide a post: platform AI labels per site (YouTube "Made with AI" /
  "How this content was made", Meta "AI info" / "Imagined with AI", TikTok's AI-generated tag,
  X "Made with AI" and Grok links, Reddit AI flairs, LinkedIn "Created with AI"), self-disclosure
  ("made with Midjourney"), AI hashtags, tool names, chatbot residue, prompt metadata, blocked accounts
  and bundled seed lists.
- Style tells (listicle rhythm, engagement bait, vocabulary clusters) are low-precision and only dim.
- Unlabelled, undisclosed AI images cannot be reliably detected on-device. NoSlop does not pretend otherwise.

## Install

### Mac

```
scripts/build-mac.sh          # signed Debug build -> build/NoSlop.app
open build/NoSlop.app
```

Then Safari ▸ Settings ▸ Extensions ▸ tick NoSlop Extension and allow it on every website (or per site).
Unsigned builds also need Safari ▸ Settings ▸ Developer ▸ Allow unsigned extensions (resets when Safari quits).

### iPhone (iOS 17+, iOS 26.1+ recommended)

```
scripts/build-ios.sh          # -> build/NoSlop-iOS.app and build/NoSlop-iOS.ipa
scripts/install-iphone.sh     # installs on the first paired iPhone via devicectl
```

Then on the iPhone: Settings ▸ Apps ▸ Safari ▸ Extensions ▸ NoSlop ▸ Allow Extension, and set
All Websites to Allow. The App Group (`group.com.szwedk.noslop`) that syncs settings between the app and
the extension needs an Apple provisioning profile with the App Groups capability. If the portal cannot
issue one, `NOSLOP_NO_APP_GROUP=1 scripts/build-ios.sh` builds a sideload without settings sync.

### Chrome

```
npm run build:chrome          # -> dist/chrome
```

Load `dist/chrome` as an unpacked extension (chrome://extensions, Developer mode).

## Build and test

```
npm install
npm test                      # node --test, jsdom fixtures, golden corpus
xcodegen generate             # regenerates NoSlop.xcodeproj from project.yml
scripts/test.sh               # full bar: tests, rules check, syntax check, Chrome build,
                              # macOS and iOS builds, bundle checks (NOSLOP_SKIP_IOS=1 skips iOS)
```

`rules.js` is generated from `rules.json` (`npm run build:rules`); `--check` verifies they are in sync.

## Repository layout

```
project.yml                 XcodeGen spec: iOS app + extension, macOS app + extension
Extension/Resources/        the web extension (Safari manifest)
  manifest.json, rules.json, rules.js (generated)
  lib/                      dom.js, scorer.js, engine.js, host-extension.js, host-webview.js, tiktok-main.js
  adapters/                 one file per site: youtube, x, instagram, facebook, tiktok, reddit, linkedin
  content.js, content.css, background.js, popup/
Extension/Shared/           SafariWebExtensionHandler.swift, NoSlopSharedStore.swift
App/Shared, App/iOS, App/macOS   SwiftUI app (Home, Sites, Lists, Platform controls, About)
tools/                      build-rules.mjs, build-chrome.mjs, check-bundle.mjs, live-inject.mjs
scripts/                    build-mac.sh, build-ios.sh, install-iphone.sh, test.sh
tests/                      node --test suites, fixtures (real captures and marked synthetic), corpus
docs/                       DESIGN.md, STATUS.md, USER-GUIDE.md, research/
```

## Status and design

- `docs/STATUS.md`: what is verified against real DOM, what is synthetic, known gaps.
- `docs/DESIGN.md`: the engineering contract (script loading, rules schema, engine, scorer, host, native
  messaging, Chrome build, verification bar).
- `docs/USER-GUIDE.md`: install and usage.

## Privacy

No backend, no telemetry. The only network requests are the YouTube and TikTok page prefetch that reads a
video's own AI label, and a list import the user triggers from a URL.
