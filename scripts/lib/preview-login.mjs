// Shared headless-login helper for agent-driven e2e on preview (and prod).
// Extracts the bypass-cookie + sign-in dance every e2e script repeated.
//
// Garm PR C: passcodes are being retired for makers (PR D disables the route
// entirely), so the harness now signs the test admin in with email+password
// instead of a passcode. The password is set via Admin SDK by
// scripts/seed-test-admin-password.mjs and lives in a gitignored file — same
// pattern the old .test-admin-passcode file used.
//
// Env overrides:
//   E2E_BASE           default https://preview.ibuild4you.com (set to prod URL for prod)
//   E2E_EMAIL          default test@ibuild4you.com
//   E2E_PASSWORD_FILE  default .test-admin-password (use .test-admin-password-prod for prod)
//
// Files (gitignored — create yourself, see scripts/seed-test-admin-password.mjs):
//   .ibuild4you-bypass      Vercel Protection Bypass for Automation token
//   <E2E_PASSWORD_FILE>     password for the test admin (Admin-SDK-set, plain text)
//
// Usage:
//   import { launchLoggedIn, shotDir, BASE } from './lib/preview-login.mjs'
//   const { browser, page } = await launchLoggedIn()
//   // ...drive the page, screenshot into shotDir...
//   await browser.close()
//
// Signing in as someone other than the test admin (e.g. a seeded test-cast
// identity)? Use loginWithPassword(page, { email, password, path }) directly —
// it doesn't touch the E2E_EMAIL/E2E_PASSWORD_FILE defaults.

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

export const ROOT = new URL('../..', import.meta.url).pathname
export const BASE = process.env.E2E_BASE || 'https://preview.ibuild4you.com'
export const EMAIL = process.env.E2E_EMAIL || 'test@ibuild4you.com'
export const shotDir = `${ROOT}.playwright-mcp`

const PASSWORD_FILE = process.env.E2E_PASSWORD_FILE || '.test-admin-password'

export function readToken() {
  return readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
}
export function readPassword() {
  return readFileSync(`${ROOT}${PASSWORD_FILE}`, 'utf8').trim()
}

// Core primitive: prime the Vercel protection-bypass cookie, then sign in with
// a given email + password. Works for the test admin OR any other seeded
// identity (e.g. a test-cast member) — just pass its email/password.
// `verbose: true` logs the Firebase signInWithPassword response to help
// diagnose a failed login. Returns the same page, landed on `path` (or wherever
// the app redirects to after auth if that differs — we re-navigate to `path`
// as a fallback so callers can rely on ending up there).
export async function loginWithPassword(
  page,
  { email, password, path = '/dashboard', verbose = false } = {}
) {
  const token = readToken()

  // 1. Prime the bypass cookie (token only appears in this one in-process URL).
  await page.goto(
    `${BASE}${path}?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`,
    { waitUntil: 'domcontentloaded' }
  )

  // 2. App redirects client-side to /auth/login if unauthenticated; wait for
  // either the login page or somewhere authenticated to settle.
  await page.waitForURL(/\/(auth\/login|dashboard|projects\/)/, { timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(1500)

  if (page.url().includes('/auth/login')) {
    // Target the password form's inputs by id (#pw-email / #password) —
    // placeholder matching is ambiguous since the passcode form also has a
    // you@example.com field (the #104 dual-email-field gotcha).
    await page.locator('#pw-email').fill(email)
    await page.locator('#password').fill(password)
    const respP = verbose
      ? page
          .waitForResponse((r) => /identitytoolkit.*signInWithPassword/.test(r.url()), { timeout: 12000 })
          .catch(() => null)
      : null
    await page.getByRole('button', { name: 'Sign in with password' }).click()
    if (respP) {
      const resp = await respP
      if (resp) console.log('signInWithPassword status:', resp.status())
      else console.log('no signInWithPassword response seen')
    }
    await page.waitForURL(/\/(dashboard|projects\/)/, { timeout: 10000 }).catch(() => {})
    // If we landed somewhere other than the requested path (e.g. /dashboard
    // when a project path was requested), navigate there directly.
    if (!page.url().includes(path)) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1500)
    }
  }
  await page.waitForTimeout(1500)
  return page
}

// Test-admin-specific convenience wrapper around loginWithPassword, using the
// EMAIL/readPassword() defaults. Lands on `path` (default /dashboard).
export async function loginPage(page, { path = '/dashboard', verbose = false } = {}) {
  return loginWithPassword(page, { email: EMAIL, password: readPassword(), path, verbose })
}

// One-liner: launch a headless browser and return an authenticated page as the
// test admin. Caller is responsible for `await browser.close()`.
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
