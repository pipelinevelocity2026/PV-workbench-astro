/**
 * The ONLY place URL paths are built. Every link, canonical, breadcrumb and
 * (in Phase 5) sitemap entry goes through these helpers, so the URL structure
 * can never drift between pages.
 *
 * All paths are lowercase, hyphenated, and end with a trailing slash.
 */
export const BLOG_BASE = '/blog/'

/** Ensure leading + trailing slash, collapse duplicate slashes, drop query/hash. */
export function normalizePath(path: string): string {
  const clean = path.split(/[?#]/)[0].toLowerCase().replace(/\/{2,}/g, '/')
  const withLeading = clean.startsWith('/') ? clean : `/${clean}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

export const paths = {
  blog: () => BLOG_BASE,
  blogPage: (page: number) => (page <= 1 ? BLOG_BASE : `${BLOG_BASE}page/${page}/`),
  post: (slug: string) => normalizePath(`${BLOG_BASE}${slug}`),
  category: (slug: string, page = 1) =>
    page <= 1 ? normalizePath(`${BLOG_BASE}category/${slug}`) : normalizePath(`${BLOG_BASE}category/${slug}/page/${page}`),
  author: (slug: string, page = 1) =>
    page <= 1 ? normalizePath(`${BLOG_BASE}author/${slug}`) : normalizePath(`${BLOG_BASE}author/${slug}/page/${page}`),
}

/** Absolute canonical URL for a site-relative path. Never contains a query string. */
export function absoluteUrl(path: string, site: URL | string): string {
  return new URL(normalizePath(path), site).toString()
}
