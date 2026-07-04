import { describe, it, expect } from 'vitest'
import {
  summarizePrototypeContext,
  renderPrototypeContextBlock,
} from '../prototype-context'

// #72 slice B2 — structural page captures (prototype_context rows) feed the
// agent system prompt so Sam can orient a "walk me through the site" answer in
// the real page structure instead of confabulating.

const NOW = new Date('2026-07-04T12:00:00Z').getTime()

const row = (over: Record<string, unknown> = {}) => ({
  route: '/checkout',
  title: 'Checkout — Byside',
  outline: 'h1: Checkout\nbuttons: Place order | Cancel',
  status: 'active',
  created_at: '2026-07-04T09:00:00Z',
  ...over,
})

describe('summarizePrototypeContext', () => {
  it('normalizes a row: route, title, outline, age', () => {
    const [item] = summarizePrototypeContext([row()], NOW)
    expect(item).toEqual({
      route: '/checkout',
      title: 'Checkout — Byside',
      outline: 'h1: Checkout\nbuttons: Place order | Cancel',
      ageLabel: 'today',
    })
  })

  it('drops non-active rows (expired)', () => {
    const out = summarizePrototypeContext([row({ status: 'expired' }), row()], NOW)
    expect(out).toHaveLength(1)
  })

  it('drops rows older than 14 days — stale structure misleads more than it helps', () => {
    const out = summarizePrototypeContext(
      [row({ created_at: '2026-06-10T09:00:00Z' }), row()],
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0].ageLabel).toBe('today')
  })

  it('drops rows with no route and no outline', () => {
    const out = summarizePrototypeContext([row({ route: '', outline: '  ' }), row()], NOW)
    expect(out).toHaveLength(1)
  })

  it('caps at the limit, preserving newest-first order', () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ route: `/page-${i}` }))
    const out = summarizePrototypeContext(rows, NOW)
    expect(out).toHaveLength(3)
    expect(out.map((i) => i.route)).toEqual(['/page-0', '/page-1', '/page-2'])
  })

  it('truncates very long outlines', () => {
    const out = summarizePrototypeContext([row({ outline: 'x'.repeat(5000) })], NOW)
    expect(out[0].outline.length).toBeLessThanOrEqual(2000)
    expect(out[0].outline.endsWith('…')).toBe(true)
  })

  it('tolerates missing fields', () => {
    const out = summarizePrototypeContext([{ route: '/a', created_at: undefined }], NOW)
    expect(out[0]).toEqual({ route: '/a', title: '', outline: '', ageLabel: 'recently' })
  })
})

describe('renderPrototypeContextBlock', () => {
  it('returns null when there are no items', () => {
    expect(renderPrototypeContextBlock([])).toBeNull()
  })

  it('renders captures with routes, outlines, and the honesty guardrail', () => {
    const block = renderPrototypeContextBlock(
      summarizePrototypeContext(
        [row(), row({ route: '/offers', title: 'Offers', outline: 'h1: Offers\nlist: 8 items', created_at: '2026-07-01T09:00:00Z' })],
        NOW,
      ),
    )!
    expect(block).toContain("## What the maker's screen looked like (structure)")
    expect(block).toContain('/checkout')
    expect(block).toContain('Place order')
    expect(block).toContain('/offers — Offers')
    expect(block).toContain('(3 days ago)')
    // Structural snapshots, not vision — Sam must not invent visual details.
    expect(block).toMatch(/structural snapshot/i)
    expect(block).toMatch(/don't invent visual details/i)
  })
})
