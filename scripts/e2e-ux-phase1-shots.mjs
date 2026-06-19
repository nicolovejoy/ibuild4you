#!/usr/bin/env node
// UX scrub Phase 1 visual check — log in as the test admin and screenshot the
// cast brief's Setup and Brief tabs. Confirms: one config surface (no duplicate
// "Agent setup" + dispatch card both editing the same fields), auto-reminders in
// the dispatch Edit details, github_repo gone from Setup and living under
// "Brief settings" on the Brief tab.
//
// Usage: node scripts/e2e-ux-phase1-shots.mjs

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const SLUG = 'test-cast-cafe'
const EMAIL = 'test@ibuild4you.com'

const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcode = readFileSync(`${ROOT}.test-admin-passcode`, 'utf8').trim()
const shotDir = `${ROOT}.playwright-mcp`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()

await page.goto(
  `${BASE}/projects/${SLUG}?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`,
  { waitUntil: 'domcontentloaded' },
)
await page.waitForTimeout(1500)
if (page.url().includes('/auth/login')) {
  await page.getByPlaceholder('you@example.com').fill(EMAIL)
  await page.getByPlaceholder('ABC123').fill(passcode)
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  await page.waitForTimeout(2500)
}

for (const tab of ['setup', 'brief']) {
  await page.goto(`${BASE}/projects/${SLUG}?tab=${tab}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  // Expand any "Edit details" / "Brief settings" disclosures so they're visible.
  for (const label of ['Edit details', 'Brief settings']) {
    const btn = page.getByText(label, { exact: false }).first()
    if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(600) }
  }
  await page.screenshot({ path: `${shotDir}/ux-phase1-${tab}.png`, fullPage: true })
  console.log(`shot: ux-phase1-${tab}.png`)
}

await browser.close()
console.log('done; shots in .playwright-mcp/')
