#!/usr/bin/env node
// Two-human chat verification for the 5b multi-human slice on preview.
//
// Logs in (separate browser contexts) as the seeded Originator then the
// Contributor, both opening the SAME cast brief, and posts one message each.
// The Contributor's turn makes the session multi-human, so Sam's reply to them
// should name the people and mediate. Dumps Sam's latest reply + screenshots.
//
// Secret hygiene: bypass token + passcodes read from gitignored files, never
// printed. Seed first: scripts/with-preview-env.mjs node scripts/seed-test-cast.mjs --apply
//
// Usage: node scripts/e2e-cast-chat.mjs

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const BRIEF_PATH = '/projects/test-cast-cafe'

const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcodes = JSON.parse(readFileSync(`${ROOT}.test-cast-passcodes.json`, 'utf8'))
const shotDir = `${ROOT}.playwright-mcp`

const browser = await chromium.launch()

async function loginAndChat(label, email, message) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const page = await ctx.newPage()

  // Prime Vercel bypass cookie, then app passcode login.
  await page.goto(
    `${BASE}${BRIEF_PATH}?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`,
    { waitUntil: 'domcontentloaded' },
  )
  await page.waitForTimeout(1500)
  if (page.url().includes('/auth/login')) {
    await page.getByPlaceholder('you@example.com').fill(email)
    await page.getByPlaceholder('ABC123').fill(passcodes[email])
    await page.getByRole('button', { name: 'Sign in with passcode' }).click()
    await page.waitForTimeout(2500)
    // After login we may land on /dashboard — navigate to the brief.
    if (!page.url().includes('/projects/')) {
      await page.goto(`${BASE}${BRIEF_PATH}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
    }
  }

  const box = page.getByPlaceholder('Type a message...')
  await box.waitFor({ timeout: 15000 })
  await box.fill(message)
  await box.press('Enter')

  // Wait for Sam's streamed reply to settle.
  await page.waitForTimeout(12000)
  await page.screenshot({ path: `${shotDir}/cast-${label}.png`, fullPage: true })

  // Dump the visible conversation text (last ~1200 chars) so we can eyeball
  // whether Sam addressed people by name.
  const convo = await page.locator('main').innerText().catch(() => '')
  await ctx.close()
  return convo.slice(-1200)
}

console.log('--- Originator turn (session becomes 1 human) ---')
const a = await loginAndChat(
  'originator',
  'test-originator@ibuild4you.com',
  "Hi Sam, I'm Mara. My business partner Tomas and I are opening a cozy Italian cafe in Seattle.",
)
console.log(a)

console.log('\n--- Contributor turn (session becomes multi-human) ---')
const b = await loginAndChat(
  'contributor',
  'test-contributor@ibuild4you.com',
  "Hi, this is Tomas. I think we should also offer evening catering, not just the cafe.",
)
console.log(b)

await browser.close()
console.log('\ndone; shots in .playwright-mcp/ (cast-originator.png, cast-contributor.png)')
