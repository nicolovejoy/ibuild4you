import { describe, it, expect } from 'vitest'
import { isRepeatOf, normalizeLine, seenLines, splitNewText, MIN_EVIDENCE_LENGTH } from '../new-text'
// A real Apple Mail reply recorded from Resend: its attribution sits behind a `>` marker.
import receivedEmail from '../../../app/api/webhooks/resend/inbound/__tests__/fixtures/received-email.json'

const original = 'Hi Nico,\nThe lesson planner should show the whole week at once.\nBill'
const seen = seenLines([original])

describe('normalizeLine', () => {
  it('strips repeated quote markers, collapses whitespace and lowercases', () => {
    expect(normalizeLine('> >   The Lesson   planner ')).toBe('the lesson planner')
    expect(normalizeLine('plain line')).toBe('plain line')
  })
})

describe('seenLines', () => {
  it('holds only normalized lines at least MIN_EVIDENCE_LENGTH long', () => {
    expect(MIN_EVIDENCE_LENGTH).toBe(12)
    expect([...seen]).toEqual(['the lesson planner should show the whole week at once.'])
  })
})

describe('splitNewText', () => {
  it('a reply quoting an email we hold gives only the typed lines', () => {
    expect(
      splitNewText(
        'Sounds good, I will build the week view first.\n\nOn Tue, Nov 17, 2026, Bill Duris wrote:\n> Hi Nico,\n> The lesson planner should show the whole week at once.\n> Bill',
        seen
      )
    ).toEqual({ typed: 'Sounds good, I will build the week view first.', quotedUnseen: '' })
  })

  it('a reply quoting an email we never received recovers the quote, with its header', () => {
    expect(
      splitNewText(
        'Agreed on both.\n\nOn Wed, Nov 18, 2026, Bill Duris wrote:\n> Students also need a printable version of the plan.',
        seen
      )
    ).toEqual({
      typed: 'Agreed on both.',
      quotedUnseen:
        'On Wed, Nov 18, 2026, Bill Duris wrote:\nStudents also need a printable version of the plan.',
    })
  })

  it('a Gmail forward is quoted text', () => {
    const result = splitNewText(
      'FYI\n\n---------- Forwarded message ---------\nFrom: Bill Duris <b@aol.com>\nDate: Wed, Nov 18, 2026\n\nPlease add a metronome to the practice page.',
      new Set()
    )
    expect(result.typed).toBe('FYI')
    expect(result.quotedUnseen).toContain('Please add a metronome to the practice page.')
    // The divider stays with its From and Date lines.
    expect(result.quotedUnseen).toBe(
      '---------- Forwarded message ---------\nFrom: Bill Duris <b@aol.com>\nDate: Wed, Nov 18, 2026\n\nPlease add a metronome to the practice page.'
    )
  })

  it('an Outlook reply quoting an email we hold leaks no header lines', () => {
    expect(
      splitNewText(
        'Yes, will do.\r\n\r\nFrom: Bill Duris\r\nSent: Wednesday, November 18, 2026\r\nTo: Nico\r\nSubject: Planner\r\n\r\n' +
          original,
        seen
      )
    ).toEqual({ typed: 'Yes, will do.', quotedUnseen: '' })
  })

  it('a Gmail forward of an email we hold leaks no header lines', () => {
    expect(
      splitNewText(
        'FYI\n\n---------- Forwarded message ---------\nFrom: Bill Duris <b@aol.com>\nDate: Wed, Nov 18, 2026\nSubject: Planner\nTo: Nico <n@example.com>\n\n' +
          original,
        seen
      )
    ).toEqual({ typed: 'FYI', quotedUnseen: '' })
  })

  describe('an Apple Mail forward with quoted header fields', () => {
    const quotedOriginal = original
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    const forward =
      'FYI\n\nBegin forwarded message:\n\n> From: Bill Duris <b@aol.com>\n> Subject: Planner\n> Date: Wed, Nov 18, 2026\n> To: Nico\n> \n' +
      quotedOriginal

    it('leaks nothing when the body is held', () => {
      expect(splitNewText(forward, seen)).toEqual({ typed: 'FYI', quotedUnseen: '' })
    })

    it('keeps the divider, the fields and the body when the body is unseen', () => {
      expect(splitNewText(forward, new Set())).toEqual({
        typed: 'FYI',
        quotedUnseen:
          'Begin forwarded message:\n\nFrom: Bill Duris <b@aol.com>\nSubject: Planner\nDate: Wed, Nov 18, 2026\nTo: Nico\n\n' +
          original,
      })
    })
  })

  it('a short line never takes its fate from a line under another header', () => {
    expect(
      splitNewText(
        'Ok.\n\nFrom: Bill Duris\nSent: Wednesday, November 18, 2026\nTo: Nico\n\nCan it export to PDF as well?\n\nFrom: Nico\nSent: Tue\nTo: Bill\n\n' +
          original,
        seen
      )
    ).toEqual({
      typed: 'Ok.',
      quotedUnseen:
        'From: Bill Duris\nSent: Wednesday, November 18, 2026\nTo: Nico\n\nCan it export to PDF as well?',
    })
  })

  it('a header, a blank line, then a fully seen quote yields no quote', () => {
    expect(
      splitNewText(
        'Sounds good.\n\nOn Tue, Nov 17, 2026, Bill Duris wrote:\n\n> Hi Nico,\n> The lesson planner should show the whole week at once.\n> Bill',
        seen
      )
    ).toEqual({ typed: 'Sounds good.', quotedUnseen: '' })
  })

  it('an "On ..." typed line does not join a date-less "wrote:" line into a header', () => {
    expect(
      splitNewText(
        'On reflection, I agree.\nHere is what Danny wrote:\n> The lesson planner should show the whole week at once.',
        seen
      )
    ).toEqual({ typed: 'On reflection, I agree.\nHere is what Danny wrote:', quotedUnseen: '' })
  })

  it('an "On ..." typed line does not join a quoted line into a header', () => {
    const result = splitNewText(
      '> The lesson planner should show the whole week at once.\nOn Tuesday works for me.\n> > On Mon, Nico wrote:\n> > The lesson planner should show the whole week at once.',
      seen
    )
    expect(result.typed).toContain('On Tuesday works for me.')
  })

  it('a one-line "wrote:" with no date or address stays typed', () => {
    expect(
      splitNewText(
        'On reflection, this is what Danny wrote:\n> The lesson planner should show the whole week at once.',
        seen
      )
    ).toEqual({ typed: 'On reflection, this is what Danny wrote:', quotedUnseen: '' })
  })

  it('handles CRLF and an Outlook header block', () => {
    expect(
      splitNewText(
        'Yes.\r\n\r\nFrom: Bill Duris\r\nSent: Wednesday, November 18, 2026\r\nTo: Nico\r\n\r\nCan it export to PDF as well?',
        new Set()
      ).quotedUnseen
    ).toContain('Can it export to PDF as well?')
  })

  it('"Thanks" is never evidence: an unseen email keeps its short lines', () => {
    expect(splitNewText('Thanks\nBill', seenLines(['Thanks\nNico'])).typed).toBe('Thanks\nBill')
  })

  // Typed lines are never dropped line by line (F2): a member may type the same
  // short answer twice. Only a whole repeat of an earlier email (isRepeatOf)
  // has nothing new.
  it('a fully seen email keeps its typed lines; only quoted lines are filtered', () => {
    expect(splitNewText(original, seen)).toEqual({ typed: original, quotedUnseen: '' })
  })

  it('a typed answer seen in an earlier email is kept above a quote the app holds', () => {
    const question = 'Should the week view start on Monday or on Sunday?'
    const held = seenLines(['Yes, go ahead with that.', question])
    expect(
      splitNewText(`Yes, go ahead with that.\n\nOn Wed, Nov 18, 2026, Nico wrote:\n> ${question}`, held)
    ).toEqual({ typed: 'Yes, go ahead with that.', quotedUnseen: '' })
  })

  it('a re-quoted line with extra markers and spacing still matches', () => {
    expect(
      splitNewText('> >   The lesson planner should show   the whole week at once.', seen)
    ).toEqual({
      typed: '',
      quotedUnseen: '',
    })
  })

  it('a short typed line after a seen quoted line is kept', () => {
    expect(
      splitNewText('> The lesson planner should show the whole week at once.\nYes agreed', seen)
    ).toEqual({ typed: 'Yes agreed', quotedUnseen: '' })
  })

  it('recognises an "On ... wrote:" header wrapped over two lines', () => {
    expect(
      splitNewText(
        'Agreed.\n\nOn Wed, Nov 18, 2026 at 3:04 PM Bill Duris <\nb@aol.com> wrote:\n> Students also need a printable version of the plan.',
        seen
      )
    ).toEqual({
      typed: 'Agreed.',
      quotedUnseen:
        'On Wed, Nov 18, 2026 at 3:04 PM Bill Duris <\nb@aol.com> wrote:\nStudents also need a printable version of the plan.',
    })
  })

  describe('an Apple Mail reply whose attribution carries a quote marker', () => {
    const quotedLine = 'I will build the week view of the lesson planner first.'

    it('leaks no attribution when the quote is held', () => {
      expect(splitNewText(receivedEmail.text, seenLines([quotedLine]))).toEqual({
        typed: 'Sounds good, the week view first please.',
        quotedUnseen: '',
      })
    })

    it('keeps the attribution and the quoted line when the quote is unseen', () => {
      expect(splitNewText(receivedEmail.text, new Set())).toEqual({
        typed: 'Sounds good, the week view first please.',
        quotedUnseen: `On Nov 20, 2026, at 9:31 AM, Nico Builder <nico@example.org> wrote:\n\n${quotedLine}`,
      })
    })

    const wrapped =
      'Sounds good.\n\n> On Nov 20, 2026, at 9:31 AM, Nico Builder\n> <nico@example.org> wrote:\n> \n> ' +
      quotedLine

    it('recognises it wrapped over two marked lines', () => {
      expect(splitNewText(wrapped, seenLines([quotedLine]))).toEqual({
        typed: 'Sounds good.',
        quotedUnseen: '',
      })
      expect(splitNewText(wrapped, new Set())).toEqual({
        typed: 'Sounds good.',
        quotedUnseen: `On Nov 20, 2026, at 9:31 AM, Nico Builder\n<nico@example.org> wrote:\n\n${quotedLine}`,
      })
    })

    it('a marked line does not join an unmarked or a blank marked line into a header', () => {
      expect(
        splitNewText(
          '> On Nov 20, 2026, at 9:31 AM, Nico Builder\n<nico@example.org> wrote:\n> ' + quotedLine,
          seenLines([quotedLine])
        )
      ).toEqual({
        typed: '<nico@example.org> wrote:',
        quotedUnseen: 'On Nov 20, 2026, at 9:31 AM, Nico Builder',
      })
      expect(
        splitNewText(
          '> On Nov 20, 2026, at 9:31 AM, Nico Builder\n> \n> <nico@example.org> wrote:\n> ' +
            quotedLine,
          seenLines([quotedLine])
        )
      ).toEqual({
        typed: '',
        quotedUnseen: 'On Nov 20, 2026, at 9:31 AM, Nico Builder\n\n<nico@example.org> wrote:',
      })
    })
  })

  it('a short quoted line whose only long neighbour comes after it takes that line’s fate', () => {
    const held = seenLines(['Please add a metronome to the practice page.'])
    expect(splitNewText('> Hi Nico,\n> Please add a metronome to the practice page.', held)).toEqual({
      typed: '',
      quotedUnseen: '',
    })
    expect(
      splitNewText('> Hi Nico,\n> Please add a metronome to the practice page.', new Set())
    ).toEqual({
      typed: '',
      quotedUnseen: 'Hi Nico,\nPlease add a metronome to the practice page.',
    })
  })

  it('a short typed line is kept whatever its long typed neighbour', () => {
    const held = seenLines(['Please add a metronome to the practice page.'])
    expect(splitNewText('Hi Nico,\nPlease add a metronome to the practice page.', held)).toEqual({
      typed: 'Hi Nico,\nPlease add a metronome to the practice page.',
      quotedUnseen: '',
    })
  })
})

describe('isRepeatOf', () => {
  const question = 'Should the week view start on Monday or on Sunday?'
  const reply = `Yes, go ahead with that.\n\nOn Wed, Nov 18, 2026, Nico wrote:\n> ${question}`

  it('the same email sent twice is a repeat', () => {
    expect(isRepeatOf(original, original)).toBe(true)
    expect(isRepeatOf(reply, reply)).toBe(true)
  })

  it('ignores short lines, spacing, case and quote markers', () => {
    expect(isRepeatOf('Hi Bill,\nThe Lesson planner should show the   whole week at once.\nNico', original)).toBe(true)
  })

  it('a repeated typed answer above a quote the earlier email did not hold is not a repeat', () => {
    expect(isRepeatOf(reply, 'Yes, go ahead with that.')).toBe(false)
  })

  it('an email with no evidence-length line is never a repeat', () => {
    expect(isRepeatOf('Thanks\nBill', 'Thanks\nBill')).toBe(false)
    expect(isRepeatOf('', '')).toBe(false)
  })

  it('a typed line that the earlier email only quoted is not a repeat', () => {
    const quotedIt = `Noted.\n\nOn Tue, Nov 17, 2026, Bill Duris wrote:\n> The lesson planner should show the whole week at once.`
    expect(isRepeatOf(original, quotedIt)).toBe(false)
  })

  it('a quoted line that the earlier email only typed is not a repeat', () => {
    expect(isRepeatOf('> The lesson planner should show the whole week at once.', original)).toBe(false)
  })

  it('a line added to an earlier email makes it new', () => {
    expect(isRepeatOf(`${original}\nAnd a printable version for students too.`, original)).toBe(false)
  })

  it('leaves header lines out of the comparison', () => {
    // Same answer and quote under an attribution with another date.
    const later = reply.replace('Wed, Nov 18', 'Thu, Nov 19')
    expect(isRepeatOf(later, reply)).toBe(true)
  })
})
