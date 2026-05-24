import { describe, it, expect } from 'vitest'
import { copy } from '../copy'

// Light-touch tests on user-facing copy. Goal: lock in the framing decisions
// that get debated (brief language, no AI mechanism leakage in the invite),
// not exhaustive snapshotting.

describe('copy.invite.body', () => {
  const args = {
    projectTitle: "Jamie's Bakery",
    shareLink: 'https://ibuild4you.com/projects/jamies-bakery',
    email: 'jamie@example.com',
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
    expect(copy.invite.body(args)).toContain("Jamie's Bakery")
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
