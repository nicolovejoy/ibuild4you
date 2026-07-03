// Shared headless-login helper for agent-driven e2e on preview (and prod).
// Extracts the bypass-cookie + passcode-login dance every e2e script repeated,
// including the #104 selector gotcha (a second you@example.com field was added
// for the password form, so we target the passcode inputs by id).
//
// Env overrides:
//   E2E_BASE           default https://preview.ibuild4you.com (set to prod URL for prod)
//   E2E_EMAIL          default test@ibuild4you.com
//   E2E_PASSCODE_FILE  default .test-admin-passcode (use .test-admin-passcode-prod for prod)
//
// Files (gitignored — create yourself):
//   .ibuild4you-bypass      Vercel Protection Bypass for Automation token
//   <E2E_PASSCODE_FILE>     passcode for the test admin (op read ... > file)
//
// Usage:
//   import { launchLoggedIn, shotDir, BASE } from './lib/preview-login.mjs'
//   const { browser, page } = await launchLoggedIn()
//   // ...drive the page, screenshot into shotDir...
//   await browser.close()

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

export const ROOT = new URL('../..', import.meta.url).pathname
export const BASE = process.env.E2E_BASE || 'https://preview.ibuild4you.com'
export const EMAIL = process.env.E2E_EMAIL || 'test@ibuild4you.com'
export const shotDir = `${ROOT}.playwright-mcp`

const PASSCODE_FILE = process.env.E2E_PASSCODE_FILE || '.test-admin-passcode'

export function readToken() {
  return readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
}
export function readPasscode() {
  return readFileSync(`${ROOT}${PASSCODE_FILE}`, 'utf8').trim()
}

// Prime the Vercel protection-bypass cookie, then do app-level passcode login.
// Lands on `path` (default /dashboard). `verbose: true` logs the /api/auth/passcode
// response to help diagnose a failed login. Returns the same page.
export async function loginPage(page, { path = '/dashboard', verbose = false } = {}) {
  const token = readToken()
  const passcode = readPasscode()

  // 1. Prime the bypass cookie (token only appears in this one in-process URL).
  await page.goto(
    `${BASE}${path}?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`,
    { waitUntil: 'domcontentloaded' }
  )

  // 2. App redirects client-side; wait for login-or-dashboard to settle.
  await page.waitForURL(/\/(auth\/login|dashboard)/, { timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(1500)

  if (page.url().includes('/auth/login')) {
    // Target the passcode form's inputs by id — placeholder matching is
    // ambiguous since #104 added a second you@example.com field (password form).
    await page.locator('#email').fill(EMAIL)
    await page.locator('#passcode').fill(passcode)
    const respP = verbose
      ? page
          .waitForResponse((r) => /\/api\/auth\/passcode/.test(r.url()), { timeout: 12000 })
          .catch(() => null)
      : null
    await page.getByRole('button', { name: 'Sign in with passcode' }).click()
    if (respP) {
      const resp = await respP
      if (resp) console.log('passcode endpoint:', resp.status(), '|', (await resp.text()).slice(0, 200))
      else console.log('no /api/auth/passcode response seen')
    }
    await page.waitForURL(/\/dashboard/, { timeout: 10000 }).catch(() => {})
  }
  await page.waitForTimeout(1500)
  return page
}

// One-liner: launch a headless browser and return an authenticated page.
// Caller is responsible for `await browser.close()`.
export async function launchLoggedIn({
  viewport = { width: 1400, height: 1000 },
  path = '/dashboard',
  verbose = false,
} = {}) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await loginPage(page, { path, verbose })
  return { browser, ctx, page, BASE, shotDir, EMAIL }
}
