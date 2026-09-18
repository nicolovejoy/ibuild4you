#!/usr/bin/env node
// Verify PR #178 on preview: two TEXT-ONLY maker turns in one session, < 5 min
// apart, so turn 2 should read turn 1's cached prefix (cache_read > 0). Before
// #178 a text-only conversation placed no cache_control marker at all.
//
// Runs as the seeded multi-human cast's Originator (a maker) on test-cast-cafe.
// Seed first:  node scripts/with-preview-env.mjs node scripts/seed-test-cast.mjs --apply
//
// Usage: node scripts/e2e-178-text-cache.mjs
// Then:  node scripts/with-preview-env.mjs node scripts/check-cache-read.mjs $(cat /tmp/e2e-178-session.txt)

import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { loginWithPassword, BASE, shotDir, ROOT } from './lib/preview-login.mjs'

const BRIEF_PATH = '/projects/test-cast-cafe'
const EMAIL = 'test-originator@ibuild4you.com'

const passwords = JSON.parse(readFileSync(`${ROOT}.test-cast-passwords.json`, 'utf8'))

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } })
const page = await ctx.newPage()

let sessionId = null
let chatError = false
page.on('response', async (resp) => {
  if (/\/api\/chat$/.test(resp.url()) && resp.request().method() === 'POST') {
    try {
      const body = JSON.parse(resp.request().postData() || '{}')
      if (body.session_id) sessionId = body.session_id
    } catch {}
    if (resp.status() >= 400) chatError = true
  }
})

// Login (password) and land on the maker chat.
await loginWithPassword(page, { email: EMAIL, password: passwords[EMAIL], path: BRIEF_PATH })
// Always land squarely on the brief and let the maker view settle (kickoff /
// cold-start can delay the composer past a short wait).
await page.goto(`${BASE}${BRIEF_PATH}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const box = page.getByPlaceholder('Type a message...')
await box.waitFor({ timeout: 30000 })
check('maker chat composer present', true)

// The composer textarea is `disabled` while the agent streams. Wait until it
// has been continuously enabled for `stableMs` (agent idle) or `maxMs` elapses.
async function waitIdle(maxMs = 45000, stableMs = 3500) {
  const start = Date.now()
  let enabledSince = null
  while (Date.now() - start < maxMs) {
    const disabled = await box.isDisabled().catch(() => true)
    if (disabled) enabledSince = null
    else if (enabledSince === null) enabledSince = Date.now()
    else if (Date.now() - enabledSince >= stableMs) return true
    await page.waitForTimeout(500)
  }
  return false
}

// Let any returning-maker kickoff greeting fully stream + settle first.
await waitIdle()

// Count agent replies by conversation length growth — each turn must produce
// new text and no 4xx/5xx from /api/chat.
async function turn(text, label) {
  const before = (
    await page
      .locator('main')
      .innerText()
      .catch(() => '')
  ).length
  await box.fill(text)
  await box.press('Enter')
  await page.waitForTimeout(1500)
  await waitIdle(60000)
  const after = (
    await page
      .locator('main')
      .innerText()
      .catch(() => '')
  ).length
  await page.screenshot({ path: `${shotDir}/e2e-178-${label}.png`, fullPage: true })
  check(`${label}: agent replied`, after > before + text.length, `+${after - before} chars`)
}

await turn(
  'Quick thought: I want customers to be able to pre-order pastries the night before.',
  'turn1'
)
await turn('And they should be able to pick a pickup time slot in the morning.', 'turn2')
check('no /api/chat error across both turns', !chatError)

if (sessionId) writeFileSync('/tmp/e2e-178-session.txt', sessionId)
console.log(`\nsession_id: ${sessionId || 'NOT CAPTURED'} (written to /tmp/e2e-178-session.txt)`)
console.log(
  'Next: node scripts/with-preview-env.mjs node scripts/check-cache-read.mjs $(cat /tmp/e2e-178-session.txt)'
)

await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
