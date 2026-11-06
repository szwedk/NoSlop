# NoSlop user guide

NoSlop hides AI-generated content and "AI slop" in social feeds. The Mac app and the iPhone app each contain the
same Safari Web Extension. No account, no backend, no telemetry: everything runs inside Safari on your device.

## 1. What NoSlop can and cannot do

- **iPhone:** no app can see or change what the native Instagram, X or YouTube apps show. NoSlop filters those
  sites **in Safari**: open instagram.com, x.com and m.youtube.com there instead of the apps. A Screen Time limit
  on the native app forces the habit.
- **Mac:** X, Instagram and YouTube have no native Mac apps, so Safari (or the Chrome build) is everything.
- **Home-Screen web apps** do **not** run Safari extensions. Use a Safari tab or bookmark.
- **Private Browsing** needs its own per-extension toggle (below), otherwise NoSlop is off in private tabs.
- **Detected and can hide:** platform AI labels (YouTube "Altered or synthetic" / "How this content was made",
  Meta "AI info" / "Imagined with AI", TikTok's AI-generated tag, X "Made with AI" and Grok links), self-disclosure
  ("made with Midjourney"), AI hashtags, tool names, chatbot residue, your blocked accounts and seed lists.
  Caveats: on Facebook, Meta moved the "AI info" label for AI-*edited* posts into the "..." menu (Sept 2024), so only
  inline (AI-generated) labels are caught; on a non-English Instagram/Facebook UI the label text differs ("KI-Info"
  in German) and label matching has no recall until the localized string is added (hashtags, self-disclosure and
  blocked accounts still work).
- **Style tells** (listicle rhythm, engagement bait, "let that sink in") are low-precision and only **dim**, never
  hide. Unlabelled, undisclosed AI images cannot be reliably detected on-device.

## 2. Install on a Mac

1. Build `NoSlop.app` (`scripts/build-mac.sh` produces `build/NoSlop.app`), move it to `/Applications` and open it
   once; it registers the extension with Safari.
2. Safari ▸ **Settings ▸ Extensions** ▸ tick **NoSlop Extension** (or click **Open Safari Extension Settings** on
   the app's Home tab).
3. Under the extension's permissions choose **Always Allow on Every Website**, or allow youtube.com, x.com,
   instagram.com, facebook.com, tiktok.com, reddit.com, linkedin.com individually.
4. Unsigned builds only: Safari ▸ Settings ▸ Advanced ▸ "Show features for web developers", then Safari ▸
   Settings ▸ Developer ▸ **Allow unsigned extensions** (resets every time Safari quits).
5. Private Browsing: Safari ▸ Settings ▸ Extensions ▸ NoSlop Extension ▸ tick **Allow in Private Browsing**.

## 3. Install on an iPhone

Requires iOS 17 or later (iOS 26.1+ recommended; iOS 26.0 showed freshly installed extensions as "no longer available").

1. Build with `scripts/build-ios.sh` (signed with your Apple Development team) to get `build/NoSlop-iOS.app` and
   `build/NoSlop-iOS.ipa`. Plug the iPhone in, unlock it, trust the Mac, run `scripts/install-iphone.sh`.
   Alternative: open `NoSlop.xcodeproj`, select the `NoSlop-iOS` scheme and your iPhone, press Run.
2. On the iPhone open **Settings ▸ Apps ▸ Safari ▸ Extensions ▸ NoSlop**.
3. Turn on **Allow Extension**.
4. Under *Permissions* set **All Websites** (or each site) to **Allow**.
5. Optional: turn on **Private Browsing** on the same screen.
6. In Safari open instagram.com, x.com or m.youtube.com and tap the puzzle-piece icon in the address bar: NoSlop
   should be listed as active. The first visit to each site may ask to allow the extension for a day or always.

iOS has no deep link into Safari's extension settings; the app's Home tab repeats these steps.

## 4. The app

- **Home**: master on/off switch, items hidden/dimmed today and over the last 7 days, the "Enable in Safari" steps.
- **Sites**: per-site mode and surface toggles.
  - **Strict** hides at score 0.8 and dims at 0.4: labels, disclosures, AI hashtags, tool names and blocked accounts hide.
  - **Balanced** (default) hides at 1.0 (labels, disclosures, blocked accounts) and dims at 0.6; style tells only dim.
  - **Off** disables NoSlop on that site.
  - *Surfaces*: hide YouTube Shorts, Instagram Reels, X posts made with Grok, TikTok's For You feed, ads.
  - *YouTube prefetch*: fetches a video's watch page in the background to read its "How this content was made"
    label before you click. Costs bandwidth; lower the concurrency on slow connections.
  - *Behaviour*: show or hide the "Hidden: AI content" stubs, dim instead of hide, auto-block accounts after N
    labelled hits.
- **Lists**: blocked and allowed accounts per site, custom phrases and hashtags. Allowed accounts always win.
  **Import list from URL** fetches a plain-text list (one entry per line) or a JSON array of strings and appends it
  to the selected list. This is the only network request the app makes, and only when you tap Import. Use it for
  lists NoSlop cannot bundle for licence reasons (AiSList, OpenSlop).
- **Platform controls**: the platforms' own tools. Copy the X *Muted words* list, Instagram *Hidden Words* and
  *Your Algorithm* topics, and follow the TikTok AIGC-slider and YouTube "Don't recommend" paths.
- **Clean Feeds** (sideload builds only): Instagram, X and YouTube inside the app with the same filtering scripts
  injected. Logins persist between launches. Not part of App Store builds.
- **About**: the ceiling, how scoring works, licences.

Settings are shared with the extension through the App Group; a change in the app reaches the extension on its
next page load or popup open (last writer wins).

## 5. Lists and rules

- "Never show @author" on a hidden-item stub adds the account to the blocked list; undo it in **Lists**.
- Imported lists are appended, never replaced; re-import a URL to pick up new entries (duplicates are skipped).
- Bundled rules (`rules.json`: selectors, label strings, lexicon, seed lists) ship with each app update. The rules
  version is shown on the About tab.
- Reset everything: Sites ▸ **Reset all settings to defaults**.

## 6. Troubleshooting

- *Nothing is hidden:* check the extension is enabled for that site (puzzle icon), the site mode is not Off, and you
  are not in a Home-Screen web app or a private tab without the Private Browsing toggle.
- *"NoSlop Extension is no longer available" on iPhone:* update to iOS 26.1 or later and reinstall.
- *Counts stay at 0 in the app:* the extension writes stats through the App Group per batch; browse a feed for a
  minute, then tap Refresh on Home. Sideloads built with `NOSLOP_NO_APP_GROUP=1` do not sync.
- *Mac: extension missing from Safari's list:* open the app once, then relaunch Safari. Unsigned builds need
  "Allow unsigned extensions" again after every Safari restart.
