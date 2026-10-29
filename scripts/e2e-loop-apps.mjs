#!/usr/bin/env node
// Loop apps Phase A, Task 6 — admin UI + feedback ingestion end-to-end against
// a real deploy (headless). Logs in as the test admin, creates an app in the
// New app form at /admin/apps, POSTs one feedback to /api/feedback under that
// slug, opens /admin/apps/<slug> and asserts the row is listed, deep-links with
// ?id=, then POSTs under an unknown slug ("Tideline") and expects 404.
// Cleans up the app + its feedback rows (via the preview-guarded fixture db) in
// a finally block.
//
// Usage: op run --env-file=.env.preview.tpl -- node scripts/with-preview-env.mjs node scripts/e2e-loop-apps.mjs
//        (E2E_BASE overrides the target, defaults to preview)
//
// Requires .ibuild4you-bypass, .test-admin-password, a preview .env.preview.local
// (for initFixtureDb's write guard) and `npm i --no-save playwright`.

import { initFixtureDb } from './fixtures/db.mjs'
import { readToken, launchLoggedIn, BASE } from './lib/preview-login.mjs'

const SLUG = `e2e-loop-app-${Date.now()}`
const NAME = `E2E Loop App ${SLUG.slice(-6)}`
const bypassToken = readToken()
const { db } = initFixtureDb({ requireWrite: true })

let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

async function postFeedback(projectId) {
  const res = await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vercel-protection-bypass': bypassToken },
    body: JSON.stringify({
      projectId,
      type: 'idea',
      body: 'e2e loop apps check — safe to ignore',
      pageUrl: 'https://example.com/e2e',
      userAgent: 'e2e-loop-apps/1.0',
      viewport: '1200x900',
      website: '',
      _ts: Date.now() - 5_000,
    }),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

let browser
const feedbackIds = []
try {
  const launched = await launchLoggedIn({ path: '/admin/apps' })
  browser = launched.browser
  const page = launched.page
  await page.goto(`${BASE}/admin/apps`, { waitUntil: 'networkidle' })

  // 1. New app form -> row appears
  await page.getByLabel('Slug', { exact: true }).fill(SLUG)
  await page.getByLabel('Name', { exact: true }).fill(NAME)
  await page.getByRole('button', { name: 'Create app' }).click()
  const row = page.locator(`tr[data-app-slug="${SLUG}"]`)
  await row.waitFor({ timeout: 15_000 }).catch(() => {})
  check('New app: row appears in the list', (await row.count()) === 1)

  // 1b. A bad slug is rejected inline, not normalised
  await page.getByLabel('Slug', { exact: true }).fill('Bad Slug-')
  await page.getByLabel('Name', { exact: true }).fill('x')
  await page.getByRole('button', { name: 'Create app' }).click()
  await page.getByRole('alert').waitFor({ timeout: 10_000 }).catch(() => {})
  check('Bad slug shows an inline error', (await page.getByRole('alert').count()) > 0)

  // 2. Feedback under the slug -> 201
  const ok = await postFeedback(SLUG)
  check('POST /api/feedback with the new slug -> 201', ok.status === 201, `got ${ok.status}`)
  if (ok.data.id) feedbackIds.push(ok.data.id)

  // 3. App page lists the row, and ?id= deep link highlights it
  await page.goto(`${BASE}/admin/apps/${SLUG}`, { waitUntil: 'networkidle' })
  await page.getByText('e2e loop apps check').first().waitFor({ timeout: 15_000 }).catch(() => {})
  check('App page lists the feedback row', (await page.getByText('e2e loop apps check').count()) >= 1)

  if (ok.data.id) {
    await page.goto(`${BASE}/admin/apps/${SLUG}?id=${ok.data.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const ringed = await page.locator('.ring-2').count()
    check('?id= deep link highlights the item', ringed >= 1)
  }

  // 4. Unknown slug -> 404
  const unknown = await postFeedback('Tideline')
  check('POST with unknown slug "Tideline" -> 404', unknown.status === 404, `got ${unknown.status}`)
} finally {
  if (browser) await browser.close()
  // Cleanup: every feedback row for the app, then the app.
  const rows = await db.collection('feedback').where('project_id', '==', SLUG).get()
  for (const d of rows.docs) await d.ref.delete()
  for (const id of feedbackIds) await db.collection('feedback').doc(id).delete().catch(() => {})
  await db.collection('apps').doc(SLUG).delete()
  console.log(`cleaned up app ${SLUG} + ${rows.size} feedback row(s)`)
}

process.exit(failed ? 1 : 0)
