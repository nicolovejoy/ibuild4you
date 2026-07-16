#!/usr/bin/env node
// #105 verification: admin Brief-doctor on preview. Seeds a session (+1 message)
// into the synthetic test-admin project via Admin SDK, then drives the UI:
// admin login → /admin/briefs → search → list conversations → run the additive
// add_synthetic_message op, asserting the message count increments. Only the
// non-destructive op is exercised against preview data.
//
// Run under the preview env wrapper (provides FIREBASE_SERVICE_ACCOUNT):
//   node scripts/with-preview-env.mjs node scripts/e2e-105-brief-doctor.mjs
// Files expected (gitignored): .ibuild4you-bypass, .test-admin-password

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { loginPage, BASE, shotDir } from './lib/preview-login.mjs'
import { chromium } from 'playwright'

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (run via scripts/with-preview-env.mjs)')
  process.exit(1)
}
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

// 1. Seed a fresh session (+1 message) into the test-admin project.
const projSnap = await db.collection('projects').where('slug', '==', 'test-admin-access').limit(1).get()
if (projSnap.empty) {
  console.error('test-admin-access project not found on this env (run seed-test-admin first)')
  process.exit(1)
}
const projectId = projSnap.docs[0].id
const now = new Date().toISOString()
const sessionRef = await db.collection('sessions').add({
  project_id: projectId,
  status: 'active',
  created_at: now,
  updated_at: now,
  session_mode: 'discover',
})
await db.collection('messages').add({
  session_id: sessionRef.id,
  role: 'agent',
  content: 'e2e-105 seed message',
  created_at: now,
  updated_at: now,
})
console.log('seeded session', sessionRef.id, 'in project', projectId)

// 2. Drive the UI.
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
await loginPage(page)

await page.goto(`${BASE}/admin/briefs`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.getByPlaceholder(/Search a brief/i).fill('Test Admin Access')
await page.waitForTimeout(800)
await page.locator('button', { hasText: 'Test Admin Access' }).first().click()

await page.waitForSelector('text=/conversations/', { timeout: 10000 })
await page.waitForTimeout(800)

const countText = () => page.locator('p', { hasText: /messages/ }).first().textContent()
const before = await countText()
console.log('before:', (before || '').trim())

await page.getByRole('button', { name: 'Add test msg' }).first().click()
await page.getByPlaceholder(/Synthetic message text/i).fill('e2e-105 synthetic ping')
const respP = page
  .waitForResponse((r) => /\/api\/admin\/sessions$/.test(r.url()) && r.request().method() === 'POST', { timeout: 12000 })
  .catch(() => null)
await page.getByRole('button', { name: 'Add', exact: true }).click()
const resp = await respP
if (resp) console.log('POST /api/admin/sessions:', resp.status())
await page.waitForTimeout(1500)

const after = await countText()
console.log('after:', (after || '').trim())
await page.screenshot({ path: `${shotDir}/e2e-105.png` })

// 3. Cleanup: archive the seeded session + delete the two synthetic messages so
// preview data doesn't accrete. (Admin SDK; non-UI.)
const seededMsgs = await db.collection('messages').where('session_id', '==', sessionRef.id).get()
const batch = db.batch()
seededMsgs.docs.forEach((d) => batch.delete(d.ref))
batch.delete(sessionRef)
await batch.commit()
console.log('cleaned up seeded session + messages')

const num = (t) => parseInt((t || '').match(/(\d+) messages/)?.[1] ?? '-1', 10)
const ok = resp?.status() === 200 && num(after) === num(before) + 1
await browser.close()
console.log(ok ? 'PASS: synthetic message incremented the count' : 'FAIL')
process.exit(ok ? 0 : 1)
