/**
 * Central SEO helpers. Phase 4 provides canonical + robots + title/description
 * resolution; Phase 5 extends this file (Open Graph, JSON-LD, sitemap) so there
 * is still exactly one SEO pipeline.
 */
import type {SeoFields} from './types'
import {absoluteUrl} from './urls'

/** Category/author archives with fewer posts than this are `noindex, follow` (thin content). */
export const MIN_POSTS_FOR_INDEXABLE_ARCHIVE = 3

export const SITE_NAME_FALLBACK = 'PV Sample'

export interface PageSeo {
  title: string
  description?: string
  /** Site-relative path of THIS page (including /page/N/ for pagination). */
  path: string
  noindex?: boolean
  /** Editor override from Sanity; ignored unless it is an absolute https URL. */
  canonicalOverride?: string | null
}

export interface ResolvedSeo {
  title: string
  description?: string
  canonical: string
  robots: string
}

export function resolveSeo(seo: PageSeo, site: URL | string): ResolvedSeo {
  const override = seo.canonicalOverride?.startsWith('https://') ? seo.canonicalOverride : null
  return {
    title: seo.title,
    description: seo.description?.trim() || undefined,
    canonical: override ?? absoluteUrl(seo.path, site),
    robots: seo.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large',
  }
}

/** Title tag: "<page> | <site>" unless the editor wrote an SEO title (used verbatim). */
export function buildTitle(opts: {seo?: SeoFields | null; fallback: string; siteName?: string; page?: number}) {
  const base = opts.seo?.seoTitle?.trim() || `${opts.fallback}${opts.siteName ? ` | ${opts.siteName}` : ''}`
  return opts.page && opts.page > 1 ? `${base} - Page ${opts.page}` : base
}

/** Archives are indexable only if they have enough content or the editor did not hide them. */
export function archiveIsIndexable(postCount: number, seo?: SeoFields | null) {
  return !seo?.noIndex && postCount >= MIN_POSTS_FOR_INDEXABLE_ARCHIVE
}
