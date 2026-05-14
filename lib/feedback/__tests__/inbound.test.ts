import { describe, it, expect } from 'vitest'
import {
  parseFeedbackIdFromAddress,
  findFeedbackIdInRecipients,
  feedbackReplyAddress,
  buildInboundReply,
  FEEDBACK_INBOX_HOST,
} from '../inbound'

// =============================================================================
// Tests for the pure helpers behind the Resend inbound webhook. These do NOT
// touch Firestore, the network, or any env. They guard the address-parsing
// rules (the one place a wrong answer would either silently drop real replies
// or, worse, accept forged ones if combined with a missing signature check).
// =============================================================================

describe('feedbackReplyAddress', () => {
  it('forms a plus-addressed address pinned to the configured host', () => {
    expect(feedbackReplyAddress('abc123')).toBe(`feedback+abc123@${FEEDBACK_INBOX_HOST}`)
  })
})

describe('parseFeedbackIdFromAddress', () => {
  it('extracts the id from a bare plus-addressed address', () => {
    expect(parseFeedbackIdFromAddress(`feedback+abc123@${FEEDBACK_INBOX_HOST}`)).toBe('abc123')
  })

  it('extracts the id from an RFC 5322 "Name <addr>" form', () => {
    expect(
      parseFeedbackIdFromAddress(`Jamie Baker <feedback+xyz789@${FEEDBACK_INBOX_HOST}>`)
    ).toBe('xyz789')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseFeedbackIdFromAddress(`  feedback+abc@${FEEDBACK_INBOX_HOST}  `)).toBe('abc')
  })

  it('is case-insensitive on localpart and host', () => {
    expect(parseFeedbackIdFromAddress(`Feedback+ABC@${FEEDBACK_INBOX_HOST.toUpperCase()}`)).toBe(
      'abc'
    )
  })

  it('returns null when the plus-tag is empty', () => {
    expect(parseFeedbackIdFromAddress(`feedback+@${FEEDBACK_INBOX_HOST}`)).toBeNull()
  })

  it('returns null when there is no plus-tag', () => {
    expect(parseFeedbackIdFromAddress(`feedback@${FEEDBACK_INBOX_HOST}`)).toBeNull()
  })

  it('rejects a mismatched localpart (forgery-adjacent)', () => {
    expect(parseFeedbackIdFromAddress(`notify+abc@${FEEDBACK_INBOX_HOST}`)).toBeNull()
  })

  it('rejects a mismatched host (forgery-adjacent)', () => {
    expect(parseFeedbackIdFromAddress('feedback+abc@evil.example.com')).toBeNull()
  })

  it('returns null for malformed input', () => {
    expect(parseFeedbackIdFromAddress('')).toBeNull()
    expect(parseFeedbackIdFromAddress('not-an-email')).toBeNull()
    expect(parseFeedbackIdFromAddress('@no-localpart.com')).toBeNull()
  })
})

describe('findFeedbackIdInRecipients', () => {
  it('returns null when there are no recipients', () => {
    expect(findFeedbackIdInRecipients(undefined)).toBeNull()
    expect(findFeedbackIdInRecipients([])).toBeNull()
  })

  it('matches a single string recipient', () => {
    expect(findFeedbackIdInRecipients(`feedback+r1@${FEEDBACK_INBOX_HOST}`)).toBe('r1')
  })

  it('matches the first plus-addressed recipient in an array', () => {
    expect(
      findFeedbackIdInRecipients([
        'cc@other.example.com',
        `feedback+target@${FEEDBACK_INBOX_HOST}`,
      ])
    ).toBe('target')
  })

  it('splits a comma-separated recipient header', () => {
    expect(
      findFeedbackIdInRecipients(
        `cc@other.example.com, feedback+t1@${FEEDBACK_INBOX_HOST}`
      )
    ).toBe('t1')
  })

  it('returns null when no recipient matches', () => {
    expect(
      findFeedbackIdInRecipients(['cc@other.example.com', 'support@elsewhere.com'])
    ).toBeNull()
  })
})

describe('buildInboundReply', () => {
  it('lowercases the from_email and stamps both timestamps from the same now()', () => {
    const reply = buildInboundReply({
      feedbackId: 'fb-1',
      fromEmail: 'Jamie@Example.COM',
      body: 'Hey, two more notes on the bug',
      now: () => '2026-05-14T10:00:00.000Z',
    })
    expect(reply).toEqual({
      feedback_id: 'fb-1',
      from: 'submitter',
      from_email: 'jamie@example.com',
      body: 'Hey, two more notes on the bug',
      via_email: true,
      created_at: '2026-05-14T10:00:00.000Z',
      updated_at: '2026-05-14T10:00:00.000Z',
    })
  })

  it('preserves the body verbatim (no trimming, no truncation)', () => {
    const body = '  leading and trailing whitespace stays  '
    const reply = buildInboundReply({
      feedbackId: 'fb-1',
      fromEmail: 'a@b.com',
      body,
      now: () => '2026-05-14T10:00:00.000Z',
    })
    expect(reply.body).toBe(body)
  })
})
