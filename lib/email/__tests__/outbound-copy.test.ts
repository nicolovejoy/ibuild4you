import { describe, it, expect } from 'vitest'
import { copy } from '@/lib/copy'
import { outboundCopy, outboundCopyFor } from '../outbound-copy'

const link = 'https://ibuild4you.com/projects/lalbum'

describe('outboundCopyFor', () => {
  it('returns English for en, undefined and junk', () => {
    expect(outboundCopyFor('en')).toBe(outboundCopy.en)
    expect(outboundCopyFor(undefined)).toBe(outboundCopy.en)
    expect(outboundCopyFor('de')).toBe(outboundCopy.en)
  })

  it('returns French for fr', () => {
    expect(outboundCopyFor('fr')).toBe(outboundCopy.fr)
  })
})

describe('outboundCopy.en', () => {
  it('reads from lib/copy so English stays byte-identical', () => {
    const args = { firstName: 'Mara', sessionNumber: 2, shareLink: link }
    expect(outboundCopy.en.nudge.reminder(args)).toBe(copy.nudge.reminder(args))
    expect(outboundCopy.en.subject.reminder('T')).toBe(copy.email.subject.reminder('T'))
    expect(outboundCopy.en.passwordResetEmail({ resetLink: link })).toBe(
      copy.passwordResetEmail({ resetLink: link }),
    )
  })
})

describe('outboundCopy.fr', () => {
  it('reminder names the maker and the conversation number', () => {
    const text = outboundCopy.fr.nudge.reminder({
      firstName: 'Mathilde',
      sessionNumber: 1,
      shareLink: link,
    })
    expect(text).toBe(['Mathilde, votre prochaine conversation (nº 1) vous attend :', '', link].join('\n'))
  })

  it('reminder degrades without a name or number', () => {
    const text = outboundCopy.fr.nudge.reminder({ firstName: null, sessionNumber: null, shareLink: link })
    expect(text).toMatch(/^Votre prochaine conversation vous attend :/)
  })

  it('nudge body ends with the share link and uses the note when given', () => {
    const withNote = outboundCopy.fr.nudge.body({ projectTitle: 'L’album', shareLink: link, note: 'Une question.' })
    expect(withNote).toBe(['Nouvelle conversation prête pour L’album. Une question.', '', link].join('\n'))
    const converge = outboundCopy.fr.nudge.bodyText({ projectTitle: 'L’album', sessionMode: 'converge' })
    expect(converge).toContain('fixer quelques décisions')
  })

  it('invite falls back to the forgot-password hint when no reset link was minted', () => {
    const text = outboundCopy.fr.invite.body({ projectTitle: 'L’album', shareLink: link, resetLink: null })
    expect(text).toContain(link)
    expect(text).toContain('Mot de passe oublié')
    expect(text).not.toContain('Forgot password')
  })

  it('subjects are French', () => {
    expect(outboundCopy.fr.subject.reminder('L’album')).toBe('Votre conversation pour « L’album » est prête')
    expect(outboundCopy.fr.subject.passwordReset).toContain('mot de passe')
  })

  it('password reset email carries the link and the junk-folder note', () => {
    const text = outboundCopy.fr.passwordResetEmail({ resetLink: link })
    expect(text).toContain(link)
    expect(text.toLowerCase()).toContain('indésirables')
  })

  it('digest line renders with and without a conversation number', () => {
    expect(outboundCopy.fr.digest.line({ projectTitle: 'A', sessionNumber: 2, shareLink: link })).toBe(
      `- « A » — conversation nº 2 : ${link}`,
    )
    expect(outboundCopy.fr.digest.line({ projectTitle: 'B', sessionNumber: null, shareLink: link })).toBe(
      `- « B » : ${link}`,
    )
  })
})
