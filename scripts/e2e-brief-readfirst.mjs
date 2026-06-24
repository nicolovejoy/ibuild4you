#!/usr/bin/env node
// Verify the read-first brief editor on preview: read view by default with an
// "Edit brief" button; entering edit shows the editor + Save + Cancel; Cancel
// returns to read view. Retries to wait out a fresh deploy.

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const SLUG = process.env.E2E_SLUG || 'test-cast-cafe'
const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcode = readFileSync(`${ROOT}.test-admin-passcode`, 'utf8').trim()
const shotDir = `${ROOT}.playwright-mcp`

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()

await page.goto(`${BASE}/dashboard?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
if (page.url().includes('/auth/login')) {
  await page.getByPlaceholder('you@example.com').fill('test@ibuild4you.com')
  await page.getByPlaceholder('ABC123').fill(passcode)
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  await page.waitForURL(/dashboard/, { timeout: 12000 }).catch(() => {})
}
await page.waitForTimeout(1000)

async function check() {
  await page.goto(`${BASE}/projects/${SLUG}?tab=brief`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const r = {}
  // Read view: "Edit brief" present, NO Save/Structured controls yet.
  r.editBtn = (await page.getByRole('button', { name: /Edit brief/ }).count()) > 0
  r.readNoSave = (await page.getByRole('button', { name: 'Save brief' }).count()) === 0
  r.readNoToggle = (await page.getByRole('button', { name: 'Structured', exact: true }).count()) === 0
  // brief content visible as text (the seeded problem)
  r.readShowsContent = (await page.getByText(/Fremont area of Seattle/).count()) > 0
  return r
}

let r = null
for (let i = 0; i < 12; i++) {
  r = await check()
  if (r && r.editBtn && r.readNoSave) break
  console.log(`try ${i + 1}: ${JSON.stringify(r)} — waiting for deploy…`)
  await page.waitForTimeout(15000)
}
await page.screenshot({ path: `${shotDir}/bf-read.png` })

// Enter edit mode.
let edit = {}
await page.getByRole('button', { name: /Edit brief/ }).first().click()
await page.waitForTimeout(800)
edit.hasToggle = (await page.getByRole('button', { name: 'Structured', exact: true }).count()) > 0
edit.hasSave = (await page.getByRole('button', { name: 'Save brief' }).count()) > 0
edit.hasCancel = (await page.getByRole('button', { name: /Cancel/ }).count()) > 0
await page.screenshot({ path: `${shotDir}/bf-edit.png` })

// Cancel returns to read view.
await page.getByRole('button', { name: /Cancel/ }).first().click()
await page.waitForTimeout(600)
const backToRead = (await page.getByRole('button', { name: /Edit brief/ }).count()) > 0 &&
  (await page.getByRole('button', { name: 'Save brief' }).count()) === 0

console.log('RESULTS:', JSON.stringify({ ...r, ...edit, backToRead }, null, 2))
await browser.close()
const pass = r && r.editBtn && r.readNoSave && r.readNoToggle && r.readShowsContent &&
  edit.hasToggle && edit.hasSave && edit.hasCancel && backToRead
console.log(pass ? '\n✅ PASS' : '\n❌ FAIL')
process.exit(pass ? 0 : 1)
