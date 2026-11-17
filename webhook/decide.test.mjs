import test from 'node:test'
import assert from 'node:assert/strict'
import {decide, decideBatch} from './decide.mjs'

const post = (o) => ({_id: 'post-1', _type: 'post', op: 'update', wasLive: true, isLive: true, ...o})

test('new post published -> build', () => assert.equal(decide(post({op: 'create', wasLive: null, isLive: true})).build, true))
test('live post edited -> build', () => assert.equal(decide(post({})).build, true))
test('slug change -> build, flagged', () => {
  const d = decide(post({slug: 'b', oldSlug: 'a'}))
  assert.equal(d.build, true)
  assert.match(d.reason, /slug changed/)
})
test('unpublish/delete of live post -> build', () => assert.equal(decide(post({op: 'delete', isLive: null})).build, true))
test('delete of never-live (scheduled) post -> no build', () => assert.equal(decide(post({op: 'delete', wasLive: false, isLive: null})).build, false))
test('scheduled post edited -> no build', () => assert.equal(decide(post({wasLive: false, isLive: false})).build, false))
test('post un-scheduled (was future, now live) -> build', () => assert.equal(decide(post({wasLive: false, isLive: true})).build, true))
test('live post moved to future date -> build (must disappear)', () => assert.equal(decide(post({wasLive: true, isLive: false})).build, true))
test('draft edit -> no build', () => assert.equal(decide(post({_id: 'drafts.post-1'})).build, false))
test('version document -> no build', () => assert.equal(decide(post({_id: 'versions.r1.post-1'})).build, false))
test('unrelated type -> no build', () => assert.equal(decide({_id: 'x', _type: 'internalNote', op: 'update'}).build, false))
test('category / author / settings / redirect -> build', () => {
  for (const _type of ['category', 'author', 'siteSettings', 'blogSettings', 'homePage', 'redirect'])
    assert.equal(decide({_id: _type + '-1', _type, op: 'update'}).build, true, _type)
})
test('garbage -> no build', () => {
  assert.equal(decide(null).build, false)
  assert.equal(decide({}).build, false)
})
test('batch: any relevant event triggers', () =>
  assert.equal(decideBatch([{_id: 'drafts.a', _type: 'post'}, {_id: 'author-1', _type: 'author', op: 'update'}]).build, true))
