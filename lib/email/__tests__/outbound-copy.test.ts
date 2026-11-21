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
    const args = { firstName: 'Mara', sessionNumber: 2, projectTitle: 'T', shareLink: link }
    expect(outboundCopy.en.nudge.reminder(args)).toBe(copy.nudge.reminder(args))
    expect(outboundCopy.en.subject.reminder('T')).toBe(copy.email.subject.reminder('T'))
    expect(outboundCopy.en.passwordResetEmail({ resetLink: link })).toBe(
      copy.passwordResetEmail({ resetLink: link }),
    )
  })
})

describe('outboundCopy.fr', () => {
  it('reminder for a first conversation: greeting, what happens, the link, and how to reply', () => {
    const text = outboundCopy.fr.nudge.reminder({
      firstName: 'Mathilde',
      sessionNumber: 1,
      projectTitle: 'L’album',
      shareLink: link,
      canReply: true,
    })
    expect(text).toBe(
      [
        'Bonjour Mathilde,',
        '',
        'Votre conversation au sujet de L’album est prête sur iBuild4you. Sam, l’assistant, vous posera des questions sur votre idée et prendra des notes au fil de l’échange. Comptez environ 15 minutes ; vous pouvez vous arrêter et reprendre à tout moment.',
        '',
        `Voici votre lien : ${link}`,
        '',
        'Une question ? Répondez à cet e-mail.',
      ].join('\n'),
    )
  })

  it('reminder for a return conversation names its number; no name and no reply line degrade', () => {
    const text = outboundCopy.fr.nudge.reminder({
      firstName: null,
      sessionNumber: 3,
      projectTitle: 'L’album',
      shareLink: link,
    })
    expect(text).toMatch(/^Bonjour,\n\nLa conversation nº 3 au sujet de L’album est prête sur iBuild4you\. Sam reprend là où la précédente s’est arrêtée\./)
    expect(text).not.toContain('Répondez')
    const noNumber = outboundCopy.fr.nudge.reminder({ firstName: null, sessionNumber: null, projectTitle: 'L’album', shareLink: link })
    expect(noNumber).toContain('Votre prochaine conversation au sujet de L’album est prête')
  })

  it('link label names the project', () => {
    expect(outboundCopy.fr.linkLabel('L’album')).toBe('Ouvrir la conversation L’album')
    expect(outboundCopy.en.linkLabel('Stem Karaoke')).toBe('Open the Stem Karaoke conversation')
  })

  it('nudge body ends with the share link and uses the note when given', () => {
    const withNote = outboundCopy.fr.nudge.body({ projectTitle: 'L’album', shareLink: link, note: 'Une question.' })
    expect(withNote).toBe(['Nouvelle conversation prête pour L’album. Une question.', '', link].join('\n'))
    const converge = outboundCopy.fr.nudge.bodyText({ projectTitle: 'L’album', sessionMode: 'converge' })
    expect(converge).toContain('arrêter quelques décisions')
  })

  it('invite falls back to the forgot-password hint when no reset link was minted', () => {
    const text = outboundCopy.fr.invite.body({ projectTitle: 'L’album', shareLink: link, resetLink: null })
    expect(text).toContain(link)
    expect(text).toContain('Mot de passe oublié')
    expect(text).not.toContain('Forgot password')
  })

  // A straight double quote makes the mail library encode the whole subject,
  // which a spam filter scored against us (2026-11-21).
  it('English subjects carry no straight double quotes', () => {
    expect(outboundCopy.en.subject.reminder('Stem Karaoke')).toBe('Your conversation for Stem Karaoke is ready')
    expect(outboundCopy.en.subject.nudge('Stem Karaoke')).toBe('New conversation ready for Stem Karaoke')
    expect(outboundCopy.en.subject.invite('Stem Karaoke')).toBe('Your brief for Stem Karaoke')
  })

  it('English reminder: first conversation, return conversation, and the reply line only when asked', () => {
    const first = outboundCopy.en.nudge.reminder({
      firstName: 'Bobby',
      sessionNumber: 1,
      projectTitle: 'Stem Karaoke',
      shareLink: link,
      canReply: true,
    })
    expect(first).toBe(
      [
        'Hi Bobby,',
        '',
        'Your conversation about Stem Karaoke is ready on iBuild4you. Sam, the assistant, will ask about your idea and keep notes as you go. It takes about 15 minutes, and you can stop and come back any time.',
        '',
        `Here is your link: ${link}`,
        '',
        'Questions? Reply to this email.',
      ].join('\n'),
    )
    const back = outboundCopy.en.nudge.reminder({ firstName: null, sessionNumber: 3, projectTitle: 'Stem Karaoke', shareLink: link })
    expect(back).toMatch(/^Hello,\n\nConversation #3 about Stem Karaoke is ready on iBuild4you\. Sam picks up where you left off\./)
    expect(back).not.toContain('Reply to this email')
    const noNumber = outboundCopy.en.nudge.reminder({ firstName: null, sessionNumber: null, projectTitle: 'Stem Karaoke', shareLink: link })
    expect(noNumber).toContain('Your next conversation about Stem Karaoke is ready')
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
