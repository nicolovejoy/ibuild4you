# Garm denial detector + await-the-grant-at-invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps the 2026-08-22 maker lockout exposed that the reconcile cron (PR #175) cannot: (1) a sign-in denial for an address our store has never heard of goes unnoticed, and (2) the invite path fires its Garm grant write and forgets, so the builder never learns when it fails (#174).

**Architecture:** Task 1 adds a small pure classifier + a best-effort recorder that runs off the hot path when `/api/approved-emails` denies someone, writing one counts-only Firestore doc per (hashed) principal and a distinct log line per class; the reconcile log row then surfaces 24h denial counts so the one place a human already looks after an incident carries the signal. Task 2 makes `syncGarmGrantForEmail` report an outcome, awaits it on the invite POST only, returns it in the response, and renders a warning in both share modals when the grant did not land.

**Tech Stack:** Next.js App Router route handlers, Firebase Admin SDK (mocked in tests), vitest, React Query hook, Tailwind. No new dependencies.

**Spec:** this plan's "Why" sections + issue #174 + `docs/reliability-hardening-plan.md` (the "What this plan does and does not fix" header) + handoff entries dated 2026-08-22 in `~/src/.handoff/ibuild4you-prompt-lab.md`.

## Global Constraints

1. **TDD.** Failing test first, then implementation. `npm test` green at every commit (currently 127 files / 1404 tests).
2. **No PII in code, tests, logs, commits, or Firestore log docs.** Log lines carry booleans/counts/roles only. Tests use `@example.com`. The denial doc is keyed by a SHA-256 of the normalized email and stores no address.
3. **Fail closed / never block the local write.** Task 1's recorder must never change the sign-in answer and never throw into the route. Task 2's awaited Garm write must never unwind or block the Firestore membership write — a Garm failure is a *warning in the response*, not an error status.
4. **No new dependencies.** `crypto` is Node built-in.
5. **The last gate is what CI runs:** `npm run build` (not just `type-check` — in a worktree `tsc --noEmit` is a false green because `.next/types` is absent), `npm test`, `npm run lint`. Paste the output in the task report.
6. Do not touch `lib/garm.ts` (`garmCheck`/`garmProbe`) or the reconcile's healing logic; Task 1 only *adds* two fields to the reconcile log row and response.
7. Copy strings live in `lib/copy.ts`, never inline in components.

## File structure

- Create `lib/garm-denials.ts` — pure `classifyGarmDenial()` + impure `recordGarmDenial()` + `countRecentGarmDenials()`; one responsibility: remember and classify denials.
- Create `lib/__tests__/garm-denials.test.ts`.
- Modify `app/api/approved-emails/route.ts` — schedule the recorder on deny (3 lines).
- Modify `app/api/approved-emails/__tests__/garm-sync.test.ts` or add `deny-recorder.test.ts` — assert the recorder is scheduled on deny and not on allow.
- Modify `app/api/cron/garm-reconcile/route.ts` + its test — add `denials_24h_unknown_principal` and `denials_24h_known_member` to the summary.
- Modify `lib/garm-grants.ts` — `syncGarmGrantForEmail` returns `GarmSyncOutcome`.
- Modify `lib/__tests__/garm-grants.test.ts` — outcome assertions.
- Modify `app/api/projects/share/route.ts` — POST awaits the sync and returns `garm_sync`.
- Modify `app/api/projects/__tests__/share-garm-sync.test.ts` — POST expectations.
- Modify `lib/query/hooks.ts` (`useShareProject` return type), `lib/copy.ts` (`shareModal.garmSyncFailed`), `components/builder/BuilderProjectView.tsx` + `app/dashboard/page.tsx` (render the warning).

---

### Task 1: Unknown-principal denial detector

**Why.** The maker was denied on three separate days and every signal read as noise. Our store *could* have told us instantly: the presented address had no `project_members` row and no `approved_emails` row anywhere — "someone knocking with the wrong key," not drift. The reconcile diff cannot see this (nothing is missing). Two classes matter and deserve different alerts:
- `unknown-principal` — no membership, no approved row → aliasing case (#169) or a stranger. Not a bug in our mirror.
- `known-member` — membership/approval exists but Garm denied → the grant is missing or wrong. **This is the dual-write-drop class**; the reconcile will heal it within the hour, but we want the log line now.

**Files:**
- Create: `lib/garm-denials.ts`
- Test: `lib/__tests__/garm-denials.test.ts`
- Modify: `app/api/approved-emails/route.ts:15-18`
- Test: `app/api/approved-emails/__tests__/deny-recorder.test.ts` (new)
- Modify: `app/api/cron/garm-reconcile/route.ts` (summary object, ~line 310-325) and `app/api/cron/garm-reconcile/__tests__/route.test.ts`

**Interfaces (Produces):**
```ts
// lib/garm-denials.ts
export type GarmDenialKind = 'unknown-principal' | 'known-member'
export function classifyGarmDenial(input: { hasMembership: boolean; hasApproved: boolean }): GarmDenialKind
export function hashPrincipal(normalizedEmail: string): string            // sha256 hex, 64 chars
export async function recordGarmDenial(rawEmail: string): Promise<void>   // never throws
export async function countRecentGarmDenials(db: FirebaseFirestore.Firestore, sinceIso: string): Promise<{ unknownPrincipal: number; knownMember: number }> // never throws; zeros on error
export function scheduleGarmDenialRecord(email: string): void             // after()-wrapped recordGarmDenial
```

Firestore collection `garm_denials`, doc id = `hashPrincipal(email)`, shape:
`{ kind, has_membership, has_approved, count, first_seen, last_seen }` — **no address field, ever.**

- [ ] **Step 1: Write the failing tests for the pure pieces**

`lib/__tests__/garm-denials.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firestore mocked module-wide, same pattern as lib/__tests__/garm-grants.test.ts
const docSet = vi.fn(async () => {})
const docGet = vi.fn()
let memberDocs: { data: () => Record<string, unknown> }[] = []
let approvedExists = false
let approvedRevoked = false
let denialDocs: { data: () => Record<string, unknown> }[] = []
const mockCollection = vi.fn((name: string) => {
  if (name === 'project_members') return { where: () => ({ get: async () => ({ docs: memberDocs }) }) }
  if (name === 'approved_emails') return { doc: () => ({ get: async () => ({ exists: approvedExists, data: () => ({ revoked_at: approvedRevoked ? '2026-01-01' : null }) }) }) }
  if (name === 'garm_denials') return {
    doc: (id: string) => ({ id, get: docGet, set: docSet }),
    where: () => ({ get: async () => ({ docs: denialDocs }) }),
  }
  throw new Error('unexpected collection ' + name)
})
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => ({ collection: mockCollection }) }))

import { classifyGarmDenial, hashPrincipal, recordGarmDenial, countRecentGarmDenials } from '../garm-denials'

describe('classifyGarmDenial', () => {
  it('no membership + no approved row → unknown-principal', () => {
    expect(classifyGarmDenial({ hasMembership: false, hasApproved: false })).toBe('unknown-principal')
  })
  it('membership present → known-member (grant missing or wrong)', () => {
    expect(classifyGarmDenial({ hasMembership: true, hasApproved: false })).toBe('known-member')
  })
  it('approved row present → known-member', () => {
    expect(classifyGarmDenial({ hasMembership: false, hasApproved: true })).toBe('known-member')
  })
})

describe('hashPrincipal', () => {
  it('is a 64-char hex sha256 that does not contain the address', () => {
    const h = hashPrincipal('sam@example.com')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain('sam')
  })
  it('is stable', () => {
    expect(hashPrincipal('sam@example.com')).toBe(hashPrincipal('sam@example.com'))
  })
})

describe('recordGarmDenial', () => {
  beforeEach(() => {
    docSet.mockClear(); docGet.mockReset(); memberDocs = []; approvedExists = false; approvedRevoked = false
    docGet.mockResolvedValue({ exists: false, data: () => undefined })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('writes an unknown-principal doc keyed by hash, count 1, no address anywhere', async () => {
    await recordGarmDenial('Sam@Example.com ')
    expect(docSet).toHaveBeenCalledTimes(1)
    const [payload] = docSet.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(payload).toMatchObject({ kind: 'unknown-principal', has_membership: false, has_approved: false, count: 1 })
    expect(JSON.stringify(payload)).not.toMatch(/example\.com/)
    expect(mockCollection).toHaveBeenCalledWith('garm_denials')
  })

  it('treats a removed membership row as no membership', async () => {
    memberDocs = [{ data: () => ({ removed_at: '2026-01-01' }) }]
    await recordGarmDenial('sam@example.com')
    const [payload] = docSet.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(payload).toMatchObject({ kind: 'unknown-principal' })
  })

  it('treats a revoked approved row as not approved', async () => {
    approvedExists = true; approvedRevoked = true
    await recordGarmDenial('sam@example.com')
    const [payload] = docSet.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(payload).toMatchObject({ kind: 'unknown-principal' })
  })

  it('classifies known-member and logs at error level', async () => {
    memberDocs = [{ data: () => ({ removed_at: null }) }]
    await recordGarmDenial('sam@example.com')
    const [payload] = docSet.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(payload).toMatchObject({ kind: 'known-member', has_membership: true })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[garm-denial] known-member'))
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(' ')
    expect(logged).not.toMatch(/example\.com/)
  })

  it('increments count and preserves first_seen on a repeat', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({ count: 2, first_seen: '2026-08-20T00:00:00.000Z' }) })
    await recordGarmDenial('sam@example.com')
    const [payload] = docSet.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(payload).toMatchObject({ count: 3, first_seen: '2026-08-20T00:00:00.000Z' })
  })

  it('never throws when Firestore fails', async () => {
    docGet.mockRejectedValue(new Error('firestore down'))
    await expect(recordGarmDenial('sam@example.com')).resolves.toBeUndefined()
  })
})

describe('countRecentGarmDenials', () => {
  it('sums by kind', async () => {
    denialDocs = [
      { data: () => ({ kind: 'unknown-principal' }) },
      { data: () => ({ kind: 'unknown-principal' }) },
      { data: () => ({ kind: 'known-member' }) },
    ]
    const db = { collection: mockCollection } as unknown as FirebaseFirestore.Firestore
    await expect(countRecentGarmDenials(db, '2026-08-21T00:00:00.000Z')).resolves.toEqual({ unknownPrincipal: 2, knownMember: 1 })
  })
  it('returns zeros and does not throw on a read error', async () => {
    const db = { collection: () => ({ where: () => ({ get: async () => { throw new Error('x') } }) }) } as unknown as FirebaseFirestore.Firestore
    await expect(countRecentGarmDenials(db, '2026-08-21T00:00:00.000Z')).resolves.toEqual({ unknownPrincipal: 0, knownMember: 0 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/garm-denials.test.ts`
Expected: FAIL — cannot resolve `../garm-denials`.

- [ ] **Step 3: Implement `lib/garm-denials.ts`**

```ts
import { createHash } from 'crypto'
import { after } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { normalizeEmail } from '@/lib/email/normalize'

// =============================================================================
// Garm denial recorder (follow-on to PR #175; see
// docs/superpowers/plans/2026-08-22-garm-denial-detector-and-await-invite-grant.md).
//
// A denial names the principal that was PRESENTED, not the person. The 2026-08-22
// lockout was a maker signing in with an address our store had never seen — the
// reconcile diff was clean because nothing was missing. Two classes, two alerts:
//
//   unknown-principal  no membership, no approved row → aliasing (#169) or a
//                      stranger. Not a mirror bug. Warn.
//   known-member       we know them, Garm said no → grant missing/wrong; the
//                      reconcile cron heals within the hour. Error.
//
// PII: docs are keyed by sha256(normalized email) and store NO address. Log lines
// carry the kind + booleans only.
// =============================================================================

export type GarmDenialKind = 'unknown-principal' | 'known-member'

export function classifyGarmDenial(input: { hasMembership: boolean; hasApproved: boolean }): GarmDenialKind {
  return input.hasMembership || input.hasApproved ? 'known-member' : 'unknown-principal'
}

export function hashPrincipal(normalizedEmail: string): string {
  return createHash('sha256').update(normalizedEmail).digest('hex')
}

/** Best-effort. Never throws; never changes the sign-in answer. */
export async function recordGarmDenial(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail)
  if (!email) return
  try {
    const db = getAdminDb()
    const [memberSnap, approvedDoc] = await Promise.all([
      db.collection('project_members').where('email', '==', email).get(),
      db.collection('approved_emails').doc(email).get(),
    ])
    const hasMembership = memberSnap.docs.some((d) => !d.data().removed_at)
    const hasApproved = approvedDoc.exists && !approvedDoc.data()?.revoked_at
    const kind = classifyGarmDenial({ hasMembership, hasApproved })

    const ref = db.collection('garm_denials').doc(hashPrincipal(email))
    const prior = await ref.get()
    const priorData = prior.exists ? (prior.data() as { count?: number; first_seen?: string } | undefined) : undefined
    const now = new Date().toISOString()
    const count = (priorData?.count ?? 0) + 1
    await ref.set({
      kind,
      has_membership: hasMembership,
      has_approved: hasApproved,
      count,
      first_seen: priorData?.first_seen ?? now,
      last_seen: now,
    })

    const line = `[garm-denial] ${kind} has_membership=${hasMembership} has_approved=${hasApproved} count=${count}`
    if (kind === 'known-member') console.error(line)
    else console.warn(line)
  } catch (err) {
    console.warn(`[garm-denial] record failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Denials seen since `sinceIso`, by kind. Zeros on any error — a reporting helper must never take down its caller. */
export async function countRecentGarmDenials(
  db: FirebaseFirestore.Firestore,
  sinceIso: string
): Promise<{ unknownPrincipal: number; knownMember: number }> {
  try {
    const snap = await db.collection('garm_denials').where('last_seen', '>=', sinceIso).get()
    let unknownPrincipal = 0
    let knownMember = 0
    for (const d of snap.docs) {
      if (d.data().kind === 'known-member') knownMember++
      else unknownPrincipal++
    }
    return { unknownPrincipal, knownMember }
  } catch {
    return { unknownPrincipal: 0, knownMember: 0 }
  }
}

/** Off the sign-in hot path, same after()-with-fallback shape as lib/garm-shadow.ts. */
export function scheduleGarmDenialRecord(email: string): void {
  try {
    after(() => recordGarmDenial(email))
  } catch {
    void recordGarmDenial(email)
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/__tests__/garm-denials.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/garm-denials.ts lib/__tests__/garm-denials.test.ts
git commit -m "Record and classify Garm sign-in denials (unknown-principal vs known-member), counts-only"
```

- [ ] **Step 6: Failing route test — the gate schedules the recorder on deny only**

Create `app/api/approved-emails/__tests__/deny-recorder.test.ts`. Copy the mock scaffolding style from the sibling `garm-sync.test.ts` in the same directory (mock `@/lib/api/firebase-server-helpers` for `getAuthenticatedUser`, `isApprovedEmail`, `getAdminDb`, `hasSystemRole`). Add:

```ts
const scheduleGarmDenialRecordMock = vi.fn()
vi.mock('@/lib/garm-denials', () => ({
  scheduleGarmDenialRecord: (...args: unknown[]) => scheduleGarmDenialRecordMock(...args),
}))
vi.mock('@/lib/garm-grants', () => ({ scheduleGarmGrantSync: vi.fn() }))

describe('GET /api/approved-emails — denial recorder', () => {
  it('schedules the recorder with the presented email when not approved', async () => {
    vi.mocked(isApprovedEmail).mockResolvedValueOnce(false)
    const res = await GET(new Request('http://x/api/approved-emails'))
    expect(res.status).toBe(200)                       // existing contract: body says approved:false
    expect(scheduleGarmDenialRecordMock).toHaveBeenCalledWith('sam@example.com')
  })
  it('does not schedule the recorder when approved', async () => {
    vi.mocked(isApprovedEmail).mockResolvedValueOnce(true)
    await GET(new Request('http://x/api/approved-emails'))
    expect(scheduleGarmDenialRecordMock).not.toHaveBeenCalled()
  })
})
```
(Read the existing GET body/status shape in `app/api/approved-emails/route.ts` first and assert the *existing* status — do not change the response contract.)

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run app/api/approved-emails/__tests__/deny-recorder.test.ts` → FAIL (recorder never called).

- [ ] **Step 8: Wire it in `app/api/approved-emails/route.ts`**

After `const approved = await isApprovedEmail(auth.email, auth.systemRoles)`:
```ts
  // Denial detector (see lib/garm-denials.ts): a "no" here is the only place a
  // locked-out person surfaces. Off the hot path; never changes the answer.
  if (!approved) scheduleGarmDenialRecord(auth.email)
```
plus the import `import { scheduleGarmDenialRecord } from '@/lib/garm-denials'`.

- [ ] **Step 9: Run → PASS; then run the whole approved-emails test dir to confirm nothing else broke**

Run: `npx vitest run app/api/approved-emails` → PASS.

- [ ] **Step 10: Commit**

```bash
git add app/api/approved-emails/route.ts app/api/approved-emails/__tests__/deny-recorder.test.ts
git commit -m "Schedule the Garm denial recorder when the sign-in gate says no"
```

- [ ] **Step 11: Failing reconcile test — log row and response carry 24h denial counts**

In `app/api/cron/garm-reconcile/__tests__/route.test.ts`, add to the `mockCollection` switch:
```ts
  if (name === 'garm_denials') {
    return { where: () => ({ get: async () => ({ docs: mockDenials }) }) }
  }
```
with `let mockDenials: { data: () => Record<string, unknown> }[] = []` reset in `beforeEach`. Add a test in the no-drift describe:
```ts
  it('reports 24h denial counts by kind in the log row and response', async () => {
    mockDenials = [
      { data: () => ({ kind: 'unknown-principal' }) },
      { data: () => ({ kind: 'known-member' }) },
      { data: () => ({ kind: 'known-member' }) },
    ]
    const res = await GET(authorizedRequest())
    const body = await res.json()
    expect(body).toMatchObject({ denials_24h_unknown_principal: 1, denials_24h_known_member: 2 })
    expect(lastLogDoc()).toMatchObject({ denials_24h_unknown_principal: 1, denials_24h_known_member: 2 })
  })
```
(Use whatever the file already names its authorized-request and last-log-doc helpers.) Also assert in the existing "skipped when dual-write off" test that the two fields are present and `0` — the paused run still reports denials; a paused reconciler is exactly when a human most needs that number.

- [ ] **Step 12: Run → FAIL (fields absent)**

- [ ] **Step 13: Implement in `app/api/cron/garm-reconcile/route.ts`**

Import `countRecentGarmDenials` from `@/lib/garm-denials`. Immediately before the `summary` object is built (outside the dual-write `if/else`, so it runs on paused runs too):
```ts
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const denials = await countRecentGarmDenials(db, since)
```
and add to `summary`:
```ts
    denials_24h_unknown_principal: denials.unknownPrincipal,
    denials_24h_known_member: denials.knownMember,
```
Add a one-line comment above: `// Denial counts (lib/garm-denials.ts): the reconcile log is where a human looks after an incident, so the "wrong key" signal the diff cannot see rides along here.`

- [ ] **Step 14: Run the full reconcile test file → PASS**

Run: `npx vitest run app/api/cron/garm-reconcile`

- [ ] **Step 15: Gate + commit**

Run: `npm test` (all green), `npm run lint`, `npm run build`. Then:
```bash
git add app/api/cron/garm-reconcile
git commit -m "Reconcile log carries 24h Garm denial counts by kind"
```

---

### Task 2: Invite path awaits its Garm grant and surfaces failure (#174)

**Why.** `scheduleGarmGrantSync` is fire-and-forget with a swallowed catch. On the invite/share POST — a builder-initiated action, not a hot path — 2s of waiting is cheap and a visible warning at invite time beats the invitee discovering the problem days later. Scope: **POST `/api/projects/share` only.** PATCH (rekey), project create, member role change, approved-emails writes stay fire-and-forget behind the reconcile.

**Rejected:** healing at sign-in (consult Firestore when Garm denies). That recreates the local fallback authority PR G removed.

**Files:**
- Modify: `lib/garm-grants.ts:151-188` (`syncGarmGrantForEmail` returns an outcome)
- Test: `lib/__tests__/garm-grants.test.ts`
- Modify: `app/api/projects/share/route.ts:163-174` (POST only)
- Test: `app/api/projects/__tests__/share-garm-sync.test.ts`
- Modify: `lib/query/hooks.ts:87-113`, `lib/copy.ts` (`shareModal`), `components/builder/BuilderProjectView.tsx` (~line 1122 and the confirmation block), `app/dashboard/page.tsx` (~line 613)

**Interfaces (Produces):**
```ts
// lib/garm-grants.ts
export type GarmSyncOutcome = 'synced' | 'skipped' | 'failed'
//   synced  — Garm accepted the upsert/revoke
//   skipped — GARM_DUAL_WRITE off, or blank email (nothing to do; not a warning)
//   failed  — Firestore read or Garm request failed (logged; caller may warn)
export async function syncGarmGrantForEmail(rawEmail: string): Promise<GarmSyncOutcome>
// scheduleGarmGrantSync(email): void — unchanged

// POST /api/projects/share response gains:
//   garm_sync: GarmSyncOutcome
```

- [ ] **Step 1: Failing tests for the outcome**

In `lib/__tests__/garm-grants.test.ts`, inside the existing `syncGarmGrantForEmail` describe (reuse its fetch/Firestore mocks and env setup exactly as the neighbors do):
```ts
  it('resolves "synced" when Garm accepts the upsert', async () => {
    // arrange like the existing "upserts viewer" case
    await expect(syncGarmGrantForEmail('sam@example.com')).resolves.toBe('synced')
  })
  it('resolves "failed" (and does not throw) when Garm returns 500', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(syncGarmGrantForEmail('sam@example.com')).resolves.toBe('failed')
  })
  it('resolves "failed" when the Firestore read throws', async () => { /* make the members query reject */ 
    await expect(syncGarmGrantForEmail('sam@example.com')).resolves.toBe('failed')
  })
  it('resolves "skipped" when GARM_DUAL_WRITE is off', async () => {
    delete process.env.GARM_DUAL_WRITE
    await expect(syncGarmGrantForEmail('sam@example.com')).resolves.toBe('skipped')
  })
  it('resolves "skipped" for a blank email', async () => {
    await expect(syncGarmGrantForEmail('   ')).resolves.toBe('skipped')
  })
```
Adapt variable names (`fetchMock`, env handling) to what the file already uses — read it first.

- [ ] **Step 2: Run → FAIL** (`resolves.toBe('synced')` gets `undefined`).

- [ ] **Step 3: Implement**

In `lib/garm-grants.ts`: add `export type GarmSyncOutcome = 'synced' | 'skipped' | 'failed'`; change the signature to `Promise<GarmSyncOutcome>`; `return 'skipped'` at both early returns; `return 'synced'` after the upsert/revoke; `return 'failed'` in the catch after the existing warn. Update the doc comment: "Resolves with an outcome instead of void so a caller that *wants* to know (the invite path, #174) can warn; fire-and-forget callers ignore it."

- [ ] **Step 4: Run → PASS**; then `npx vitest run lib/__tests__/garm-grants.test.ts` whole file.

- [ ] **Step 5: Commit**

```bash
git add lib/garm-grants.ts lib/__tests__/garm-grants.test.ts
git commit -m "syncGarmGrantForEmail reports synced/skipped/failed instead of void"
```

- [ ] **Step 6: Failing route tests — POST awaits and reports; PATCH still schedules**

In `app/api/projects/__tests__/share-garm-sync.test.ts`, change the `@/lib/garm-grants` mock to:
```ts
const scheduleGarmGrantSyncMock = vi.fn()
const syncGarmGrantForEmailMock = vi.fn(async () => 'synced' as const)
vi.mock('@/lib/garm-grants', () => ({
  scheduleGarmGrantSync: (...args: unknown[]) => scheduleGarmGrantSyncMock(...args),
  syncGarmGrantForEmail: (...args: unknown[]) => syncGarmGrantForEmailMock(...args),
}))
```
Replace the existing POST assertion (that `scheduleGarmGrantSync` was called with the invitee) with:
```ts
  it('POST awaits the Garm sync for the invitee and returns garm_sync: synced', async () => {
    const res = await POST(shareRequest({ project_id: 'p1', email: 'Sam@Example.com' }))
    expect(res.status).toBe(200)
    expect(syncGarmGrantForEmailMock).toHaveBeenCalledWith('sam@example.com')
    expect(scheduleGarmGrantSyncMock).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({ email: 'sam@example.com', garm_sync: 'synced' })
  })
  it('POST still creates membership and returns 200 with garm_sync: failed when Garm fails', async () => {
    syncGarmGrantForEmailMock.mockResolvedValueOnce('failed')
    const res = await POST(shareRequest({ project_id: 'p1', email: 'sam@example.com' }))
    expect(res.status).toBe(200)
    expect(memberAdds).toHaveLength(1)
    await expect(res.json()).resolves.toMatchObject({ garm_sync: 'failed' })
  })
  it('POST returns garm_sync: skipped when the dual-write is off (no warning case)', async () => {
    syncGarmGrantForEmailMock.mockResolvedValueOnce('skipped')
    const res = await POST(shareRequest({ project_id: 'p1', email: 'sam@example.com' }))
    await expect(res.json()).resolves.toMatchObject({ garm_sync: 'skipped' })
  })
```
Keep the PATCH tests asserting `scheduleGarmGrantSyncMock` for both new and old email, unchanged. (Use the file's existing request-builder helper name instead of `shareRequest` if it differs.) Also fix `app/api/projects/__tests__/share-post.test.ts` if it mocks `@/lib/garm-grants` without `syncGarmGrantForEmail` — add it to that mock too.

- [ ] **Step 7: Run → FAIL**

- [ ] **Step 8: Implement in `app/api/projects/share/route.ts` POST**

Replace
```ts
  scheduleGarmGrantSync(normalizedEmail)

  return NextResponse.json({
    email: normalizedEmail,
    project_id,
    reset_link: resetLink,
  })
```
with
```ts
  // #174: the invite is builder-initiated, not a hot path — AWAIT the Garm grant
  // so a failure is visible to the person who can act on it, instead of the
  // invitee discovering it days later. The Firestore membership above is already
  // committed and is never unwound by this; a failure is a warning, not an error.
  const garmSync = await syncGarmGrantForEmail(normalizedEmail)

  return NextResponse.json({
    email: normalizedEmail,
    project_id,
    reset_link: resetLink,
    garm_sync: garmSync,
  })
```
Import `syncGarmGrantForEmail` alongside `scheduleGarmGrantSync` (PATCH still uses the latter).

- [ ] **Step 9: Run `npx vitest run app/api/projects` → PASS**

- [ ] **Step 10: Commit**

```bash
git add app/api/projects/share/route.ts app/api/projects/__tests__
git commit -m "Invite path awaits its Garm grant and reports the outcome (#174)"
```

- [ ] **Step 11: Hook type + copy**

`lib/query/hooks.ts` `useShareProject` return type: add `garm_sync: 'synced' | 'skipped' | 'failed'` (import the `GarmSyncOutcome` type from `@/lib/garm-grants` — type-only import: `import type { GarmSyncOutcome } from '@/lib/garm-grants'`; a type import pulls no server code into the client bundle).

`lib/copy.ts` `shareModal`: add
```ts
    garmSyncFailed:
      "Invited, but the sign-in permission didn't register. They may not be able to sign in yet — it will self-heal within the hour, or re-share to retry now.",
```

- [ ] **Step 12: Render the warning in both modals**

`components/builder/BuilderProjectView.tsx`, in the share modal right after `const resetLink = shareProject.data?.reset_link ?? null`:
```tsx
  const garmSyncFailed = shareProject.data?.garm_sync === 'failed'
```
and as the first child inside the `showConfirmation` `<div className="space-y-3">`:
```tsx
          {garmSyncFailed && <StatusMessage type="warning" message={copy.shareModal.garmSyncFailed} />}
```
`app/dashboard/page.tsx` share modal, directly under the existing `<StatusMessage type="success" …/>`:
```tsx
          {shareProject.data?.garm_sync === 'failed' && (
            <StatusMessage type="warning" message={copy.shareModal.garmSyncFailed} />
          )}
```
(`StatusMessage` already supports `'warning'`.)

- [ ] **Step 13: Gate**

Run: `npm run build` (catches the client-bundle import and Next route-export rules), `npm test`, `npm run lint`. All three must pass; paste output.

- [ ] **Step 14: Commit**

```bash
git add lib/query/hooks.ts lib/copy.ts components/builder/BuilderProjectView.tsx app/dashboard/page.tsx
git commit -m "Share modals warn when the invitee's Garm grant did not land"
```

---

### Task 3: Docs + issue close-out

**Files:**
- Modify: `CLAUDE.md` (Data Model: add `garm_denials`; Next Steps: one line), `docs/reliability-hardening-plan.md` header ("follow-on work" sentence → link to this plan, mark done)
- Modify: issue #174 (comment + close on merge — done by the PR via `Closes #174` in the PR body, not by hand)

- [ ] **Step 1:** In `CLAUDE.md` Data Model list add: `- **garm_denials** — counts-only record of sign-in denials keyed by sha256(email); kind unknown-principal | known-member (lib/garm-denials.ts). No addresses.` and under Data Model `garm_reconcile_log` if listed, note the two denial fields.
- [ ] **Step 2:** In `docs/reliability-hardening-plan.md` header paragraph replace "that detector and the invite-path fix (#174) are follow-on work, not part of this plan" with "both shipped in the follow-on plan `docs/superpowers/plans/2026-08-22-garm-denial-detector-and-await-invite-grant.md`".
- [ ] **Step 3:** `git commit -m "docs: garm_denials collection + plan cross-links"`.

---

## Self-review

- Spec coverage: #174 criteria (grant created before response ✔ Task 2 step 8; Garm-unreachable still 200 + warning ✔ tests step 6; UI renders warning ✔ step 12; tests both paths ✔). Detector: distinct alert per class ✔, surfaced where humans look ✔ (reconcile row), no PII ✔ (hash + booleans).
- Placeholders: none; every step has code. The "read the file first and adapt helper names" notes are deliberate — the implementer sees the real file, the plan should not invent helper names that may not exist.
- Type consistency: `GarmSyncOutcome` used in route, hook, tests; `GarmDenialKind` names match between classifier, recorder, and reconcile fields (`denials_24h_unknown_principal`, `denials_24h_known_member`).
