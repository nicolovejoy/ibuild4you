import { describe, it, expect } from 'vitest'
import { normalizeLine, seenLines, splitNewText, MIN_EVIDENCE_LENGTH } from '../new-text'

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

  it('a fully seen email yields nothing', () => {
    expect(splitNewText(original, seen)).toEqual({ typed: '', quotedUnseen: '' })
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

  it('a short line whose only long neighbour comes after it takes that line’s fate', () => {
    const held = seenLines(['Please add a metronome to the practice page.'])
    expect(splitNewText('Hi Nico,\nPlease add a metronome to the practice page.', held)).toEqual({
      typed: '',
      quotedUnseen: '',
    })
    expect(
      splitNewText('Hi Nico,\nPlease add a metronome to the practice page.', new Set())
    ).toEqual({
      typed: 'Hi Nico,\nPlease add a metronome to the practice page.',
      quotedUnseen: '',
    })
  })
})
