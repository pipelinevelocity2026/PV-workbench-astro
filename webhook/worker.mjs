/**
 * Sanity webhook receiver (Cloudflare Worker).
 *
 *   Sanity -> [signature check] -> [replay check] -> [dedupe] -> [relevance]
 *          -> Cloudflare Workers Builds deploy hook -> Cloudflare builds + deploys
 *
 * Secrets (never in code or the frontend; set with `wrangler secret put`):
 *   SANITY_WEBHOOK_SECRET  same value as the secret on the Sanity webhook
 *   CF_DEPLOY_HOOK_URL     deploy hook URL (Workers & Pages > your project > Settings >
 *                          Builds > Deploy Hooks). The URL itself is the credential.
 * Variables (wrangler.toml): SANITY_PROJECT_ID, SANITY_DATASET (for the hourly cron)
 * Optional KV binding: DEDUPE  (remembers idempotency keys for 24h)
 */
import {SIGNATURE_HEADER_NAME, decodeSignatureHeader, isValidSignature} from '@sanity/webhook'
import {decideBatch} from './decide.mjs'

const MAX_AGE_MS = 10 * 60 * 1000
const json = (status, body) =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})

/** Cloudflare Workers Builds deploy hook: the secret URL is the credential. */
const triggerBuild = (env) => fetch(env.CF_DEPLOY_HOOK_URL, {method: 'POST'})

export default {
  /**
   * Cron: scheduled posts have no Sanity event when publishedAt passes, so once an
   * hour ask Sanity whether any post went live since the last check (public,
   * read-only query) and build only if so.
   */
  async scheduled(controller, env) {
    if (!env.CF_DEPLOY_HOOK_URL || !env.SANITY_PROJECT_ID) return
    const since = new Date(controller.scheduledTime - 60 * 60 * 1000).toISOString()
    const q = encodeURIComponent('count(*[_type == "post" && !(_id in path("drafts.**")) && publishedAt <= now() && publishedAt > $since])')
    const url = `https://${env.SANITY_PROJECT_ID}.apicdn.sanity.io/v2026-11-13/data/query/${env.SANITY_DATASET || 'production'}?query=${q}&$since=${encodeURIComponent(JSON.stringify(since))}&perspective=published`
    const res = await fetch(url)
    if (!res.ok) return
    const {result} = await res.json()
    if (result > 0) await triggerBuild(env)
  },

  async fetch(request, env) {
    if (request.method !== 'POST') return json(405, {error: 'method not allowed'})
    if (!env.SANITY_WEBHOOK_SECRET || !env.CF_DEPLOY_HOOK_URL) {
      return json(500, {error: 'worker is not configured'}) // fail closed; never build unauthenticated
    }

    // 1. Authenticate: HMAC over the RAW body (not re-serialised JSON).
    const raw = await request.text()
    const signature = request.headers.get(SIGNATURE_HEADER_NAME)
    let valid = false
    try {
      valid = Boolean(signature) && (await isValidSignature(raw, signature, env.SANITY_WEBHOOK_SECRET))
    } catch {
      valid = false
    }
    if (!valid) return json(401, {error: 'invalid signature'})

    // 2. Replay protection: the signed timestamp must be recent.
    const {timestamp} = decodeSignatureHeader(signature)
    if (Math.abs(Date.now() - timestamp) > MAX_AGE_MS) return json(401, {error: 'stale signature'})

    // 3. Deduplicate retries of the same delivery.
    const idem = request.headers.get('idempotency-key')
    if (idem && env.DEDUPE && (await env.DEDUPE.get(idem))) return json(200, {skipped: true, reason: 'duplicate delivery'})

    // 4. Relevance: only published, rendered content triggers a build.
    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      return json(400, {error: 'invalid JSON'})
    }
    const decision = decideBatch(payload)
    if (!decision.build) {
      if (idem && env.DEDUPE) await env.DEDUPE.put(idem, '1', {expirationTtl: 86400})
      return json(200, {skipped: true, reason: decision.reason})
    }

    // 5. Trigger the Cloudflare build. Cloudflare drops extra hits that arrive before
    //    the first build starts, so bursts of edits collapse into one build.
    const res = await triggerBuild(env)
    if (!res.ok) return json(502, {error: 'could not trigger build', status: res.status}) // Sanity will retry

    if (idem && env.DEDUPE) await env.DEDUPE.put(idem, '1', {expirationTtl: 86400}) // only after success
    return json(202, {triggered: true, reason: decision.reason})
  },
}
