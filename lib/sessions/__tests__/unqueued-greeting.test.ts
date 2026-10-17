import { describe, it, expect, vi } from 'vitest'
import { unqueuedGreeting, ownerFirstName } from '../unqueued-greeting'

describe('unqueuedGreeting', () => {
  it('EN uses the builder name', () =>
    expect(unqueuedGreeting('en', 'Nico')).toContain("Nico hasn't queued our next conversation yet"))
  it('EN falls back to "your builder"', () =>
    expect(unqueuedGreeting('en', null)).toContain("your builder hasn't queued"))
  it('FR twin uses the name', () => expect(unqueuedGreeting('fr', 'Nico')).toMatch(/Nico/))
  it('FR falls back', () => expect(unqueuedGreeting('fr', undefined)).toMatch(/votre développeur/))
})

// --- ownerFirstName: a tiny in-memory fake of the two queries it makes ---
type Row = Record<string, unknown>
function fakeDb(tables: Record<string, Row[]>, opts: { throwOn?: string } = {}) {
  const query = (name: string, filters: [string, unknown][] = []) => ({
    where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]]),
    limit: () => query(name, filters),
    get: async () => {
      if (opts.throwOn === name) throw new TypeError('boom')
      const rows = (tables[name] || []).filter((r) => filters.every(([f, v]) => r[f] === v))
      return { empty: rows.length === 0, docs: rows.map((r) => ({ data: () => r })) }
    },
  })
  return { collection: (name: string) => query(name) } as unknown as import('firebase-admin/firestore').Firestore
}

describe('ownerFirstName', () => {
  it('skips a removed owner row and looks the active owner up by normalized email', async () => {
    const db = fakeDb({
      project_members: [
        { project_id: 'p1', role: 'owner', email: 'gone@x.com', removed_at: '2026-10-01T00:00:00.000Z' },
        { project_id: 'p1', role: 'owner', email: 'Nico@X.com' },
      ],
      users: [
        { email: 'gone@x.com', first_name: 'Gone' },
        { email: 'nico@x.com', first_name: ' Nico ' },
      ],
    })
    expect(await ownerFirstName(db, 'p1')).toBe('Nico')
  })

  it('null when the project has no active owner', async () => {
    const db = fakeDb({
      project_members: [{ project_id: 'p1', role: 'owner', email: 'gone@x.com', removed_at: '2026-10-01' }],
      users: [{ email: 'gone@x.com', first_name: 'Gone' }],
    })
    expect(await ownerFirstName(db, 'p1')).toBeNull()
  })

  it('null when the owner has no users row', async () => {
    const db = fakeDb({ project_members: [{ project_id: 'p1', role: 'owner', email: 'nico@x.com' }], users: [] })
    expect(await ownerFirstName(db, 'p1')).toBeNull()
  })

  it('null and a warning (error class only) when a lookup throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = fakeDb({ project_members: [{ project_id: 'p1', role: 'owner', email: 'nico@x.com' }] }, { throwOn: 'users' })
    expect(await ownerFirstName(db, 'p1')).toBeNull()
    expect(warn).toHaveBeenCalledWith('[unqueued-greeting] owner_lookup_failed', 'TypeError')
    warn.mockRestore()
  })
})
