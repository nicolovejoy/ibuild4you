import { describe, it, expect } from 'vitest'
import { isPayloadQueued, roundHarvested, isUnqueuedReturn } from '../queued'

const T9 = '2026-10-17T09:00:00.000Z'
const T10 = '2026-10-17T10:00:00.000Z'
const T11 = '2026-10-17T11:00:00.000Z'

describe('isPayloadQueued', () => {
  it('false with no paste stamp', () => expect(isPayloadQueued({ last_maker_message_at: T10 })).toBe(false))
  it('false when paste is older than the last maker message', () =>
    expect(isPayloadQueued({ payload_pasted_at: T9, last_maker_message_at: T10 })).toBe(false))
  it('false when paste equals the last maker message', () =>
    expect(isPayloadQueued({ payload_pasted_at: T10, last_maker_message_at: T10 })).toBe(false))
  it('true when paste is newer', () =>
    expect(isPayloadQueued({ payload_pasted_at: T11, last_maker_message_at: T10 })).toBe(true))
  it('true when pasted and no maker history', () => expect(isPayloadQueued({ payload_pasted_at: T11 })).toBe(true))
  it('false when both absent', () => expect(isPayloadQueued({})).toBe(false))
})

describe('roundHarvested', () => {
  it('false with no prep stamp', () => expect(roundHarvested({ last_maker_message_at: T10 })).toBe(false))
  it('false with a null prep stamp', () =>
    expect(roundHarvested({ prep_copied_at: null, last_maker_message_at: T10 })).toBe(false))
  it('false when prep was copied before the maker last spoke', () =>
    expect(roundHarvested({ prep_copied_at: T9, last_maker_message_at: T10 })).toBe(false))
  it('false when prep equals the last maker message', () =>
    expect(roundHarvested({ prep_copied_at: T10, last_maker_message_at: T10 })).toBe(false))
  it('true when prep was copied after the maker last spoke', () =>
    expect(roundHarvested({ prep_copied_at: T11, last_maker_message_at: T10 })).toBe(true))
  it('true when prep copied and no maker history', () => expect(roundHarvested({ prep_copied_at: T11 })).toBe(true))
})

describe('isUnqueuedReturn', () => {
  it('false when a payload is queued, even on an empty session', () =>
    expect(
      isUnqueuedReturn({
        project: { payload_pasted_at: T11, last_maker_message_at: T10 },
        sessionHasMakerMessage: false,
      }),
    ).toBe(false))
  it('true on an empty return session with nothing queued', () =>
    expect(isUnqueuedReturn({ project: { last_maker_message_at: T10 }, sessionHasMakerMessage: false })).toBe(true))
  it('false mid-round: the maker has spoken in this session and the builder has not harvested it', () =>
    expect(
      isUnqueuedReturn({
        project: { payload_pasted_at: T9, last_maker_message_at: T10 },
        sessionHasMakerMessage: true,
      }),
    ).toBe(false))
  it('false on a first session with maker messages and no stamps at all', () =>
    expect(isUnqueuedReturn({ project: { last_maker_message_at: T10 }, sessionHasMakerMessage: true })).toBe(false))
  it('true when the builder copied the prep after the maker last spoke (round over)', () =>
    expect(
      isUnqueuedReturn({
        project: { payload_pasted_at: T9, prep_copied_at: T11, last_maker_message_at: T10 },
        sessionHasMakerMessage: true,
      }),
    ).toBe(true))
})
