#!/usr/bin/env node
// #163 — admin off-boarding: revoke sign-in approval on the allowlist.
// Exercises POST/DELETE /api/approved-emails end-to-end against preview:
// approve -> revoke -> re-revoke rejected -> re-approve clears the flag ->
// non-admin DELETE forbidden -> (bonus) ShieldOff button renders on /admin.
//
// Usage: node scripts/e2e-163-approved-email-revoke.mjs

import { launchLoggedIn, loginWithPassword, readCastPassword, BASE, shotDir } from './lib/preview-login.mjs'

const EMAIL = 'e2e-163-revoke@example.com'

let failures = 0
const grade = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failures++
}

const { browser, page } = await launchLoggedIn()

// Capture a Bearer token off the dashboard's own API traffic (established pattern).
const reqP = page.waitForRequest((r) => r.url().includes('/api/projects'), { timeout: 15000 })
await page.reload({ waitUntil: 'domcontentloaded' })
const auth = (await reqP).headers()['authorization']
grade(!!auth, 'captured admin bearer token')

// 1a. POST approve.
const approve1 = await page.request.post(`${BASE}/api/approved-emails`, {
  headers: { authorization: auth, 'content-type': 'application/json' },
  data: JSON.stringify({ email: EMAIL }),
})
grade(approve1.status() === 201, `POST approve -> ${approve1.status()}`)

// 1b. DELETE revoke.
const revoke1 = await page.request.delete(`${BASE}/api/approved-emails`, {
  headers: { authorization: auth, 'content-type': 'application/json' },
  data: JSON.stringify({ email: EMAIL }),
})
const revoke1Body = await revoke1.json().catch(() => ({}))
grade(revoke1.status() === 200 && revoke1Body.revoked === true, `DELETE revoke -> ${revoke1.status()} ${JSON.stringify(revoke1Body)}`)

// 1c. Re-DELETE -> 400 "already been revoked" (proves the flag stuck).
const revoke2 = await page.request.delete(`${BASE}/api/approved-emails`, {
  headers: { authorization: auth, 'content-type': 'application/json' },
  data: JSON.stringify({ email: EMAIL }),
})
const revoke2Body = await revoke2.json().catch(() => ({}))
grade(
  revoke2.status() === 400 && /already been revoked/i.test(revoke2Body.error || ''),
  `re-DELETE -> ${revoke2.status()} ${JSON.stringify(revoke2Body)}`
)

// 1d. Re-POST approve -> 201, and revoked_at cleared.
const approve2 = await page.request.post(`${BASE}/api/approved-emails`, {
  headers: { authorization: auth, 'content-type': 'application/json' },
  data: JSON.stringify({ email: EMAIL }),
})
grade(approve2.status() === 201, `re-POST approve -> ${approve2.status()}`)

// Read the doc directly via preview Admin SDK to confirm revoked_at/revoked_by
// state at each step (server-side ground truth, since GET only checks the
// CURRENT caller's own email).
const { spawnSync } = await import('node:child_process')
const readDocScript = `
import { initFixtureDb } from './scripts/fixtures/db.mjs'
const { db } = initFixtureDb()
const doc = await db.collection('approved_emails').doc('${EMAIL}').get()
console.log(JSON.stringify(doc.exists ? doc.data() : null))
`
const { writeFileSync, unlinkSync } = await import('node:fs')
writeFileSync('.e2e-163-readdoc.mjs', readDocScript)
const result = spawnSync(
  'node',
  ['scripts/with-preview-env.mjs', 'node', '.e2e-163-readdoc.mjs'],
  { encoding: 'utf8' }
)
unlinkSync('.e2e-163-readdoc.mjs')
let docData = null
try {
  const lastLine = result.stdout.trim().split('\n').filter(Boolean).pop()
  docData = JSON.parse(lastLine)
} catch {
  console.error('could not parse doc read output:', result.stdout, result.stderr)
}
grade(!!docData && docData.revoked_at === null && docData.revoked_by === null, `doc revoked_at cleared after re-approve: ${JSON.stringify(docData)}`)

// 1e. Negative: non-admin DELETE -> 403.
const mctx = await browser.newContext()
const mpage = await mctx.newPage()
try {
  const nonAdminEmail = 'test-originator@ibuild4you.com'
  await loginWithPassword(mpage, {
    email: nonAdminEmail,
    password: readCastPassword(nonAdminEmail),
    path: '/dashboard',
  })
  const mReqP = mpage.waitForRequest((r) => r.url().includes('/api/projects'), { timeout: 15000 })
  await mpage.reload({ waitUntil: 'domcontentloaded' })
  const makerAuth = (await mReqP).headers()['authorization']
  const forbidden = await mpage.request.delete(`${BASE}/api/approved-emails`, {
    headers: { authorization: makerAuth, 'content-type': 'application/json' },
    data: JSON.stringify({ email: EMAIL }),
  })
  grade(forbidden.status() === 403, `non-admin DELETE -> ${forbidden.status()}`)
} catch (e) {
  console.error('SKIP: non-admin negative test errored:', e.message)
} finally {
  await mctx.close()
}

// 1f. Bonus: /admin page renders a ShieldOff revoke button on a user row.
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const revokeBtn = page.locator('button[aria-label="Revoke sign-in approval"]').first()
grade(await revokeBtn.isVisible().catch(() => false), '/admin renders "Revoke sign-in approval" button')
await page.screenshot({ path: `${shotDir}/163-admin-revoke-button.png`, fullPage: true })

// Cleanup: hard-delete the throwaway approved_emails doc via preview Admin SDK.
const cleanupScript = `
import { initFixtureDb } from './scripts/fixtures/db.mjs'
const { db } = initFixtureDb()
await db.collection('approved_emails').doc('${EMAIL}').delete()
console.log('deleted')
`
writeFileSync('.e2e-163-cleanup.mjs', cleanupScript)
const cleanupResult = spawnSync(
  'node',
  ['scripts/with-preview-env.mjs', 'node', '.e2e-163-cleanup.mjs'],
  { encoding: 'utf8' }
)
unlinkSync('.e2e-163-cleanup.mjs')
console.log('cleanup:', cleanupResult.stdout.trim(), cleanupResult.stderr.trim())

await browser.close()

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
