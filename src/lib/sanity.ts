import {createClient} from '@sanity/client'

/**
 * Project id and dataset come from the environment (.env locally, Cloudflare
 * variables in production). They are public identifiers, not secrets.
 * The fallbacks keep builds working if the variables are not set yet.
 */
export const SANITY_PROJECT_ID = import.meta.env.SANITY_PROJECT_ID || '0huhxxkr'
export const SANITY_DATASET = import.meta.env.SANITY_DATASET || 'production'

/**
 * The single public, read-only client. No token: it can only read published
 * content. (Draft preview will use a separate server-only client in Phase 5.)
 */
/** Test-only: point the build at a mock Sanity API (scripts/incremental-test). Unset in production. */
const API_HOST = (process.env.SANITY_API_HOST ?? import.meta.env.SANITY_API_HOST) as string | undefined

const client = createClient({
  projectId: SANITY_PROJECT_ID,
  dataset: SANITY_DATASET,
  apiVersion: '2026-11-13',
  // `published` guarantees drafts can never leak into static pages.
  perspective: 'published',
  // Fresh content during development
  useCdn: !import.meta.env.DEV && !API_HOST,
  ...(API_HOST ? {apiHost: API_HOST, useProjectHostname: false} : {}),
})

/** Counts API requests per build (read by integrations/build-extras.mjs for the build report). */
const countingFetch = client.fetch.bind(client) as typeof client.fetch
client.fetch = ((...args: Parameters<typeof client.fetch>) => {
  const g = globalThis as {__sanityRequests?: number}
  g.__sanityRequests = (g.__sanityRequests ?? 0) + 1
  return countingFetch(...args)
}) as typeof client.fetch

export const sanity = client
