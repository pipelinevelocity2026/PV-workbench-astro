/**
 * Pure decision logic: should this Sanity webhook event trigger a site build?
 * No I/O, so it is unit-tested (decide.test.mjs) and shared by the Worker.
 *
 * The Sanity webhook (see SANITY-WEBHOOK.md) already filters to non-draft
 * documents of the types below and sends this projection:
 *
 *   { _id, _type, "op": delta::operation(), "slug": slug.current,
 *     "oldSlug": before().slug.current,
 *     "wasLive": before().publishedAt <= now(),
 *     "isLive":  after().publishedAt  <= now() }
 *
 * Everything here re-checks defensively: the Worker must not trust that the
 * Sanity-side filter is configured correctly.
 */

/** Types whose published content appears on the website. */
export const RELEVANT_TYPES = new Set([
  'post', // article pages, listings, archives, sitemap
  'category', // category pages, category nav, post pages
  'author', // author pages, author box, cards
  'siteSettings', // header / footer / titles: every page
  'blogSettings', // blog index, pagination, featured posts
  'homePage', // /
  'redirect', // _redirects
])

/** @returns {{build: boolean, reason: string}} */
export function decide(event) {
  if (!event || typeof event !== 'object') return {build: false, reason: 'empty payload'}
  const {_id, _type, op, wasLive, isLive} = event

  if (typeof _id !== 'string' || typeof _type !== 'string') return {build: false, reason: 'missing _id/_type'}
  if (_id.startsWith('drafts.') || _id.startsWith('versions.')) return {build: false, reason: 'draft/version edit (not published)'}
  if (!RELEVANT_TYPES.has(_type)) return {build: false, reason: `type "${_type}" is not rendered on the site`}

  if (_type === 'post') {
    // Scheduled (future-dated) posts are invisible until publishedAt passes,
    // so editing them changes nothing. Anything that WAS or IS live matters:
    // publish, edit, slug/category change, unpublish and delete all fall here.
    if (wasLive === false && isLive === false) return {build: false, reason: 'post is not live before or after this change'}
    if (op === 'delete' && wasLive === false) return {build: false, reason: 'deleted post was never live'}
    return {build: true, reason: `post ${op ?? 'change'}${event.oldSlug && event.slug && event.oldSlug !== event.slug ? ' (slug changed)' : ''}`}
  }

  return {build: true, reason: `${_type} ${op ?? 'change'}`}
}

/** A webhook may carry one event or (batch mode) an array. Build if any event matters. */
export function decideBatch(payload) {
  const events = Array.isArray(payload) ? payload : [payload]
  const decisions = events.map(decide)
  const hit = decisions.find((d) => d.build)
  return hit ?? decisions[0] ?? {build: false, reason: 'no events'}
}
