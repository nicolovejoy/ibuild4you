import { describe, it, expect } from 'vitest'
import { applyBriefPatch, normalizeBriefPatch, removedDecisionTopics } from '../patch'
import { hasBriefContent } from '../has-content'
import type { BriefContent, BriefPatch } from '@/lib/types'

const base = (over: Partial<BriefContent> = {}): BriefContent => ({
  problem: 'P',
  target_users: 'T',
  features: [],
  constraints: 'C',
  additional_context: 'A',
  ...over,
})

describe('applyBriefPatch: text fields', () => {
  it('replaces a text field with a non-empty string', () => {
    const r = applyBriefPatch(base(), { constraints: 'New' })
    expect(r.content.constraints).toBe('New')
    expect(r.summary.fields_replaced).toEqual(['constraints'])
    expect(r.changed).toBe(true)
  })
  it('ignores an empty or blank string', () => {
    const r = applyBriefPatch(base(), { constraints: '', problem: '   ' })
    expect(r.content.constraints).toBe('C')
    expect(r.content.problem).toBe('P')
    expect(r.summary.fields_replaced).toEqual([])
    expect(r.changed).toBe(false)
  })
})

describe('applyBriefPatch: decisions', () => {
  const live = base({
    decisions: [
      { topic: 'Bar Ranges', decision: 'Four bars' },
      { topic: 'Other', decision: 'Stays' },
    ],
  })
  it('replaces a known topic in place and keeps the stored topic spelling', () => {
    const r = applyBriefPatch(live, { decisions: [{ topic: 'bar ranges', decision: 'Eight bars' }] })
    expect(r.content.decisions).toEqual([
      { topic: 'Bar Ranges', decision: 'Eight bars' },
      { topic: 'Other', decision: 'Stays' },
    ])
    expect(r.summary.decisions_revised).toBe(1)
    expect(r.summary.decisions_added).toBe(0)
  })
  it('appends a decision on a new topic', () => {
    const r = applyBriefPatch(live, { decisions: [{ topic: 'New topic', decision: 'X' }] })
    expect(r.content.decisions).toHaveLength(3)
    expect(r.content.decisions?.[2]).toEqual({ topic: 'New topic', decision: 'X' })
    expect(r.summary.decisions_added).toBe(1)
  })
  it('keeps one decision, the last text, when a topic appears twice in one patch', () => {
    const r = applyBriefPatch(live, {
      decisions: [
        { topic: 'Fresh', decision: 'first' },
        { topic: 'fresh', decision: 'second' },
      ],
    })
    const fresh = r.content.decisions?.filter((d) => d.topic.toLowerCase() === 'fresh')
    expect(fresh).toEqual([{ topic: 'fresh', decision: 'second' }])
    expect(r.summary.decisions_added).toBe(1)
  })
  it('does not count a replacement with the same text and lock flag as a revision', () => {
    const r = applyBriefPatch(live, { decisions: [{ topic: 'Bar Ranges', decision: 'four BARS.' }] })
    expect(r.summary.decisions_revised).toBe(0)
    expect(r.changed).toBe(false)
    expect(r.content).toEqual(live)
  })
  it('leaves a locked decision alone on a replacement or a drop and reports its stored topic', () => {
    const lockedLive = base({
      decisions: [{ topic: 'No Email', decision: 'Never email', locked: true, contested: { proposed: 'x', reason: 'y' } }],
    })
    const r = applyBriefPatch(lockedLive, {
      decisions: [{ topic: 'no email', decision: 'Email is fine' }],
      drop: { decisions: ['NO EMAIL'] },
    })
    expect(r.content).toEqual(lockedLive)
    expect(r.locksTouched).toEqual(['No Email'])
    expect(r.unmatched.decisions).toEqual([])
    expect(r.summary.decisions_revised).toBe(0)
    expect(r.summary.decisions_dropped).toBe(0)
    expect(r.changed).toBe(false)
  })
  it('adds a new decision with locked: true as locked', () => {
    const r = applyBriefPatch(live, { decisions: [{ topic: 'Rule', decision: 'Always', locked: true }] })
    expect(r.content.decisions?.[2]).toEqual({ topic: 'Rule', decision: 'Always', locked: true })
  })
  it('drops an unlocked decision by topic', () => {
    const r = applyBriefPatch(live, { drop: { decisions: ['other'] } })
    expect(r.content.decisions).toEqual([{ topic: 'Bar Ranges', decision: 'Four bars' }])
    expect(r.summary.decisions_dropped).toBe(1)
  })
})

describe('applyBriefPatch: features', () => {
  it('does not add a feature already present under different punctuation', () => {
    const r = applyBriefPatch(base({ features: ['Don’t email'] }), { features: ["Don't email"] })
    expect(r.content.features).toEqual(['Don’t email'])
    expect(r.summary.features_added).toBe(0)
  })
  it('appends a new feature', () => {
    const r = applyBriefPatch(base({ features: ['A'] }), { features: ['B'] })
    expect(r.content.features).toEqual(['A', 'B'])
    expect(r.summary.features_added).toBe(1)
  })
  it('removes every feature a drop text matches', () => {
    const r = applyBriefPatch(base({ features: ['Export CSV', 'export csv!', 'Keep'] }), {
      drop: { features: ['Export CSV'] },
    })
    expect(r.content.features).toEqual(['Keep'])
    expect(r.summary.features_dropped).toBe(2)
  })
})

describe('applyBriefPatch: open risks', () => {
  it('sets the owner on a matching unowned risk and keeps the stored text', () => {
    const r = applyBriefPatch(base({ open_risks: ['Who pays?', 'Other'] }), {
      open_risks: [{ text: 'who pays', owner: 'maker' }],
    })
    expect(r.content.open_risks).toEqual([{ text: 'Who pays?', owner: 'maker' }, 'Other'])
    expect(r.summary.risks_changed).toBe(1)
    expect(r.summary.risks_added).toBe(0)
  })
  it('changes the owner of a matching owned risk', () => {
    const live = base({ open_risks: [{ text: 'Who pays?', owner: 'maker' }] })
    const r = applyBriefPatch(live, { open_risks: [{ text: 'Who pays?', owner: 'builder' }] })
    expect(r.content.open_risks).toEqual([{ text: 'Who pays?', owner: 'builder' }])
    expect(r.summary.risks_changed).toBe(1)
  })
  it('leaves the brief alone when a matching risk comes with the same owner and different punctuation', () => {
    const live = base({ open_risks: [{ text: 'Who pays?', owner: 'maker' }] })
    const r = applyBriefPatch(live, { open_risks: [{ text: 'who pays', owner: 'maker' }] })
    expect(r.content).toEqual(live)
    expect(r.summary.risks_changed).toBe(0)
    expect(r.changed).toBe(false)
  })
  it('keeps the stored text and owner when the same risk is restated without an owner', () => {
    const live = base({ open_risks: [{ text: 'Won’t scale?', owner: 'maker' }] })
    const r = applyBriefPatch(live, { open_risks: ["won't scale"] })
    expect(r.content.open_risks).toEqual([{ text: 'Won’t scale?', owner: 'maker' }])
    expect(r.summary.risks_changed).toBe(0)
    expect(r.changed).toBe(false)
  })
  it('appends a new risk', () => {
    const r = applyBriefPatch(base({ open_risks: ['A'] }), { open_risks: ['B'] })
    expect(r.content.open_risks).toEqual(['A', 'B'])
    expect(r.summary.risks_added).toBe(1)
  })
  it('drops a risk stored with a curly apostrophe by its straight form', () => {
    const r = applyBriefPatch(base({ open_risks: ['Won’t scale', 'Keep'] }), {
      drop: { open_risks: ["Won't scale"] },
    })
    expect(r.content.open_risks).toEqual(['Keep'])
    expect(r.summary.risks_dropped).toBe(1)
  })
})

describe('applyBriefPatch: shipped and queued', () => {
  const live = base({ shipped: [{ date: '2026-11-10', items: ['Login'] }] })
  it('appends new items to the batch with the same date and skips ones already there', () => {
    const r = applyBriefPatch(live, { shipped: [{ date: '2026-11-10', items: ['login!', 'Chat'] }] })
    expect(r.content.shipped).toEqual([{ date: '2026-11-10', items: ['Login', 'Chat'] }])
    expect(r.summary.shipped_added).toBe(1)
  })
  it('adds a new batch for a new date and counts items', () => {
    const r = applyBriefPatch(live, { shipped: [{ date: '2026-11-18', items: ['A', 'B'] }] })
    expect(r.content.shipped).toEqual([
      { date: '2026-11-10', items: ['Login'] },
      { date: '2026-11-18', items: ['A', 'B'] },
    ])
    expect(r.summary.shipped_added).toBe(2)
  })
  it('adds nothing when every item of a batch is already shipped', () => {
    const r = applyBriefPatch(live, { shipped: [{ date: '2026-11-10', items: ['Login'] }] })
    expect(r.summary.shipped_added).toBe(0)
    expect(r.changed).toBe(false)
  })
  it('appends queued items, skipping a match', () => {
    const r = applyBriefPatch(base({ queued: ['One'] }), { queued: ['one', 'Two'] })
    expect(r.content.queued).toEqual(['One', 'Two'])
    expect(r.summary.queued_added).toBe(1)
  })
  it('drops a queued item and omits the key when the list ends up empty', () => {
    const r = applyBriefPatch(base({ queued: ['One'] }), { drop: { queued: ['ONE'] } })
    expect('queued' in r.content).toBe(false)
    expect(r.summary.queued_dropped).toBe(1)
  })
})

describe('applyBriefPatch: drops that match nothing', () => {
  it('lists each entry as sent in unmatched and leaves the content unchanged', () => {
    const live = base({
      features: ['F'],
      decisions: [{ topic: 'D', decision: 'x' }],
      open_risks: ['R'],
      queued: ['Q'],
    })
    const r = applyBriefPatch(live, {
      drop: { decisions: ['Nope D'], features: ['Nope F'], open_risks: ['Nope R'], queued: ['Nope Q'] },
    })
    expect(r.unmatched).toEqual({
      decisions: ['Nope D'],
      features: ['Nope F'],
      open_risks: ['Nope R'],
      queued: ['Nope Q'],
    })
    expect(r.content).toEqual(live)
    expect(r.changed).toBe(false)
  })
  it('has empty unmatched lists when everything matched', () => {
    const r = applyBriefPatch(base({ features: ['F'] }), { drop: { features: ['f'] } })
    expect(r.unmatched).toEqual({ decisions: [], features: [], open_risks: [], queued: [] })
  })
})

describe('applyBriefPatch: repeated drop entries', () => {
  it('treats drop entries that normalize to the same key as one', () => {
    const live = base({
      features: ['Export CSV', 'Keep'],
      open_risks: ['Who pays?'],
      queued: ['Q'],
      decisions: [{ topic: 'Other', decision: 'x' }],
    })
    const r = applyBriefPatch(live, {
      drop: {
        features: ['Export CSV', 'export csv!'],
        open_risks: ['Who pays?', 'who pays'],
        queued: ['Q', 'q'],
        decisions: ['Other', 'other'],
      },
    })
    expect(r.content.features).toEqual(['Keep'])
    expect(r.summary.features_dropped).toBe(1)
    expect(r.summary.risks_dropped).toBe(1)
    expect(r.summary.queued_dropped).toBe(1)
    expect(r.summary.decisions_dropped).toBe(1)
    expect(r.unmatched).toEqual({ decisions: [], features: [], open_risks: [], queued: [] })
  })
  it('lists a repeated entry that matches nothing once, as first sent', () => {
    const live = base({ features: ['F'], open_risks: ['R'], queued: ['Q'], decisions: [{ topic: 'D', decision: 'x' }] })
    const r = applyBriefPatch(live, {
      drop: {
        features: ['Nope', 'nope!'],
        open_risks: ['Nope', 'NOPE'],
        queued: ['Nope', 'nope'],
        decisions: ['Nope', 'nope'],
      },
    })
    expect(r.unmatched).toEqual({
      decisions: ['Nope'],
      features: ['Nope'],
      open_risks: ['Nope'],
      queued: ['Nope'],
    })
  })
  it('leaves a decision present once, with the new text, when one patch drops and adds its topic', () => {
    const live = base({ decisions: [{ topic: 'Other', decision: 'old' }, { topic: 'Keep', decision: 'k' }] })
    const r = applyBriefPatch(live, {
      decisions: [{ topic: 'other', decision: 'new' }],
      drop: { decisions: ['Other'] },
    })
    const other = r.content.decisions?.filter((d) => d.topic.toLowerCase() === 'other')
    expect(other).toEqual([{ topic: 'other', decision: 'new' }])
    expect(r.content.decisions).toHaveLength(2)
    expect(r.summary.decisions_dropped).toBe(1)
    expect(r.summary.decisions_added).toBe(1)
  })
})

describe('applyBriefPatch: no-op check', () => {
  it('reports no change for {} when live has queued and shipped before other keys (Firestore key order)', () => {
    const live = {
      additional_context: 'A',
      constraints: 'C',
      decisions: [{ topic: 'D', decision: 'x' }],
      features: ['F'],
      open_risks: ['R'],
      problem: 'P',
      queued: ['Q'],
      shipped: [{ date: '2026-11-10', items: ['S'] }],
      target_users: 'T',
    } as BriefContent
    const r = applyBriefPatch(live, {})
    expect(r.changed).toBe(false)
    expect(r.content).toEqual(live)
  })
  it('reports no change when every entry of a patch was already there, with queued before shipped', () => {
    const live = {
      problem: 'P',
      queued: ['Q'],
      shipped: [{ date: '2026-11-10', items: ['S'] }],
      target_users: 'T',
      features: ['F'],
      constraints: 'C',
      additional_context: 'A',
    } as BriefContent
    const r = applyBriefPatch(live, { queued: ['q'], features: ['f'], shipped: [{ date: '2026-11-10', items: ['s'] }] })
    expect(r.changed).toBe(false)
  })
  it('reports no change when live holds shipped or queued as empty arrays', () => {
    const r = applyBriefPatch(base({ shipped: [], queued: [] }), {})
    expect(r.changed).toBe(false)
  })
  it('ignores key order inside decision and risk objects', () => {
    const live = base({
      decisions: [{ decision: 'x', locked: true, topic: 'D' }],
      open_risks: [{ owner: 'maker', text: 'R' }],
    })
    const r = applyBriefPatch(live, { open_risks: [{ text: 'R', owner: 'maker' }] })
    expect(r.changed).toBe(false)
  })
  it('still reports a change when a value differs', () => {
    const live = base({ queued: ['Q'], shipped: [{ date: '2026-11-10', items: ['S'] }] })
    expect(applyBriefPatch(live, { queued: ['New'] }).changed).toBe(true)
    expect(applyBriefPatch(live, { problem: 'Other' }).changed).toBe(true)
  })
})

describe('applyBriefPatch: order and shape', () => {
  it('runs drops before additions, so a drop and an add of the same text leave it once', () => {
    const r = applyBriefPatch(base({ features: ['Export'], open_risks: ['R'], queued: ['Q'] }), {
      features: ['Export'],
      open_risks: ['R'],
      queued: ['Q'],
      drop: { features: ['Export'], open_risks: ['R'], queued: ['Q'] },
    })
    expect(r.content.features).toEqual(['Export'])
    expect(r.content.open_risks).toEqual(['R'])
    expect(r.content.queued).toEqual(['Q'])
  })
  it('adds to a brief with only the five required fields, and stays free of empty optional keys', () => {
    const live = base()
    const r = applyBriefPatch(live, {
      decisions: [{ topic: 'T', decision: 'D' }],
      open_risks: ['R'],
      queued: ['Q'],
      shipped: [{ date: '2026-11-18', items: ['S'] }],
    })
    expect(r.content.decisions).toEqual([{ topic: 'T', decision: 'D' }])
    expect(r.content.open_risks).toEqual(['R'])
    expect(r.content.queued).toEqual(['Q'])
    expect(r.content.shipped).toEqual([{ date: '2026-11-18', items: ['S'] }])
    const empty = applyBriefPatch(live, {})
    expect('shipped' in empty.content).toBe(false)
    expect('queued' in empty.content).toBe(false)
    expect('decisions' in empty.content).toBe(false)
    expect('open_risks' in empty.content).toBe(false)
  })
  it('treats {} as no change', () => {
    const live = base({ features: ['F'], decisions: [{ topic: 'D', decision: 'x' }] })
    const r = applyBriefPatch(live, {})
    expect(r.changed).toBe(false)
    expect(r.content).toEqual(live)
  })
  it('never mutates the live brief', () => {
    const live = base({
      features: ['F'],
      decisions: [{ topic: 'D', decision: 'x' }],
      open_risks: ['R'],
      shipped: [{ date: '2026-11-10', items: ['S'] }],
      queued: ['Q'],
    })
    const before = JSON.stringify(live)
    applyBriefPatch(live, {
      problem: 'New',
      features: ['G'],
      decisions: [{ topic: 'D', decision: 'y' }, { topic: 'E', decision: 'z' }],
      open_risks: [{ text: 'R', owner: 'maker' }],
      shipped: [{ date: '2026-11-10', items: ['S2'] }],
      queued: ['Q2'],
      drop: { features: ['F'], queued: ['Q'] },
    })
    expect(JSON.stringify(live)).toBe(before)
  })
})

describe('normalizeBriefPatch', () => {
  it('returns null unless the input is a plain object', () => {
    expect(normalizeBriefPatch(null)).toBeNull()
    expect(normalizeBriefPatch('x')).toBeNull()
    expect(normalizeBriefPatch([])).toBeNull()
  })
  it('ignores wrong types inside the patch', () => {
    expect(normalizeBriefPatch({ decisions: 'x', drop: 'y', features: [1, 'a', ' '] })).toEqual({
      features: ['a'],
    })
  })
  it('discards a shipped batch with no items', () => {
    expect(normalizeBriefPatch({ shipped: [{ date: '2026-11-18', items: [] }] })).toEqual({})
  })
  it('keeps decisions with string topic and decision, and only locked: true', () => {
    const out = normalizeBriefPatch({
      decisions: [
        { topic: 'A', decision: 'a', locked: true, decided_at: 'x', contested: {} },
        { topic: 'B', decision: 'b', locked: 'yes' },
        { topic: 'C' },
        { topic: 1, decision: 'd' },
        'junk',
      ],
    })
    expect(out).toEqual({
      decisions: [
        { topic: 'A', decision: 'a', locked: true },
        { topic: 'B', decision: 'b' },
      ],
    })
  })
  it('keeps text fields only when they are strings, and discards unknown keys', () => {
    expect(normalizeBriefPatch({ problem: 'P', constraints: 3, extra: 'x' })).toEqual({ problem: 'P' })
  })
  it('keeps risks, queued and drop lists through their normalizers', () => {
    expect(
      normalizeBriefPatch({
        open_risks: ['a', { text: 'b', owner: 'maker' }, { text: '' }],
        queued: [' q ', 2],
        drop: { decisions: ['d', ' '], features: [3], open_risks: ['r'], queued: ['q'], bogus: ['z'] },
      })
    ).toEqual({
      open_risks: ['a', { text: 'b', owner: 'maker' }],
      queued: ['q'],
      drop: { decisions: ['d'], open_risks: ['r'], queued: ['q'] },
    })
  })
  it('returns {} for an empty object', () => {
    expect(normalizeBriefPatch({})).toEqual({} satisfies BriefPatch)
  })
})

describe('removedDecisionTopics', () => {
  const live = base({
    decisions: [
      { topic: 'Keep', decision: 'a' },
      { topic: 'Gone', decision: 'b' },
    ],
  })
  it('returns stored topics missing from the next brief', () => {
    expect(removedDecisionTopics(live, base({ decisions: [{ topic: 'keep', decision: 'a' }] }))).toEqual(['Gone'])
  })
  it('returns [] when there is no live brief', () => {
    expect(removedDecisionTopics(null, live)).toEqual([])
  })
  it('returns all topics when the next brief has no decisions', () => {
    expect(removedDecisionTopics(live, base())).toEqual(['Keep', 'Gone'])
  })
})

describe('hasBriefContent', () => {
  it('is false for the all-empty brief', () => {
    expect(hasBriefContent(base({ problem: '', target_users: '', constraints: '', additional_context: '' }))).toBe(false)
  })
  it.each([
    ['problem', { problem: 'x' }],
    ['target_users', { target_users: 'x' }],
    ['features', { features: ['x'] }],
    ['constraints', { constraints: 'x' }],
    ['additional_context', { additional_context: 'x' }],
    ['decisions', { decisions: [{ topic: 't', decision: 'd' }] }],
    ['open_risks', { open_risks: ['r'] }],
    ['shipped', { shipped: [{ date: '2026-11-18', items: ['s'] }] }],
    ['queued', { queued: ['q'] }],
  ])('is true when only %s has data', (_name, over) => {
    const empty = base({ problem: '', target_users: '', constraints: '', additional_context: '' })
    expect(hasBriefContent({ ...empty, ...over } as BriefContent)).toBe(true)
  })
})
