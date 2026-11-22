import { describe, it, expect } from 'vitest'
import {
  allLines,
  isRepeatOf,
  normalizeLine,
  seenLines,
  splitNewText,
  MIN_EVIDENCE_LENGTH,
} from '../new-text'
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
    ).toMatchObject({ typed: 'Sounds good, I will build the week view first.', quotedUnseen: '', quotes: [] })
  })

  it('a reply quoting an email we never received recovers the quote, with its header', () => {
    expect(
      splitNewText(
        'Agreed on both.\n\nOn Wed, Nov 18, 2026, Bill Duris wrote:\n> Students also need a printable version of the plan.',
        seen
      )
    ).toMatchObject({
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
    ).toMatchObject({ typed: 'Yes, will do.', quotedUnseen: '', quotes: [] })
  })

  it('a Gmail forward of an email we hold leaks no header lines', () => {
    expect(
      splitNewText(
        'FYI\n\n---------- Forwarded message ---------\nFrom: Bill Duris <b@aol.com>\nDate: Wed, Nov 18, 2026\nSubject: Planner\nTo: Nico <n@example.com>\n\n' +
          original,
        seen
      )
    ).toMatchObject({ typed: 'FYI', quotedUnseen: '', quotes: [] })
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
      expect(splitNewText(forward, seen)).toMatchObject({ typed: 'FYI', quotedUnseen: '', quotes: [] })
    })

    it('keeps the divider, the fields and the body when the body is unseen', () => {
      expect(splitNewText(forward, new Set())).toMatchObject({
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
    ).toMatchObject({
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
    ).toMatchObject({ typed: 'Sounds good.', quotedUnseen: '', quotes: [] })
  })

  it('an "On ..." typed line does not join a date-less "wrote:" line into a header', () => {
    expect(
      splitNewText(
        'On reflection, I agree.\nHere is what Danny wrote:\n> The lesson planner should show the whole week at once.',
        seen
      )
    ).toMatchObject({ typed: 'On reflection, I agree.\nHere is what Danny wrote:', quotedUnseen: '', quotes: [] })
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
    ).toMatchObject({ typed: 'On reflection, this is what Danny wrote:', quotedUnseen: '', quotes: [] })
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
    expect(splitNewText(original, seen)).toMatchObject({ typed: original, quotedUnseen: '', quotes: [] })
  })

  it('a typed answer seen in an earlier email is kept above a quote the app holds', () => {
    const question = 'Should the week view start on Monday or on Sunday?'
    const held = seenLines(['Yes, go ahead with that.', question])
    expect(
      splitNewText(`Yes, go ahead with that.\n\nOn Wed, Nov 18, 2026, Nico wrote:\n> ${question}`, held)
    ).toMatchObject({ typed: 'Yes, go ahead with that.', quotedUnseen: '', quotes: [] })
  })

  it('a re-quoted line with extra markers and spacing still matches', () => {
    expect(
      splitNewText('> >   The lesson planner should show   the whole week at once.', seen)
    ).toMatchObject({
      typed: '',
      quotedUnseen: '',
      quotes: [],
    })
  })

  it('a short typed line after a seen quoted line is kept', () => {
    expect(
      splitNewText('> The lesson planner should show the whole week at once.\nYes agreed', seen)
    ).toMatchObject({ typed: 'Yes agreed', quotedUnseen: '', quotes: [] })
  })

  it('recognises an "On ... wrote:" header wrapped over two lines', () => {
    expect(
      splitNewText(
        'Agreed.\n\nOn Wed, Nov 18, 2026 at 3:04 PM Bill Duris <\nb@aol.com> wrote:\n> Students also need a printable version of the plan.',
        seen
      )
    ).toMatchObject({
      typed: 'Agreed.',
      quotedUnseen:
        'On Wed, Nov 18, 2026 at 3:04 PM Bill Duris <\nb@aol.com> wrote:\nStudents also need a printable version of the plan.',
    })
  })

  describe('an Apple Mail reply whose attribution carries a quote marker', () => {
    const quotedLine = 'I will build the week view of the lesson planner first.'

    it('leaks no attribution when the quote is held', () => {
      expect(splitNewText(receivedEmail.text, seenLines([quotedLine]))).toMatchObject({
        typed: 'Sounds good, the week view first please.',
        quotedUnseen: '',
        quotes: [],
      })
    })

    it('keeps the attribution and the quoted line when the quote is unseen', () => {
      expect(splitNewText(receivedEmail.text, new Set())).toMatchObject({
        typed: 'Sounds good, the week view first please.',
        quotedUnseen: `On Nov 20, 2026, at 9:31 AM, Nico Builder <nico@example.org> wrote:\n\n${quotedLine}`,
      })
    })

    const wrapped =
      'Sounds good.\n\n> On Nov 20, 2026, at 9:31 AM, Nico Builder\n> <nico@example.org> wrote:\n> \n> ' +
      quotedLine

    it('recognises it wrapped over two marked lines', () => {
      expect(splitNewText(wrapped, seenLines([quotedLine]))).toMatchObject({
        typed: 'Sounds good.',
        quotedUnseen: '',
        quotes: [],
      })
      expect(splitNewText(wrapped, new Set())).toMatchObject({
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
      ).toMatchObject({
        typed: '<nico@example.org> wrote:',
        quotedUnseen: 'On Nov 20, 2026, at 9:31 AM, Nico Builder',
      })
      expect(
        splitNewText(
          '> On Nov 20, 2026, at 9:31 AM, Nico Builder\n> \n> <nico@example.org> wrote:\n> ' +
            quotedLine,
          seenLines([quotedLine])
        )
      ).toMatchObject({
        typed: '',
        quotedUnseen: 'On Nov 20, 2026, at 9:31 AM, Nico Builder\n\n<nico@example.org> wrote:',
      })
    })
  })

  it('a short quoted line whose only long neighbour comes after it takes that line’s fate', () => {
    const held = seenLines(['Please add a metronome to the practice page.'])
    expect(splitNewText('> Hi Nico,\n> Please add a metronome to the practice page.', held)).toMatchObject({
      typed: '',
      quotedUnseen: '',
      quotes: [],
    })
    expect(
      splitNewText('> Hi Nico,\n> Please add a metronome to the practice page.', new Set())
    ).toMatchObject({
      typed: '',
      quotedUnseen: 'Hi Nico,\nPlease add a metronome to the practice page.',
    })
  })

  it('a short typed line is kept whatever its long typed neighbour', () => {
    const held = seenLines(['Please add a metronome to the practice page.'])
    expect(splitNewText('Hi Nico,\nPlease add a metronome to the practice page.', held)).toMatchObject({
      typed: 'Hi Nico,\nPlease add a metronome to the practice page.',
      quotedUnseen: '',
      quotes: [],
    })
  })
})

describe('allLines', () => {
  it('holds every non-blank normalized line, of any length', () => {
    expect(allLines(['Yes\n\n> Thanks, \nA longer line here'])).toEqual(
      new Set(['yes', 'thanks,', 'a longer line here'])
    )
  })
})

describe('splitNewText quotes', () => {
  const earlier =
    'Hi Test,\nWhat colour should the start button be?\nShould payment be by card or by invoice?\nThanks,\nNico'
  const seenEarlier = seenLines([earlier])
  const anyEarlier = allLines([earlier])

  const nicoHeader = 'On Nov 22, 2026, at 10:40 AM, Nico L <nico@example.com> wrote:'
  const testMHeader = 'On Nov 22, 2026, at 11:00 AM, Test M <tm@yahoo.com> wrote:'
  const colour = 'What colour should the start button be?'
  const payment = 'Should payment be by card or by invoice?'
  const card = 'By card, please, no invoices.'
  const newLines = [
    'The start page needs a big green button.',
    'Payments go through the card reader.',
    'Invoices are not needed at all.',
  ]

  const context = (text: string) => ({ text, context: true, own: false })
  const own = (text: string) => ({ text, context: false, own: true })
  const kept = (text: string) => ({ text, context: false, own: false })

  // Gmail puts the quote one level deeper than its header, so the answers typed
  // at the header's level are the quoter's own.
  const gmailInline = [
    nicoHeader,
    '> Hi Test,',
    `> ${colour}`,
    'Green.',
    `> ${payment}`,
    card,
    '> Thanks,',
    '> Nico',
  ].join('\n')

  it('a Gmail inline reply keeps the answers as own lines and brings the held message back as context', () => {
    expect(splitNewText(gmailInline, seenEarlier, anyEarlier)).toEqual({
      typed: '',
      quotedUnseen: `${nicoHeader}\nGreen.\n${card}`,
      quotes: [
        {
          header: nicoHeader,
          quoterHeader: null,
          lines: [
            context('Hi Test,'),
            context(colour),
            own('Green.'),
            context(payment),
            own(card),
            context('Thanks,'),
            context('Nico'),
          ],
        },
      ],
    })
  })

  it('a short own answer is kept without seenAny too', () => {
    const result = splitNewText(gmailInline, seenEarlier)
    expect(result.quotedUnseen).toBe(`${nicoHeader}\nGreen.\n${card}`)
    expect(result.quotes[0].lines[2]).toEqual(own('Green.'))
  })

  const unmarkedInline = gmailInline.replace(/^> /gm, '')

  it('an unmarked inline reply has no own lines; a short answer the app never saw is kept', () => {
    expect(splitNewText(unmarkedInline, seenEarlier, anyEarlier)).toEqual({
      typed: '',
      quotedUnseen: `${nicoHeader}\nGreen.\n${card}\nThanks,\nNico`,
      quotes: [
        {
          header: nicoHeader,
          quoterHeader: null,
          lines: [
            context('Hi Test,'),
            context(colour),
            kept('Green.'),
            context(payment),
            kept(card),
            kept('Thanks,'),
            kept('Nico'),
          ],
        },
      ],
    })
  })

  it('an unmarked short answer the app has seen elsewhere comes back only as context', () => {
    const text = unmarkedInline.replace('Green.', 'Thanks,')
    expect(splitNewText(text, seenEarlier, anyEarlier)).toEqual({
      typed: '',
      quotedUnseen: `${nicoHeader}\n${card}\nThanks,\nNico`,
      quotes: [
        {
          header: nicoHeader,
          quoterHeader: null,
          lines: [
            context('Hi Test,'),
            context(colour),
            context('Thanks,'),
            context(payment),
            kept(card),
            kept('Thanks,'),
            kept('Nico'),
          ],
        },
      ],
    })
  })

  it('a fully held quote stays out', () => {
    const quotedEarlier = earlier
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    expect(
      splitNewText(`Sounds good, see you Monday.\n\n${nicoHeader}\n${quotedEarlier}`, seenEarlier, anyEarlier)
    ).toEqual({ typed: 'Sounds good, see you Monday.', quotedUnseen: '', quotes: [] })
  })

  it('a fully new quote has no context lines', () => {
    const text = [testMHeader, ...newLines.map((line) => `> ${line}`)].join('\n')
    expect(splitNewText(text, seenEarlier, anyEarlier).quotes).toEqual([
      { header: testMHeader, quoterHeader: null, lines: newLines.map(kept) },
    ])
  })

  it('two levels: the inner quote names the outer header as its quoter', () => {
    const text = [
      'Looping in the project.',
      '',
      testMHeader,
      `> ${nicoHeader}`,
      `>> ${colour}`,
      '> Green.',
      `>> ${payment}`,
      `> ${card}`,
    ].join('\n')
    expect(splitNewText(text, seenEarlier, anyEarlier)).toEqual({
      typed: 'Looping in the project.',
      quotedUnseen: `${nicoHeader}\nGreen.\n${card}`,
      quotes: [
        {
          header: nicoHeader,
          quoterHeader: testMHeader,
          lines: [context(colour), own('Green.'), context(payment), own(card)],
        },
      ],
    })
  })

  it('two levels: a held older level stays out under a new newer level', () => {
    const text = [
      testMHeader,
      ...newLines.map((line) => `> ${line}`),
      `> ${nicoHeader}`,
      ...earlier.split('\n').map((line) => `>> ${line}`),
    ].join('\n')
    const result = splitNewText(text, seenEarlier, anyEarlier)
    expect(result.quotes).toEqual([{ header: testMHeader, quoterHeader: null, lines: newLines.map(kept) }])
    expect(result.quotedUnseen).toBe([testMHeader, ...newLines].join('\n'))
  })

  it('a held `>` line with no header gives no quote', () => {
    expect(
      splitNewText(`> ${colour}\nGreen, I think it should be green.`, seenEarlier, anyEarlier)
    ).toEqual({ typed: 'Green, I think it should be green.', quotedUnseen: '', quotes: [] })
  })

  it('an Outlook chain: the header is the field lines, with no own lines', () => {
    const fields = [
      'From: Test M <tm@yahoo.com>',
      'Sent: Sunday, November 22, 2026 11:00 AM',
      'To: Nico L',
      'Subject: Start page',
    ]
    const text = ['Yes, all three.', '', ...fields, '', ...newLines].join('\n')
    expect(splitNewText(text, seenEarlier, anyEarlier)).toEqual({
      typed: 'Yes, all three.',
      quotedUnseen: [...fields, '', ...newLines].join('\n'),
      quotes: [{ header: fields.join('\n'), quoterHeader: null, lines: newLines.map(kept) }],
    })
  })

  it('collapses runs of blank lines to one and trims them from both ends', () => {
    const text = [testMHeader, '>', `> ${newLines[0]}`, '>', '>', '>', `> ${newLines[1]}`, '>'].join('\n')
    expect(splitNewText(text, seenEarlier, anyEarlier).quotes).toEqual([
      {
        header: testMHeader,
        quoterHeader: null,
        lines: [kept(newLines[0]), { text: '', context: false, own: false }, kept(newLines[1])],
      },
    ])
  })

  // A line belongs to the deepest open quote no deeper than itself, so a line
  // typed under a nested quote goes back to the outer message.
  it('a bottom-posted reply under a nested thread goes back to the outer message', () => {
    const text = [
      testMHeader,
      '> Green is fine by me, see below.',
      `> ${nicoHeader}`,
      `>> ${colour}`,
      '> Green.',
      'I agree with Test M on all of it.',
    ].join('\n')
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      {
        header: testMHeader,
        quoterHeader: null,
        lines: [kept('Green is fine by me, see below.'), own('I agree with Test M on all of it.')],
      },
      { header: nicoHeader, quoterHeader: testMHeader, lines: [kept(colour), own('Green.')] },
    ])
  })

  it('triple nesting: each answer lands in the message it answers', () => {
    const aHeader = 'On Nov 20, 2026, at 9:00 AM, Ann A <ann@example.com> wrote:'
    const bHeader = 'On Nov 21, 2026, at 9:00 AM, Ben B <ben@example.com> wrote:'
    const cHeader = 'On Nov 22, 2026, at 9:00 AM, Cat C <cat@example.com> wrote:'
    const text = [
      aHeader,
      `> ${bHeader}`,
      `>> ${cHeader}`,
      '>>> C wrote this long line here.',
      '>> B answered at level two.',
      '> A answered at level one.',
      '>>> C wrote one more long line.',
    ].join('\n')
    // A's block has no line of its own, so it is not listed. B's block has no
    // line deeper than B, but C's header is nested in it, so "A answered" is own.
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      { header: bHeader, quoterHeader: aHeader, lines: [own('A answered at level one.')] },
      {
        header: cHeader,
        quoterHeader: bHeader,
        lines: [
          kept('C wrote this long line here.'),
          own('B answered at level two.'),
          kept('C wrote one more long line.'),
        ],
      },
    ])
  })

  it('a forward whose body holds a quote has no own lines', () => {
    const fields = [
      'From: Bill Duris <bill@example.com>',
      'Date: Sun, Nov 22, 2026 at 9:00 AM',
      'Subject: Re: start button',
      'To: Test M <tm@yahoo.com>',
    ]
    const divider = '---------- Forwarded message ---------'
    const text = [divider, ...fields, '', 'Sure, that sounds right to me.', `> ${colour}`, 'Green would be best.'].join(
      '\n'
    )
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      {
        header: [divider, ...fields].join('\n'),
        quoterHeader: null,
        lines: [kept('Sure, that sounds right to me.'), kept(colour), kept('Green would be best.')],
      },
    ])
  })

  it('a quote header at the top of the text has no quoter', () => {
    const text = `> ${nicoHeader}\n>> ${colour}`
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      { header: nicoHeader, quoterHeader: null, lines: [kept(colour)] },
    ])
  })

  it('a quote header under header-less quoted text has no quoter either', () => {
    const text = `> Some earlier words with no header.\n> ${nicoHeader}\n>> ${colour}`
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      { header: '', quoterHeader: null, lines: [kept('Some earlier words with no header.')] },
      { header: nicoHeader, quoterHeader: null, lines: [kept(colour)] },
    ])
  })

  // Apple Mail puts the "On ... wrote:" line inside the blockquote, at the
  // same depth as the body, so an answer one level up is the quoter's.
  it('an Apple Mail inline reply: the answers are own', () => {
    const text = [`> ${nicoHeader}`, '> ', `> ${colour}`, 'Green.', `> ${payment}`, card].join('\n')
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      {
        header: nicoHeader,
        quoterHeader: null,
        lines: [kept(colour), own('Green.'), kept(payment), own(card)],
      },
    ])
  })

  const appleThread = [
    'Looping in the project.',
    '',
    `> ${testMHeader}`,
    '> ',
    '> Green is fine by me, I think it works well.',
    '> ',
    `>> ${nicoHeader}`,
    '>> ',
    `>> ${colour}`,
  ]

  it('an Apple Mail nested thread: the outer body is not own', () => {
    expect(splitNewText(appleThread.join('\n'), new Set(), new Set())).toEqual({
      typed: 'Looping in the project.',
      quotedUnseen: [testMHeader, '', 'Green is fine by me, I think it works well.', '', nicoHeader, '', colour].join(
        '\n'
      ),
      quotes: [
        {
          header: testMHeader,
          quoterHeader: null,
          lines: [kept('Green is fine by me, I think it works well.')],
        },
        { header: nicoHeader, quoterHeader: testMHeader, lines: [kept(colour)] },
      ],
    })
  })

  it('an Apple Mail nested thread with an inline answer: the answer is own in the inner quote', () => {
    const text = [...appleThread, '> Green, as I said.', `>> ${payment}`].join('\n')
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      {
        header: testMHeader,
        quoterHeader: null,
        lines: [kept('Green is fine by me, I think it works well.')],
      },
      {
        header: nicoHeader,
        quoterHeader: testMHeader,
        lines: [kept(colour), own('Green, as I said.'), kept(payment)],
      },
    ])
  })

  it('a Gmail forward of an inline reply: the answers are own in the forwarded quote', () => {
    const forwardHeader = [
      '---------- Forwarded message ---------',
      'From: Bill Duris <bill@example.com>',
      'Date: Sun, Nov 22, 2026 at 9:00 AM',
      'Subject: Re: start button',
      'To: Test M <tm@yahoo.com>',
    ]
    const innerHeader = 'On Sat, Nov 21, 2026 at 4:00 PM Nico L <nico@example.com> wrote:'
    const text = [
      ...forwardHeader,
      '',
      'See my answers below.',
      '',
      innerHeader,
      `> ${colour}`,
      'Green would be best.',
      `> ${payment}`,
      card,
    ].join('\n')
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      { header: forwardHeader.join('\n'), quoterHeader: null, lines: [kept('See my answers below.')] },
      {
        header: innerHeader,
        quoterHeader: forwardHeader.join('\n'),
        lines: [kept(colour), own('Green would be best.'), kept(payment), own(card)],
      },
    ])
  })

  it('an Outlook-style quote inside a Gmail quote, answered inline', () => {
    const fields = [
      'From: Bill Duris <bill@example.com>',
      'Sent: Sunday, November 22, 2026 9:00 AM',
      'Subject: start button',
    ]
    const text = [
      testMHeader,
      ...fields.map((field) => `> ${field}`),
      '>',
      '> Which colour do you want for the start button?',
      'Green, please.',
    ].join('\n')
    // An attribution takes in the field lines under it, marked or not. The From: field wins when the
    // author is parsed, so the question goes to Bill, and the depth-0 answer to the email's sender.
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      {
        header: [testMHeader, ...fields].join('\n'),
        quoterHeader: null,
        lines: [kept('Which colour do you want for the start button?'), own('Green, please.')],
      },
    ])
  })

  it('two Gmail quotes side by side: an answer under the first is own there', () => {
    const aHeader = 'On Nov 20, 2026, at 9:00 AM, Ann A <ann@example.com> wrote:'
    const bHeader = 'On Nov 21, 2026, at 9:00 AM, Ben B <ben@example.com> wrote:'
    const text = [
      aHeader,
      '> A said this long line here.',
      'My answer to A goes here.',
      bHeader,
      '> B said this long line here.',
    ].join('\n')
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      {
        header: aHeader,
        quoterHeader: null,
        lines: [kept('A said this long line here.'), own('My answer to A goes here.')],
      },
      { header: bHeader, quoterHeader: null, lines: [kept('B said this long line here.')] },
    ])
  })
})

describe('isRepeatOf', () => {
  const question = 'Should the week view start on Monday or on Sunday?'
  const reply = `Yes, go ahead with that.\n\nOn Wed, Nov 18, 2026, Nico wrote:\n> ${question}`

  it('the same email sent twice is a repeat', () => {
    expect(isRepeatOf(original, original)).toBe(true)
    expect(isRepeatOf(reply, reply)).toBe(true)
  })

  it('ignores spacing and case', () => {
    expect(isRepeatOf('hi nico,\nThe Lesson planner should show the   whole week at once.\n  Bill', original)).toBe(true)
  })

  it('a resend that only adds blank lines or changes whitespace is still a repeat', () => {
    expect(isRepeatOf(`\n${original.replace(/\n/g, '\n\n  ')}\n\n`, original)).toBe(true)
    expect(isRepeatOf(reply.replace('Yes, go', 'Yes,   go'), reply)).toBe(true)
  })

  // A short line is never evidence that something was seen, but a new short
  // line is new words: it can only stop a repeat, never make one (N1).
  it('a short new typed line above the same quote is not a repeat', () => {
    const quote = `On Wed, Nov 18, 2026, Nico wrote:\n> ${question}`
    expect(isRepeatOf(`Actually no\n\n${quote}`, `Yes\n\n${quote}`)).toBe(false)
  })

  it('Yes and No above the same long signature line are not a repeat', () => {
    const signature = 'Bill Duris, piano teacher at L6 Music'
    expect(isRepeatOf(`No\n\n${signature}`, `Yes\n\n${signature}`)).toBe(false)
  })

  it('a short line changed under the quote is not a repeat either', () => {
    expect(isRepeatOf(`${reply}\n> ok`, `${reply}\n> no`)).toBe(false)
  })

  it('an exact resend, short lines included, is still a repeat', () => {
    expect(isRepeatOf(`Yes\n\nOn Wed, Nov 18, 2026, Nico wrote:\n> ${question}\n> Nico`, `Yes\n\nOn Wed, Nov 18, 2026, Nico wrote:\n> ${question}\n> Nico`)).toBe(true)
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
