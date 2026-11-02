# Native-app ceiling: can anything on iOS filter individual posts inside the native Instagram / X / YouTube apps?

Research date: 2026-11-02. Target toolchain: Xcode 26.6, iOS 26.5 / macOS 26.5 SDKs. Solo App Store developer.

Legend: **VERIFIED** = read on a primary source today. **LIKELY** = consistent secondary sources, no primary. **UNVERIFIED** = could not confirm.

---

## 0. Bottom line (read this first)

**No.** There is no App Store-legal mechanism on iOS that lets a third-party app hide, collapse or re-rank individual posts inside the native Instagram, X or YouTube apps. Every available hook (local VPN, content filter, URL filter, Screen Time shields, DNS) operates on *whole apps, hosts or URLs*, never on *a post inside an encrypted feed response*, and the payloads that would need rewriting are TLS-encrypted and (for Meta and X at least) certificate-pinned. Accessibility-style overlays that read another app's screen do not exist on iOS at all.

What **is** possible, legitimately:

1. **Browser surfaces** (Safari on iOS; Safari + Chrome/Firefox/Edge on Mac): a Safari Web Extension / Chrome extension can read and hide individual DOM posts on instagram.com, x.com, youtube.com, facebook.com, reddit.com, linkedin.com, tiktok.com. This is the only "filter every post" primitive Apple allows, and on the Mac it genuinely covers "everything" because the native X app is gone and Instagram/YouTube have no Mac app.
2. **Rebuilt feeds via official APIs/RSS** inside our own app: YouTube subscriptions (API + public per-channel RSS, both verified working today), X home timeline (official endpoint exists but is pay-per-use at ~$0.005/post read), Reddit (closing to new apps from 31 Oct 2026). Instagram, Facebook, TikTok and LinkedIn give **no home-feed access** at all.
3. **Blunt instruments**: Screen Time shields (block the whole app / Reels not separable), iOS 26 URL filter (block whole URL paths such as `instagram.com/reels/`), DNS.

Everything else that "works" (MITM-proxy rewriting, jailbreak tweaks, SSL-pinning bypass repos) is not shippable on the App Store and not something a user can enable on a stock iPhone.

---

## 1. NetworkExtension / local VPN (NEPacketTunnelProvider) content rewriting

### 1a. What a packet tunnel provider actually sees
- **VERIFIED** Apple: a packet tunnel provider receives *IP packets* for the destinations it claims and can re-inject packets; it is a VPN primitive, not an HTTP interceptor. https://developer.apple.com/documentation/networkextension/nepackettunnelprovider (fetched via the doc JSON; text: "IP packets with matching destination addresses will then be diverted to Packet Tunnel Provider and can be read using the packetFlow property").
- **VERIFIED** Deployment (TN3134, updated 2025-08-19): on iOS a packet tunnel provider is an app extension, min iOS 9.0, with the only restriction "per-app mode requires managed device". So an unmanaged App Store app can run a device-wide local VPN. https://developer.apple.com/documentation/technotes/tn3134-network-extension-provider-deployment
- Consequence: the tunnel sees Instagram/X/YouTube traffic only as TLS-encrypted bytes. To rewrite a feed you would need to terminate TLS yourself (MITM), which needs (a) a root CA the *app* trusts and (b) no pinning.

### 1b. Root CA trust is manual and does not survive pinning
- **VERIFIED** Apple: a root certificate delivered in a manually installed profile "doesn't receive SSL trust by default"; the user must go to Settings > General > About > Certificate Trust Settings and enable full trust; automatic trust is only via Apple Configurator/MDM. https://support.apple.com/en-us/102390
- An App Store app cannot install or trust a CA silently. Even if the user does it by hand, pinned apps ignore the system trust store.

### 1c. Certificate pinning in the three apps
- **Instagram: LIKELY pinned.** Multiple public "SSL pinning bypass" projects exist specifically for the Instagram iOS binary (e.g. https://github.com/merdw/iOS-Instagram-SSL-Pinning-Bypass, https://github.com/culturally/Instagram-iOS-SSL-pinning-bypass, topic listing https://github.com/topics/instagram-ssl-pinning with repos claiming builds as recent as v388 / Jul 2025). A 2021 Habr write-up found "a list of certificates which can be trusted" in the app (https://habr.com/en/articles/571836). The existence of bypass projects is the evidence that pinning is on; the exact 2026 state is UNVERIFIED.
- **X/Twitter: LIKELY pinned.** SSL Kill Switch 2 has had an explicit "support for proxying Twitter's iOS app" item since early releases (https://github.com/nabla-c0d3/ssl-kill-switch2). Current 2026 build: UNVERIFIED.
- **YouTube: UNVERIFIED.** The only data point is a 2018 note that most Google apps did not pin at the time (https://www.simonwillison.net/2018/Mar/28/charles-proxy-now-available-on-ios). Irrelevant in practice: the YouTube feed is a protobuf/JSON InnerTube response and even an unpinned MITM rewriter would be a non-App-Store hack.
- Every bypass requires a jailbreak, Frida/objection, or a re-signed sideloaded binary. None is a product.

### 1d. Apple's rules
- **VERIFIED** App Store Review Guideline 5.4: "Apps offering VPN services must utilize the NEVPNManager API and may only be offered by developers enrolled as an organization... Apps offering VPN services may not sell, use, or disclose to third parties any data for any purpose... Parental control, content blocking, and security apps, among others, from approved providers may also use the NEVPNManager API." https://developer.apple.com/app-store/review/guidelines/#5.4
  - Note the **organization enrollment** requirement: a solo developer enrolled as an individual cannot ship a VPN-based app at all.
- **VERIFIED** Guideline 2.5.1: "Apps should use APIs and frameworks for their intended purposes". A tunnel used to MITM other apps' TLS is not the intended purpose.
- Apple has no written "no MITM" clause, but there is no API to make other apps trust your CA, and 5.4 + 2.5.1 + organization-only enrollment make it a non-starter.

### 1e. What shipping "ad blocker" apps really do in native apps
- **VERIFIED** AdGuard's own KB: "On iOS, the only way to block ads and trackers system-wide is to use DNS filtering." https://adguard.com/kb/adguard-for-ios/solving-problems/system-wide-filtering ; DNS protection page: https://adguard.com/kb/adguard-for-ios/features/dns-protection/
- **VERIFIED** AdGuard support: DNS filtering "cannot apply cosmetic filtering rules, for example it will not hide empty spaces left after ads" (i.e. no DOM/feed manipulation outside Safari). https://adguard.com/pt_pt/support/adguard_for_ios/display_incorrectly/different_browser.html
- So AdGuard Pro / Lockdown / 1Blocker's "system-wide" modes = hostname-level DNS blocking via a local VPN or the DNS-settings API. Inside the native Instagram/X/YouTube apps they can block *domains* (e.g. ad/tracker hosts), nothing finer. Third-party review of this limit: https://adblock-tester.com/ad-blockers/?p=1315 (secondary).
- No App Store app rewrites social feeds through a tunnel. UNVERIFIED as a universal negative, but consistent with every source and with the mechanics above.

### 1f. The new iOS 26 primitives do not change this
- **VERIFIED** TN3134: "URL filter provider — iOS app extension, min OS 26.0" with no managed/supervised restriction listed. NEURLFilterManager (iOS 26.0+): "The system filters all URL requests initiated with the URLSession and WebKit APIs"; matching is a Bloom filter + Private Information Retrieval database of *your URL blocklist*; verdict is block/allow per URL; "Neither the Bloom filter nor PIR supports wildcards or regular expressions." https://developer.apple.com/documentation/networkextension/neurlfiltermanager
  - Requires you to run a PIR server (`NSPIRConfiguration` / `PIRServerURL` in Info.plist).
  - Scope: it filters URLSession/WebKit requests of *other apps* at the URL level, so it can block `instagram.com/reels/` or `youtube.com/shorts/` style paths; it cannot read or edit response bodies, and a feed is one request (`/api/v1/feed/timeline/`-style) containing many posts, so there is no per-post verdict. Whether IG/X/YT use URLSession (vs. raw sockets/Cronet) for feed fetches: UNVERIFIED; Meta is known to ship its own networking stacks.
  - WWDC25 session 234 framing: "make traffic decisions using the entire URL — not just the hostname — all without compromising privacy and security" (Private Information Retrieval + Privacy Pass). https://wwdcnotes.com/documentation/wwdc25-234-filter-and-tunnel-network-traffic-with-networkextension/
- **VERIFIED** Content filter provider (NEFilterDataProvider) on iOS: "supervised devices only" (iOS 9+), or "apps using Screen Time APIs" (iOS 15+, **child devices only**: "In the Screen Time case, content filters are only supported on child devices"), or "per-app on managed devices" (iOS 16+). https://developer.apple.com/documentation/technotes/tn3134-network-extension-provider-deployment . Also: "the Filter Data Provider extension sandbox prevents the extension from moving network content outside of its address space" and the block/allow verdict is per *flow* (connection), not per post. https://developer.apple.com/documentation/networkextension/nefilterdataprovider
- **VERIFIED** DNS proxy provider on iOS: supervised only / per-app on managed devices (same TN3134 table).
- Apple DTS in a developer-forum thread on per-app blocking: "there's nothing that provides for per-app networking restrictions like this"; "A filter provider is only available on supervised devices." https://developer.apple.com/forums/thread/772190

---

## 2. Screen Time: FamilyControls / ManagedSettings / DeviceActivity

- **VERIFIED** Apple framework abstract: Managed Settings lets an app, with the user's permission, "limit media showings, restrict app purchases, lock passcode settings, and configure other device behavior" and works with FamilyControls/DeviceActivity "to allow your app to restrict, authorize, and monitor device usage." https://developer.apple.com/documentation/managedsettings . The API surface is `ManagedSettingsStore.shield.applications / applicationCategories / webDomains / webDomainCategories` plus `webContent.blockedByFilter` (adult-content filter for web). Nothing addresses content *inside* an app.
- **VERIFIED** Apple TN3134 (above): the only network-content hook available through Screen Time is the NEFilterDataProvider path, and it "is only supported on child devices" in that mode.
- Vendor confirmation (secondary): AppBlock FAQ — iOS "cannot block specific features or sections within an app (like Reels, Shorts, or Stories) because iOS doesn't give third-party apps that level of control." https://appblock.app/can-appblock-block-instagram-reels-youtube-shorts-or-snapchat-stories-on-iphone/
- Distribution requires Apple's approval of the `com.apple.developer.family-controls` entitlement (LIKELY; standard practice, Apple doc page did not render).
- **Conclusion (as expected): shields only. Block the whole app, a category, or a web domain. Cannot hide a post, cannot separate Reels from Feed.**

---

## 3. Accessibility / overlay apps on iOS

- iOS exposes no public API equivalent to Android's `AccessibilityService`: a third-party app cannot read another app's view hierarchy, receive its UI events, draw over it, or inject taps. Apps run in their own sandbox and are suspended in the background; there is no "draw over other apps" permission. **This is a structural fact of the platform rather than something Apple documents as a negative;** supporting evidence: Apple DTS repeatedly answers "nothing provides for" cross-app control (e.g. https://developer.apple.com/forums/thread/772190 on networking; same answer pattern for UI). Guideline 2.5.9 also bars apps that "alter or disable the functions of ... native user interface elements or behaviors" https://developer.apple.com/app-store/review/guidelines/#2.5.9 and 2.5.14 requires explicit consent + visible indicator for any screen recording. https://developer.apple.com/app-store/review/guidelines/#2.5.14
- The only cross-app "screen reading" is ReplayKit broadcast upload extensions (user-initiated system screen recording). That yields pixels, not a DOM, cannot modify what is shown, needs the user to start a broadcast from Control Center each time, and would have to run an on-device vision model on the live screen. It is not a feed filter. **Confirmed: no accessibility/overlay route on iOS.**

---

## 4. Alternative-feed apps: what the official APIs allow (2026)

### X
- **VERIFIED** docs.x.com pricing (2026-11-02): "pay-per-usage pricing... no subscriptions"; Enterprise is the only other plan. Read rates per resource returned: Posts $0.005, User $0.010, Following/Followers $0.010, Like/Mute/Block $0.001; "Owned Reads" of your own data via `/2/users/{id}/...` $0.001; writes: Post create $0.015, with URL $0.200. Pay-per-usage plans "capped at 3 million Post reads per monthly billing cycle." 24-hour dedup of repeated resources. $20 signup credit after saving a card and first purchase. https://docs.x.com/x-api/getting-started/pricing
- **VERIFIED** About page: "credit-based and has no subscriptions". https://docs.x.com/x-api/getting-started/about-x-api
- Tier history (secondary, mutually consistent): Free tier ended 6 Feb 2026 except "Public Utility Apps"; write price raised to $0.015 and URL-post $0.20 on 20 Apr 2026; legacy Basic ($200/mo) subscribers migrated to pay-per-use after 1 Jun 2026 (with $200 credit, $400 cap); legacy Pro after 1 Sep 2026. https://www.outstand.so/blog/x-api-pricing (Sep 2026), https://www.wearefounders.uk/the-x-api-price-hike-a-blow-to-indie-hackers/ (updated Feb 2026; still describes Basic as purchasable, which is now stale). **The $100/mo Basic tier the task mentions no longer exists; there is no free read tier.**
- **VERIFIED** Home timeline endpoint exists: `GET https://api.x.com/2/users/{id}/timelines/reverse_chronological` — "retrieves a reverse chronological list of Posts in the authenticated User's Timeline"; requires user-context auth (OAuth 2.0 user token), `{id}` must be the authenticated user. https://docs.x.com/x-api/users/get-users-timeline and quickstart https://docs.x.com/x-api/posts/timelines/quickstart/reverse-chron-quickstart
- Cost of a clean-feed app: UNVERIFIED whether home-timeline posts bill as "Owned Reads" ($0.001) or "Posts" ($0.005); the endpoint path matches `/2/users/{id}/...` but the posts are other people's. Budget at $0.005/post: a user who pulls 500 timeline posts/day pays ~$2.50/day, ~$75/month, before dedup. Only the reverse-chronological (Following) timeline is exposed; the algorithmic "For You" feed is not available via API (no endpoint in the Posts/Timelines reference).
- Also: an app needs its own developer account + OAuth app; each end user authorises it; your account is billed, not theirs.

### Instagram
- **VERIFIED** Meta: "The Instagram Platform is a collection of APIs that allows your app to access data for Instagram professional accounts"; "a permission only allows access to data created by the app user who granted the permission"; limited public data via Business Discovery / Hashtag Search. No feed/timeline endpoint of followed accounts exists anywhere in the reference. https://developers.facebook.com/docs/instagram-platform/overview
- Personal (non-professional) accounts cannot even authorise. **Rebuilding an Instagram home feed from the official API is impossible.** Unofficial private-API scraping violates Meta ToS and triggers checkpoints/bans; not shippable.

### YouTube
- **VERIFIED** Data API v3: default quota 10,000 units/day; list reads ≈1 unit; `search.list` 100 units; resources include `subscriptions` (list), `activities` (list), `playlistItems`, `channels`, `videos`. No resource returns the Home/recommended feed. https://developers.google.com/youtube/v3/getting-started
- **VERIFIED today** Public Atom feed per channel works without any key: `https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw` returned 15 entries, newest 2026-10-29. (Also the uploads playlist `UU…` via `playlistItems.list` at 1 unit per 50 items.)
- A "clean subscriptions feed" is fully buildable: `subscriptions.list` once (1 unit/50 channels) then RSS per channel (free) or `playlistItems.list` (1 unit each). Recommendations/Shorts shelf are not available and cannot be filtered because they are not accessible.
- Playback: embed via the IFrame player / `youtube.com/embed` in a WKWebView; the native YouTube app cannot be driven.

### Facebook
- **VERIFIED** Graph API User node edges today: accounts, albums, feed, likes, photos, videos, … — no `home` edge. `feed` is "The posts and links published by this person or others on their profile." https://developers.facebook.com/docs/graph-api/reference/user/ . The old `/me/home` news-feed edge was removed in Graph API v2.x (LIKELY; date UNVERIFIED). **No news feed access.**

### TikTok
- **VERIFIED** Display API: user profile + the user's own/public uploaded videos (`/v2/video/list/`, `/v2/video/query/`); no For You or Following feed. https://developers.tiktok.com/doc/display-api-overview

### LinkedIn
- LIKELY: consumer API returns only the member's own profile (`/v2/userinfo`) and lets you post; feed reading is partner-only; Microsoft's restricted-uses page bars using Community Management data "in a social feed use case". https://learn.microsoft.com/en-us/linkedin/marketing/restricted-use-cases?view=li-lms-2023-06 , https://schedpilot.com/linkedin-api-pricing/ (secondary). **No home feed.**

### Reddit
- LIKELY (official wiki returned 403 today; multiple consistent secondaries): free non-commercial tier = 100 QPM per OAuth client; self-service app registration closed 11 Nov 2025 under the Responsible Builder Policy; **no new public API access requests accepted after 31 Oct 2026** (announced 30 Sep 2026 on r/redditdev), access removal for unregistered apps from 12 Jan 2027, remaining public access ends March 2027; anonymous RSS reportedly ends 13 Nov 2026. https://www.redditapis.com/blogs/reddit-data-api-october-31-cutoff-2026 , https://apiserpent.com/blog/free-reddit-api , https://imisofts.com/blog/reddit-api-pricing/ . **A new Reddit-feed app started today is 2 days past the request cut-off — treat Reddit as browser-only.**

### Front-ends: Nitter / Invidious / Piped (2026)
- **VERIFIED** Nitter: X Corp sent cease-and-desist letters dated 24 Aug 2026 demanding "permanent takedown" of instances and the repository; maintainer expected instances to "remain down for the foreseeable future" (blog 25 Aug 2026). https://imperfect.bearblog.dev/nitter-needs-support/ . The GitHub repo was **archived (read-only) on 9 Oct 2026**; the wiki (last edit 11 Sep 2026) still lists 7 clearnet + 1 Tor + 1 I2P instances marked online. https://github.com/zedeus/nitter/wiki/Instances . Dead as a dependency for a product.
- Invidious: still releasing (v2.20260804.1, Aug 2026) but public instances are "whack-a-mole" with registration locks and frequent YouTube breakage; Piped: conflicting reports, ProtonVPN removed it from its list as non-working (Aug 2025). https://sumguy.com/invidious-piped-redlib-nitter-2026/ (secondary). Not a shippable dependency; also both violate YouTube ToS for an App Store app.

### Could a legit app rebuild a "clean feed"?
- **YouTube: yes** (subscriptions only, free quota is ample, RSS needs no key).
- **X: yes, Following timeline only, at real per-post cost billed to the developer** (no free tier; needs organisation-level planning for cost pass-through / subscription).
- **Instagram, Facebook, TikTok, LinkedIn: no.** **Reddit: no for new apps after 31 Oct 2026.**

---

## 5. Why Android can and iPhone can't (one paragraph)

**VERIFIED** Android's `AccessibilityService` is a sanctioned API that "run[s] in the background and communicate[s] with the system to inspect screen content and interact with apps on the user's behalf"; with `canRetrieveWindowContent="true"` a service receives the live `AccessibilityNodeInfo` tree of whatever app is on screen (text, content-descriptions, bounds), can `performAction` (click, scroll, global BACK) and `dispatchGesture`. https://developer.android.com/guide/topics/ui/accessibility/service . Combined with the `SYSTEM_ALERT_WINDOW` overlay permission, an Android app can detect an AI-labelled post in the real Instagram app and cover it or auto-scroll past it; open-source feed blockers already do exactly this UI-tree detection (FeedLock https://github.com/caasion/FeedLock, Tapback https://github.com/ruhani-j/tapback, Shorts-Blocker https://github.com/atick-faisal/Shorts-Blocker; caveat from the Scrolln't dev: Meta changes resource IDs often, so text/content-description heuristics are the only resilient hook). iOS has no equivalent: no third-party app can read another app's UI tree, receive its events, or draw over it, and Google Play's own policy restricts accessibility services to assistive use, so even on Android this is a grey zone for the Play Store.

---

## 6. macOS: the native apps barely exist — it is a browser problem

- **VERIFIED** X: dedicated Mac app delisted ~1 Aug 2024 (users pointed to the iPad build) https://gigazine.net/gsc_news/en/20240802-x-disappears-mac-app-store/ ; on 18 Dec 2025 the iPad app's Mac App Store listing began saying it "is not supported on the Mac" — X "ditched the Mac entirely"; the web version is the only full-function client. https://9to5mac.com/2025/12/18/x-drops-support-for-installing-its-ipad-app-on-the-mac/
- **VERIFIED today** Instagram App Store listing (`?platform=mac`) shows Compatibility for iPhone, iPad, Apple TV only — no Mac entry, i.e. Meta opts out of iPad-app-on-Mac. https://apps.apple.com/us/app/instagram/id389801252?platform=mac . (Meta opted all its iOS apps out of Apple-silicon Macs at the 2020 launch: https://www.imore.com/major-developers-opt-out-mac-app-store-ahead-apple-silicon-launch .) Instagram on Mac = instagram.com in a browser or a Safari Dock web app.
- YouTube: no first-party Mac app exists (LIKELY; universally known, no primary negative). YouTube on Mac = youtube.com in a browser / Dock web app.
- Facebook, TikTok, Reddit, LinkedIn: same — browser (LinkedIn/Facebook Messenger-type Mac apps do not carry the feed) (LIKELY).
- **Therefore a Safari Web Extension (shipped inside our Mac app) + a Chrome/Chromium (MV3) extension + a Firefox port covers "everything" on the Mac.**

### Safari on macOS 26: Private Browsing and Dock web apps
- **VERIFIED** Apple: "When you browse privately in macOS Sonoma 14 or later, all extensions that require website access are turned off by default." Re-enable per extension: Safari > Settings > Extensions > select extension > "Allow in Private Browsing". https://support.apple.com/en-us/HT202447 . Our onboarding must tell users to tick that box; there is no API to do it for them (developer forum: `SFSafariExtensionManager.getStateOfSafariExtension` does not expose the private-browsing flag https://developer.apple.com/forums/thread/811694).
- **VERIFIED** Apple Safari User Guide (version selector includes macOS 26 Tahoe and 27): "Content blockers and Safari web extensions can be added to web apps"; those "active in Safari (and have access to the same domain as the web app) are automatically turned on for the web app"; "Safari app extensions are not supported in web apps." Managed from the web app's menu > Settings > Extensions. https://support.apple.com/guide/safari/ibrw4a0164a5/mac . Safari engineer (xeenon, 2024-09-13): "Web Apps on macOS Sequoia and Sonoma support Safari Web Extensions and Content Blockers when you have Safari 18 installed." https://hachyderm.io/@davidjohnson/113131163391751588 (thread fetched via Mastodon API).
- So on the Mac our Safari **Web Extension** (not an app extension) runs in normal windows, in Private windows after a one-time toggle, and inside "Add to Dock" web apps automatically. Chrome/Edge/Arc/Brave: standard MV3 extension; Chrome's own "Install as app" PWAs run extensions too (LIKELY).

---

## 7. iOS Home Screen web apps: do Safari extensions run in them?

- **VERIFIED** Safari engineer Timothy Hatcher (xeenon), 2024-09-13: "Extensions are only supported on macOS web apps currently, with Safari 18. iOS web apps do not currently support extensions." https://hachyderm.io/@davidjohnson/113131163391751588 (via https://hachyderm.io/api/v1/statuses/113131163391751588/context). A Safari engineer in the same thread: "We hear the request for extensions in more places on iOS."
- **VERIFIED** WebKit bug 238151 (2022): extensions stop running when a standalone-display site is added to the Home Screen; closed RESOLVED MOVED as "issues within Safari and not within WebKit". https://bugs.webkit.org/show_bug.cgi?id=238151
- **VERIFIED** WebKit blog "WebKit Features in Safari 26.0": iOS 26 opens *every* Home Screen site as a web app by default ("Open as Web App" toggle in the add sheet); the Web Extensions and Content Blockers sections list new features (Packager, menubar commands, `unless-frame-url`, request-method triggers) but say nothing about extensions inside iOS web apps. https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ . No 2025/2026 Apple source reverses the 2024 statement; the iOS-17.4 EU change (bug 268643) concerned web apps opening in the default browser, not extensions. **Status for iOS 26.5: extensions do NOT run in iOS Home Screen web apps (LIKELY-to-VERIFIED; no Apple document states the positive).**
- Product consequence: on iPhone the user must open instagram.com / x.com / youtube.com **in Safari tabs**, not as Home Screen web apps, and not in SFSafariViewController (no extensions there either, per the same thread). Tell users to turn OFF "Open as Web App" if they add a bookmark.
- iOS Private Browsing: **VERIFIED** Apple iPhone User Guide: "Any Safari extensions you have installed that have access to browsing data are automatically turned off in Private Browsing. To turn on an extension in Private Browsing, see Change Safari extension settings." https://support.apple.com/guide/iphone/browse-the-web-privately-iphb01fc3c85/ios (toggle lives in Settings > Apps > Safari > Extensions > [extension] > Private Browsing; path per secondary https://ios.gadgethacks.com/how-to/safaris-private-browsing-mode-just-made-your-private-tabs-whole-lot-more-private-0385430).
- Guideline 4.4.2 for Safari extensions: must not interfere with Safari UI, "should not claim access to more websites than strictly necessary". https://developer.apple.com/app-store/review/guidelines/#4.4.2

---

## 8. 2026 developments

- **Apple "Safari AI content filter": none found.** No Apple documentation, WebKit post or newsroom item describes a Safari-level AI-content filter or label in iOS 26/26.x; a third-party guide states "Neither Safari nor Apple News currently offers a native toggle to identify or hide AI-generated articles" https://www.hawkdive.com/apple-ai-generated-content-flag-fix/ (secondary). Apple's provenance work is elsewhere: reported iOS 27 "Reference" signed-capture mode (iPhone 18 Pro) and SynthID watermarking of Apple's own AI edits https://www.niemanlab.org/2026/09/apple-launches-a-new-way-to-prove-a-photo-was-shot-with-an-iphone-not-generated-by-ai/ , https://9to5mac.com/2026/08/12/apple-authenticating-iphone-photos-is-just-the-start/ (secondary; no Apple doc). None of this is a feed filter and none is exposed to third-party apps as a "this post is AI" signal. UNVERIFIED beyond the negative.
- **Platform-native labels we CAN key on in the DOM:** YouTube now shows an "altered or synthetic content" label between player and description (Shorts: on-video) and auto-applies it to photorealistic AI content (secondary, consistent: https://www.tomsguide.com/ai/ai-image-video/youtube-will-now-help-you-spot-ai-in-videos-heres-how , https://feedbagel.com/post/youtube-ai-labels-to-become-more-visible-across-videos-and-shorts); Instagram applies "AI info" automatically from C2PA/IPTC metadata (secondary); none of the three offers a viewer-side "hide AI" toggle (Instagram explicitly none: https://creatortribune.com/how-to-block-ai-content-on-instagram/ ; YouTube/X: none found). Existing Chrome extensions already use these labels plus heuristics: KillSlop https://killslop.app/ , SlopBlocker https://github.com/KyleBenzle/SlopBlocker (keys on IG "AI info" / YT label), slop-filter https://github.com/adamnroman/slop-filter , AI Slop Blocker (paid) https://chromewebstore.google.com/detail/ai-slop-blocker/cnibfnnnmlbhhmojfnlpdiddfbmobdan , Slopless https://useslopless.com/ . Competitive reference: all are Chrome-only; none ships a Safari/iOS build.
- **EU DMA alternative engines:** Apple's EU programme (iOS 17.4+/iPadOS 18+, EU-only distribution, Web Browser Engine / Embedded Browser Engine entitlements, 90% WPT + 80% Test262, security/privacy requirements) https://developer.apple.com/support/alternative-browser-engines/ ; Japan programme on iOS 26.2+ https://developer.apple.com/support/alternative-browser-engines-jp . **No vendor has shipped a non-WebKit engine on iOS anywhere**: OWA 2025 review — "not a single browser vendor has successfully ported their engine to iOS in the last 21 months" https://open-web-advocacy.org/blog/owa-2025-review/ ; MacRumors 2026-06-17: Microsoft's Blink-based Edge is "a research prototype rather than a finished product" https://www.macrumors.com/2026/06/17/webkit-rule-costs-ios-users-browser-performance/ ; Mozilla 2026-09-30: will not build an EU-only Gecko Firefox, wants "a single set of global rules" https://piunikaweb.com/2026/09/30/mozilla-gecko-ios-apple-eu-rules/ (secondary, quoting Ars Technica). **So there is no Firefox/Chrome-with-WebExtensions on iPhone to target, and none is announced.** Apple's pages do not mention extension APIs for alt engines either way.
- Reddit API wind-down (above): 31 Oct 2026 cut-off for new access. X API: no free tier since Feb 2026; Nitter archived Oct 2026.

---

## 9. What we tell the user

Plain English: **On iPhone, nobody — not us, not Apple's own Screen Time, not AdGuard — can remove individual posts inside the Instagram, X or YouTube apps. Apple does not give any app a way to see or touch what another app draws or downloads. We can do it in Safari on the iPhone, and we can do it everywhere on the Mac because on the Mac these services are websites. For YouTube (and, at a cost, X) we can also build you a clean feed inside our own app.**

| Platform | iPhone — native app | iPhone — Safari (tab) | iPhone — Home Screen web app | iPhone — our own app (rebuilt feed) | Mac — native app | Mac — Safari / Chrome / Firefox + Dock web app |
|---|---|---|---|---|---|---|
| Instagram | **No.** Only whole-app shield (Screen Time) or URL-path block (iOS 26 URL filter, e.g. `/reels/`), no per-post | **Yes** — Safari Web Extension hides posts by DOM (AI-info label + heuristics); private tabs need one-time toggle | **No** — extensions don't run in iOS web apps | **No** — API has no home feed | n/a — no Mac app (Meta opts out) | **Yes** — web extension; Dock web app inherits it automatically |
| X | **No.** Same shield/URL-block only | **Yes** — web extension | **No** | **Partial** — Following timeline via API, pay-per-use ~$0.005/post billed to us; no For You | n/a — X dropped the Mac (Dec 2025) | **Yes** |
| YouTube | **No.** Same; can block `/shorts/` paths at best | **Yes** — web extension (uses YT's "altered or synthetic" label + channel lists) | **No** | **Yes** — subscriptions feed via Data API (10k units/day) + free per-channel RSS; no recommendations | n/a — no Mac app | **Yes** |
| Facebook | **No** | **Yes** | **No** | **No** — no news-feed API | n/a | **Yes** |
| TikTok | **No** | **Yes** (tiktok.com) | **No** | **No** — Display API = own videos only | n/a | **Yes** |
| Reddit | **No** | **Yes** | **No** | **No for new apps** after 31 Oct 2026 cut-off | n/a | **Yes** |
| LinkedIn | **No** | **Yes** | **No** | **No** — feed is partner-only | n/a | **Yes** |

Honest caveats to put in the app's onboarding:
1. iPhone: "Works in Safari, not inside the Instagram/X/YouTube apps — Apple doesn't allow it." Offer the Screen Time shield as the optional nuclear option (block the native app, redirect to Safari).
2. Open the sites as Safari tabs; keep "Open as Web App" off when adding to Home Screen.
3. Tick "Allow in Private Browsing" (both platforms) if they browse privately.
4. Detection is probabilistic; we use platform AI labels first, heuristics second, user block-lists third.
5. We do not touch VPN, certificates or network traffic.

Build implications for today: one Xcode project, two targets each with a Safari Web Extension (shared JS/CSS), plus the same extension packaged for Chrome (MV3) and Firefox; optional "Clean YouTube" native tab (Data API + RSS) and optional "Clean X" tab gated behind the user's own X developer credits or a paid plan. No NetworkExtension, no FamilyControls in v1 (FamilyControls would need entitlement approval and adds nothing per-post).
