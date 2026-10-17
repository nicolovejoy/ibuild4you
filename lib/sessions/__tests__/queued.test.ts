import { describe, it, expect } from 'vitest'
import { isPayloadQueued } from '../queued'

describe('isPayloadQueued', () => {
  it('false with no paste stamp', () =>
    expect(isPayloadQueued({ last_maker_message_at: '2026-10-17T10:00:00.000Z' })).toBe(false))
  it('false when paste is older than the last maker message', () =>
    expect(
      isPayloadQueued({ payload_pasted_at: '2026-10-17T09:00:00.000Z', last_maker_message_at: '2026-10-17T10:00:00.000Z' }),
    ).toBe(false))
  it('false when paste equals the last maker message', () =>
    expect(
      isPayloadQueued({ payload_pasted_at: '2026-10-17T10:00:00.000Z', last_maker_message_at: '2026-10-17T10:00:00.000Z' }),
    ).toBe(false))
  it('true when paste is newer', () =>
    expect(
      isPayloadQueued({ payload_pasted_at: '2026-10-17T11:00:00.000Z', last_maker_message_at: '2026-10-17T10:00:00.000Z' }),
    ).toBe(true))
  it('true when pasted and no maker history', () =>
    expect(isPayloadQueued({ payload_pasted_at: '2026-10-17T11:00:00.000Z' })).toBe(true))
  it('false when both absent', () => expect(isPayloadQueued({})).toBe(false))
})
