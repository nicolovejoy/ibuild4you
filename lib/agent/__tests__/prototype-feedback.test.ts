import { describe, it, expect } from 'vitest'
import {
  summarizePrototypeFeedback,
  renderPrototypeFeedbackBlock,
} from '../prototype-feedback'

// #72 slice A — recent Loop feedback rows feed the agent system prompt so Sam
// grounds the conversation in the real prototype instead of confabulating.

const NOW = new Date('2026-06-18T12:00:00Z').getTime()

const row = (over: Record<string, unknown> = {}) => ({
  type: 'bug',
  body: 'Footer link 404s',
  page_url: 'https://app.example.com/about?ref=email',
  status: 'new',
  created_at: '2026-06-18T09:00:00Z',
  ...over,
})

describe('summarizePrototypeFeedback', () => {
  it('normalizes a row: type, truncated body, path-only, age, resolved', () => {
    const [item] = summarizePrototypeFeedback([row()], NOW)
    expect(item).toEqual({
      type: 'bug',
      body: 'Footer link 404s',
      path: '/about',
      ageLabel: 'today',
      resolved: false,
    })
  })

  it('drops rows with empty or missing body', () => {
    const out = summarizePrototypeFeedback(
      [row({ body: '   ' }), row({ body: undefined }), row({ body: 'real' })],
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0].body).toBe('real')
  })

  it('caps at the limit, preserving input (newest-first) order', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ body: `note ${i}` }))
    const out = summarizePrototypeFeedback(rows, NOW, 8)
    expect(out).toHaveLength(8)
    expect(out[0].body).toBe('note 0')
    expect(out[7].body).toBe('note 7')
  })

  it('truncates long bodies with an ellipsis', () => {
    const out = summarizePrototypeFeedback([row({ body: 'x'.repeat(400) })], NOW)
    expect(out[0].body.length).toBeLessThanOrEqual(280)
    expect(out[0].body.endsWith('…')).toBe(true)
  })

  it('marks done/wontfix as resolved', () => {
    const out = summarizePrototypeFeedback(
      [row({ status: 'done' }), row({ status: 'wontfix' }), row({ status: 'new' })],
      NOW,
    )
    expect(out.map((i) => i.resolved)).toEqual([true, true, false])
  })

  it('labels age relative to now', () => {
    const ages = summarizePrototypeFeedback(
      [
        row({ created_at: '2026-06-18T01:00:00Z' }), // today
        row({ created_at: '2026-06-17T01:00:00Z' }), // yesterday
        row({ created_at: '2026-06-14T01:00:00Z' }), // 4 days ago
        row({ created_at: '2026-06-01T01:00:00Z' }), // weeks
      ],
      NOW,
      10,
    ).map((i) => i.ageLabel)
    expect(ages[0]).toBe('today')
    expect(ages[1]).toBe('yesterday')
    expect(ages[2]).toBe('4 days ago')
    expect(ages[3]).toMatch(/weeks ago/)
  })

  it('handles a relative-path page_url and an unparseable one', () => {
    const out = summarizePrototypeFeedback(
      [row({ page_url: '/checkout?x=1' }), row({ page_url: 'not a url' }), row({ page_url: undefined })],
      NOW,
    )
    expect(out[0].path).toBe('/checkout')
    expect(out[1].path).toBeNull()
    expect(out[2].path).toBeNull()
  })
})

describe('renderPrototypeFeedbackBlock', () => {
  it('returns null when there are no items', () => {
    expect(renderPrototypeFeedbackBlock([])).toBeNull()
  })

  it('renders a grounding block with honesty caveat and items', () => {
    const block = renderPrototypeFeedbackBlock(
      summarizePrototypeFeedback([row(), row({ type: 'idea', body: 'add dark mode', status: 'done' })], NOW),
    )!
    expect(block).toContain('## What the maker has reported from the prototype')
    expect(block).toContain('cannot see the live screen')
    expect(block).toContain('Footer link 404s')
    expect(block).toContain('(on /about)')
    expect(block).toContain('[marked resolved]')
  })
})
