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
