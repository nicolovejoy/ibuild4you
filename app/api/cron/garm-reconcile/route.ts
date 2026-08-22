import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'
import { isAuthorizedCron } from '@/lib/api/cron-auth'
import { normalizeEmail } from '@/lib/email/normalize'
import { ADMIN_EMAILS } from '@/lib/constants'
import {
  computeGrantDecision,
  GARM_DUAL_WRITE_PROJECT,
  type GarmGrantRole,
  type MemberRowForSync,
} from '@/lib/garm-grants'

// =============================================================================
// Garm ↔ Firestore grant reconcile (daily cron — see vercel.json "0 17 * * *").
//
// WHY: the membership dual-write in lib/garm-grants.ts is fire-and-forget with
// a swallowed catch. A dropped after(), a 2s timeout, or a 409 leaves Firestore
// saying "this person belongs" while Garm — the fail-closed sign-in authority —
// has no grant for them. That is a silent, permanent lockout with nothing to
// detect or repair it (2026-08-22 incident). This route is that detector.
//
// NO SECOND OPINION: the expected role comes from computeGrantDecision(), the
// same already-unit-tested function the dual-write uses. This route assembles
// isAdmin / members / isApproved exactly as syncGarmGrantForEmail does, only in
// bulk. It must never grow its own role-collapse logic.
//
// HEALING POLICY — ADDITIVE ONLY:
//   missing + role_mismatch  → upsert (actor 'ibuild4you-reconcile')
//   extra                    → report only, NEVER auto-revoke
// A Firestore read that fails or returns empty computes "revoke" for every
// user; if this route acted on that it would mass-lock-out the entire userbase
// in one tick. A stale grant is the far lesser harm, and the log makes it
// visible to a human. Off-boarding has its own deliberate revoke path
// (/api/approved-emails DELETE, #163) — this is a safety net for the
// grant-MISSING failure mode, not a second off-boarding mechanism.
//
// SAFETY CAP: more than RECONCILE_MAX_HEALS pending heals means the diff or the
// Firestore read is wrong, not that 10 people were simultaneously locked out.
// The run writes nothing, logs loudly, and records itself as capped.
//
// FAIL CLOSED: absent CRON_SECRET (in isAuthorizedCron) or absent Garm config
// both deny — no reads acted on, no writes issued.
//
// PII: the garm_reconcile_log doc and every console line carry counts and
// booleans ONLY — never an email address. Same rule as lib/garm-grants.ts and
// lib/garm-shadow.ts.
// =============================================================================

export const RECONCILE_MAX_HEALS = 10
const RECONCILE_ACTOR = 'ibuild4you-reconcile'
const TIMEOUT_MS = 5_000

type GarmGrant = { email: string; role: string }

/** One active grant per normalized email, as Garm currently has it. */
async function fetchActiveGrants(url: string, key: string): Promise<Map<string, string>> {
  // No include_revoked → Garm returns ACTIVE grants only, which is the set we
  // want to diff against.
  const res = await fetch(
    `${url}/api/grants?project=${encodeURIComponent(GARM_DUAL_WRITE_PROJECT)}`,
    {
      headers: { authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  )
  if (!res.ok) throw new Error(`GET /api/grants ${res.status}`)

  const body = (await res.json()) as { grants?: GarmGrant[] }
  const grants = Array.isArray(body?.grants) ? body.grants : []

  const active = new Map<string, string>()
  for (const g of grants) {
    const email = normalizeEmail(g?.email)
    if (!email) continue
    active.set(email, String(g?.role ?? ''))
  }
  return active
}

async function upsertGrant(
  url: string,
  key: string,
  email: string,
  role: GarmGrantRole
): Promise<void> {
  const res = await fetch(`${url}/api/grants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      email,
      project: GARM_DUAL_WRITE_PROJECT,
      role,
      actor: RECONCILE_ACTOR,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`POST /api/grants ${res.status}`)
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ranAt = new Date().toISOString()
  const db = getAdminDb()

  let checkedCount = 0
  let missingCount = 0
  let mismatchCount = 0
  let extraCount = 0
  let healedCount = 0
  let capped = false
  let error: string | null = null

  try {
    const garmUrl = process.env.GARM_URL
    const garmKey = process.env.GARM_ADMIN_KEY
    // Fail closed: without config there is no authority to compare against, so
    // the run reports an error rather than pretending everything is in sync.
    if (!garmUrl || !garmKey) throw new Error('GARM_URL/GARM_ADMIN_KEY not set')

    const [memberSnap, approvedSnap] = await Promise.all([
      db.collection('project_members').get(),
      db.collection('approved_emails').get(),
    ])

    // Assemble the same three inputs syncGarmGrantForEmail assembles, in bulk.
    const membersByEmail = new Map<string, MemberRowForSync[]>()
    for (const doc of memberSnap.docs) {
      const data = doc.data()
      const email = normalizeEmail(data.email as string | undefined)
      if (!email) continue
      const rows = membersByEmail.get(email) ?? []
      rows.push({
        role: data.role as string,
        removed_at: (data.removed_at as string | null | undefined) ?? null,
      })
      membersByEmail.set(email, rows)
    }

    // A revoked approved_emails row still exists (non-destructive flag, #163)
    // but must not count as approved — same rule as the dual-write.
    const approvedEmails = new Set<string>()
    const approvedDocIds = new Set<string>()
    for (const doc of approvedSnap.docs) {
      const email = normalizeEmail(doc.id)
      if (!email) continue
      approvedDocIds.add(email)
      if (!doc.data()?.revoked_at) approvedEmails.add(email)
    }

    // Candidate set = project_members ∪ approved_emails ∪ ADMIN_EMAILS. Admins
    // are unioned in because one can legitimately hold an owner grant while
    // appearing in neither collection; without them they'd land in `extra`.
    const candidates = new Set<string>([
      ...membersByEmail.keys(),
      ...approvedDocIds,
      ...ADMIN_EMAILS.map((e) => normalizeEmail(e)).filter(Boolean),
    ])
    checkedCount = candidates.size

    const actual = await fetchActiveGrants(garmUrl, garmKey)

    // Diff expected vs actual.
    const expectedUpserts = new Set<string>()
    const heals: Array<{ email: string; role: GarmGrantRole }> = []

    for (const email of candidates) {
      const decision = computeGrantDecision({
        isAdmin: ADMIN_EMAILS.includes(email),
        members: membersByEmail.get(email) ?? [],
        isApproved: approvedEmails.has(email),
      })
      if (decision.action !== 'upsert') continue

      expectedUpserts.add(email)
      const current = actual.get(email)
      if (current === undefined) {
        missingCount++
        heals.push({ email, role: decision.role })
      } else if (current !== decision.role) {
        mismatchCount++
        heals.push({ email, role: decision.role })
      }
    }

    // Anything Garm still grants that we have no expectation for. Reported,
    // never revoked — see the healing-policy note at the top of this file.
    for (const email of actual.keys()) {
      if (!expectedUpserts.has(email)) extraCount++
    }

    if (heals.length > RECONCILE_MAX_HEALS) {
      capped = true
      console.error(
        `[cron/garm-reconcile] CAPPED: ${heals.length} pending heals exceeds ${RECONCILE_MAX_HEALS} — wrote nothing. Suspect a bad Firestore read or a bad diff, not 10+ simultaneous lockouts.`
      )
    } else {
      for (const heal of heals) {
        try {
          await upsertGrant(garmUrl, garmKey, heal.email, heal.role)
          healedCount++
        } catch (err) {
          // One failed heal must not abort the rest of the batch.
          const message = err instanceof Error ? err.message : String(err)
          console.error(`[cron/garm-reconcile] heal failed (role=${heal.role}): ${message}`)
          error = error ? `${error}; ${message}` : message
        }
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    console.error(`[cron/garm-reconcile] run failed: ${error}`)
  }

  const summary = {
    checked_count: checkedCount,
    missing_count: missingCount,
    mismatch_count: mismatchCount,
    extra_count: extraCount,
    healed_count: healedCount,
    capped,
    error,
  }

  // One log doc per run, mirroring the reminder_log precedent. Counts and
  // booleans only — no email addresses (see PII note above).
  try {
    await db.collection('garm_reconcile_log').add({ ran_at: ranAt, ...summary })
  } catch (logErr) {
    console.error(
      `[cron/garm-reconcile] failed to write log doc: ${logErr instanceof Error ? logErr.message : String(logErr)}`
    )
  }

  console.log(JSON.stringify({ event: 'garm_reconcile_cron', ...summary, ts: ranAt }))

  // Always 200 with the counts: a cron that 500s on a Garm blip just retries
  // into the same failure. The error field + the log doc are the signal.
  return NextResponse.json(summary)
}
