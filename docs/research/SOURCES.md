# Third-party sources and licences

NoSlop's detection data was informed by the projects below. Only MIT-licensed lexicons and lists were used as input
for the seed data in `Extension/Resources/rules.json`; no third-party source files are stored in this repository.
Selectors and label strings are platform facts, recorded in `platform-dom-and-ai-labels.md` with the repository and
commit they were read from.

## Used as input (MIT)

| Project | URL | Used for |
|---|---|---|
| ai-slop-blocker (mt211211) | https://github.com/mt211211/ai-slop-blocker | Disclosure, AI-media and hashtag regex ideas |
| slop-filter (adamnroman), derived from unpolish-ai-writing (wilu222) | https://github.com/adamnroman/slop-filter | Style vocabulary tiers and counting rules |
| slopfilter (dilipShaachi) | https://github.com/dilipShaachi/slopfilter | Filler-phrase list |
| Stevo's AI Blocklist (Stevoisiak) | https://github.com/Stevoisiak/Stevos-AI-Blocklist | AI subreddit seed list, X/Meta label facts |
| llm-excess-vocab (berenslab) | https://github.com/berenslab/llm-excess-vocab | Excess-vocabulary style words |

## Read for selectors and platform behaviour only (no code copied)

| Project | URL | Licence |
|---|---|---|
| control-panel-for-twitter, control-panel-for-youtube (insin) | https://github.com/insin | see repository |
| DeArrow, SponsorBlock (ajayyy) | https://github.com/ajayyy/DeArrow | see repository |
| blocktube (amitbl) | https://github.com/amitbl/blocktube | see repository |
| uAssets (uBlockOrigin) | https://github.com/uBlockOrigin/uAssets | see repository |
| instagram-feed-blocker (shbernal) | https://github.com/shbernal/instagram-feed-blocker | see repository |
| better-linkedin (fx-biocoder) | https://github.com/fx-biocoder/better-linkedin | see repository |
| ai-slop-shield, youtube-ai-filter | see `platform-dom-and-ai-labels.md` | see repository |
| Greasy Fork userscripts 552339, 516666, 589405, 551021 | https://greasyfork.org | see each script |
| 0xBapen/AI-Slop-Blocker | https://github.com/0xBapen/AI-Slop-Blocker | none stated; only platform label strings noted |

## Evaluated and not bundled

| Project | URL | Licence | Why not |
|---|---|---|---|
| AiSList (Override92) | https://github.com/Override92/AiSList | CC BY-NC 4.0 | Non-commercial; the app can import it from a URL the user supplies |
| OpenSlop (callmety) | https://github.com/callmety/openslop | PolyForm Noncommercial 1.0.0 | Non-commercial |
| ai-ublock-blacklist (alvi-se) | https://github.com/alvi-se/ai-ublock-blacklist | GPL-3.0 | Website list, not feed content |
| SlopBlocker (KyleBenzle), youtube-ai-slop-visual-blocker (Kewydee) | https://github.com/KyleBenzle/SlopBlocker | none stated | No licence |
| Organika/sdxl-detector, umm-maybe/AI-image-detector | https://huggingface.co | CC-BY-NC-3.0 / CC BY-ND 4.0 | Model licences forbid on-device redistribution or conversion |

Full per-project notes, commit hashes and dates are in `slop-detection-prior-art.md` and `platform-dom-and-ai-labels.md`.
