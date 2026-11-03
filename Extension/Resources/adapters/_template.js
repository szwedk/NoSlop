// NoSlop — ADAPTER TEMPLATE. Copy this file to adapters/<site>.js and fill in the site specifics.
// It is NOT listed in manifest.json; tests load it against synthetic markup (see tests/engine.test.mjs).
//
// Contract (docs/DESIGN.md §4): every adapter is a plain classic script that calls
//   NoSlop.adapters.register(adapter)
// where `adapter` is:
//   site           string   key into NoSlop.rules.sites.<site> and settings.sites.<site>
//   matches(loc)   boolean  content.js picks the first adapter whose matches(location) is true
//   hideStrategy   'display-none' | 'height-zero' | 'collapse-inner'  (default per site in rules.sites.<site>.hideStrategy)
//   findItems(root) Element[]  candidate feed items under `root` (querySelectorAll of rules.sites.<site>.item ...)
//   extract(el, ctx) Item | null | undefined
//                    null      = NOT an item (separator, promo, ...): the engine removes any applied state
//                    undefined = not READY yet (virtualizer placeholder, cell without its permalink): the engine KEEPS the applied state
//   surfaces()     [{ settingKey: 'hideShorts', selector: '...', strategy?: 'display-none'|'height-zero' }]  whole surfaces hidden when the
//                  setting is on (and the site is active); 'height-zero' collapses instead of unmounting (facebook feed units)
//   stubPlacement(el, item) optional -> 'inside' (default) | 'before'  put the hidden-item stub before a shadow-host element and hide the host
//   enrich(item, ctx)  optional, async -> Partial<Item> | null  (e.g. fetch the YouTube watch page to read the AI label)
//   surface(loc)   optional -> 'home'|'search'|'watch'|'profile'|'reels'|'shorts'|'other'
//   navigateEvents optional string[]   extra window events that mean "SPA navigation happened" (youtube: 'yt-navigate-finish')
//   attributeFilter optional string[]  attributes the observer should watch (reddit: ['post-title','permalink','id'])
//   observeRoot()  optional -> Element  narrower observer root than document.body
//   hide(el,item,verdict,strategy) / unhide(el,item)  optional overrides on top of the engine's CSS classes
//   The engine detects SPA navigation by polling location.href on every flush / sweep (isolated worlds), so navigateEvents is optional.
//
// Item shape:
//   { id, kind: 'post'|'video'|'short'|'ad'|'shelf', surface, text, title?, author: {handle?, name?, id?},
//     hashtags: string[], links: string[], labels: [{type:'platform_ai'|'promoted'|'c2pa', id?, text?}], media: ['image'|'video'|'none'], extra? }
//
// RULES FOR REAL ADAPTERS: never hardcode selectors — read them from NoSlop.rules.sites.<site> (and cite the
// research table in a comment); item.id must be the stable POST/VIDEO id, never the element; return null while
// the card is still a loading skeleton; keep extract() cheap (it runs on every mutation and once per second).
(function () {
  'use strict';
  const NS = (globalThis.NoSlop = globalThis.NoSlop || {});
  const dom = NS.dom;

  // Synthetic markup this template understands (used by tests):
  // <div class="feed">
  //   <div data-feed-item data-id="p1" data-kind="post" data-author="alice" data-label="AI info" data-promoted="1">
  //     <h3 class="title">...</h3> <div class="text">...</div> <a href="/p/p1"></a> <video></video>
  //   </div>
  // </div>
  const SEL = {
    item: '[data-feed-item]',
    title: '.title',
    text: '.text',
    label: '.ai-label',       // platform AI label element (synthetic)
    shortsShelf: '.shorts-shelf',
    reels: '.reels'
  };

  const adapter = {
    site: 'example',
    hideStrategy: 'display-none',
    navigateEvents: [],

    matches(loc) {
      const host = (loc && loc.hostname) || '';
      return host === 'noslop.example' || host === 'example.test';
    },

    surface(loc) {
      const p = (loc && loc.pathname) || '/';
      if (p === '/' || p === '') return 'home';
      if (p.startsWith('/search')) return 'search';
      if (p.startsWith('/watch')) return 'watch';
      return 'other';
    },

    findItems(root) {
      return Array.from((root || document).querySelectorAll(SEL.item));
    },

    extract(el) {
      const id = el.getAttribute('data-id');
      if (!id) return null; // skeleton / not ready
      const title = dom.text(el, SEL.title);
      const text = dom.text(el, SEL.text);
      const labels = [];
      const labelText = el.getAttribute('data-label') || dom.text(el, SEL.label);
      if (labelText) labels.push({ type: 'platform_ai', id: 'example_label', text: labelText });
      if (el.hasAttribute('data-promoted')) labels.push({ type: 'promoted' });
      if (el.hasAttribute('data-c2pa')) labels.push({ type: 'c2pa' });
      const media = el.querySelector('video') ? ['video'] : el.querySelector('img') ? ['image'] : ['none'];
      return {
        id,
        kind: el.getAttribute('data-kind') || 'post',
        surface: NS.engine && NS.engine.surface ? NS.engine.surface : 'home',
        title,
        text,
        author: { handle: el.getAttribute('data-author') || '', name: el.getAttribute('data-author-name') || '' },
        hashtags: dom.hashtags(text + ' ' + title),
        links: dom.links(el),
        labels,
        media,
        extra: { subreddit: el.getAttribute('data-subreddit') || undefined }
      };
    },

    surfaces() {
      return [
        { settingKey: 'hideShorts', selector: SEL.shortsShelf },
        { settingKey: 'hideReels', selector: SEL.reels }
      ];
    },

    // Optional async enrichment: return a partial Item (merged by the engine, then re-scored) or null.
    // Tests set NoSlop.adapters.exampleEnrich = async (item) => ({ labels: [...] }) to exercise this path.
    enrich(item, ctx) {
      const fn = NS.adapters.exampleEnrich;
      return typeof fn === 'function' ? fn(item, ctx) : null;
    }
  };

  NS.adapters.register(adapter);
})();
