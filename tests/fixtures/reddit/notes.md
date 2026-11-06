# reddit.com fixtures — capture notes

Captured 2026-11-02 (UTC ~23:05). **reddit.com could not be loaded in the headless browser**,
and `https://www.reddit.com/r/aiArt/` fetched with
curl returns the "Reddit - Prove your humanity" reCAPTCHA page (not bypassed). The fixtures were
instead taken from Reddit's own feed-pagination endpoint, which returns the identical
server-rendered `shreddit-post` light DOM that `shreddit-feed` inserts when you scroll:

```
https://www.reddit.com/svc/shreddit/community-more-posts/hot/?t=DAY&name=aiArt&feedLength=3
https://www.reddit.com/svc/shreddit/community-more-posts/hot/?t=DAY&name=midjourney&feedLength=3
```
(Safari 17 UA, 200 OK, ~1.0-1.2 MB each, 25 `shreddit-post` + 4 `shreddit-ad-post` per response,
no declarative shadow DOM — everything is slotted light DOM.) These are REAL Reddit HTML, not
synthetic, but note they were not captured from a live browser DOM: in a browser the custom
elements upgrade and attach a shadow root, and the slotted children below stay in the light DOM
exactly as in these files. Cleaning: svg/style/script/iframe/noscript/template/link removed,
`style`/`srcset`/`tabindex` removed, `data:` URIs → `[stripped]`, whitespace collapsed. Logged out,
no personal data (authors are public usernames on public posts).

## Files

| File | Nodes | Content |
|---|---|---|
| `aiart-shreddit-post.html` | 3 | r/aiArt posts, `post-type` image / gallery / crosspost |
| `aiart-shreddit-ad-post.html` | 1 | `shreddit-ad-post` (video ad, `promoted` attr) |
| `midjourney-shreddit-post.html` | 3 | r/midjourney posts, `post-type` gallery / image / video |
| `midjourney-shreddit-ad-post.html` | 1 | `shreddit-ad-post` (video ad) |

## Structure (observed, 50 posts / 8 ads)

* Each post is `article.w-full > shreddit-post` ("Reddit can wrap one shreddit-post in an article",
  matches research §2.7). Ads: `faceplate-batch > shreddit-ad-post` (no `article`, no
  `[data-testid="ad-post"]` in the SSR HTML — `data-testid="ad-post"` was 0/8).
* `shreddit-post` attributes seen: `id` (`t3_…`), `permalink`, `content-href`, `post-title`,
  `post-type` (image | gallery | crosspost | video | …), `author`, `author-id`, `subreddit-name`,
  `subreddit-prefixed-name`, `subreddit-id`, `score`, `comment-count`, `upvote-ratio`,
  `created-timestamp`, `domain`, `view-context="SubredditFeed"`, `view-type="cardView"`,
  `feedindex`, `post-language`, `icon`, `is-crosspost`, `gallery`, `locked`, `is-translatable`,
  `moderation-verdict`, `more-posts-cursor`, plus boolean flags `is-embeddable`,
  `is-desktop-viewport`, `is-awardable`, `hide-awards-button`, `share-button-count-enabled`,
  `data-ks-item`, `data-expected-lcp`.
* Light-DOM slots inside `shreddit-post`: `a[slot="full-post-link"]`, `span[slot="credit-bar"]`
  (contains `span[slot="authorName"]`… actually `authorName` is a nested slot), `div[slot="content"]`,
  `div[slot="ssr-post-content-header"]`, `a[slot="title"]`, **`shreddit-post-flair[slot="post-flair"]`**,
  `div[slot="post-media-container"]`, gallery pages `li[slot="page-N"]`, video `img[slot="poster"]`,
  `div[slot="loading-spinner"]`, `div[slot="recommendation-overlay"]`, `template[slot="error"]`.
* **Flair** (the only AI signal on Reddit — there is no site-wide AI label): the text lives in
  `shreddit-post-flair[slot="post-flair"] > a[href*="f=flair_name"] > span > div[aria-label="Flair: …"]`.
  Verbatim flair texts seen in r/aiArt (25 posts): `Image - ChatGPT` ×11, `Image - Krea 2` ×2,
  `Image - Midjourney` ×2, `Image - Microsoft Copilot`, `Image - Google Gemini` ×2, `Image - Meta AI`,
  `Image - Starryai`, `Image - Stable Diffusion`, `Image - Other: Please edit, or your post may be deleted.` ×3,
  `Politics ⚖️`. In r/midjourney: `AI Showcase - Midjourney` ×18, `AI Video - Midjourney` ×3,
  `Question - Midjourney AI`, `Paintover/Edited - Midjourney AI`, `Discussion - Midjourney AI` ×2.
* `shreddit-ad-post` attributes: `promoted` (boolean), `ad-type="video"`, `post-id`, `placement="feed"`,
  `call-to-action`, `campaign-id`, `impression-id`, `outbound-link-url`, `view-type`, plus the same
  post attrs (`id`, `permalink` under `/user/<advertiser>/comments/…`, `subreddit-name="u_<advertiser>"`,
  `author`, `post-type`, `score`…). Class list starts with `promotedlink`. Screen-reader text:
  `faceplate-screen-reader-content` = "Advertisement: <title>". Slots: `delegated-link[slot="full-post-link"]`,
  `div[slot="credit-bar"]`, `div[slot="content"]`, `div[slot="title"]`, `div[slot="post-media-container"]`,
  `delegated-link[slot="action-row-whitespace"]`.
* The "App" account label for automated accounts (research §1.5) was not present on any of the 50 posts.
