#!/usr/bin/env node
// Verify #21 (reminder copy + "Waiting on" card placement) and the voice_sample
// edit field, on preview, as the test admin. Reads the bypass token +
// password from gitignored files (never printed). Prints PASS/FAIL per check.
//
// Requires: scripts/seed-waiting-brief.mjs already applied (slug below).
// Usage: node scripts/e2e-21-waiting-reminder.mjs

import { chromium } from 'playwright'
import { loginPage, BASE, shotDir } from './lib/preview-login.mjs'

const SLUG = 'test-waiting-reminder'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()

// 1. Bypass cookie + password login.
await loginPage(page)

// 2. Open the waiting brief's Conversations tab.
await page.goto(`${BASE}/projects/${SLUG}?tab=conversations`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

// --- Check A: reminder copy in the "Waiting on" card textarea ---
const reminderText = await page.locator('textarea[readonly]').first().inputValue().catch(() => '')
check('reminder copy = "Sam, your next conversation (#3) awaits:"',
  /^Sam, your next conversation \(#3\) awaits:/.test(reminderText),
  JSON.stringify(reminderText.split('\n')[0] || '(none)'))

// --- Check B: "Waiting on" card sits ABOVE "Agent setup" ---
const waitingY = await page.getByText(/Waiting on/i).first().boundingBox().then((b) => b?.y).catch(() => null)
const setupY = await page.getByText('Agent setup').first().boundingBox().then((b) => b?.y).catch(() => null)
check('"Waiting on" card is above "Agent setup"',
  waitingY != null && setupY != null && waitingY < setupY,
  `waitingY=${waitingY} setupY=${setupY}`)

await page.screenshot({ path: `${shotDir}/e2e-21-waiting.png` })

// --- Check C: voice_sample field in Agent setup -> Advanced ---
await page.getByText('Agent setup').first().click()
await page.waitForTimeout(800)
await page.getByText('Advanced', { exact: true }).first().click()
await page.waitForTimeout(600)
const hasVoice = await page.getByText('Voice sample (optional)').count()
check('"Voice sample (optional)" field present in Advanced', hasVoice > 0)
await page.screenshot({ path: `${shotDir}/e2e-21-voice.png`, fullPage: true })

// --- Check D: voice_sample persists across save + reload ---
const sample = `e2e voice ${Date.now()}`
const voiceBox = page.locator('textarea').filter({ hasNot: page.locator('[readonly]') })
// Target the voice textarea by its placeholder.
const voiceInput = page.getByPlaceholder("One paragraph showing how you'd text this person by hand.")
await voiceInput.fill(sample)
await page.getByRole('button', { name: /Save setup/i }).click()
await page.waitForTimeout(2500)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.getByText('Agent setup').first().click()
await page.waitForTimeout(600)
await page.getByText('Advanced', { exact: true }).first().click()
await page.waitForTimeout(500)
const persisted = await page.getByPlaceholder("One paragraph showing how you'd text this person by hand.").inputValue().catch(() => '')
check('voice_sample persists after Save + reload', persisted === sample, JSON.stringify(persisted))

await browser.close()
void voiceBox

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed; shots in .playwright-mcp/`)
process.exit(passed === results.length ? 0 : 1)
