/**
 * All GROQ lives here. Pages never write queries inline.
 *
 * Rules:
 *  - Listings use CARD (small). Only the article page fetches `body`.
 *  - Lists are paginated with GROQ ranges `[start...end]`, never "fetch all".
 *  - Only posts that are published AND whose publishedAt is not in the future
 *    are visible (`LIVE`). Scheduled posts appear on the first build after
 *    their date.
 */
import {sanity} from './sanity'
import type {
  Author,
  BlogSettings,
  Category,
  CategoryWithCount,
  PostCard,
  PostFull,
  SiteSettings,
} from './types'

// ---------- reusable GROQ fragments ----------
const LIVE = `_type == "post" && defined(slug.current) && publishedAt <= now()`

const IMAGE = (field: string) => `${field}{
  "url": asset->url,
  "width": asset->metadata.dimensions.width,
  "height": asset->metadata.dimensions.height,
  alt
}`

const CARD = `{
  _id, title, "slug": slug.current, excerpt, publishedAt, modifiedAt,
  ${IMAGE('featuredImage')},
  "author": author->{name, "slug": slug.current},
  "categories": categories[]->{name, "slug": slug.current}
}`

const SEO = `seo{
  seoTitle, metaDescription, canonicalUrl, noIndex, ogTitle, ogDescription,
  "ogImage": ogImage{"url": asset->url, "width": asset->metadata.dimensions.width, "height": asset->metadata.dimensions.height}
}`

/** Portable Text body with images and internal links resolved in one query. */
const BODY = `body[]{
  ...,
  _type == "image" => {..., "url": asset->url, "width": asset->metadata.dimensions.width, "height": asset->metadata.dimensions.height},
  markDefs[]{..., _type == "internalLink" => {..., "slug": reference->slug.current}}
}`

// ---------- memoised singletons (one request per build) ----------
let siteSettingsPromise: Promise<SiteSettings | null> | undefined
export function getSiteSettings() {
  siteSettingsPromise ??= sanity.fetch<SiteSettings | null>(`*[_type == "siteSettings"][0]`)
  return siteSettingsPromise
}

let blogSettingsPromise: Promise<BlogSettings> | undefined
export function getBlogSettings() {
  blogSettingsPromise ??= sanity
    .fetch<Partial<BlogSettings> | null>(
      `*[_id == "blogSettings"][0]{
        title, description, postsPerPage, showCategoryNav, newsletterEnabled,
        newsletterHeading, newsletterFormUrl, ${SEO},
        "featuredPosts": featuredPosts[]->${CARD}
      }`,
    )
    .then((s) => ({
      postsPerPage: 12,
      showCategoryNav: true,
      newsletterEnabled: false,
      ...s,
      // Drop references to deleted / unpublished / future posts.
      featuredPosts: (s?.featuredPosts ?? []).filter((p): p is PostCard => Boolean(p?.slug)),
    }))
  return blogSettingsPromise
}

let categoriesPromise: Promise<CategoryWithCount[]> | undefined
/** Categories that have at least one live post (empty categories are not linked). */
export function getCategoriesWithPosts() {
  categoriesPromise ??= sanity.fetch<CategoryWithCount[]>(
    `*[_type == "category" && defined(slug.current)]{
      name, "slug": slug.current,
      "postCount": count(*[${LIVE} && references(^._id)])
    }[postCount > 0] | order(name asc)`,
  )
  return categoriesPromise
}

// ---------- post lists ----------
export interface PostPage {
  posts: PostCard[]
  total: number
}

/**
 * One page of posts. `filter` is an extra GROQ condition (e.g. category match).
 * `excludeId` removes the hero post from the main list so it never appears twice.
 * Count and range use identical filters, so page math always matches.
 */
export async function getPostPage(opts: {
  page: number
  perPage: number
  filter?: string
  params?: Record<string, unknown>
  excludeId?: string | null
}): Promise<PostPage> {
  const {page, perPage, filter = '', params = {}, excludeId = null} = opts
  const start = (page - 1) * perPage
  const where = `${LIVE} ${filter ? `&& ${filter}` : ''} && _id != $excludeId`
  return sanity.fetch<PostPage>(
    `{
      "posts": *[${where}] | order(publishedAt desc)[${start}...${start + perPage}] ${CARD},
      "total": count(*[${where}])
    }`,
    {...params, excludeId: excludeId ?? ''},
  )
}

export async function getPostCount(filter = '', params: Record<string, unknown> = {}) {
  return sanity.fetch<number>(`count(*[${LIVE} ${filter ? `&& ${filter}` : ''}])`, params)
}

/** Hero post: first editor-selected post, else newest post flagged featured, else newest. */
export async function getHeroPost(settings: BlogSettings): Promise<PostCard | null> {
  const picked = settings.featuredPosts?.[0]
  if (picked) return picked
  return sanity.fetch<PostCard | null>(
    `coalesce(
      *[${LIVE} && featured == true] | order(publishedAt desc)[0] ${CARD},
      *[${LIVE}] | order(publishedAt desc)[0] ${CARD}
    )`,
  )
}

// ---------- single documents ----------
export function getPostSlugs() {
  return sanity.fetch<{slug: string}[]>(`*[${LIVE}]{"slug": slug.current}`)
}

export function getPostBySlug(slug: string) {
  return sanity.fetch<PostFull | null>(
    `*[${LIVE} && slug.current == $slug][0]{
      _id, title, "slug": slug.current, excerpt, publishedAt, modifiedAt, tags,
      ${IMAGE('featuredImage')},
      ${BODY},
      "author": author->{name, "slug": slug.current, designation, bio, ${IMAGE('image')}},
      "categories": categories[]->{name, "slug": slug.current},
      "relatedPosts": relatedPosts[]->${CARD},
      ${SEO}
    }`,
    {slug},
  )
}

/** Fallback related posts: newest posts that share a category with this one. */
export function getRelatedByCategory(postId: string, limit = 3) {
  return sanity.fetch<PostCard[]>(
    `*[${LIVE} && _id != $postId && count(categories[@._ref in *[_id == $postId][0].categories[]._ref]) > 0]
      | order(publishedAt desc)[0...${limit}] ${CARD}`,
    {postId},
  )
}

let categoriesFullPromise: Promise<Category[]> | undefined
export function getCategories() {
  categoriesFullPromise ??= sanity.fetch<Category[]>(
    `*[_type == "category" && defined(slug.current)]{
      _id, name, "slug": slug.current, description, ${IMAGE('image')}, ${SEO},
      "postCount": count(*[${LIVE} && references(^._id)])
    }[postCount > 0] | order(name asc)`,
  )
  return categoriesFullPromise
}

let authorsPromise: Promise<Author[]> | undefined
export function getAuthors() {
  authorsPromise ??= sanity.fetch<Author[]>(
    `*[_type == "author" && defined(slug.current)]{
      _id, name, "slug": slug.current, designation, bio, ${IMAGE('image')}, socialLinks, ${SEO},
      "postCount": count(*[${LIVE} && author._ref == ^._id])
    }[postCount > 0] | order(name asc)`,
  )
  return authorsPromise
}

export const filters = {
  category: `$categoryId in categories[]._ref`,
  author: `author._ref == $authorId`,
}

// ---------- sitemap ----------
export interface SitemapPost {
  slug: string
  lastmod: string
  noIndex?: boolean | null
  canonicalUrl?: string | null
}

/** Live posts only. `lastmod` is the editor's "meaningful modification" date, else the publish date. */
export function getSitemapPosts() {
  return sanity.fetch<SitemapPost[]>(
    `*[${LIVE}] | order(publishedAt desc){
      "slug": slug.current,
      "lastmod": coalesce(modifiedAt, publishedAt),
      "noIndex": seo.noIndex,
      "canonicalUrl": seo.canonicalUrl
    }`,
  )
}
