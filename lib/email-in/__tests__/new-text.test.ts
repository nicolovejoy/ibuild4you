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
  it('holds every non-blank normalized line, of any length, and every pair of consecutive ones', () => {
    expect(allLines(['Yes\n\n> Thanks, \nA longer line here'])).toEqual(
      new Set(['yes', 'thanks,', 'a longer line here', 'yes\nthanks,', 'thanks,\na longer line here'])
    )
  })

  it('makes no pair across two texts', () => {
    expect(allLines(['Yes', 'Thanks,'])).toEqual(new Set(['yes', 'thanks,']))
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
          possibleQuoters: [],
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
          possibleQuoters: [],
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
          possibleQuoters: [],
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
      { header: testMHeader, quoterHeader: null, possibleQuoters: [], lines: newLines.map(kept) },
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
          possibleQuoters: [testMHeader],
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
    expect(result.quotes).toEqual([{ header: testMHeader, quoterHeader: null, possibleQuoters: [], lines: newLines.map(kept) }])
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
      quotes: [{ header: fields.join('\n'), quoterHeader: null, possibleQuoters: [], lines: newLines.map(kept) }],
    })
  })

  it('collapses runs of blank lines to one and trims them from both ends', () => {
    const text = [testMHeader, '>', `> ${newLines[0]}`, '>', '>', '>', `> ${newLines[1]}`, '>'].join('\n')
    expect(splitNewText(text, seenEarlier, anyEarlier).quotes).toEqual([
      {
        header: testMHeader,
        quoterHeader: null,
        possibleQuoters: [],
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
        possibleQuoters: [],
        lines: [kept('Green is fine by me, see below.'), own('I agree with Test M on all of it.')],
      },
      { header: nicoHeader, quoterHeader: testMHeader, possibleQuoters: [testMHeader], lines: [kept(colour), own('Green.')] },
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
      { header: bHeader, quoterHeader: aHeader, possibleQuoters: [aHeader], lines: [own('A answered at level one.')] },
      {
        header: cHeader,
        quoterHeader: bHeader,
        possibleQuoters: [bHeader, aHeader],
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
        possibleQuoters: [],
        lines: [kept('Sure, that sounds right to me.'), kept(colour), kept('Green would be best.')],
      },
    ])
  })

  // Gmail's shape (the body deeper than its header) one level down: it sits in a
  // quoted message whose header is missing, so its quoter is unknown.
  it('a marked header at the top of the text, its body deeper, has an unknown quoter', () => {
    const text = `> ${nicoHeader}\n>> ${colour}`
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      { header: nicoHeader, quoterHeader: '', possibleQuoters: [''], lines: [kept(colour)] },
    ])
  })

  it('a marked header at the top of the text, its body at its depth (Apple Mail), is the sender’s quote', () => {
    const text = `> ${nicoHeader}\n> ${colour}\nGreen.`
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      { header: nicoHeader, quoterHeader: null, possibleQuoters: [], lines: [kept(colour), own('Green.')] },
    ])
  })

  describe('a marked header that is the first quoted line', () => {
    const german = 'Am 22.11.2026 um 11:00 schrieb Dana <dana@books.example>:'
    const attribution = [`> ${testMHeader}`, `> ${newLines[0]}`]
    const fieldBlock = ['> From: Test M <tm@yahoo.com>', '> Date: Sun, Nov 22, 2026', `> ${newLines[0]}`]
    const quotersOf = (lines: string[]) =>
      splitNewText(lines.join('\n'), new Set()).quotes.map((quote) => [quote.quoterHeader, quote.possibleQuoters])

    it('has an unknown quoter under a typed line that may be an attribution the app cannot read', () => {
      for (const block of [attribution, fieldBlock]) {
        expect(quotersOf(['FYI', german, ...block])).toEqual([['', ['']]])
        expect(quotersOf(['FYI', `${german}  `, '', '> ', ...block])).toEqual([['', ['']]])
        expect(quotersOf(['2026年11月22日 Dana：', ...block])).toEqual([['', ['']]])
      }
    })

    it('has one too below deeper text or a deeper quote, under such a typed line', () => {
      for (const block of [attribution, fieldBlock]) {
        expect(quotersOf(['FYI', german, '> > as discussed before', ...block])[1]).toEqual(['', ['']])
        expect(quotersOf(['FYI', german, '> > On 1 e@x.co wrote:', '> > old words here', ...block])[1]).toEqual([
          '',
          [''],
        ])
        // The typed line counts only before any quoted text, and the unknown
        // message lasts until a header at depth 0.
        expect(quotersOf(['FYI', '> > as discussed before', german, ...block])[1]).toEqual([null, []])
        expect(quotersOf(['FYI', german, ...block, nicoHeader, '> Another long line, of Nico.'])[1]).toEqual([null, []])
      }
    })

    it('has one too after a first header two or more levels deep', () => {
      for (const block of [attribution, fieldBlock]) {
        expect(quotersOf(['FYI', '> > On 1 e@x.co wrote:', '> > old words here', ...block])[1]).toEqual(['', ['']])
      }
    })

    it('is the sender’s quote under any other typed line', () => {
      for (const block of [attribution, fieldBlock]) {
        // A sentence that ends in a colon has no date or address in it.
        expect(quotersOf(['My answers are below:', ...block])).toEqual([[null, []]])
        expect(quotersOf(['Sounds good, see below.', '', ...block])).toEqual([[null, []]])
        expect(quotersOf([german, 'Sounds good, see below.', '', ...block])).toEqual([[null, []]])
        expect(quotersOf(block)).toEqual([[null, []]])
      }
    })

    it('has an unknown quoter two or more levels deep, whatever its shape', () => {
      for (const block of [attribution, fieldBlock]) {
        expect(quotersOf(['FYI', ...block.map((line) => `> ${line}`)])).toEqual([['', ['']]])
        expect(quotersOf(['FYI', ...block.map((line) => `>> ${line}`)])).toEqual([['', ['']]])
      }
    })
  })

  it('an unknown quoter lasts until a header shallower than its quote', () => {
    const text = [
      `> ${nicoHeader}`,
      `>> ${colour}`,
      `> ${testMHeader}`,
      `>> ${newLines[0]}`,
      nicoHeader,
      `> ${newLines[1]}`,
    ].join('\n')
    expect(
      splitNewText(text, new Set(), new Set()).quotes.map((quote) => [quote.quoterHeader, quote.possibleQuoters])
    ).toEqual([
      ['', ['']],
      ['', [nicoHeader, '']],
      [null, []],
    ])
  })

  // The header-less text holds a line at the header's depth, so the header sits
  // in a message whose header the app did not recognise: its quoter is unknown.
  it('a quote header under header-less quoted text has an unknown quoter', () => {
    const text = `> Some earlier words with no header.\n> ${nicoHeader}\n>> ${colour}`
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      { header: '', quoterHeader: null, possibleQuoters: [], lines: [kept('Some earlier words with no header.')] },
      { header: nicoHeader, quoterHeader: '', possibleQuoters: [''], lines: [kept(colour)] },
    ])
  })

  it('header-less text deeper than a Gmail-shaped marked header: its quoter is unknown all the same', () => {
    const text = `>> Some earlier words, quoted twice over.\n> ${nicoHeader}\n>> ${colour}`
    expect(splitNewText(text, new Set(), new Set()).quotes[1]).toEqual({
      header: nicoHeader,
      quoterHeader: '',
      possibleQuoters: [''],
      lines: [kept(colour)],
    })
  })

  it('header-less text only deeper than an Apple Mail header leaves the sender as the quoter', () => {
    const text = `>> Some earlier words, quoted twice over.\n> ${nicoHeader}\n> ${colour}`
    expect(splitNewText(text, new Set(), new Set()).quotes[1]).toEqual({
      header: nicoHeader,
      quoterHeader: null,
      possibleQuoters: [],
      lines: [kept(colour)],
    })
  })

  it('possibleQuoters names every enclosing quote, nearest first, ending with an unknown quoter', () => {
    const text = [
      '> Some earlier words with no header.',
      `> ${testMHeader}`,
      `>> ${nicoHeader}`,
      `>>> ${colour}`,
    ].join('\n')
    expect(splitNewText(text, new Set(), new Set()).quotes[1]).toEqual({
      header: nicoHeader,
      quoterHeader: testMHeader,
      possibleQuoters: [testMHeader, ''],
      lines: [kept(colour)],
    })
  })

  // A header the app cannot read (here German) above a quote: the answers under
  // that quote were written by someone the app could not identify, never by the
  // email's sender.
  it('an inline answer under an unrecognised outer header is not the sender’s', () => {
    const text = [
      'Danke.',
      'Am 22.11.2026 um 11:00 schrieb Nico L <nico@me.com>:',
      '> Answers below.',
      `> ${testMHeader}`,
      '>> Should the app send reminders every day?',
      '> No, weekly reminders are enough for this kind of app.',
    ].join('\n')
    expect(splitNewText(text, new Set(), new Set()).quotes[1]).toEqual({
      header: testMHeader,
      quoterHeader: '',
      possibleQuoters: [''],
      lines: [
        kept('Should the app send reminders every day?'),
        own('No, weekly reminders are enough for this kind of app.'),
      ],
    })
  })

  describe('a French attribution', () => {
    const frenchHeader = 'Le dim. 22 nov. 2026 à 11:00, Nico L <nico@me.com> a écrit :'
    const inner = 'On Nov 21, 2026, at 9:00 AM, Test M <tm@yahoo.com> wrote:'
    const probe = [
      "D'accord, merci.",
      frenchHeader,
      '> Answers below.',
      `> ${inner}`,
      '>> Should the app send reminders every day?',
      '> No, weekly reminders are enough for this kind of app.',
    ].join('\n')

    it('is a quote header, and the answer under the quote inside it is its author’s', () => {
      expect(splitNewText(probe, new Set(), new Set())).toEqual({
        typed: "D'accord, merci.",
        quotedUnseen: [
          frenchHeader,
          'Answers below.',
          inner,
          'Should the app send reminders every day?',
          'No, weekly reminders are enough for this kind of app.',
        ].join('\n'),
        quotes: [
          { header: frenchHeader, quoterHeader: null, possibleQuoters: [], lines: [kept('Answers below.')] },
          {
            header: inner,
            quoterHeader: frenchHeader,
            possibleQuoters: [frenchHeader],
            lines: [
              kept('Should the app send reminders every day?'),
              own('No, weekly reminders are enough for this kind of app.'),
            ],
          },
        ],
      })
    })

    it('is recognised without the space before the colon, with a no-break space, and marked', () => {
      for (const header of [
        frenchHeader.replace(' :', ':'),
        frenchHeader.replace(' :', ' :'),
        frenchHeader.replace(' :', ' :'),
      ]) {
        expect(splitNewText(`Merci.\n${header}\n> Une ligne jamais vue avant.`, new Set()).quotes).toEqual([
          { header, quoterHeader: null, possibleQuoters: [], lines: [kept('Une ligne jamais vue avant.')] },
        ])
      }
      expect(splitNewText(`Merci.\n> ${frenchHeader}\n> Une ligne jamais vue avant.`, new Set()).quotes).toEqual([
        { header: frenchHeader, quoterHeader: null, possibleQuoters: [], lines: [kept('Une ligne jamais vue avant.')] },
      ])
    })

    it('is recognised wrapped over two lines', () => {
      const wrapped = 'Le dim. 22 nov. 2026 à 11:00, Nico L <\nnico@me.com> a écrit :'
      expect(splitNewText(`Merci.\n\n${wrapped}\n> Une ligne jamais vue avant.`, new Set()).quotes).toEqual([
        { header: wrapped, quoterHeader: null, possibleQuoters: [], lines: [kept('Une ligne jamais vue avant.')] },
      ])
    })

    it('needs a digit or an address, so a typed sentence stays typed', () => {
      expect(
        splitNewText('Le client a écrit :\n> Une ligne jamais vue avant.', new Set())
      ).toMatchObject({ typed: 'Le client a écrit :' })
    })

    it('is checked quickly on a long run of spaces', () => {
      const hostile = `Le 1${' '.repeat(50000)}x\n${'Le 1 '.repeat(10000)}\n> a`
      const started = Date.now()
      splitNewText(hostile, new Set(), new Set())
      expect(Date.now() - started).toBeLessThan(200)
    })
  })

  // Apple Mail puts the "On ... wrote:" line inside the blockquote, at the
  // same depth as the body, so an answer one level up is the quoter's.
  it('an Apple Mail inline reply: the answers are own', () => {
    const text = [`> ${nicoHeader}`, '> ', `> ${colour}`, 'Green.', `> ${payment}`, card].join('\n')
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      {
        header: nicoHeader,
        quoterHeader: null,
        possibleQuoters: [],
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
          possibleQuoters: [],
          lines: [kept('Green is fine by me, I think it works well.')],
        },
        { header: nicoHeader, quoterHeader: testMHeader, possibleQuoters: [testMHeader], lines: [kept(colour)] },
      ],
    })
  })

  it('an Apple Mail nested thread with an inline answer: the answer is own in the inner quote', () => {
    const text = [...appleThread, '> Green, as I said.', `>> ${payment}`].join('\n')
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      {
        header: testMHeader,
        quoterHeader: null,
        possibleQuoters: [],
        lines: [kept('Green is fine by me, I think it works well.')],
      },
      {
        header: nicoHeader,
        quoterHeader: testMHeader,
        possibleQuoters: [testMHeader],
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
      { header: forwardHeader.join('\n'), quoterHeader: null, possibleQuoters: [], lines: [kept('See my answers below.')] },
      {
        header: innerHeader,
        quoterHeader: forwardHeader.join('\n'),
        possibleQuoters: [forwardHeader.join('\n')],
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
        possibleQuoters: [],
        lines: [kept('Which colour do you want for the start button?'), own('Green, please.')],
      },
    ])
  })

  // e1 Nico asks, e2 the maker answers inline (Gmail), e3 Nico replies quoting
  // e2 in full, e4 the maker replies quoting e3. The answers are held from e2,
  // so they never come back as new words in e3 or e4.
  describe('inline answers the app already holds', () => {
    const quoteAll = (text: string) =>
      text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    const e1 = earlier
    const e2 = gmailInline
    const e3 = `Great, thanks. Building it this week.\n\n${testMHeader}\n${quoteAll(e2)}`
    const nicoReplyHeader = 'On Sun, Nov 22, 2026 at 11:30 AM Nico L <nico@example.com> wrote:'
    const e4 = `Thank you!\n\n${nicoReplyHeader}\n${quoteAll(e3)}`

    it('a reply quoting them in full has no quote left', () => {
      expect(splitNewText(e3, seenLines([e1, e2]), allLines([e1, e2]))).toEqual({
        typed: 'Great, thanks. Building it this week.',
        quotedUnseen: '',
        quotes: [],
      })
    })

    it('a reply to that reply has no quote left either', () => {
      expect(splitNewText(e4, seenLines([e1, e2, e3]), allLines([e1, e2, e3]))).toEqual({
        typed: 'Thank you!',
        quotedUnseen: '',
        quotes: [],
      })
    })

    it('a held answer beside a new one comes back as context, not as written inside', () => {
      const withNew = e3.replace(`> ${card}`, `> ${card}\n> Also a dark mode for the evening, please.`)
      const result = splitNewText(withNew, seenLines([e1, e2]), allLines([e1, e2]))
      expect(result.quotes).toEqual([
        {
          header: nicoHeader,
          quoterHeader: testMHeader,
          possibleQuoters: [testMHeader],
          lines: [
            context('Hi Test,'),
            context(colour),
            context('Green.'),
            context(payment),
            context(card),
            own('Also a dark mode for the evening, please.'),
            context('Thanks,'),
            context('Nico'),
          ],
        },
      ])
      expect(result.quotedUnseen).toBe(`${nicoHeader}\nAlso a dark mode for the evening, please.`)
    })

    it("the sender's own inline answers are kept even when the same words are held", () => {
      // e2 sent again with nothing changed is a repeat (isRepeatOf), but its
      // inline answers, split alone, are the sender's words and stay.
      const result = splitNewText(e2, seenLines([e1, e2]), allLines([e1, e2]))
      expect(result.quotes[0].lines.filter((line) => line.own).map((line) => line.text)).toEqual([
        'Green.',
        card,
      ])
    })
  })

  // The maker answered the builder alone, and the app first sees the answer
  // quoted in the builder's reply. Its words may be held from anywhere else;
  // only the same line after the same line shows that the answer is held.
  describe('an inline answer whose words the app has seen somewhere else', () => {
    const reply = (...answer: string[]) =>
      ['Noted.', '', testMHeader, `> ${nicoHeader}`, `> > ${colour}`, ...answer.map((line) => `> ${line}`)].join('\n')
    const linesOf = (text: string, held: string[]) =>
      splitNewText(text, seenLines(held), allLines(held)).quotes.map((quote) => quote.lines)

    it('is kept, short or long', () => {
      for (const answer of ['Yes.', 'Sounds good to me, thanks.']) {
        const held = [`Can we start Monday?\n${answer}`, earlier]
        expect(linesOf(reply(answer), held)).toEqual([[context(colour), own(answer)]])
      }
    })

    it('is kept without seenAny', () => {
      const held = seenLines([reply(card)])
      expect(splitNewText(reply(card), held).quotes[0].lines).toEqual([context(colour), own(card)])
    })

    it('is dropped when it is held after the same line, blank lines and markers aside', () => {
      for (const answer of ['Yes.', 'Sounds good to me, thanks.']) {
        const held = [earlier, `${nicoHeader}\n> ${colour}\n\n${answer}`]
        expect(linesOf(reply('', answer), held)).toEqual([])
      }
    })

    it('is kept after a kept answer, though the two together were seen somewhere else', () => {
      const second = 'Go ahead with that one.'
      expect(linesOf(reply('Yes.', second), [`Can we start Monday?\nYes.\n${second}`, earlier])).toEqual([
        [context(colour), own('Yes.'), own(second)],
      ])
    })

    it('is kept under a line that is itself kept', () => {
      // The question is new too, so a pair seen before was not this one.
      const question = 'Is the second colour fine too?'
      const text = reply('Yes.').replace(colour, question)
      const pairElsewhere = allLines([`${question}\nYes.`])
      expect(splitNewText(text, new Set(), pairElsewhere).quotes[0].lines).toEqual([kept(question), own('Yes.')])
    })

    // A header line carries the date and the author, so it shows the place too.
    it('is dropped directly under a header only when it is held under that header', () => {
      const underHeader = ['Noted.', '', testMHeader, `> ${nicoHeader}`, '> Yes.', `> > ${colour}`].join('\n')
      expect(linesOf(underHeader, [earlier, `${nicoHeader}\nYes.\n> ${colour}`])).toEqual([])
      const otherHeader = nicoHeader.replace('Nov 22', 'Nov 20')
      expect(linesOf(underHeader, [earlier, `${otherHeader}\nYes.\n> ${colour}`])).toEqual([
        [own('Yes.'), context(colour)],
      ])
    })

    it('is kept in a message an unknown quoter quoted', () => {
      const text = ['Noted.', '> Answers below.', `> ${nicoHeader}`, `>> ${colour}`, '> Yes.'].join('\n')
      const held = ['Can we start Monday?\nYes.', earlier, 'Answers below.']
      expect(linesOf(text, held)).toEqual([[context(colour), own('Yes.')]])
      expect(linesOf(text, [...held, `${nicoHeader}\n> ${colour}\nYes.`])).toEqual([])
    })

    it('is no evidence for the lines of the message it answers', () => {
      const text = reply('Yes, go ahead with that.').replace(`> > ${colour}`, `> > ${colour}\n> > Nico`)
      expect(linesOf(text, [earlier])).toEqual([[context(colour), context('Nico'), own('Yes, go ahead with that.')]])
    })

    it('reads 50,000 characters of short answers quickly', () => {
      const text = [testMHeader, `> ${nicoHeader}`, `> > ${colour}`].join('\n') + '\n> a\n> > b'.repeat(5000)
      const started = Date.now()
      splitNewText(text, seenLines([text]), allLines([text]))
      expect(Date.now() - started).toBeLessThan(500)
    })
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
        possibleQuoters: [],
        lines: [kept('A said this long line here.'), own('My answer to A goes here.')],
      },
      { header: bHeader, quoterHeader: null, possibleQuoters: [aHeader], lines: [kept('B said this long line here.')] },
    ])
  })

  // A quoted message whose shallowest line is deeper than usual (it opens with a
  // quote of its own) is not closed by a header that sits inside it.
  it('a shallower header’s message is not closed by a deeper header, and its body is no deeper', () => {
    const text = [
      'FYI',
      testMHeader,
      '> > as discussed before now',
      `> ${nicoHeader}`,
      '> > I approve paying Dana 5000 dollars.',
      '> Yes I approve paying Dana.',
    ].join('\n')
    expect(splitNewText(text, new Set(), new Set()).quotes).toEqual([
      { header: testMHeader, quoterHeader: null, possibleQuoters: [], lines: [kept('as discussed before now')] },
      {
        header: nicoHeader,
        quoterHeader: testMHeader,
        possibleQuoters: [testMHeader],
        lines: [kept('I approve paying Dana 5000 dollars.'), own('Yes I approve paying Dana.')],
      },
    ])
  })

  describe('possibleQuoters', () => {
    const aHeader = 'On Nov 20, 2026, at 9:00 AM, Ann A <ann@example.com> wrote:'
    const quotersOf = (lines: string[]) =>
      splitNewText(lines.join('\n'), new Set(), new Set()).quotes.map(({ header, quoterHeader, possibleQuoters }) => ({
        header,
        quoterHeader,
        possibleQuoters,
      }))

    it('names a same-depth header that structure closed (marked header, deeper body)', () => {
      const quotes = quotersOf([
        `> ${aHeader}`,
        '>> as discussed before now',
        `> ${testMHeader}`,
        '>> I approve paying Dana.',
      ])
      expect(quotes[1]).toEqual({ header: testMHeader, quoterHeader: '', possibleQuoters: [aHeader, ''] })
    })

    it('names every header no deeper than this one, nearest first, and drops a deeper one', () => {
      const quotes = quotersOf([
        nicoHeader,
        '> Nico said this long line here.',
        `> ${aHeader}`,
        '>> Ann said this long line here.',
        testMHeader,
        '> Test said this long line here.',
        `> ${nicoHeader}`,
        '>> Nico said another long line here.',
      ])
      expect(quotes).toEqual([
        { header: nicoHeader, quoterHeader: null, possibleQuoters: [] },
        { header: aHeader, quoterHeader: nicoHeader, possibleQuoters: [nicoHeader] },
        { header: testMHeader, quoterHeader: null, possibleQuoters: [nicoHeader] },
        { header: nicoHeader, quoterHeader: testMHeader, possibleQuoters: [testMHeader, nicoHeader] },
      ])
    })

    it('ends with an unknown quoter, until a header shallower than the header-less text', () => {
      const quotes = quotersOf([
        '> Some earlier words with no header.',
        `> ${testMHeader}`,
        '> Test said this long line here.',
        nicoHeader,
        '> Nico said this long line here.',
      ])
      expect(quotes.slice(1)).toEqual([
        { header: testMHeader, quoterHeader: '', possibleQuoters: [''] },
        { header: nicoHeader, quoterHeader: null, possibleQuoters: [] },
      ])
    })

    // Structure (quoterHeader) and trust (possibleQuoters) are found apart; a
    // quoter structure finds must never be missing from the trust list. Every
    // email of five lines from this alphabet (and a closing one) is checked.
    it('always holds the quoter that structure found', () => {
      const alphabet = [
        ...['', '> ', '>> '].map((marker) => (i: number) => `${marker}On ${i} a@b.co wrote:`),
        ...['> ', '>> ', '>>> '].map((marker) => (i: number) => `${marker}a long enough line ${i}`),
        (i: number) => `From: a${i}\nSent: x`,
        (i: number) => `> From: a${i}@b.co\n> Sent: x`,
      ]
      const length = 5
      let checked = 0
      for (let n = 0; n < alphabet.length ** length; n++) {
        const lines: string[] = []
        for (let i = 0, rest = n; i < length; i++, rest = Math.floor(rest / alphabet.length)) {
          lines.push(alphabet[rest % alphabet.length](i))
        }
        lines.push('>>>> the last line of the email')
        for (const quote of splitNewText(lines.join('\n'), new Set()).quotes) {
          // An own line's quoter is among the ones that could have written it.
          for (const line of quote.lines) {
            const quoter = line.quoter === undefined ? quote.quoterHeader : line.quoter
            if (!line.own || quoter === null) continue
            const from = quote.possibleQuoters.length - (line.possible ?? quote.possibleQuoters.length)
            if (!quote.possibleQuoters.slice(from).includes(quoter)) throw new Error(lines.join('\n'))
          }
          if (quote.quoterHeader === null) continue
          checked++
          if (!quote.possibleQuoters.includes(quote.quoterHeader)) throw new Error(lines.join('\n'))
        }
      }
      expect(checked).toBeGreaterThan(1000)
    })
  })

  // A mail program may wrap an attribution right after a "wrote:" in its
  // display name; what is left of it is no one's text.
  describe('a line under an attribution that ends like one', () => {
    it('belongs to the header, in either language, wrapped or marked', () => {
      const wrappedHeader = 'On Nov 22, 2026, at 10:40 AM, x\n<tm@yahoo.com> wrote:'
      for (const [header, rest] of [
        [testMHeader, '<evil@x.com> wrote:'],
        [wrappedHeader, '<evil@x.com> wrote:'],
        ['Le 22 nov. 2026 à 11:00, x <tm@yahoo.com> a écrit :', '<evil@x.com> a écrit :'],
      ]) {
        const plain = `FYI\n${header}\n${rest}\n> ${newLines[0]}`
        expect(splitNewText(plain, new Set()).quotes).toEqual([
          { header: `${header}\n${rest}`, quoterHeader: null, possibleQuoters: [], lines: [kept(newLines[0])] },
        ])
        const marked = `FYI\n> ${header.replace('\n', '\n> ')}\n> ${rest}\n> ${newLines[0]}`
        expect(splitNewText(marked, new Set()).quotes).toEqual([
          { header: `${header}\n${rest}`, quoterHeader: null, possibleQuoters: [], lines: [kept(newLines[0])] },
        ])
      }
    })

    it('does not belong to it at another depth, or when it starts an attribution', () => {
      expect(splitNewText(`${testMHeader}\n> Danny wrote:\n> ${newLines[0]}`, new Set()).quotes[0].header).toBe(
        testMHeader
      )
      expect(
        splitNewText(`${testMHeader}\n${nicoHeader}\n> ${newLines[0]}`, new Set()).quotes[0]
      ).toMatchObject({ header: nicoHeader, quoterHeader: testMHeader })
    })
  })

  describe('marked dividers and Outlook blocks', () => {
    const fields = ['From: Dana Reyes <dana@books.example>', 'Sent: Sunday, November 22, 2026', 'Subject: Payment']

    it('a marked Outlook block inside a quote is a header, quoted by its author', () => {
      const text = [testMHeader, `> ${newLines[0]}`, ...fields.map((f) => `> ${f}`), '> ', `> ${newLines[1]}`]
      expect(splitNewText(text.join('\n'), new Set()).quotes).toEqual([
        { header: testMHeader, quoterHeader: null, possibleQuoters: [], lines: [kept(newLines[0])] },
        {
          header: fields.join('\n'),
          quoterHeader: testMHeader,
          possibleQuoters: [testMHeader],
          lines: [kept(newLines[1])],
        },
      ])
    })

    it('a marked divider with its fields is a header', () => {
      const divider = '-----Original Message-----'
      const text = [testMHeader, `> ${newLines[0]}`, `> ${divider}`, '> ', ...fields.map((f) => `> ${f}`), `> ${newLines[1]}`]
      expect(splitNewText(text.join('\n'), new Set()).quotes[1]).toEqual({
        header: [divider, '', ...fields].join('\n'),
        quoterHeader: testMHeader,
        possibleQuoters: [testMHeader],
        lines: [kept(newLines[1])],
      })
    })

    it('a block whose lines are not all at one depth is not a header', () => {
      const text = [testMHeader, `> ${newLines[0]}`, `> ${fields[0]}`, `>> ${fields[1]}`, `> ${newLines[1]}`]
      expect(splitNewText(text.join('\n'), new Set()).quotes).toHaveLength(1)
    })

    it('an Apple Mail forward inside a quote: the fields one deeper belong to its header', () => {
      const text = [testMHeader, '> Begin forwarded message:', '> ', ...fields.map((f) => `>> ${f}`), `>> ${newLines[0]}`]
      expect(splitNewText(text.join('\n'), new Set()).quotes).toEqual([
        {
          header: ['Begin forwarded message:', '', ...fields].join('\n'),
          quoterHeader: testMHeader,
          possibleQuoters: [testMHeader],
          lines: [kept(newLines[0])],
        },
      ])
    })

    const linesOf = (text: string) => splitNewText(text, new Set()).quotes.map((quote) => quote.lines)

    // A member's own words that look like fields are never taken for a header.
    it('a From: list with no address in it stays body text', () => {
      const form = [
        'The search form needs these fields:',
        'From: departure city',
        'To: arrival city',
        'Date: the day of travel',
      ]
      for (const body of [form, [...form, 'Please build that first of all.']]) {
        expect(linesOf([testMHeader, ...body.map((line) => `> ${line}`)].join('\n'))).toEqual([body.map(kept)])
      }
    })

    it('a From: block with other text in it, or with nothing after it, stays body text', () => {
      const intro = 'These are the fields of it:'
      for (const body of [
        [intro, 'From: a@b.co', 'some other text', 'Date: x', newLines[0]],
        [intro, 'From: a@b.co', 'Date: x'],
        [intro, '-----Original Message-----', 'From: a@b.co', 'Date: x'],
        [intro, 'Begin forwarded message:'],
      ]) {
        const marked = [testMHeader, ...body.map((line) => `> ${line}`)].join('\n')
        expect(linesOf(marked)).toEqual([body.map(kept)])
        expect(linesOf(`${marked}\n\nMy answer is down here.`)[0].slice(0, body.length)).toEqual(body.map(kept))
      }
    })

    it('reads 50,000 characters of marked From: and divider lines quickly', () => {
      for (const unit of [
        '> From: a\n',
        '> From: a\n> Sent: b\n> c\n',
        '> -----Original Message-----\n',
        '> -----Original Message-----\n> \n> \nx\n',
        '> From: a\n> x\n>> Sent: b\n',
        '> From: a@b.co\n',
        '> From: a@b.co\n> Sent: b\n',
        '> From: a@b.co\n> Sent: b\n> \n',
        '> Begin forwarded message:\n> > From: a@b.co\n',
        `> ${'-'.repeat(1000)}\n`,
        `> On 1 a wrote:\n> b wrote:\n`,
      ]) {
        const started = Date.now()
        splitNewText(unit.repeat(Math.ceil(50000 / unit.length)), new Set(), new Set())
        expect(Date.now() - started).toBeLessThan(500)
      }
    })
  })

  describe('who wrote an own line', () => {
    const answer = 'Yes, go ahead with it today.'

    it('the quoter of the outermost quote one level deeper, not of the one it is placed in', () => {
      const fields = ['From: Dana Reyes <dana@books.example>', 'Date: Sun']
      const text = [testMHeader, `> ${newLines[0]}`, ...fields.map((f) => `> ${f}`), `> ${newLines[1]}`, answer]
      expect(splitNewText(text.join('\n'), new Set()).quotes[1]).toEqual({
        header: fields.join('\n'),
        quoterHeader: testMHeader,
        possibleQuoters: [testMHeader],
        lines: [kept(newLines[1]), { ...own(answer), quoter: null }],
      })
    })

    it('two attributions at one depth (Apple Mail): an answer one level up is the sender’s', () => {
      const text = [`> ${testMHeader}`, `> ${newLines[0]}`, `> ${nicoHeader}`, `> ${newLines[1]}`, answer].join('\n')
      expect(splitNewText(text, new Set()).quotes[1]).toEqual({
        header: nicoHeader,
        quoterHeader: testMHeader,
        possibleQuoters: [testMHeader],
        lines: [kept(newLines[1]), { ...own(answer), quoter: null, possible: 0 }],
      })
    })

    it('never an unknown quoter deeper than the line: at depth 0 it is the sender, and kept', () => {
      const text = [`> ${nicoHeader}`, `>> ${colour}`, '> Deeper answer by someone.', answer].join('\n')
      const held = splitNewText(text, seenLines([text]), allLines([text]))
      expect(held.quotes).toEqual([
        {
          header: nicoHeader,
          quoterHeader: '',
          possibleQuoters: [''],
          lines: [
            context(colour),
            context('Deeper answer by someone.'),
            { ...own(answer), quoter: null, possible: 0 },
          ],
        },
      ])
    })
  })

  // A Gmail header sits at its quoter's body depth, so a deeper one is Apple's.
  it('an attribution deeper than its quoter’s body has its body at its own depth', () => {
    const text = [
      `> ${testMHeader}`,
      `> ${newLines[0]}`,
      `>> ${nicoHeader}`,
      `>> ${newLines[1]}`,
      '>>> Shall we settle the price?',
      '>> We agree to it, as said before.',
    ].join('\n')
    expect(splitNewText(text, new Set()).quotes[1]).toEqual({
      header: nicoHeader,
      quoterHeader: testMHeader,
      possibleQuoters: [testMHeader],
      lines: [kept(newLines[1]), kept('Shall we settle the price?'), kept('We agree to it, as said before.')],
    })
  })

  describe('a two-line wrapped attribution starts with its date', () => {
    it('a typed English sentence above a date-less "wrote:" line is not swallowed', () => {
      expect(
        splitNewText(
          'On reflection I agree with this.\nBill Duris <b@aol.com> wrote:\n> A line never seen before.',
          new Set()
        ).typed
      ).toBe('On reflection I agree with this.\nBill Duris <b@aol.com> wrote:')
    })

    it('a typed French sentence above a date-less "a écrit :" line is not swallowed', () => {
      expect(
        splitNewText(
          'Le bouton vert me convient.\nBill Duris <b@aol.com> a écrit :\n> Une ligne jamais vue avant.',
          new Set()
        ).typed
      ).toBe('Le bouton vert me convient.\nBill Duris <b@aol.com> a écrit :')
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
