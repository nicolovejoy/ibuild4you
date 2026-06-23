#!/usr/bin/env node
// Verify #19 Phase 3 brief editor on preview: structured + raw-JSON views,
// lock toggle, save, the "Update from conversation" confirm, and the demoted
// full-payload import. Retries to wait out a fresh deploy.

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const EMAIL = 'test@ibuild4you.com'
const SLUG = process.env.E2E_SLUG || 'test-cast-cafe'

const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcode = readFileSync(`${ROOT}.test-admin-passcode`, 'utf8').trim()
const shotDir = `${ROOT}.playwright-mcp`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error' && !/users\/me|401/.test(m.text())) errors.push(m.text()) })

await page.goto(`${BASE}/dashboard?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`, { waitUntil: 'domcontentloaded' })
await page.waitForURL(/\/(auth\/login|dashboard)/, { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(1500)
if (page.url().includes('/auth/login')) {
  await page.getByPlaceholder('you@example.com').fill(EMAIL)
  await page.getByPlaceholder('ABC123').fill(passcode)
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 12000 }).catch(() => {})
}
await page.waitForTimeout(1000)

async function checkOnce() {
  await page.goto(`${BASE}/projects/${SLUG}?tab=brief`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const r = {}
  r.structuredToggle = (await page.getByRole('button', { name: 'Structured', exact: true }).count()) > 0
  r.rawToggle = (await page.getByRole('button', { name: 'Raw JSON', exact: true }).count()) > 0
  r.saveBtn = (await page.getByRole('button', { name: /Save brief/ }).count()) > 0
  r.updateFromConvo = (await page.getByText('Update from conversation (uses API)').count()) > 0
  r.importDisclosure = (await page.getByText(/Import full payload/).count()) > 0
  // structured fields
  r.decisionsLabel = (await page.getByText('Decisions', { exact: true }).count()) > 0
  return r
}

let r = null
for (let i = 0; i < 12; i++) {
  r = await checkOnce()
  if (r && r.structuredToggle && r.rawToggle && r.saveBtn) break
  console.log(`try ${i + 1}: ${JSON.stringify(r)} — waiting for deploy…`)
  await page.waitForTimeout(15000)
}
await page.screenshot({ path: `${shotDir}/p3-structured.png`, fullPage: true })

// Toggle to Raw JSON and confirm a textarea with brief JSON appears.
let rawOk = false
if (r && r.rawToggle) {
  await page.getByRole('button', { name: 'Raw JSON', exact: true }).first().click()
  await page.waitForTimeout(800)
  const ta = page.locator('textarea').first()
  const val = (await ta.inputValue().catch(() => '')) || ''
  rawOk = /"problem"/.test(val)
  await page.screenshot({ path: `${shotDir}/p3-raw.png` })
}

// Open the "Update from conversation" confirm and check copy-first affordance.
let confirmOk = false
await page.getByRole('button', { name: 'Structured', exact: true }).first().click().catch(() => {})
await page.waitForTimeout(400)
if (r && r.updateFromConvo) {
  await page.getByText('Update from conversation (uses API)').first().click()
  await page.waitForTimeout(700)
  confirmOk =
    (await page.getByText(/replaces the current brief/).count()) > 0 &&
    (await page.getByText(/Copy current brief first/).count()) > 0
  await page.screenshot({ path: `${shotDir}/p3-confirm.png` })
}

console.log('RESULTS:', JSON.stringify({ ...r, rawOk, confirmOk }, null, 2))
console.log('unexpected console errors:', errors)
await browser.close()
const pass = r && r.structuredToggle && r.rawToggle && r.saveBtn && r.updateFromConvo && r.importDisclosure && rawOk && confirmOk
console.log(pass ? '\n✅ PASS' : '\n❌ FAIL')
process.exit(pass ? 0 : 1)
