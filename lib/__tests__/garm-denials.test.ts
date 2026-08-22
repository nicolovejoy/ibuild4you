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
