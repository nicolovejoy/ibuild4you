import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { fetchPrototypeFeedback } from '../prototype-feedback'
import { fetchPrototypeContext } from '../prototype-context'
import { feedbackIdsForBrief } from '../apps'

// Fake db: apps.where('brief_id','==',x).limit(1).get(), and for the row
// collections where('project_id','==',x).orderBy().limit(n).get().
type Row = Record<string, unknown>
function makeDb(apps: Record<string, Row>, rows: Record<string, Record<string, Row>>) {
  return {
    collection: (name: string) => {
      if (name === 'apps') {
        return {
          where: (field: string, _op: string, v: string) => ({
            limit: () => ({
              get: async () => {
                const docs = Object.entries(apps)
                  .filter(([, a]) => a[field] === v)
                  .map(([id, a]) => ({ id, data: () => a }))
                return { empty: docs.length === 0, docs }
              },
            }),
          }),
        }
      }
      const coll = rows[name] ?? {}
      return {
        where: (_f: string, _op: string, v: string) => ({
          orderBy: () => ({
            limit: (n: number) => ({
              get: async () => {
                const docs = Object.entries(coll)
                  .filter(([, r]) => r.project_id === v)
                  .sort(([, a], [, b]) => String(b.created_at).localeCompare(String(a.created_at)))
                  .slice(0, n)
                  .map(([id, r]) => ({ id, data: () => r }))
                return { empty: docs.length === 0, docs }
              },
            }),
          }),
        }),
      }
    },
  } as unknown as Firestore
}

const NOW = new Date('2026-10-29T12:00:00Z').getTime()
const app = { slug: 'byside', legacy_slugs: ['old-brief-slug'], brief_id: 'brief-doc-1' }

describe('feedbackIdsForBrief', () => {
  it('returns canonical + legacy slugs for the linked app', async () => {
    const db = makeDb({ byside: app }, {})
    expect(await feedbackIdsForBrief(db, 'brief-doc-1', 'old-brief-slug')).toEqual([
      'byside',
      'old-brief-slug',
    ])
  })
  it('falls back to the brief slug when no app links the brief', async () => {
    const db = makeDb({ byside: app }, {})
    expect(await feedbackIdsForBrief(db, 'other-doc', 'some-brief')).toEqual(['some-brief'])
  })
})

describe('fetchPrototypeFeedback', () => {
  const fb = (body: string, at: string, pid: string) => ({
    project_id: pid,
    body,
    category: 'bug',
    route: '/x',
    created_at: at,
  })
  it('merges rows under the canonical and legacy ids', async () => {
    const db = makeDb(
      { byside: app },
      {
        feedback: {
          a: fb('canonical note', '2026-10-28T10:00:00Z', 'byside'),
          b: fb('legacy note', '2026-10-27T10:00:00Z', 'old-brief-slug'),
        },
      }
    )
    const items = JSON.stringify(await fetchPrototypeFeedback(db, 'brief-doc-1', 'old-brief-slug', NOW))
    expect(items).toContain('canonical note')
    expect(items).toContain('legacy note')
  })
  it('with no app, reads only the brief slug', async () => {
    const db = makeDb(
      {},
      {
        feedback: {
          a: fb('brief note', '2026-10-28T10:00:00Z', 'plain-brief'),
          b: fb('stranger', '2026-10-27T10:00:00Z', 'byside'),
        },
      }
    )
    const items = JSON.stringify(await fetchPrototypeFeedback(db, 'doc-9', 'plain-brief', NOW))
    expect(items).toContain('brief note')
    expect(items).not.toContain('stranger')
  })
})

describe('fetchPrototypeContext', () => {
  const cap = (outline: string, at: string, pid: string) => ({
    project_id: pid,
    route: '/p',
    title: 'T',
    outline,
    status: 'active',
    created_at: at,
  })
  it('merges captures under the canonical and legacy ids', async () => {
    const db = makeDb(
      { byside: app },
      {
        prototype_context: {
          a: cap('canonical outline', '2026-10-28T10:00:00Z', 'byside'),
          b: cap('legacy outline', '2026-10-27T10:00:00Z', 'old-brief-slug'),
        },
      }
    )
    const items = JSON.stringify(await fetchPrototypeContext(db, 'brief-doc-1', 'old-brief-slug', NOW))
    expect(items).toContain('canonical outline')
    expect(items).toContain('legacy outline')
  })
  it('with no app, reads only the brief slug', async () => {
    const db = makeDb(
      {},
      {
        prototype_context: {
          a: cap('brief outline', '2026-10-28T10:00:00Z', 'plain-brief'),
          b: cap('stranger outline', '2026-10-27T10:00:00Z', 'byside'),
        },
      }
    )
    const items = JSON.stringify(await fetchPrototypeContext(db, 'doc-9', 'plain-brief', NOW))
    expect(items).toContain('brief outline')
    expect(items).not.toContain('stranger outline')
  })
})
