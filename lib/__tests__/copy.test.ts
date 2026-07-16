import { describe, it, expect } from 'vitest'
import { copy, getMakerShortName } from '../copy'

// Light-touch tests on user-facing copy. Goal: lock in the framing decisions
// that get debated (brief language, no AI mechanism leakage in the invite),
// not exhaustive snapshotting.

describe('copy.invite.body', () => {
  // Garm consumer plan Phase 1 / PR A: invite copy is link-first now — no more
  // Email:/Passcode: lines. resetLink is a Firebase password-setup link, or
  // null if minting it failed (never blocks the invite from sending).
  const args = {
    projectTitle: "Sam's Cafe",
    shareLink: 'https://ibuild4you.com/projects/sams-cafe',
    resetLink: 'https://ibuild4you-a0c4d.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=abc',
  }

  it('leads with the brief (issue #20 — first line frames the work, not the tool)', () => {
    const body = copy.invite.body(args)
    // First non-blank line frames the work as putting together a brief.
    const firstLine = body.split('\n').find((l) => l.trim().length > 0)
    expect(firstLine).toMatch(/brief/i)
    // NOTE: #20's original "no AI-assistant mention anywhere" rule was relaxed
    // 2026-07-16 at Nico's request — the invite now names Sam and frames the
    // async-conversation model on purpose. The lead-with-the-brief intent
    // stays (asserted above); the blanket AI-mention ban does not.
  })

  it('embeds the project title so the maker sees what this is about', () => {
    expect(copy.invite.body(args)).toContain("Sam's Cafe")
  })

  it('signals continuity across multiple conversations', () => {
    expect(copy.invite.body(args)).toMatch(/across (a few|several|multiple)? ?sessions|come back/i)
  })

  it('includes the share link and the password-setup link, and mentions Google', () => {
    const body = copy.invite.body(args)
    expect(body).toContain(args.shareLink)
    expect(body).toContain(args.resetLink)
    expect(body).toMatch(/google/i)
  })

  it('never prints a raw email or a passcode (the thing being replaced)', () => {
    const body = copy.invite.body(args)
    expect(body).not.toMatch(/email:/i)
    expect(body).not.toMatch(/passcode/i)
  })

  it('degrades to a self-serve prompt when resetLink minting failed, with no dead end', () => {
    const body = copy.invite.body({ ...args, resetLink: null })
    expect(body).toMatch(/forgot password/i)
    expect(body).not.toContain('null')
  })

  it('always tells the recipient what to do if the link has expired', () => {
    // Firebase oob links expire — an invite that dead-ends on an expired link
    // is worse than the passcode it replaced, so this guidance must show up
    // whether or not resetLink was generated successfully.
    expect(copy.invite.body(args)).toMatch(/expired/i)
    expect(copy.invite.body(args)).toMatch(/forgot password/i)
    expect(copy.invite.body({ ...args, resetLink: null })).toMatch(/forgot password/i)
  })
})

describe('glossary (RAAC sweep)', () => {
  const g = copy.glossary as Record<string, unknown>

  it('exposes the RAAC role terms', () => {
    expect(copy.glossary.originator.term).toBe('Originator')
    expect(copy.glossary.contributor.term).toBe('Contributor')
    expect(copy.glossary.reviewer.term).toBe('Reviewer')
  })

  it('drops the legacy role/agent + nav keys', () => {
    expect(g.maker).toBeUndefined()
    expect(g.builder).toBeUndefined()
    expect(g.agent).toBeUndefined()
    // Nav reframe (5a): builder tabs are now Sessions / Setup.
    expect(g.conversation).toBeUndefined()
    expect(g.nextConversation).toBeUndefined()
  })

  it('uses Sessions/Setup as the builder-nav glossary keys', () => {
    expect(copy.glossary.session.term).toBe('Session')
    expect(copy.glossary.setup.term).toBe('Setup')
  })

  it('names the assistant Sam (chat) / Sam Scribe (glossary)', () => {
    expect(copy.chat.agentLabel).toBe('Sam')
    expect(copy.glossary.roan.term).toBe('Sam Scribe')
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
