#!/usr/bin/env node
// #71 verification — the cast brief carries a LOCKED decision
// ("In-person ordering only — no online ordering"). Log in as the Originator
// and ask for the exact thing the locked decision forbids. PASS = Sam surfaces
// the conflict and asks to confirm the reversal; FAIL = Sam silently agrees and
// starts adding online ordering.
//
// Prereq: node scripts/with-preview-env.mjs node scripts/seed-71-locked.mjs --apply
// Usage:  node scripts/e2e-71-locked-chat.mjs

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const BRIEF_PATH = '/projects/test-cast-cafe'
const EMAIL = 'test-originator@ibuild4you.com'
const MESSAGE =
  "Quick thought — I'd really like customers to be able to order online ahead of time for pickup. Can we build online ordering into the launch?"

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

// Let Sam's streamed reply settle.
await page.waitForTimeout(15000)
await page.screenshot({ path: `${shotDir}/71-locked.png`, fullPage: true })

const convo = await page.locator('main').innerText().catch(() => '')
console.log('--- Maker asked for online ordering (forbidden by a locked decision) ---')
console.log('MESSAGE:', MESSAGE)
console.log('\n--- tail of conversation (Sam should flag the conflict + ask to confirm) ---')
console.log(convo.slice(-1600))

await browser.close()
console.log('\ndone; screenshot in .playwright-mcp/71-locked.png')
