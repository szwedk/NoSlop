import type { PageSection } from '../shared/settings'

const HOME_SECTIONS: readonly PageSection[] = [
  'homeFeed',
  'homeStories',
  'homeSuggestions',
]
const EXPLORE_SECTIONS: readonly PageSection[] = ['explore']
const REELS_SECTIONS: readonly PageSection[] = ['reels']
const NO_SECTIONS: readonly PageSection[] = []

// The Reels tab lives under `/reels/` and moves to `/reels/<id>/` as it
// scrolls. A reel shared by link is `/reel/<id>/`, singular, which is a plain
// post page and deliberately stays out of this.
const REELS_TAB_PATH = /^\/reels(\/[^/]+)?\/?$/

// The story viewer opens over the Home page, which stays mounted underneath,
// and closing it returns to `/`.
const STORY_VIEWER_PATH = /^\/stories\//

/**
 * The sections the extension may hide on a path. `null` marks a transparent
 * route: whatever was applied before it stays applied, because the page it
 * overlays is still in the DOM and clearing its sections would reveal them
 * behind the overlay. An empty list means nothing is hidden here.
 *
 * Only the pathname matters. The Following feed is `/?variant=following`, which
 * is still Home.
 */
export const getRouteSections = (
  pathname: string,
): readonly PageSection[] | null => {
  if (pathname === '/') {
    return HOME_SECTIONS
  }

  if (pathname === '/explore/' || pathname === '/explore') {
    return EXPLORE_SECTIONS
  }

  if (REELS_TAB_PATH.test(pathname)) {
    return REELS_SECTIONS
  }

  if (STORY_VIEWER_PATH.test(pathname)) {
    return null
  }

  return NO_SECTIONS
}

/**
 * The section the in-page card speaks for: the first one a route lists, which
 * is the one whose removal empties the page. Stories and suggestions stay a
 * popup setting. `null` where there is no card, including the story viewer.
 */
export const getRoutePrimarySection = (
  pathname: string,
): PageSection | null => {
  const sections = getRouteSections(pathname)
  return sections && sections.length > 0 ? sections[0] : null
}
