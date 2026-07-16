#!/usr/bin/env node
// Verify #19 Phase 4: the share modal for an ALREADY-shared maker shows an
// access-only view (link + passcode + "Maker access" title), NOT the first-time
// invite copy. Retries to wait out a fresh preview deploy.

import { chromium } from 'playwright'
import { loginPage, BASE, shotDir } from './lib/preview-login.mjs'

const SLUG = process.env.E2E_SLUG || 'test-cast-cafe'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()

await loginPage(page)

async function checkOnce() {
  await page.goto(`${BASE}/projects/${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  // Header share button shows the maker's name ("Mara O") on a shared brief.
  const shareBtn = page.getByRole('button', { name: /Mara/i }).first()
  if (!(await shareBtn.count())) return null
  await shareBtn.click()
  await page.waitForTimeout(1200)
  const title = (await page.getByText('Maker access', { exact: true }).count()) > 0
  const hasInviteMsg = (await page.getByText('Invite message', { exact: true }).count()) > 0
  const hasPasscode = (await page.getByText('Maker passcode', { exact: true }).count()) > 0
  const hasPointer = (await page.getByText(/Next round/).count()) > 0
  return { title, hasInviteMsg, hasPasscode, hasPointer }
}

let result = null
for (let i = 0; i < 12; i++) {
  result = await checkOnce()
  // New build = "Maker access" title and NO invite-message block.
  if (result && result.title && !result.hasInviteMsg) break
  console.log(`try ${i + 1}: ${JSON.stringify(result)} — waiting for deploy…`)
  await page.waitForTimeout(15000)
}

await page.screenshot({ path: `${shotDir}/p4-maker-access.png` })
console.log('FINAL:', JSON.stringify(result, null, 2))
await browser.close()
const pass = result && result.title && !result.hasInviteMsg && result.hasPasscode && result.hasPointer
console.log(pass ? '\n✅ PASS — access-only view, no first-time invite copy' : '\n❌ FAIL')
process.exit(pass ? 0 : 1)
