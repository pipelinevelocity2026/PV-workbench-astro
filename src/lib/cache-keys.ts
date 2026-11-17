/**
 * Incremental-build cache keys (Astro `experimental.incrementalBuild`).
 *
 * WHAT ASTRO TRACKS vs WHAT WE MUST TRACK
 *  - Astro already invalidates a page when its CODE changes: the route's module
 *    graph (layouts, components, lib/queries.ts, CSS), astro.config and the
 *    lockfile are all hashed.
 *  - Astro CANNOT see Sanity data. A page is reused only if the `cacheKey`
 *    returned from getStaticPaths() equals last build's key. So a key must change
 *    whenever ANYTHING the page renders changes. That is the whole contract.
 *
 * TWO STRATEGIES
 *  - Listing pages (blog index, category/author archives): the key is a hash of
 *    the exact data the page renders (`contentKey`). Correct by construction.
 *  - Post pages: hashing every post body would mean downloading every body just
 *    to decide to skip it, so the key is built from document `_rev`s instead
 *    (`getPostCacheKeys`): the post itself plus everything it displays from
 *    other documents. `_rev` changes on every published mutation.
 *
 * If you add a field, a reference or a component to the post page that shows
 * data from ANOTHER document, add that document's `_rev` in `postKey()`.
 */
import {createHash} from 'node:crypto'
import {SANITY_DATASET, sanity} from './sanity'

const FORMAT_VERSION = 'v1' // bump to force a full rebuild after changing key logic

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}

// ---------- global inputs shared by every page ----------
interface RevDoc {
  _id: string
  _rev: string
}

let siteRevPromise: Promise<string> | undefined
/** Site settings render in the header/footer/title of every page. */
export function getSiteRev() {
  siteRevPromise ??= sanity
    .fetch<RevDoc[]>(`*[_type == "siteSettings"]|order(_id){_id,_rev}`)
    .then((docs) => digest([FORMAT_VERSION, SANITY_DATASET, import.meta.env.SITE, docs]))
  return siteRevPromise
}

/** Key for listing pages: hash of the data the page will render + global inputs. */
export async function contentKey(data: unknown): Promise<string> {
  return digest([await getSiteRev(), data])
}

// ---------- post pages ----------
interface PostRow {
  _id: string
  _rev: string
  slug: string
  publishedAt: string
  author?: string
  categories?: string[]
  related?: string[]
  links?: string[]
}

let postKeysPromise: Promise<Map<string, string>> | undefined

/**
 * slug -> cacheKey for every live post, from ONE request (+1 for authors and
 * categories). Lets unchanged posts be skipped without fetching their bodies.
 */
export function getPostCacheKeys(): Promise<Map<string, string>> {
  postKeysPromise ??= (async () => {
    const [posts, others, siteRev] = await Promise.all([
      sanity.fetch<PostRow[]>(
        `*[_type == "post" && defined(slug.current) && publishedAt <= now()]{
          _id, _rev, "slug": slug.current, publishedAt,
          "author": author._ref,
          "categories": categories[]._ref,
          "related": relatedPosts[]._ref,
          "links": body[].markDefs[].reference._ref
        }`,
      ),
      sanity.fetch<RevDoc[]>(`*[_type in ["author", "category"]]{_id, _rev}`),
      getSiteRev(),
    ])

    const rev = new Map<string, string>(others.map((d) => [d._id, d._rev]))
    const live = new Map<string, PostRow>(posts.map((p) => [p._id, p]))
    posts.forEach((p) => rev.set(p._id, p._rev))

    // Everything a post *card* shows: the post, its author and its categories.
    const cardDeps = (p: PostRow) => [p._rev, rev.get(p.author ?? ''), ...(p.categories ?? []).map((c) => rev.get(c))]

    // Mirrors getRelatedByCategory(): 3 newest other live posts sharing a category.
    const newestFirst = [...posts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    const fallbackFor = (p: PostRow) =>
      newestFirst
        .filter((o) => o._id !== p._id && o.categories?.some((c) => p.categories?.includes(c)))
        .slice(0, 3)

    const keys = new Map<string, string>()
    for (const p of posts) {
      // Only live related posts render (drafts / scheduled / deleted are filtered out).
      const chosen = (p.related ?? []).map((id) => live.get(id)).filter((o): o is PostRow => Boolean(o) && o!._id !== p._id)
      const related = chosen.length > 0 ? chosen : fallbackFor(p)
      const linked = (p.links ?? []).map((id) => [id, rev.get(id) ?? null])

      keys.set(
        p.slug,
        digest([
          siteRev,
          cardDeps(p), // the post + its author + its category names
          rev.get(p.author ?? ''),
          (p.categories ?? []).map((c) => rev.get(c)),
          related.map((r) => [r._id, cardDeps(r)]), // related cards
          linked, // internal links inside the body resolve slugs from these posts
        ]),
      )
    }
    return keys
  })()
  return postKeysPromise
}
