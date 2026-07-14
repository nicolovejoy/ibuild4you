import { describe, it, expect } from 'vitest'
import { buildFeedbackEmail } from '../notify-email'

// =============================================================================
// Tests for the pure feedback-notification email builder (#143).
// No I/O — just subject/text shaping from a plain input object.
// =============================================================================

function baseInput(overrides: Partial<Parameters<typeof buildFeedbackEmail>[0]> = {}) {
  return {
    type: 'bug' as const,
    projectTitle: 'Sample Cafe',
    body: 'Header is broken on mobile',
    submitterEmail: 'sam@example.com',
    pageUrl: 'https://sample-cafe.com/menu',
    viewport: '375x812',
    userAgent: 'Mozilla/5.0',
    feedbackId: 'fb-123',
    burstIndex: 1,
    ...overrides,
  }
}

describe('buildFeedbackEmail — subject', () => {
  it('is [type] projectTitle: snippet, no slug', () => {
    const { subject } = buildFeedbackEmail(baseInput())
    expect(subject).toBe('[bug] Sample Cafe: Header is broken on mobile')
  })

  it('truncates a long body to ~60 chars with an ellipsis', () => {
    const body =
      'The checkout button does absolutely nothing when I tap it on my phone and it is very frustrating'
    const { subject } = buildFeedbackEmail(baseInput({ body }))
    const snippet = subject.split(': ').slice(1).join(': ')
    expect(snippet.endsWith('…')).toBe(true)
    // 60 chars of content + the ellipsis
    expect(snippet.length).toBeLessThanOrEqual(61)
    expect(subject.startsWith('[bug] Sample Cafe: ')).toBe(true)
  })

  it('collapses whitespace/newlines in the snippet', () => {
    const { subject } = buildFeedbackEmail(baseInput({ body: 'line one\n\n   line two' }))
    expect(subject).toBe('[bug] Sample Cafe: line one line two')
  })

  it('appends an ordinal burst suffix when burstIndex >= 2', () => {
    expect(buildFeedbackEmail(baseInput({ burstIndex: 2 })).subject).toContain(
      ' · 2nd note this session'
    )
    expect(buildFeedbackEmail(baseInput({ burstIndex: 3 })).subject).toContain(
      ' · 3rd note this session'
    )
    expect(buildFeedbackEmail(baseInput({ burstIndex: 4 })).subject).toContain(
      ' · 4th note this session'
    )
    expect(buildFeedbackEmail(baseInput({ burstIndex: 11 })).subject).toContain(
      ' · 11th note this session'
    )
    expect(buildFeedbackEmail(baseInput({ burstIndex: 21 })).subject).toContain(
      ' · 21st note this session'
    )
  })

  it('adds no burst suffix for burstIndex 1', () => {
    expect(buildFeedbackEmail(baseInput({ burstIndex: 1 })).subject).not.toContain('note this session')
  })

  it('uses the type verbatim (idea, other)', () => {
    expect(buildFeedbackEmail(baseInput({ type: 'idea' })).subject).toMatch(/^\[idea\] /)
    expect(buildFeedbackEmail(baseInput({ type: 'other' })).subject).toMatch(/^\[other\] /)
  })
})

describe('buildFeedbackEmail — text body', () => {
  it('orders body, page, review link, from, footer', () => {
    const { text } = buildFeedbackEmail(baseInput())
    expect(text).toBe(
      [
        'Header is broken on mobile',
        '',
        'Page: https://sample-cafe.com/menu',
        'Review: https://ibuild4you.com/admin/feedback?focus=fb-123',
        '',
        'From: sam@example.com',
        '',
        '—',
        'viewport: 375x812 · ua: Mozilla/5.0',
        'feedback id: fb-123',
      ].join('\n')
    )
  })

  it('shows n/a for an empty page url', () => {
    const { text } = buildFeedbackEmail(baseInput({ pageUrl: '' }))
    expect(text).toContain('Page: n/a')
  })

  it('marks an anonymous submitter explicitly', () => {
    const { text } = buildFeedbackEmail(baseInput({ submitterEmail: null }))
    expect(text).toContain('From: submitter not captured (widget not identity-aware yet)')
    expect(text).not.toContain('anonymous')
  })

  it('links the review URL with the raw feedback id', () => {
    const { text } = buildFeedbackEmail(baseInput({ feedbackId: 'abc-XYZ' }))
    expect(text).toContain('Review: https://ibuild4you.com/admin/feedback?focus=abc-XYZ')
  })

  it('handles empty viewport/ua gracefully in the footer', () => {
    const { text } = buildFeedbackEmail(baseInput({ viewport: '', userAgent: '' }))
    expect(text).toContain('viewport: n/a · ua: n/a')
  })
})
