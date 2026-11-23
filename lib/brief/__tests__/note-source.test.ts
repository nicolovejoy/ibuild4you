import { describe, it, expect } from 'vitest'
import { noteSource } from '@/lib/brief/note-source'

const oneEmail = [
  { from_name: 'Bill Duris', from_role: 'maker' as const, received_at: '2026-11-21T18:00:00.000Z' },
]

describe('noteSource', () => {
  it('uses made_from when the note has it', () => {
    expect(noteSource({ made_from: 'email', session_id: 's1', email_sources: [] })).toBe('email')
  })
  it('reads an older note with email sources and no session as email', () => {
    expect(noteSource({ session_id: null, email_sources: oneEmail })).toBe('email')
  })
  it('reads an older note with email sources and a session as both', () => {
    expect(noteSource({ session_id: 's1', email_sources: oneEmail })).toBe('both')
  })
  it('reads an older note with no email fields as chat', () => {
    expect(noteSource({ session_id: 's1' })).toBe('chat')
  })
  it('reads an older note with no session and no email sources as chat', () => {
    expect(noteSource({ session_id: null, email_sources: [] })).toBe('chat')
  })
  it('reads an older note with email_sources undefined and a null session as chat', () => {
    expect(noteSource({ session_id: null, email_sources: undefined })).toBe('chat')
  })
  it('ignores a stored made_from that is not one of the three values', () => {
    const odd = 'conversation' as unknown as 'chat'
    expect(noteSource({ made_from: odd, session_id: 's1', email_sources: oneEmail })).toBe('both')
    expect(noteSource({ made_from: odd, session_id: null, email_sources: oneEmail })).toBe('email')
    expect(noteSource({ made_from: odd, session_id: 's1' })).toBe('chat')
  })
})
