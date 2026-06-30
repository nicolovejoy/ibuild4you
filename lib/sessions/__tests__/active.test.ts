import { describe, it, expect } from 'vitest'
import { isArchivedSession, excludeArchived } from '../active'

describe('isArchivedSession', () => {
  it('is true only for status archived', () => {
    expect(isArchivedSession({ status: 'archived' })).toBe(true)
    expect(isArchivedSession({ status: 'active' })).toBe(false)
    expect(isArchivedSession({ status: 'completed' })).toBe(false)
  })

  it('treats a missing status as not-archived (legacy sessions stay visible)', () => {
    expect(isArchivedSession({})).toBe(false)
    expect(isArchivedSession({ status: undefined })).toBe(false)
  })
})

describe('excludeArchived', () => {
  it('drops archived, keeps everything else (incl. missing status)', () => {
    const list = [
      { id: 'a', status: 'active' },
      { id: 'b', status: 'archived' },
      { id: 'c', status: 'completed' },
      { id: 'd' },
    ]
    expect(excludeArchived(list).map((s) => s.id)).toEqual(['a', 'c', 'd'])
  })

  it('returns a new array', () => {
    const list = [{ status: 'active' }]
    expect(excludeArchived(list)).not.toBe(list)
  })
})
