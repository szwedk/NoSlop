import type { PageSection } from '../shared/settings'

/**
 * One attribute per section, toggled on `<html>`. It is the only thing that
 * means "this extension is hiding this section": the stylesheet keys on it, and
 * clearing it is the whole restore.
 */
export const BLOCKED_SECTION_ATTRS: Record<PageSection, string> = {
  homeFeed: 'data-igfb-home-feed-blocked',
  homeStories: 'data-igfb-home-stories-blocked',
  homeSuggestions: 'data-igfb-home-suggestions-blocked',
  explore: 'data-igfb-explore-blocked',
  reels: 'data-igfb-reels-blocked',
}

const MAIN = 'main[role="main"]'

/**
 * What each section hides. Plain CSS selectors only, because the same table
 * generates the stylesheet and a predicate cannot be expressed there.
 *
 * Instagram's class names are atomic and regenerated per build, so nothing
 * here names a class. The anchors are landmarks, roles, `data-pagelet`, and
 * `href` shapes. Several selectors also pin an exact nesting depth with
 * `:has(> div > ...)`, which is the brittle part: Instagram moving a wrapper
 * breaks them silently, and only the real-site lane notices.
 *
 * Which route a section applies on is `routes.ts`'s decision, not this
 * table's. A selector here may well match on other routes (profile pages have a
 * tablist too), which is fine only because the section attribute is never set
 * there.
 */
export const SECTION_SELECTORS: Record<PageSection, readonly string[]> = {
  homeFeed: [
    // The For you / Following tabs. Only the wide layout has them; below about
    // 767px the switch is a dropdown in a header outside `main`.
    `${MAIN} div:has(> [role="tablist"])`,
    // The feed wrapper, three levels above the posts. It also holds the
    // infinite-scroll loader, so hiding it stops a hidden feed paging in.
    `${MAIN} div:has(> div > div > div > article)`,
    // The posts themselves, for when that depth moves.
    `${MAIN} article`,
  ],
  homeStories: ['[data-pagelet="story_tray"]'],
  homeSuggestions: [
    // The middle block of the right rail, found through its "See all" link.
    // The account switcher above it and the footer below it stay.
    `${MAIN} div:has(> div > div > div > a[href="/explore/people/"])`,
  ],
  explore: [
    // `main > div` holds the search slot, the tabs, and the grid. Focusing the
    // search box collapses it into one slot holding the input, its own tabs
    // and the results, and `:not(:has(input))` is what keeps that visible.
    `${MAIN} > div > div:has(> div > [role="tablist"]):not(:has(input))`,
    `${MAIN} > div > div:has(a[href^="/p/"]):not(:has(input))`,
  ],
  // Everything the Reels tab shows is inside `main` and the navigation is not,
  // but `main` alone is not enough. Leaving Reels shortly after opening it,
  // Instagram pushes the new route and then the unmounting player
  // `replaceState`s its first reel's id over it, so Messages renders under a
  // `/reels/<id>/` URL and the route table says Reels. Keying on the mounted
  // player means a stale URL hides nothing. The price is the first moment on
  // `/reels/`, before any reel has mounted.
  reels: [`${MAIN}:has([data-virtualized] video)`],
}

/**
 * The media each section silences while it is blocked. CSS hides a video but
 * does not stop it, so this half stays in JavaScript.
 *
 * Every entry is scoped by the same DOM signal as the section's stylesheet
 * rule, never by the route alone. Under Instagram's stale `/reels/<id>/` URL
 * the Reels section stays applied over Messages, and a sweep of every video
 * in `main` would pause a reel someone shared in a thread.
 */
export const SECTION_MEDIA_SELECTORS: Record<PageSection, readonly string[]> = {
  homeFeed: [`${MAIN} article video`],
  homeStories: [],
  homeSuggestions: [],
  explore: [`${MAIN} > div > div:has(a[href^="/p/"]):not(:has(input)) video`],
  reels: [`${MAIN} [data-virtualized] video`],
}
