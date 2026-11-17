// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import { buildExtras } from './src/integrations/build-extras.mjs';

// astro.config is evaluated before Astro loads .env, so read it explicitly.
// Real process env (Cloudflare build variables) wins over the .env file.
const env = { ...loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), ''), ...process.env };

/**
 * Canonical production origin, used for canonical URLs, sitemap and JSON-LD.
 * Set SITE_URL in Cloudflare (Build variables) when the real domain goes live.
 */
const SITE_URL = env.SITE_URL || 'https://pv-workbench-astro.pratik-d8a.workers.dev';

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  // One URL form everywhere: /blog/my-post/ (never /blog/my-post).
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    buildExtras({
      projectId: env.SANITY_PROJECT_ID || '0huhxxkr',
      dataset: env.SANITY_DATASET || 'production',
      apiHost: env.SANITY_API_HOST, // test-only (scripts/incremental-test)
    }),
  ],
  experimental: {
    // EXPERIMENTAL (Astro 7.2+). Reuses HTML of unchanged pages between builds.
    // Pages opt in via `cacheKey` in getStaticPaths() - see src/lib/cache-keys.ts.
    // Cache lives in node_modules/.astro (must be persisted between CI runs).
    // Escape hatch: `astro build --force` ignores the cache; removing this flag
    // restores plain full builds with no other change.
    incrementalBuild: true,
  },
});
