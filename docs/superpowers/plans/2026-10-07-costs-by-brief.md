# Costs by brief and per conversation — Implementation Plan (#185)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin viewing a brief sees what it has cost in Anthropic API spend: the total, the split by route, and one row per conversation.

**Architecture:** A pure `rollUpProjectUsage()` next to the existing `rollUpUsage()` in `lib/api/usage-rollup.ts` groups `api_usage` rows for one project by session. A new admin-only route `GET /api/projects/[id]/usage` reads the rows (single-field `where project_id ==`, no composite index needed), numbers the sessions from the project's `sessions` collection, and returns the rollup. A small `ProjectCostsCard` renders it inside the builder Conversations tab, collapsed by default, admin-only, consistent with the existing #120 decision that cost is operator telemetry.

**Tech Stack:** Next.js App Router route handler, Firebase Admin SDK, React Query, Tailwind v4, Vitest.

**Spec:** GitHub issue #185 (https://github.com/nicolovejoy/ibuild4you/issues/185). Design decisions recorded here because Nico delegated the design (2026-10-07).

## Global Constraints

- All Firestore access goes through API routes with the Admin SDK; the client only calls `apiFetch()`.
- Visibility: **admin only** (`hasSystemRole(auth, 'admin')`), matching the existing per-session token/cost badge (#120). Non-admins get 403 and never see the card.
- Firestore query must be `where('project_id', '==', id)` with a `limit` and NO `orderBy` — adding `orderBy` would need a new composite index; sort in memory instead.
- Dates shown to a human are Pacific with the zone named (`Intl.DateTimeFormat` with `timeZone: 'America/Los_Angeles'`), never `toISOString().slice(0,10)`.
- Costs are list-price estimates: prefix with `~` and format via `formatCostUsd` from `lib/observability/session-cost.ts`.
- Code style: clear over clever; comment the non-obvious. Follow the patterns in `app/api/projects/[id]/members/route.ts` and `app/api/admin/usage/route.ts`.
- Run `npm test`, `npm run type-check`, `npm run lint` before every commit. In a worktree also run `npm run build` before claiming clean (CLAUDE.md: type-check alone is a false green in a worktree).

## Review Focus

1. Rows with no `session_id` (brief regen, welcome, prep) must still be counted in the total and appear as one labelled bucket, not vanish — Task 1 pins the `(none)` bucket.
2. A row whose `session_id` points at a session that no longer exists (archived/deleted) must not crash numbering — Task 2 pins a fallback label.
3. A brief with zero usage must render a quiet "No API calls yet" state, not an empty table or NaN — Task 3 pins it.
4. A project with more than the row cap must say so (`truncated: true`) rather than silently under-report — Task 2 pins the flag.
5. A non-admin builder must get 403 from the route and must not have the card mounted at all (no 403 flashes in the UI) — Task 2 pins 403; Task 3 renders the card only when `isAdmin`.

---

### Task 1: Pure per-project rollup

**Files:**
- Modify: `lib/api/usage-rollup.ts` (append)
- Test: `lib/api/__tests__/usage-rollup.test.ts` (append)

**Interfaces:**
- Consumes: existing `ApiUsageRow`, `GroupTotals`.
- Produces:

```ts
export interface SessionTotals extends GroupTotals {
  // key === session_id, or '(none)' for calls not tied to a conversation
  first_call_at: string
  last_call_at: string
}
export interface ProjectUsageRollup {
  total_calls: number
  total_cost: number
  by_route: GroupTotals[]       // cost desc
  by_session: SessionTotals[]   // first_call_at asc; '(none)' bucket LAST
}
export const NO_SESSION_KEY = '(none)'
export function rollUpProjectUsage(rows: ApiUsageRow[]): ProjectUsageRollup
```

- [ ] **Step 1: Write the failing tests**

Append to `lib/api/__tests__/usage-rollup.test.ts` (reuse the file's `row()` helper):

```ts
import { rollUpProjectUsage, NO_SESSION_KEY } from '../usage-rollup'

describe('rollUpProjectUsage', () => {
  it('returns zero totals and empty groups for no rows', () => {
    const r = rollUpProjectUsage([])
    expect(r).toEqual({ total_calls: 0, total_cost: 0, by_route: [], by_session: [] })
  })

  it('groups by session in chronological order of first call, with per-session totals', () => {
    const rows = [
      row({ session_id: 's2', cost_usd: 0.05, created_at: '2026-10-02T10:00:00.000Z' }),
      row({ session_id: 's1', cost_usd: 0.01, created_at: '2026-10-01T10:00:00.000Z' }),
      row({ session_id: 's1', cost_usd: 0.02, created_at: '2026-10-01T10:05:00.000Z' }),
    ]
    const r = rollUpProjectUsage(rows)
    expect(r.by_session.map((s) => s.key)).toEqual(['s1', 's2'])
    expect(r.by_session[0].calls).toBe(2)
    expect(r.by_session[0].cost).toBeCloseTo(0.03)
    expect(r.by_session[0].first_call_at).toBe('2026-10-01T10:00:00.000Z')
    expect(r.by_session[0].last_call_at).toBe('2026-10-01T10:05:00.000Z')
    expect(r.total_calls).toBe(3)
    expect(r.total_cost).toBeCloseTo(0.08)
  })

  it('buckets calls without a session (brief regen, welcome) under NO_SESSION_KEY, listed last', () => {
    const rows = [
      row({ session_id: null, route: 'brief.generate', cost_usd: 0.2, created_at: '2026-09-30T00:00:00.000Z' }),
      row({ session_id: 's1', route: 'chat', cost_usd: 0.01, created_at: '2026-10-01T10:00:00.000Z' }),
    ]
    const r = rollUpProjectUsage(rows)
    expect(r.by_session.map((s) => s.key)).toEqual(['s1', NO_SESSION_KEY])
    expect(r.by_session[1].cost).toBeCloseTo(0.2)
    expect(r.total_cost).toBeCloseTo(0.21)
  })

  it('splits by route, most expensive first', () => {
    const rows = [
      row({ route: 'chat', cost_usd: 0.01 }),
      row({ route: 'brief.generate', cost_usd: 0.3 }),
      row({ route: 'chat', cost_usd: 0.02 }),
    ]
    const r = rollUpProjectUsage(rows)
    expect(r.by_route.map((g) => g.key)).toEqual(['brief.generate', 'chat'])
    expect(r.by_route[1].calls).toBe(2)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/api/__tests__/usage-rollup.test.ts`
Expected: FAIL — `rollUpProjectUsage` is not exported.

- [ ] **Step 3: Implement** (append to `lib/api/usage-rollup.ts`)

```ts
// --- Per-brief rollup (#185) ---------------------------------------------
// Used by GET /api/projects/[id]/usage. Groups one project's rows by
// conversation so the builder view can show "what did this brief cost, and
// which conversation cost what". Calls that aren't tied to a session (brief
// regen, welcome message, outbound prep) land in one NO_SESSION_KEY bucket so
// the total still adds up.

export const NO_SESSION_KEY = '(none)'

export interface SessionTotals extends GroupTotals {
  first_call_at: string
  last_call_at: string
}

export interface ProjectUsageRollup {
  total_calls: number
  total_cost: number
  by_route: GroupTotals[]
  by_session: SessionTotals[]
}

export function rollUpProjectUsage(rows: ApiUsageRow[]): ProjectUsageRollup {
  const by_route = groupBy(rows, (r) => r.route).sort((a, b) => b.cost - a.cost)

  const sessions = new Map<string, SessionTotals>()
  for (const r of rows) {
    const key = r.session_id || NO_SESSION_KEY
    const created = r.created_at || ''
    const cur =
      sessions.get(key) ||
      { key, calls: 0, cost: 0, input: 0, output: 0, cache_read: 0, cache_create: 0, first_call_at: created, last_call_at: created }
    cur.calls += 1
    cur.cost += r.cost_usd || 0
    cur.input += r.input_tokens || 0
    cur.output += r.output_tokens || 0
    cur.cache_read += r.cache_read_input_tokens || 0
    cur.cache_create += r.cache_creation_input_tokens || 0
    if (created && (!cur.first_call_at || created < cur.first_call_at)) cur.first_call_at = created
    if (created > cur.last_call_at) cur.last_call_at = created
    sessions.set(key, cur)
  }

  // Chronological by first call; the no-session bucket always last so the
  // conversation rows read 1, 2, 3… before the "other" line.
  const by_session = [...sessions.values()].sort((a, b) => {
    if (a.key === NO_SESSION_KEY) return 1
    if (b.key === NO_SESSION_KEY) return -1
    return a.first_call_at.localeCompare(b.first_call_at)
  })

  return {
    total_calls: rows.length,
    total_cost: rows.reduce((s, r) => s + (r.cost_usd || 0), 0),
    by_route,
    by_session,
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/api/__tests__/usage-rollup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api/usage-rollup.ts lib/api/__tests__/usage-rollup.test.ts
git commit -m "feat(usage): rollUpProjectUsage — per-brief totals by route and by conversation (#185)"
```

---

### Task 2: Route `GET /api/projects/[id]/usage`

**Files:**
- Create: `app/api/projects/[id]/usage/route.ts`
- Create: `lib/api/project-usage.ts` (pure session-labelling helper, so the route stays thin and the labelling is testable)
- Test: `lib/api/__tests__/project-usage.test.ts`

**Interfaces:**
- Consumes: `rollUpProjectUsage`, `NO_SESSION_KEY`, `SessionTotals`, `ProjectUsageRollup` (Task 1); `getAuthenticatedUser`, `getAdminDb`, `hasSystemRole` from `@/lib/api/firebase-server-helpers`.
- Produces response JSON:

```ts
export interface ProjectUsageResponse extends ProjectUsageRollup {
  by_session: LabelledSessionTotals[]
  truncated: boolean
}
export interface LabelledSessionTotals extends SessionTotals {
  // "Conversation 3" / "Brief updates & other" / "Conversation (removed)"
  label: string
  // conversation ordinal (1 = oldest) or null for the non-session bucket
  number: number | null
  session_created_at: string | null
}
export function labelSessions(
  by_session: SessionTotals[],
  sessions: { id: string; created_at: string }[], // ALL of the project's sessions, any order
): LabelledSessionTotals[]
```

- [ ] **Step 1: Write the failing test**

```ts
// lib/api/__tests__/project-usage.test.ts
import { describe, it, expect } from 'vitest'
import { labelSessions } from '../project-usage'
import { NO_SESSION_KEY, type SessionTotals } from '../usage-rollup'

const totals = (key: string, first = '2026-10-01T00:00:00.000Z'): SessionTotals => ({
  key, calls: 1, cost: 0.01, input: 1, output: 1, cache_read: 0, cache_create: 0,
  first_call_at: first, last_call_at: first,
})

describe('labelSessions', () => {
  const sessions = [
    { id: 's2', created_at: '2026-10-02T00:00:00.000Z' },
    { id: 's1', created_at: '2026-10-01T00:00:00.000Z' },
    { id: 's3', created_at: '2026-10-03T00:00:00.000Z' },
  ]

  it('numbers conversations from the oldest session regardless of input order', () => {
    const out = labelSessions([totals('s3'), totals('s1')], sessions)
    expect(out.map((o) => [o.key, o.number, o.label])).toEqual([
      ['s3', 3, 'Conversation 3'],
      ['s1', 1, 'Conversation 1'],
    ])
    expect(out[1].session_created_at).toBe('2026-10-01T00:00:00.000Z')
  })

  it('labels the no-session bucket', () => {
    const [o] = labelSessions([totals(NO_SESSION_KEY)], sessions)
    expect(o.label).toBe('Brief updates & other')
    expect(o.number).toBeNull()
    expect(o.session_created_at).toBeNull()
  })

  it('does not crash on a session id that no longer exists', () => {
    const [o] = labelSessions([totals('gone')], sessions)
    expect(o.label).toBe('Conversation (removed)')
    expect(o.number).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/api/__tests__/project-usage.test.ts`
Expected: FAIL — cannot resolve `../project-usage`.

- [ ] **Step 3: Implement the helper**

```ts
// lib/api/project-usage.ts
// Pure labelling for the per-brief usage view (#185). Turns session ids into
// the "Conversation N" ordinals the builder view already uses (1 = oldest).
import { NO_SESSION_KEY, type ProjectUsageRollup, type SessionTotals } from './usage-rollup'

export interface LabelledSessionTotals extends SessionTotals {
  label: string
  number: number | null
  session_created_at: string | null
}

export interface ProjectUsageResponse extends Omit<ProjectUsageRollup, 'by_session'> {
  by_session: LabelledSessionTotals[]
  truncated: boolean
}

export function labelSessions(
  by_session: SessionTotals[],
  sessions: { id: string; created_at: string }[],
): LabelledSessionTotals[] {
  const ordered = [...sessions].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const byId = new Map(ordered.map((s, i) => [s.id, { number: i + 1, created_at: s.created_at }]))

  return by_session.map((s) => {
    if (s.key === NO_SESSION_KEY) {
      return { ...s, label: 'Brief updates & other', number: null, session_created_at: null }
    }
    const hit = byId.get(s.key)
    if (!hit) {
      // Session doc gone (archived + purged, or a fixture reset). Keep the
      // cost visible rather than dropping it on the floor.
      return { ...s, label: 'Conversation (removed)', number: null, session_created_at: null }
    }
    return { ...s, label: `Conversation ${hit.number}`, number: hit.number, session_created_at: hit.created_at }
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/api/__tests__/project-usage.test.ts` → PASS.

- [ ] **Step 5: Write the route**

```ts
// app/api/projects/[id]/usage/route.ts
import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { rollUpProjectUsage, type ApiUsageRow } from '@/lib/api/usage-rollup'
import { labelSessions, type ProjectUsageResponse } from '@/lib/api/project-usage'

// GET /api/projects/[id]/usage — admin-only Anthropic spend for ONE brief:
// total, by route, and one row per conversation (#185). Cost is operator
// telemetry (#120), so this is gated on the admin system role, not on
// project membership.
//
// Query is a single-field equality + limit so it needs no composite index;
// grouping and ordering happen in memory (rollUpProjectUsage).
const MAX_ROWS = 5000

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: projectId } = await params
  if (!projectId) {
    return NextResponse.json({ error: 'project id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const [usageSnap, sessionsSnap] = await Promise.all([
    db.collection('api_usage').where('project_id', '==', projectId).limit(MAX_ROWS).get(),
    db.collection('sessions').where('project_id', '==', projectId).get(),
  ])

  const rows = usageSnap.docs.map((d) => d.data() as ApiUsageRow)
  const sessions = sessionsSnap.docs.map((d) => ({
    id: d.id,
    created_at: (d.data().created_at as string) || '',
  }))

  const rollup = rollUpProjectUsage(rows)
  const body: ProjectUsageResponse = {
    ...rollup,
    by_session: labelSessions(rollup.by_session, sessions),
    truncated: usageSnap.size === MAX_ROWS,
  }
  return NextResponse.json(body)
}
```

- [ ] **Step 6: Gate**

Run: `npm run type-check && npm run lint && npm run build`
Expected: green. (`build` is what validates the route export signature — see CLAUDE.md.)

- [ ] **Step 7: Commit**

```bash
git add "app/api/projects/[id]/usage/route.ts" lib/api/project-usage.ts lib/api/__tests__/project-usage.test.ts
git commit -m "feat(usage): GET /api/projects/[id]/usage — admin per-brief spend by route and conversation (#185)"
```

---

### Task 3: `ProjectCostsCard` in the builder Conversations tab

**Files:**
- Create: `components/builder/ProjectCostsCard.tsx`
- Modify: `lib/query/keys.ts` (add `projectUsage` key)
- Modify: `lib/query/hooks.ts` (add `useProjectUsage`)
- Modify: `components/builder/BuilderProjectView.tsx` — render the card inside `ConversationsTab` directly under `<StatusStrip … />` (around line 842), only when `isAdmin` (that variable already exists in `ConversationsTab`, line ~801).
- Test: `components/builder/__tests__/ProjectCostsCard.test.tsx`

**Interfaces:**
- Consumes: `ProjectUsageResponse`, `LabelledSessionTotals` (Task 2); `formatCostUsd` from `@/lib/observability/session-cost`.
- Produces: `useProjectUsage(projectId: string | undefined, enabled: boolean)`; `<ProjectCostsCard projectId={string} />`.

- [ ] **Step 1: Write the failing component test**

Look at `components/builder/__tests__/` for an existing component test and copy its jsdom + QueryClient setup. Then:

```tsx
// components/builder/__tests__/ProjectCostsCard.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { ProjectCostsCard } from '../ProjectCostsCard'
import type { ProjectUsageResponse } from '@/lib/api/project-usage'

const useProjectUsageMock = vi.fn()
vi.mock('@/lib/query/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query/hooks')>()
  return { ...actual, useProjectUsage: (...args: unknown[]) => useProjectUsageMock(...args) }
})

const data: ProjectUsageResponse = {
  total_calls: 7,
  total_cost: 0.4321,
  by_route: [
    { key: 'chat', calls: 5, cost: 0.3, input: 1, output: 1, cache_read: 0, cache_create: 0 },
    { key: 'brief.generate', calls: 2, cost: 0.1321, input: 1, output: 1, cache_read: 0, cache_create: 0 },
  ],
  by_session: [
    { key: 's1', label: 'Conversation 1', number: 1, session_created_at: '2026-10-01T17:00:00.000Z', calls: 3, cost: 0.2, input: 1, output: 1, cache_read: 0, cache_create: 0, first_call_at: '2026-10-01T17:00:00.000Z', last_call_at: '2026-10-01T17:30:00.000Z' },
    { key: '(none)', label: 'Brief updates & other', number: null, session_created_at: null, calls: 2, cost: 0.1321, input: 1, output: 1, cache_read: 0, cache_create: 0, first_call_at: '2026-10-01T18:00:00.000Z', last_call_at: '2026-10-01T18:00:00.000Z' },
  ],
  truncated: false,
}

afterEach(cleanup)
beforeEach(() => useProjectUsageMock.mockReset())

describe('ProjectCostsCard', () => {
  it('shows the total collapsed and the breakdown when expanded', () => {
    useProjectUsageMock.mockReturnValue({ data, isLoading: false, error: null })
    render(<ProjectCostsCard projectId="p1" />)
    expect(screen.getByText(/~\$0\.43/)).toBeTruthy()
    expect(screen.queryByText('Conversation 1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /api costs/i }))
    expect(screen.getByText('Conversation 1')).toBeTruthy()
    expect(screen.getByText('Brief updates & other')).toBeTruthy()
    expect(screen.getByText('brief.generate')).toBeTruthy()
    // Pacific, zone named: 17:00Z on Oct 1 is 10:00 AM PDT.
    expect(screen.getByText(/Oct 1, 2026, 10:00 AM PDT/)).toBeTruthy()
  })

  it('renders a quiet empty state when there are no calls', () => {
    useProjectUsageMock.mockReturnValue({ data: { ...data, total_calls: 0, total_cost: 0, by_route: [], by_session: [] }, isLoading: false, error: null })
    render(<ProjectCostsCard projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /api costs/i }))
    expect(screen.getByText(/No API calls yet/)).toBeTruthy()
    expect(screen.queryByText('NaN')).toBeNull()
  })

  it('flags a truncated result', () => {
    useProjectUsageMock.mockReturnValue({ data: { ...data, truncated: true }, isLoading: false, error: null })
    render(<ProjectCostsCard projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /api costs/i }))
    expect(screen.getByText(/first 5,?000 calls/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run components/builder/__tests__/ProjectCostsCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the query key and hook**

`lib/query/keys.ts` — add alongside `sessions`:

```ts
  projectUsage: (projectId: string | undefined) => ['project-usage', projectId] as const,
```

`lib/query/hooks.ts` — add after `useSessions`:

```ts
// Admin-only per-brief Anthropic spend (#185). `enabled` lets the caller gate
// on isAdmin so non-admins never fire a request that would 403.
export function useProjectUsage(projectId: string | undefined, enabled: boolean) {
  return useQuery<ProjectUsageResponse>({
    queryKey: queryKeys.projectUsage(projectId),
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/${projectId}/usage`)
      if (!res.ok) throw new Error('Failed to load usage')
      return res.json()
    },
    enabled: !!projectId && enabled,
    staleTime: 60 * 1000,
  })
}
```

with `import type { ProjectUsageResponse } from '@/lib/api/project-usage'` at the top of `hooks.ts`.

- [ ] **Step 4: Write the component**

```tsx
// components/builder/ProjectCostsCard.tsx
'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { useProjectUsage } from '@/lib/query/hooks'
import { formatCostUsd } from '@/lib/observability/session-cost'

// Admin-only: what this brief has cost in Anthropic API calls, by route and
// by conversation (#185). Collapsed by default — it's operator telemetry, not
// reading material (#120). Data comes from GET /api/projects/[id]/usage.

const pacific = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
})
function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : pacific.format(d)
}

export function ProjectCostsCard({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error } = useProjectUsage(projectId, true)

  const total = data ? `~${formatCostUsd(data.total_cost)}` : isLoading ? '…' : '—'

  return (
    <Card>
      <CardBody className="p-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-2">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            API costs
          </span>
          <span className="text-sm text-gray-600 tabular-nums">{total}</span>
        </button>

        {open && (
          <div className="px-4 pb-4 space-y-4 text-sm">
            {error && <p className="text-red-600">Couldn&apos;t load usage.</p>}
            {data && data.total_calls === 0 && (
              <p className="text-gray-500">No API calls yet for this brief.</p>
            )}
            {data && data.total_calls > 0 && (
              <>
                <section>
                  <h3 className="text-xs font-medium text-gray-500 mb-1">By conversation</h3>
                  <table className="w-full">
                    <tbody>
                      {data.by_session.map((s) => (
                        <tr key={s.key} className="border-t border-gray-100">
                          <td className="py-1.5 pr-2">
                            <div className="text-gray-900">{s.label}</div>
                            {s.session_created_at && (
                              <div className="text-xs text-gray-400">{fmtDate(s.session_created_at)}</div>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 text-right text-gray-500 tabular-nums">{s.calls} calls</td>
                          <td className="py-1.5 text-right text-gray-900 tabular-nums">~{formatCostUsd(s.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section>
                  <h3 className="text-xs font-medium text-gray-500 mb-1">By route</h3>
                  <table className="w-full">
                    <tbody>
                      {data.by_route.map((g) => (
                        <tr key={g.key} className="border-t border-gray-100">
                          <td className="py-1.5 pr-2 text-gray-900 font-mono text-xs">{g.key}</td>
                          <td className="py-1.5 pr-2 text-right text-gray-500 tabular-nums">{g.calls} calls</td>
                          <td className="py-1.5 text-right text-gray-900 tabular-nums">~{formatCostUsd(g.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <p className="text-xs text-gray-400">
                  List-price estimate from logged token counts, {data.total_calls} calls total.
                  {data.truncated && ' Showing the first 5,000 calls only.'}
                </p>
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
```

If `CardBody` does not accept `className`, drop the prop and keep the inner padding as is — check `components/ui/Card.tsx` first.

- [ ] **Step 5: Mount it in `ConversationsTab`**

In `components/builder/BuilderProjectView.tsx`, add `import { ProjectCostsCard } from './ProjectCostsCard'` next to the `BuilderFilesTab` import, and directly after the `<StatusStrip … />` element inside `ConversationsTab`'s returned `<div className="space-y-4">`:

```tsx
      {/* Operator telemetry, admin-only (#120, #185). */}
      {isAdmin && <ProjectCostsCard projectId={projectId} />}
```

- [ ] **Step 6: Run tests, then the full gate**

Run: `npx vitest run components/builder/__tests__/ProjectCostsCard.test.tsx` → PASS.
Run: `npm test && npm run type-check && npm run lint && npm run build` → all green.

- [ ] **Step 7: Commit**

```bash
git add components/builder/ProjectCostsCard.tsx components/builder/__tests__/ProjectCostsCard.test.tsx components/builder/BuilderProjectView.tsx lib/query/keys.ts lib/query/hooks.ts
git commit -m "feat(builder): admin API-costs card on the Conversations tab — by conversation and by route (#185)"
```

---

### Task 4: Changelog entry

**Files:**
- Modify: `docs/changelog.md` (prepend)

- [ ] **Step 1: Prepend**

```markdown
## 2026-10-07 — Costs by brief and per conversation (#185)

Admins see an "API costs" card at the top of a brief's Conversations tab: total list-price spend, one row per conversation (numbered like the transcript picker, Pacific start time), a "Brief updates & other" bucket for regen/welcome/prep calls, and a by-route split. Backed by `GET /api/projects/[id]/usage` (admin-only, `api_usage` filtered by `project_id`, no new index) and `rollUpProjectUsage` in `lib/api/usage-rollup.ts`. Non-admins never see the card (#120 stance unchanged).
```

- [ ] **Step 2: Commit**

```bash
git add docs/changelog.md
git commit -m "docs: changelog — costs by brief (#185)"
```
