#!/usr/bin/env node
// #72 slice B2 verification — the cast project has seeded structural captures
// (/menu and /order pages with real headings + button labels). Log in as the
// maker and ask Sam to walk through the site. PASS = Sam names real routes /
// controls from the captures (e.g. "/order", "Place order", "Pickup time")
// while still being honest that it can't see the live screen. FAIL = invented
// visual details (colors, imagery) or no reference to the captured structure.
//
// Prereq: node scripts/with-preview-env.mjs node scripts/seed-72-captures.mjs --apply
// Usage:  node scripts/e2e-72c-context-chat.mjs

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { loginWithPassword, BASE, shotDir, ROOT } from './lib/preview-login.mjs'

const BRIEF_PATH = '/projects/test-cast-cafe'
const EMAIL = 'test-originator@ibuild4you.com'
const MESSAGE =
  'Can you walk me through the pages of my site as it stands right now — what would I see on each one?'

const passwords = JSON.parse(readFileSync(`${ROOT}.test-cast-passwords.json`, 'utf8'))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const page = await ctx.newPage()

await loginWithPassword(page, { email: EMAIL, password: passwords[EMAIL], path: BRIEF_PATH })

const box = page.getByPlaceholder('Type a message...')
await box.waitFor({ timeout: 15000 })
await box.fill(MESSAGE)
await box.press('Enter')

await page.waitForTimeout(18000)
await page.screenshot({ path: `${shotDir}/72c-context.png`, fullPage: true })

// This chat renders newest-first, so the fresh reply is at the TOP of main.
const convo = await page.locator('main').innerText().catch(() => '')
const head = convo.slice(0, 3000)
console.log('--- Maker asked for a page walkthrough; Sam should cite captured structure ---')
console.log('MESSAGE:', MESSAGE)
console.log('\n--- head of conversation (newest first) ---')
console.log(head)

// Light automated signal on top of the eyeball check: does the reply name
// controls/headings that only exist in the seeded captures?
const hits = ['order for pickup', 'add to cart', 'our menu', 'place order'].filter((w) =>
  head.toLowerCase().includes(w),
)
console.log(`\ncapture-vocabulary hits in reply: ${hits.join(', ') || '(none)'}`)
if (hits.length === 0) process.exitCode = 1

await browser.close()
console.log('\ndone; screenshot in .playwright-mcp/72c-context.png')
