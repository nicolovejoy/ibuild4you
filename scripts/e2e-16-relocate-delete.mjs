#!/usr/bin/env node
// Verify #16: destructive delete is gone from the dashboard card and relocated
// to the brief's Agent setup → Advanced → Danger zone (owner-only). Does NOT
// click delete — only asserts the control's presence/absence. Retries to wait
// out a fresh preview deploy.

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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()

await page.goto(`${BASE}/dashboard?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`, { waitUntil: 'domcontentloaded' })
await page.waitForURL(/\/(auth\/login|dashboard)/, { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(1500)
if (page.url().includes('/auth/login')) {
  await page.getByPlaceholder('you@example.com').fill(EMAIL)
  await page.getByPlaceholder('ABC123').fill(passcode)
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 12000 }).catch(() => {})
}
await page.waitForTimeout(1500)

async function checkDashboard() {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  // Wait for at least one card to render so counts are trustworthy.
  await page.locator('h3').first().waitFor({ timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const archiveCount = await page.getByRole('button', { name: /Archive/i }).count()
  const trashCount = await page.getByRole('button', { name: 'Delete brief' }).count()
  return { archiveCount, trashCount }
}

async function checkBriefAdvanced() {
  await page.goto(`${BASE}/projects/${SLUG}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  // Nav to the Conversations tab where the "Agent setup" card lives.
  const convTab = page.getByRole('button', { name: /Conversations/i }).first()
  if (await convTab.count()) { await convTab.click(); await page.waitForTimeout(1200) }
  // Expand "Agent setup"
  const setup = page.getByRole('button', { name: /Agent setup/i }).first()
  if (!(await setup.count())) return { reached: false }
  await setup.click()
  await page.waitForTimeout(600)
  // Expand "Advanced"
  const adv = page.getByText('Advanced', { exact: true }).first()
  if (await adv.count()) { await adv.click(); await page.waitForTimeout(500) }
  const deleteBtn = await page.getByRole('button', { name: 'Delete brief' }).count()
  const dangerZone = await page.getByText('Danger zone', { exact: true }).count()
  return { reached: true, deleteBtn, dangerZone }
}

let dash = null
let brief = null
for (let i = 0; i < 12; i++) {
  dash = await checkDashboard()
  brief = await checkBriefAdvanced()
  // New build: no card trash button + a Delete brief in the brief Advanced.
  if (dash.trashCount === 0 && brief.reached && brief.deleteBtn > 0) break
  console.log(`try ${i + 1}: dash=${JSON.stringify(dash)} brief=${JSON.stringify(brief)} — waiting for deploy…`)
  await page.waitForTimeout(15000)
}

await page.screenshot({ path: `${shotDir}/e2e-16-brief-advanced.png` })
console.log('dashboard:', JSON.stringify(dash))
console.log('brief advanced:', JSON.stringify(brief))

await browser.close()
const pass =
  dash && dash.trashCount === 0 && dash.archiveCount > 0 &&
  brief && brief.reached && brief.deleteBtn > 0 && brief.dangerZone > 0
console.log(pass
  ? '\n✅ PASS — card delete gone, Archive kept, Delete relocated to brief Advanced'
  : '\n❌ FAIL')
process.exit(pass ? 0 : 1)
