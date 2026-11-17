# Incremental builds, webhook and deploy

Written for: the developer who maintains this Astro + Sanity site.

## 1. Audit summary (state before this work)

| Area | Finding |
|---|---|
| Astro | 7.4.11, `output: static`, `trailingSlash: always`, directory format. No adapter. |
| Routes | `/`, `/blog/`, `/blog/page/[page]`, `/blog/[slug]`, `/blog/category/[slug]` (+pages), `/blog/author/[slug]` (+pages). |
| Data | `@sanity/client`, `perspective: published`, CDN on. GROQ in `src/lib/queries.ts`; one fetch per post page + shared singletons. |
| Sitemap / robots / 404 / `_redirects` | **None existed.** The Studio creates `redirect` documents on slug change, but nothing in the site consumed them, so old URLs would have returned 404. |
| Webhook / CI | None existed. Builds run on Cloudflare (Git-connected); that stays. |
| Hosting | Production URL is `*.workers.dev`, i.e. Cloudflare **Workers** (static assets), not Pages. Dashboard settings were not visible from the repo. |
| SEO | Canonical, robots, title/description centralised in `lib/seo.ts`. **No Open Graph, Twitter or JSON-LD output yet** (the code comments call this "Phase 5"). Not changed here. |

## 2. How incremental reuse works

`experimental.incrementalBuild` (Astro 7.2+, **experimental**) stores a manifest in `node_modules/.astro`.
A page is reused only if all of these match the previous build:

* the route's **module graph** hash (layouts, components, `lib/*`, CSS) — automatic,
* the **config** hash and the **lockfile** hash — automatic (mismatch discards the whole cache),
* the page's **`cacheKey`** — *ours*. Astro cannot see Sanity data.

So the correctness of the whole system rests on one rule: **a page's `cacheKey` must change whenever anything it renders changes.** See `src/lib/cache-keys.ts`.

### Dependency map (what invalidates what)

| Change | Pages re-rendered |
|---|---|
| Layout / component / `queries.ts` / config / dependency upgrade | All (automatic, by Astro) |
| `siteSettings` (header, footer, site title) | All |
| `blogSettings` (page size, featured posts) | Blog index + archives (data hash); pagination shifts |
| New / unpublished / deleted post | New post page, every listing it shifts (newest-first pagination moves every index page), its category + author archives, posts that show it as a "related" card, sitemap, redirects |
| Post edited (title, SEO, image, body) | That post; listings/archives that show its card; posts that show it as related |
| Post slug changed | New URL page, listings, posts that link to it, sitemap; old URL disappears; `_redirects` rule |
| Post category changed | That post, old + new category pages, related cards |
| Author / category edited | Their archive, their posts, every card that shows them |
| Unrelated Sanity document | None |
| `/`, `/blog/`, `sitemap.xml`, `robots.txt`, `_redirects` | Always regenerated (no `cacheKey` possible; cheap) |

Post pages use `_rev`-based keys (so bodies are not downloaded just to decide to skip). Listing pages hash the exact data they render. **If you add a field/reference/component to the post page that shows data from another document, add that document's `_rev` in `postKey` logic in `cache-keys.ts`.**

Deleted/unpublished pages are not generated, so they are absent from `dist/` and Cloudflare serves `404.html` with a 404 status; slug changes get a 301 from `_redirects`.

### Escape hatches
* `astro build --force` (or the workflow's "force" input): full rebuild, still writes a fresh cache.
* Remove `experimental.incrementalBuild` from `astro.config.mjs`: plain full builds, nothing else changes.
* Bump `FORMAT_VERSION` in `cache-keys.ts` after changing key logic.

### Production risk of the experimental flag
The API may change in a minor release, and a bug in dependency hashing would serve stale HTML. Mitigations: `npm` upgrades invalidate the cache; the harness compares incremental output with a full build byte for byte (`scripts/incremental-test`); the hourly scheduled run + manual "force" give recovery. Re-run the harness after every Astro upgrade.

## 3. Webhook

**Current setup (recommended, nothing to deploy):** the Sanity webhook posts straight to the Cloudflare deploy hook, so a build starts only when something is published. Optionally add the filter below to the existing webhook in Sanity to skip publishes of documents the site never renders. Known gap: a scheduled post (future `publishedAt`) has no event when its date arrives, so it appears at the next build.

**Optional extra (`webhook/` folder, not required):** a Worker that adds signature verification, dedupe, an hourly cron for scheduled posts, and the same relevance rules. Deploy it only if scheduled posts or the extra hardening matter.

Details of the optional Worker:

`webhook/worker.mjs` (Cloudflare Worker) verifies the Sanity HMAC signature (`@sanity/webhook`) over the raw body, rejects stale timestamps (10 min), dedupes on `idempotency-key` (optional KV), decides relevance (`webhook/decide.mjs`), then POSTs the Cloudflare **Workers Builds deploy hook**. Cloudflare drops extra hook hits that arrive before a build starts, so bursts collapse into one build. An hourly cron asks Sanity whether a scheduled post just went live and builds only if so. Fails closed if not configured. Tests: `cd webhook && npm test` (25 tests).

### Sanity webhook settings (manage.sanity.io → API → Webhooks)
* **Dataset:** production · **Trigger on:** Create, Update, Delete · **Drafts:** off
* **Filter:** `_type in ["post","category","author","siteSettings","blogSettings","homePage","redirect"] && !(_id in path("drafts.**")) && !(_id in path("versions.**"))`
* **Projection:**
  ```groq
  {_id, _type, "op": delta::operation(), "slug": slug.current, "oldSlug": before().slug.current,
   "wasLive": before().publishedAt <= now(), "isLive": after().publishedAt <= now()}
  ```
* **HTTP method:** POST · **Secret:** a long random string (same value as the Worker's `SANITY_WEBHOOK_SECRET`)
* Confirm in Sanity's delivery log that delete events include `wasLive` (the projection is evaluated against `before()`); adjust if your plan's webhook version differs.

### Secrets
Worker only: `wrangler secret put SANITY_WEBHOOK_SECRET` and `wrangler secret put CF_DEPLOY_HOOK_URL` (create the hook in Cloudflare: your Worker > Settings > Builds > Deploy Hooks, branch main). Nothing secret is in frontend code; the site uses no token.

## 4. Cloudflare build cache

Cloudflare's [build caching](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/) lists `node_modules/.astro` for Astro, which is exactly where the incremental manifest and cached HTML live. Enable it under Settings > Build > Build cache. The cache is purged 7 days after its last read (daily publishing keeps it warm). Astro discards it itself if config, lockfile or a page's code changed.

**Verify on the first two real builds:** the build log of the second run (with no content change) must show `(restored)` next to blog pages and the `build-extras` line `build report: {...}`. If every page says rendered, the cache is not persisting: clear it in the dashboard and re-check; do not assume.
Cloudflare builds cannot skip a deploy when output is unchanged; the webhook filter is what prevents unnecessary builds.

## 5. Measured results (synthetic 300 posts, 392 pages, offline mock API)

Run: `node scripts/incremental-test/run.mjs 300`. Local machine, mock Sanity API (real GROQ via groq-js, which is slow — **absolute seconds are inflated; compare ratios**). Deployment duration cannot be measured offline.

| Scenario | Rendered | Reused | Sanity requests | Astro build (s) |
|---|---|---|---|---|
| Cold build (empty cache) | 394 | 0 | 731 | 160 |
| No content change | 5 | 389 | 131 | 7 |
| Publish one new post | 126 | 270 | 234 | 34 |
| Edit one post title | 10 | 386 | 136 | 8 |
| Change slug (+ redirect) | 10 | 386 | 136 | 8 |
| Change category | 71 | 324 | 135 | 10 |
| Unpublish a post | 73 | 320 | 132 | 8 |
| Delete a post | 73 | 319 | 132 | 9 |
| Edit unrelated Sanity content | 5 | 387 | 130 | 7 |
| Edit an author bio | 212 | 180 | 532 | 120 |
| Edit site settings | 392 | 0 | 728 | 171 |
| Edit shared Footer component | 392 | 0 | 728 | 167 |

31/31 assertions passed, including: new URL exists / old URL gone / sitemap and `_redirects` correct, and **output of the 13 chained incremental builds is byte-identical to a full rebuild**.

### Known limits (inherent, not bugs)
* Newest-first pagination: publishing or removing one post shifts every `/blog/page/N/`, so all of them re-render (cheap pages).
* "Related posts" fall back to the 3 newest posts in a category, so each publish re-renders the posts in that category (fresh internal links; costs ~N/categories pages).
* Author/site-wide data shown on cards (author name) fans out widely.
* Request count does not fall to near zero: listing pages load their data in `getStaticPaths` to compute their key (~130 requests at 300 posts). A single bulk listing query would cut this further.
* Scheduled posts rely on the Worker's hourly cron (no Sanity event fires when `publishedAt` passes).
