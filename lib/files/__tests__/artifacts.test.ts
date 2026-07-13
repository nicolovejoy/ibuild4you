import { describe, it, expect } from 'vitest'
import {
  ARTIFACT_PIN_CAP,
  validateLinkInput,
  countPinned,
  canPinMore,
  partitionPinned,
  isLinked,
} from '../artifacts'
import type { ProjectFile } from '@/lib/types'

// =============================================================================
// ARTIFACT PURE HELPERS (#83 Phase A)
// =============================================================================

function file(id: string, over: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id,
    project_id: 'p1',
    filename: `${id}.pdf`,
    uploaded_by_email: 'b@x.com',
    uploaded_by_uid: 'u1',
    created_at: '2026-07-13T00:00:00.000Z',
    updated_at: '2026-07-13T00:00:00.000Z',
    ...over,
  }
}

describe('validateLinkInput', () => {
  it('accepts a valid https link with a display name', () => {
    const r = validateLinkInput({ url: '  https://example.com/deck  ', filename: '  Pitch deck  ' })
    expect(r).toEqual({ ok: true, value: { url: 'https://example.com/deck', filename: 'Pitch deck', description: undefined } })
  })

  it('accepts http and trims an optional description', () => {
    const r = validateLinkInput({ url: 'http://a.co', filename: 'A', description: '  the mock  ' })
    expect(r.ok && r.value.description).toBe('the mock')
  })

  it('rejects a missing or non-http(s) url', () => {
    expect(validateLinkInput({ url: '', filename: 'A' }).ok).toBe(false)
    expect(validateLinkInput({ url: 'ftp://a.co', filename: 'A' }).ok).toBe(false)
    expect(validateLinkInput({ url: 'javascript:alert(1)', filename: 'A' }).ok).toBe(false)
    expect(validateLinkInput({ url: 'example.com', filename: 'A' }).ok).toBe(false)
  })

  it('defaults the display name to the url when filename blank or omitted', () => {
    expect((validateLinkInput({ url: 'https://a.co/x' }) as { value: { filename: string } }).value.filename).toBe('https://a.co/x')
    expect((validateLinkInput({ url: 'https://a.co/y', filename: '   ' }) as { value: { filename: string } }).value.filename).toBe('https://a.co/y')
  })
})

describe('pin cap', () => {
  it('counts only pinned files', () => {
    expect(countPinned([file('a', { pinned: true }), file('b'), file('c', { pinned: true })])).toBe(2)
  })

  it('allows pinning until the cap, then refuses', () => {
    const under = Array.from({ length: ARTIFACT_PIN_CAP - 1 }, (_, i) => file(`p${i}`, { pinned: true }))
    expect(canPinMore(under)).toBe(true)
    const atCap = Array.from({ length: ARTIFACT_PIN_CAP }, (_, i) => file(`p${i}`, { pinned: true }))
    expect(canPinMore(atCap)).toBe(false)
  })
})

describe('partitionPinned', () => {
  it('splits pinned from the rest, preserving input order in each', () => {
    const files = [file('a'), file('b', { pinned: true }), file('c'), file('d', { pinned: true })]
    const { pinned, rest } = partitionPinned(files)
    expect(pinned.map((f) => f.id)).toEqual(['b', 'd'])
    expect(rest.map((f) => f.id)).toEqual(['a', 'c'])
  })
})

describe('isLinked', () => {
  it('is true only for source=linked', () => {
    expect(isLinked(file('a', { source: 'linked', url: 'https://a.co' }))).toBe(true)
    expect(isLinked(file('a', { source: 'uploaded' }))).toBe(false)
    expect(isLinked(file('a'))).toBe(false)
  })
})
