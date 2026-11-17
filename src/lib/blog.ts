/**
 * Page-level data loaders. They compose the queries in queries.ts and are the
 * single source for BOTH getStaticPaths (which pages exist) and page rendering,
 * so a page can never exist without data or vice versa.
 */
import {
  filters,
  getAuthors,
  getBlogSettings,
  getCategories,
  getCategoriesWithPosts,
  getHeroPost,
  getPostPage,
} from './queries'
import type {Author, Category, PostCard} from './types'

export const totalPagesFor = (total: number, perPage: number) => Math.max(1, Math.ceil(total / perPage))

// ---------- /blog/ and /blog/page/N/ ----------
export async function loadBlogIndex(page: number) {
  const settings = await getBlogSettings()
  const hero = await getHeroPost(settings)
  // The hero is excluded from the list on every page, so it never shows twice
  // and page counts stay consistent.
  const {posts, total} = await getPostPage({page, perPage: settings.postsPerPage, excludeId: hero?._id})
  const picks = (settings.featuredPosts ?? []).slice(1)
  const categories = settings.showCategoryNav ? await getCategoriesWithPosts() : []
  return {settings, hero, picks, posts, total, totalPages: totalPagesFor(total, settings.postsPerPage), categories}
}

// ---------- category / author archives ----------
export interface ArchiveData<T> {
  entity: T
  posts: PostCard[]
  totalPages: number
}

async function loadArchive<T extends {postCount: number; _id?: string}>(
  entity: T,
  id: string,
  kind: 'category' | 'author',
  page: number,
): Promise<ArchiveData<T>> {
  const settings = await getBlogSettings()
  const param = kind === 'category' ? {categoryId: id} : {authorId: id}
  const {posts, total} = await getPostPage({
    page,
    perPage: settings.postsPerPage,
    filter: filters[kind],
    params: param,
  })
  return {entity, posts, totalPages: totalPagesFor(total, settings.postsPerPage)}
}

type WithId<T> = T & {_id: string}

export async function listCategories() {
  return getCategories() as Promise<WithId<Category>[]>
}
export async function listAuthors() {
  return getAuthors() as Promise<WithId<Author>[]>
}

export async function loadCategoryArchive(slug: string, page: number) {
  const entity = (await listCategories()).find((c) => c.slug === slug)
  if (!entity) return null
  return {...(await loadArchive(entity, entity._id, 'category', page)), categories: await getCategoriesWithPosts()}
}

export async function loadAuthorArchive(slug: string, page: number) {
  const entity = (await listAuthors()).find((a) => a.slug === slug)
  if (!entity) return null
  return loadArchive(entity, entity._id, 'author', page)
}

/** Every [slug, page] combination for an archive route (page >= 1). */
export async function archivePaths(kind: 'category' | 'author') {
  const settings = await getBlogSettings()
  const entities = kind === 'category' ? await getCategories() : await getAuthors()
  return entities.flatMap((e) => {
    const pages = totalPagesFor(e.postCount, settings.postsPerPage)
    return Array.from({length: pages}, (_, i) => ({slug: e.slug, page: i + 1, postCount: e.postCount}))
  })
}
