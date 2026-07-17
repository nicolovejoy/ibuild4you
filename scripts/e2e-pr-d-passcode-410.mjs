#!/usr/bin/env node
// Garm PR D probe: passcode auth is retired.
//   1. POST /api/auth/passcode → 410 Gone with the retirement copy.
//   2. The login page renders NO passcode form (no #passcode input, no
//      "Sign in with passcode" button) while keeping the password form's
//      load-bearing ids (#pw-email / #password) and the Google button.
// Usage: node scripts/e2e-pr-d-passcode-410.mjs

import { chromium } from 'playwright'
import { readToken, BASE, shotDir } from './lib/preview-login.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`)
}

const bypass = readToken()

// 1. The retired route answers 410 with friendly copy.
{
  const res = await fetch(`${BASE}/api/auth/passcode`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vercel-protection-bypass': bypass,
    },
    body: JSON.stringify({ email: 'anyone@example.com', passcode: 'ABC123' }),
  })
  const body = await res.json().catch(() => ({}))
  check('POST /api/auth/passcode → 410', res.status === 410, `status ${res.status}`)
  check('410 body has retirement copy', /retired/i.test(body.error || ''), (body.error || '').slice(0, 80))
  check('410 body carries no token', body.token === undefined)
}

// 2. Login page shows no passcode form; password form ids intact.
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage()
await page.goto(
  `${BASE}/auth/login?x-vercel-protection-bypass=${bypass}&x-vercel-set-bypass-cookie=true`,
  { waitUntil: 'domcontentloaded' }
)
await page.waitForTimeout(2000)
await page.screenshot({ path: `${shotDir}/pr-d-login.png`, fullPage: true })

check('no #passcode input', (await page.locator('#passcode').count()) === 0)
check(
  'no "Sign in with passcode" button',
  (await page.getByRole('button', { name: 'Sign in with passcode' }).count()) === 0
)
const bodyText = await page.locator('body').innerText().catch(() => '')
check('no passcode wording on the page', !/passcode/i.test(bodyText))
check('#pw-email present (e2e-harness id)', (await page.locator('#pw-email').count()) === 1)
check('#password present (e2e-harness id)', (await page.locator('#password').count()) === 1)
check(
  '"Sign in with password" button present',
  (await page.getByRole('button', { name: 'Sign in with password' }).count()) === 1
)
check(
  '"Sign in with Google" button present',
  (await page.getByRole('button', { name: 'Sign in with Google' }).count()) === 1
)

await browser.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
