# Firestore Quota Incident & Cleanup Plan

**Status:** Open — Blaze upgrade applied 2026-05-13 ~11:35 PT, awaiting propagation. Code fixes pending.

## What happened

On 2026-05-12 the Firebase project (Spark/free plan) hit the daily Firestore read cap (50K/day). Symptom in the app: every authenticated API call returned `{"error":"Invalid token"}` with status 401.

Root cause was **masked** by a misleading log message. The `try` block in `getAuthenticatedUser` (`lib/api/firebase-server-helpers.ts`) wraps both `verifyIdToken(token)` AND a downstream Firestore read of the `users` doc. When Firestore rejected the read with `RESOURCE_EXHAUSTED: Quota exceeded`, the bare catch logged `[auth] verifyIdToken failed:` and returned 401 — making it look like an auth/token problem.

That misattribution cost roughly 12 hours of debugging on 2026-05-12→13. Diagnostic logging (`c7d9b2d`) was added to expose the actual error, which is what finally revealed `code: 8 RESOURCE_EXHAUSTED`.

Reset happens at midnight Pacific (Firestore daily counter); that's why it "self-resolved" overnight and re-broke the next day.

## Why we hit 50K reads/day

Firebase usage chart (screenshotted 2026-05-13) shows ~0 reads/day for a week, then ~50K on May 12. Volume jumped, not a code regression — but the codebase was already read-heavy and ready to tip.

Audit of read hot paths:

1. **`/api/projects` GET** — biggest offender. `enrichProjects` in `app/api/projects/route.ts:33-126` fans out, per project:
   - All sessions of the project (unbounded `.get()`)
   - Messages in chunks of 30 sessions with `.limit(10)` *per chunk* (so up to 10 reads per chunk, not per result)
   - Latest brief
   - For a user with 10 projects × 3 sessions, ~50 reads per call. React Query `staleTime` is 1 min so dashboard refreshes drive this hard.
2. **`getAuthenticatedUser`** (`lib/api/firebase-server-helpers.ts:114-157`) — reads the `users` doc on every API call to enrich `system_roles`. +1 read per request.
3. **`retry: 1`** in `lib/query/query-client.ts:8` — when Firestore started 429ing, client retries doubled the burn.
4. **`useRealtimeMessages`** (`lib/hooks/useRealtimeMessages.ts`) — onSnapshot listener; not the culprit but worth keeping in mind (initial subscribe reads all matching docs).

## Immediate state (where to pick up)

- **Blaze plan**: active (verified in Firebase console screenshot 2026-05-13 11:35 PT). 50K/day free tier still applies; reads beyond are billed at ~$0.06/100K.
- **Quota propagation**: at the time of this writeup, Vercel `/api/users/me` was still returning `Invalid token` (Firestore still quota-blocking). Typical lag 5–15 min after Spark→Blaze flip.
- **No code fixes deployed yet** beyond the diagnostic logging from this morning.

### How to check if Blaze has propagated

Run this from your terminal — if you see a real JSON response (your user object) instead of `{"error":"Invalid token"}`, we're unblocked:

```bash
# Use a fresh Firebase ID token from your browser's Authorization header
curl -s -H "Authorization: Bearer <fresh-token>" https://ibuild4you.com/api/users/me
```

Easier: just reload ibuild4you.com. If the dashboard loads normally, we're unblocked.

If it's still `Invalid token` after ~15 min, check `[auth]` entries in Vercel function logs (dashboard → Logs):
- Still `RESOURCE_EXHAUSTED: Quota exceeded` → propagation still pending or there's a different quota being hit. Wait longer, or check Firebase console > Firestore > Usage for the current minute's read rate.
- Anything else → different problem, treat as new incident.

## Fixes to ship (in order)

### Priority 1 — Stop the misleading error (15 min, ships independently)

Split the try/catch in `getAuthenticatedUser` so token verification errors and Firestore errors are distinguishable and have different HTTP statuses.

File: `lib/api/firebase-server-helpers.ts:114-157`

Shape:
```ts
let decoded
try {
  decoded = await getAdminAuth().verifyIdToken(token)
} catch (err) {
  console.error('[auth] verifyIdToken failed:', err)
  return { uid: null, email: null, error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) }
}

try {
  // Firestore reads here — system_roles enrichment
} catch (err) {
  console.error('[auth] Firestore read failed in user enrichment:', err)
  return { uid: null, email: null, error: NextResponse.json({ error: 'Service unavailable' }, { status: 503 }) }
}
```

503 (not 401) on Firestore failures stops the client from treating it as an auth problem (no "not approved" gate redirect, useApproval won't cache false).

### Priority 2 — Cut the `/api/projects` read fan-out (30 min)

File: `app/api/projects/route.ts`, `enrichProjects` function (lines 33-126).

Quickest wins:
1. Replace the messages-per-chunk loop with **one query per project** for the most-recent message:
   ```ts
   await db.collection('messages')
     .where('session_id', 'in', sessionIds.slice(0, 30))  // cap to single chunk
     .orderBy('created_at', 'desc')
     .limit(1)
     .get()
   ```
   We only need `last_message_at` / `last_message_by` and `last_maker_message_at`. The current code reads 10 per chunk × N chunks just to find the latest. One read per project suffices for `last_message_at`. Maker-specific message may need a separate `where('role','==','user')` query but that's still 2 reads per project, not 10×.
2. **Drop session enumeration entirely if not needed for the response.** `session_count` can be a denormalized field on the project doc, written by the session creation endpoint. `has_active_session` similarly.
3. **Skip enrichment in the slug lookup branch** (`useResolveProject`). When fetching a single project by slug, return just the project doc — don't enrich.

Expected impact: 5–10x reduction on dashboard load reads.

### Priority 3 — Cache the user doc read in `getAuthenticatedUser` (15 min)

`getAuthenticatedUser` reads `users/<uid>` on every request to pull `system_roles`. Fluid Compute reuses function instances, so an in-memory `Map<uid, {roles, fetchedAt}>` with a short TTL (60s) eliminates most repeat reads from the same logged-in user.

```ts
const userCache = new Map<string, { roles: SystemRole[]; expiresAt: number }>()
// in getAuthenticatedUser, check cache before Firestore read
```

For admins specifically: the existing `isAdminEmail` fallback already short-circuits the read for the two hardcoded admin emails. The cache is for non-admins.

### Priority 4 — Synthetic monitoring & read-count test (1–2 hrs)

Two parts:

**Synthetic auth check** (replaces the silent failure mode the user-experience suffered). Extend `.github/workflows/synthetic-monitoring.yml` (existing job) to mint a service-account ID token and hit `/api/users/me`. Alert on 401/503. Runs every 2 hours.

**Read budget test**. Extend the existing `app/api/projects/__tests__/` patterns to count mocked Firestore calls. Assert `enrichProjects` issues ≤ N reads for K projects. Catches regressions before deploy.

Both deferred — get Priorities 1-3 in first.

## Open decisions for next session

- Whether to denormalize `session_count` and `last_message_at` onto the project doc, or accept the runtime read cost with the better-bounded query in P2.1 above. Denorm is faster but adds write paths to maintain. Recommend denorm given the read pressure profile.
- Whether to also reduce `useRealtimeMessages` to fetch-on-mount + invalidate-on-message-send, skipping onSnapshot. (Saves: continuous Firestore listening cost during chat sessions. Cost: latency on new messages.) Worth measuring first.
- Whether to put a CDN cache (Vercel Edge Config or similar) in front of `/api/users/me` for short TTLs. Probably overkill.

## References

- Diagnostic logging commit: `c7d9b2d`
- Sign-out button on gate (orthogonal — for users locked out by `not-approved` redirect): `43396df`
- Cleanup test data script (orthogonal — used today): `d3e869b` → `scripts/cleanup-test-data.mjs`
- Firebase project: `ibuild4you-a0c4d`
- Blaze plan flipped: 2026-05-13 ~11:30 PT
