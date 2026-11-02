// OpenSlop — Shared Constants
// ─────────────────────────────────────────────────────────────────────────────
// All selectors and configuration values live here.
// If the host site's DOM ever drifts, this is the ONLY file you update.
//
// 2026 DOM status (audited via MHTML snapshots, Mar 2026):
//   • feed-shared-actor__* family is dead — only update-components-* survives.
//   • Stable primary hooks: aria-label patterns, data-testid, role, href patterns.
//   • Class selectors kept only where confirmed in CSS or as fallbacks.
//   • Notification rows: main article.nt-card, main li.nt-card, and
//     data-view-name="notification-card-container" (confirmed HTML/CSS).
//   • InMail badge: .msg-conversation-card__pill confirmed HTML (Mar 2026).
// ─────────────────────────────────────────────────────────────────────────────

/* exported HU */

var HU = {

  // ── Storage ────────────────────────────────────────────────────────────────
  STORAGE_KEY:          'hu_settings',
  POPUP_SESSION_ID_KEY: 'hu_popup_session_id',

  // ── Split-storage format (avoids chrome.storage.sync QUOTA_BYTES_PER_ITEM) ──
  // hu_settings holds only small/core fields (see saveSettings).
  // Large arrays and filter objects live in their own sync keys so no single
  // item ever approaches the 8,192-byte per-item limit.
  SETTINGS_STORAGE_FORMAT:      2,
  SETTINGS_BLACKLIST_KEY:       'hu_settings_blacklist',
  SETTINGS_PRESET_STATE_KEY:    'hu_settings_preset_state',
  SETTINGS_SPLIT_FIELD_MAP: [
    { field: 'blacklist',   key: 'hu_settings_blacklist',    defaultValue: [] },
    { field: 'presetState', key: 'hu_settings_preset_state', defaultValue: {} },
  ],
  // Single source of truth for split sync keys used by save/load + live listeners.
  SETTINGS_SYNC_KEYS: [
    'hu_settings',
    'hu_settings_blacklist',
    'hu_settings_preset_state',
  ],

  // ── DOM Markers ────────────────────────────────────────────────────────────
  HIDDEN_CLASS:     'hu-hidden',
  HIDDEN_ATTR:      'data-hu-hidden',
  DIMMED_ATTR:      'data-hu-dimmed',
  KIND_ATTR:        'data-hu-kind',
  GHOST_ATTR:       'data-hu-ghost',
  GHOST_SCORE_ATTR: 'data-hu-ghost-score',

  // ── Site DOM Selectors ─────────────────────────────────────────────────────
  SELECTORS: {

    // ── POST CARDS ──────────────────────────────────────────────────────────
    //
    // The host migrated to a fully obfuscated class-name system in early 2026.
    // The stable DOM hook is now the feed list/listitem role+testid pattern:
    //
    //   div[role="list"][data-testid="mainFeed"]
    //     div[data-display-contents="true"]   ← intermediate wrapper(s)
    //       div (obfuscated, componentkey)    ← additional wrapper
    //         div[role="listitem"]            ← one card per listitem
    //
    // Mar 2026 audit (li 1 feed with scroll.mhtml): listitems are NOT direct
    // children of mainFeed — they are 3–4 levels deep inside obfuscated wrapper
    // divs. The child combinator (>) must NOT be used; use a descendant selector.
    // resolveFeedCard() walks closest(feedCardItem) and verifies the ancestor
    // mainFeed via feedCardList to avoid matching nested listitems in other contexts.
    postContainer:
      'div[role="list"][data-testid="mainFeed"] div[role="listitem"]',

    // ── FEED CARD LIST / ITEM ────────────────────────────────────────────────
    // Decomposed selectors for resolveFeedCard(). feedCardList identifies the
    // outer feed wrapper; feedCardItem identifies individual card boundaries.
    // resolveFeedCard() walks el.closest(feedCardItem) and confirms an ancestor
    // matches feedCardList (via data-testid attribute check) before committing.
    feedCardList:
      'div[role="list"][data-testid="mainFeed"]',
    feedCardItem:
      'div[role="listitem"]',

    // Text nodes to SCAN inside each post card.
    // 2026: post body lives in span[data-testid="expandable-text-box"].
    // extractText() falls back to full card textContent if no selector matches.
    postText: [
      'span[data-testid="expandable-text-box"]',
    ],

    // ── COMMENT ROWS ────────────────────────────────────────────────────────
    //
    // Container to HIDE — `article.comments-comment-entity` is the current
    // outermost wrapper for a single comment. The older class is kept as fallback.
    commentContainer:
      'article.comments-comment-entity,' +
      ' .comments-comment-item,' +
      ' .social-details-social-activity__comment',

    // Text nodes to SCAN inside each comment row.
    // Mar 2026 audit (myfeed/myprofile snapshots):
    // - comments-comment-item__main-content is present in live comment HTML.
    // - attributed-text-segment-list__content and comments-comment-item__text
    //   were not observed in captured comment DOM and are pruned.
    commentText: [
      '.comments-comment-item__main-content',
      '.update-components-text',
    ],

    // ── POST META / HEADER TEXT ─────────────────────────────────────────────
    // Header/subheader text only — used for social-context and repost detection.
    // 2026: actor/profile region identified by aria-label*=" Profile ".
    // isSuggested() supplements this with a dedicated p-text check for "Suggested".
    postMetaText: [
      'div[aria-label*=" Profile "]',
    ],

    // ── ACTOR HEADER PARAGRAPH ───────────────────────────────────────────────
    // The header-level <p> that immediately follows the "Feed post" h2's adjacent
    // sibling div. In 2026, this element carries the reactor's action text for
    // activity-noise cards ("Julio Rodríguez likes this", "Will DeBause commented
    // on this", etc.) and the timestamp for direct-post cards. It has NO aria-label
    // and no stable class — only its structural position is reliable.
    //
    // Mar 2026 audit (li 1, li 6, feed MHTMLs): confirmed across all
    // sampled cards. The <p componentkey> is always the FIRST <p> inside the div
    // that immediately follows the h2[span="Feed post"].
    //
    // Consumed ONLY by getReactorHeaderText() using querySelector (first match),
    // never querySelectorAll, to avoid matching post-body paragraphs.
    actorHeaderText: 'h2 + div p',

    // ── ACTOR / AUTHOR SCOPE CONTAINERS ─────────────────────────────────────
    // Narrows author-link searches to the header/actor region so body links
    // (e.g. company mentions in post text) don't interfere.
    // 2026: actor region identified by the aria-label Profile pattern.
    actorScopes: [
      'div[aria-label*=" Profile "]',
      'header',
    ],

    // ── ACTOR DESCRIPTION / HEADLINE ────────────────────────────────────────
    // Nodes carrying the actor's job title / headline. Used by isAiFiltered()
    // to scan the actor headline for AI-filter terms.
    // 2026: headline lives in aria-label on the profile region div.
    // Consumers must read both getAttribute('aria-label') and textContent.
    actorDescription: [
      'div[aria-label*=" Profile "]',
    ],

    // ── PROMOTED STRUCTURAL SELECTORS ────────────────────────────────────────
    // Self-or-descendant checks consolidated from isPromoted(). Adding a new
    // promo pattern means editing this one key; isPromoted() uses it
    // via matchesSelfOrDescendant(card, HU.SELECTORS.promotedStructural).
    // Note: text-search fallbacks remain in isPromoted() itself (they require
    // a scoped querySelectorAll + string test, not a pure selector match).
    //
    // Mar 2026 audit: [data-promoted-id], [data-id^="urn:li:inAppPromotion:"],
    // a[attributionsrc], and [attributionsrc] are all dead (not found in live DOM).
    // .update-components-promo-v1 confirmed in CSS. data-testid="promoted-badge"
    // was observed in real capture data for promoted feed cards.
    promotedStructural:
      '.update-components-promo-v1,' +
      ' [data-testid="promoted-badge"],' +
      ' [aria-label*="view sponsored content" i],' +
      ' img[alt*="view sponsored content" i],'+
      ' svg[aria-label*="view sponsored content" i]',

    // ── ACTOR NAME ──────────────────────────────────────────────────────────
    // Display name of the post author / company. Tried in specificity order.
    // 2026: name lives in a <p> inside the actor region div (aria-label
    // carries "Name … Profile …"). Class names are fully obfuscated; the <p>
    // inside the actor region is identified by being scoped to the actorScopes
    // div — extractDisplayNameFromActorRoot() searches these within actorRoot.
    // Mar 2026 audit: feed-shared-actor__name* family dead; update-components-actor__name
    // confirmed CSS-only; href-scoped aria-hidden spans kept as fallbacks.
    actorName: [
      'div[aria-label*=" Profile "] p',
      'a[href*="/in/"] span[aria-hidden="true"]',
      'a[href*="/company/"] span[aria-hidden="true"]',
      '.update-components-actor__name span[aria-hidden="true"]',
      '.update-components-actor__name',
    ],

    // ── ACTOR AVATAR ────────────────────────────────────────────────────────
    // Profile image in the actor/header region. src is the CDN URL we save.
    // Mar 2026 audit: feed-shared-actor__avatar dead; update-components-actor__avatar
    // confirmed in CSS. Aria-label scoped img kept as stable fallback.
    actorAvatar: [
      'div[aria-label*=" Profile "] img',
      '.update-components-actor__avatar img',
      '.update-components-actor img.EntityPhoto',
    ],

    // ── OPEN TO WORK FRAME ───────────────────────────────────────────────────
    // 2026: OTW is signalled in two stable places:
    //   1. The actor region div aria-label contains ", Open to work " (case-exact).
    //      isOpenToWorkPost() reads that via getActorRegionAriaLabel().
    //   2. The avatar svg/img element has aria-label="View {Name}'s profile, open to work".
    // Both are covered by the aria-label*="open to work" i case-insensitive selector.
    // Class-based selectors kept as legacy fallbacks.
    otwFrame:
      '[aria-label*="open to work" i],' +
      ' .pv-member-badge--open-to-work,' +
      ' .member-highlighted-badge--open-to-work,' +
      ' [data-live-test-open-to-work],' +
      ' .open-to-work',

    // ── ENTITY LINKS (person or page) ───────────────────────────────────────
    // Used together with actorScopes to find the primary author href.
    entityLink:
      'a[href^="/in/"],' +
      ' a[href*="linkedin.com/in/"],' +
      ' a[href^="/company/"],' +
      ' a[href*="linkedin.com/company/"],' +
      ' a[href^="/school/"],' +
      ' a[href*="linkedin.com/school/"],' +
      ' a[href^="/showcase/"],' +
      ' a[href*="linkedin.com/showcase/"]',

    // ── POLLS ────────────────────────────────────────────────────────────────
    // Radio-style option inputs — require at least 2 for poll detection.
    pollOption:
      'input[type="radio"], [role="radio"]',

    // ── INTERACTIVE BUTTONS ──────────────────────────────────────────────────
    // Used for text/ARIA scanning (e.g. "Vote", "See results") in poll detection.
    actionButton:
      'button, [role="button"]',

    // ── SEARCH FEEDBACK CARD ─────────────────────────────────────────────
    // "Are these results helpful?" card that appears in search result lists.
    // 2026: data-view-name="search-feedback-card" is present in current
    // search captures, but obfuscated-class variants also exist. Keep both:
    // selector-first for fast path + text fallback in content-script.
    searchFeedbackCard:
      '[data-view-name="search-feedback-card"],' +
      ' .search-feedback-card',

    // ── SEARCH FEEDBACK HIDE TARGET ──────────────────────────────────────────
    // Ancestor element to hide when the text-based fallback finds a search-feedback
    // <p> node. Do NOT reuse searchFeedbackCard for this — that selector drives
    // collectMatches() which feeds evaluateSearchFeedbackCard() unconditionally.
    // These are the search-result card shell containers that wrap the feedback card;
    // confirmed alive in li 8 audit (.reusable-search__result-container CSS-only;
    // li.artdeco-card confirmed HTML).
    searchFeedbackHideTarget:
      '[data-view-name="search-entity-result-universal-template"],' +
      '.reusable-search__result-container,' +
      ' li.artdeco-card',

    // ── RIGHT-RAIL ADS ──────────────────────────────────────────────────────
    // Ad units in the aside sidebar (right-rail news area, sponsored cards).
    // Scoped to aside only — never overlaps with feed scanning.
    rightRailAdContainer:
      'aside section.ad-banner-container,' +
      ' aside [data-ad-banner],' +
      ' aside [data-ad-banner-id],' +
      ' aside [data-test-ad-banner],' +
      ' aside iframe.ad-banner,' +
      ' aside div[data-ssr-props*="textAds"],' +
      ' aside div[data-ssr-props*="ads/start"]',

    // ── RESILIENT SIDEBAR TARGETING ────────────────────────────────────────
    // Reusable targeting bundles for right-rail module detection and shell
    // resolution. These power JS-side resilient matching when the host reshapes
    // wrappers/classes in SDUI rollouts.
    //
    // moduleAnchors: independent semantic signals; score >= 2 => module match.
    // shellSelectors: nearest module shell candidates when collapsing/hiding.
    sidebarModuleSignals: {
      news: {
        moduleAnchors: [
          'a[href*="/news/story/"]',
          'button[aria-label*="info" i]',
          '[id="signal-notice-small"]',
          '[aria-label*="linkedin news" i]',
        ],
        shellSelectors: 'section, article, nav, .artdeco-card, div',
      },
      games: {
        moduleAnchors: [
          'a[href*="/games/"]',
          'a[href*="linkedin.com/games/"]',
          '#todays-games-entrypoint-title',
          '.ps-basic-entrypoint__link',
          'img[src*="streak_icon_"]',
          'svg[id*="games" i]',
        ],
        shellSelectors: 'section, article, nav, .artdeco-card, ul, ol, div',
      },
      ads: {
        moduleAnchors: [
          'iframe[title*="advertisement" i]',
          'iframe[src*="ads" i]',
          '[data-ad-banner]',
          '[data-ad-banner-id]',
          '[data-test-ad-banner]',
          'div[data-ssr-props*="ads/start"]',
        ],
        shellSelectors: 'section, article, nav, .artdeco-card, div',
      },
      events: {
        moduleAnchors: [
          'a[href*="/events/"]',
          'a[href*="/newsletters/"]',
          '[data-view-name*="event"]',
          '[data-view-name*="newsletter"]',
        ],
        shellSelectors: 'section, article, nav, .artdeco-card, div',
      },
      suggested: {
        moduleAnchors: [
          'button[aria-label*="connect" i]',
          'button[aria-label*="follow" i]',
          '[aria-label*="people you may know" i]',
          '[data-view-name*="pymk" i]',
        ],
        shellSelectors: 'section, article, nav, .artdeco-card, div',
      },
      shareBox: {
        moduleAnchors: [
          '.share-box-feed-entry__closed-share-box',
          'button[aria-label*="Start a post" i]',
          '[role="button"][aria-label*="Start a post" i]',
          'a[href*="/article/new/"]',
        ],
        shellSelectors: 'section, article, .artdeco-card, div',
      },
      leftProfile: {
        moduleAnchors: [
          'a[href^="/in/"]',
          'a[href*="linkedin.com/in/"]',
          'img[src*="profile-displayphoto"]',
          'img[src*="profile-displaybackgroundimage"]',
        ],
        shellSelectors: 'section, article, nav, .artdeco-card, div',
      },
    },

    // ── PROFILE SURFACE SIGNALS (/in/*) ────────────────────────────────────
    // Semantic signal bundles for marker-first profile page ownership.
    // Runtime uses these for main/right branch scoring and module tagging.
    // All lists are conservative by design — ambiguous ownership must fail open.
    profileSurfaceSignals: {
      shellSelectors: 'section, article, nav, .artdeco-card, div',
      mainHeadingNeedles: [
        'about',
        'experience',
        'featured',
        'activity',
        'education',
        'skills',
        'recommendations',
        'projects',
        'publications',
        'interests',
      ],
      metricsTextNeedles: [
        'profile views',
        'search appearances',
        'post impressions',
        'viewer insights',
        'followers',
      ],
      shortcutsTextNeedles: [
        'profile language',
        'public profile & url',
        'public profile',
        'edit public profile',
      ],
      suggestedTextNeedles: [
        'suggested for you',
        'people you may know',
        'who your viewers also viewed',
        'you might like',
      ],
      eventsTextNeedles: [
        'events',
        'newsletters',
        'webinar',
      ],
      detailAnchors: [
        'a[href*="/details/experience/"]',
        'a[href*="/details/education/"]',
        'a[href*="/details/skills/"]',
        'a[href*="/details/recommendations/"]',
      ],
      introAnchors: [
        'a[href^="/in/" i]',
        'a[href*="linkedin.com/in/" i]',
        'img[src*="profile-displayphoto" i]',
        'img[src*="profile-displaybackgroundimage" i]',
      ],
      introTextNeedles: ['open to work'],
      metricsAnchors: [
        'a[href*="/analytics/profile-views/"]',
        'a[href*="/analytics/search-appearances/"]',
        'a[href*="/analytics/creator/content/"]',
        'a[href*="/me/profile-views/"]',
      ],
      shortcutsAnchors: [
        'a[href*="/public-profile/settings"]',
        'a[href*="/public-profile/"]',
      ],
      suggestedAnchors: [
        'button[aria-label*="connect" i]',
        'button[aria-label*="follow" i]',
        '[aria-label*="people you may know" i]',
        'a[href^="/in/" i]',
        'a[href*="linkedin.com/in/" i]',
      ],
      eventsAnchors: [
        'a[href*="/events/"]',
        'a[href*="/newsletters/"]',
      ],
      premiumAnchors: [
        'a[href*="/premium/products"]',
        'a[href*="/premium/subscribe"]',
        'a[href*="/premium/upsell"]',
        'a.premium-upsell-link',
        '[data-control-name*="premium_upsell" i]',
      ],
      adsAnchors: [
        'iframe[title*="advertisement" i]',
        'iframe[src*="ads" i]',
        '[data-ad-banner]',
        '[data-ad-banner-id]',
        '[data-test-ad-banner]',
        'div[data-ssr-props*="ads/start"]',
      ],
    },

    // ── CONNECTION-DEGREE BADGE ─────────────────────────────────────────────
    // Nodes in the post actor/header area that carry the connection degree label.
    // Text-matched against CONNECTION_DEGREE_RES for "1st", "2nd", "3rd+" detection.
    // Mar 2026 audit: feed-shared-actor__* variants dead; update-components-actor__*
    // confirmed CSS-only. Actor region aria-label also carries degree text.
    connectionDegreeBadge: [
      'div[aria-label*=" Profile "]',
      '.update-components-actor__supplementary-actor-info',
      '.update-components-actor__meta .distance-badge',
      '.update-components-actor__meta .dist-value',
    ],

    // ── MEDIA TYPE SELECTORS ────────────────────────────────────────────────
    // Used for format-based card filtering.
    // Mar 2026 audit: feed-shared-*-video and feed-shared-image dead.
    // update-components-*-video and update-components-image confirmed CSS.
    // mediaDocument / mediaLinkPreview: no sample with those card types captured;
    // update-components-* kept speculatively; feed-shared-* variants removed.
    mediaVideo:
      '.update-components-linkedin-video',

    mediaImage:
      '.update-components-image',

    // Mar 2026 audit (li 8 document posts.mhtml): .update-components-document__container
    // confirmed in live HTML. The base class .update-components-document may not appear
    // as a standalone class on the container element; target the __container variant.
    mediaDocument:
      '.update-components-document__container,' +
      ' .update-components-document',

    // Mar 2026 audit: .update-components-article-link is dead (not found in CSS or HTML).
    // The live class for external link-preview cards is .update-components-article
    // (confirmed CSS-only in li 6 and li 8 snapshots).
    mediaLinkPreview:
      '.update-components-article',

    // ── POST TIMESTAMP ──────────────────────────────────────────────────────
    // <time datetime="..."> elements in the actor/meta area.
    // 2026: time element lives inside the Profile aria-label region.
    // Tried in specificity order — stable selectors first, class fallbacks after.
    // Mar 2026 audit: feed-shared-actor__sub-description and feed-shared-actor__description
    // dead. update-components-actor__sub-description confirmed CSS-only.
    postTimestamp: [
      'div[aria-label*=" Profile "] time[datetime]',
      'header time[datetime]',
      '.update-components-actor__sub-description time[datetime]',
      '.update-components-actor__description time[datetime]',
      'time[datetime]',
    ],

    // ── COMMENT HEADLINE ────────────────────────────────────────────────────────
    // Commenter job title / headline node — scanned against the keyword blacklist
    // so users can filter commenters by role ("recruiter", "coach", etc.).
    commentHeadline: '.comments-post-meta__headline',

    // ── MESSAGING SIDEBAR ───────────────────────────────────────────────────────
    // Conversation list item rows in the messaging sidebar / inbox.
    // Mar 2026 audit: .msg-conversation-listitem__link and
    // .msg-conversations-container__convo-item-link are dead (not in CSS or HTML).
    // Current 2026 rows are identified by .msg-conversation-card__* family elements;
    // msg-conversation-listitem remains present as a stable shell fallback.
    msgContainer:
      'li.msg-conversation-listitem,' +
      ' article.msg-conversation-listitem,' +
      ' li:has(.msg-conversation-listitem__link),' +
      'li:has(.msg-conversation-card__participant-names),' +
      ' li:has(.msg-conversation-card__message-snippet-container),' +
      ' li:has(.msg-conversation-card__conversation-description)',

    // ── MESSAGING SENDER HEADLINE ────────────────────────────────────────────
    // The occupation/headline line shown under the sender name in inbox rows.
    // Used to detect recruiter outreach without scanning the full message body.
    // Mar 2026 audit (li 5 messaging inbox.mhtml):
    //   msg-conversation-card__participant-info — dead (not in CSS or HTML).
    //   msg-conversation-listitem__participant-names — dead (not in CSS or HTML).
    //   msg-conversation-card__participant-names — confirmed CSS.
    //   msg-conversation-card__message-snippet-container — confirmed CSS.
    //   msg-conversation-card__conversation-description — confirmed CSS (new).
    msgSenderHeadline:
      '.msg-conversation-card__participant-names,' +
      ' .msg-conversation-card__message-snippet-container,' +
      ' .msg-conversation-card__conversation-description',

    // ── MESSAGING INMAIL BADGE ────────────────────────────────────────────────
    // The host marks InMail threads with a span carrying the text "InMail".
    // Mar 2026 audit (li 7 inmail badge.mhtml): confirmed HTML:
    //   <span class="msg-conversation-card__pill t-14 t-black t-bold pr1">InMail</span>
    // .msg-conversation-listitem__inmail-indicator and [data-control-name="inmail_thread"]
    // are dead (not in CSS or HTML). Removed.
    msgInMailBadge:
      '.msg-conversation-card__pill,' +
      ' .msg-conversation-card__pill-label',

    // ── JOB CARD COMPANY LINK ────────────────────────────────────────────────
    // Anchor element in a job card linking to the posting company's profile page.
    // Used by cross-surface muting to extract the company canonical key.
    jobCardCompanyLink:
      'a[data-control-name="company_link"],' +
      ' a.job-card-container__company-name,' +
      ' a[href*="/company/"]',

    // ── MESSAGING SENDER PROFILE LINK ────────────────────────────────────────
    // Anchor elements in a message thread row that link to the sender's profile.
    // Used by cross-surface muting to extract the person/company canonical key.
    msgSenderLink:
      'a[href*="/in/"],' +
      ' a[href*="/company/"]',

    // ── MESSAGING SHELL / ADS ANCHORS ───────────────────────────────────────
    // Shell seed selectors for the Messaging list-detail experience.
    // Apr 2026 audit (messaging MHTML):
    //   main#main.scaffold-layout_list-detail.msg__list-detail
    //   .scaffold-layout__list-detail-container
    //   [data-test-msg-cross-pillar-inbox-top-bar-wrapper]
    //   .msg-conversations-container__title-row
    // Keep semantic test-id + stable module classes ahead of generic fallbacks.
    msgShellSeed:
      '[data-test-msg-cross-pillar-inbox-top-bar-wrapper],' +
      ' .msg-cross-pillar-inbox-top-bar-wrapper__container,' +
      ' .msg-conversations-container__title-row,' +
      ' .msg-conversations-container--inbox-shortcuts,' +
      ' .msg-conversations-container,' +
      ' .msg-conversation-listitem',

    // Preferred shell container candidate for list/detail Messaging layouts.
    msgShellContainer:
      '.scaffold-layout__list-detail-container,' +
      ' main#main.msg__list-detail,' +
      ' main#workspace.msg__list-detail',

    // Messaging ad-rail anchors. Used for marker-first ad shell tagging.
    msgAdAnchor:
      'section.ad-banner-container,' +
      ' iframe[data-ad-banner],' +
      ' iframe[title*="advertisement" i],' +
      ' [data-ad-banner],' +
      ' [data-ad-banner-id],' +
      ' [data-test-ad-banner]',

    // ── JOB CARDS ───────────────────────────────────────────────────────────────
    // Individual job-posting cards on the /jobs/ page — matched against the
    // existing keyword blacklist via evaluateJobCard().
    // Mar 2026 audit (jobs MHTML):
    //   data-view-name="job-card" — dead (0 HTML hits).
    //   jobs-search-results__list-item — dead (0 CSS hits).
    //   scaffold-layout__list-item — confirmed CSS (SPA; :has() needed for scoping).
    //   job-card-list__title — confirmed CSS.
    //   job-card-job-posting-card-wrapper — confirmed CSS; used as inner hook.
    jobCard:
      'li.scaffold-layout__list-item:has(.job-card-list__title),' +
      ' li.scaffold-layout__list-item:has(.job-card-job-posting-card-wrapper),' +
      ' li:has(.job-card-list__title)',

    // Semantic seeds for /jobs/search/ card-shell ownership resolution.
    // Apr 2026 evidence (jobs-search MHTML):
    //   data-results-list-top-scroll-sentinel
    //   li[data-occludable-job-id]
    //   [data-job-id]
    //   a[href*="/jobs/view/"]
    // These anchors remain stable under wrapper/class churn and are used to
    // resolve card ownership before state/keyword evaluation.
    jobCardSemanticSeed:
      '[data-occludable-job-id],' +
      ' [data-job-id],' +
      ' a[href*="/jobs/view/"]',

    // Primary anchor for an individual job listing. Used to extract the job ID
    // and distinguish results-rail cards from detail-pane related-job links.
    jobCardPrimaryJobLink:
      'a[href*="/jobs/view/"]',

    // Semantic root seeds for the /jobs/search/ results rail and detail pane.
    // Runtime uses these to fail-open when list/detail ownership is ambiguous.
    jobsSearchResultsRailSeed:
      '[data-results-list-top-scroll-sentinel],' +
      ' #results-list__title',
    jobsSearchDetailPaneSeed:
      '[data-job-details-events-trigger],' +
      ' [data-live-test-job-apply-button],' +
      ' #job-details',

    // ── JOB CARD STATE INDICATORS ────────────────────────────────────────────
    // Used by the applied / viewed / easy-apply / over-N-applicants detectors.
    // All are scoped per-card; text matching is normalised before comparison.
    //
    // Applied badge: the host renders "Applied" in a footer state node or as an
    // aria-label suffix on the card link.
    jobCardApplied:
      '.job-card-container__footer-job-state,' +
      ' .job-card-list__footer-job-state,' +
      ' [aria-label*="Applied"]',

    // Primary job card link — used as a fallback when jobCardApplied finds nothing,
    // to read the aria-label of the card's main anchor for "Applied" state text.
    jobCardPrimaryLink:
      'a[data-control-name],' +
      ' a.job-card-list__title',

    // Viewed / seen state: the host adds a muted "Viewed" label or a seen class.
    // Mar 2026 audit: job-card-list__footer-job-state--seen is dead (0 CSS hits).
    // job-card-container__footer-job-state--seen confirmed CSS-only.
    // jobCardFooterState is used for the text-fallback "Viewed" check in isViewedJobCard().
    jobCardViewed:
      '.job-card-container__footer-job-state--seen',

    // Footer state nodes for text-based viewed/seen detection (text fallback in isViewedJobCard).
    // Kept in constants so no inline site-specific selectors appear in content-script.js.
    jobCardFooterState:
      '.job-card-container__footer-job-state,' +
      ' .job-card-list__footer-job-state',

    // Easy Apply badge: shown when the job uses the host's hosted application.
    // Covers both the icon label and the text-only variant.
    jobCardEasyApply:
      '.job-card-container__apply-method,' +
      ' .jobs-apply-button--top-card,' +
      ' [aria-label*="Easy Apply"]',

    // Applicant count: the host renders "Over N applicants" in an insight node.
    // Mar 2026 audit: job-card-v2__job-insight-text and
    // job-card-job-posting-card-wrapper__job-insight-text confirmed CSS (new v2 card).
    jobCardApplicants:
      '.job-card-container__job-insight-text,' +
      ' .job-card-list__insight,' +
      ' .job-card-v2__job-insight-text,' +
      ' .job-card-job-posting-card-wrapper__job-insight-text,' +
      ' .artdeco-inline-feedback__message',

    // ── JOB CARD DEDUP FIELDS ────────────────────────────────────────────────
    // Title, company name, and location are extracted to build a session-local
    // dedup key. Both old and new job-card class names are covered.
    // Mar 2026 audit: job-card-v2 class family confirmed CSS (new card variant).
    // job-card-job-posting-card-wrapper__title also confirmed CSS.
    jobCardTitle:
      '.job-card-list__title,' +
      ' .job-card-container__link,' +
      ' .job-card-v2__primary-description,' +
      ' .job-card-job-posting-card-wrapper__title,' +
      ' a[data-control-name="job_card_title"]',

    jobCardCompany:
      '.job-card-container__company-name,' +
      ' .job-card-list__company-name,' +
      ' .job-card-v2__secondary-description,' +
      ' .artdeco-entity-lockup__subtitle',

    jobCardLocation:
      '.job-card-container__metadata-item,' +
      ' .job-card-list__metadata-item,' +
      ' .job-card-v2__metadata,' +
      ' .artdeco-entity-lockup__caption',

    // ── LEARNING CARDS ──────────────────────────────────────────────────────
    // Learning in-feed cards carry /learning/ links.
    learningCardLink:
      'a[href*="/learning/"],' +
      ' a[href*="linkedin.com/learning/"]',

    // ── GAMES CARDS ─────────────────────────────────────────────────────────
    // Puzzle / game cards (Queens, Pinpoint, CrossClimb, Tango, etc.)
    gamesLink:
      'a[href*="/games/"],' +
      ' a[href*="linkedin.com/games/"]',

    // ── PREMIUM UPSELL ──────────────────────────────────────────────────────
    // In-feed cards that prompt users to upgrade to the host's Premium tier.
    // href patterns cover /premium/ and all sub-paths (e.g. /premium/products/).
    // data-control-name, aria-label, and title patterns catch CTA buttons/links
    // that do not use the /premium/ path but are still premium upsell affordances.
    premiumUpsellLink:
      'a[href*="/premium/"],' +
      ' a[href*="linkedin.com/premium/"],' +
      ' [data-control-name*="premium" i],' +
      ' a[aria-label*="premium" i],' +
      ' button[aria-label*="premium" i],' +
      ' [title*="premium" i]',

    // ── ACTOR URN SOURCES ───────────────────────────────────────────────────
    // Elements carrying an entity URN in the actor/header region.
    // Used as a fallback author key when no profile href is available.
    actorUrnSource:
      '[data-member-urn^="urn:li:"],' +
      ' [data-entity-urn^="urn:li:"],' +
      ' [data-urn^="urn:li:fsd_"],' +
      ' [data-urn^="urn:li:member:"]',

    // ── ACTOR NAME LINK ─────────────────────────────────────────────────────
    // The anchor element that wraps the actor's display name.
    // Mar 2026 audit: a.update-components-actor__name-link and a.feed-shared-actor__name-link
    // are both dead. Replaced with scoped href search inside the actor region:
    // the first entity link inside div[aria-label*=" Profile "] is the name link.
    // .update-components-actor__name a[href] kept as CSS-only fallback.
    actorNameLink:
      'div[aria-label*=" Profile "] a[href*="/in/"],' +
      ' div[aria-label*=" Profile "] a[href*="/company/"],' +
      ' div[aria-label*=" Profile "] a[href*="/school/"],' +
      ' div[aria-label*=" Profile "] a[href*="/showcase/"],' +
      ' .update-components-actor__name a[href]',

    // ── ACTIVITY-NOISE ORIGINAL CONTENT ROOTS ───────────────────────────────
    // For reaction/repost/comment activity-noise cards, the top actor region
    // belongs to the person who reacted/reposted, NOT the original author.
    // The original post's actor is nested inside one of these containers.
    // Mar 2026 audit: feed-shared-mini-update-v2, update-components-reshared-update-v2,
    // and feed-shared-reshared-update-v2 all dead. update-components-mini-update-v2
    // confirmed CSS-only. No replacement reshare hook found in current DOM.
    activityOriginalContent: [
      '.update-components-mini-update-v2',
    ],

    // ── LAYOUT / CEILINGS ───────────────────────────────────────────────────
    // Never climb past these when walking ancestors
    ceilings: 'main, body, [role="main"], .scaffold-layout__main',

    // ── POST FOOTER / SOCIAL ACTION BAR ─────────────────────────────────────
    // Excluded when cloning a card for fallback text extraction so that
    // button labels and engagement counts don't produce false-positive matches.
    // Mar 2026 audit: feed-shared-footer and feed-shared-social-action-bar confirmed
    // CSS-only. update-components-footer and update-components-footer__social-actions dead.
    postFooter:
      '.feed-shared-footer,' +
      ' .feed-shared-social-action-bar',

    // ── SEARCH RESULT OUTER WRAPPERS ─────────────────────────────────────────
    // Search results pages wrap cards in different outer elements. These must be
    // checked FIRST in resolveFeedCard() so that hiding the inner data-urn node
    // does not leave the outer card shell as a visible empty remnant.
    // Mar 2026 audit: .reusable-search__result-container confirmed CSS-only;
    // li.artdeco-card confirmed HTML; .search-content__in-page-result dead.
    // data-view-name="search-entity-result-universal-template" confirmed HTML.
    searchResultOuter:
      '[data-view-name="search-entity-result-universal-template"],' +
      ' .reusable-search__result-container,' +
      ' li.artdeco-card',

    // ── PROMOTED POST HEADER SCOPE ────────────────────────────────────────────
    // Used to narrow the "Promoted" / "Sponsored" text search to the actor/header
    // region, preventing false-positives on post body text like "we promoted Jane".
    // 2026: actor region identified by aria-label Profile pattern (stable).
    // Legacy class selectors retained as fallback.
    // Mar 2026 audit: feed-shared-actor and feed-shared-update-v2__header dead.
    // update-components-actor__container, update-components-actor, update-components-header
    // confirmed CSS-only.
    promotedHeaderScope:
      'div[aria-label*=" Profile "],' +
      ' header,' +
      ' .update-components-actor__container,' +
      ' .update-components-actor,' +
      ' .update-components-header,' +
      ' h2 + div',

    // ── PROMOTED ACTOR META NODES ─────────────────────────────────────────────
    // Additional actor-meta elements scanned inside the promotedHeaderScope for
    // "Promoted" / "Sponsored" label text or ARIA attributes.
    // Mar 2026 audit: feed-shared-actor__meta dead; update-components-actor__meta confirmed CSS.
    // update-components-actor__sub-description and update-components-actor__description
    // confirmed CSS-only — included here because the "Promoted" label lives in the
    // actor sub-description region in 2026 (as visually-hidden text or plain meta text).
    promotedActorMeta:
      '.update-components-actor__meta,' +
      ' .update-components-actor__sub-description,' +
      ' .update-components-actor__description,' +
      ' .visually-hidden,' +
      ' [aria-label],' +
      ' [title]',

    // ── PROMOTED PLAIN-LABEL NODES ───────────────────────────────────────────
    // Narrow selectors for the capture shape where promoted cards expose a plain
    // "Promoted" label in actor/meta text near /posts/ links rather than in
    // accessibility attributes. isPromoted() uses exact-label matching on these
    // nodes to avoid false positives from sentence text.
    promotedPlainTextLabel:
      'a[href*="/posts/"] p,' +
      ' a[href*="/posts/"] span,' +
      ' [data-testid="promoted-badge"] p,' +
      ' [data-testid="promoted-badge"] span',

    // ── PROMOTED ACCESSIBILITY FALLBACK NODES ────────────────────────────────
    // Whole-card scan node types used as a last resort when the "Promoted" label
    // is placed outside the actor/header region in newer card variants.
    promotedAccessibilityFallback:
      '.update-components-actor__meta,' +
      ' .update-components-actor__sub-description,' +
      ' .update-components-actor__description,' +
      ' .visually-hidden,' +
      ' [aria-label],' +
      ' [title],' +
      ' header,' +
      ' h2 + div',

    // ── AVATAR CONTAINER (isAvatarEntityLink guard) ───────────────────────────
    // Used to distinguish avatar <a> elements from actor name-link <a> elements
    // so the avatar wrapper is never mistaken for the primary entity link.
    // Mar 2026 audit: feed-shared-actor__avatar and feed-shared-actor__image dead.
    // update-components-actor__avatar and update-components-actor__image are both
    // observed in 2026 snapshot CSS/HTML.
    avatarContainer:
      '.update-components-actor__avatar,' +
      ' .update-components-actor__image',

    // ── ACTOR SUB-DESCRIPTION (Top Voice badge fallback) ─────────────────────
    // Secondary actor-meta nodes that carry badge text (e.g. "Top Voice").
    // Checked as a DOM fallback inside isTopVoicePost() when the actor-scope
    // aria-label scan finds nothing.
    // Mar 2026 audit: feed-shared-actor__sub-description and feed-shared-actor__description
    // dead. update-components-actor__sub-description confirmed CSS-only.
    // comments-post-meta__community-top-voice-badge confirmed CSS (comment context).
    actorSubDescription:
      '.update-components-actor__sub-description,' +
      ' .update-components-actor__description,' +
      ' .comments-post-meta__community-top-voice-badge',

    // ── COLLABORATIVE ARTICLE CARD ────────────────────────────────────────────
    // Structural hook for collaborative-article / expert-answer cards.
    // Mar 2026 audit (li 1 feed with scroll.mhtml): feed-x-collaborative-article-card
    // confirmed CSS-only. Used by isCollaborativeArticle() as primary structural gate.
    collaborativeArticleCard:
      '.feed-x-collaborative-article-card',

    // ── JOB RECOMMENDATION HEADER NODES ─────────────────────────────────────
    // Header/meta nodes inside job recommendation / hiring CTA cards.
    // 2026 feed cards place module title text under the sibling div
    // after h2("Feed post") — match h2 + div (container) plus legacy heading
    // nodes to keep parser/DOM-shape variance fail-open.
    jobRecommendationHeader:
      'h2 + div,' +
      '.update-components-header__text-view,' +
      ' .update-components-header__text-wrapper,' +
      ' h1, h2, h3, h4, h5, h6, [role="heading"]',

    // ── JOB RECOMMENDATION CAROUSEL ──────────────────────────────────────────
    // Structural selectors for the carousel component inside job-recommendation
    // cards. Used by isJobRecommendationCard() as strong structural confirmation.
    jobRecommendationCarouselJobs:
      '.update-components-carousel--jobs,' +
      ' [data-testid="carousel-container"],' +
      ' section[data-testid="carousel"][aria-roledescription="carousel"]',
    jobRecommendationCarouselJob:
      '.update-components-carousel-job,' +
      ' [data-testid="carousel-child-container"]',
    jobRecommendationCarouselJobHidden:
      '.update-components-carousel-job span.visually-hidden,' +
      ' a.update-components-carousel-job__container-link span.visually-hidden,' +
      ' [data-testid="carousel-child-container"] span.visually-hidden',

    // ── JOB RECOMMENDATION / HIRING CTA LINKS ────────────────────────────────
    // Path-scoped anchors used by isJobRecommendationCard() to distinguish
    // jobs recommendation modules from ordinary feed posts mentioning "hiring".
    jobRecommendationCollectionLink:
      'a[href^="/jobs/collections/"],' +
      ' a[href*="linkedin.com/jobs/collections/"]',
    jobRecommendationSearchLink:
      'a[href^="/jobs/search/"],' +
      ' a[href*="linkedin.com/jobs/search/"]',

    // ── SEARCH NOISE CARDS ────────────────────────────────────────────────────
    // Non-result insertions in search pages: recommendation cluster
    // bottom banners between real results.
    // Mar 2026 search snapshots confirm .search-results__cluster-bottom-banner.
    // Prior data-view-name probes (search-follow-nudge / people-recommendation /
    // noresult-guidance / SUGGESTED chameleon URNs) were not observed and are pruned.
    searchNoiseCard:
      '.search-results__cluster-bottom-banner',

    // Ancestor element to hide for a search-noise hit. Keeps hideElement()
    // scoped to the outer result shell rather than an inner decorative child.
    // The cluster-bottom-banner selector is kept separately as a fallback-only
    // target so closest() does not stop at the inner banner when an outer shell
    // is present.
    searchNoiseHideTarget:
      '[data-view-name="search-entity-result-universal-template"],' +
      ' .reusable-search__result-container,' +
      ' li.artdeco-card',
    searchNoiseHideTargetFallback:
      '.search-results__cluster-bottom-banner',

    // ── PYMK / FOLLOW-MODULE CONTAINERS ──────────────────────────────────────
    // Mid-feed "People You May Know", creator, and company follow recommendation
    // modules. Used by isPymkModule().
    // Mar 2026 audit: [data-view-name="pymk-feed-card"], .update-components-follow-recommended,
    // and [data-ad-type="SELF_SERVE_CONNECT_PYMK"] all dead.
    // .discover-entity-type-card confirmed CSS-only. Text heuristics in isPymkModule()
    // ("People you may know", "Pages to follow", "Creators to follow") are the primary gate.
    pymkModuleContainer:
      '.discover-entity-type-card',

    // ── RESHARE / QUOTE-SHARE CONTAINERS ─────────────────────────────────────
    // Cards whose main payload is a reshare wrapper or quote-share overlay
    // (distinct from the four activity-noise sub-filters which look at the header
    // meta text of cards where someone reposted from their own feed). These are
    // original-content cards where the body IS a reshare frame.
    // Mar 2026 audit: update-components-reshared-update-v2, feed-shared-reshared-update-v2,
    // and feed-shared-mini-update-v2 all dead. update-components-mini-update-v2
    // confirmed CSS-only and is now the sole structural hook.
    reshareWrapper:
      '.update-components-mini-update-v2',

    // ── EVENT / NEWSLETTER / WEBINAR LINK ANCHORS ─────────────────────────────
    // The host renders event and newsletter cards with characteristic links.
    // Used together with card text checks in isEventCard().
    eventCardLink:
      'a[href*="/events/"],' +
      ' a[href*="linkedin.com/events/"],' +
      ' a[href*="/newsletters/"],' +
      ' a[href*="linkedin.com/newsletters/"]',

    // ── FEED SORT DROPDOWN ────────────────────────────────────────────────────
    // Trigger button and "Most Recent" option for the home-feed sort control.
    // Mar 2026 audit (li 6 feed sort trigger.mhtml): both data-view-name selectors
    // are dead. The sort trigger is now a div[role="button"] whose inner <p> reads
    // "Sort by: Top" (when on Top) or "Sort by: Recent" (when already Recent).
    // The dropdown is a div[role="menu"] with div[role="menuitem"] children; the
    // "Recent" item has aria-label="Recent, selected" when selected, or no aria-label
    // when not selected. tryAutoSortRecent() uses waitForElByText() for text matching
    // instead of these selectors, which are kept only as legacy no-op stubs.
    // See tryAutoSortRecent() in content-script.js for the live implementation.
    feedSortTrigger:      null,
    feedSortRecentOption: null,

    // ── PROFILE METRICS MODULE ────────────────────────────────────────────────
    // "X people viewed your profile" / search-appearance teasers in the left-rail
    // nav. The host renders these inside .scaffold-layout__nav with known
    // data-view-name values. The containing <section> or closest list item is
    // hidden so no empty shell is left.
    profileMetricsModule:
      '[data-view-name="member-home-hero"],' +
      ' [data-view-name="profile-analytics-module"],' +
      ' .profile-rail-card__actor-link,' +
      ' .scaffold-layout__nav .artdeco-card:has(.profile-analytics)',

    // ── NOTIFICATION PAGE ROWS ─────────────────────────────────────────────────
    // Individual notification rows on the /notifications/ page.
    // Mar 2026 audit (li 4 notifications.mhtml): article.nt-card, li.nt-card, and
    // data-view-name="notification-card-container" are all present.
    // Keep explicit row shells separate from data-view fallback so evaluators can
    // prefer shell hiding when both are present.
    notificationRowShell:
      'main article.nt-card,' +
      ' main li.nt-card,' +
      ' main li.notification-card,' +
      ' main article.notification-card',
    notificationRow:
      'main article.nt-card,' +
      ' main li.nt-card,' +
      ' main [data-view-name="notification-card-container"],' +
      ' main li.notification-card,' +
      ' main article.notification-card',

    // Text nodes to SCAN inside each notification row.
    // Mar 2026 audit: .nt-card__text--3-line and a.nt-card__headline confirmed HTML.
    // Legacy selectors retained as fallback.
    notificationText: [
      '.nt-card__text--3-line',
      'a.nt-card__headline',
      '.nt-card__content',
      '.notification-card__message',
      '.notification-card__body',
      '.artdeco-entity-lockup__subtitle',
      '.artdeco-entity-lockup__caption',
      '.nt-card',
      '.notification-card',
    ],

    // ── JOB CARD DESCRIPTION SNIPPET ─────────────────────────────────────────
    // Short description or insight text shown on job cards — used for ghost job
    // scoring (generic description and mass-hiring language detection).
    jobCardDescription:
      '.job-card-container__description-snippet,' +
      ' .job-card-list__description-snippet,' +
      ' .job-card-container__job-insight-text',

    // ── AUTO-EXPAND "…more" BUTTONS ──────────────────────────────────────────
    // Buttons and toggles that reveal truncated post body or comment text.
    // Stable aria-label selector listed first; class-based selectors are fallbacks.
    // Mar 2026 audit (li 6 feed sort trigger.mhtml): the feed "…more" button is now
    //   button[data-testid="expandable-text-button"] aria-hidden="true"
    // No aria-label is present — it is the primary hook for the 2026 feed.
    // Mar 2026 audit: button[data-testid="expandable-text-button"] is the confirmed
    // primary hook for the 2026 feed expand button. button[aria-label*="see more" i]
    // and data-control-name hooks remain as confirmed fallbacks for comment/reply expanders.
    // All feed-shared-inline-show-more-text__* and feed-shared-text-view__* selectors
    // are dead (feed-shared-* class family gone) and have been removed.
    autoExpandMore: [
      'button[data-testid="expandable-text-button"]',
      'button[aria-label*="see more" i]',
      'button[data-control-name="load_more_comments"]',
      'button[data-control-name="show_more_replies"]',
      'button.comments-comment-item__expand',
      'button.comment-button-expandable',
      'button.see-more',
      'button.comments-comments-list__load-more-comments-button',
      'button.comments-comment-item__show-replies-btn',
    ],
  },



  // ── Observer / Scan Tuning ─────────────────────────────────────────────────
  SCAN: {
    DEBOUNCE_MS:                      150,
    MAX_FLUSH_MS:                     500,
    DIRTY_ROOTS_FULL_SCAN_THRESHOLD:   40,
    // Delayed second pass after initial scan — gives the host time to finish
    // hydrating card interiors (promoted labels, activity headers, 1st badges)
    // that arrive in later mutations after the card shell is inserted.
    LATE_RESCAN_MS:                   800,
  },

  // ── Selection Capture (content script → popup prefill) ────────────────────
  SELECTION: {
    DEBOUNCE_MS: 120,
    MAX_AGE_MS:  45000,
    MAX_LENGTH:  120,
  },

  // ── Messaging ─────────────────────────────────────────────────────────────
  // ── Feed Counter Storage ───────────────────────────────────────────────────
  // Content script writes the session counter here; popup reads it directly.
  // Avoids message-passing races (content script may not be connected yet).
  FEED_COUNTER_KEY: 'hu_feed_counter',

  // ── Session Tally Storage ──────────────────────────────────────────────────
  // Live per-kind hidden count for the current browsing session.
  // Written by the content script on every hide (debounced 200ms).
  // Shape: { [kind]: number }
  SESSION_TALLY_KEY:       'hu_session_tally',

  // ── Activity Per-Kind Color Palette ──────────────────────────────────────
  // Donut legend colors keyed by the kind strings the engine actually emits
  // (see content-script.js KIND_LABELS). statsColor() falls back to slate
  // #94A3B8 for anything not listed here, so adding new kinds without
  // assigning a color renders correctly — just visually duller.
  ACTIVITY_KIND_COLORS: {
    'ai-filter':    '#ef4444',  // red    — AI toggle
    'ai-slop':      '#e8b000',  // gold   — algo junk
    'post':         '#115fc4',  // royal  — custom-blacklist hit
    'serious-mode': '#f59e0b',  // amber  — humor-mode hit
  },

  // ── UI Filter HTML Attributes ──────────────────────────────────────────────
  // Set on <html> by the content script; CSS rules key off these to apply
  // sidebar/focus/badge UI transforms without any per-element DOM walking.
  // UI_ATTRS were html-level toggles for the removed 42-detector engine.
  // The post-card-only product surface no longer sets any html-level attrs;
  // per-card markers (HIDDEN_ATTR, DIMMED_ATTR, KIND_ATTR, AUDIT_ATTR) live
  // above. Kept as an empty object so legacy callers that iterate it no-op.
  UI_ATTRS: {},

  // ── Connection Degree Labels (canonical order) ────────────────────────────
  CONNECTION_DEGREES: ['1st', '2nd', '3rd+'],

  // ── Default Settings (chrome.storage.sync) ────────────────────────────────
  // Applied by `normalizeSettings` when the corresponding key is missing from
  // stored settings (i.e. fresh install). Existing user preferences are NEVER
  // overwritten on upgrade — only fields the user has never touched.
  DEFAULT_SETTINGS: {
    version:             14,
    enabled:             true,
    // Fresh installs land on Scorched Earth + Hide AI Posts on, so the
    // product does its job out of the box. Users can dial back from the popup.
    slopSensitivityLevel: 4,
    aiFilterEnabled:  true,
    seriousModeEnabled: false,
    blacklist:        [],
    presetState:      {},
    // Only the four flags that drive the popup's Hidden-item mode segmented
    // control + live-capsule visibility survive. See shared/storage.js
    // `normalizeUiFilters` for the matching schema.
    uiFilters: {
      dimMode:           true,  // Minimize is the default hidden-item mode.
      auditMode:         false,
      showHiddenReasons: false,
      showFeedCounter:   false,
    },
    updatedAt:   0,
  },

};
