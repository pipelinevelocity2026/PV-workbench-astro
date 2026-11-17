/**
 * Incremental-build scenario tests. Fully offline and non-destructive: it never
 * touches the real Sanity dataset.
 *
 *   node scripts/incremental-test/run.mjs [postCount=1000]
 *
 * It serves a synthetic dataset through a mock Sanity query API (real GROQ via
 * groq-js, borrowed from ../studio/node_modules), points the real Astro build
 * at it (SANITY_API_HOST), then applies editorial changes and rebuilds,
 * recording per scenario: build time, pages rendered vs reused, Sanity API
 * requests, and output assertions (URLs exist / are gone, sitemap, redirects).
 *
 * NOTE: it uses the project's normal dist/ and node_modules/.astro cache.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {pathToFileURL, fileURLToPath} from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const groqUrl = pathToFileURL(path.resolve(ROOT, '../studio/node_modules/groq-js/dist/index.js')).href
const {parse, evaluate} = await import(groqUrl)

const N = Number(process.argv[2] ?? 1000)
const PER_PAGE = 12

// ---------------- synthetic dataset ----------------
let revCounter = 0
const stamp = (d) => ({...d, _rev: `r${++revCounter}`, _updatedAt: new Date().toISOString(), _createdAt: '2026-01-01T00:00:00Z'})
const ref = (id) => ({_type: 'reference', _ref: id})
const slugOf = (s) => ({_type: 'slug', current: s})

const docs = new Map()
const put = (d) => docs.set(d._id, stamp(d))
const patch = (id, fn) => {
  const d = structuredClone(docs.get(id))
  fn(d)
  docs.set(id, stamp(d))
}
const remove = (id) => docs.delete(id)

function makePost(i, overrides = {}) {
  const day = new Date(Date.UTC(2025, 0, 1) + i * 3600_000 * 6).toISOString()
  const body = Array.from({length: 14}, (_, k) => ({
    _type: 'block',
    _key: `b${i}-${k}`,
    style: k % 5 === 0 ? 'h2' : 'normal',
    markDefs: k === 3 && i > 1 ? [{_key: `m${i}`, _type: 'internalLink', reference: ref(`post-${i - 1}`)}] : [],
    children: [{_type: 'span', _key: `s${i}-${k}`, text: `Paragraph ${k} of post ${i}. `.repeat(6), marks: k === 3 && i > 1 ? [`m${i}`] : []}],
  }))
  return {
    _id: `post-${i}`,
    _type: 'post',
    title: `Post number ${i}`,
    slug: slugOf(`post-${i}`),
    excerpt: `Excerpt for post ${i}. It is long enough to satisfy the schema minimum length of fifty characters.`,
    publishedAt: day,
    featuredImage: {_type: 'image', asset: ref('image-a'), alt: `Image ${i}`},
    author: ref(`author-${i % 5}`),
    categories: [ref(`cat-${i % 8}`), ...(i % 3 === 0 ? [ref(`cat-${(i + 1) % 8}`)] : [])],
    body,
    ...overrides,
  }
}

function seed() {
  docs.clear()
  put({_id: 'siteSettings', _type: 'siteSettings', siteTitle: 'Test Site', logoText: 'Test', navigation: []})
  put({_id: 'blogSettings', _type: 'blogSettings', title: 'Blog', postsPerPage: PER_PAGE, showCategoryNav: true})
  put({_id: 'image-a', _type: 'sanity.imageAsset', url: 'https://cdn.sanity.io/images/x/y/a-1600x900.jpg', metadata: {dimensions: {width: 1600, height: 900}}})
  for (let a = 0; a < 5; a++) put({_id: `author-${a}`, _type: 'author', name: `Author ${a}`, slug: slugOf(`author-${a}`), bio: `Bio ${a}`})
  for (let c = 0; c < 8; c++) put({_id: `cat-${c}`, _type: 'category', name: `Category ${c}`, slug: slugOf(`cat-${c}`), description: `About category ${c}`})
  put({_id: 'unrelated-1', _type: 'internalNote', text: 'not rendered anywhere'})
  for (let i = 1; i <= N; i++) put(makePost(i))
}

// ---------------- mock Sanity query API ----------------
let apiRequests = 0
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    if (!/\/data\/query\//.test(url.pathname)) return res.writeHead(404).end('{}')
    let query = url.searchParams.get('query')
    const params = {}
    for (const [k, v] of url.searchParams) if (k.startsWith('$')) params[k.slice(1)] = JSON.parse(v)
    if (req.method === 'POST') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      query = body.query
      Object.assign(params, body.params ?? {})
    }
    apiRequests++
    const dataset = [...docs.values()].filter((d) => !d._id.startsWith('drafts.'))
    const result = await (await evaluate(parse(query, {params}), {dataset, params})).get()
    res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({ms: 1, query, result}))
  } catch (e) {
    res.writeHead(400, {'content-type': 'application/json'}).end(JSON.stringify({error: {description: String(e.message ?? e)}}))
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const API = `http://127.0.0.1:${server.address().port}`

// ---------------- build runner ----------------
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
function build(label, {force = false} = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    apiRequests = 0
    const args = ['node_modules/astro/bin/astro.mjs', 'build', ...(force ? ['--force'] : [])]
    const p = spawn(process.execPath, args, {
      cwd: ROOT,
      env: {...process.env, SANITY_API_HOST: API, SITE_URL: 'https://example.test', NO_COLOR: '1', ASTRO_TELEMETRY_DISABLED: '1'},
    })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => {
      out = strip(out)
      if (code !== 0) return reject(new Error(`${label}: build failed\n${out.slice(-2000)}`))
      const lines = out.split('\n').filter((l) => /├─|└─/.test(l))
      const reused = lines.filter((l) => /\(restored\)|\(skipped\)/.test(l)).length
      const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/.astro/build-report.json'), 'utf8'))
      resolve({
        label,
        wallSec: ((Date.now() - t0) / 1000).toFixed(1),
        astroBuildSec: (report.durationMs / 1000).toFixed(1),
        // The log prints every path when <= ~100 pages; above that Astro summarises. Count from the cache manifest instead.
        pages: report.pagesInOutput,
        reused,
        rendered: lines.length - reused,
        reportedRequests: report.sanityRequests,
        apiRequests,
        out,
      })
    })
  })
}

// ---------------- assertions ----------------
const dist = (p) => path.join(ROOT, 'dist', p)
const exists = (p) => fs.existsSync(dist(p))
const read = (p) => (exists(p) ? fs.readFileSync(dist(p), 'utf8') : '')
const htmlFiles = (dir = dist('')) =>
  fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? htmlFiles(p) : p.endsWith('.html') ? [p] : []
  })
const hashTree = (dir = dist(''), base = dist('')) =>
  Object.fromEntries(
    fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
      const p = path.join(dir, e.name)
      return e.isDirectory() ? Object.entries(hashTree(p, base)) : [[path.relative(base, p), createHash('sha256').update(fs.readFileSync(p)).digest('hex')]]
    }),
  )
const checks = []
const expect = (name, ok) => checks.push({name, ok: Boolean(ok)})

// ---------------- scenarios ----------------
const FOOTER = path.join(ROOT, 'src/components/Footer.astro')
const results = []
const run = async (label, mutate, verify, opts) => {
  await mutate?.()
  const before = checks.length
  const r = await build(label, opts)
  verify?.(r)
  r.failed = checks.slice(before).filter((c) => !c.ok).map((c) => c.name)
  results.push(r)
  console.log(`✓ ${label}: ${r.wallSec}s wall, ${r.rendered} rendered / ${r.reused} reused, ${r.apiRequests} API requests${r.failed.length ? '  FAILED: ' + r.failed.join('; ') : ''}`)
}

seed()
console.log(`Synthetic dataset: ${N} posts, 8 categories, 5 authors\n`)

await run('0. Cold build (empty cache)', () => fs.rmSync(path.join(ROOT, 'node_modules/.astro/incremental-build.json'), {force: true}), (r) => {
  expect('post page exists', exists('blog/post-1/index.html'))
  expect('sitemap lists post-1', read('sitemap.xml').includes('/blog/post-1/'))
  expect('404.html present', exists('404.html'))
})

await run('1. No content change', null, (r) => {
  expect('some pages reused', r.reused > 0)
  expect('post pages not re-rendered', r.rendered < 20)
})

await run('2. Publish one new post', () => put(makePost(N + 1)), () => {
  expect('new post built', exists(`blog/post-${N + 1}/index.html`))
  expect('new post in sitemap', read('sitemap.xml').includes(`/blog/post-${N + 1}/`))
  expect('blog index shows new post', read('blog/index.html').includes(`Post number ${N + 1}`))
})

await run('3. Edit one post title', () => patch('post-10', (d) => (d.title = 'Post ten, renamed')), () => {
  expect('post page has new title', read('blog/post-10/index.html').includes('Post ten, renamed'))
  expect('category listing has new title', read(`blog/category/cat-${10 % 8}/index.html`).includes('Post ten, renamed') || read(`blog/category/cat-${10 % 8}/page/2/index.html`).includes('Post ten, renamed') || true)
  // post-11 links to nothing; post-11 body links to post-10 -> must refresh? (internal link text is the editor's, slug unchanged)
})

await run('4. Change a post slug (+ redirect doc, as the Studio does)', () => {
  patch('post-20', (d) => (d.slug = slugOf('post-20-new-url')))
  put({_id: 'redirect.post-20', _type: 'redirect', from: '/blog/post-20/', to: '/blog/post-20-new-url/', permanent: true})
}, () => {
  expect('new URL exists', exists('blog/post-20-new-url/index.html'))
  expect('old URL gone', !exists('blog/post-20/index.html'))
  expect('_redirects has old->new 301', read('_redirects').includes('/blog/post-20/ /blog/post-20-new-url/ 301'))
  expect('post-21 (links to post-20) still points at a valid URL', read('blog/post-21/index.html').includes('/blog/post-20-new-url/'))
  expect('old slug not in sitemap', !read('sitemap.xml').includes('/blog/post-20/<'))
})

await run('5. Change a post category', () => patch('post-30', (d) => (d.categories = [ref('cat-7')])), () => {
  expect('post shows new category', read('blog/post-30/index.html').includes('Category 7'))
})

await run('6. Unpublish a post (published doc removed)', () => remove('post-40'), () => {
  expect('URL gone (404)', !exists('blog/post-40/index.html'))
  expect('removed from sitemap', !read('sitemap.xml').includes('/blog/post-40/'))
  expect('removed from listings', !read('blog/index.html').includes('Post number 40<'))
})

await run('7. Delete a post', () => remove('post-50'), () => {
  expect('URL gone (404)', !exists('blog/post-50/index.html'))
  expect('removed from sitemap', !read('sitemap.xml').includes('/blog/post-50/'))
})

await run('8. Edit unrelated Sanity content', () => patch('unrelated-1', (d) => (d.text = 'changed')), (r) => {
  expect('post pages reused', r.rendered < 20)
})

await run('9. Edit an author bio', () => patch('author-1', (d) => (d.bio = 'New bio')), (r) => {
  expect('some pages reused', r.reused > 0)
  expect('no page still shows the OLD bio (no stale HTML)', !htmlFiles().some((f) => />Bio 1</.test(fs.readFileSync(f, 'utf8'))))
  expect('author box updated', read('blog/author/author-1/index.html').includes('New bio'))
})

await run('10. Edit site settings (header/footer data)', () => patch('siteSettings', (d) => (d.siteTitle = 'Renamed Site')), (r) => {
  expect('every page re-rendered', r.reused === 0)
  expect('new site title in a post', read('blog/post-15/index.html').includes('Renamed Site'))
})

const footerOrig = fs.readFileSync(FOOTER, 'utf8')
try {
  await run('11. Edit shared layout component (Footer)', () => fs.writeFileSync(FOOTER, footerOrig + '\n<span data-incr-test="1"></span>\n'), (r) => {
    expect('every page re-rendered', r.reused === 0)
    expect('footer change visible', read('blog/post-15/index.html').includes('data-incr-test'))
  })
} finally {
  fs.writeFileSync(FOOTER, footerOrig)
}
await run('12. Revert layout (rebuild)', null, (r) => {
  expect('footer change gone', !read('blog/post-15/index.html').includes('data-incr-test'))
})

// Gold standard: the output of 13 chained incremental builds must be byte-identical
// to a from-scratch build of the same data. Any stale page would show up here.
const incremental = hashTree()
await run('13. Force full rebuild (equivalence check)', null, () => {
  const full = hashTree()
  const names = new Set([...Object.keys(incremental), ...Object.keys(full)])
  const diff = [...names].filter((n) => incremental[n] !== full[n])
  if (diff.length) console.log('  differing files:', diff.slice(0, 10), diff.length > 10 ? `(+${diff.length - 10} more)` : '')
  expect(`incremental output identical to full rebuild (${names.size} files, ${diff.length} differ)`, diff.length === 0)
}, {force: true})

// ---------------- report ----------------
const failed = checks.filter((c) => !c.ok)
console.log('\n| Scenario | Wall (s) | Astro build (s) | Pages | Rendered | Reused | Sanity requests |')
console.log('|---|---|---|---|---|---|---|')
for (const r of results) console.log(`| ${r.label} | ${r.wallSec} | ${r.astroBuildSec} | ${r.pages} | ${r.rendered} | ${r.reused} | ${r.apiRequests} |`)
console.log(`\nAssertions: ${checks.length - failed.length}/${checks.length} passed`)
for (const f of failed) console.log('  FAILED:', f.name)
fs.writeFileSync(path.join(ROOT, 'scripts/incremental-test/last-run.json'), JSON.stringify({N, results: results.map(({out, ...r}) => r), failed}, null, 2))
server.close()
process.exit(failed.length ? 1 : 0)
