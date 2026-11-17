import test from 'node:test'
import assert from 'node:assert/strict'
import {encodeSignatureHeader} from '@sanity/webhook'
import worker from './worker.mjs'

const SECRET = 'test-secret'
const env = (extra = {}) => ({SANITY_WEBHOOK_SECRET: SECRET, CF_DEPLOY_HOOK_URL: 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc', ...extra})
const event = {_id: 'post-1', _type: 'post', op: 'update', wasLive: true, isLive: true}

async function send(body, {secret = SECRET, ts = Date.now(), headers = {}, e = env(), method = 'POST', sign = true} = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const h = {...headers}
  if (sign) h['sanity-webhook-signature'] = await encodeSignatureHeader(raw, ts, secret)
  return worker.fetch(new Request('https://hook.test/', {method, body: method === 'POST' ? raw : undefined, headers: h}), e)
}

let dispatches
test.beforeEach(() => {
  dispatches = []
  globalThis.fetch = async (url, init) => {
    dispatches.push({url, init})
    return new Response(null, {status: 204})
  }
})

const kv = () => {
  const store = new Map()
  return {store, get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v)}
}

test('valid + relevant -> 202 and one POST to the deploy hook', async () => {
  const res = await send(event)
  assert.equal(res.status, 202)
  assert.equal(dispatches.length, 1)
  assert.match(dispatches[0].url, /builds\/deploy_hooks\/abc$/)
  assert.equal(dispatches[0].init.method, 'POST')
})
test('missing signature -> 401, no dispatch', async () => {
  assert.equal((await send(event, {sign: false})).status, 401)
  assert.equal(dispatches.length, 0)
})
test('wrong secret -> 401', async () => assert.equal((await send(event, {secret: 'nope'})).status, 401))
test('tampered body -> 401', async () => {
  const raw = JSON.stringify(event)
  const sig = await encodeSignatureHeader(raw, Date.now(), SECRET)
  const res = await worker.fetch(new Request('https://h/', {method: 'POST', body: raw + ' ', headers: {'sanity-webhook-signature': sig}}), env())
  assert.equal(res.status, 401)
  assert.equal(dispatches.length, 0)
})
test('stale (replayed) signature -> 401', async () => assert.equal((await send(event, {ts: Date.now() - 3600_000})).status, 401))
test('GET -> 405', async () => assert.equal((await send(event, {method: 'GET', sign: false})).status, 405))
test('unconfigured worker fails closed -> 500', async () => assert.equal((await send(event, {e: {}})).status, 500))
test('draft edit -> 200 skipped, no dispatch', async () => {
  const res = await send({...event, _id: 'drafts.post-1'})
  assert.equal(res.status, 200)
  assert.equal((await res.json()).skipped, true)
  assert.equal(dispatches.length, 0)
})
test('duplicate idempotency key -> built once', async () => {
  const DEDUPE = kv()
  const h = {'idempotency-key': 'abc'}
  assert.equal((await send(event, {headers: h, e: env({DEDUPE})})).status, 202)
  const second = await send(event, {headers: h, e: env({DEDUPE})})
  assert.equal((await second.json()).reason, 'duplicate delivery')
  assert.equal(dispatches.length, 1)
})
test('GitHub failure -> 502 and key NOT remembered (so Sanity retries)', async () => {
  globalThis.fetch = async () => new Response('x', {status: 500})
  const DEDUPE = kv()
  assert.equal((await send(event, {headers: {'idempotency-key': 'k'}, e: env({DEDUPE})})).status, 502)
  assert.equal(DEDUPE.store.size, 0)
})

test('cron: builds only when a post went live in the last hour', async () => {
  const e = env({SANITY_PROJECT_ID: 'p'})
  for (const [count, expected] of [[0, 0], [2, 1]]) {
    dispatches = []
    globalThis.fetch = async (url, init) => {
      dispatches.push({url, init})
      return String(url).includes('apicdn.sanity.io') ? new Response(JSON.stringify({result: count})) : new Response(null, {status: 204})
    }
    await worker.scheduled({scheduledTime: Date.now()}, e)
    assert.equal(dispatches.filter((d) => d.url.includes('deploy_hooks')).length, expected)
  }
})
