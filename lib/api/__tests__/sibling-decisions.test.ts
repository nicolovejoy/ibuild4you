import { describe, it, expect } from 'vitest'
import { fetchSiblingDecisions } from '../sibling-decisions'

// Minimal Firestore double: projects.where('github_repo','>','').get() returns
// `projectDocs`; briefs.where(...).orderBy(...).limit(...).get() returns the
// brief for the queried project_id from `briefsByProject`.
function makeDb(opts: {
  projectDocs: { id: string; data: Record<string, unknown> }[]
  briefsByProject?: Record<string, { content: unknown } | undefined>
  throwOnProjects?: boolean
}) {
  const projectSnap = {
    docs: opts.projectDocs.map((d) => ({ id: d.id, data: () => d.data })),
  }
  return {
    collection: (name: string) => {
      if (name === 'projects') {
        return {
          where: () => ({
            get: async () => {
              if (opts.throwOnProjects) throw new Error('boom')
              return projectSnap
            },
          }),
        }
      }
      // briefs
      let projectId = ''
      const chain = {
        where: (_f: string, _op: string, val: string) => {
          projectId = val
          return chain
        },
        orderBy: () => chain,
        limit: () => chain,
        get: async () => {
          const b = opts.briefsByProject?.[projectId]
          return b ? { empty: false, docs: [{ data: () => b }] } : { empty: true, docs: [] }
        },
      }
      return chain
    },
  } as unknown as FirebaseFirestore.Firestore
}

const lockedDecision = (topic: string, decision: string) => ({ topic, decision, locked: true })

describe('fetchSiblingDecisions', () => {
  it('returns [] when the project has no github_repo', async () => {
    const db = makeDb({ projectDocs: [] })
    expect(await fetchSiblingDecisions(db, { id: 'p1' })).toEqual([])
    expect(await fetchSiblingDecisions(db, { id: 'p1', github_repo: '' })).toEqual([])
    expect(await fetchSiblingDecisions(db, null)).toEqual([])
  })

  it('collects locked decisions from a sibling in the same (mixed-form) repo family', async () => {
    const db = makeDb({
      projectDocs: [
        { id: 'self', data: { github_repo: 'byside', title: 'Brief Self' } },
        { id: 'sib', data: { github_repo: 'nicolovejoy/byside', title: 'Brief Sibling' } },
        { id: 'other', data: { github_repo: 'nicolovejoy/prntd', title: 'Unrelated' } },
      ],
      briefsByProject: {
        sib: { content: { decisions: [lockedDecision('Fee split', '60/40'), { topic: 'x', decision: 'open' }] } },
        other: { content: { decisions: [lockedDecision('Nope', 'should not appear')] } },
      },
    })

    const items = await fetchSiblingDecisions(db, { id: 'self', github_repo: 'byside' })
    expect(items).toEqual([
      { topic: 'Fee split', decision: '60/40', briefTitle: 'Brief Sibling' },
    ])
  })

  it('excludes self even when self carries locked decisions', async () => {
    const db = makeDb({
      projectDocs: [{ id: 'self', data: { github_repo: 'byside', title: 'Brief Self' } }],
      briefsByProject: { self: { content: { decisions: [lockedDecision('Mine', 'x')] } } },
    })
    expect(await fetchSiblingDecisions(db, { id: 'self', github_repo: 'byside' })).toEqual([])
  })

  it('returns [] (never throws) when the query fails', async () => {
    const db = makeDb({ projectDocs: [], throwOnProjects: true })
    expect(await fetchSiblingDecisions(db, { id: 'self', github_repo: 'byside' })).toEqual([])
  })
})
