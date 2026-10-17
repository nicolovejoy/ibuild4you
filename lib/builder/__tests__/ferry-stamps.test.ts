import { describe, it, expect } from 'vitest'
import { ferryStamps, makerNewerThanPaste, formatStampPacific } from '../ferry-stamps'

const NOW = new Date('2026-10-17T18:00:00.000Z')

describe('makerNewerThanPaste', () => {
  it('true when maker message is after the last paste', () => {
    expect(
      makerNewerThanPaste({
        last_maker_message_at: '2026-10-17T18:00:00.000Z',
        payload_pasted_at: '2026-10-16T23:40:00.000Z',
      })
    ).toBe(true)
  })
  it('false when the paste is newer', () => {
    expect(
      makerNewerThanPaste({
        last_maker_message_at: '2026-10-16T10:00:00.000Z',
        payload_pasted_at: '2026-10-16T23:40:00.000Z',
      })
    ).toBe(false)
  })
  it('true when maker activity exists and nothing was ever pasted', () => {
    expect(makerNewerThanPaste({ last_maker_message_at: '2026-10-17T18:00:00.000Z' })).toBe(true)
  })
  it('false when there is no maker activity', () => {
    expect(makerNewerThanPaste({ payload_pasted_at: '2026-10-16T23:40:00.000Z' })).toBe(false)
    expect(makerNewerThanPaste({})).toBe(false)
  })
})

describe('formatStampPacific', () => {
  it('formats in Pacific time', () => {
    expect(formatStampPacific('2026-10-17T16:14:00.000Z')).toMatch(/Oct 17.*9:14 AM/)
  })
  it('returns empty string on bad input', () => {
    expect(formatStampPacific('nope')).toBe('')
    expect(formatStampPacific(null)).toBe('')
    expect(formatStampPacific(undefined)).toBe('')
  })
})

describe('ferryStamps', () => {
  it('formats Pacific absolute + relative for each stamp', () => {
    const s = ferryStamps(
      {
        prep_copied_at: '2026-10-17T16:14:00.000Z',
        payload_pasted_at: '2026-10-17T16:20:00.000Z',
        last_maker_message_at: '2026-10-17T17:00:00.000Z',
        brief_version: 4,
        requester_first_name: 'Sam',
      },
      NOW
    )
    expect(s.copied.at).toBe('2026-10-17T16:14:00.000Z')
    expect(s.copied.absolute).toMatch(/Oct 17.*9:14 AM/)
    expect(s.copied.relative).toBe('1h ago')
    expect(s.pasted.version).toBe(4)
    expect(s.maker.who).toBe('Sam')
    expect(s.maker.newerThanPaste).toBe(true)
  })

  it('uses nulls and empty strings when a field is missing', () => {
    const s = ferryStamps({}, NOW)
    expect(s.copied).toEqual({ at: null, absolute: '', relative: '' })
    expect(s.pasted).toEqual({ at: null, absolute: '', relative: '', version: null })
    expect(s.maker).toEqual({ at: null, absolute: '', relative: '', who: null, newerThanPaste: false })
  })

  it('never yields "Invalid Date" for garbage input', () => {
    const s = ferryStamps(
      { prep_copied_at: 'garbage', payload_pasted_at: 'x', last_maker_message_at: '???' },
      NOW
    )
    expect(JSON.stringify(s)).not.toContain('Invalid Date')
    expect(s.copied.at).toBeNull()
    expect(s.copied.absolute).toBe('')
    expect(s.copied.relative).toBe('')
  })

  it('picks who from first name, then email local part', () => {
    expect(ferryStamps({ requester_first_name: 'Sam', requester_email: 'x@y.com' }, NOW).maker.who).toBe('Sam')
    expect(ferryStamps({ requester_email: 'dana.lee@y.com' }, NOW).maker.who).toBe('dana.lee')
    expect(ferryStamps({}, NOW).maker.who).toBeNull()
  })
})
