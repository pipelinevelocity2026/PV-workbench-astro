import type {PortableTextBlock} from '@portabletext/to-html'

/** Image as projected by our GROQ queries (see IMAGE in queries.ts). */
export interface SanityImageData {
  url: string
  width: number
  height: number
  alt?: string | null
}

export interface SeoFields {
  seoTitle?: string | null
  metaDescription?: string | null
  canonicalUrl?: string | null
  noIndex?: boolean | null
  ogTitle?: string | null
  ogDescription?: string | null
  ogImage?: {url: string; width: number; height: number} | null
}

export interface CategoryRef {
  name: string
  slug: string
}

export interface CategoryWithCount extends CategoryRef {
  postCount: number
}

export interface AuthorRef {
  name: string
  slug: string
}

export interface SocialLink {
  platform: string
  url: string
}

export interface Author extends AuthorRef {
  designation?: string | null
  bio?: string | null
  image?: SanityImageData | null
  socialLinks?: SocialLink[] | null
  seo?: SeoFields | null
  postCount: number
}

/** Fields needed to render a card. Nothing more is fetched for listings. */
export interface PostCard {
  _id: string
  title: string
  slug: string
  excerpt: string
  publishedAt: string
  modifiedAt?: string | null
  featuredImage?: SanityImageData | null
  author?: AuthorRef | null
  categories?: CategoryRef[] | null
}

export interface PostFull extends PostCard {
  body?: PortableTextBlock[] | null
  tags?: string[] | null
  author?: (AuthorRef & Pick<Author, 'designation' | 'bio' | 'image'>) | null
  relatedPosts?: PostCard[] | null
  seo?: SeoFields | null
}

export interface Category extends CategoryRef {
  description?: string | null
  image?: SanityImageData | null
  seo?: SeoFields | null
  postCount: number
}

export interface BlogSettings {
  title?: string | null
  description?: string | null
  postsPerPage: number
  showCategoryNav: boolean
  newsletterEnabled: boolean
  newsletterHeading?: string | null
  newsletterFormUrl?: string | null
  seo?: SeoFields | null
  /** Resolved in order; first is the hero. */
  featuredPosts?: PostCard[] | null
}

export interface SiteSettings {
  siteTitle?: string
  logoText?: string
  navigation?: {label: string; url: string}[]
  headerButtonText?: string
  headerButtonUrl?: string
  footerText?: string
  copyright?: string
}

export interface BreadcrumbItem {
  name: string
  /** Site-relative path. Omit for the current (last) page. */
  path?: string
}
