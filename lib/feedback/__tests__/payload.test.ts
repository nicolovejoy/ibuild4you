import { describe, it, expect } from 'vitest'
import {
  buildFeedbackPayload,
  validateFeedbackInput,
  MAX_FEEDBACK_BODY_CHARS,
} from '../payload'

describe('validateFeedbackInput', () => {
  it('accepts a minimal valid input', () => {
    const result = validateFeedbackInput({
      projectId: 'sample-cafe',
      type: 'bug',
      body: 'The order button does nothing',
    })
    expect(result.ok).toBe(true)
  })

  it('rejects missing projectId', () => {
    const result = validateFeedbackInput({ projectId: '', type: 'bug', body: 'x' })
    expect(result).toEqual({ ok: false, field: 'projectId', message: expect.any(String) })
  })

  it('rejects an invalid type', () => {
    const result = validateFeedbackInput({
      projectId: 'p',
      type: 'feature' as unknown as 'bug',
      body: 'x',
    })
    expect(result).toEqual({ ok: false, field: 'type', message: expect.any(String) })
  })

  it('rejects empty body (after trim)', () => {
    const result = validateFeedbackInput({ projectId: 'p', type: 'bug', body: '   \n  ' })
    expect(result).toEqual({ ok: false, field: 'body', message: expect.any(String) })
  })

  it('rejects body over the max length', () => {
    const result = validateFeedbackInput({
      projectId: 'p',
      type: 'bug',
      body: 'a'.repeat(MAX_FEEDBACK_BODY_CHARS + 1),
    })
    expect(result).toEqual({ ok: false, field: 'body', message: expect.any(String) })
  })

  it('rejects malformed submitter email', () => {
    const result = validateFeedbackInput({
      projectId: 'p',
      type: 'bug',
      body: 'x',
      submitterEmail: 'not-an-email',
    })
    expect(result).toEqual({ ok: false, field: 'submitterEmail', message: expect.any(String) })
  })

  it('accepts an omitted/empty submitter email', () => {
    expect(validateFeedbackInput({ projectId: 'p', type: 'bug', body: 'x' }).ok).toBe(true)
    expect(
      validateFeedbackInput({ projectId: 'p', type: 'bug', body: 'x', submitterEmail: '' }).ok
    ).toBe(true)
  })
})

describe('buildFeedbackPayload', () => {
  const ctx = {
    pageUrl: 'https://samplecafe.com/menu',
    userAgent: 'Mozilla/5.0',
    viewport: '1440x900',
    renderedAt: 1_700_000_000_000,
  }

  it('produces the wire payload the server expects', () => {
    const payload = buildFeedbackPayload(
      {
        projectId: '  sample-cafe  ',
        type: 'idea',
        body: '  add gluten-free section  ',
        submitterEmail: '  Sam@Example.com  ',
      },
      ctx
    )

    expect(payload).toEqual({
      projectId: 'sample-cafe',
      type: 'idea',
      body: 'add gluten-free section',
      submitterEmail: 'sam@example.com',
      pageUrl: 'https://samplecafe.com/menu',
      userAgent: 'Mozilla/5.0',
      viewport: '1440x900',
      website: '',
      _ts: 1_700_000_000_000,
    })
  })

  it('omits submitterEmail when blank', () => {
    const payload = buildFeedbackPayload(
      { projectId: 'p', type: 'bug', body: 'x', submitterEmail: '   ' },
      ctx
    )
    expect(payload.submitterEmail).toBeUndefined()
  })

  it('always includes the honeypot field as an empty string', () => {
    const payload = buildFeedbackPayload({ projectId: 'p', type: 'bug', body: 'x' }, ctx)
    expect(payload.website).toBe('')
  })

  it('uses the provided render timestamp verbatim', () => {
    const payload = buildFeedbackPayload(
      { projectId: 'p', type: 'bug', body: 'x' },
      { ...ctx, renderedAt: 42 }
    )
    expect(payload._ts).toBe(42)
  })

  // #72 slice B1 — optional structural capture rides along additively.
  it('includes a capture when provided', () => {
    const capture = { v: 1 as const, route: '/menu', title: 'Menu', outline: 'h1: Menu' }
    const payload = buildFeedbackPayload({ projectId: 'p', type: 'bug', body: 'x' }, ctx, capture)
    expect(payload.capture).toEqual(capture)
  })

  it('omits the capture field entirely when not provided', () => {
    const payload = buildFeedbackPayload({ projectId: 'p', type: 'bug', body: 'x' }, ctx)
    expect('capture' in payload).toBe(false)
    expect(buildFeedbackPayload({ projectId: 'p', type: 'bug', body: 'x' }, ctx, null).capture).toBeUndefined()
  })

  // #149 — identityAssertion rides along additively, mirroring capture.
  it('includes identityAssertion when provided', () => {
    const payload = buildFeedbackPayload(
      { projectId: 'p', type: 'bug', body: 'x' },
      ctx,
      null,
      'header.sig'
    )
    expect(payload.identityAssertion).toBe('header.sig')
  })

  it('omits identityAssertion entirely when not provided', () => {
    const payload = buildFeedbackPayload({ projectId: 'p', type: 'bug', body: 'x' }, ctx)
    expect('identityAssertion' in payload).toBe(false)
  })
})
