import { describe, it, expect } from 'vitest'
import { enrichProjects } from '@/lib/api/enrich-projects'

// =============================================================================
// Read-budget regression test for enrichProjects.
//
// Guards against the 2026-05-12 quota incident pattern: a small change to the
// loop here previously cost 10x reads/project. This test fails loudly if the
// per-project read count grows.
//
// Strategy: hand-rolled Firestore admin stub that counts every .get() call.
// Each query path returns deterministic fixture data shaped just enough to
// satisfy enrichProjects.
// =============================================================================

type QueryState = {
  collection: string
  filters: Array<{ field: string; op: string; value: unknown }>
  orderBy: { field: string; dir: 'asc' | 'desc' } | null
  limitN: number | null
  selected: string[] | null
}

// Fixture: 10 projects × 3 sessions × 5 messages, plus 1 brief per project.
function makeFixture() {
  const projects = Array.from({ length: 10 }, (_, i) => ({
    id: `project-${i}`,
    title: `Project ${i}`,
    requester_email: `maker${i}@example.com`,
    created_at: `2026-05-01T00:00:0${i}Z`,
  }))

  const sessions = projects.flatMap((p) =>
    Array.from({ length: 3 }, (_, j) => ({
      id: `${p.id}-session-${j}`,
      project_id: p.id,
      status: j === 0 ? 'active' : 'completed',
      created_at: `2026-05-02T00:00:0${j}Z`,
    }))
  )

  const messages = sessions.flatMap((s, idx) =>
    Array.from({ length: 5 }, (_, k) => ({
      id: `${s.id}-msg-${k}`,
      session_id: s.id,
      role: k % 2 === 0 ? 'agent' : 'user',
      sender_email: k % 2 === 0 ? null : `maker${idx % 10}@example.com`,
      created_at: `2026-05-03T00:0${k}:00Z`,
    }))
  )

  const briefs = projects.map((p) => ({
    id: `${p.id}-brief-1`,
    project_id: p.id,
    version: 1,
    content: { features: ['a'], decisions: [] },
  }))

  return { projects, sessions, messages, briefs }
}

function makeFakeDb(fixture: ReturnType<typeof makeFixture>) {
  let getCount = 0

  const all: Record<string, Array<Record<string, unknown>>> = {
    projects: fixture.projects,
    sessions: fixture.sessions,
    messages: fixture.messages,
    briefs: fixture.briefs,
  }

  function makeQuery(state: QueryState) {
    const chain = {
      where(field: string, op: string, value: unknown) {
        return makeQuery({
          ...state,
          filters: [...state.filters, { field, op, value }],
        })
      },
      orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
        return makeQuery({ ...state, orderBy: { field, dir } })
      },
      limit(n: number) {
        return makeQuery({ ...state, limitN: n })
      },
      select(...fields: string[]) {
        return makeQuery({ ...state, selected: fields })
      },
      async get() {
        getCount += 1
        let rows = all[state.collection] ?? []
        for (const f of state.filters) {
          rows = rows.filter((r) => {
            if (f.op === '==') return r[f.field] === f.value
            if (f.op === 'in') return Array.isArray(f.value) && (f.value as unknown[]).includes(r[f.field])
            return true
          })
        }
        if (state.orderBy) {
          const { field, dir } = state.orderBy
          rows = [...rows].sort((a, b) => {
            const av = a[field] as string
            const bv = b[field] as string
            if (av === bv) return 0
            const cmp = av < bv ? -1 : 1
            return dir === 'desc' ? -cmp : cmp
          })
        }
        if (state.limitN != null) {
          rows = rows.slice(0, state.limitN)
        }
        return {
          empty: rows.length === 0,
          size: rows.length,
          docs: rows.map((r) => ({ id: r.id as string, data: () => r })),
        }
      },
    }
    return chain
  }

  const db = {
    collection(name: string) {
      return {
        ...makeQuery({ collection: name, filters: [], orderBy: null, limitN: null, selected: null }),
        doc(id: string) {
          return {
            async get() {
              getCount += 1
              const row = (all[name] ?? []).find((r) => r.id === id)
              return {
                exists: !!row,
                id,
                data: () => row,
              }
            },
          }
        },
      }
    },
    _getCount: () => getCount,
  }

  return db as unknown as FirebaseFirestore.Firestore & { _getCount: () => number }
}

describe('enrichProjects read budget', () => {
  it('issues ≤ 6 reads per project (10 projects × 3 sessions × 5 messages → ≤ 60 reads total)', async () => {
    const fixture = makeFixture()
    const db = makeFakeDb(fixture)
    const projectInputs = fixture.projects.map((p) => ({ ...p }))

    const result = await enrichProjects(db, projectInputs)

    expect(result).toHaveLength(10)
    // 1 sessions + 3 session-docs-in-snap = 1 collection query (counts as 1 .get())
    // Wait — sessions.where().select().get() counts as 1 .get() call (Firestore
    // batches in one round trip, billed as N reads but our test counts API hits).
    //
    // Per project we make:
    //   1 sessions.get()
    //   1 messages.get() (last any)
    //   1 messages.get() (last maker) — when requester_email present
    //   1 briefs.get()
    //   = 4 .get() calls per project
    // For 10 projects: 40 .get() calls.
    expect(db._getCount()).toBeLessThanOrEqual(40)
  })

  it('populates the expected enrichment fields', async () => {
    const fixture = makeFixture()
    const db = makeFakeDb(fixture)
    const result = await enrichProjects(db, fixture.projects.map((p) => ({ ...p })))

    const first = result[0]
    expect(first.session_count).toBe(3)
    expect(first.has_active_session).toBe(true)
    expect(first.last_message_at).toBeTruthy()
    expect(first.last_maker_message_at).toBeTruthy()
    expect(first.brief_version).toBe(1)
    expect(first.brief_feature_count).toBe(1)
  })

  it('skips the maker-message query when requester_email is missing', async () => {
    const fixture = makeFixture()
    // Strip requester_email from project-0 only.
    fixture.projects[0] = { ...fixture.projects[0], requester_email: undefined } as never
    const db = makeFakeDb(fixture)
    const result = await enrichProjects(db, fixture.projects.map((p) => ({ ...p })))

    expect(result[0].last_maker_message_at).toBeNull()
    // 9 projects × 4 + 1 project × 3 = 39 .get() calls
    expect(db._getCount()).toBeLessThanOrEqual(39)
  })
})
