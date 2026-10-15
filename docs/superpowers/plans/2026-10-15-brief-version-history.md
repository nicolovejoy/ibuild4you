# Brief Version History (#194) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every prior version of a brief so a bad regen (or paste) can be rolled back from the Brief tab.

**Architecture:** `upsertBrief` archives the outgoing live brief into a `briefs/{id}/versions/{version}` subcollection before overwriting it, and stamps the live doc with a `source` (`create` | `paste` | `regen` | `restore`). A new `GET /api/briefs/versions?project_id=` lists archived versions (builder+). Restore reuses the existing `PUT /api/briefs` with the archived content and `source: 'restore'`, so provenance stamping and lock handling behave exactly like a paste. A small `BriefHistory` component under the brief's read view lists versions (Pacific time, source) with a two-step Restore.

**Tech Stack:** Next.js App Router routes, Firebase Admin SDK (subcollection), React Query, vitest (+ jsdom for the component).

**Spec:** GitHub issue #194 (`gh issue view 194`): *"On every `upsertBrief` that replaces existing content, first write the outgoing `{content, version, updated_at, source}` to a `briefs/{id}/versions/{version}` subcollection. Keep it to the last 50 or so, or let it grow (briefs are small). `source` = `regen` | `paste` | `create`, so the history shows who changed what. Builder-side: a "History" list on the Brief tab showing version, time (Pacific), source, with a "Restore" that pastes that version back through the normal PUT (so provenance stamping and locks behave as a paste). No change to the model prompt or regen gate."*

## Global Constraints

- All Firestore access via API routes + Admin SDK; the client never reads the subcollection directly.
- `BriefSource = 'create' | 'paste' | 'regen' | 'restore'`. Every writer sets it: project create → `create`; `PUT /api/briefs` → `paste` unless the body carries `source: 'restore'`; `regenerateBriefForProject` → `regen`.
- Archive doc path: `briefs/{briefDocId}/versions/{version}` where `{version}` is the **outgoing** live version number as a string. Fields: `{ version, content, updated_at, source, archived_at }` (`updated_at` = the outgoing doc's `updated_at`, falling back to `created_at`; `source` = the outgoing doc's `source`, `null` for briefs written before this change; `archived_at` = now ISO). No retention cap (ruling: briefs are small; the issue allows it).
- Versions list: newest first, `limit 50`, includes `content` (needed for Restore; briefs are a few KB). Builder+ only (`requireRole(role, 'builder')`), 404 when no role, 400 when `project_id` missing, `{ versions: [] }` when the project has no brief.
- "UTC at rest, Pacific on display": timestamps stored ISO UTC; the History list renders with `formatPacific` from `lib/email/format.ts`.
- All builder-facing strings in `lib/copy.ts` under `brief`.
- No change to the model prompt, regen gate, or regen cadence.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Before claiming clean: `npm run build` (needs dummy `NEXT_PUBLIC_FIREBASE_*` in a worktree), `npm test`, `npm run type-check`, `npm run lint`.

## Review Focus

1. First-ever write (no existing brief) must archive nothing and still set `source` — pinned in Task 1.
2. A legacy live doc with no `source` field archives with `source: null`, never throws — pinned in Task 1.
3. Restore of a version whose decisions carry `locked: true` must keep the locks (PUT already preserves `locked === true`) and re-stamp provenance against the current brief — pinned in Task 2 (PUT accepts `source: 'restore'`; lock preservation is existing behaviour, re-asserted).
4. A maker must not be able to list versions (they can read the live brief but history is builder tooling) — pinned in Task 3.
5. Restore must be two-step in the UI (no accidental overwrite) and must refresh both the brief and the history list — pinned in Task 4/5.

---

### Task 1: Archive on overwrite + `source` in `lib/api/briefs.ts`

**Files:**
- Modify: `lib/types/index.ts` (the `Brief` interface, ~line 199; add `BriefSource` + `BriefVersion`)
- Modify: `lib/api/briefs.ts` (`upsertBrief`, ~lines 242–295; the `regenerateBriefForProject` call at ~line 239)
- Modify: `app/api/projects/route.ts` (~line 582, the initial `briefs.add`)
- Test: `lib/api/__tests__/briefs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/types/index.ts
  export type BriefSource = 'create' | 'paste' | 'regen' | 'restore'
  export interface Brief extends BaseEntity { project_id: string; version: number; content: BriefContent; source?: BriefSource }
  export interface BriefVersion { version: number; content: BriefContent; updated_at: string; source: BriefSource | null; archived_at: string }
  // lib/api/briefs.ts
  export async function upsertBrief(db, projectId, briefContent, source: BriefSource)
  ```
  Tasks 2–3 rely on `BriefSource`, `BriefVersion`, and the 4-arg `upsertBrief`.

- [ ] **Step 1: Write the failing tests**

In `lib/api/__tests__/briefs.test.ts`, extend the Firestore mock: give each brief `DocLike` a `ref` with both `update: mockBriefUpdate` and `collection: (name) => ({ doc: (id) => ({ set: mockVersionSet }) })`, where `const mockVersionSet = vi.fn(async () => {})` is declared next to `mockBriefUpdate` and reset in `beforeEach`. Then add a new `describe('upsertBrief — version history (#194)')` that imports `upsertBrief` from `'../briefs'`:

```ts
describe('upsertBrief — version history (#194)', () => {
  const content = { problem: 'New', target_users: '', features: [], constraints: '', additional_context: '', decisions: [], open_risks: [] }

  it('archives the outgoing live brief to versions/{version} before overwriting, and stamps source', async () => {
    briefsByProject['p1'] = [{
      id: 'brief-1',
      data: () => ({ project_id: 'p1', version: 3, content: { problem: 'Old' }, updated_at: '2026-10-01T00:00:00.000Z', source: 'regen' }),
      ref: { update: mockBriefUpdate, collection: () => ({ doc: (id: string) => ({ set: (d: unknown) => mockVersionSet(id, d) }) }) },
    }]
    const result = await upsertBrief(makeDb(), 'p1', content, 'paste')

    expect(mockVersionSet).toHaveBeenCalledTimes(1)
    const [docId, archived] = mockVersionSet.mock.calls[0] as [string, Record<string, unknown>]
    expect(docId).toBe('3')
    expect(archived.version).toBe(3)
    expect(archived.content).toEqual({ problem: 'Old' })
    expect(archived.updated_at).toBe('2026-10-01T00:00:00.000Z')
    expect(archived.source).toBe('regen')
    expect(typeof archived.archived_at).toBe('string')

    expect(mockBriefUpdate).toHaveBeenCalledWith(expect.objectContaining({ version: 4, source: 'paste', content }))
    expect(result.version).toBe(4)
    expect(result.source).toBe('paste')
  })

  it('archives a legacy doc (no source, no updated_at) with source null and created_at as updated_at', async () => {
    briefsByProject['p1'] = [{
      id: 'brief-1',
      data: () => ({ project_id: 'p1', version: 1, content: { problem: 'Old' }, created_at: '2026-09-01T00:00:00.000Z' }),
      ref: { update: mockBriefUpdate, collection: () => ({ doc: (id: string) => ({ set: (d: unknown) => mockVersionSet(id, d) }) }) },
    }]
    await upsertBrief(makeDb(), 'p1', content, 'regen')
    const [, archived] = mockVersionSet.mock.calls[0] as [string, Record<string, unknown>]
    expect(archived.source).toBeNull()
    expect(archived.updated_at).toBe('2026-09-01T00:00:00.000Z')
  })

  it('archives nothing on the first-ever write and stamps source on the new doc', async () => {
    briefsByProject['p1'] = []
    const result = await upsertBrief(makeDb(), 'p1', content, 'paste')
    expect(mockVersionSet).not.toHaveBeenCalled()
    expect(briefAddCalls[0]).toEqual(expect.objectContaining({ version: 1, source: 'paste' }))
    expect(result.source).toBe('paste')
  })
})
```

Also update any existing assertion in this file that checks `mockBriefUpdate` was called with an exact object (add `source: 'regen'` where the regen path is asserted) — grep `mockBriefUpdate).toHaveBeenCalledWith`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/api/__tests__/briefs.test.ts`
Expected: the three new tests FAIL (`upsertBrief` takes 3 args; no `set` call; no `source`).

- [ ] **Step 3: Implement**

`lib/types/index.ts` — next to `Brief`:

```ts
// #194: who produced a brief version. Archived versions carry the source that
// produced THEM, so the history reads "v3 — regen", "v4 — paste".
export type BriefSource = 'create' | 'paste' | 'regen' | 'restore'

export interface Brief extends BaseEntity {
  project_id: string
  version: number
  content: BriefContent
  source?: BriefSource // absent on briefs written before #194
}

// One archived brief version (briefs/{id}/versions/{version}).
export interface BriefVersion {
  version: number
  content: BriefContent
  updated_at: string
  source: BriefSource | null
  archived_at: string
}
```

`lib/api/briefs.ts` — `upsertBrief`:

```ts
// Upsert a brief: update the existing doc in place (increment version) or
// create a new one. `source` records who produced this version (#194).
export async function upsertBrief(
  db: FirebaseFirestore.Firestore,
  projectId: string,
  briefContent: BriefContent,
  source: BriefSource
) {
  const now = new Date().toISOString()
  // ...existing query...
  if (!existingSnap.empty) {
    const existingDoc = existingSnap.docs[0]
    const existing = existingDoc.data()
    const currentVersion = (existing.version as number) || 0
    const newVersion = currentVersion + 1

    // #194: archive the outgoing version first so a bad regen or paste can be
    // rolled back from the Brief tab. Keyed by the outgoing version number;
    // no retention cap — briefs are a few KB.
    await existingDoc.ref.collection('versions').doc(String(currentVersion)).set({
      version: currentVersion,
      content: existing.content ?? null,
      updated_at: (existing.updated_at as string | undefined) ?? (existing.created_at as string | undefined) ?? now,
      source: (existing.source as BriefSource | undefined) ?? null,
      archived_at: now,
    })

    await existingDoc.ref.update({ content: briefContent, version: newVersion, updated_at: now, source })
    return { id: existingDoc.id, project_id: projectId, version: newVersion, content: briefContent, updated_at: now, source }
  } else {
    const docRef = await db.collection('briefs').add({ project_id: projectId, version: 1, content: briefContent, created_at: now, updated_at: now, source })
    return { id: docRef.id, project_id: projectId, version: 1, content: briefContent, created_at: now, updated_at: now, source }
  }
}
```

Import `BriefSource` from `@/lib/types`. In `regenerateBriefForProject` (~line 239): `return upsertBrief(db, projectId, stamped, 'regen')`.

`app/api/projects/route.ts` ~line 582: add `source: 'create',` to the initial `briefs.add({...})` payload.

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run lib/api app/api/projects && npx tsc --noEmit 2>&1 | grep -v build-info | head`
Expected: PASS. Type-check will flag `app/api/briefs/route.ts:115` (3-arg call) — that is Task 2's file; fix it minimally now by passing `'paste'` so the branch compiles, Task 2 refines it.

- [ ] **Step 5: Commit**

```bash
git add lib/types/index.ts lib/api/briefs.ts app/api/projects/route.ts app/api/briefs/route.ts lib/api/__tests__/briefs.test.ts
git commit -m "feat(briefs): archive the outgoing version and stamp source on every upsert (#194)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `PUT /api/briefs` accepts `source: 'restore'`

**Files:**
- Modify: `app/api/briefs/route.ts` (PUT, ~lines 42–118)
- Test: `app/api/briefs/__tests__/briefs.test.ts`

**Interfaces:**
- Consumes: `upsertBrief(db, projectId, content, source)` from Task 1.
- Produces: PUT body `{ project_id, content, source?: 'restore' }`; any other `source` value (or none) → `'paste'`.

- [ ] **Step 1: Write the failing tests**

In `app/api/briefs/__tests__/briefs.test.ts`, inside the PUT describe (find how existing PUT tests build the request and set `mockGetProjectRole`), add:

```ts
  it('upserts with source "paste" by default', async () => {
    mockUpsertBrief.mockResolvedValue({ id: 'b1', version: 2 })
    mockGet.mockResolvedValue({ empty: true })
    const req = new Request('http://localhost/api/briefs', {
      method: 'PUT',
      body: JSON.stringify({ project_id: 'proj1', content: validContent }),
    })
    const res = await PUT(req)
    expect(res.status).toBe(200)
    expect(mockUpsertBrief).toHaveBeenCalledWith(expect.anything(), 'proj1', expect.objectContaining({ problem: 'Need a cafe website' }), 'paste')
  })

  it('upserts with source "restore" when the body says so (#194)', async () => {
    mockUpsertBrief.mockResolvedValue({ id: 'b1', version: 2 })
    mockGet.mockResolvedValue({ empty: true })
    const req = new Request('http://localhost/api/briefs', {
      method: 'PUT',
      body: JSON.stringify({ project_id: 'proj1', content: validContent, source: 'restore' }),
    })
    await PUT(req)
    expect(mockUpsertBrief).toHaveBeenCalledWith(expect.anything(), 'proj1', expect.anything(), 'restore')
  })

  it('ignores an unknown source value and falls back to "paste"', async () => {
    mockUpsertBrief.mockResolvedValue({ id: 'b1', version: 2 })
    mockGet.mockResolvedValue({ empty: true })
    const req = new Request('http://localhost/api/briefs', {
      method: 'PUT',
      body: JSON.stringify({ project_id: 'proj1', content: validContent, source: 'regen' }),
    })
    await PUT(req)
    expect(mockUpsertBrief).toHaveBeenCalledWith(expect.anything(), 'proj1', expect.anything(), 'paste')
  })

  it('a restore keeps locked decisions locked (#71 + #194)', async () => {
    mockUpsertBrief.mockResolvedValue({ id: 'b1', version: 2 })
    mockGet.mockResolvedValue({ empty: true })
    const req = new Request('http://localhost/api/briefs', {
      method: 'PUT',
      body: JSON.stringify({
        project_id: 'proj1',
        content: { ...validContent, decisions: [{ topic: 'Stack', decision: 'Next.js', locked: true }] },
        source: 'restore',
      }),
    })
    await PUT(req)
    const sent = mockUpsertBrief.mock.calls[0][2] as { decisions: { topic: string; locked?: boolean }[] }
    expect(sent.decisions[0]).toEqual(expect.objectContaining({ topic: 'Stack', locked: true }))
  })
```

If existing PUT tests assert `mockUpsertBrief` with exactly three args via `toHaveBeenCalledWith`, add the fourth (`'paste'`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/api/briefs`
Expected: the `source` tests FAIL.

- [ ] **Step 3: Implement**

In PUT: `const { project_id, content, source: rawSource } = body` and, right before the upsert:

```ts
  // #194: the Brief tab's Restore re-submits an archived version through this
  // same path so locks and provenance behave as a paste; only 'restore' is
  // accepted from the client — regen/create are server-side sources.
  const source: BriefSource = rawSource === 'restore' ? 'restore' : 'paste'
  const result = await upsertBrief(db, project_id, briefContent, source)
```

Import `BriefSource` from `@/lib/types`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/api/briefs lib/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/briefs/route.ts app/api/briefs/__tests__/briefs.test.ts
git commit -m "feat(briefs): PUT accepts source=restore (#194)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `GET /api/briefs/versions`

**Files:**
- Create: `app/api/briefs/versions/route.ts`
- Test: `app/api/briefs/versions/__tests__/versions.test.ts`

**Interfaces:**
- Produces: `GET /api/briefs/versions?project_id=X` → `200 { versions: BriefVersion[] }` newest first (max 50); `400` missing project_id; `404` no role; `403` role below builder. Task 5's hook calls this.

- [ ] **Step 1: Write the failing tests**

Create `app/api/briefs/versions/__tests__/versions.test.ts`, mirroring the mock style of `app/api/briefs/__tests__/briefs.test.ts` (same `vi.mock('@/lib/api/firebase-server-helpers', …)` block with `getAuthenticatedUser`, `getAdminDb`, `getProjectRole`, `requireRole`). The Firestore mock must support two chains: `collection('briefs').where().orderBy().limit().get()` for the live doc, and `doc.ref.collection('versions').orderBy('version','desc').limit(50).get()` for the list.

```ts
const mockVersionsGet = vi.fn()
const liveDoc = {
  id: 'brief-1',
  data: () => ({ project_id: 'proj1', version: 4 }),
  ref: { collection: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get: mockVersionsGet })) })) })) },
}
const mockLiveGet = vi.fn()
vi.mock('@/lib/api/firebase-server-helpers', () => ({ /* as in briefs.test.ts, with getAdminDb returning
  { collection: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ get: mockLiveGet }) }) }) }) } */ }))

describe('GET /api/briefs/versions (#194)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetProjectRole.mockResolvedValue('builder') })

  it('400 without project_id', async () => {
    const res = await GET(new Request('http://localhost/api/briefs/versions'))
    expect(res.status).toBe(400)
  })

  it('404 when the user has no role', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/briefs/versions?project_id=proj1'))
    expect(res.status).toBe(404)
  })

  it('403 for a maker — history is builder tooling', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await GET(new Request('http://localhost/api/briefs/versions?project_id=proj1'))
    expect(res.status).toBe(403)
  })

  it('returns an empty list when the project has no brief', async () => {
    mockLiveGet.mockResolvedValue({ empty: true, docs: [] })
    const res = await GET(new Request('http://localhost/api/briefs/versions?project_id=proj1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ versions: [] })
  })

  it('lists archived versions newest first with content, time and source', async () => {
    mockLiveGet.mockResolvedValue({ empty: false, docs: [liveDoc] })
    mockVersionsGet.mockResolvedValue({
      docs: [
        { id: '3', data: () => ({ version: 3, content: { problem: 'v3' }, updated_at: '2026-10-10T00:00:00.000Z', source: 'regen', archived_at: '2026-10-11T00:00:00.000Z' }) },
        { id: '2', data: () => ({ version: 2, content: { problem: 'v2' }, updated_at: '2026-10-01T00:00:00.000Z', source: null, archived_at: '2026-10-10T00:00:00.000Z' }) },
      ],
    })
    const res = await GET(new Request('http://localhost/api/briefs/versions?project_id=proj1'))
    const data = await res.json()
    expect(data.versions).toHaveLength(2)
    expect(data.versions[0]).toEqual(expect.objectContaining({ version: 3, source: 'regen', content: { problem: 'v3' } }))
    expect(data.versions[1].source).toBeNull()
    expect(liveDoc.ref.collection).toHaveBeenCalledWith('versions')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/api/briefs/versions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`app/api/briefs/versions/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import type { BriefVersion } from '@/lib/types'

// #194: archived versions of a project's brief, newest first. Builder tooling
// (the Brief tab's History list) — makers read only the live brief.
const MAX_VERSIONS = 50

// GET /api/briefs/versions?project_id=xxx
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const liveSnap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()
  if (liveSnap.empty) return NextResponse.json({ versions: [] })

  const versionsSnap = await liveSnap.docs[0].ref
    .collection('versions')
    .orderBy('version', 'desc')
    .limit(MAX_VERSIONS)
    .get()

  const versions: BriefVersion[] = versionsSnap.docs.map((d) => {
    const v = d.data()
    return {
      version: v.version as number,
      content: v.content as BriefVersion['content'],
      updated_at: v.updated_at as string,
      source: (v.source as BriefVersion['source']) ?? null,
      archived_at: v.archived_at as string,
    }
  })

  return NextResponse.json({ versions })
}
```

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run app/api/briefs && npm run build` (export dummy `NEXT_PUBLIC_FIREBASE_*` vars first if prerender fails with `auth/invalid-api-key`).
Expected: PASS; build validates the route export.

- [ ] **Step 5: Commit**

```bash
git add app/api/briefs/versions
git commit -m "feat(briefs): GET /api/briefs/versions lists archived versions (#194)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Hooks + copy

**Files:**
- Modify: `lib/query/keys.ts` (add `briefVersions`)
- Modify: `lib/query/hooks.ts` (`useBriefVersions`; `useUpdateBrief` gains `source?` and invalidates versions)
- Modify: `lib/copy.ts` (`brief` block, ~line 193)

**Interfaces:**
- Produces:
  ```ts
  queryKeys.briefVersions(projectId) // ['briefVersions', projectId]
  useBriefVersions(projectId: string | undefined, enabled: boolean): UseQueryResult<BriefVersion[]>
  useUpdateBrief().mutate({ project_id, content, source?: 'restore' })
  copy.brief.history, historyEmpty, historyLoading, restore, confirmRestore, cancelRestore, sourceLabel(source)
  ```
  Task 5 relies on these names.

- [ ] **Step 1: Implement (no unit test — thin wrappers; Task 5's component test covers them through mocks)**

`lib/query/keys.ts`: `briefVersions: (projectId: string | undefined) => ['briefVersions', projectId] as const,`

`lib/query/hooks.ts`, after `useBrief`:

```ts
// #194: archived brief versions for the Brief tab's History list. Fetched only
// when the list is opened (enabled flag) — most visits never need it.
export function useBriefVersions(projectId: string | undefined, enabled: boolean) {
  return useQuery<BriefVersion[]>({
    queryKey: queryKeys.briefVersions(projectId),
    queryFn: async () => {
      const res = await apiFetch(`/api/briefs/versions?project_id=${projectId}`)
      if (!res.ok) throw new Error('Failed to load brief history')
      const data = await res.json()
      return data.versions as BriefVersion[]
    },
    enabled: !!projectId && enabled,
  })
}
```

`useUpdateBrief`: mutation variables become `{ project_id: string; content: unknown; source?: 'restore' }`, body `JSON.stringify({ project_id, content, ...(source && { source }) })`, and `onSuccess` also invalidates `queryKeys.briefVersions(variables.project_id)`. Import `BriefVersion` from `@/lib/types`.

`lib/copy.ts` `brief` block, append:

```ts
    // #194 — version history on the Brief tab
    history: 'History',
    historyEmpty: 'No earlier versions yet — the first regen or save will create one.',
    historyLoading: 'Loading history…',
    restore: 'Restore',
    confirmRestore: (version: number) => `Restore v${version}? The current brief is kept in history.`,
    confirmRestoreButton: 'Yes, restore',
    cancelRestore: 'Cancel',
    sourceLabel: (source: string | null) =>
      ({ create: 'created', paste: 'saved by hand', regen: 'regenerated', restore: 'restored' }[source ?? ''] ?? 'unknown source'),
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -v build-info | head`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/query/keys.ts lib/query/hooks.ts lib/copy.ts
git commit -m "feat(briefs): useBriefVersions hook, restore source, history copy (#194)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `BriefHistory` component in the Brief tab

**Files:**
- Create: `components/builder/BriefHistory.tsx`
- Modify: `components/builder/BriefEditor.tsx` (read view, after `<DecisionsSection …/>` at ~line 176)
- Test: `components/builder/__tests__/BriefHistory.test.tsx`

**Interfaces:**
- Consumes: `useBriefVersions`, `useUpdateBrief`, `copy.brief.*` from Task 4; `formatPacific` from `lib/email/format.ts`.
- Produces: `<BriefHistory projectId={string} />`.

- [ ] **Step 1: Write the failing test**

`components/builder/__tests__/BriefHistory.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

const mockMutate = vi.fn()
let mockVersions: unknown[] = []
let mockLoading = false

vi.mock('@/lib/query/hooks', () => ({
  useBriefVersions: (_id: string, enabled: boolean) => ({
    data: enabled ? mockVersions : undefined,
    isLoading: enabled && mockLoading,
  }),
  useUpdateBrief: () => ({ mutate: mockMutate, isPending: false }),
}))

import { BriefHistory } from '../BriefHistory'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mockVersions = [
    { version: 3, content: { problem: 'v3' }, updated_at: '2026-10-10T19:12:00.000Z', source: 'regen', archived_at: '2026-10-11T00:00:00.000Z' },
    { version: 2, content: { problem: 'v2' }, updated_at: '2026-10-01T00:00:00.000Z', source: null, archived_at: '2026-10-10T00:00:00.000Z' },
  ]
  mockLoading = false
})

describe('BriefHistory (#194)', () => {
  it('is collapsed by default and lists versions (Pacific time + source) when opened', () => {
    render(<BriefHistory projectId="p1" />)
    expect(screen.queryByText(/regenerated/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    expect(screen.getByText(/v3/)).toBeTruthy()
    expect(screen.getByText(/Oct 10, 2026, 12:12 PM PDT/)).toBeTruthy()
    expect(screen.getByText(/regenerated/)).toBeTruthy()
    expect(screen.getByText(/unknown source/)).toBeTruthy()
  })

  it('shows the empty line when there are no versions', () => {
    mockVersions = []
    render(<BriefHistory projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    expect(screen.getByText(/No earlier versions yet/)).toBeTruthy()
  })

  it('restore is two-step and submits the archived content with source restore', () => {
    render(<BriefHistory projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    expect(mockMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/Restore v3\?/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, restore' }))
    expect(mockMutate).toHaveBeenCalledWith({ project_id: 'p1', content: { problem: 'v3' }, source: 'restore' })
  })

  it('cancel backs out of the confirm step', () => {
    render(<BriefHistory projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Restore v3\?/)).toBeNull()
    expect(mockMutate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run components/builder/__tests__/BriefHistory.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`components/builder/BriefHistory.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { History, ChevronDown, ChevronRight } from 'lucide-react'
import { useBriefVersions, useUpdateBrief } from '@/lib/query/hooks'
import { formatPacific } from '@/lib/email/format'
import { copy } from '@/lib/copy'

// #194: archived versions of the brief, under the read view. Collapsed by
// default and fetched only when opened. Restore re-submits an archived version
// through the normal PUT (source 'restore'), so locks and provenance behave as
// a paste and the version being replaced is itself archived.
export function BriefHistory({ projectId }: { projectId: string }) {
  const c = copy.brief
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<number | null>(null)
  const { data: versions, isLoading } = useBriefVersions(projectId, open)
  const updateBrief = useUpdateBrief()

  const restore = (version: number, content: unknown) => {
    updateBrief.mutate({ project_id: projectId, content, source: 'restore' })
    setConfirming(null)
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <History className="h-3.5 w-3.5" /> {c.history}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {isLoading && <p className="text-xs text-gray-400">{c.historyLoading}</p>}
          {!isLoading && versions && versions.length === 0 && (
            <p className="text-xs text-gray-400">{c.historyEmpty}</p>
          )}
          {versions?.map((v) => (
            <div key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
              <span className="font-medium text-gray-800">v{v.version}</span>
              <span>{formatPacific(v.updated_at)}</span>
              <span className="text-gray-400">{c.sourceLabel(v.source)}</span>
              {confirming === v.version ? (
                <span className="flex items-center gap-2">
                  <span className="text-gray-700">{c.confirmRestore(v.version)}</span>
                  <button
                    onClick={() => restore(v.version, v.content)}
                    disabled={updateBrief.isPending}
                    className="font-medium text-brand-navy hover:underline disabled:opacity-40"
                  >
                    {c.confirmRestoreButton}
                  </button>
                  <button onClick={() => setConfirming(null)} className="text-gray-500 hover:underline">
                    {c.cancelRestore}
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirming(v.version)}
                  disabled={updateBrief.isPending}
                  className="text-brand-navy hover:underline disabled:opacity-40"
                >
                  {c.restore}
                </button>
              )}
            </div>
          ))}
          {updateBrief.error && <p className="text-xs text-red-500">{updateBrief.error.message}</p>}
        </div>
      )}
    </div>
  )
}
```

Check how `copy` is exported from `lib/copy.ts` (named `copy` vs default) and import accordingly. If `lucide-react` has no `History` icon in the installed version, use `Clock`.

`components/builder/BriefEditor.tsx`: import `BriefHistory` and render `<BriefHistory projectId={projectId} />` directly after `<DecisionsSection decisions={base.decisions} sessions={sessions} />` (inside the `hasAnyContent(base)` branch — a brief with no content has no history worth showing).

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run components/builder && npx tsc --noEmit 2>&1 | grep -v build-info | head`
Expected: PASS; clean. If the Pacific-time assertion fails because the test machine renders a different zone abbreviation, assert on `/Oct 10, 2026/` only and note it in the report.

- [ ] **Step 5: Commit**

```bash
git add components/builder/BriefHistory.tsx components/builder/BriefEditor.tsx components/builder/__tests__/BriefHistory.test.tsx
git commit -m "feat(brief-tab): History list with two-step Restore (#194)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs + full verification

**Files:**
- Modify: `CLAUDE.md` — Data Model `briefs` bullet: append ` Since #194 every overwrite archives the outgoing version to \`briefs/{id}/versions/{version}\` (\`{version, content, updated_at, source, archived_at}\`, no cap) and the live doc carries \`source\` (\`create\`|\`paste\`|\`regen\`|\`restore\`); \`GET /api/briefs/versions\` lists them (builder+), and the Brief tab's History → Restore re-submits one through \`PUT /api/briefs\` with \`source: 'restore'\`.`
- Modify: `docs/changelog.md` — prepend one entry in the existing style, 3 sentences.

- [ ] **Step 1: Make the edits**

- [ ] **Step 2: Full verification**

```bash
npm run build
npm test
npm run type-check
npm run lint
```

Expected: all exit 0 (build may need dummy `NEXT_PUBLIC_FIREBASE_*` exported in a worktree).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/changelog.md
git commit -m "docs: brief version history (#194)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
