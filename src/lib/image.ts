/**
 * Responsive Sanity images via the Sanity image CDN (no build-time download,
 * so build time does not grow with the number of images).
 * `auto=format` serves AVIF/WebP to browsers that support it.
 */
import type {SanityImageData} from './types'

export function imageUrl(url: string, width: number, height?: number): string {
  const params = new URLSearchParams({w: String(width), auto: 'format', q: '80'})
  if (height) {
    params.set('h', String(height))
    params.set('fit', 'crop')
  }
  return `${url}?${params}`
}

/** srcset for a fixed aspect ratio, at several widths (never upscales). */
export function imageSrcset(img: SanityImageData, widths: number[], aspect?: number): string {
  return widths
    .filter((w) => w <= img.width)
    .concat(img.width < Math.min(...widths) ? [img.width] : [])
    .map((w) => `${imageUrl(img.url, w, aspect ? Math.round(w / aspect) : undefined)} ${w}w`)
    .join(', ')
}
