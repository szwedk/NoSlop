# NoSlop — user guide

NoSlop removes AI-generated content and "AI slop" from social feeds. It is a Mac app and an iPhone app that each
contain the same Safari Web Extension. There is no account, no backend and no telemetry: everything runs inside
Safari on your device.

## 1. What NoSlop can and cannot do (read this first)

- **iPhone:** Apple gives no app any way to see or change what the native Instagram, X or YouTube apps show.
  NoSlop filters those sites **in Safari** — open instagram.com, x.com and m.youtube.com in Safari instead of
  the apps. If you want to force that, add a Screen Time limit to the native app.
- **Mac:** X, Instagram and YouTube have no native Mac apps, so Safari (or the Chrome build) is everything.
- **Home-Screen web apps** (sites you added to the iPhone Home Screen) do **not** run Safari extensions. Use a
  Safari tab or bookmark instead.
- **Private Browsing** needs its own per-extension toggle (see below) — otherwise NoSlop is off in private tabs.
- **What is detected:** platform AI labels (YouTube "Altered or synthetic" / "How this content was made", Meta
  "AI info" / "Imagined with AI", TikTok's AI-generated tag, X "Made with AI" and Grok links), self-disclosure
  ("made with Midjourney"), AI hashtags, tool names, chatbot residue, your blocked accounts and seed lists.
  These are high-precision and can **hide** a post.
  Two caveats: on Facebook, Meta moved the "AI info" label for AI-*edited* posts into the "…" menu (Sept 2024), so only
  posts whose label is shown inline (AI-generated) are caught; on a non-English Instagram/Facebook UI the label text differs
  ("KI-Info" in German, for example) and NoSlop's label matching has no recall until the localized string is added
  (hashtags, self-disclosure and blocked accounts still work).
- **Style tells** (listicle rhythm, engagement bait, "let that sink in", em-dash salad…) are low-precision and
  can only **dim** a post, never hide it. Unlabelled, undisclosed AI images cannot be reliably detected
  on-device in 2026 — NoSlop does not pretend otherwise.

## 2. Install on a Mac

1. Build or download `NoSlop.app` (`scripts/build-mac.sh` produces `build/NoSlop.app`) and move it to
   `/Applications`. Open it once; it registers the extension with Safari.
2. Safari ▸ **Settings ▸ Extensions** ▸ tick **NoSlop Extension**. Or click **Open Safari Extension Settings**
   on the app's Home tab.
3. Under the extension's permissions choose **Always Allow on Every Website** (or allow youtube.com, x.com,
   instagram.com, facebook.com, tiktok.com, reddit.com, linkedin.com individually).
4. Developer / unsigned builds only: Safari ▸ Settings ▸ Advanced ▸ "Show features for web developers",
   then Safari ▸ Settings ▸ Developer ▸ **Allow unsigned extensions** (this resets every time Safari quits).
5. For Private Browsing: Safari ▸ Settings ▸ Extensions ▸ NoSlop Extension ▸ tick **Allow in Private Browsing**.

## 3. Install on an iPhone

Requires iOS 17 or later (iOS 26.1+ recommended; iOS 26.0 had a bug that shows freshly installed extensions
as "no longer available").

1. Build: `scripts/build-ios.sh` (signed with your Apple Development team) → `build/NoSlop-iOS.app` and
   `build/NoSlop-iOS.ipa`. Plug the iPhone in, unlock it, trust the Mac, then run `scripts/install-iphone.sh`.
   (Alternative: open `NoSlop.xcodeproj`, select the `NoSlop-iOS` scheme and your iPhone, press Run.)
2. On the iPhone open **Settings ▸ Apps ▸ Safari ▸ Extensions ▸ NoSlop**.
3. Turn on **Allow Extension**.
4. Under *Permissions* set **All Websites** (or each site) to **Allow**.
5. Optional: turn on **Private Browsing** on the same screen if you use private tabs.
6. In Safari open instagram.com, x.com or m.youtube.com. Tap the puzzle-piece icon in the address bar: NoSlop
   should be listed as active. The first visit to each site may ask you to allow the extension for a day or always.

iOS has no deep link into Safari's extension settings, so these steps are manual; the app's Home tab repeats them.

## 4. The app

- **Home** — master on/off switch, how many items were hidden/dimmed today and over the last 7 days, the
  "Enable in Safari" steps for your platform and the honest ceiling.
- **Sites** — per-site mode and the surface toggles.
  - **Strict** hides at a lower score (0.8) and dims at 0.4: platform labels, disclosures, AI hashtags, tool
    names and blocked accounts hide; style tells dim earlier.
  - **Balanced** (default) hides only high-precision signals (score ≥ 1.0: platform labels, disclosures,
    blocked accounts) and dims at 0.6; style tells only dim.
  - **Off** disables NoSlop on that site.
  - *Surfaces*: hide YouTube Shorts, Instagram Reels, X posts made with Grok, TikTok's For You feed, ads.
  - *YouTube prefetch*: fetches a video's watch page in the background to read its "How this content was
    made" label before you click. Costs bandwidth; lower the concurrency on slow connections.
  - *Behaviour*: show or hide the "Hidden: AI content — reason · Show · Never show @author" stubs, dim instead
    of hide, and auto-block accounts after N labelled hits.
- **Lists** — blocked and allowed accounts per site, custom phrases and hashtags. Allowed accounts always win.
  **Import list from URL** fetches a plain-text list (one entry per line) or a JSON array of strings and
  appends it to the selected list. This is the only network request the app ever makes, and only when you
  tap Import. Use it for lists NoSlop cannot bundle for licence reasons (AiSList, OpenSlop).
- **Platform controls** — the platforms' own tools: copy the X *Muted words* list, Instagram *Hidden Words*
  and *Your Algorithm* topics, and follow the TikTok AIGC-slider and YouTube "Don't recommend" paths. The
  platforms offer no API for these, so NoSlop gives you the list and the path.
- **Clean Feeds** (developer/sideload builds only) — Instagram, X and YouTube inside the app with the same
  filtering scripts injected. Logins persist between launches. It is a reader you configure, not a
  replacement for the sites' apps, and it is not part of App Store builds.
- **About** — the honest ceiling, how scoring works, licences.

Settings are shared with the Safari extension through the App Group; a change in the app reaches the
extension on its next page load or popup open (last writer wins).

## 5. Updating lists and rules

- **Your lists** (blocked/allowed accounts, phrases, hashtags) live in the app and the extension popup.
  "Never show @author" on a hidden-item stub adds the account to the blocked list; undo it in **Lists**.
- **Imported lists** are appended, never replaced — re-import a URL to pick up new entries (duplicates are skipped).
- **Bundled rules** (`rules.json`: selectors, label strings, lexicon, seed lists) ship with each app update.
  The rules version is shown on the About tab.
- To reset everything: Sites ▸ **Reset all settings to defaults**.

## 6. Troubleshooting

- *Nothing is hidden:* check the extension is enabled for that site (puzzle icon), the site mode is not Off,
  and you are not in a Home-Screen web app or a private tab without the Private Browsing toggle.
- *"NoSlop Extension is no longer available" on iPhone:* update to iOS 26.1 or later and reinstall.
- *Counts stay at 0 in the app:* the extension writes stats through the App Group on each batch; browse a
  feed for a minute, then tap Refresh on Home. Developer sideloads built with `NOSLOP_NO_APP_GROUP=1` do not sync.
- *Mac: extension missing from Safari's list:* open the app once, then relaunch Safari. Unsigned builds need
  "Allow unsigned extensions" again after every Safari restart.
