// e2e: the custom Firebase action handler at /auth/action.
//
// Proves the thing that made Firebase's hosted page unusable is fixed: the
// set-password form is served from OUR origin, so a password manager keys the
// saved credential to ibuild4you.com. Also checks the states a real user hits
// when a link is stale or mangled.
//
// Uses a throwaway account created for this run, so no real identity (and in
// particular not the test admin, whose password the e2e fleet depends on) is
// ever reset.
//
// Run: node scripts/with-preview-env.mjs node scripts/e2e-auth-action-handler.mjs

import { readFileSync } from 'fs'
import { chromium } from 'playwright'
import { initAdminDb } from './fixtures/db.mjs'
import admin from 'firebase-admin'

const BASE = process.env.E2E_BASE || 'https://preview.ibuild4you.com'
const bypass = readFileSync('.ibuild4you-bypass', 'utf8').trim()

const THROWAWAY = `action-e2e-${Date.now()}@example.com`
const NEW_PASSWORD = `Ae${Math.random().toString(36).slice(2)}Zx9!`

let pass = 0
let fail = 0
function check(label, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ok  ${label}`)
  } else {
    fail++
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

initAdminDb()
const auth = admin.auth()

console.log(`\nAuth action handler e2e against ${BASE}`)
console.log(`throwaway identity: ${THROWAWAY}\n`)

// Create the throwaway and mint a real reset link for it.
const user = await auth.createUser({ email: THROWAWAY, password: 'initial-Passw0rd!' })
const link = await auth.generatePasswordResetLink(THROWAWAY, { url: `${BASE}/auth/login` })
const oobCode = new URL(link).searchParams.get('oobCode')
check('minted a real reset link with an oobCode', !!oobCode)

const browser = await chromium.launch()
const ctx = await browser.newContext()
await ctx.addCookies([
  { name: 'x-vercel-protection-bypass', value: bypass, domain: new URL(BASE).hostname, path: '/' },
])
const page = await ctx.newPage()
const q = `x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=${bypass}`

try {
  // --- stale link ---------------------------------------------------------
  await page.goto(`${BASE}/auth/action?mode=resetPassword&oobCode=definitely-not-valid&${q}`, {
    waitUntil: 'domcontentloaded',
  })
  const expired = await page
    .locator('text=/expired/i')
    .first()
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  check('a stale oobCode says the link expired', expired)

  // --- mangled link -------------------------------------------------------
  await page.goto(`${BASE}/auth/action?${q}`, { waitUntil: 'domcontentloaded' })
  const invalid = await page
    .locator("text=/isn't complete/i")
    .first()
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  check('a link with no params explains itself', invalid)

  // --- the real flow ------------------------------------------------------
  await page.goto(`${BASE}/auth/action?mode=resetPassword&oobCode=${oobCode}&${q}`, {
    waitUntil: 'domcontentloaded',
  })

  await page.waitForSelector('#action-password', { timeout: 20_000 })

  // The username field is what makes a password manager file this under
  // ibuild4you.com rather than firebaseapp.com.
  const emailField = page.locator('#action-email')
  const emailValue = await emailField.inputValue()
  check('form shows the account email', emailValue === THROWAWAY, `got "${emailValue}"`)
  check(
    'email field is autocomplete=username (password managers pair on this)',
    (await emailField.getAttribute('autocomplete')) === 'username'
  )
  check(
    'password field is autocomplete=new-password',
    (await page.locator('#action-password').getAttribute('autocomplete')) === 'new-password'
  )
  check('form is served from our origin', page.url().startsWith(BASE), page.url())

  // Mismatch guard before the happy path.
  await page.fill('#action-password', NEW_PASSWORD)
  await page.fill('#action-confirm', `${NEW_PASSWORD}-different`)
  await page.getByRole('button', { name: /set password/i }).click()
  const mismatch = await page
    .locator('text=/do not match/i')
    .first()
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  check('mismatched confirmation is rejected', mismatch)

  await page.fill('#action-confirm', NEW_PASSWORD)
  await page.getByRole('button', { name: /set password/i }).click()

  const success = await page
    .locator('text=/password set/i')
    .first()
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  check('password is set successfully', success)

  const redirecting = await page
    .locator('text=/taking you to sign in/i')
    .first()
    .isVisible()
    .catch(() => false)
  check('auto-redirect countdown is shown (no dead end)', redirecting)

  // --- the password actually works ---------------------------------------
  const refreshed = await auth.getUser(user.uid)
  check(
    'account still has the password provider',
    refreshed.providerData.some((p) => p.providerId === 'password')
  )

  // Sign in for real against preview's Firebase project via REST.
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
  if (apiKey) {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: THROWAWAY,
          password: NEW_PASSWORD,
          returnSecureToken: true,
        }),
      }
    )
    check('the new password actually signs in', res.status === 200, `status ${res.status}`)
  } else {
    console.log('  --  skipped sign-in check (NEXT_PUBLIC_FIREBASE_API_KEY not in env)')
  }
} finally {
  await browser.close()
  await auth.deleteUser(user.uid)
  console.log(`\ncleaned up ${THROWAWAY}`)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
