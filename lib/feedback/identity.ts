// #149 — host-app identity relay. A host app's SERVER signs an assertion that
// a given email submitted this feedback; the widget attaches it to the
// POST /api/feedback payload; we verify the signature + freshness here and
// treat the email as verified (bypasses the rate limit, satisfies #150's
// feedback_requires_identity flag).
//
// Pure, server-only, no I/O — the caller (app/api/feedback/route.ts) owns
// loading the per-project secret(s) from Firestore and passing them in.
//
// SECURITY NOTE (replay): this module only checks freshness (ts window), not
// single-use. A captured token stays valid for the whole freshness window
// (12h) and can be replayed by anyone who can read network traffic to that
// window's boundary. That's a deliberate scope cut for v1 — the assertion
// proves "this host vouched for this email recently," not "this exact
// submission." If replay ever matters (e.g. an attacker wants to spam one
// verified-looking row), add a nonce + a small seen-token cache.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { normalizeEmail } from '@/lib/email/normalize'

export const IDENTITY_ASSERTION_VERSION = 1
export const MAX_FUTURE_SKEW_SECONDS = 60
export const MAX_AGE_SECONDS = 12 * 60 * 60 // 12h

export interface IdentityAssertionPayload {
  v: 1
  email: string
  project: string // projects.slug
  ts: number // unix seconds
  kid: string
}

// `project` is returned (not checked here) so the caller — which is the one
// holding `body.projectId` — can enforce `payload.project === body.projectId`
// itself. Keeping that comparison out of this pure module means the module
// never needs to know what field the caller compares against.
export type VerifyIdentityResult =
  | { ok: true; email: string; kid: string; project: string }
  | { ok: false; reason: string }

function base64urlEncode(input: string | Buffer): string {
  return (typeof input === 'string' ? Buffer.from(input, 'utf8') : input).toString('base64url')
}

function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

function hmac(payloadB64url: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payloadB64url, 'utf8').digest()
}

// Sign a payload — used by scripts/loop-secret.mjs-adjacent tooling and tests.
// The host app implements this independently (it doesn't import this repo),
// but this is the reference implementation the host recipe (PR 2) mirrors.
export function signIdentityAssertion(payload: IdentityAssertionPayload, secret: string): string {
  const payloadB64url = base64urlEncode(JSON.stringify(payload))
  const sig = hmac(payloadB64url, secret)
  return `${payloadB64url}.${base64urlEncode(sig)}`
}

// Verify a token against a set of known keys (kid -> secret). `activeKid` is
// used when the token doesn't specify a kid (shouldn't happen given the
// signing contract always includes one, but keeps this defensive).
//
// CRITICAL ORDERING: recompute the HMAC over the *exact received*
// payloadB64url string and constant-time-compare signatures BEFORE decoding
// or parsing the payload. Never re-serialize JSON and compare that — a
// re-serialization could produce different bytes than what was signed
// (key order, whitespace, unicode normalization) and either false-reject
// legitimate tokens or, worse, mask a tampered payload that happens to
// re-serialize to the same bytes as something else.
export function verifyIdentityAssertion(
  token: string,
  keys: Record<string, string>,
  activeKid: string,
  now: number
): VerifyIdentityResult {
  if (typeof token !== 'string' || !token) {
    return { ok: false, reason: 'empty token' }
  }
  const dotIndex = token.indexOf('.')
  if (dotIndex < 0 || token.indexOf('.', dotIndex + 1) !== -1) {
    return { ok: false, reason: 'malformed token' }
  }
  const payloadB64url = token.slice(0, dotIndex)
  const sigB64url = token.slice(dotIndex + 1)
  if (!payloadB64url || !sigB64url) {
    return { ok: false, reason: 'malformed token' }
  }

  // Peek the kid WITHOUT trusting it yet — we need to know which secret to
  // verify against. If parsing fails here, fall back to activeKid; the sig
  // check below will reject if that guess is wrong anyway.
  let peekedKid: string | undefined
  try {
    const peeked = JSON.parse(base64urlDecode(payloadB64url).toString('utf8'))
    if (peeked && typeof peeked === 'object' && typeof peeked.kid === 'string') {
      peekedKid = peeked.kid
    }
  } catch {
    return { ok: false, reason: 'malformed payload' }
  }

  const kid = peekedKid || activeKid
  const secret = keys[kid]
  if (!secret) {
    return { ok: false, reason: 'unknown kid' }
  }

  // Recompute HMAC over the exact received payloadB64url string.
  const expectedSig = hmac(payloadB64url, secret)
  let providedSig: Buffer
  try {
    providedSig = base64urlDecode(sigB64url)
  } catch {
    return { ok: false, reason: 'malformed signature' }
  }
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
    return { ok: false, reason: 'signature mismatch' }
  }

  // Signature verified — now safe to decode/parse and trust the payload.
  let payload: IdentityAssertionPayload
  try {
    payload = JSON.parse(base64urlDecode(payloadB64url).toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed payload' }
  }

  if (payload.v !== IDENTITY_ASSERTION_VERSION) {
    return { ok: false, reason: 'unsupported version' }
  }
  if (typeof payload.email !== 'string' || !payload.email.trim()) {
    return { ok: false, reason: 'missing email' }
  }
  if (typeof payload.project !== 'string' || !payload.project.trim()) {
    return { ok: false, reason: 'missing project' }
  }
  if (typeof payload.ts !== 'number' || !Number.isFinite(payload.ts)) {
    return { ok: false, reason: 'missing ts' }
  }

  const ageSeconds = now - payload.ts
  if (ageSeconds < -MAX_FUTURE_SKEW_SECONDS) {
    return { ok: false, reason: 'ts too far in the future' }
  }
  if (ageSeconds > MAX_AGE_SECONDS) {
    return { ok: false, reason: 'ts too old' }
  }

  return { ok: true, email: normalizeEmail(payload.email), kid, project: payload.project }
}
