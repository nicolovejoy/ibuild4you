import { describe, it, expect } from 'vitest'
import type { ProjectEmail } from '@/lib/types'
import type { SenderMember } from '../sender'
import { readProjectEmails, readingSize } from '../reading'

const TM = 'tm@yahoo.com'
const NICO = 'nico@example.com'

const members: SenderMember[] = [
  { email: TM, role: 'maker', display_name: 'Test M' },
  { email: NICO, role: 'owner', display_name: 'Nico L' },
]

// A stored project email; Nico's unless the overrides say otherwise.
let count = 0
function email(overrides: Partial<ProjectEmail>): ProjectEmail {
  count++
  return {
    id: `e${count}`,
    project_id: 'p1',
    from_email: NICO,
    from_name: 'Nico L',
    from_role: 'builder',
    received_at: `2026-11-22T18:${String(count).padStart(2, '0')}:00.000Z`,
    sent_at: null,
    subject: 'Start screen',
    message_id: `<m${count}@example.com>`,
    text: '',
    truncated: false,
    attachments: [],
    ...overrides,
  }
}
const fromNico = (text: string) => email({ text })
const fromTestM = (text: string) =>
  email({ from_email: TM, from_name: 'Test M', from_role: 'maker', text })

const NICO_HEADER = 'On Nov 22, 2026, at 10:40 AM, Nico L <nico@example.com> wrote:'
const TM_HEADER = 'On Nov 22, 2026, at 10:40 AM, Test M <tm@yahoo.com> wrote:'

// Nico's first email with the two questions (cases a and g).
const QUESTIONS = [
  'Hi Test,',
  'What colour should the start button be?',
  'Should payment be by card or by invoice?',
  'Thanks,',
  'Nico',
].join('\n')

describe('readProjectEmails', () => {
  it('drops quoted lines already held, and leaves out a whole repeat from the same sender', () => {
    const lines = [
      'The start screen has one big button.',
      'Under it there is a list of saved songs.',
      'Each song opens its own practice page.',
      'Payment happens once, at sign-up time.',
      'There is no account page in the first version.',
    ]
    const first = fromNico(lines.join('\n'))
    const reply = fromTestM(
      ['Yes, that is all right.', '', NICO_HEADER, ...lines.map((l) => `> ${l}`)].join('\n')
    )
    const again = fromNico(lines.join('\n'))

    const readings = readProjectEmails([first, reply, again], members)

    expect(readings.map((r) => r.email)).toEqual([first, reply, again])
    // An email is never evidence against itself.
    expect(readings[0]).toMatchObject({ repeat: false, typed: lines.join('\n'), quotes: [] })
    expect(readings[1]).toMatchObject({
      repeat: false,
      typed: 'Yes, that is all right.',
      quotes: [],
    })
    expect(readings[2]).toMatchObject({ repeat: true, typed: '', quotes: [] })
  })

  it('credits an unseen quote to the member its header names (smoke step 4)', () => {
    const text = [
      'Thanks, adding the project address.',
      '',
      TM_HEADER,
      '> I would like the start button to be green.',
      '> Payment should be by card only, please.',
    ].join('\n')

    const [reading] = readProjectEmails([fromNico(text)], members)

    expect(reading.typed).toBe('Thanks, adding the project address.')
    expect(reading.quotes).toEqual([
      {
        header: TM_HEADER,
        author: 'member',
        label: 'Maker (Test M)',
        lines: [
          { text: 'I would like the start button to be green.', kind: 'new', by: null },
          { text: 'Payment should be by card only, please.', kind: 'new', by: null },
        ],
      },
    ])
  })

  it("credits inline answers to the email's sender, with the held questions as context (case a)", () => {
    const text = [
      NICO_HEADER,
      '> Hi Test,',
      '> What colour should the start button be?',
      'Green.',
      '> Should payment be by card or by invoice?',
      'By card, please, no invoices.',
      '> Thanks,',
      '> Nico',
    ].join('\n')

    const readings = readProjectEmails([fromNico(QUESTIONS), fromTestM(text)], members)

    expect(readings[1].typed).toBe('')
    expect(readings[1].quotes).toEqual([
      {
        header: NICO_HEADER,
        author: 'member',
        label: 'Builder (Nico L)',
        lines: [
          { text: 'Hi Test,', kind: 'context', by: null },
          { text: 'What colour should the start button be?', kind: 'context', by: null },
          { text: 'Green.', kind: 'inside', by: 'Maker (Test M)' },
          { text: 'Should payment be by card or by invoice?', kind: 'context', by: null },
          { text: 'By card, please, no invoices.', kind: 'inside', by: 'Maker (Test M)' },
          { text: 'Thanks,', kind: 'context', by: null },
          { text: 'Nico', kind: 'context', by: null },
        ],
      },
    ])
  })

  it('credits inline answers inside a nested quote to the author of the quote around it (case g)', () => {
    const text = [
      'Looping in the project.',
      '',
      'On Nov 22, 2026, at 11:00 AM, Test M <tm@yahoo.com> wrote:',
      `> ${NICO_HEADER}`,
      '>> What colour should the start button be?',
      '> Green.',
      '>> Should payment be by card or by invoice?',
      '> By card, please, no invoices.',
    ].join('\n')

    const readings = readProjectEmails([fromNico(QUESTIONS), fromNico(text)], members)

    expect(readings[1].typed).toBe('Looping in the project.')
    expect(readings[1].quotes).toEqual([
      {
        header: NICO_HEADER,
        author: 'member',
        label: 'Builder (Nico L)',
        lines: [
          { text: 'What colour should the start button be?', kind: 'context', by: null },
          { text: 'Green.', kind: 'inside', by: 'Maker (Test M)' },
          { text: 'Should payment be by card or by invoice?', kind: 'context', by: null },
          { text: 'By card, please, no invoices.', kind: 'inside', by: 'Maker (Test M)' },
        ],
      },
    ])
  })

  it('never brings back held inline answers as new words in later replies', () => {
    const quoteAll = (text: string) =>
      text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    const inline = [
      NICO_HEADER,
      '> Hi Test,',
      '> What colour should the start button be?',
      'Green.',
      '> Should payment be by card or by invoice?',
      'By card, please, no invoices.',
      '> Thanks,',
      '> Nico',
    ].join('\n')
    const e3 = `Great, thanks. Building it this week.\n\nOn Nov 22, 2026, at 11:00 AM, Test M <tm@yahoo.com> wrote:\n${quoteAll(inline)}`
    const e4 = `Thank you!\n\nOn Sun, Nov 22, 2026 at 11:30 AM Nico L <nico@example.com> wrote:\n${quoteAll(e3)}`

    const readings = readProjectEmails(
      [fromNico(QUESTIONS), fromTestM(inline), fromNico(e3), fromTestM(e4)],
      members
    )

    expect(readings[1].quotes[0].lines.filter((l) => l.kind === 'inside')).toHaveLength(2)
    expect(readings[2]).toMatchObject({ typed: 'Great, thanks. Building it this week.', quotes: [] })
    expect(readings[3]).toMatchObject({ typed: 'Thank you!', quotes: [] })
  })

  it('credits an answer under a French attribution to its author, not to the sender', () => {
    const text = [
      "D'accord, merci.",
      'Le dim. 22 nov. 2026 à 11:00, Nico L <nico@example.com> a écrit :',
      '> Answers below.',
      '> On Nov 21, 2026, at 9:00 AM, Test M <tm@yahoo.com> wrote:',
      '>> Should the app send reminders every day?',
      '> No, weekly reminders are enough for this kind of app.',
    ].join('\n')

    const [reading] = readProjectEmails([fromTestM(text)], members)

    expect(reading.quotes.map(({ author, label, lines }) => ({ author, label, lines }))).toEqual([
      {
        author: 'member',
        label: 'Builder (Nico L)',
        lines: [{ text: 'Answers below.', kind: 'new', by: null }],
      },
      {
        author: 'member',
        label: 'Maker (Test M)',
        lines: [
          { text: 'Should the app send reminders every day?', kind: 'new', by: null },
          { text: 'No, weekly reminders are enough for this kind of app.', kind: 'inside', by: 'Builder (Nico L)' },
        ],
      },
    ])
  })

  it('credits an answer under a header the app cannot read to an unknown author', () => {
    const text = [
      'Danke.',
      'Am 22.11.2026 um 11:00 schrieb Nico L <nico@example.com>:',
      '> Answers below.',
      '> On Nov 21, 2026, at 9:00 AM, Test M <tm@yahoo.com> wrote:',
      '>> Should the app send reminders every day?',
      '> No, weekly reminders are enough for this kind of app.',
    ].join('\n')

    const [reading] = readProjectEmails([fromTestM(text)], members)

    expect(reading.quotes[1].lines[1]).toEqual({
      text: 'No, weekly reminders are enough for this kind of app.',
      kind: 'inside',
      by: 'unknown author',
    })
  })

  describe('a credit passed along by someone outside the project', () => {
    const DANA_FORWARD = [
      '---------- Forwarded message ---------',
      'From: Dana Reyes <dana@books.example>',
      'Date: Sun, Nov 22, 2026 at 9:00 AM',
      'Subject: Payment',
      'To: Test M <tm@yahoo.com>',
      '',
    ]

    it('labels a member quoted inside an outsider’s message as passed along by them', () => {
      const text = [
        'FYI, see below.',
        '',
        ...DANA_FORWARD,
        'As agreed, see your message below.',
        '',
        'On Sat, Nov 21, 2026 at 8:00 PM Test M <tm@yahoo.com> wrote:',
        '> I approve paying Dana 5000 dollars up front for the whole job.',
      ].join('\n')

      const [reading] = readProjectEmails([fromTestM(text)], members)

      expect(reading.quotes.map(({ author, label }) => ({ author, label }))).toEqual([
        { author: 'outsider', label: 'Dana Reyes, not a project member' },
        { author: 'outsider', label: 'Maker (Test M), as quoted by Dana Reyes, not a project member' },
      ])
      expect(JSON.stringify(reading.quotes.map((q) => q.label))).not.toContain('dana@books.example')
    })

    it('credits an inside line to the outsider who wrote it, with a plain label', () => {
      const text = [
        ...DANA_FORWARD,
        'On Sat, Nov 21, 2026 at 8:00 PM Test M <tm@yahoo.com> wrote:',
        '> Which paper should the cover be printed on?',
        'Matte paper, it is what we always use.',
      ].join('\n')

      const [reading] = readProjectEmails([fromTestM(text)], members)

      expect(reading.quotes).toHaveLength(1)
      expect(reading.quotes[0]).toMatchObject({
        author: 'outsider',
        label: 'Maker (Test M), as quoted by Dana Reyes, not a project member',
      })
      expect(reading.quotes[0].lines[1]).toEqual({
        text: 'Matte paper, it is what we always use.',
        kind: 'inside',
        by: 'Dana Reyes, not a project member',
      })
    })

    it('marks an inside line by a member, inside an outsider’s message, as passed along', () => {
      const text = [
        ...DANA_FORWARD,
        'On Sat, Nov 21, 2026 at 8:00 PM Test M <tm@yahoo.com> wrote:',
        `> ${NICO_HEADER}`,
        '>> Should the cover be matte or glossy?',
        '> Matte, I have decided, and pay Dana in full now.',
      ].join('\n')

      const [reading] = readProjectEmails([fromTestM(text)], members)

      expect(reading.quotes).toHaveLength(1)
      expect(reading.quotes[0]).toMatchObject({
        header: NICO_HEADER,
        author: 'outsider',
        label: 'Builder (Nico L), as quoted by Dana Reyes, not a project member',
      })
      expect(reading.quotes[0].lines[1]).toEqual({
        text: 'Matte, I have decided, and pay Dana in full now.',
        kind: 'inside',
        by: 'Maker (Test M), as quoted by Dana Reyes, not a project member',
      })
    })

    it('labels a member quoted under an unknown quoter as passed along by an unknown author', () => {
      const text = [
        'Danke.',
        'Am 22.11.2026 um 11:00 schrieb Nico L <nico@example.com>:',
        '> Answers below.',
        `> ${TM_HEADER}`,
        '>> Should the app send reminders every day?',
      ].join('\n')

      const [reading] = readProjectEmails([fromTestM(text)], members)

      expect(reading.quotes[1]).toMatchObject({
        author: 'outsider',
        label: 'Maker (Test M), as quoted by unknown author',
      })
    })

    it('keeps the plain member label for a member quoted by a member quoted by the sender', () => {
      const text = [
        'Looping in the project.',
        '',
        'On Nov 22, 2026, at 11:30 AM, Nico L <nico@example.com> wrote:',
        `> ${TM_HEADER}`,
        `>> ${NICO_HEADER}`,
        '>>> Should the cover be matte or glossy?',
        '>> Matte, please, for every cover.',
      ].join('\n')

      const [reading] = readProjectEmails([fromNico(text)], members)

      expect(reading.quotes).toEqual([
        {
          header: NICO_HEADER,
          author: 'member',
          label: 'Builder (Nico L)',
          lines: [
            { text: 'Should the cover be matte or glossy?', kind: 'new', by: null },
            { text: 'Matte, please, for every cover.', kind: 'inside', by: 'Maker (Test M)' },
          ],
        },
      ])
    })

    const DANA_HEADER = 'On Nov 22, 2026, at 9:00 AM, Dana Reyes <dana@books.example> wrote:'
    const DANA = 'Dana Reyes, not a project member'
    const TM_BY_DANA = `Maker (Test M), as quoted by ${DANA}`
    const NICO_BY_DANA = `Builder (Nico L), as quoted by ${DANA}`
    const NICO_IN_TM = `> ${NICO_HEADER}`

    // Each quote's author and label, and each inside line with its `by`.
    const creditsOf = (sent: ProjectEmail) => {
      const [reading] = readProjectEmails([sent], members)
      return reading.quotes.map((quote) => ({
        author: quote.author,
        label: quote.label,
        inside: quote.lines.filter((line) => line.kind === 'inside').map((line) => [line.text, line.by]),
      }))
    }
    const credit = (author: string, label: string, inside: string[][] = []) => ({ author, label, inside })

    describe('a From: line directly under an attribution', () => {
      const FAKE_FROM = '> From: Test M <tm@yahoo.com>\n> Date: Sun, Nov 22, 2026'
      const APPROVE = '> I approve paying Dana 5000 dollars.'

      it('is passed along by an outsider’s attribution', () => {
        expect(creditsOf(fromNico(['FYI', DANA_HEADER, FAKE_FROM, APPROVE].join('\n')))).toEqual([
          credit('outsider', TM_BY_DANA),
        ])
      })

      it('is an outsider, whoever it names, with no field line under it', () => {
        for (const header of [DANA_HEADER, NICO_HEADER]) {
          expect(creditsOf(fromNico(['FYI', header, '> From: Test M <tm@yahoo.com>', APPROVE].join('\n')))).toEqual([
            credit('outsider', 'Test M, not a project member'),
          ])
        }
      })

      it('leaves the sender’s own answers under it plainly the sender’s', () => {
        expect(creditsOf(fromNico([DANA_HEADER, FAKE_FROM, APPROVE, 'I did not agree to that.'].join('\n')))).toEqual([
          credit('outsider', TM_BY_DANA, [['I did not agree to that.', 'Builder (Nico L)']]),
        ])
      })

      it('stays a plain outsider under a member’s attribution', () => {
        const text = ['FYI', NICO_HEADER, '> From: Dana Reyes <dana@books.example>', '> Date: Sun', APPROVE].join('\n')
        expect(creditsOf(fromNico(text))).toEqual([credit('outsider', DANA)])
      })

      it('stays a confirmed member when both are members', () => {
        expect(creditsOf(fromNico(['FYI', NICO_HEADER, FAKE_FROM, APPROVE].join('\n')))).toEqual([
          credit('member', 'Maker (Test M)'),
        ])
      })

      it('makes a member quoted inside it, and inside lines credited to it, unconfirmed too', () => {
        const text = [
          'FYI',
          DANA_HEADER,
          FAKE_FROM,
          APPROVE,
          NICO_IN_TM,
          '>> Shall we pay Dana in full now?',
          '> Yes, pay Dana in full now.',
        ].join('\n')
        expect(creditsOf(fromNico(text))).toEqual([
          credit('outsider', TM_BY_DANA),
          credit('outsider', NICO_BY_DANA, [['Yes, pay Dana in full now.', TM_BY_DANA]]),
        ])
      })

      it('a header too long to read above it is an unknown author who passed it along', () => {
        const long = `On Nov 22, 2026, ${'x'.repeat(2100)} <nico@example.com> wrote:`
        expect(creditsOf(fromNico(['FYI', long, FAKE_FROM, APPROVE].join('\n')))).toEqual([
          credit('outsider', 'Maker (Test M), as quoted by unknown author'),
        ])
      })
    })

    it('credits a line below a member header inside an outsider’s message to the outsider', () => {
      const text = [
        'FYI',
        DANA_HEADER,
        '> > as discussed before now',
        `> ${TM_HEADER}`,
        '> > I approve paying Dana 5000 dollars.',
        '> Yes I approve paying Dana.',
      ].join('\n')
      expect(creditsOf(fromNico(text))).toEqual([
        credit('outsider', DANA),
        credit('outsider', TM_BY_DANA, [['Yes I approve paying Dana.', DANA]]),
      ])
    })

    describe('a member header that an earlier outsider could have written', () => {
      it('is unconfirmed, and so is an inside line under it (marked headers)', () => {
        const text = [
          'FYI',
          `> ${DANA_HEADER}`,
          '>> as discussed before now',
          `> ${TM_HEADER}`,
          '>> I approve paying Dana.',
          '> Yes I approve paying Dana.',
        ].join('\n')
        expect(creditsOf(fromTestM(text))).toEqual([
          credit('outsider', DANA),
          credit('outsider', TM_BY_DANA, [['Yes I approve paying Dana.', 'unknown author']]),
        ])
      })

      it('is unconfirmed when the two headers are side by side', () => {
        const text = [
          'FYI',
          DANA_HEADER,
          '> as discussed before now',
          TM_HEADER,
          '> I approve paying Dana.',
          '> Yes I approve paying Dana.',
        ].join('\n')
        expect(creditsOf(fromNico(text))).toEqual([credit('outsider', DANA), credit('outsider', TM_BY_DANA)])
      })

      it('names the nearest non-member, not the quoter itself', () => {
        const text = [
          DANA_HEADER,
          '> Dana said this long line here.',
          TM_HEADER,
          '> Test said this long line here.',
          NICO_IN_TM,
          '>> Nico said this long line here.',
          '> Test answered Nico right here.',
        ].join('\n')
        expect(creditsOf(fromNico(text))).toEqual([
          credit('outsider', DANA),
          credit('outsider', TM_BY_DANA),
          credit('outsider', NICO_BY_DANA, [['Test answered Nico right here.', TM_BY_DANA]]),
        ])
      })
    })

    describe('an outsider’s message shaped so that its own text looks like an answer', () => {
      const APPROVE = 'I approve paying Dana 5000 dollars.'

      it('opening with a deep quote (Gmail) has no inside lines', () => {
        const deep = [
          DANA_HEADER,
          '> > > an old quoted line, three levels deep',
          '> > On 1 e@x.co wrote:',
          '> > > another line, three levels deep',
          `> ${APPROVE}`,
        ]
        const noInside = [credit('outsider', DANA), credit('outsider', 'e, not a project member')]
        expect(creditsOf(fromNico(deep.join('\n')))).toEqual(noInside)
        expect(creditsOf(fromNico([TM_HEADER, ...deep.map((line) => `> ${line}`)].join('\n')))).toEqual(noInside)
        expect(
          creditsOf(fromNico([DANA_HEADER, `> > > ${TM_HEADER}`, '> > > > an old quoted line', `> ${APPROVE}`].join('\n')))
        ).toEqual([credit('outsider', DANA), credit('outsider', TM_BY_DANA)])
      })

      it('opening with a quote (Apple Mail) has inside lines by an unknown author', () => {
        const text = ['FYI', `> ${DANA_HEADER}`, '> ', '> > Shall I pay Dana this week?', `> ${APPROVE}`].join('\n')
        expect(creditsOf(fromNico(text))).toEqual([credit('outsider', DANA, [[APPROVE, 'unknown author']])])
      })

      it('under a header in another language never credits a member or the sender', () => {
        const german = 'Am 22.11.2026 um 11:00 schrieb Dana <dana@books.example>:'
        for (const header of [[`> ${TM_HEADER}`], ['> From: Test M <tm@yahoo.com>', '> Date: Sun']]) {
          expect(creditsOf(fromNico(['FYI', german, ...header, `> ${APPROVE}`].join('\n')))).toEqual([
            credit('outsider', 'Maker (Test M), as quoted by unknown author'),
          ])
        }
        const deep = ['FYI', german, '> > On 1 e@x.co wrote:', '> > an old line by e, quoted', `> ${APPROVE}`]
        expect(creditsOf(fromNico(deep.join('\n')))).toEqual([
          credit('outsider', 'e, not a project member', [[APPROVE, 'unknown author']]),
        ])
      })

      it('a member header in that position is unconfirmed', () => {
        const text = ['FYI', `> ${TM_HEADER}`, '> > Shall I pay Dana this week?'].join('\n')
        expect(creditsOf(fromNico(text))).toEqual([
          credit('outsider', 'Maker (Test M), as quoted by unknown author'),
        ])
      })

      it('an Apple Mail quote answered one level up stays the sender’s, and confirmed', () => {
        const text = [`> ${TM_HEADER}`, '> ', '> Shall I pay Dana this week?', 'Yes, pay her this week.'].join('\n')
        expect(creditsOf(fromNico(text))).toEqual([
          credit('member', 'Maker (Test M)', [['Yes, pay her this week.', 'Builder (Nico L)']]),
        ])
      })
    })

    describe('a header cut by a mail program’s line wrap', () => {
      const APPROVE = 'I approve paying Dana 5000 dollars.'

      it('never credits a member', () => {
        const long = 'x'.repeat(50)
        for (const header of [
          ['On Sun, Nov 22, 2026 at 10:40 AM xx <tm@yahoo.com> wrote:', '<evil@x.com> wrote:'],
          ['---------- Forwarded message ---------', `From: Test M <tm@yahoo.com> ${long}`, '<evil@x.com>', 'Date: Sun'],
          [`From: Test M <tm@yahoo.com> ${long}`, '<evil@x.com>', 'Sent: Sunday', 'Subject: x'],
        ]) {
          const credits = creditsOf(fromNico(['FYI', ...header, `> ${APPROVE}`].join('\n')))
          expect(credits.map((c) => c.author)).not.toContain('member')
        }
      })
    })

    it('credits a marked Outlook block inside a member’s quote to its own author', () => {
      const text = [
        TM_HEADER,
        '> See below, please read it.',
        '> From: Dana Reyes <dana@books.example>',
        '> Sent: Sunday, November 22, 2026',
        '> ',
        '> I approve paying Dana 5000 dollars.',
        `> ${NICO_HEADER}`,
        '>> I approve it as well, pay her.',
      ].join('\n')
      expect(creditsOf(fromNico(text))).toEqual([
        credit('member', 'Maker (Test M)'),
        credit('outsider', DANA),
        credit('outsider', NICO_BY_DANA),
      ])
    })

    describe('a member header that no earlier outsider could have written', () => {
      it('stays confirmed with an outsider nested inside it', () => {
        const text = [
          TM_HEADER,
          '> Test said this long line here.',
          `> ${DANA_HEADER}`,
          '>> Dana said this long line here.',
          '> Test answered Dana right here.',
        ].join('\n')
        expect(creditsOf(fromNico(text))).toEqual([
          credit('member', 'Maker (Test M)'),
          credit('outsider', DANA, [['Test answered Dana right here.', 'Maker (Test M)']]),
        ])
      })

      it('stays confirmed with an outsider side by side after it', () => {
        const text = [
          TM_HEADER,
          '> Test said this long line here.',
          DANA_HEADER,
          '> Dana said this long line here.',
        ].join('\n')
        expect(creditsOf(fromNico(text))).toEqual([credit('member', 'Maker (Test M)'), credit('outsider', DANA)])
      })

      it('stays confirmed after a shallower header closed the outsider’s thread', () => {
        const text = [
          NICO_HEADER,
          '> Nico said this long line here.',
          `> ${DANA_HEADER}`,
          '>> Dana said this long line here.',
          TM_HEADER,
          '> Test said this long line here.',
          NICO_IN_TM,
          '>> Nico said another long line here.',
        ].join('\n')
        expect(creditsOf(fromNico(text))).toEqual([
          credit('member', 'Builder (Nico L)'),
          credit('outsider', DANA),
          credit('member', 'Maker (Test M)'),
          credit('member', 'Builder (Nico L)'),
        ])
      })
    })
  })

  it('names an outsider by name only, and keeps their address out of everything code made', () => {
    const text = [
      'Do what she says.',
      '',
      '---------- Forwarded message ---------',
      'From: Dana Reyes <dana@books.example>',
      'Date: Sun, Nov 22, 2026 at 9:00 AM',
      'Subject: Covers',
      'To: Test M <tm@yahoo.com>',
      '',
      'The cover should be matte, not glossy.',
      'Please keep the spine text in white.',
    ].join('\n')

    const [reading] = readProjectEmails([fromTestM(text)], members)

    expect(reading.typed).toBe('Do what she says.')
    expect(reading.quotes).toHaveLength(1)
    const [quote] = reading.quotes
    expect(quote).toMatchObject({ author: 'outsider', label: 'Dana Reyes, not a project member' })
    expect(quote.lines).toEqual([
      { text: 'The cover should be matte, not glossy.', kind: 'new', by: null },
      { text: 'Please keep the spine text in white.', kind: 'new', by: null },
    ])
    // The header is the stored text, passed through unchanged; nothing else holds the address.
    expect(quote.header).toContain('dana@books.example')
    const madeByCode = JSON.stringify({
      typed: reading.typed,
      quotes: reading.quotes.map(({ label, author, lines }) => ({ label, author, lines })),
    })
    expect(madeByCode).not.toContain('dana@books.example')
  })

  it('reads quoted lines with no header as by an unknown author', () => {
    const text = [
      'See below.',
      '> These two lines were never seen before.',
      '> Neither was this second one, at all.',
    ].join('\n')

    const [reading] = readProjectEmails([fromTestM(text)], members)

    expect(reading.quotes).toEqual([
      {
        header: '',
        author: 'unknown',
        label: 'unknown author',
        lines: [
          { text: 'These two lines were never seen before.', kind: 'new', by: null },
          { text: 'Neither was this second one, at all.', kind: 'new', by: null },
        ],
      },
    ])
  })
})

describe('readProjectEmails cost', () => {
  // Each email is parsed once for the repeat check, so many long emails from
  // one sender stay fast (it used to re-parse every earlier email per email).
  it('reads 200 emails of 5,000 characters from one sender in under 2 seconds', () => {
    const emails = Array.from({ length: 200 }, (_, i) => {
      let text = ''
      for (let j = 0; text.length < 5000; j++) {
        // Short lines: the cost is per line, so this is the heavy shape.
        text += `Mail ${i}, line ${j}.\n`
      }
      return fromNico(text.slice(0, 5000))
    })
    const started = Date.now()
    const readings = readProjectEmails(emails, members)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(readings).toHaveLength(200)
    expect(readings.every((r) => !r.repeat)).toBe(true)
  })

  // Outlook field blocks at one depth nest each inside the one before, so each
  // quote's possibleQuoters names every block above it: about 1,200 blocks and
  // 700,000 entries in 50,000 characters. Each header is resolved once.
  it('reads 50,000 characters of nested Outlook headers quickly', () => {
    let text = ''
    for (let i = 0; text.length < 50000; i++) text += `From: a${i}\nSent: b\nline number ${i} is new\n`
    const started = Date.now()
    const [reading] = readProjectEmails([fromNico(text)], members)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(reading.quotes.length).toBeGreaterThan(1000)
  })

  // Every one of these could have been written by every one before it, and all
  // are members, so no search ends early.
  it('reads 50,000 characters of distinct same-depth member headers quickly', () => {
    let text = ''
    for (let i = 0; text.length < 50000; i++) text += `On ${i} <${TM}> wrote:\n> line ${i}\n`
    const started = Date.now()
    const [reading] = readProjectEmails([fromNico(text)], members)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(reading.quotes.length).toBeGreaterThan(1000)
    expect(reading.quotes.every((quote) => quote.author === 'member')).toBe(true)
  })
})

describe('readingSize', () => {
  it('counts the typed text and every quote line', () => {
    const reading = {
      typed: 'abc',
      quotes: [
        {
          header: 'On Nov 22, 2026, at 10:40 AM, Test M <tm@yahoo.com> wrote:',
          author: 'member' as const,
          label: 'Maker (Test M)',
          lines: [
            { text: 'de', kind: 'new' as const, by: null },
            { text: '', kind: 'new' as const, by: null },
          ],
        },
      ],
    }
    expect(readingSize(reading)).toBe(5)
  })
})
