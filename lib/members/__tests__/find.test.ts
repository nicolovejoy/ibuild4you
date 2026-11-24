import { describe, it, expect } from 'vitest'
import { findMemberRows, findViewerMemberRows } from '../find'

// A fake project_members collection: rows keyed by the second where() field.
function fakeDb(rows: { user_id?: Record<string, unknown>[]; email?: Record<string, unknown>[] }) {
  return {
    collection: () => ({
      where: () => ({
        where: (field: 'user_id' | 'email') => ({
          get: async () => ({ docs: (rows[field] ?? []).map((data) => ({ data: () => data })) }),
        }),
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore
}

const REMOVED = { role: 'maker', removed_at: '2026-11-01T00:00:00.000Z' }
const ACTIVE = { role: 'builder', removed_at: null }

describe('findMemberRows', () => {
  it('picks the active row, whatever the order', async () => {
    const found = await findMemberRows(fakeDb({ email: [REMOVED, ACTIVE] }), 'p1', 'email', 'a@x.com')
    expect(found.active?.data()).toBe(ACTIVE)
    expect(found.removed?.data()).toBe(REMOVED)
  })

  it('returns no active row when the only row is removed', async () => {
    const found = await findMemberRows(fakeDb({ email: [REMOVED] }), 'p1', 'email', 'a@x.com')
    expect(found.active).toBeUndefined()
    expect(found.removed?.data()).toBe(REMOVED)
  })

  it('returns nothing when there is no row', async () => {
    expect(await findMemberRows(fakeDb({}), 'p1', 'email', 'a@x.com')).toEqual({
      active: undefined,
      removed: undefined,
    })
  })
})

describe('findViewerMemberRows', () => {
  it('takes the active row by uid first', async () => {
    const byEmail = { role: 'maker', removed_at: null }
    const found = await findViewerMemberRows(fakeDb({ user_id: [ACTIVE], email: [byEmail] }), 'p1', 'u1', 'a@x.com')
    expect(found.active?.data()).toBe(ACTIVE)
  })

  it('passes over a removed row by uid for an active row by email', async () => {
    const found = await findViewerMemberRows(fakeDb({ user_id: [REMOVED], email: [ACTIVE] }), 'p1', 'u1', 'a@x.com')
    expect(found.active?.data()).toBe(ACTIVE)
    expect(found.removed?.data()).toBe(REMOVED)
  })

  it('reports the removed row when there is no active one', async () => {
    const found = await findViewerMemberRows(fakeDb({ email: [REMOVED] }), 'p1', 'u1', 'a@x.com')
    expect(found.active).toBeUndefined()
    expect(found.removed?.data()).toBe(REMOVED)
  })
})
