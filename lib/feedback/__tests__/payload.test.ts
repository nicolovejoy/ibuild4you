import { describe, it, expect } from 'vitest'
import {
  buildFeedbackPayload,
  validateFeedbackInput,
  MAX_FEEDBACK_BODY_CHARS,
} from '../payload'

describe('validateFeedbackInput', () => {
  it('accepts a minimal valid input', () => {
    const result = validateFeedbackInput({
      projectId: 'bakery-louise',
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
    pageUrl: 'https://bakerylouise.com/menu',
    userAgent: 'Mozilla/5.0',
    viewport: '1440x900',
    renderedAt: 1_700_000_000_000,
  }

  it('produces the wire payload the server expects', () => {
    const payload = buildFeedbackPayload(
      {
        projectId: '  bakery-louise  ',
        type: 'idea',
        body: '  add gluten-free section  ',
        submitterEmail: '  Jamie@Example.com  ',
      },
      ctx
    )

    expect(payload).toEqual({
      projectId: 'bakery-louise',
      type: 'idea',
      body: 'add gluten-free section',
      submitterEmail: 'jamie@example.com',
      pageUrl: 'https://bakerylouise.com/menu',
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
})
