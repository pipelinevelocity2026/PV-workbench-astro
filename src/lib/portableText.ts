/**
 * Portable Text -> HTML (zero client-side JavaScript).
 * Also returns the h2/h3 outline used for the table of contents.
 */
import {escapeHTML, toHTML, uriLooksSafe} from '@portabletext/to-html'
import type {PortableTextBlock, PortableTextComponents} from '@portabletext/to-html'
import {imageSrcset, imageUrl} from './image'
import {paths} from './urls'

export interface Heading {
  id: string
  text: string
  level: 2 | 3
}

const HEADING_STYLES = ['h2', 'h3', 'h4']

const slugifyHeading = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section'

const blockText = (block: any): string =>
  (block.children ?? []).map((c: any) => c.text ?? '').join('')

/** Assign stable, unique ids to headings (keyed by block _key). */
function collectHeadings(blocks: any[]) {
  const ids = new Map<string, string>()
  const headings: Heading[] = []
  const used = new Set<string>()
  for (const block of blocks) {
    if (block?._type !== 'block' || !HEADING_STYLES.includes(block.style)) continue
    const text = blockText(block).trim()
    if (!text) continue
    const base = slugifyHeading(text)
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    ids.set(block._key, id)
    if (block.style !== 'h4') headings.push({id, text, level: block.style === 'h2' ? 2 : 3})
  }
  return {ids, headings}
}

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null
    if (u.hostname.endsWith('youtube.com')) {
      return u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts)\/([\w-]{6,})/)?.[1] ?? null
    }
  } catch {}
  return null
}

export function renderBody(blocks: PortableTextBlock[] | null | undefined) {
  // Empty text blocks (editors pressing Enter twice) would render as <p></p>.
  blocks = blocks?.filter((b: any) => b._type !== 'block' || b.listItem || blockText(b).trim() !== '')
  if (!blocks?.length) return {html: '', headings: [] as Heading[]}
  const {ids, headings} = collectHeadings(blocks)

  const heading =
    (tag: 'h2' | 'h3' | 'h4') =>
    ({node, children}: {node: any; children?: string}) => {
      const id = ids.get(node._key)
      return `<${tag}${id ? ` id="${escapeHTML(id)}"` : ''}>${children}</${tag}>`
    }

  const components: Partial<PortableTextComponents> = {
    block: {h2: heading('h2'), h3: heading('h3'), h4: heading('h4')},
    marks: {
      link: ({children, value}) => {
        const href = value?.href
        if (!href || !uriLooksSafe(href)) return children
        const rel = ['noopener', value.nofollow ? 'nofollow' : ''].filter(Boolean).join(' ')
        const external = /^https?:/i.test(href)
        const target = value.openInNewTab ? ' target="_blank"' : ''
        return `<a href="${escapeHTML(href)}"${external || target ? ` rel="${rel}"` : ''}${target}>${children}</a>`
      },
      // Resolved by slug in the query; a deleted target degrades to plain text.
      internalLink: ({children, value}) =>
        value?.slug ? `<a href="${escapeHTML(paths.post(value.slug))}">${children}</a>` : children,
    },
    types: {
      image: ({value}) => {
        if (!value?.url) return ''
        const w = value.width ?? 1600
        const h = value.height ?? 900
        const srcset = imageSrcset({url: value.url, width: w, height: h}, [480, 800, 1200, 1600])
        const img =
          `<img src="${escapeHTML(imageUrl(value.url, Math.min(800, w)))}" srcset="${escapeHTML(srcset)}" ` +
          `sizes="(min-width: 800px) 720px, 100vw" alt="${escapeHTML(value.alt ?? '')}" ` +
          `${value.width ? `width="${value.width}" height="${value.height}" ` : ''}loading="lazy" decoding="async">`
        return `<figure>${img}${value.caption ? `<figcaption>${escapeHTML(value.caption)}</figcaption>` : ''}</figure>`
      },
      codeBlock: ({value}) => {
        const lang = String(value?.language ?? 'text').replace(/[^\w+-]/g, '')
        const file = value?.filename ? `<div class="code-filename">${escapeHTML(value.filename)}</div>` : ''
        return `<div class="code-block">${file}<pre tabindex="0"><code class="language-${lang}">${escapeHTML(value?.code ?? '')}</code></pre></div>`
      },
      youtube: ({value}) => {
        const id = youtubeId(value?.url ?? '')
        if (!id) return ''
        return `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${escapeHTML(id)}" title="${escapeHTML(value.title ?? 'Video')}" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
      },
    },
  }

  return {html: toHTML(blocks, {components}), headings}
}
