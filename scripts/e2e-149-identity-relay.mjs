#!/usr/bin/env node
// #149/#150 verification — the host-app identity relay end-to-end against a
// real deploy: mint a per-project signing secret, sign identityAssertion
// tokens IN this script (mirroring lib/feedback/identity.ts — scripts in this
// repo are plain JS, no ts-node, so the signing logic is reimplemented here
// rather than imported), and drive POST /api/feedback through the full route.
//
// Covers: a valid assertion verifies + overrides the typed email; a tampered
// token silently falls back to anonymous; PATCH feedback_requires_identity=
// true then confirm an unsigned POST 403s and a signed POST still 201s; 25
// signed POSTs all succeed despite the 20/hr rate limit (verified bypasses
// it). Cleans up every row + the minted secret + the flag.
//
// Ordering note: on a live Vercel deploy, x-forwarded-for is set by the edge
// from the real connecting client and ignores whatever this script forges —
// so every request here shares ONE real rate-limit bucket regardless of the
// per-block "IP" label. The unverified checks (tampered fallback, unsigned-
// with-flag-on) run FIRST, while that shared bucket is still under the 20/hr
// cap; the 25-request burst (whose requests are all verified and bypass
// enforcement regardless of bucket state) runs LAST.
//
// Usage: node scripts/with-preview-env.mjs node scripts/e2e-149-identity-relay.mjs
//        (E2E_BASE overrides the target, defaults to preview)
//
// Requires .ibuild4you-bypass (Vercel Protection Bypass token) + a preview
// .env.preview.local (for initFixtureDb's write guard) + .test-admin-password
// (admin login, to exercise the real PATCH /api/projects route for the flag).

import { createHmac, randomBytes } from 'node:crypto'
import { initFixtureDb } from './fixtures/db.mjs'
import { readToken, launchLoggedIn } from './lib/preview-login.mjs'

const BASE = process.env.E2E_BASE || 'https://preview.ibuild4you.com'
const SLUG = 'test-cast-cafe' // existing seeded fixture project (reused by e2e-72b)
const bypassToken = readToken()

const { db, firebaseProjectId } = initFixtureDb({ requireWrite: true })
console.log(`Target: ${BASE} — Firebase project: ${firebaseProjectId || '(unknown)'}`)

let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

// --- Mirror lib/feedback/identity.ts signIdentityAssertion (plain-JS reimpl) ---
function signToken(payload, secret) {
  const payloadB64url = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(payloadB64url, 'utf8').digest('base64url')
  return `${payloadB64url}.${sig}`
}

function makeToken({ project = SLUG, email = 'verified-e2e-149@example.com', ts, secret, kid = 'k1' } = {}, s) {
  return signToken(
    { v: 1, email, project, ts: ts ?? Math.floor(Date.now() / 1000), kid },
    s ?? secret
  )
}

async function postFeedback(payload, headers = {}) {
  const res = await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-vercel-protection-bypass': bypassToken,
      ...headers,
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

function basePayload(overrides = {}) {
  return {
    projectId: SLUG,
    type: 'idea',
    body: 'e2e-149 identity relay check — safe to ignore',
    pageUrl: 'https://test-cafe.example.com/feedback',
    userAgent: 'e2e-149/1.0',
    viewport: '1200x900',
    website: '',
    _ts: Date.now() - 5_000,
    ...overrides,
  }
}

// --- Setup: resolve the project + mint a secret ---
const projectSnap = await db.collection('projects').where('slug', '==', SLUG).limit(1).get()
if (projectSnap.empty) {
  console.error(`FAIL: no project with slug "${SLUG}" — seed it first (see e2e-72b-capture-wire.mjs header).`)
  process.exit(1)
}
const projectDoc = projectSnap.docs[0]
const projectId = projectDoc.id
const SECRET = randomBytes(32).toString('base64url')
const secretRef = db.collection('loop_signing_secrets').doc(projectId)
const now = new Date().toISOString()
await secretRef.set({ keys: { k1: SECRET }, active_kid: 'k1', created_at: now, updated_at: now })
console.log(`Minted secret for "${SLUG}" (project ${projectId})`)

const createdFeedbackIds = []

// --- 1. A valid assertion verifies + overrides the typed submitterEmail ---
{
  const token = makeToken({}, SECRET)
  const { status, data } = await postFeedback(
    basePayload({ submitterEmail: 'typed-should-be-overridden@example.com', identityAssertion: token }),
    { 'x-forwarded-for': '203.0.113.1' }
  )
  check('valid assertion → 201', status === 201, `got ${status}`)
  if (data.id) {
    createdFeedbackIds.push(data.id)
    await new Promise((r) => setTimeout(r, 1000))
    const doc = await db.collection('feedback').doc(data.id).get()
    const fb = doc.data() ?? {}
    check('submitter_email overridden to the verified email', fb.submitter_email === 'verified-e2e-149@example.com')
    check('submitter_email_verified is true', fb.submitter_email_verified === true)
  }
}

// --- 2. A tampered token silently falls back to anonymous ---
// NOTE (ordering): run this BEFORE the 25-request burst below. Vercel's edge
// sets x-forwarded-for from the real connecting client, ignoring whatever
// value we forge in the header — so despite each block here labeling a
// different "IP", checkRateLimit's in-memory bucket is keyed off ONE real
// shared address for every request this script sends. This block sends an
// UNVERIFIED request (tampered signature never verifies), so it's subject to
// real rate-limit enforcement — it must run while that shared bucket is
// still under the 20/hr cap (i.e. before the burst test below spends it).
{
  const token = makeToken({}, SECRET)
  const tampered = token.slice(0, -2) + (token.slice(-2) === 'xx' ? 'yy' : 'xx')
  const { status, data } = await postFeedback(basePayload({ submitterEmail: '', identityAssertion: tampered }), {
    'x-forwarded-for': '203.0.113.3',
  })
  check('tampered token → still 201 (falls back to anonymous, not rejected)', status === 201, `got ${status}`)
  if (data.id) {
    createdFeedbackIds.push(data.id)
    await new Promise((r) => setTimeout(r, 1000))
    const doc = await db.collection('feedback').doc(data.id).get()
    const fb = doc.data() ?? {}
    check('submitter_email is null (anonymous)', fb.submitter_email === null)
    check('submitter_email_verified is not set', fb.submitter_email_verified === undefined)
  }
}

// --- 3. feedback_requires_identity: unsigned 403s, signed still 201s ---
// NOTE (ordering): this must also run before the 25-request burst below —
// its unsigned sub-check is another unverified request subject to the same
// shared real-IP rate-limit bucket described above.
{
  const { browser, page } = await launchLoggedIn()
  let bearer = null
  page.on('request', (r) => {
    const a = r.headers()['authorization']
    if (a?.startsWith('Bearer ')) bearer = a
  })
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  for (let i = 0; i < 20 && !bearer; i++) await page.waitForTimeout(500)
  if (!bearer) {
    check('captured an admin Bearer token', false, 'never saw one — login failed?')
  } else {
    const patchRes = await page.request.fetch(`${BASE}/api/projects`, {
      method: 'PATCH',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      data: JSON.stringify({ project_id: projectId, feedback_requires_identity: true }),
    })
    check('PATCH feedback_requires_identity=true → 200', patchRes.ok(), `status ${patchRes.status()}`)

    const unsigned = await postFeedback(basePayload({ submitterEmail: 'typed-not-verified@example.com' }), {
      'x-forwarded-for': '203.0.113.4',
    })
    check('unsigned POST when flag is on → 403', unsigned.status === 403, `got ${unsigned.status}`)

    const token = makeToken({}, SECRET)
    const signed = await postFeedback(basePayload({ identityAssertion: token }), {
      'x-forwarded-for': '203.0.113.5',
    })
    check('signed POST when flag is on → 201', signed.status === 201, `got ${signed.status}`)
    if (signed.data.id) createdFeedbackIds.push(signed.data.id)

    // Reset the flag so the shared fixture project doesn't stay locked down.
    const resetRes = await page.request.fetch(`${BASE}/api/projects`, {
      method: 'PATCH',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      data: JSON.stringify({ project_id: projectId, feedback_requires_identity: false }),
    })
    check('reset feedback_requires_identity=false → 200', resetRes.ok(), `status ${resetRes.status()}`)
  }
  await browser.close()
}

// --- 4. 25 signed POSTs all succeed despite the 20/hr limit ---
// Verified requests bypass rate-limit enforcement (see route.ts), so this is
// safe to run last, after the shared bucket has already been partly spent by
// blocks 2 and 3's unverified requests.
{
  const ip = '203.0.113.2'
  let allOk = true
  for (let i = 0; i < 25; i++) {
    const token = makeToken({}, SECRET)
    const { status, data } = await postFeedback(basePayload({ identityAssertion: token }), {
      'x-forwarded-for': ip,
    })
    if (status !== 201) {
      allOk = false
      console.log(`  request ${i + 1}/25 → ${status}`)
    } else if (data.id) {
      createdFeedbackIds.push(data.id)
    }
  }
  check('25 signed POSTs from one IP (past the 20/hr limit) all accepted', allOk)
}

// --- Cleanup: delete every feedback row + the minted secret ---
for (const id of createdFeedbackIds) {
  await db.collection('feedback').doc(id).delete()
}
await secretRef.delete()
console.log(`cleaned up ${createdFeedbackIds.length} feedback row(s) + the minted secret`)

process.exit(failed ? 1 : 0)
