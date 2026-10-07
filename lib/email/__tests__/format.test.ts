import { describe, it, expect } from 'vitest'
import { formatPacific } from '../format'

describe('formatPacific', () => {
  it('renders a summer UTC instant in Pacific Daylight Time with the zone named', () => {
    expect(formatPacific('2026-06-15T12:00:00.000Z')).toBe('Jun 15, 2026, 5:00 AM PDT')
  })

  it('renders a winter UTC instant in Pacific Standard Time', () => {
    expect(formatPacific('2026-01-15T12:00:00.000Z')).toBe('Jan 15, 2026, 4:00 AM PST')
  })

  it('rolls the calendar day back when UTC is already tomorrow', () => {
    // 01:30Z on the 16th is 6:30 PM on the 15th in LA.
    expect(formatPacific('2026-06-16T01:30:00.000Z')).toBe('Jun 15, 2026, 6:30 PM PDT')
  })

  it('returns an empty string for empty or invalid input instead of "Invalid Date"', () => {
    expect(formatPacific('')).toBe('')
    expect(formatPacific(null)).toBe('')
    expect(formatPacific(undefined)).toBe('')
    expect(formatPacific('not-a-date')).toBe('')
  })
})
