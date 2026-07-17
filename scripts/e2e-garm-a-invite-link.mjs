#!/usr/bin/env node
// Garm consumer plan Phase 1 / PR A verification on preview (updated for PR D:
// passcodes retired — the share response must NOT carry one anymore): the
// invite flow mints a Firebase password-setup link.
//
// Proves the REAL end-to-end flow against the deployed preview app (which has
// its own FIREBASE_SERVICE_ACCOUNT for ibuild4you-preview as a Vercel env
// var — this script needs none of that locally):
//   1. Create a throwaway brief + invite a throwaway maker email via the
//      deployed POST /api/projects/share.
//   2. Confirm the response carries a `reset_link` (a real Firebase
//      password-reset URL) and NO `passcode` (retired, PR D).
//   3. Confirm POST /api/projects/[id]/email kind=invite also succeeds and is
//      SUPPRESSED (never actually emails the throwaway example.com address —
//      preview only sends to the allowlist; see app/api/projects/[id]/email/route.ts).
//   4. Visit the reset_link with a fresh unauthenticated browser context, set
//      a real password on the Firebase-hosted action page.
//   5. Sign in on the preview login page with email + that new password,
//      confirm we land somewhere authenticated (not bounced to /auth/login).
//   6. Cleanup: delete the throwaway brief (owner-only hard delete, cascades
//      project_members/sessions/messages). The throwaway Firebase Auth user
//      itself is NOT deleted here — this script has no local Admin SDK
//      access (see PR write-up); it's flagged as a scratch/plain
//      *@example.com identity, harmless to leave, and easy to sweep later
//      with an Admin-SDK script Nico runs locally.
//
// Prereqs: .ibuild4you-bypass, .test-admin-password (see scripts/lib/preview-login.mjs)
// Usage: node scripts/e2e-garm-a-invite-link.mjs

import { launchLoggedIn, shotDir, BASE } from './lib/preview-login.mjs'
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const bypass = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()

const stamp = Date.now()
const MAKER_EMAIL = `garm-pr-a-e2e-${stamp}@example.com`
const NEW_PASSWORD = `Pw-e2e-${stamp}-Xk9`

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const { browser, page } = await launchLoggedIn()

// Capture the admin bearer token off an authenticated request the app makes.
let bearer = null
page.on('request', (req) => {
  const a = req.headers()['authorization']
  if (a && a.startsWith('Bearer ')) bearer = a
})
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
check('captured admin bearer token', !!bearer)

const api = (path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: bearer,
      'x-vercel-protection-bypass': bypass,
      ...(init.headers || {}),
    },
  })

// 1. Create a throwaway brief.
let projectId = null
{
  const res = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title: `Garm PR A e2e ${stamp}` }),
  })
  const body = await res.json().catch(() => ({}))
  projectId = body.id
  check('created throwaway brief', !!projectId, `status ${res.status}`)
}

// 2. Invite the throwaway maker via POST /api/projects/share.
let resetLink = null
if (projectId) {
  const res = await api('/api/projects/share', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, email: MAKER_EMAIL, role: 'maker' }),
  })
  const body = await res.json().catch(() => ({}))
  check('share invite succeeded', res.status === 200, `status ${res.status}`)
  check('no passcode in the share response (retired — PR D)', body.passcode === undefined)
  resetLink = body.reset_link || null
  check(
    'reset_link is a real Firebase action link',
    typeof resetLink === 'string' && /^https:\/\/.+mode=resetPassword/.test(resetLink),
    resetLink ? resetLink.slice(0, 80) + '…' : 'null',
  )
}

// 3. Fire the actual invite-email route. Must succeed and must be suppressed
// (never really emails an @example.com address on preview). NOTE: this mints
// its OWN fresh reset link server-side (deliberately, so a link never goes
// stale sitting unsent) — which supersedes/invalidates the one captured in
// step 2 (Firebase invalidates a prior outstanding reset oobCode once a new
// one is generated for the same account; confirmed empirically — the first
// draft of this script tried to consume the step-2 link after this call and
// got "expired or already used"). So step 4 below re-invites (step 2's same
// idempotent re-share path) to mint the link we actually consume.
if (projectId) {
  const res = await api(`/api/projects/${projectId}/email`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'invite' }),
  })
  const body = await res.json().catch(() => ({}))
  check('invite-email route succeeded', res.status === 200, `status ${res.status}`)
  check('invite-email suppressed (no real send to a fake address)', body.suppressed === true)
}

// 3b. Re-share the same maker to mint the LAST (therefore still-valid) link —
// share/route.ts's re-share path is idempotent and is what we'll consume.
if (projectId) {
  const res = await api('/api/projects/share', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, email: MAKER_EMAIL, role: 'maker' }),
  })
  const body = await res.json().catch(() => ({}))
  check('re-share (to get the last-minted, still-valid link) succeeded', res.status === 200, `status ${res.status}`)
  resetLink = body.reset_link || resetLink
}

// 4. Visit the reset link in a clean, unauthenticated context and set a password.
if (resetLink) {
  const resetCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const resetPage = await resetCtx.newPage()
  await resetPage.goto(resetLink, { waitUntil: 'domcontentloaded' })
  await resetPage.waitForTimeout(2000)
  await resetPage.screenshot({ path: `${shotDir}/e2e-garm-a-reset-link.png` }).catch(() => {})

  // Firebase's default hosted action-code page: a single password field +
  // "Save"/"Reset Password" button. Selector is loose (no test ids on
  // Firebase's own page) — try common labels.
  const pwField = resetPage.locator('input[type="password"], input[name="password"]').first()
  const hasPwField = await pwField.count()
  check('reset-link page shows a password field', !!hasPwField)

  if (hasPwField) {
    await pwField.fill(NEW_PASSWORD)
    const saveBtn = resetPage
      .getByRole('button', { name: /save|reset|submit/i })
      .first()
    await saveBtn.click().catch(() => {})
    await resetPage.waitForTimeout(2500)
    await resetPage.screenshot({ path: `${shotDir}/e2e-garm-a-reset-confirmed.png` }).catch(() => {})
    const confirmText = await resetPage.locator('body').innerText().catch(() => '')
    check(
      'password-reset confirmation shown',
      /success|updated|changed|you can now sign in/i.test(confirmText),
      confirmText.slice(0, 120),
    )
  }
  await resetCtx.close()
}

// 5. Sign in with the freshly-set email + password on the preview login page.
{
  const signinCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const signinPage = await signinCtx.newPage()
  await signinPage.goto(
    `${BASE}/auth/login?x-vercel-protection-bypass=${bypass}&x-vercel-set-bypass-cookie=true`,
    { waitUntil: 'domcontentloaded' },
  )
  await signinPage.waitForTimeout(1500)
  await signinPage.locator('#pw-email').fill(MAKER_EMAIL)
  await signinPage.locator('#password').fill(NEW_PASSWORD)
  const respP = signinPage
    .waitForResponse((r) => /identitytoolkit.*signInWithPassword/.test(r.url()), { timeout: 12000 })
    .catch(() => null)
  await signinPage.getByRole('button', { name: 'Sign in with password' }).click()
  const resp = await respP
  console.log('signInWithPassword status:', resp ? resp.status() : 'no response captured')
  await signinPage.waitForTimeout(2500)
  await signinPage.screenshot({ path: `${shotDir}/e2e-garm-a-signin.png` }).catch(() => {})
  const url = signinPage.url()
  check(
    'maker signs in with the password set via the invite link',
    !url.includes('/auth/login'),
    url,
  )
  await signinCtx.close()
}

// 6. Cleanup: delete the throwaway brief. (Throwaway Auth user + approved_emails
// row are left — see header note; harmless *@example.com placeholder.)
if (projectId) {
  const res = await api(`/api/projects?project_id=${projectId}`, { method: 'DELETE' })
  check('cleanup: throwaway brief deleted', res.status === 200, `status ${res.status}`)
}

await browser.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed; shots in .playwright-mcp/`)
console.log(`Throwaway maker email (Firebase Auth user NOT deleted): ${MAKER_EMAIL}`)
process.exit(passed === results.length ? 0 : 1)
