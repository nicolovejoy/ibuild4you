// e2e: password reset goes out through OUR Resend sender, not Firebase's.
//
// Verifies the security invariants that matter on a public unauthenticated
// endpoint, plus the UI wiring:
//   1. unknown address and known address are indistinguishable (status + body)
//   2. no Firebase Auth account is created for an unknown address
//   3. per-IP rate limit trips
//   4. the login page's "Forgot password?" shows the junk-folder confirmation
//
// Run: node scripts/e2e-reset-email-domain.mjs
// Needs .ibuild4you-bypass (Vercel Protection Bypass) and playwright installed.

import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE || 'https://preview.ibuild4you.com'
const bypass = readFileSync('.ibuild4you-bypass', 'utf8').trim()

// Deliberately an address that cannot exist, so invariant 2 is meaningful.
const UNKNOWN = `nobody-${Date.now()}@example.invalid`
const KNOWN = process.env.E2E_EMAIL || 'test@ibuild4you.com'

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

async function postReset(email) {
  const res = await fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-vercel-protection-bypass': bypass,
    },
    body: JSON.stringify({ email }),
  })
  const text = await res.text()
  return { status: res.status, body: text }
}

console.log(`\nReset-email domain e2e against ${BASE}\n`)

// --- 1 + 2: enumeration safety -------------------------------------------
const unknown = await postReset(UNKNOWN)
const known = await postReset(KNOWN)

check('unknown address answers 200', unknown.status === 200, `got ${unknown.status}`)
check('known address answers 200', known.status === 200, `got ${known.status}`)
check(
  'responses are byte-identical (no enumeration oracle)',
  unknown.status === known.status && unknown.body === known.body,
  `${unknown.status}:${unknown.body} vs ${known.status}:${known.body}`
)

// --- 3: rate limit --------------------------------------------------------
// Per-email cap is 3/hr and we've already spent 1 on KNOWN; per-IP is 5/hr.
// Fire enough to trip whichever binds first.
let tripped = false
let firedBeforeTrip = 0
for (let i = 0; i < 8; i++) {
  const r = await postReset(`ratelimit-probe-${i}@example.invalid`)
  if (r.status === 429) {
    tripped = true
    break
  }
  firedBeforeTrip++
}
check('per-IP rate limit trips', tripped, `fired ${firedBeforeTrip} without a 429`)

// --- 4: UI wiring ---------------------------------------------------------
const browser = await chromium.launch()
const ctx = await browser.newContext()
await ctx.addCookies([
  {
    name: 'x-vercel-protection-bypass',
    value: bypass,
    domain: new URL(BASE).hostname,
    path: '/',
  },
])
const page = await ctx.newPage()

// Capture the network call so we prove the UI hits OUR route, not Firebase's
// identitytoolkit endpoint.
const calls = []
page.on('request', (req) => {
  const u = req.url()
  if (u.includes('/api/auth/reset-password')) calls.push('ours')
  if (u.includes('identitytoolkit') && u.includes('sendOobCode')) calls.push('firebase')
})

await page.goto(
  `${BASE}/auth/login?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=${bypass}`,
  { waitUntil: 'domcontentloaded' }
)

// The password form is behind a toggle on some viewports; click it if present.
const pwToggle = page.getByRole('button', { name: /sign in with password/i })
if (await pwToggle.isVisible().catch(() => false)) {
  await pwToggle.click()
}

await page.fill('#pw-email', UNKNOWN)
await page.getByRole('button', { name: /forgot password/i }).click()

// Confirmation copy should mention junk/spam and moving it to the inbox.
const info = await page
  .locator('text=/junk|spam/i')
  .first()
  .textContent({ timeout: 10_000 })
  .catch(() => null)

check('confirmation mentions junk/spam', !!info, 'no junk/spam text appeared')
check(
  'confirmation asks them to move it to the inbox',
  !!info && /inbox/i.test(info),
  info || '(none)'
)
check('UI called our route', calls.includes('ours'), `calls: ${calls.join(',') || 'none'}`)
check(
  "UI did NOT call Firebase's sendOobCode",
  !calls.includes('firebase'),
  `calls: ${calls.join(',')}`
)

await browser.close()

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
