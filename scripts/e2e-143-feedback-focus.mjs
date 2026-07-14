#!/usr/bin/env node
// #143 verification — the notification-email ?focus= handoff, end-to-end on a
// real deploy: POST a widget-shaped payload to /api/feedback, then open
// /admin/feedback?focus=<id> as the test admin and assert the matching card
// gets the transient highlight ring. Cleans up its own feedback row.
//
// Usage: node scripts/with-preview-env.mjs node scripts/e2e-143-feedback-focus.mjs
//        (E2E_BASE overrides the target, defaults to preview)

import { launchLoggedIn, BASE, readToken, shotDir } from './lib/preview-login.mjs'
import { initFixtureDb } from './fixtures/db.mjs'

const SLUG = 'test-cast-cafe'
const token = readToken()
const { db } = initFixtureDb({ requireWrite: true })

let failed = false
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failed = true
}

// 1. POST a widget-shaped feedback payload.
const payload = {
  projectId: SLUG,
  type: 'bug',
  body: 'e2e-143 focus-highlight check — safe to ignore',
  submitterEmail: 'e2e-143@example.com',
  pageUrl: 'https://test-cafe.example.com/menu',
  userAgent: 'e2e-143/1.0',
  viewport: '1200x900',
  website: '',
  _ts: Date.now() - 5_000,
}
const res = await fetch(`${BASE}/api/feedback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-vercel-protection-bypass': token },
  body: JSON.stringify(payload),
})
const data = await res.json().catch(() => ({}))
if (res.status !== 201 || !data.id) {
  console.error(`FAIL: expected 201 with id, got ${res.status}:`, data)
  process.exit(1)
}
const fbId = data.id
console.log(`POST /api/feedback → 201, feedback id ${fbId}`)

// 2. Open the admin inbox focused on that id.
const { browser, page } = await launchLoggedIn()
try {
  await page.goto(`${BASE}/admin/feedback?focus=${fbId}`, { waitUntil: 'networkidle' })

  // Wait for the focused card to render (matched by the body text).
  const card = page.locator(`div:has-text("${fbId}")`).last()
  // The row carrying the feedback-id footer is the card itself; grab the
  // outermost card by its unique body copy instead.
  const bodyCard = page
    .locator('div.rounded-lg', { hasText: 'e2e-143 focus-highlight check' })
    .first()
  await bodyCard.waitFor({ state: 'visible', timeout: 15_000 })

  // 3. The ring class is applied for ~2.5s on mount. Grade it promptly.
  const cls = await bodyCard.getAttribute('class')
  check('focused card shows the highlight ring', !!cls && cls.includes('ring-brand-navy'))
  check('focused card is scrolled into the viewport', await bodyCard.isVisible())

  await page.screenshot({ path: `${shotDir}/e2e-143-focus.png` })
  console.log(`screenshot → ${shotDir}/e2e-143-focus.png`)
  // eslint-disable-next-line no-unused-vars
  void card
} finally {
  await browser.close()
  // Clean up the row this test created.
  await db.collection('feedback').doc(fbId).delete()
  console.log('cleaned up test feedback row')
}

process.exit(failed ? 1 : 0)
