#!/usr/bin/env node
// #104 full-path verification: set a password on the test-admin user via the
// preview Admin SDK, then headlessly sign in with email + password on preview.
//
// The password is generated in-process and never printed or persisted to a file.
// Run via the preview env wrapper (provides FIREBASE_SERVICE_ACCOUNT):
//   node scripts/with-preview-env.mjs node scripts/e2e-104-full-signin.mjs
//
// Files expected (gitignored): .ibuild4you-bypass

import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = process.env.E2E_BASE || 'https://preview.ibuild4you.com'
const EMAIL = process.env.E2E_EMAIL || 'test@ibuild4you.com'

// Vercel protection-bypass token: only preview is gated. Prod (and CI against
// prod) needs none, so it's optional — env first, then local file, else skip.
const bypassFile = `${ROOT}.ibuild4you-bypass`
const token =
  process.env.VERCEL_PROTECTION_BYPASS?.trim() ||
  (existsSync(bypassFile) ? readFileSync(bypassFile, 'utf8').trim() : '')
const bypassQuery = token
  ? `?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`
  : ''

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (run via scripts/with-preview-env.mjs)')
  process.exit(1)
}
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })

// Strong in-process-only password — fresh every run, never leaves this process.
const password = 'Pw-' + randomBytes(12).toString('base64url')

const adminAuth = getAuth()
const u = await adminAuth.getUserByEmail(EMAIL)
await adminAuth.updateUser(u.uid, { password })
console.log('set password on test-admin uid:', u.uid)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()

await page.goto(`${BASE}/auth/login${bypassQuery}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

await page.locator('#pw-email').fill(EMAIL)
await page.locator('#password').fill(password)
const respP = page
  .waitForResponse((r) => /identitytoolkit.*signInWithPassword/.test(r.url()), { timeout: 12000 })
  .catch(() => null)
await page.getByRole('button', { name: 'Sign in with password' }).click()
const resp = await respP
if (resp) console.log('signInWithPassword status:', resp.status())

await page.waitForURL(/\/dashboard/, { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(1500)
const url = page.url()
const alert = await page.locator('[role="alert"]').allTextContents()
console.log('final url:', url)
if (alert.filter(Boolean).length) console.log('alerts:', JSON.stringify(alert))
mkdirSync(`${ROOT}.playwright-mcp`, { recursive: true })
await page.screenshot({ path: `${ROOT}.playwright-mcp/e2e-104-signin.png` })

await browser.close()
const ok = /\/dashboard/.test(url)
console.log(ok ? 'PASS: signed in with email + password' : 'FAIL: did not reach dashboard')
process.exit(ok ? 0 : 1)
