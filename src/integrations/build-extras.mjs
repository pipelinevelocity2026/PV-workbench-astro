/**
 * Build-time extras that must run on EVERY build, even when most pages are
 * reused from the incremental cache:
 *
 *  1. `_redirects` - Cloudflare redirect rules from Sanity `redirect` documents
 *     (created automatically when a published post's slug changes).
 *  2. Build report - pages built vs reused, Sanity API requests, duration.
 *     Written to node_modules/.astro/build-report.json and printed.
 *
 * Both are cheap (one query) and must never be cached: a stale `_redirects`
 * would keep sending visitors to the wrong place.
 */
import {createClient} from '@sanity/client'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

// Cloudflare static redirect limit (Pages and Workers assets).
const MAX_STATIC_REDIRECTS = 2000

export function buildExtras({projectId, dataset, apiHost}) {
  let startedAt = 0
  return {
    name: 'build-extras',
    hooks: {
      'astro:build:start': () => {
        startedAt = Date.now()
        globalThis.__sanityRequests = 0
      },
      'astro:build:done': async ({dir, pages, logger}) => {
        const outDir = fileURLToPath(dir)

        // ---- 1. _redirects ----
        const client = createClient({projectId, dataset, apiVersion: '2026-11-13', useCdn: false, perspective: 'published', ...(apiHost ? {apiHost, useProjectHostname: false} : {})})
        globalThis.__sanityRequests = (globalThis.__sanityRequests ?? 0) + 1
        const rows = await client.fetch(
          `*[_type == "redirect" && defined(from) && defined(to)] | order(from asc){from, to, permanent}`,
        )
        const live = new Set(pages.map((p) => '/' + p.pathname.replace(/^\/+/, '')))
        const lines = []
        for (const r of rows) {
          if (r.from === r.to) continue
          // A redirect must never shadow a page that exists (Cloudflare evaluates redirects first).
          if (live.has(r.from)) {
            logger.warn(`Skipping redirect ${r.from} -> ${r.to}: ${r.from} is a live page.`)
            continue
          }
          lines.push(`${r.from} ${r.to} ${r.permanent === false ? 302 : 301}`)
        }
        if (lines.length > MAX_STATIC_REDIRECTS) {
          logger.warn(`${lines.length} redirects exceeds Cloudflare's ${MAX_STATIC_REDIRECTS} static limit; truncating.`)
          lines.length = MAX_STATIC_REDIRECTS
        }
        if (lines.length > 0) fs.writeFileSync(path.join(outDir, '_redirects'), lines.join('\n') + '\n')
        logger.info(`_redirects: ${lines.length} rule(s)`)

        // ---- 2. build report ----
        const report = {
          at: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          pagesInOutput: pages.length,
          sanityRequests: globalThis.__sanityRequests ?? null,
        }
        logger.info(`build report: ${JSON.stringify(report)}`)
        try {
          const cache = path.resolve('node_modules/.astro')
          fs.mkdirSync(cache, {recursive: true})
          fs.writeFileSync(path.join(cache, 'build-report.json'), JSON.stringify(report, null, 2))
        } catch {}
      },
    },
  }
}
