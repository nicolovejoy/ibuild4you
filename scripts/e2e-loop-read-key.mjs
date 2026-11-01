#!/usr/bin/env node
// Loop per-app read key (#237) — end to end against a real deploy (headless).
// Creates a throwaway app as the test admin, mints a read key, posts one
// feedback row, reads it back with the key, checks the admin panel shows
// "last used", then checks a wrong key, rotation and revocation. Cleans up the
// app, its key and its feedback rows in a finally block.
//
// The key is never printed. Errors are cut to their first line so headers
// (Bearer token, bypass token) never reach the output.
//
// Usage: op run --env-file=.env.preview.tpl -- node scripts/with-preview-env.mjs node scripts/e2e-loop-read-key.mjs
//        (E2E_BASE overrides the target, defaults to preview)
//
// Requires .ibuild4you-bypass, .test-admin-password, a preview .env.preview.local
// (for initFixtureDb's write guard), `npm i --no-save playwright`, and
// LOOP_SENDER_TAG_SECRET set on Vercel Preview (else step 3 gets 503 and this
// script says so).

import { initFixtureDb } from './fixtures/db.mjs'
import { readToken, launchLoggedIn, BASE } from './lib/preview-login.mjs'

const SLUG = `e2e-read-key-${Date.now()}`
const bypassToken = readToken()
const { db } = initFixtureDb({ requireWrite: true })
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}
const firstLine = (e) => String(e?.message ?? e).split('\n')[0]

let browser
let auth = null
let key = null

// Admin API call through the logged-in page, with the captured Bearer.
const admin = async (method, path, data) => {
  try {
    const res = await browser.contexts()[0].request.fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      data: data ? JSON.stringify(data) : undefined,
    })
    const body = await res.json().catch(() => ({}))
    return { status: res.status(), body }
  } catch (e) {
    throw new Error(`${method} ${path}: ${firstLine(e)}`)
  }
}

// Plain fetch for the host-facing read endpoint, as a host app would call it.
const read = async (k) => {
  const res = await fetch(`${BASE}/api/feedback/read?app=${SLUG}`, {
    headers: { 'x-vercel-protection-bypass': bypassToken, authorization: `Bearer ${k}` },
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, text, json }
}

try {
  const launched = await launchLoggedIn({ path: '/admin/apps' })
  browser = launched.browser
  const page = launched.page

  // Capture the admin Bearer from a page request to our own API.
  const reqP = page.waitForRequest((r) => r.url().includes('/api/admin/apps') && !!r.headers()['authorization'], { timeout: 20_000 })
  await page.goto(`${BASE}/admin/apps`, { waitUntil: 'networkidle' })
  auth = (await reqP.catch(() => null))?.headers()['authorization'] ?? null
  if (!auth) throw new Error('could not capture the admin Bearer token')

  // 1. Create the app
  const created = await admin('POST', '/api/admin/apps', { slug: SLUG, name: `E2E Read Key ${SLUG.slice(-6)}` })
  check('1. create app -> 201', created.status === 201, `got ${created.status}`)
  if (created.status !== 201) throw new Error('cannot continue without the app')

  // 2. Mint the key
  const minted = await admin('POST', `/api/admin/apps/${SLUG}/read-key`)
  key = minted.body?.key ?? null
  check('2. mint read key -> 201, lrk_ + 22 chars', minted.status === 201 && /^lrk_[A-Za-z0-9_-]{22}$/.test(key ?? ''), `got ${minted.status}`)
  if (!key) throw new Error('cannot continue without a key')

  // 3. One feedback row under the slug
  const fb = await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vercel-protection-bypass': bypassToken },
    body: JSON.stringify({
      projectId: SLUG,
      type: 'idea',
      body: 'e2e read key check\nsecond line',
      submitterEmail: 'e2e-read@example.com',
      pageUrl: 'https://example.com/e2e',
      userAgent: IPHONE_UA,
      viewport: '390x844',
      website: '',
      _ts: Date.now() - 5_000,
    }),
  })
  const fbBody = await fb.json().catch(() => ({}))
  check('3. POST /api/feedback -> 201', fb.status === 201, `got ${fb.status}`)
  if (fb.status !== 201) throw new Error('cannot continue without the feedback row')

  // 4. Read it back with the key
  const r = await read(key)
  if (r.status === 503) {
    check('4. read with key -> 200', false, '503 not_configured: LOOP_SENDER_TAG_SECRET is not set on this deploy')
    throw new Error('LOOP_SENDER_TAG_SECRET unset on the target deploy')
  }
  const item = r.json?.items?.[0]
  check('4a. read with key -> 200', r.status === 200, `got ${r.status}`)
  check('4b. one item', r.json?.items?.length === 1, `got ${r.json?.items?.length}`)
  check('4c. summary is the first line', item?.summary === 'e2e read key check', `got ${JSON.stringify(item?.summary)}`)
  check('4d. platform ios', item?.platform === 'ios', `got ${item?.platform}`)
  check('4e. sender tag shape', /^Sender [0-9a-f]{4}$/.test(item?.sender ?? ''), `got ${item?.sender}`)
  check('4f. loop_url deep link', typeof item?.loop_url === 'string' && item.loop_url.endsWith(`/admin/apps/${SLUG}?id=${item?.id ?? fbBody.id}`), `got ${item?.loop_url}`)
  check('4g. next_cursor null', r.json?.next_cursor === null, `got ${r.json?.next_cursor}`)
  check('4h. no @ anywhere in the body', !r.text.includes('@'))

  // 5. Admin page shows the panel and a "last used" status. The touch runs
  //    after the response, so give it a few reloads.
  let lastUsed = false
  for (let i = 0; i < 5 && !lastUsed; i++) {
    // 'load' rather than 'networkidle': the per-app page keeps a connection
    // open once it has feedback, so it never goes idle and the goto times out.
    await page.goto(`${BASE}/admin/apps/${SLUG}`, { waitUntil: 'load' })
    await page.getByRole('heading', { name: 'Read key' }).waitFor({ timeout: 15_000 }).catch(() => {})
    await page.getByText('last used').first().waitFor({ timeout: 4_000 }).catch(() => {})
    lastUsed = (await page.getByText('last used').count()) > 0
  }
  check('5a. admin page shows the Read key heading', (await page.getByRole('heading', { name: 'Read key' }).count()) > 0)
  check('5b. admin page shows "last used"', lastUsed)

  // 6. Wrong key
  const wrong = await read('lrk_' + 'A'.repeat(22))
  check('6. wrong key -> 404 Not found', wrong.status === 404 && wrong.json?.error === 'Not found', `got ${wrong.status}`)

  // 7. Rotate
  const oldKey = key
  const rotated = await admin('POST', `/api/admin/apps/${SLUG}/read-key`)
  key = rotated.body?.key ?? null
  check('7a. rotate -> 201 with a new key', rotated.status === 201 && /^lrk_[A-Za-z0-9_-]{22}$/.test(key ?? '') && key !== oldKey, `got ${rotated.status}`)
  check('7b. old key -> 404', (await read(oldKey)).status === 404)
  check('7c. new key -> 200', key !== null && (await read(key)).status === 200)

  // 8. Revoke
  const revoked = await admin('DELETE', `/api/admin/apps/${SLUG}/read-key`)
  check('8a. revoke -> 200', revoked.status === 200, `got ${revoked.status}`)
  check('8b. revoked key -> 404', key !== null && (await read(key)).status === 404)
} catch (e) {
  check('script ran to completion', false, firstLine(e))
} finally {
  if (browser) await browser.close().catch(() => {})
  try {
    // 9. Cleanup: feedback rows, the key doc, the app.
    const rows = await db.collection('feedback').where('project_id', '==', SLUG).get()
    for (const d of rows.docs) await d.ref.delete()
    await db.collection('loop_read_keys').doc(SLUG).delete()
    await db.collection('apps').doc(SLUG).delete()
    console.log(`cleaned up app ${SLUG}, its read key and ${rows.size} feedback row(s)`)
  } catch (e) {
    check('cleanup', false, firstLine(e))
  }
}

process.exit(failed ? 1 : 0)
