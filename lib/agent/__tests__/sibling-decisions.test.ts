import { describe, it, expect } from 'vitest'
import {
  selectSiblingDecisions,
  renderSiblingDecisionsBlock,
} from '../sibling-decisions'

describe('selectSiblingDecisions', () => {
  it('keeps only locked decisions with valid topic + decision', () => {
    const items = selectSiblingDecisions([
      {
        title: 'Brief A',
        decisions: [
          { topic: 'Fee split', decision: '60/40 to the listing side', locked: true },
          { topic: 'Open item', decision: 'still deciding', locked: false },
          { topic: 'Payments', decision: 'Stripe only' }, // no locked flag
          { topic: '', decision: 'x', locked: true }, // malformed: empty topic
          { decision: 'y', locked: true }, // malformed: no topic
          'garbage', // malformed: not an object
        ],
      },
    ])
    expect(items).toEqual([
      { topic: 'Fee split', decision: '60/40 to the listing side', briefTitle: 'Brief A' },
    ])
  })

  it('orders by sibling title and caps at 20 total', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      topic: `T${i}`,
      decision: `D${i}`,
      locked: true,
    }))
    const items = selectSiblingDecisions([
      { title: 'Zeta', decisions: many },
      { title: 'Alpha', decisions: many },
    ])
    expect(items).toHaveLength(20)
    // Alpha sorts first, so its 15 come before Zeta's 5.
    expect(items.slice(0, 15).every((i) => i.briefTitle === 'Alpha')).toBe(true)
    expect(items.slice(15).every((i) => i.briefTitle === 'Zeta')).toBe(true)
  })

  it('handles missing/undefined decisions arrays', () => {
    expect(
      selectSiblingDecisions([{ title: 'A', decisions: undefined as unknown as unknown[] }]),
    ).toEqual([])
  })
})

describe('renderSiblingDecisionsBlock', () => {
  it('returns empty string for no items', () => {
    expect(renderSiblingDecisionsBlock([])).toBe('')
  })

  it('lists decisions with provenance and includes the reconcile guardrail', () => {
    const block = renderSiblingDecisionsBlock([
      { topic: 'Fee split', decision: '60/40', briefTitle: 'Brief A' },
    ])
    expect(block).toContain('## Decisions settled in related conversations')
    expect(block).toContain('**Fee split** — 60/40 _(from "Brief A")_')
    expect(block).toContain('contradicts')
    expect(block).toContain('confirm explicitly')
  })
})
