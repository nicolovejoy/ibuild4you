import { normalizeEmail } from '@/lib/email/normalize'

// =============================================================================
// Garm authorization client (Garm 1/4 — client wiring only, no call sites yet).
//
// Garm centralizes (email, project) → role for the ecosystem. This app still
// owns login and knows the user's email; we ask Garm "is this person allowed?"
// and trust the `allowed` boolean.
//
// THE ONE RULE: gate on `allowed`. Never branch a security decision on `role` —
// the hierarchy (viewer < collaborator < owner) is resolved inside Garm; `role`
// is returned for display/UX only. See the garm repo's docs/consuming.md.
//
// Hardening over the reference client:
//   1. 2s timeout (AbortSignal) — "fail closed" only helps if it fails *fast*;
//      a stalled Garm must not hang the session/page-load path.
//   2. Email normalized once (trim+lowercase) for both request and cache key.
//   3. cache: 'no-store' so Next.js doesn't layer its own fetch cache over ours.
//   4. Deny-by-default field reads (allowed must be literally true) + a warn on
//      any off-shape response, so a Garm outage shows up in our logs too.
// =============================================================================

// This app's slug in Garm's project namespace (D1: one Garm project = one app;
// briefs are never Garm projects). Grants were seeded and dual-write syncs on
// exactly this grain.
export const GARM_PROJECT = 'ibuild4you'

const ROLES = ['viewer', 'collaborator', 'owner'] as const
export type Role = (typeof ROLES)[number]
export interface CheckResult {
  allowed: boolean
  role: Role | null
  // Aliasing (#169): the canonical principal the decision was computed for,
  // present only when Garm resolved the checked email as an alias. Optional and
  // OMITTED (not undefined-valued) when absent — pre-aliasing Garm responses
  // and consumers are unaffected.
  canonicalEmail?: string
}

const TTL_MS = 60_000
const TIMEOUT_MS = 2_000

// Module-level cache. Key: `${normalizedEmail}|${project}|${minRole}`.
// Grants change rarely; a 60s TTL keeps Garm off the hot path without letting a
// revocation linger. Unbounded in theory, but invite-only scale + Fluid Compute
// instance recycling make eviction unnecessary here.
const cache = new Map<string, { at: number; result: CheckResult }>()

/** Test-only: clear the in-memory cache between cases. */
export function _resetGarmCache(): void {
  cache.clear()
}

// Interpret a 200 response defensively: allowed only when literally `true`;
// any unrecognized/absent role becomes null. Never throws — an off-shape body
// degrades to a denial rather than crashing the caller.
function interpret(data: unknown): CheckResult {
  const d = (data ?? {}) as Record<string, unknown>
  const allowed = d.allowed === true
  const role = ROLES.includes(d.role as Role) ? (d.role as Role) : null
  if (typeof d.allowed !== 'boolean' || (d.role != null && role === null)) {
    console.warn('[garm] unexpected response shape:', data)
  }
  const result: CheckResult = { allowed, role }
  // Same defensive posture as `allowed`/`role`: only a string that still looks
  // like an email after normalization makes it through; anything else is
  // silently dropped rather than substituted into the caller's identity.
  if (typeof d.canonical_email === 'string') {
    const canonical = normalizeEmail(d.canonical_email)
    if (canonical.includes('@')) result.canonicalEmail = canonical
  }
  return result
}

/**
 * Ask Garm whether `email` has at least `minRole` on `project`.
 * Fails closed (allowed:false) on any error unless opts.failOpen is set — use
 * failOpen only for genuinely low-stakes read surfaces, as an explicit choice.
 */
export async function garmCheck(
  email: string,
  project: string,
  minRole: Role = 'viewer',
  opts: { failOpen?: boolean } = {}
): Promise<CheckResult> {
  const closed: CheckResult = opts.failOpen
    ? { allowed: true, role: null }
    : { allowed: false, role: null }

  const url = process.env.GARM_URL
  const key = process.env.GARM_KEY
  if (!url || !key) {
    console.warn('[garm] GARM_URL/GARM_KEY not set — denying by default')
    return closed
  }

  const normEmail = normalizeEmail(email)
  const cacheKey = `${normEmail}|${project}|${minRole}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result

  try {
    const res = await fetch(`${url}/gnipahellir`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ email: normEmail, project, min_role: minRole }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`garm returned ${res.status}`)
    const result = interpret(await res.json())
    cache.set(cacheKey, { at: Date.now(), result })
    return result
  } catch (err) {
    // Fail closed (or open if explicitly opted in). We deliberately do NOT cache
    // a failure — a transient blip must not lock a valid member out for 60s.
    console.warn(
      `[garm] check failed for ${project} (fail-${opts.failOpen ? 'open' : 'closed'}):`,
      err instanceof Error ? err.message : err
    )
    return closed
  }
}

/**
 * Resolve an email to its canonical principal (aliasing, #169). Rides the same
 * /gnipahellir check (and its 60s cache) as the sign-in gate; Garm answers with
 * `canonical_email` only when the address is a registered alias.
 *
 * This is identity RESOLUTION, not an authz decision — it fails OPEN to the
 * normalized input. A Garm outage degrades an aliased user to their raw token
 * identity (they may 403 on member-gated routes until Garm is back); it never
 * grants anyone anything, and the sign-in gate stays fail-closed independently.
 *
 * No-ops (no network) on an empty email, when GARM_GATING=off (preview / kill
 * switch — no Garm wiring there), or when GARM_URL/GARM_KEY are unset. PR H
 * removes the kill switch; this guard needs revisiting then.
 */
export async function resolveCanonicalEmail(email: string): Promise<string> {
  const norm = normalizeEmail(email)
  if (!norm) return norm
  if (process.env.GARM_GATING === 'off') return norm
  if (!process.env.GARM_URL || !process.env.GARM_KEY) return norm
  try {
    const { canonicalEmail } = await garmCheck(norm, GARM_PROJECT, 'viewer')
    return canonicalEmail ?? norm
  } catch {
    // garmCheck never throws by contract, but this runs on every authenticated
    // request — belt and suspenders.
    return norm
  }
}
