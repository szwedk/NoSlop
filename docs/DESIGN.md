# NoSlop architecture and contracts

NoSlop removes AI-generated content and "AI slop" from social feeds. One codebase: an iPhone app and a
Mac app, each containing the same Safari Web Extension (plain JS, no bundler), plus a Chrome build of
the same extension folder. No backend, no ML model in v1.

## 0. The honest ceiling (stated in onboarding, never hidden)
- On iPhone, no app can see or change what the native Instagram / X / YouTube apps show. NoSlop
  filters those sites **in Safari** (instagram.com, x.com, m.youtube.com). Home-Screen web apps do
  not run extensions on iOS; Private Browsing needs a per-extension toggle. The "nuclear option" is a
  Screen Time shield on the native app so the user opens Safari instead.
- On Mac, X / Instagram / YouTube have no native apps, so Safari (and the Chrome build) is everything.
- Only platform labels (YouTube AI badge / "how this was made", Meta "AI info", TikTok aigc tag,
  X "Made with AI" + Grok links) and self-disclosure are high-precision. Style heuristics only DIM,
  never hide. Unlabelled, undisclosed AI images cannot be reliably detected on-device in 2026.

## 1. Repository layout
```
project.yml                     XcodeGen spec
package.json                    node --test + jsdom
Extension/
  Shared/SafariWebExtensionHandler.swift   native handler
  Resources/                    THE web extension folder (Safari manifest). Plain scripts, no modules.
    manifest.json               Safari: background.scripts + persistent:false
    rules.json                  canonical data: selectors, labels, lexicon, seeds (adapters append to sites.<site>)
    rules.js                    generated from rules.json by `npm run build:rules`; committed
    lib/host-extension.js       host shim for the extension runtime
    lib/scorer.js               pure scoring
    lib/engine.js               observer/pipeline/hiding/caching/stats + the popup's tab messages
    lib/host-webview.js         host shim for the in-app Clean Feeds WKWebView; loaded FIRST there, host-extension.js is not loaded
    lib/tiktok-main.js          PAGE-world JSON relay for tiktok.com; manifest web_accessible_resources, never a content script, never polyfilled
    lib/dom.js                  small DOM helpers: text(), closest(), visible(), hashtags()
    adapters/<site>.js          one per site
    content.js                  bootstrap: pick adapter by hostname, start engine
    content.css                 stub + dim styles
    background.js               settings sync, native bridge, fetch proxy, stats
    popup/popup.html|js|css     extension UI
    images/icon-*.png
App/Shared/*.swift              SwiftUI app shared by iOS+macOS
App/iOS, App/macOS              platform bits
tools/build-rules.mjs           rules.json -> rules.js
tools/build-chrome.mjs          Extension/Resources -> dist/chrome (service_worker manifest, polyfill)
tools/check-bundle.mjs          verifies a built .app: one .appex, manifest.json + every referenced file present and identical to Extension/Resources
tests/bootstrap.test.mjs        boots the full content-script chain in jsdom for all 8 hostnames incl. m.youtube.com / twitter.com
tests/helpers/load.mjs          jsdom + vm loader for the plain scripts
tests/<area>.test.mjs           node --test
tests/fixtures/<site>/*.html    real captures (youtube, tiktok, reddit) or SYNTHETIC (x, instagram, facebook, linkedin); see tests/fixtures/README.md
tests/corpus/ai.json, human.json  golden set
scripts/build-mac.sh, build-ios.sh, install-iphone.sh, test.sh
docs/STATUS.md                  what is verified / synthetic / missing
docs/                           this file, research/, USER-GUIDE.md
```

## 2. Script loading model (plain scripts, one namespace)
Every extension script is a classic script that attaches to `globalThis.NoSlop` (create if missing).
Load order in manifest `content_scripts[].js`:
`rules.js, lib/dom.js, lib/scorer.js, lib/host-extension.js, lib/engine.js, adapters/youtube.js, ..., content.js`
(all adapters are listed for all matches; each adapter registers itself with
`NoSlop.adapters.register(adapter)` and `content.js` picks the first whose `matches(location)` is true).
`run_at: document_start`; the engine waits for `document.body` then observes.
Tests load the same files with jsdom via `tests/helpers/load.mjs`: `const {window, NoSlop} = await loadScripts(['rules.js','lib/dom.js',...], {url, html})`.

## 3. Data: rules.json schema
```jsonc
{
  "version": "2026-11-02.1",
  "scoring": { "modes": { "strict": {"hide": 0.8, "dim": 0.4}, "balanced": {"hide": 1.0, "dim": 0.6} },
               "styleCap": 0.6, "categoryCaps": { "<category>": number } },
  "labels": {            // platform-native AI labels, tier 0 (score 1.5)
    "youtube": { "badgeText": ["AI"], "watchSection": ["how-this-was-made-section-view-model"], "watchHtmlRegex": "howThisWasMadeSectionViewModel|\"Made with AI\"|Altered or synthetic", "autoDubExclude": "..." },
    "instagram": { "text": ["AI info", "Imagined with AI", "AI-generated profile", "<localized variants>"] },
    "facebook": { "text": [...] }, "x": { "text": ["Made with AI"], "grokHref": "/i/grok/share/" },
    "tiktok": { "selectors": ["[data-e2e=\"aigc-tag\"]"], "text": ["AI-generated", "Creator labeled as AI-generated"], "jsonKeys": ["aigcLabelType","moderationAigcLabelType","IsAigc"] },
    "linkedin": { ... }, "reddit": { ... }
  },
  "disclosure": { "regex": ["..."], "score": 1.0 },                 // tier 1 self-disclosure
  "hashtags": { "strong": [...], "strongScore": 0.8, "weak": [...], "weakScore": 0.4 },
  "toolNames": { "terms": [...], "scoreEach": 0.4, "cap": 1.0 },                    // 3 families with no disclosure verb = a pipeline post (hide); a SINGLE family is mention-level (see categoryCaps.mention)
  "chatbotResidue": { "regex": [...], "score": 0.9 },
  "promptMetadata": { "regex": [...], "score": 0.9 },
  "style": {                                                          // tier 3: DIM ONLY, total capped at styleCap
    "structure": [{ "id": "contrast_pivot", "regex": "...", "score": 0.3 }, ...],
    "engagementBait": { "regex": [...], "scoreEach": 0.2, "cap": 0.4 },
    "vocabAlways": { "terms": [...], "scoreEach": 0.12, "cap": 0.5 },
    "vocabCluster": { "terms": [...], "min": 2, "score": 0.2 },
    "closers": { "regex": [...], "scoreEach": 0.2, "cap": 0.4 },
    "humanTells": [{ "regex": "...", "score": -0.3 }],
    "minWords": 6
  },
  "accounts": { "youtube": { "block": ["@handle", "UCxxxx"] }, "x": { "block": [...] }, "instagram": {...}, "reddit": { "subreddits": [...] } },  // tier 2 seeds (MIT-licensed sources only)
  "sites": {                                                           // per-site selectors; adapters read these, never hardcode
    "youtube": { "desktop": { "item": "ytd-rich-item-renderer, ytd-video-renderer, ...", "title": "...", "channel": "...", "badge": ".ytBadgeShapeText, .badge-shape-wiz__text", "shortsShelf": "...", "videoIdAttr": "..." },
                 "mobile":  { ... ytm-* ... } },
    "x": { "cell": "[data-testid=\"cellInnerDiv\"]", "article": "article[data-testid=\"tweet\"]", "text": "[data-testid=\"tweetText\"]", "userName": "[data-testid=\"User-Name\"]", "promoted": "[data-testid=\"placementTracking\"]", "grokLink": "a[href^=\"/i/grok/share/\"]", "grokSvgPath": "..." },
    "instagram": {...}, "facebook": {...}, "tiktok": {...}, "reddit": {...}, "linkedin": {...}
  },
  "platformActions": { "xMutedWords": [...], "instagramHiddenWords": [...], "instagramYourAlgorithmLess": [...], "tiktok": "...", "youtube": "..." }
}
```
Seed content comes from docs/research/slop-detection-prior-art.md §7 (JSON block) and the selector
tables in docs/research/platform-dom-and-ai-labels.md §2. Only MIT-licensed sources (listed in that
report §1.1) are bundled; AiSList (CC BY-NC) and OpenSlop (PolyForm NC) are not, the app offers
"Import list from URL" instead. All regexes are strings (JSON) compiled once, case-insensitive, unicode.

## 4. Engine contract (lib/engine.js)
```js
NoSlop.engine.start({ adapter, rules, host })   // host: see §6
// Pipeline per candidate element `el` returned by adapter.findItems(root):
//   item = adapter.extract(el)  -> Item, null (NOT an item: separator/promo -> any applied state is removed) or
//                                  undefined (not READY: virtualizer placeholder, cell without its permalink yet -> the applied state is KEPT)
//   id   = item.id              (stable post/video id; NEVER the element). el.dataset.noslopId = id
//   verdict = cache.get(id) || scorer.score(item, rules, settings, site)  -> { score, tier, reasons[], action }
//   if action==='none' && adapter.enrich && settings allows: queue enrich(item) (async, concurrency from settings), re-score on result
//   apply(el, item, verdict): hide -> adapter.hide(el,item,verdict) (default strategy per site), dim -> add .noslop-dim + badge
//   stats.bump(site, action, reason)
// Cell reuse: on every mutation inside a processed element, re-run extract; if id changed -> unapply + re-verdict.
// Observer: one MutationObserver on document.body, childList+subtree, batched with requestIdleCallback/setTimeout(0),
//   plus a 2.5 s safety sweep while the tab is visible: a full pass only when a mutation was observed since the last sweep or the URL
//   changed, otherwise a cheap re-check of what is applied. adapter.surfaces() is applied ONCE per flush / sweep, never per mutation root.
//   SPA navigation is detected by comparing location.href on every flush and sweep (content scripts, Safari, Chrome and the WKWebView
//   .defaultClient world are isolated worlds: the page's own history.pushState never reaches a content-script History patch); the
//   popstate/hashchange/adapter.navigateEvents listeners, the Navigation API (currententrychange) and the history patch are extras.
// Verdict cache: Map in memory (LRU 5000, TTL 7 d; E.counted / authorHits are evicted with it); verdicts with tier<=1 or from a SUCCESSFUL
//   enrich persisted in storage.local 'verdicts:<site>' (<= 1000 newest rows, enrich text capped to a 300-char snippet, read-merge-write so
//   tabs do not clobber each other, 12 s debounce + flush on pagehide/visibilitychange, row cap halved on a rejected write; manifest asks
//   for unlimitedStorage). A FAILED enrich (timeout/429/host refused) is never a result: enriched stays false, retried after a doubling
//   backoff (60 s, max 3 attempts per page life). settings.enabled=false / sites.<site>.mode='off' stop enrich and surface hides too.
// Hidden-item stub: unless settings.showStubs===false, insert a compact .noslop-stub (label "Hidden: AI content", the reason, a Show button,
//   a "Never show @author" button); adapter.stubPlacement(el,item) -> 'inside' (el.firstChild, default) | 'before' (previous sibling +
//   .noslop-hidden--host display:none on el, for shadow hosts such as a bare reddit shreddit-post whose shadow chrome the child-hiding CSS
//   cannot reach). Un-hide restores `muted`.
//   Show -> unhide this one (session allow); Never -> settings.blockedAccounts[site].push(author) via host.
// Auto-promotion: N (settings.autoPromote.hits, default 3) tier-0/1 hits on the same author -> added to blockedAccounts (reversible in the app/popup).
//   Requires a STABLE identifier (author.handle || author.id; never a display name); account:*, ad:* and label:reddit_flair verdicts never promote.
// Surfaces: adapter.surfaces() returns [{ settingKey:'hideShorts', selector:'...', strategy?:'display-none'|'height-zero' }]; engine hides those
//   elements when the setting is on AND the site is active ('height-zero' collapses instead of display:none: facebook feed units must stay mounted).
//   The stats bump is once per (element, settingKey).
//   settingKeys in use: hideShorts (youtube), hideReels (instagram/facebook), hideGrokPosts (x: Grok share links, quotes of / posts by @grok, quotes of AI-labelled posts, home-feed Grok promo cells),
//   hideTikTokForYou, hideAds, hideRedditRecommended (reddit shreddit-post[recommendation-source]).
// extract(el, ctx): ctx = { settings, rules, surface, site } (live values; adapters may still read NoSlop.engine.settings).
// Verdict cache entries carry the surface they were scored on: a post seen on 'home' is re-scored after an SPA navigation
//   into another surface (reddit account:subreddit applies on 'popular' and to recommended posts only).
// NoSlop.engine.invalidate(id): drops the cached verdict/enrich for one id and re-processes its elements (adapters call it when evidence grows).
// Popup <-> content script (browser.runtime.onMessage in the content script; unknown types are ignored so background messages pass):
//   {type:'getRecentHidden', limit:20} -> { site, items:[{ id, action:'hide'|'dim', author, reason, reasonText, title?, text?, ts }] } newest first (ring of 50)
//   {type:'showItem', id}              -> {ok:true, count} | {ok:false, error}   (same as the stub's Show: session allow + unapply + re-process)
//   {type:'invalidate', id}            -> {ok}      {type:'noslopStatus'} -> {ok, running, site, surface, hidden}
// Hide strategies (adapter.hideStrategy): 'display-none' (youtube, reddit, linkedin), 'height-zero' (facebook: height:0;overflow:hidden on the cell),
//   'collapse-inner' (x, instagram: hide the cell's first child / article inner content, keep the cell mounted; pause+mute <video>).
```
Item shape:
```ts
{ id: string, kind: 'post'|'video'|'short'|'ad'|'shelf', surface: 'home'|'search'|'watch'|'profile'|'reels'|'shorts'|'popular'|'other',   // x maps /status/ pages to 'watch' (item.extra.page = 'status'), explore to 'search', lists/communities to 'home'; reddit maps /r/popular|/r/all to 'popular'
  text: string, title?: string, author: { handle?: string, name?: string, id?: string }, hashtags: string[], links: string[],
  labels: Array<{ type: 'platform_ai'|'promoted'|'c2pa', text?: string }>, media: Array<'image'|'video'|'none'>, extra?: object }
```
Verdict actions: `'hide' | 'dim' | 'none'`. `reasons` are short machine ids (`label:youtube_badge`, `hashtag:#aiart`, `account:block`, `style:contrast_pivot`).

## 5. Scorer contract (lib/scorer.js): pure, no DOM, fully unit-tested
`NoSlop.scorer.score(item, rules, settings, site) -> verdict`.
Tiers: 0 platform label (1.5) · 1 disclosure / hashtags / tool names / chatbot residue / prompt metadata · 2 accounts
(user block list = 1.5, seed list = 1.0, allow list -> action none always) · 3 style (sum capped at rules.scoring.styleCap; can only reach 'dim').
Mode thresholds from rules.scoring.modes[settings.sites[site].mode]; mode 'off' -> none. `settings.dimInsteadOfHide` turns hide into dim.
Custom phrases/hashtags from settings score 1.0. Promoted/ads: hide only when settings.surfaces.hideAds.
Golden-set gate (tests/corpus): on human.json, hide = 0 and dim <= 2 %; on ai.json, labelled/disclosed items hide >= 95 %.

## 6. Host contract (lib/host-extension.js; the WKWebView shim implements the same)
```js
NoSlop.host = {
  getSettings(): Promise<Settings>, onSettingsChanged(cb), patchSettings(partial): Promise<Settings>,
  storageGet(keys), storageSet(obj),               // storage.local, namespaced
  fetchText(url, {timeout}): Promise<string>,     // via background (extension) or native (webview); used by youtube enrich
  report(event)                                    // { type:'stats', site, action, reason } batched to background
}
```
Settings (storage.local key `settings`, `version: 1`):
```jsonc
{ "enabled": true, "updatedAt": 0,
  "sites": { "youtube": {"mode":"balanced"}, "x": {...}, "instagram": {...}, "facebook": {...}, "tiktok": {...}, "reddit": {...}, "linkedin": {...} },
  "surfaces": { "hideShorts": false, "hideReels": false, "hideGrokPosts": true, "hideTikTokForYou": false, "hideAds": false, "hideRedditRecommended": false },
  "reelsAutoAdvance": true,          // instagram: scrollIntoView the next reel after hiding the active one on /reels/
  "tiktokJsonRelay": true,           // tiktok: inject lib/tiktok-main.js (page world) to read TikTok's own AIGC JSON fields
  // sites.reddit may also carry "flagAppAccounts": false (opt-in: the Reddit "App" automated-account label becomes a tier-0 label reddit_app_account)
  "youtubePrefetch": true, "youtubePrefetchConcurrency": 2,
  "showStubs": true, "dimInsteadOfHide": false,
  "blockedAccounts": { "youtube": [], "x": [], "instagram": [], "facebook": [], "tiktok": [], "reddit": [], "linkedin": [] },
  "allowedAccounts": { ...same keys... }, "customPhrases": [], "customHashtags": [],
  "autoPromote": { "enabled": true, "hits": 3 }, "rulesOverride": null }
```
`patchSettings(partial)` is a SHALLOW top-level merge: callers send whole sub-objects (`sites`, `surfaces`, `blockedAccounts`, ...).
The Swift app stamps `updatedAt` (ms) on every write and re-reads the App Group on foreground; the popup writes through background -> putSharedSettings with a fresh updatedAt.
`settings.rulesOverride` is a PARTIAL rules object deep-merged over the bundled rules by the engine (objects recurse, arrays/scalars replace), e.g.
`{ "labels": { "instagram": { "text": ["AI info", "KI-Info"] } } }` adds a localized label string; a `null` value removes a section (adapters then use their documented fallbacks).
Stats (storage.local key `stats`): `{ "<YYYY-MM-DD>": { "<site>": { "hide": n, "dim": n, "reasons": { "<reason>": n } } } }`.

## 7. Native messaging protocol (background.js <-> SafariWebExtensionHandler.swift)
Content scripts never call native; background does. Messages (`SFExtensionMessageKey` dict):
- `{type:'ping'}` -> `{ok:true, version, platform:'ios'|'macos'}`
- `{type:'getSharedSettings'}` -> `{settings|null}` from App Group `group.com.szwedk.noslop` UserDefaults key `settings` (JSON string)
- `{type:'putSharedSettings', settings}` -> `{ok}`
- `{type:'recordStats', stats}` -> `{ok}` (merged into App Group key `stats`)
- `{type:'classify', items:[{id,text}]}` -> `{verdicts:[]}` (v1 returns empty; hook for Core ML; batching contract: <=32 items, 100 ms debounce, 2 s timeout, fail-open)
Sync: last-writer-wins on `updatedAt`. Background pulls shared settings on startup and when the popup opens; pushes on every change.

## 8. Swift app (SwiftUI, shared for iOS + macOS)
Tabs/sidebar: **Home** (status + today's counts from App Group stats, "Enable in Safari" steps per platform),
**Sites** (per-site mode strict/balanced/off, surface toggles, YouTube prefetch), **Lists** (blocked/allowed accounts, custom phrases/hashtags,
import list from URL), **Platform controls** (paste-lists + deep links from rules.platformActions: X muted words, Instagram Hidden Words / Your Algorithm,
TikTok AIGC slider path, YouTube "Don't recommend"), **Feeds** (only when `NOSLOP_CLEAN_FEEDS` is defined, i.e. Debug/sideload builds: WKWebView tabs for
instagram.com, x.com, m.youtube.com with the extension scripts injected at documentStart in `.defaultClient` world via the `host-webview.js` shim),
**About** (the honest ceiling). The app writes settings to the App Group with `updatedAt`; the extension picks them up (see §7).
macOS: `SFSafariApplication.showPreferencesForExtension(withIdentifier: "com.szwedk.noslop.Extension")`. iOS: no deep link to Settings exists; the app shows the steps.
App icon: a 1024 px PNG generated programmatically (dark rounded square, white slashed-circle glyph) into `App/Shared/Assets.xcassets/AppIcon.appiconset`.

## 9. Chrome build (tools/build-chrome.mjs)
Copy Extension/Resources to dist/chrome; rewrite manifest: `background.service_worker` (importScripts the same background.js), add `action` popup,
drop `browser_specific_settings`, prepend `globalThis.browser ??= chrome;` polyfill to each script. Load unpacked for smoke tests.

## 10. Verification bar
`scripts/test.sh` = `npm test` (node --test "tests/**/*.test.mjs"; a bare `node --test tests/` fails on Node 26) · `npm run build:rules -- --check` ·
`node --check` on every extension script · `npm run build:chrome` (dist/chrome; exits 1 if a manifest-referenced file is missing) · macOS signed build +
`node tools/check-bundle.mjs build/NoSlop.app` · iOS signed device build + bundle check (`NOSLOP_SKIP_IOS=1` skips it; `NOSLOP_NO_APP_GROUP=1 scripts/build-ios.sh`
sideloads without app<->extension sync while the Apple PLA is unaccepted) · live smoke: inject the content scripts into youtube.com in a browser and
observe hides/dims with reasons (card hides arrive via the watch-HTML prefetch, a second or two after render) · review for correctness under
virtualization, false-positive risk and Safari-iOS API compatibility. Current state: docs/STATUS.md.
