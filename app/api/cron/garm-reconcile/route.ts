import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'
import { isAuthorizedCron } from '@/lib/api/cron-auth'
import { normalizeEmail } from '@/lib/email/normalize'
import { ADMIN_EMAILS, isAdminEmail } from '@/lib/constants'
import {
  computeGrantDecision,
  isGarmDualWriteEnabled,
  GARM_DUAL_WRITE_PROJECT,
  type GarmGrantRole,
  type MemberRowForSync,
} from '@/lib/garm-grants'
import { countRecentGarmDenials } from '@/lib/garm-denials'

// =============================================================================
// Garm ↔ Firestore grant reconcile (hourly cron — see vercel.json "0 * * * *").
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
// KILL SWITCH: gated on the same GARM_DUAL_WRITE switch as the write path it
// backstops. When the operator pauses dual-write, Firestore and Garm are
// diverging BY INTENT, and a reconcile that heals that divergence would quietly
// defeat the pause. The run still writes its log row (skipped_dual_write_off:
// true) so a paused reconciler stays visible every hour instead of the safety
// net silently disappearing behind a forgotten flag.
//
// PII: the garm_reconcile_log doc and every console line carry counts and
// booleans ONLY — never an email address. Same rule as lib/garm-grants.ts and
// lib/garm-shadow.ts.
// =============================================================================

// Not exported: Next validates that a route.ts exports only recognized Route
// fields, so an extra `export const` here fails `next build`.
const RECONCILE_MAX_HEALS = 10
const RECONCILE_ACTOR = 'ibuild4you-reconcile'
// Deliberately longer than lib/garm-grants.ts's 2s. That timeout sits on a
// request path where a person is waiting; this one is a background cron
// fetching the whole roster, which is a heavier call with nobody blocked on it.
const TIMEOUT_MS = 5_000

type GarmGrant = { email: string; role: string }

/**
 * Every error string this route records — into the log doc's one free-text
 * field and into its console lines — goes through here first.
 *
 * The messages we throw ourselves are already address-free (`POST /api/grants
 * 500` and friends). This is the boundary guarantee for the ones we don't
 * author: a transport error, a Firestore error, or a future maintainer folding
 * a response body into a message. `error` is the only dynamic field in
 * garm_reconcile_log, and that doc is required to carry counts and booleans
 * only — so the constraint is enforced here rather than resting on every error
 * string that might ever reach it being well-behaved.
 */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/[^\s<>"']+@[^\s<>"']+/g, '[redacted]')
}

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
  // THROW, never degrade to an empty list. Garm's listing contract is known and
  // verified — its handler ends `return json({ grants: rows })`, and the select
  // carries no limit/offset so there is no pagination to miss. An unrecognized
  // body therefore means something is genuinely wrong, and treating it as "zero
  // active grants" would report every expected grant as `missing`, trip the
  // safety cap at the current roster size, and heal nobody — forever, while the
  // log cheerfully reads `capped: true`. A loud error is the honest outcome.
  // (scripts/garm-seed-grants.mjs hedges with a bare-array fallback; that hedge
  // predates knowing the contract. Do not copy it here.)
  if (!Array.isArray(body?.grants)) {
    throw new Error('GET /api/grants: unrecognized response shape')
  }

  const active = new Map<string, string>()
  for (const g of body.grants) {
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

/**
 * `missing_count` from the most recent prior run, or null when there is none
 * (first ever run) or the read fails.
 *
 * Feeds the `repeat_missing` signal: this route has no memory across runs, so a
 * heal that POSTs 200 but doesn't show up in the next listing would be re-healed
 * every hour forever while the log read `missing_count: 1, healed_count: 1` —
 * indistinguishable from healthy operation, which is exactly the
 * detector-looks-alive-while-doing-nothing failure this route exists to prevent.
 *
 * Never throws: this is a diagnostic signal, not the job. A failure here must
 * not cost anyone their heal.
 */
async function readPriorMissingCount(db: ReturnType<typeof getAdminDb>): Promise<number | null> {
  try {
    const snap = await db.collection('garm_reconcile_log').orderBy('ran_at', 'desc').limit(1).get()
    const prior = snap.docs[0]?.data()?.missing_count
    return typeof prior === 'number' ? prior : null
  } catch (err) {
    console.warn(`[cron/garm-reconcile] could not read prior log row: ${describeError(err)}`)
    return null
  }
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
  let repeatMissing = false
  let skippedDualWriteOff = false
  let error: string | null = null

  // Same switch that governs the dual-write this route backstops. Off means the
  // operator is deliberately holding Garm apart from Firestore; healing would
  // undo that. Checked before any read or fetch — a paused run touches nothing
  // but its own log row.
  if (!isGarmDualWriteEnabled()) {
    skippedDualWriteOff = true
    console.warn(
      '[cron/garm-reconcile] GARM_DUAL_WRITE is not "on" — reconcile paused, no grants read or written'
    )
  } else {
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
          isAdmin: isAdminEmail(email),
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
            const message = describeError(err)
            console.error(`[cron/garm-reconcile] heal failed (role=${heal.role}): ${message}`)
            error = error ? `${error}; ${message}` : message
          }
        }
      }
    } catch (err) {
      error = describeError(err)
      console.error(`[cron/garm-reconcile] run failed: ${error}`)
    }

    // Same shortfall as last hour = a heal that isn't sticking. Cheap signal, no
    // memory needed beyond the previous row. Only meaningful when we're actually
    // still short after healing.
    if (missingCount > 0) {
      const prior = await readPriorMissingCount(db)
      repeatMissing = prior === missingCount
      if (repeatMissing) {
        console.warn(
          `[cron/garm-reconcile] repeat_missing: still ${missingCount} missing after last run healed the same count — heals may not be sticking`
        )
      }
    }
  }

  // Denial counts (lib/garm-denials.ts): the reconcile log is where a human
  // looks after an incident, so the "wrong key" signal the diff cannot see
  // rides along here. Runs outside the dual-write gate above on purpose — a
  // paused run is exactly when a human most needs this number.
  // These count DISTINCT principals whose last_seen is inside the window, not denial attempts — one address denied 50 times reads as 1.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const denials = await countRecentGarmDenials(db, since)

  const summary = {
    checked_count: checkedCount,
    missing_count: missingCount,
    mismatch_count: mismatchCount,
    extra_count: extraCount,
    healed_count: healedCount,
    capped,
    repeat_missing: repeatMissing,
    skipped_dual_write_off: skippedDualWriteOff,
    denials_24h_unknown_principal: denials.unknownPrincipal,
    denials_24h_known_member: denials.knownMember,
    error,
  }

  // One log doc per run, mirroring the reminder_log precedent. Counts and
  // booleans only — no email addresses (see PII note above).
  try {
    await db.collection('garm_reconcile_log').add({ ran_at: ranAt, ...summary })
  } catch (logErr) {
    console.error(`[cron/garm-reconcile] failed to write log doc: ${describeError(logErr)}`)
  }

  console.log(JSON.stringify({ event: 'garm_reconcile_cron', ...summary, ts: ranAt }))

  // Always 200 with the counts: a cron that 500s on a Garm blip just retries
  // into the same failure. The error field + the log doc are the signal.
  return NextResponse.json(summary)
}
