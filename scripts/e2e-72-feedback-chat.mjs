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
import { loginWithPassword, BASE, shotDir, ROOT } from './lib/preview-login.mjs'

const BRIEF_PATH = '/projects/test-cast-cafe'
const EMAIL = 'test-originator@ibuild4you.com'
const MESSAGE =
  "Can you walk me through what's going on with the site so far — what have people been running into?"

const passwords = JSON.parse(readFileSync(`${ROOT}.test-cast-passwords.json`, 'utf8'))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const page = await ctx.newPage()

await loginWithPassword(page, { email: EMAIL, password: passwords[EMAIL], path: BRIEF_PATH })

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
