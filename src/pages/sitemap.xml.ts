import type {APIRoute} from 'astro'
import {archivePaths, loadBlogIndex} from '../lib/blog'
import {getAuthors, getCategories, getSitemapPosts} from '../lib/queries'
import {archiveIsIndexable} from '../lib/seo'
import {absoluteUrl, paths} from '../lib/urls'

/**
 * Regenerated on EVERY build (endpoints have no cacheKey, so the incremental
 * cache never reuses it). It is built from the same live-post filter and the
 * same indexability rules as the pages, so a sitemap entry can never exist for
 * an unpublished post, a noindex page or a page whose canonical points elsewhere.
 */
export const GET: APIRoute = async ({site}) => {
  const origin = site!
  const entries: {path: string; lastmod?: string}[] = [{path: '/'}]

  // Blog index pages
  const {totalPages, settings} = await loadBlogIndex(1)
  if (!settings.seo?.noIndex) {
    for (let p = 1; p <= totalPages; p++) entries.push({path: paths.blogPage(p)})
  }

  // Posts: skip noindex and posts that canonicalise to another URL.
  for (const p of await getSitemapPosts()) {
    const selfCanonical = !p.canonicalUrl || p.canonicalUrl === absoluteUrl(paths.post(p.slug), origin)
    if (p.noIndex || !selfCanonical) continue
    entries.push({path: paths.post(p.slug), lastmod: p.lastmod})
  }

  // Archives: only those that are indexable (see archiveIsIndexable).
  for (const kind of ['category', 'author'] as const) {
    const bySlug = new Map((kind === 'category' ? await getCategories() : await getAuthors()).map((e) => [e.slug, e]))
    for (const {slug, page} of await archivePaths(kind)) {
      const e = bySlug.get(slug)!
      if (!archiveIsIndexable(e.postCount, e.seo)) continue
      entries.push({path: kind === 'category' ? paths.category(slug, page) : paths.author(slug, page)})
    }
  }

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = entries
    .map(({path, lastmod}) => {
      const lm = lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ''
      return `  <url><loc>${esc(absoluteUrl(path, origin))}</loc>${lm}</url>`
    })
    .join('\n')

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
    {headers: {'Content-Type': 'application/xml; charset=utf-8'}},
  )
}
