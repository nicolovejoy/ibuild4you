#!/usr/bin/env node
// #72 verification — the cast project has seeded Loop feedback rows (blank menu
// on mobile, pastry-gallery idea, broken contact form). Log in as the maker and
// ask Sam to "walk me through the site." PASS = Sam references the actual
// reported issues (menu / contact form / gallery) rather than confabulating, and
// still admits it can't see the live screen. FAIL = generic made-up walkthrough.
//
// Prereq: node scripts/with-preview-env.mjs node scripts/seed-72-feedback.mjs --apply
// Usage:  node scripts/e2e-72-feedback-chat.mjs

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const BRIEF_PATH = '/projects/test-cast-cafe'
const EMAIL = 'test-originator@ibuild4you.com'
const MESSAGE =
  "Can you walk me through what's going on with the site so far — what have people been running into?"

const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcodes = JSON.parse(readFileSync(`${ROOT}.test-cast-passcodes.json`, 'utf8'))
const shotDir = `${ROOT}.playwright-mcp`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const page = await ctx.newPage()

await page.goto(
  `${BASE}${BRIEF_PATH}?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`,
  { waitUntil: 'domcontentloaded' },
)
await page.waitForTimeout(1500)
if (page.url().includes('/auth/login')) {
  await page.getByPlaceholder('you@example.com').fill(EMAIL)
  await page.getByPlaceholder('ABC123').fill(passcodes[EMAIL])
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  await page.waitForTimeout(2500)
  if (!page.url().includes('/projects/')) {
    await page.goto(`${BASE}${BRIEF_PATH}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
  }
}

const box = page.getByPlaceholder('Type a message...')
await box.waitFor({ timeout: 15000 })
await box.fill(MESSAGE)
await box.press('Enter')

await page.waitForTimeout(16000)
await page.screenshot({ path: `${shotDir}/72-feedback.png`, fullPage: true })

const convo = await page.locator('main').innerText().catch(() => '')
console.log('--- Maker asked for a walkthrough; Sam should cite the real reports ---')
console.log('MESSAGE:', MESSAGE)
console.log('\n--- tail of conversation ---')
console.log(convo.slice(-1800))

await browser.close()
console.log('\ndone; screenshot in .playwright-mcp/72-feedback.png')
