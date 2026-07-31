// e2e: password reset goes out through OUR Resend sender, not Firebase's.
//
// Verifies the security invariants that matter on a public unauthenticated
// endpoint, plus the UI wiring:
//   1. the login page's "Forgot password?" shows the junk-folder confirmation
//   2. the UI calls our route, not Firebase's sendOobCode
//   3. unknown address and known address are indistinguishable (status + body)
//   4. per-IP rate limit trips
//
// ORDER MATTERS: every check below shares one public IP, and the per-IP limit
// is 5/hr. The UI check runs FIRST because it's the one that fails misleadingly
// when rate-limited (a 429 renders the limit error instead of the confirmation
// copy, which reads as a copy bug). The rate-limit probe runs LAST because it
// deliberately exhausts the budget. Deploy-polling this same route beforehand
// also spends from it — if the UI checks fail, wait out the hour before
// concluding anything.
//
// Run: node scripts/e2e-reset-email-domain.mjs
// Needs .ibuild4you-bypass (Vercel Protection Bypass) and playwright installed.

import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE || 'https://preview.ibuild4you.com'
const bypass = readFileSync('.ibuild4you-bypass', 'utf8').trim()

// Deliberately an address that cannot exist, so the "no account created"
// property is meaningful and no real inbox is touched.
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
  return { status: res.status, body: await res.text() }
}

console.log(`\nReset-email domain e2e against ${BASE}\n`)

// --- 1 + 2: UI wiring (FIRST — see ordering note above) -------------------
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

// Capture the network calls so we prove the UI hits OUR route and no longer
// hits Firebase's identitytoolkit sendOobCode endpoint.
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

// The password form sits behind a toggle; click it if it's showing.
const pwToggle = page.getByRole('button', { name: /sign in with password/i })
if (await pwToggle.isVisible().catch(() => false)) {
  await pwToggle.click()
}

await page.fill('#pw-email', UNKNOWN)
await page.getByRole('button', { name: /forgot password/i }).click()

const info = await page
  .locator('text=/junk|spam/i')
  .first()
  .textContent({ timeout: 10_000 })
  .catch(() => null)

check('confirmation mentions junk/spam', !!info, 'no junk/spam text appeared (rate-limited?)')
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

// --- 3: enumeration safety -----------------------------------------------
const unknown = await postReset(`nobody2-${Date.now()}@example.invalid`)
const known = await postReset(KNOWN)

check('unknown address answers 200', unknown.status === 200, `got ${unknown.status}`)
check('known address answers 200', known.status === 200, `got ${known.status}`)
check(
  'responses are byte-identical (no enumeration oracle)',
  unknown.status === known.status && unknown.body === known.body,
  `${unknown.status}:${unknown.body} vs ${known.status}:${known.body}`
)

// --- 4: rate limit (LAST — exhausts the per-IP budget) --------------------
let tripped = false
let firedBeforeTrip = 0
for (let i = 0; i < 10; i++) {
  const r = await postReset(`ratelimit-probe-${i}@example.invalid`)
  if (r.status === 429) {
    tripped = true
    break
  }
  firedBeforeTrip++
}
check('per-IP rate limit trips', tripped, `fired ${firedBeforeTrip} without a 429`)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
