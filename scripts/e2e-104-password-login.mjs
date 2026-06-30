#!/usr/bin/env node
// #104 verification: the email/password login UI renders on preview, and (once
// the Email/Password provider is enabled in the preview Firebase project) the
// "Forgot password?" flow shows the non-leaky confirmation.
//
// Files expected (gitignored): .ibuild4you-bypass
// Usage: node scripts/e2e-104-password-login.mjs

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = process.env.E2E_BASE || 'https://preview.ibuild4you.com'
const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const shotDir = `${ROOT}.playwright-mcp`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()

await page.goto(
  `${BASE}/auth/login?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`,
  { waitUntil: 'domcontentloaded' }
)
await page.waitForTimeout(2000)

const hasPwBtn = await page.getByRole('button', { name: 'Sign in with password' }).count()
const hasForgot = await page.getByRole('button', { name: 'Forgot password?' }).count()
const hasPwField = await page.locator('#password').count()
console.log('password button:', hasPwBtn, '| forgot link:', hasForgot, '| password field:', hasPwField)
await page.screenshot({ path: `${shotDir}/e2e-104-login.png` })

// Forgot-password: fill the password-form email, click forgot, expect confirmation.
if (hasForgot) {
  await page.locator('#pw-email').fill('nobody-test-104@example.com')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.waitForTimeout(2500)
  const alertTxt = await page.locator('[role="alert"]').allTextContents()
  console.log('after forgot, alerts:', JSON.stringify(alertTxt))
  await page.screenshot({ path: `${shotDir}/e2e-104-forgot.png` })
}

await browser.close()
const ok = hasPwBtn && hasForgot && hasPwField
console.log(ok ? 'PASS: password UI rendered' : 'FAIL: password UI missing')
process.exit(ok ? 0 : 1)
