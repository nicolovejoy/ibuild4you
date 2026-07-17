#!/usr/bin/env node
// Verify #12: builder can correct the originator's email from the share modal.
// Re-keys membership + approved_emails (PATCH /share with new_email). Since
// Garm PR D there is no passcode to reissue — the response must NOT carry one.
// Edits to a marker address, asserts the response, then RESTORES the original
// email so the preview fixture isn't left mutated. Retries to wait out a deploy.

import { chromium } from 'playwright'
import { loginPage, BASE, shotDir } from './lib/preview-login.mjs'

const SLUG = process.env.E2E_SLUG || 'test-cast-cafe'
const MARKER = 'rekey-test@example.com'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
await loginPage(page)

async function openShareModal() {
  await page.goto(`${BASE}/projects/${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const shareBtn = page.getByRole('button', { name: /Mara/i }).first()
  if (!(await shareBtn.count())) return false
  await shareBtn.click()
  await page.waitForTimeout(1200)
  return true
}

async function sharedEmailText() {
  const el = page.getByText(/^Shared with /).first()
  if (!(await el.count())) return null
  return (await el.textContent()).replace('Shared with ', '').trim()
}

// Submit a new email through the Edit-email control; return the PATCH response body.
async function editEmailTo(next) {
  await page.getByRole('button', { name: 'Edit email', exact: true }).click()
  await page.waitForTimeout(300)
  const input = page.getByPlaceholder('maker@email.com').last()
  await input.fill(next)
  const respP = page
    .waitForResponse((r) => /\/api\/projects\/share$/.test(r.url()) && r.request().method() === 'PATCH', { timeout: 12000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const resp = await respP
  const body = resp ? await resp.json().catch(() => null) : null
  await page.waitForTimeout(2500)
  return { status: resp ? resp.status() : null, body }
}

// Wait out the deploy: the "Edit email" control only exists in the new build.
let ready = false
for (let i = 0; i < 12; i++) {
  if (!(await openShareModal())) {
    console.log(`try ${i + 1}: share modal not found — retrying`)
    await page.waitForTimeout(15000)
    continue
  }
  if ((await page.getByRole('button', { name: 'Edit email', exact: true }).count()) > 0) {
    ready = true
    break
  }
  console.log(`try ${i + 1}: no "Edit email" control yet — waiting for deploy…`)
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(15000)
}

if (!ready) {
  await page.screenshot({ path: `${shotDir}/e2e-12-notready.png` })
  console.log('\n❌ FAIL — "Edit email" control never appeared')
  await browser.close()
  process.exit(1)
}

const origEmail = await sharedEmailText()
console.log('original email:', origEmail)

// 1. Edit to the marker address.
const r1 = await editEmailTo(MARKER)
console.log('PATCH status:', r1.status, 'body:', JSON.stringify(r1.body))
const afterEmail = await sharedEmailText()
console.log('after email:', afterEmail)
await page.screenshot({ path: `${shotDir}/e2e-12-edited.png` })

const emailChanged = r1.body?.email === MARKER && afterEmail === MARKER
// PR D: the re-key response must NOT reissue a passcode.
const noPasscode = r1.body?.passcode === undefined

// 2. Restore the original email so the fixture is left as we found it.
let restored = false
if (origEmail && origEmail !== MARKER) {
  const r2 = await editEmailTo(origEmail)
  restored = r2.body?.email === origEmail
  console.log('restore status:', r2.status, '-> email:', r2.body?.email)
}

await browser.close()
const pass = r1.status === 200 && emailChanged && noPasscode
console.log('\nemailChanged:', emailChanged, '| noPasscode:', noPasscode, '| restored:', restored)
console.log(pass ? '\n✅ PASS — email re-keyed, no passcode in play' : '\n❌ FAIL')
process.exit(pass ? 0 : 1)
