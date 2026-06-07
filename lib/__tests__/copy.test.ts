import { describe, it, expect } from 'vitest'
import { copy, getMakerShortName } from '../copy'

// Light-touch tests on user-facing copy. Goal: lock in the framing decisions
// that get debated (brief language, no AI mechanism leakage in the invite),
// not exhaustive snapshotting.

describe('copy.invite.body', () => {
  const args = {
    projectTitle: "Sam's Cafe",
    shareLink: 'https://ibuild4you.com/projects/sams-cafe',
    email: 'sam@example.com',
    passcode: '123456',
  }

  it('leads with the brief, not the AI mechanism (issue #20)', () => {
    const body = copy.invite.body(args)
    // First non-blank line frames the work as putting together a brief.
    const firstLine = body.split('\n').find((l) => l.trim().length > 0)
    expect(firstLine).toMatch(/brief/i)
    // No leakage of the AI implementation detail.
    expect(body).not.toMatch(/AI assistant/i)
  })

  it('embeds the project title so the maker sees what this is about', () => {
    expect(copy.invite.body(args)).toContain("Sam's Cafe")
  })

  it('signals continuity across multiple conversations', () => {
    expect(copy.invite.body(args)).toMatch(/across (a few|several|multiple)? ?sessions|come back/i)
  })

  it('includes the share link, email, and passcode for sign-in', () => {
    const body = copy.invite.body(args)
    expect(body).toContain(args.shareLink)
    expect(body).toContain(args.email)
    expect(body).toContain(args.passcode)
  })

  it('falls back to "(loading...)" when passcode is null', () => {
    expect(copy.invite.body({ ...args, passcode: null })).toContain('(loading...)')
  })
})

describe('glossary (RAAC sweep)', () => {
  const g = copy.glossary as Record<string, unknown>

  it('exposes the RAAC role terms', () => {
    expect(copy.glossary.originator.term).toBe('Originator')
    expect(copy.glossary.contributor.term).toBe('Contributor')
    expect(copy.glossary.reviewer.term).toBe('Reviewer')
  })

  it('drops the legacy role/agent keys swept in 3b', () => {
    expect(g.maker).toBeUndefined()
    expect(g.builder).toBeUndefined()
    expect(g.agent).toBeUndefined()
  })

  it('keeps the builder-nav keys pending the nav reframe', () => {
    expect(copy.glossary.conversation.short).toBeTruthy()
    expect(copy.glossary.nextConversation.short).toBeTruthy()
  })
})

describe('getMakerShortName', () => {
  it('prefers the first name', () => {
    expect(getMakerShortName('Sam', 'sam.lee@example.com')).toBe('Sam')
  })

  it('falls back to the email local-part when no first name', () => {
    expect(getMakerShortName(undefined, 'sam.lee@example.com')).toBe('sam.lee')
    expect(getMakerShortName(null, 'sam.lee@example.com')).toBe('sam.lee')
  })

  it('uses the default generic fallback when neither is present', () => {
    expect(getMakerShortName(undefined, undefined)).toBe('maker')
    expect(getMakerShortName(null, null)).toBe('maker')
  })

  it('honors a custom fallback', () => {
    expect(getMakerShortName(undefined, undefined, 'the maker')).toBe('the maker')
  })
})
