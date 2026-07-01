#!/usr/bin/env node
// Drive a headless browser through preview.ibuild4you.com as the passcode-based
// test admin, for agent-driven UI verification on preview.
//
// Secret hygiene: the Vercel protection-bypass token and the admin passcode are
// read from gitignored local files, never passed on the command line or printed.
// Only screenshots (saved to .playwright-mcp/) leave this process.
//
// Files it expects (create yourself; both gitignored):
//   .ibuild4you-bypass        Vercel Protection Bypass for Automation token
//   .test-admin-passcode      passcode for test@ibuild4you.com (op read ... > file)
//
// Usage:
//   node scripts/e2e-preview-login.mjs [relativePathToVisit ...]
// Default visits: /dashboard, then clicks the first brief card.

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const EMAIL = process.env.E2E_EMAIL || 'test@ibuild4you.com'

const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcode = readFileSync(`${ROOT}.test-admin-passcode`, 'utf8').trim()

const shotDir = `${ROOT}.playwright-mcp`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()

// 1. Prime the Vercel bypass cookie (token only in this one URL, in-process).
await page.goto(
  `${BASE}/dashboard?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`,
  { waitUntil: 'domcontentloaded' }
)

// 2. App-level passcode login if we landed on /auth/login.
// The dashboard redirects client-side, so wait for the redirect to settle.
await page.waitForURL(/\/(auth\/login|dashboard)/, { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(1500)
if (page.url().includes('/auth/login')) {
  // #104 added a second you@example.com field (password form); target the
  // passcode form's inputs by id to avoid a strict-mode ambiguity.
  await page.locator('#email').fill(EMAIL)
  await page.locator('#passcode').fill(passcode)
  console.log('filled email len:', EMAIL.length, 'passcode len:', passcode.length)
  // Capture the passcode auth response to learn WHY a login fails.
  const respP = page
    .waitForResponse((r) => /\/api\/auth\/passcode/.test(r.url()), { timeout: 12000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  const resp = await respP
  if (resp) {
    console.log('passcode endpoint:', resp.status())
    console.log('body:', (await resp.text()).slice(0, 300))
  } else {
    console.log('no /api/auth/passcode response seen')
  }
  await page.waitForTimeout(1500)
  const alertTxt = await page.locator('[role="alert"]').first().textContent().catch(() => null)
  if (alertTxt) console.log('alert:', alertTxt.trim())
  await page.waitForURL(/\/dashboard/, { timeout: 8000 }).catch(() => {})
}

await page.waitForTimeout(2000)
console.log('after-login url:', page.url())
await page.screenshot({ path: `${shotDir}/e2e-dashboard.png` })

// 3. Open the first brief card and screenshot the builder console.
const card = page.locator('h3').first()
if (await card.count()) {
  await card.click()
  await page.waitForTimeout(2500)
  console.log('brief url:', page.url())
  await page.screenshot({ path: `${shotDir}/e2e-brief.png`, fullPage: false })
}

await browser.close()
console.log('done; shots in .playwright-mcp/')
