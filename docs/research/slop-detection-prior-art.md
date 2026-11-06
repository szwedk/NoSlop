# AI-slop detection in social feeds: prior art, heuristics, on-device feasibility

Research date: 2026-11-02. Target: iPhone + Mac app (Xcode 26.6, iOS/macOS 26.5 SDK) that removes AI-generated content and "AI slop" from Instagram, X, YouTube, and ideally Facebook/TikTok/Reddit/LinkedIn.

Legend: **VERIFIED** = read from the primary source (fetched page, downloaded file, API). **LIKELY** = from a secondary source or a search snippet quoting the primary. **UNVERIFIED** = could not confirm.

Third-party projects and licences are listed in [SOURCES.md](SOURCES.md); no third-party source files are stored here.

---

## 0. Decision-relevant summary

1. **Nobody has solved unlabeled detection; every shipping tool is a stack of (a) platform labels, (b) self-disclosure/hashtag regexes, (c) account blocklists, (d) text-style heuristics, and optionally (e) a cloud LLM/vision model.** The two highest-signal, lowest-false-positive layers are platform labels and self-disclosure text. Build those first.
2. **Platform labels you can read in the DOM / JSON today** (VERIFIED from filter lists and platform docs): Meta "AI info" / "Imagined with AI" (Facebook, Instagram, Threads); Instagram "AI-generated profile" (profile-level, since 2026-08-31); YouTube "Altered or synthetic content" and "Made with AI" in "How this content was made"; TikTok `aigcLabelType` / `moderationAigcLabelType` fields in the `/api/recommend/item_list/` JSON on tiktok.com web; X posts that link to `/grok` or carry Grok UI buttons, plus #aiart-family hashtags.
3. **Text heuristics are real but decaying.** Wikipedia's "Signs of AI writing" page (VERIFIED) is the best curated list; the berenslab PubMed excess-vocabulary dataset (MIT, 900 words, 407 tagged "style") and Juzek & Ward's 21 focal words (COLING 2025) are the best empirical ones. One secondary source reports that "delve" has already fallen below the human baseline in GPT-5-era text (LIKELY), so ship the lexicon as a remotely updatable JSON, not compiled-in constants.
4. **Open image detectors do not generalize to 2025-26 generators.** The Feb-2026 out-of-the-box benchmark (arXiv 2602.07814, 16 detectors, 2.6M images, 291 generators) puts the best mean accuracy at 78% (Community-Forensics) and per-generator accuracy on Flux Dev / Firefly v4 / Midjourney v7 / Imagen 4 at 18-24%, Nano Banana at 44.6% mean. A separate Aug-2026 paper shows 12-37 point drops on GPT Image 2 / Nano Banana 2. Treat any on-device image classifier as a weak, dim-only signal, never auto-hide.
5. **On-device feasibility**: iOS Safari web extension content scripts cannot call `sendNativeMessage` (only background/extension pages can); JS-side extension memory was raised to 80 MB in iOS 15.1 (Apple engineer); the native handler process has been measured at ~173-183 MB on iPhone 17 Pro Max / iOS 26.6 (UNVERIFIED, single developer); `runtime.sendMessage` caps at 64 MB per message. A SigLIP2-base image encoder converted to Core ML runs on the Neural Engine in 5.2 ms (FluidInference PR), so a small Core ML head on the native side is plausible if weights stay well under ~100 MB. On macOS the constraints are much looser.
6. **C2PA on delivered media**: Meta and YouTube transcode and strip manifests but carry the *label* forward; TikTok says it reads C2PA and attaches Content Credentials to AI content made on TikTok (whether delivered files keep them is UNVERIFIED). c2pa-web 0.15.5 is MIT; its WASM is 9.0 MB (measured), inline bundle 12.0 MB. Only worth loading on TikTok and on direct image URLs, not on Meta/YouTube.
7. **Platform-native controls we can drive** (so the app also "teaches" the platform): X muted words (words, phrases, usernames, emojis, hashtags); Instagram Hidden Words for recommendations, "Not interested", Snooze, Reset, and "Your Algorithm" free-text topics (all surfaces since 2026-06-10); YouTube "Not interested" / "Don't recommend channel" (no bulk; clear-all via My Activity); TikTok Manage Topics AIGC slider (Settings > Content preferences > Manage topics); Facebook "Your Algorithm" (Oct 2026); LinkedIn "I don't want to see this".
8. **Licensing traps**: AiSList (46,027 YouTube channels) is CC BY-NC 4.0; OpenSlop is PolyForm Noncommercial; Organika/sdxl-detector is CC-BY-NC-3.0; umm-maybe/AI-image-detector is CC BY-ND (no derivatives, so no Core ML conversion); alvi-se list is GPL-3. Safe to seed from: mt211211/ai-slop-blocker (MIT), adamnroman/slop-filter + wilu222/unpolish-ai-writing (MIT), dilipShaachi/slopfilter (MIT), Stevoisiak/Stevos-AI-Blocklist (MIT), berenslab/llm-excess-vocab (MIT), Bombek1 detector (MIT), c2pa-js (MIT).

---

## 1. Prior art: extensions and filter lists

Repo metadata below (pushed_at, licence, stars) was read from the GitHub API on 2026-11-02 (VERIFIED).

| Project | URL | Approach | Platforms | Last push | Licence | Stars |
|---|---|---|---|---|---|---|
| ai-slop-blocker (mt211211) | https://github.com/mt211211/ai-slop-blocker | Regex on explicit disclosures, hashtags, tool names, `aria-label`, `data-ai-generated` attributes; per-site selectors; creator-URL block rules; fully local | X, YouTube, generic sites | 2026-06-20 | MIT | 2 |
| slop-filter (adamnroman) | https://github.com/adamnroman/slop-filter | Cloud: sends post text to "TypeSafe Jev" (30 narrow yes/no style questions, logistic weights fitted from user labels) + local vocab tiers, em-dash/colon counts; blocks accounts after 3 flags; judges YouTube videos by transcript | X, LinkedIn, Reddit, YouTube comments/videos | 2026-10-08 | MIT (code) | 25 |
| SlopBlocker (KyleBenzle) | https://github.com/KyleBenzle/SlopBlocker | README only in repo (build is distributed elsewhere). Claims: platform labels (IG/FB/Threads "AI info", Pinterest "AI modified", TikTok, YouTube "Altered or synthetic content"), captions/alt text, images from AI-generator CDNs, C2PA/IPTC metadata, chatbot leftovers, optional user-supplied OpenAI/xAI/Ollama check; 5 sensitivity levels | Many | 2026-10-26 | none stated | 0 |
| AI-Slop-Blocker (0xBapen) | https://github.com/0xBapen/AI-Slop-Blocker | Layered regex: platform labels, AI CDN URL patterns, image meta, HIGH/MEDIUM/LOW text tiers, "slop emoji" list, X unlabeled-portrait-video heuristic, C2PA check | LinkedIn, X, Medium, Substack, Reddit, Facebook, HN, generic | 2026-03-07 | **none** (do not copy code) | 0 |
| slopfilter (dilipShaachi) | https://github.com/dilipShaachi/slopfilter | 170-phrase filler list (10 pts/hit, cap 60) + sentence-length-variance + other local heuristics; dim/hide; no network | Generic | 2026-03-20 | MIT | 2 |
| Slopdetector | https://github.com/Slop-Detector/Slopdetector | Adds a "scan" button; sends text to a user-chosen LLM; shows confidence | LinkedIn, Reddit | 2026-05-12 | MIT | 4 |
| OpenSlop (callmety) | https://github.com/callmety/openslop | Local preset catalog (scam signals, lead-magnet funnels, engagement bait, hustle culture, AI hype, founder theater, platitudes) with 5-stop slider; unmaintained | LinkedIn (engine site-agnostic) | 2026-05-13 | **PolyForm Noncommercial 1.0.0** (cannot be used in a sold app) | 1 |
| Stevo's AI Blocklist | https://github.com/Stevoisiak/Stevos-AI-Blocklist | uBlock/AdGuard cosmetic + scriptlet filter list, 6,136 lines; hides GenAI site features and AI-labeled content; works in AdGuard for Safari iOS/macOS | Google, YouTube, X, Facebook, Instagram, Reddit, TikTok, LinkedIn, Pixiv, DeviantArt, Amazon | 2026-11-02 | MIT | 1,049 |
| AiSList (Override92) | https://github.com/Override92/AiSList | Community-maintained YouTube channel blocklist: 46,027 high-confidence + 1,160 warnlist entries (`@handle` or `UC…` id); consumed by the AiBlock extension; submission criteria published | YouTube | 2026-11-02 | **CC BY-NC 4.0** | 377 |
| ai-ublock-blacklist (alvi-se) | https://github.com/alvi-se/ai-ublock-blacklist | Hand-curated AI content-farm *websites* for uBlock/uBlacklist; not feeds | Web search | 2026-10-28 | GPL-3.0 | 714 |
| youtube-ai-slop-visual-blocker (Kewydee) | https://github.com/Kewydee/youtube-ai-slop-visual-blocker | Canvas-based visual match on thumbnails for one recurring AI-avatar format | YouTube | 2026-08-26 | none | 0 |
| hide-ai-slop-extension (lc-nyovchev) | https://github.com/lc-nyovchev/hide-ai-slop-extension | Hides AI *summaries* (Google, Gmail, YouTube), not feed content | — | 2026-10-27 | MIT | 1 |

Other listings seen but not inspected: Chrome Web Store "Hide AI Slop" (https://chromewebstore.google.com/detail/hide-ai-slop/faoihddkdijgfklmejhdofigogkidfki), "AI Blocker" (paid detection API, https://chromewebstore.google.com/detail/ai-blocker/jhigdcjaokfemfaofdiibcohjpgnmidc), SlopProx (https://slopprox.com/), Firefox "YouTube DeSlop" (fetches a GitHub blocklist, https://addons.mozilla.org/addon/youtube-deslop/), "Slop Block" / "SlopBlock" (community DB, https://addons.mozilla.org/addon/slop-block/), DeadNetGuard (Chrome), AiBlock for YouTube (Chrome, uses AiSList), Slop Evader (pre-Nov-30-2022 date filter on search, https://www.theregister.com/2025/12/01/pregpt_slop_evader_browser/). "deAIfy" and "Nuke AI" returned no results under those names (UNVERIFIED that they exist).

### 1.1 What the open-source lexicons actually contain (licence-permitting)

**mt211211/ai-slop-blocker, `extension/content.js` (MIT, VERIFIED, downloaded)** — three regexes:

- `DISCLOSURE_PATTERN`: `ai[- ]generated | #aigenerated | generated (by|with|using) (an? )?ai | created (by|with|using) ai | made (by|with|using) ai | written by ai | ai[- ]assisted | synthetic (media|content|image|video) | artificially generated | altered or synthetic | generative ai | ai overview | ai summary | powered by ai | ai (art|artwork|image|images|video|videos|animation|music|voice|film|movie|short film|trailer|commercial) | midjourney | dall[- ]?e | stable diffusion | sora ai | openai sora | veo 3 | runway gen`
- `AI_MEDIA_PATTERN` hashtags: `#aiart #aiartcommunity #aivideo #aivideos #aianimation #aimusic #aifilm #aimovie #aiimages #aigenerated #generativeai #midjourney #stablediffusion #dalle #sora #runwayml #veo3 #klingai #pikalabs`, plus phrases `made with ai | generated with ai | made in ai | google veo | kling ai | pika labs | hailuo | luma dream machine | grok image | made with grok | generated with grok`
- `YOUTUBE_MEDIA_PATTERN`: "ai" within 45 chars of `art|animation|commercial|film|movie|music|short film|trailer|video` in a title.
- DOM attribute selectors: `[data-ai-generated='true']`, `[data-generated-by-ai='true']`, `[data-synthetic-media='true']`, `[data-testid*='ai-generated' i]`, any `aria-label`; X post root `article[data-testid='tweet']`.

**adamnroman/slop-filter, `src/vocab.js` (MIT, derived from wilu222/unpolish-ai-writing MIT, VERIFIED)** — three tiers with counting rules:

- ALWAYS (1 hit = nudge, 2 = full): delve, dive deep/deep dive, tapestry, embark, leverage, utilise/utilize, seamless(ly), nestled, showcase, "testament to", game-changer, groundbreaking, revolutionary, cutting-edge, "in order to", "serves as", "stands as", moreover, furthermore, additionally, "at its core", "it's important to note", amidst, load-bearing, realm(s), meticulous(ly), intricate/intricacies, ever-evolving, impactful, paradigm(s), comprehensive, pivotal, underscore, unpack, holistic, actionable, synergy.
- CLUSTER (tell only when ≥2 co-occur): harness, foster, streamline, empower, crucial, myriad, plethora, facilitate, enhance, resonate.
- DENSITY (tell only when ≥2 hits and ≥3% of words): significant(ly), innovative, compelling, remarkable, noteworthy, interesting.
- `src/model.js` lists the 30 style questions it asks the cloud model; the useful ones to port as regex/heuristics: assistant residue ("Certainly!", "Happy to help!", "Hope this helps!", "As an AI"); sycophantic opener ("Great question", "Love this", "What a fantastic breakdown"); contrast pivot ("It's not X, it's Y", "X, not Y", "less X, more Y", "Not A. Not B. Just C."); announced insight ("The catch is…", "The hard part is…", "The real unlock is…", "Here's the shift:"); invented label ("the X paradox/trap/tax/gap"); stakes inflation ("this changes everything"); vague authority ("experts say", "studies show"); parallel triad; verbless fragments ("Less busywork. More impact."); manufactured punchlines (≥3 one-line paragraphs); engagement close ("Thoughts?", "Anyone else seeing this?", "Would love to hear…"); bow-tie closer ("In conclusion", "At the end of the day", "That's it. That's the post."); paint words (quietly, deeply, fundamentally, remarkably, genuinely, landscape, robust, landed). Human tells it uses as negative evidence: invented words (-maxx, -pilled, -core), typos, stretched/repeated words, jokes.

**dilipShaachi/slopfilter, `content.js` (MIT, VERIFIED)** — 170 lowercase phrases scored 10 points each (cap 60) plus sentence-length variance. Highlights not in the other lists: "here's the thing", "the reality is", "whether you're a", "you might be wondering", "the good news is", "first and foremost", "last but not least", "unlock the power", "take it to the next level", "navigate the complexities", "foster a sense of", "non-negotiable", "in an era", "in a world where", "key takeaway(s)", "pro tip", "bottom line", "think of it as", "long story short", "it's no secret", "in today's digital", "allows you to", "empowers you to", "gold standard", "world-class", "best-in-class", "industry-leading", "unmatched", "unparalleled", "unprecedented", "reimagined", "changing the game", "raises the bar", "level up", "on steroids", "a must-have".

**0xBapen/AI-Slop-Blocker (no licence; the *platform label strings* are facts, the regex code is not ours to copy)** — platform label text it matches: "create your own with grok", "made with grok", "image by grok" (X); "made with ai", "imagined with ai", "ai-generated" (Meta); "written by ai", "created with ai", "ai-assisted" (LinkedIn); "ai-generated content", "created using ai" (TikTok); "altered or synthetic content", "realistic ai-generated" (YouTube); "content credentials" / "verify with content credentials" (C2PA badge). It also flags A1111/ComfyUI prompt dumps ("negative prompt:", "cfg scale", "sampler", "seed:", `sampler_name`, `cfg_scale`, `denoise`) and video hosted on `runwayml.com`, `pika.art`, `sora.com`, `kling.ai`/`klingai.com`, `replicate.delivery`, `lumalabs.ai`, `haiper.ai`, `hailuoai.com`, `minimax.io`. Its "slop emoji" set: 🔥💡✅🚀💪🌟⭐👇🎯📈💯✨🙌👉💎🏆⚡🎉🔑📌💼🤝🌐📊🧠.

**Stevoisiak/Stevos-AI-Blocklist, `GenAI-Blocklist.txt` (MIT, VERIFIED, downloaded)** — platform-specific facts worth reusing:

- TikTok web: `+js(json-prune-fetch-response, itemList.[-].aigcLabelType itemList.[-].moderationAigcLabelType, , propsToMatch, /item_list)` — i.e. the For-You JSON carries `aigcLabelType` and `moderationAigcLabelType` per item (line 4404). Strongest label signal on any platform.
- X: hides `cellInnerDiv` posts whose `tweetText` links to `/hashtag/aiart`, `/hashtag/aiartwork`, `/hashtag/aiporn`, or the `/i/communities/1876728323608338672/hashtag/aiart` community; posts linking `/grok`; posts with the Grok sparkle SVG path (`M12.998 1.94c.18 3.015…`); `[data-testid="grokImgGen"]`, `button[aria-label="Grok"]`, `grok_post_atgrok_button` (lines 4885-4936).
- Facebook: `[role="button"]:has-text(/(AI info|AI content)/)` upward to the post container (line ~3850); `[aria-label="Generate images using AI"]`; Meta AI logo alt text.
- Reddit: a 230-subreddit AI list used to hide *recommended* posts (`shreddit-post[recommendation-source]` with `subreddit-name` in r/aiArt, r/midjourney, r/StableDiffusion, r/dalle2, r/SoraAi, r/aivideo, r/AIGeneratedArt, r/weirddalle, r/ChatGPT, r/singularity, r/SunoAI, r/comfyui, r/civitai, r/nijijourney, r/leonardoai, r/FluxAI-adjacent names, etc.; full regex at lines 3855 and 3874 of the list).
- Instagram/Threads entries are mostly Meta AI UI chrome, not post labels (Instagram's class names are obfuscated and churn).

**Override92/AiSList (CC BY-NC 4.0, VERIFIED)** — `aislist_blocklist.txt`: 46,027 YouTube channels, one `@handle` or `UC…` per line, last modified 2026-07-19; `aislist_warnlist.txt`: 1,160 medium-confidence. Inclusion criteria (README): AI voices/TTS as primary content, AI visuals (Midjourney/DALL-E/SD), AI scripts, AI music, heavy automation, mass production; excluded: occasional AI use, channels *about* AI, light editing assistance. Licence is non-commercial, so a paid app cannot bundle it; letting the user subscribe to the raw URL at runtime is the same model AiBlock uses but is still a licence question for a commercial product (UNVERIFIED legally; ask the maintainer on their Discord).

---

## 2. Text heuristics for slop

### 2.1 Wikipedia "Signs of AI writing" (WikiProject AI Cleanup) — VERIFIED, fetched 2026-11-02

https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing (243k chars; first 200k read). The page stresses it is descriptive, not a ban list, and that detection needs a *combination* of signs. Categories and the literal markers it names:

- **AI vocabulary**: delve, tapestry, testament, pivotal, crucial, vibrant, valuable, intricate/intricacies, meticulous(ly), enduring, underscore (verb), showcase, highlight (verb), landscape (abstract), Additionally (sentence-initial), boasts, bolstered, emphasizing, enhance, fostering, garner, interplay, robust, deep dive, align with, key. Later-era additions: challenge, clearer, dependable, echoed, foster, leverage, matters, multifaceted, practical, prioritize, quietly, steady, universally. Grok-specific: causal, empirical, correlate.
- **Significance/legacy phrasing**: "stands/serves as", "is a testament/reminder", "a crucial/pivotal/vital/significant/key role/moment", "underscores its importance", "reflects broader", "setting the stage for", "marks a shift", "key turning point", "evolving landscape", "focal point", "indelible mark", "deeply rooted", "distinction matters".
- **Superficial -ing analyses**: highlighting/underscoring/emphasizing, ensuring, reflecting/symbolizing, contributing to, cultivating/fostering, encompassing, enhancing, "valuable insights", "align/resonate with".
- **Puffery**: "boasts a", vibrant, rich, profound, showcasing, exemplifies, "commitment to", "natural beauty", nestled, "in the heart of", groundbreaking, renowned, featuring, "diverse array".
- **Vague attribution**: "Industry reports", "Observers have cited", "Experts argue", "Some critics argue", "several sources".
- **Formulaic sections**: "Despite these challenges", "Challenges and Legacy", "Future Outlook/Prospects", "X and Y" headers.
- **Copula avoidance**: serves as, stands as, marks, functions as, operates as, represents, boasts, features, maintains, offers, "refers to".
- **Negative parallelisms**: "Not just X, but also Y", "not only… but…", "It is not just…, it's…", "Not X, but Y", "It's not…, it's…", "no…, no…, just…", "Y rather than X".
- **Rule of three**: "adjective, adjective, adjective"; "short phrase, short phrase, and short phrase".
- **Style**: title case in headings; overused boldface / stray asterisks; inline-header vertical lists; wrong heading levels; **emoji at the start of section titles or list entries**; curly quotes/apostrophes; Markdown leakage (`**bold**`, `#` headings, `---` dividers, `[text](url)`, triple backticks); leaked `contentReference[oaicite:1]`; `utm_source=chatgpt.com`.
- **Chatbot communication residue**: "I hope this helps", "Certainly!", "Of course!", "You're absolutely right!", "Would you like…", "is there anything else", "let me know", "more detailed breakdown", "here is a … [check/verify] … before [publishing]", "Here's a template for…".
- **Hedging/disclaimers**: "While specific details are limited/scarce…", "not widely available/documented", "based on available information", "It's important to note" (2023-24 era).
- **Knowledge-cutoff**: "Up to my last training update", "as of my last knowledge update".
- **Summaries**: "In summary", "In conclusion", "Overall", closing "Conclusion" sections.
- **Placeholders**: "[Describe the specific section…]", "[Article Title 1]", "2025-XX-XX", "INSERT_SOURCE_URL_30", "I hope this message finds you well".
- **Dated indicators**: em-dash overuse (the page dates it "2022 to September 2026"); newest era shows heavier periods/commas and 8-20-word sentences. Transition words (Additionally, Consequently, Notably) are "weak evidence alone".

Not found in the read portion: "Here's the thing", "Let that sink in", "🧵" (these are social-media, not Wikipedia, tells; see 2.3).

Secondary coverage: https://techcrunch.com/2025/11/20/the-best-guide-to-spotting-ai-writing-comes-from-wikipedia/ , https://the-decoder.com/heres-how-to-spot-ai-writing-according-to-wikipedia-editors/ (LIKELY-only; used for nothing above).

### 2.2 Empirical word lists (papers / datasets)

- **berenslab/llm-excess-vocab** (Kobak et al., PubMed "excess vocabulary"), https://github.com/berenslab/llm-excess-vocab — MIT, `results/excess_words.csv` has 900 words with a `type` column (462 content, 407 style, 24 content/style); updated July 2025 with monthly values (VERIFIED, downloaded). The 407 "style" words are the usable lexicon; representative: accentuates, additionally, adept, akin, amidst, bolster, burgeoning, commendable, compelling, comprehensive, crucial, culminating, delve/delves/delving, discern, elucidate, embracing, emphasizing, empowers, encapsulates, encompasses, enduring, enhance, exhibit, facilitate, formidable, foster(ing), garner(ed), groundbreaking, harness(ing), highlight(ing), illuminating, imperative, impactful, innovative, insights, intricate/intricacies, invaluable, leverage/leveraging, meticulous(ly), multifaceted, notable/notably, noteworthy, nuanced, pinpoint, pivotal, poised, prevalent, realm(s), remarkable, renowned, revolutionize, scrutinize, seamless(ly), showcase/showcasing, streamline, surpass(es), swift(ly), thorough, transformative, uncharted, underscore(s), unparalleled, unravel(ing), unveil(s), valuable, versatility. (Full list is in the CSV.)
- **Juzek & Ward, "Why Does ChatGPT 'Delve' So Much?", COLING 2025**, https://aclanthology.org/2025.coling-main.426.pdf — identifies **21 focal words** overused by ChatGPT-3.5 in scientific abstracts; the abstract names delve, intricate, underscore; the paper's prompt example adds delves, underscores, surpasses, emphasizing; a secondary summary adds commendable, meticulous, tapestry, realm (LIKELY for those four; the full 21-word table is in a figure, not extractable text — UNVERIFIED as a complete list). Code: github.com/tjuzek/delve.
- **medRxiv 2024.05.14.24307373** ("Delving into PubMed records"): 142 user-flagged terms tested, 100 with modified Z > 3.5 in 2024; underscore, meticulous, commendable, tapestry significantly up (LIKELY, from search snippet).
- **arXiv 2409.01754** (LLM influence on spoken language): a later revision reportedly says signature words are no longer over-used in GPT-5 revisions and "delve" falls below the human baseline (LIKELY). Design consequence: vocabulary tells have a half-life; weight them low and update them remotely.
- **Binoculars (Hans et al., ICML 2024)**, https://arxiv.org/abs/2401.12070 — zero-shot, ratio of perplexity to cross-perplexity from two related LLMs; 0.01% FPR reported. Needs two LLM forward passes per post; not realistic inside a Safari extension on iPhone, plausible in the Mac app with a small on-device pair but unproven (UNVERIFIED for small models). GPTZero's published feature set (perplexity/burstiness) was not found in a primary source (UNVERIFIED).

### 2.3 Social-media-specific slop markers (engagement bait, threads, bots)

- X policy (LIKELY, Social Media Today reporting Nikita Bier's posts): July 2026 — accounts soliciting engagement ("I'll follow everyone who replies") 3+ times are removed from revenue share; X removed 42,000 accounts using AI chatbots to automate replies and generic "thought-leadership"; May 2026 — autonomous AI agents posing as humans are forbidden. https://www.socialmediatoday.com/news/x-updates-its-engagement-bait-detection/825495/ , https://www.socialmediatoday.com/news/x-formerly-twitter-announces-ai-bot-crackdown/812289/
- Practitioner signals for reply bots (vendor blog, LIKELY): reply velocity (strongest), account age, 24/7 activity, same accounts always first, generic praise/promo. https://www.kitha.co/blog/how-to-spot-ai-bot-replies-on-x
- No published corpus was found that establishes "Let that sink in", "🧵", "Read that again" as *AI* markers specifically (UNVERIFIED); they are engagement-bait markers and are weighted as such below, not as AI evidence.

### 2.4 Seed lexicon design

Scoring model used in the JSON (Section 7): each matched item adds its weight; categories are capped; `score ≥ 1.0` = hide, `0.6-1.0` = dim/collapse with reveal, `< 0.6` = leave. Platform labels and explicit self-disclosure alone reach 1.0. Style vocabulary alone cannot exceed 0.6 (never auto-hide on style). Human tells subtract.

---

## 3. Image / video detection on-device

### 3.1 Open models

| Model | URL | Arch / size | Training | Reported metrics | Licence | Notes |
|---|---|---|---|---|---|---|
| umm-maybe/AI-image-detector | https://huggingface.co/umm-maybe/AI-image-detector | ViT (AutoTrain) | Oct 2022; no MJ5/SDXL/DALL-E 3 | acc 0.942, AUC 0.980 (own val) | **CC BY-ND 4.0** | Author says proof-of-concept for "artistic images"; recommends sdxl-detector. ND licence blocks Core ML conversion. |
| Organika/sdxl-detector | https://huggingface.co/Organika/sdxl-detector | Swin, 86.8M params; Safetensors + **ONNX** | Wikimedia vs SDXL (BLIP-captioned) | acc 0.9813, AUC 0.998 (own val); "may drop on non-SDXL" | **CC-BY-NC-3.0** | Non-commercial only. |
| Bombek1/ai-image-detector-siglip-dinov2 | https://huggingface.co/Bombek1/ai-image-detector-siglip-dinov2 | SigLIP2-SO400M-patch14-384 + DINOv2-Large, LoRA r=32, MLP head; ~740M params (~8M trainable); `pytorch_model.pt` | OpenFake, 25+ generators incl. SD 1.5-3.5, Flux 1.0/1.1 Pro, DALL-E 3, MJ v5/v6, Imagen, GPT-Image-1, Firefly, Ideogram, GANs | AUC 0.9997 / 99.1% (OpenFake val); 97.15% cross-dataset; MJ v6 96.33%, DALL-E 3 100% | MIT | No Sora 2 / Veo 3 / Nano Banana 2 / GPT-Image-2 in training. ~1.5 GB fp16: Mac-only, or distill. No ONNX/Core ML export documented. |
| ash12321/nano-banana-pro-detector-minimal | https://huggingface.co/ash12321/nano-banana-pro-detector-minimal | small ViT, frozen backbone | 400 images | "95-97%" self-reported | ? | Too small to trust (LIKELY). |
| dima806/ai_vs_real_image_detection; Dafilab/ai-image-detector; Smogy/SMOGY-Ai-images-detector; jacoballessio/ai-image-detect-distilled | huggingface.co/… | ViT fine-tunes | 2-year-old data per card notes | self-reported | varies | Not inspected in detail (UNVERIFIED). |

### 3.2 Independent benchmarks (the numbers that matter)

- **arXiv 2602.07814 (Feb 2026), "How well are open sourced AI-generated image detection models out-of-the-box"** — 16 methods / 23 variants, 12 datasets, 2.6M images, 291 generators, zero-shot, no threshold tuning. Best mean accuracy: Community-Forensics 0.780 (median 0.821), DRCT CLIP-ViT SD1.4 0.721, DRCT SD2.0 0.718, SAFE 0.688, PatchCraft 0.675. Per-generator mean accuracy across detectors: **Flux Dev 21%, Firefly v4 18%, Midjourney v7 24%, Imagen 4 19%, DALL-E 3 31%**; Community-Forensics 35-42% on the newest commercial generators; Nano Banana dataset 44.6% mean; accuracy falls from ~79% (2020-21 generators) to ~38% (2024). Compression/resizing *not* evaluated; cites a study where >95% detectors fell below 60% on social-media content. https://arxiv.org/abs/2602.07814 (VERIFIED, fetched)
- **arXiv 2608.01258 (Aug 2026), "A Benchmark Dataset for MLLM-Generated Image Detection: GPT Image2 & Nano Banana2"** — 4 recent detectors (LTD, PGC, GAPL, IAPL) drop 12-37 points: GPT Image2 acc 82.5 / 57.2 / 75.1 / 70.4; Nano Banana2 80.7 / 72.8 / 81.1 / 72.3. Code+dataset at github.com/xbrainnet/SAP-DSP. https://arxiv.org/html/2608.01258v1 (VERIFIED, fetched)
- Video: **RobustSora** (arXiv 2512.10248) — detectors lean on Sora's visible watermark; removing it drops accuracy 11-14 pp for Sora 2 vs 3-6 pp for Pika/Open-Sora. **GenVidBench** (AAAI 2026, 6.78M videos) — Sora and SVD hardest. **DF26** (arXiv 2609.07369) — includes Veo 3.1, Kling 3.0; human accuracy near chance; controlled access. AIGVDBench (CVPR 2026) excluded Veo 3 and Sora 2 for access reasons. (All LIKELY, from search snippets.) Sora 2 visible watermark: present at launch, removal tools immediately appeared; reports in Oct 2025 that some outputs no longer carried it (LIKELY). Veo: SynthID invisible watermark, readable only by Google tools (LIKELY). Grok Imagine watermark policy: UNVERIFIED.
- Commercial claims (Pangram 99.5%, TruthScan 99%+, Sightengine) are vendor-run; a developer retest of a Sightengine-based checker on 20 GPT Image 2.5 images missed 0 and flagged 1/40 real (tiny sample, LIKELY). https://www.pangram.com/blog/introducing-pangram-image-detection

**Conclusion**: use image classification only as a *dim* signal with a high threshold, and prioritise watermark/credential/label signals. If a classifier is shipped, fine-tune a SigLIP2-base head on OpenFake + GPT-Image-2/Nano-Banana-2 data and re-evaluate on JPEG-recompressed, resized samples (what feeds actually deliver).

### 3.3 Core ML conversion

- coremltools: PyTorch → ML Program with `ct.convert`, default `compute_precision` float16 for ML programs, `compute_units=ALL` uses CPU+GPU+ANE, `CPU_AND_NE` available. https://apple.github.io/coremltools/docs-guides/source/convert-to-ml-program.html , https://apple.github.io/coremltools/docs-guides/source/load-and-convert-model.html (VERIFIED via search of apple.github.io)
- SigLIP2 conversions exist and are documented: FluidInference/siglip2-base-patch16-256-coreml (fp16 image+text packages, 256×256 input, 768-d output); their PR reports ImageNet zero-shot 76.76% Core ML vs 76.79% PyTorch and **image encoder 100% on ANE at 5.2 ms**. https://huggingface.co/FluidInference/siglip2-base-patch16-256-coreml , https://github.com/FluidInference/mobius/pull/109 . Gotcha: numpy ≥ 2.4 breaks coremltools 9.0's PyTorch frontend on `MultiheadAttention` (pin numpy < 2.4) per https://huggingface.co/nodevorg/siglip2-base-patch16-256-coreml (LIKELY).
- DINOv2: no published Core ML package found; a DINOv3 ViT-B/16 Core ML conversion exists (https://huggingface.co/rinpatch/dinov3-coreml, unofficial). Swin: no Core ML example found (UNVERIFIED that it converts cleanly; ONNX exists for sdxl-detector but licence is NC).

### 3.4 Safari web extension constraints (iOS)

- Apple doc (VERIFIED, fetched): https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension — "Content scripts that are injected into web content cannot send messages to the native app extension." Only background scripts / extension pages can call `browser.runtime.sendNativeMessage` (needs `nativeMessaging` permission); native side implements `beginRequest(with:)` and reads `SFExtensionMessageKey`; containing iOS app **cannot** push messages to the extension JS (macOS can via `SFSafariApplication.dispatchMessage` + `connectNative`). App Groups are the shared-data channel.
- Memory: Apple Frameworks Engineer, Oct 2021: extension limit "increased to 80MB in the latest iOS 15.1 beta" (from 6 MB in 15.0). https://developer.apple.com/forums/thread/687642 (VERIFIED). A Jan-2026 developer measurement: native extension side killed between 173 and 183 MB on iPhone 17 Pro Max / iOS 26.6 (UNVERIFIED, single report: https://github.com/serpcompany/zenbujapanese-monorepo/issues/947). `runtime.sendMessage` caps at 64 MB per message on iOS and Mac, throws catchable exception, no auto-chunking; Mobile Safari *pages* crash at ~100 MB on iPhone SE 3 / ~200 MB iPad 8 (iOS 26.2). https://lapcatsoftware.com/articles/2026/1/7.html (VERIFIED)
- Background page must be non-persistent on iOS (forum, LIKELY: https://developer.apple.com/forums/thread/790310).
- Implication for pipeline: content script → `runtime.sendMessage` (image URL or downscaled base64 thumbnail, well under 64 MB) → background → `sendNativeMessage` → native handler runs Core ML (weights ideally ≤ 50 MB fp16/int8 to stay far under the ~170 MB ceiling) → response → content script dims/hides. Or run a small ONNX/WebGPU model in the background page within the 80 MB budget. Latency budget ~10-30 ms/image on ANE is realistic for SigLIP2-base-class encoders; the 740M Bombek1 ensemble is Mac-app only.
- Safari content blockers (declarative) cannot match on text and are capped at 150,000 rules per blocker (AdGuard-reported, UNVERIFIED against Apple docs: https://adguard.com/kb/adguard-for-safari/solving-problems/rule-limit/); AiSList's 46k handles would fit as URL rules only on youtube.com/@handle pages, not feed cards.

### 3.5 C2PA / Content Credentials

- **Meta** (VERIFIED, https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/): "AI info" label (renamed from "Made with AI" July 2024) on Facebook, Instagram, Threads, driven by "industry standard indicators" and self-disclosure; "Imagined with AI" for Meta AI images. Third-party tests say Instagram re-encodes and delivered files carry no EXIF/C2PA (LIKELY: https://aimetadataremover.org/blog/does-instagram-keep-c2pa/ ; https://c2pa.ai/instagram returned empty). Instagram "AI-generated profile" label and reach limits for undisclosed AI personas announced 2026-08-31 (VERIFIED via TechCrunch: https://techcrunch.com/2026/08/31/instagram-puts-new-limits-on-undisclosed-ai-profiles/).
- **YouTube** (VERIFIED, https://support.google.com/youtube/answer/15447836 and https://support.google.com/youtube/answer/15446725): "How this content was made" in expanded description and sometimes on the player; "Made with AI" carried forward from C2PA ≥ 2.1 when the whole video is AI, plus creator disclosure in Studio and YouTube's own detection; "Captured with a camera" requires C2PA 2.1+ and an unbroken chain; an "Info from" line names the signing authority. Raw manifest exposure to viewers: not documented (UNVERIFIED).
- **TikTok** (VERIFIED, https://newsroom.tiktok.com/more-ways-to-spot-shape-and-understand-ai-content?lang=en , 2025-11-19): reads C2PA on upload to auto-label; "will continue adding C2PA Content Credentials to AI-generated content made on the platform"; testing invisible watermark only TikTok can read; 1.3B videos labeled. Whether delivered MP4s retain the manifest: UNVERIFIED. The web For-You JSON carries `aigcLabelType` (VERIFIED via Stevo's list rule).
- **c2pa-js** (VERIFIED, https://github.com/contentauth/c2pa-js and package README): MIT; `@contentauth/c2pa-web` 0.15.5; `createC2pa({wasmSrc})` + `Reader.fromBlob(c2pa, blob.type, blob)` → `manifestStore()`; WASM `dist/resources/c2pa_bg.wasm` = **9,003,876 bytes** (downloaded), `dist/inline.js` = 12,005,824 bytes (jsDelivr listing); unpacked npm 21.2 MB; assets > 1 GB rejected. For a Safari extension this is a heavy optional module; only load on TikTok media and on direct `<img>` URLs that are not CDN re-encodes. Native alternative: c2pa-rs via Swift (not evaluated).

---

## 4. Account-level signals

- **YouTube**: AiSList criteria above (TTS voice primary, AI visuals, AI scripts, AI music, mass production). Kapwing's Dec-2025 study (278 all-AI-slop channels among ~15,000 trending; 63B views; 221M subs; 21% of first 500 Shorts to a fresh account were AI slop, 33% "brainrot") used manual review via playboard.co + Social Blade; **no classification criteria or channel list published** (VERIFIED via https://www.neomam.com/projects/youtube-ai-slop-report/ ; Kapwing's own page 404'd). Guardian/Playboard: ~10% of the 100 fastest-growing channels are all-AI (LIKELY). YouTube banned at least 18 slop channels by Jan 2026 (Tubefilter, LIKELY: https://tubefilter.com/2026/01/29/youtube-ai-slop-channel-crackdown-bans/). Usable signals: channel description containing AI tool names/"AI-generated"; "Altered or synthetic content" label on recent uploads; upload cadence (several long videos per day); Shorts with TTS narration (needs audio, out of scope for a web extension); recurring stock AI-avatar thumbnails (Kewydee's canvas approach).
- **X**: Grok-origin posts (links to `/grok`, Grok sparkle icon), #aiart community, reply-velocity/age/24-7 patterns (vendor, LIKELY). No maintained public X account blocklist found (UNVERIFIED that one exists); DeviantArt 2022 "AI art account" blocklist is stale.
- **Instagram**: "AI-generated profile" label (self-applied; undisclosed ones get demoted) is the authoritative profile-level signal; editorial lists of virtual influencers (Lil Miquela, Aitana López, Imma, Milla Sofia, Shudu) exist (https://en.wikipedia.org/wiki/Aitana_L%C3%B3pez , https://www.bracai.eu/post/ai-influencer-instagram — LIKELY, editorial, not blocklists). Hashtags #aimodel #aiinfluencer #virtualinfluencer #aigirl are the practical seed.
- **Reddit**: Stevo's 230-subreddit list (MIT) for hiding recommended posts from AI subs.

---

## 5. What the platforms themselves offer (so the app can drive them)

| Platform | Control | Where | Source |
|---|---|---|---|
| YouTube | "Not interested" (+ "Tell us why"), "Don't recommend channel" / "Don't recommend posts from channel"; no bulk; clear all via My Activity → Other Google activity → YouTube 'Not interested' feedback → Delete | More (⋮) on Home/Watch Next | https://support.google.com/youtube/answer/6342839 (VERIFIED) |
| YouTube | "How this content was made": Made with AI / Captured with a camera / Altered or synthetic | expanded description, player | 15447836, 15446725 (VERIFIED) |
| X | Muted words: words, phrases, usernames, emojis, hashtags; removes from timeline, notifications, replies; case-insensitive; still visible in search; recommendations respect them; durations selectable | Settings and privacy → Privacy and safety → Mute and block → Muted words (web); Notifications gear → Muted → Muted words (mobile) | https://help.x.com/en/using-x/advanced-x-mute-options (page 403'd to fetch; details LIKELY from help.x.com snippets) |
| Instagram | "Not interested" (X on post or ⋮); Snooze suggested posts 30 days; Reset suggested content (Settings → Content preferences); Hidden Words for recommended posts (caption words/emoji/hashtags); Sensitive content Less/More; "Your Algorithm" free-text more/less topics across Feed/Reels/Explore (Dec 2025 → all surfaces 2026-06-10; Reels/Explore icon top-right or Settings → Content preferences → Your algorithm) | — | https://about.instagram.com/blog/announcements/reels-algorithm-control (VERIFIED); https://help.instagram.com/423267105807548/ (body not returned; LIKELY); https://about.fb.com/news/2024/11/introducing-recommendations-reset-instagram/ |
| Instagram | "AI-generated profile" label; undisclosed AI personas lose non-follower reach | profile | TechCrunch 2026-08-31 (VERIFIED) |
| TikTok | AIGC amount slider in Manage Topics (Settings → Content preferences → Manage topics); For You only; adjusts, does not remove | — | TikTok newsroom 2025-11-19 (VERIFIED); TechCrunch 2025-11-18 (VERIFIED) |
| Facebook | "Your Algorithm" free-text interests + Interested/Not interested follow-ups (Oct 2026) | ⋮ on post | https://about.fb.com/news/2026/10/introducing-your-algorithm-facebook/ (LIKELY, via search) |
| LinkedIn | "I don't want to see this" with reason; unfollow/mute | control menu on post | https://www.linkedin.com/help/linkedin/answer/62570 (VERIFIED) |
| Reddit | Mute communities / hide recommended | — | UNVERIFIED (reddit.com blocks fetches) |
| Pinterest | GenAI content amount control (Oct 2025) | — | LIKELY (community.pinterest.biz) |

Automation reality: none of these have public APIs for the feedback actions (X API v2 has mute *users* only; muted keywords, YouTube "Not interested", Instagram Hidden Words are UI-only — UNVERIFIED for X keywords, VERIFIED-by-absence for YouTube Data API). On the Mac, a Safari web extension content script can click these menu items on x.com / youtube.com / instagram.com web; on iPhone the native apps are untouchable, so the app should (a) filter inside Safari, and (b) generate a one-tap "paste this list into X Muted words / Instagram Hidden Words" flow and deep-link to the settings screens.

---

## 6. Recommended architecture (from the evidence)

1. **Layer 0 — platform labels** (weight 1.0, hide): DOM text/attrs listed in 1.1 and TikTok JSON fields. Lowest FP.
2. **Layer 1 — self-disclosure + hashtags + tool names** (0.6-0.9): mt211211 regexes + the seed below.
3. **Layer 2 — account lists**: user's own blocks (synced via App Group / iCloud), optional subscription to community lists (AiSList needs licence clearance for commercial use), Instagram AI-profile label, Stevo's Reddit sub list.
4. **Layer 3 — style heuristics** (cap 0.6, dim only): Wikipedia/berenslab/slop-filter lexicon, pivot/triad/emoji-bullet/em-dash/markdown structure, engagement-bait closers; human tells subtract.
5. **Layer 4 — optional on-device vision** (dim only, Mac first): SigLIP2-base Core ML head trained on OpenFake + 2026 MLLM-image data; iOS only if ≤ 50 MB; never auto-hide on vision alone given 18-45% accuracy on current generators.
6. **Layer 5 — C2PA read** (TikTok + direct image URLs only; 9 MB WASM lazy-loaded or native c2pa-rs).
7. Ship lexicon + selectors as a signed JSON fetched daily; Instagram/Facebook class names churn weekly (see Stevo's obfuscated selectors) so selectors must be remote-updatable.

---

## 7. Seed lexicon (JSON)

Weights: additive per matched item, with per-category caps; `hide ≥ 1.0`, `dim ≥ 0.6`. Sources: W = Wikipedia Signs of AI writing; B = berenslab style list (MIT); J = Juzek & Ward; S = slop-filter/unpolish-ai-writing (MIT); D = dilipShaachi/slopfilter (MIT); M = mt211211 (MIT); ST = Stevo's list (MIT); P = platform documentation; X = X policy reporting; O = our addition (UNVERIFIED as AI marker; engagement-bait only).

```json
{
  "version": "2026-11-02.1",
  "scoring": {
    "hide_threshold": 1.0,
    "dim_threshold": 0.6,
    "category_caps": {
      "platform_label": 1.0,
      "self_disclosure": 1.0,
      "hashtag": 0.9,
      "tool_name": 0.6,
      "chatbot_residue": 1.0,
      "prompt_metadata": 1.0,
      "structure": 0.5,
      "engagement_bait": 0.4,
      "vocab_always": 0.5,
      "vocab_cluster": 0.2,
      "closer": 0.25,
      "human_tell": -0.6
    },
    "notes": "Style categories (structure, engagement_bait, vocab_*, closer) together can never exceed 0.6, so style alone dims but never hides."
  },
  "platform_labels": [
    {"platform": "instagram|facebook|threads", "text": "AI info", "weight": 1.0, "src": "P"},
    {"platform": "instagram|facebook|threads", "text": "AI content", "weight": 1.0, "src": "ST"},
    {"platform": "instagram|facebook|threads", "text": "Imagined with AI", "weight": 1.0, "src": "P"},
    {"platform": "instagram|facebook|threads", "text": "Made with AI", "weight": 1.0, "src": "P"},
    {"platform": "instagram", "text": "AI-generated profile", "weight": 1.0, "scope": "author", "src": "P"},
    {"platform": "youtube", "text": "Altered or synthetic content", "weight": 1.0, "src": "P"},
    {"platform": "youtube", "text": "Made with AI", "weight": 1.0, "src": "P"},
    {"platform": "youtube", "text": "How this content was made", "weight": 0.5, "src": "P", "note": "section also appears for Captured with a camera; combine with child text"},
    {"platform": "tiktok", "json_field": "aigcLabelType", "weight": 1.0, "src": "ST"},
    {"platform": "tiktok", "json_field": "moderationAigcLabelType", "weight": 1.0, "src": "ST"},
    {"platform": "tiktok", "text": "AI-generated", "weight": 1.0, "src": "P"},
    {"platform": "tiktok", "text": "Created using AI", "weight": 1.0, "src": "P"},
    {"platform": "x", "href": "/grok", "weight": 1.0, "src": "ST"},
    {"platform": "x", "text": "Create your own with Grok", "weight": 1.0, "src": "P"},
    {"platform": "x", "text": "Made with Grok", "weight": 1.0, "src": "P"},
    {"platform": "x", "svg_path_prefix": "M12.998 1.94c.18 3.015 1.04 5.156 2.473 6.59 1.433", "weight": 1.0, "src": "ST"},
    {"platform": "x", "selector": "[data-testid=\"tweetText\"] a[href^=\"/hashtag/aiart\" i]", "weight": 1.0, "src": "ST"},
    {"platform": "x", "href_prefix": "/i/communities/1876728323608338672", "weight": 1.0, "src": "ST"},
    {"platform": "linkedin", "text": "Written by AI", "weight": 1.0, "src": "P"},
    {"platform": "any", "text": "Content Credentials", "weight": 0.6, "src": "P", "note": "C2PA badge; may also mark camera-captured, so read manifest if possible"},
    {"platform": "any", "selector": "[data-ai-generated='true'],[data-generated-by-ai='true'],[data-synthetic-media='true'],[data-testid*='ai-generated' i]", "weight": 1.0, "src": "M"}
  ],
  "self_disclosure_regex": [
    {"re": "\\bai[- ]generated\\b", "weight": 0.9, "src": "M"},
    {"re": "\\b(?:generated|created|made|produced|rendered) (?:by|with|using|in) (?:an? )?(?:ai|chatgpt|gpt-?[45o]?|claude|gemini|copilot|grok|sora ?2?|veo ?3(?:\\.1)?|midjourney|dall[- ]?e ?3?|stable diffusion|flux|kling|runway|pika|luma|hailuo|nano banana(?: pro| 2)?|gpt[- ]image|ideogram|firefly|imagen|wan ?2(?:\\.\\d)?|hunyuan|seedance|suno|udio|elevenlabs)\\b", "weight": 0.9, "src": "M+O"},
    {"re": "\\b(?:made|generated) with (?:grok|grok imagine)\\b", "weight": 0.9, "src": "M"},
    {"re": "\\bai[- ]assisted\\b", "weight": 0.5, "src": "M"},
    {"re": "\\bsynthetic (?:media|content|image|video)\\b", "weight": 0.8, "src": "M"},
    {"re": "\\bartificially generated\\b", "weight": 0.8, "src": "M"},
    {"re": "\\bai (?:art|artwork|image|images|video|videos|animation|music|voice|film|movie|short film|trailer|commercial|influencer|model|girl|woman|beauty)\\b", "weight": 0.7, "src": "M+O"},
    {"re": "\\b(?:this|the) (?:image|video|photo|clip) (?:was |is )?(?:generated|created|made) (?:by|with|using) ai\\b", "weight": 0.9, "src": "O"},
    {"re": "\\bprompt:\\s", "weight": 0.5, "src": "O"},
    {"re": "\\b(?:text|image)[- ]to[- ](?:image|video)\\b", "weight": 0.4, "src": "O"}
  ],
  "hashtags": {
    "strong_0.8": ["#aiart", "#aiartwork", "#aiartcommunity", "#aigenerated", "#aiimage", "#aiimages", "#aivideo", "#aivideos", "#aianimation", "#aifilm", "#aimovie", "#aimusic", "#generativeai", "#midjourney", "#midjourneyart", "#stablediffusion", "#dalle", "#dalle3", "#sora", "#sora2", "#openaisora", "#veo", "#veo3", "#veo31", "#googleveo", "#nanobanana", "#nanobananapro", "#nanobanana2", "#gptimage", "#chatgptimage", "#grokimagine", "#grok", "#klingai", "#kling", "#runwayml", "#runway", "#pikalabs", "#lumaai", "#dreammachine", "#hailuo", "#minimax", "#fluxai", "#flux", "#leonardoai", "#comfyui", "#automatic1111", "#civitai", "#ideogram", "#adobefirefly", "#firefly", "#imagen", "#sunoai", "#udio", "#aiphotography", "#aimodel", "#aiinfluencer", "#virtualinfluencer", "#aigirl", "#aigirls", "#aiwoman", "#aibeauty", "#aifashion", "#aiportrait", "#aicharacter", "#aiavatar", "#aishorts", "#aireels", "#aicinema", "#aistorytelling", "#wan2", "#hunyuanvideo", "#seedance"],
    "weak_0.4": ["#ai", "#artificialintelligence", "#genai", "#aitools", "#chatgpt", "#openai", "#texttoimage", "#texttovideo", "#promptart", "#promptengineering", "#digitalart", "#fantasyart", "#conceptart"],
    "src": "M + Stevo X selectors + O"
  },
  "tool_names_in_text_0.4_each": ["midjourney", "stable diffusion", "sdxl", "dall-e", "dalle", "sora 2", "sora", "veo 3", "veo 3.1", "google veo", "nano banana", "gpt-image", "gpt image", "grok imagine", "kling", "runway gen-3", "runway gen-4", "runwayml", "pika", "luma dream machine", "hailuo", "minimax", "flux.1", "flux dev", "flux pro", "leonardo ai", "comfyui", "automatic1111", "civitai", "lora", "ideogram", "firefly", "imagen 4", "wan 2.1", "wan 2.2", "hunyuan", "seedance", "suno", "udio", "elevenlabs", "heygen", "synthesia", "d-id", "ltx"],
  "chatbot_residue_0.9": ["as an ai language model", "as an ai,", "i am an ai", "i'm an ai", "i hope this helps", "hope this helps", "certainly!", "of course!", "absolutely!", "you're absolutely right", "great question", "happy to help", "feel free to ask", "let me know if you", "would you like me to", "is there anything else", "here's a template", "here is a template", "as of my last knowledge update", "up to my last training update", "my knowledge cutoff", "my training data", "i can't assist with that", "i cannot provide that", "i should be clear that", "more detailed breakdown", "i hope this message finds you well", "contentreference[oaicite", "utm_source=chatgpt.com", "[insert ", "[your name]", "[article title", "2025-xx-xx", "insert_source_url"],
  "prompt_metadata_0.9": ["negative prompt:", "cfg scale", "cfg_scale", "sampler:", "sampler_name", "steps: ", "seed: ", "denoise", "checkpoint:", "lora:", "--ar ", "--v 6", "--v 7", "--niji", "--stylize"],
  "structure": [
    {"id": "contrast_pivot", "re": "\\b(?:it'?s|this is|that'?s) not (?:just |only |about )?[^.?!]{2,60}[,;—-] (?:it'?s|this is|that'?s|but) ", "weight": 0.3, "src": "W,S"},
    {"id": "stacked_negation", "re": "(?:^|\\n)\\s*Not [^.\\n]{1,40}\\.\\s*Not [^.\\n]{1,40}\\.\\s*(?:Just|Only) ", "weight": 0.35, "src": "W,S"},
    {"id": "not_just_but", "re": "\\bnot (?:just|only) [^.?!]{2,60} but (?:also )?", "weight": 0.2, "src": "W"},
    {"id": "emoji_bullets", "rule": ">=3 lines starting with an emoji", "weight": 0.3, "src": "W"},
    {"id": "emoji_density", "rule": ">=5 distinct emoji from set 🔥💡✅🚀💪🌟⭐👇🎯📈💯✨🙌👉💎🏆⚡🎉🔑📌🧠 in a post under 120 words", "weight": 0.2, "src": "O (set from 0xBapen, facts only)"},
    {"id": "em_dash_density", "rule": ">=2 em dashes per 100 words (post >= 40 words)", "weight": 0.25, "src": "W (dated 2022-Sep 2026)"},
    {"id": "parallel_triad", "rule": "three consecutive clauses/fragments with identical skeleton, e.g. 'Ship faster. Learn faster. Win faster.'", "weight": 0.2, "src": "W,S"},
    {"id": "one_line_paragraph_stack", "rule": ">=4 consecutive one-sentence paragraphs each under 12 words", "weight": 0.2, "src": "S"},
    {"id": "markdown_leak", "re": "(?:\\*\\*[^*\\n]{2,60}\\*\\*|^#{1,3} |^---$|\\[[^\\]]+\\]\\(https?://)", "weight": 0.3, "src": "W"},
    {"id": "title_case_heading", "rule": "line of 3-8 words all Title Case followed by a colon or newline", "weight": 0.15, "src": "W"},
    {"id": "curly_quotes", "rule": "curly quotes/apostrophes in a platform that does not auto-curl (X web does not)", "weight": 0.1, "src": "W"},
    {"id": "announced_insight", "re": "\\b(?:the (?:catch|trick|hard part|real unlock|key insight|real story|underrated bit) is|here'?s the (?:thing|shift|kicker)|let that sink in|read that again)\\b", "weight": 0.25, "src": "S,D,O"},
    {"id": "vague_authority", "re": "\\b(?:experts (?:say|argue|agree)|studies show|research suggests|many believe|observers have cited|industry reports)\\b", "weight": 0.15, "src": "W,S"}
  ],
  "engagement_bait_0.2_each": ["🧵", "thread 👇", "a thread:", "1/ ", "rt if", "retweet if", "repost if", "like if", "follow for more", "follow me for", "i'll follow everyone who", "comment \"", "comment '", "and i'll send you", "dm me \"", "save this post", "bookmark this", "save for later", "tag someone who", "drop a 🔥", "drop a ❤️", "agree?", "who else", "am i the only one", "let that sink in", "read that again", "most people don't know this", "nobody talks about this", "here's what nobody tells you", "you won't believe", "this changes everything", "game changer 👇", "steal this", "free pdf", "link in bio to", "share this with"],
  "vocab_always_0.12_each_cap_0.5": ["delve", "delves", "delving", "tapestry", "testament to", "pivotal", "crucial", "meticulous", "meticulously", "intricate", "intricacies", "underscore", "underscores", "underscoring", "showcase", "showcases", "showcasing", "landscape", "realm", "realms", "leverage", "leveraging", "seamless", "seamlessly", "game-changer", "game changer", "groundbreaking", "cutting-edge", "revolutionary", "revolutionize", "moreover", "furthermore", "additionally", "it's important to note", "it is important to note", "it's worth noting", "at its core", "deep dive", "dive deep", "unpack", "holistic", "actionable", "synergy", "paradigm", "multifaceted", "ever-evolving", "harness", "foster", "fostering", "empower", "empowering", "elevate", "nuanced", "embark", "navigate the complexities", "in today's fast-paced", "in the ever-evolving", "digital landscape", "vibrant", "boasts", "nestled", "in the heart of", "diverse array", "serves as", "stands as", "commendable", "surpass", "unparalleled", "unwavering", "transformative", "robust", "comprehensive", "indelible", "deeply rooted", "evolving landscape", "setting the stage", "key turning point", "focal point", "valuable insights", "resonate with", "align with", "a reminder that", "quietly", "profound", "enduring"],
  "vocab_cluster_min2_0.2": ["streamline", "facilitate", "enhance", "myriad", "plethora", "innovative", "compelling", "remarkable", "noteworthy", "notably", "bolster", "garner", "burgeoning", "akin", "amidst", "elucidate", "encompass", "exhibit", "formidable", "imperative", "pinpoint", "poised", "prevalent", "scrutinize", "swiftly", "uncharted", "unravel", "unveil", "versatility", "invaluable", "impactful", "pioneering", "renowned"],
  "closers_0.2_each": ["in conclusion", "in summary", "to summarize", "to sum up", "overall,", "at the end of the day", "final thoughts", "key takeaway", "key takeaways", "the bottom line", "bottom line:", "that's it. that's the post", "that's the update", "wrapping up", "moving forward", "going forward", "stay tuned", "the future is", "exciting times ahead"],
  "human_tells_negative": [
    {"id": "casual_markers", "re": "\\b(?:lol|lmao|lmfao|rofl|tbh|ngl|idk|imo|smh|bruh|fr fr|ong)\\b", "weight": -0.15, "src": "S"},
    {"id": "stretched_word", "re": "([a-z])\\1{3,}", "weight": -0.15, "src": "S"},
    {"id": "invented_suffix", "re": "\\w+(?:maxx|pilled|core|posting)\\b", "weight": -0.1, "src": "S"},
    {"id": "all_lowercase_long", "rule": "post >= 30 words with zero capital letters", "weight": -0.15, "src": "S"},
    {"id": "typo_density", "rule": ">=2 common misspellings per 100 words (dictionary check)", "weight": -0.2, "src": "S"},
    {"id": "too_short", "rule": "fewer than 6 words: skip style scoring entirely", "weight": 0, "src": "S"}
  ],
  "account_seeds": {
    "youtube": {
      "community_list": {"url": "https://raw.githubusercontent.com/Override92/AiSList/main/AiSList/aislist_blocklist.txt", "count": 46027, "licence": "CC BY-NC 4.0", "note": "NOT bundleable in a commercial app without permission; offer as user-added subscription only after licence clearance"},
      "description_regex": "\\b(?:ai[- ]generated|made with ai|ai narrat|text[- ]to[- ]speech|synthetic voice|midjourney|sora|veo ?3|stable diffusion|faceless channel)\\b",
      "cadence_rule": ">=3 uploads/day over 14 days AND description_regex OR label 'Altered or synthetic content' on >=50% of last 10 uploads"
    },
    "x": {
      "handles_weight_1.0": ["grok"],
      "note": "Posts by/with @grok or linking /grok. No maintained public AI-account blocklist for X was found; user-built list + 3-strikes auto-suggest (slop-filter pattern)."
    },
    "instagram": {
      "profile_label": "AI-generated profile",
      "self_declared_virtual_influencers_opt_in": ["lilmiquela", "fit_aitana", "imma.gram", "millasofiafin", "shudu.gram"],
      "note": "Editorial/self-declared AI personas (Wikipedia: Aitana López; bracai.eu list). Ship as an OPT-IN pack, never default, and verify handles before release (UNVERIFIED)."
    },
    "reddit": {
      "ai_subreddits_hide_recommended": "see Stevoisiak GenAI-Blocklist.txt line 3855 (MIT): aiArt, midjourney, StableDiffusion, dalle2, SoraAi, aivideo, AIGeneratedArt, weirddalle, ChatGPT, singularity, SunoAI, comfyui, civitai, nijijourney, leonardoai, AiArtLounge, AIArtwork, aiwars, DefendingAIArt, etc. (230 names)"
    }
  },
  "platform_actions": {
    "x_muted_words_paste": ["#aiart", "#aiartcommunity", "#aigenerated", "#aivideo", "#midjourney", "#stablediffusion", "#sora", "#veo3", "#nanobanana", "#grokimagine", "#klingai", "#aimodel", "#aiinfluencer", "made with grok", "generated with ai", "ai-generated", "let that sink in", "🧵"],
    "instagram_hidden_words_paste": ["#aiart", "#aigenerated", "#aimodel", "#aiinfluencer", "#aigirl", "#midjourney", "#stablediffusion", "#nanobanana", "#aiphotography", "ai-generated", "made with ai"],
    "instagram_your_algorithm_less": ["AI-generated images", "AI-generated videos", "AI influencers", "AI art"],
    "tiktok": "Settings > Content preferences > Manage topics > AI-generated content slider to minimum",
    "youtube": "per-card: More > Don't recommend channel (content script on youtube.com / m.youtube.com); undo at myactivity.google.com"
  }
}
```

---

## 8. Open questions / UNVERIFIED items to close before shipping

1. Whether TikTok's *delivered* MP4s retain C2PA manifests (would justify loading c2pa-web there).
2. iOS native-extension memory ceiling on iOS 26.5 (single report says ~173-183 MB; measure on device with a 50 MB and 100 MB Core ML model).
3. Juzek & Ward's full 21-word table (figure only in PDF).
4. X muted-words limits (count/length) and whether the X app deep-links to the muted-words screen.
5. Reddit's current mute-community UI and whether reddit.com web exposes the `recommendation-source` attribute used by Stevo's rule (it did as of the list's last update, 2026-11-02).
6. AiSList commercial-use permission.
7. Whether Instagram's Hidden Words for recommendations still exists under that name in 2026 (help page body did not load).
8. Grok Imagine watermark/label behaviour on X in 2026.
