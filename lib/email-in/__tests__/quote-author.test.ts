import { describe, it, expect } from 'vitest'
import {
  parseQuoteHeader,
  resolveAttributionAuthor,
  resolveQuoteAuthor,
  senderLabel,
  authorLabel,
  type QuoteAuthor,
} from '../quote-author'

describe('parseQuoteHeader', () => {
  const cases: Array<[string, string, string | null, string | null]> = [
    [
      'Apple Mail attribution',
      'On Nov 22, 2026, at 10:40 AM, Test M <tm@yahoo.com> wrote:',
      'Test M',
      'tm@yahoo.com',
    ],
    [
      'Gmail attribution',
      'On Sun, Nov 22, 2026 at 10:40 AM Test M <tm@yahoo.com> wrote:',
      'Test M',
      'tm@yahoo.com',
    ],
    [
      'Yahoo attribution with seconds and a time zone',
      'On Sunday, November 22, 2026 at 10:30:12 AM PST, Test M <tm@yahoo.com> wrote:',
      'Test M',
      'tm@yahoo.com',
    ],
    [
      'attribution wrapped over two lines',
      'On Nov 22, 2026, at 10:40 AM, Test M\n<tm@yahoo.com> wrote:',
      'Test M',
      'tm@yahoo.com',
    ],
    [
      'bare address in an attribution, normalized',
      'On 22 Nov 2026, at 18:40, TM@Yahoo.com wrote:',
      null,
      'tm@yahoo.com',
    ],
    [
      'name only in an attribution',
      'On Nov 22, 2026, at 10:40 AM, Bill Duris wrote:',
      'Bill Duris',
      null,
    ],
    [
      'quoted name with a comma',
      'On Nov 22, 2026, at 10:40 AM, "Duris, Bill" <b@aol.com> wrote:',
      'Duris, Bill',
      'b@aol.com',
    ],
    [
      'Outlook field block',
      'From: Test M <tm@yahoo.com>\nSent: Sunday, November 22, 2026 10:40 AM\nTo: Nico\nSubject: Re: x',
      'Test M',
      'tm@yahoo.com',
    ],
    [
      'forwarded message with a divider; the To line is never read',
      '---------- Forwarded message ---------\nFrom: Dana Reyes <dana@books.example>\nDate: Sun, Nov 22, 2026\nSubject: x\nTo: tm@yahoo.com',
      'Dana Reyes',
      'dana@books.example',
    ],
    [
      'Outlook [mailto:] form',
      'From: Test M [mailto:tm@yahoo.com]\nSent: x',
      'Test M',
      'tm@yahoo.com',
    ],
    [
      'Outlook nested mailto link',
      'From: Test M <tm@yahoo.com<mailto:tm@yahoo.com>>\nSent: x',
      'Test M',
      'tm@yahoo.com',
    ],
    ['From line with a name only', 'From: Bill Duris\nSent: x', 'Bill Duris', null],
    ['divider with no fields', 'Begin forwarded message:', null, null],
    ['empty header', '', null, null],
  ]

  // Only this row has an address the mail program did not put in a group.
  const bareRows = new Set(['bare address in an attribution, normalized'])

  it.each(cases)('%s', (label, header, name, email) => {
    expect(parseQuoteHeader(header)).toEqual({ name, email, bare: bareRows.has(label) })
  })

  it('takes the address in the angle group, never one inside the display name', () => {
    expect(parseQuoteHeader('From: "nico@example.com" <evil@x.com>\nSent: x')).toEqual({
      name: 'nico@example.com',
      email: 'evil@x.com',
      bare: false,
    })
    expect(
      parseQuoteHeader('On Nov 22, 2026, at 10:40 AM, nico@example.com <evil@x.com> wrote:')
    ).toEqual({ name: 'nico@example.com', email: 'evil@x.com', bare: false })
    expect(parseQuoteHeader('From: nico@example.com [mailto:evil@x.com]\nSent: x')).toEqual({
      name: 'nico@example.com',
      email: 'evil@x.com',
      bare: false,
    })
  })

  it('gives no address when the last angle group holds none, and does not fall back', () => {
    expect(parseQuoteHeader('From: "nico@example.com" <not an address>\nSent: x')).toEqual({
      name: 'nico@example.com',
      email: null,
      bare: false,
    })
  })

  it('takes a bare address only when it is the only one in the text', () => {
    expect(parseQuoteHeader('From: a@b.example c@d.example\nSent: x').email).toBeNull()
  })

  it('keeps a name that starts with capitals after a comma', () => {
    expect(parseQuoteHeader('On Nov 22, 2026, at 10:40 AM, DJ Khaled <dj@x.com> wrote:')).toEqual({
      name: 'DJ Khaled',
      email: 'dj@x.com',
      bare: false,
    })
  })

  it('keeps a name of capitals after a 24-hour time, and strips a time zone that follows it', () => {
    expect(parseQuoteHeader('On 22 Nov 2026, at 18:40, DJ Khaled <dj@x.com> wrote:').name).toBe(
      'DJ Khaled'
    )
    expect(parseQuoteHeader('On 22 Nov 2026, at 18:40, TM <t@x.com> wrote:').name).toBe('TM')
    expect(parseQuoteHeader('On 22 Nov 2026, at 18:40 CET, Test M <t@x.com> wrote:').name).toBe(
      'Test M'
    )
  })

  it('reads a long run of spaces, brackets or quotes quickly', () => {
    const headers = [
      'On 1, a' + ' '.repeat(1980) + 'b wrote:',
      'From: a' + ' '.repeat(1980) + 'b',
      'From: a' + '<'.repeat(1980) + 'b',
      'From: a' + '('.repeat(1980) + 'b',
      'From: a' + '['.repeat(1980) + 'b',
      'From: ' + '[mailto:'.repeat(240),
      'From: x' + '"'.repeat(1980) + 'x',
      'From: ' + 'a'.repeat(1000) + '@' + 'a'.repeat(980),
      'From: ' + 'a.'.repeat(500) + '@' + 'a.'.repeat(490),
      '\n'.repeat(1990) + 'From: x',
      'On ' + ' '.repeat(1980) + 'wrote:',
    ]
    for (const header of headers) {
      const start = performance.now()
      parseQuoteHeader(header)
      expect(performance.now() - start).toBeLessThan(50)
    }
  })

  it('reads a French attribution as it reads "On ... wrote:"', () => {
    expect(parseQuoteHeader('Le dim. 22 nov. 2026 à 11:00, Nico L <nico@me.com> a écrit :')).toEqual({
      name: 'Nico L',
      email: 'nico@me.com',
      bare: false,
    })
    // No space before the colon, a no-break space, and wrapped over two lines.
    for (const header of [
      'Le 22 nov. 2026 à 11:00, Nico L <nico@me.com> a écrit:',
      'Le 22 nov. 2026 à 11:00, Nico L <nico@me.com> a écrit :',
      'Le dim. 22 nov. 2026 à 11:00, Nico L <\nnico@me.com> a écrit :',
    ]) {
      expect(parseQuoteHeader(header)).toEqual({ name: 'Nico L', email: 'nico@me.com', bare: false })
    }
    expect(parseQuoteHeader('Le 22 nov. 2026 à 11:00, Bill Duris a écrit :')).toEqual({
      name: 'Bill Duris',
      email: null,
      bare: false,
    })
  })

  it('reads a long French attribution quickly', () => {
    const start = performance.now()
    parseQuoteHeader('Le 1, a' + ' '.repeat(1970) + 'b a écrit :')
    parseQuoteHeader('Le ' + ' '.repeat(1980) + 'a écrit :')
    expect(performance.now() - start).toBeLessThan(50)
  })

  it('lets a field block win over an attribution above it', () => {
    const header =
      'On Nov 22, 2026, at 10:40 AM, Someone Else <se@example.com> wrote:\nFrom: Test M <tm@yahoo.com>\nSent: x'
    expect(parseQuoteHeader(header)).toEqual({ name: 'Test M', email: 'tm@yahoo.com', bare: false })
  })

  it('reads the From: line, or else the attribution alone, never the field lines under it', () => {
    // A field line under an attribution is the quoted message's first text as
    // often as a field: it never names the author.
    expect(
      parseQuoteHeader(
        'On Nov 22, 2026, at 10:40 AM, Dana Reyes <dana@books.example> wrote:\nSubject: from Test M <tm@yahoo.com>'
      )
    ).toEqual({ name: 'Dana Reyes', email: 'dana@books.example', bare: false })
    expect(parseQuoteHeader('Begin forwarded message:\n\nSubject: On 1, T <tm@yahoo.com> wrote:')).toEqual({
      name: null,
      email: null,
      bare: false,
    })
  })

  it('reads an attribution in its own language, whatever the display name holds', () => {
    expect(
      parseQuoteHeader('Le 22 nov. 2026 à 11:00, On <tm@yahoo.com> wrote: <evil@x.com> a écrit :').email
    ).toBe('evil@x.com')
    expect(
      parseQuoteHeader('Le 22 nov. 2026 à 11:00, On <tm@yahoo.com> wrote: <\nevil@x.com> a écrit:').email
    ).toBe('evil@x.com')
    expect(
      parseQuoteHeader('On 22 Nov 2026, at 11:00, Le <tm@yahoo.com> a écrit : <evil@x.com> wrote:').email
    ).toBe('evil@x.com')
  })

  // A wrapped attribution whose second line looks like a field ends at its first
  // line here: it is no whole attribution, so the address left in it is not read.
  it('reads nobody from an attribution cut short by a line that looks like a field', () => {
    expect(
      parseQuoteHeader('On Nov 22, 2026, x <tm@yahoo.com> wrote: y\nSubject: <evil@x.com> wrote:')
    ).toEqual({ name: null, email: null, bare: false })
  })

  // A cut could move which address is last, so nothing is cut: a line too long
  // to read gives no author.
  it('gives no author for a From: line or an attribution too long to read', () => {
    const nobody = { name: null, email: null, bare: false }
    const long = 'x'.repeat(2100)
    expect(parseQuoteHeader(`From: Test M <tm@yahoo.com> ${long} <evil@x.com>\nSent: 2026`)).toEqual(nobody)
    expect(parseQuoteHeader(`On 1, Test M <tm@yahoo.com> ${long} <evil@x.com> wrote:`)).toEqual(nobody)
    // It does not fall back to the attribution above it either.
    expect(
      parseQuoteHeader(`On 1, Test M <tm@yahoo.com> wrote:\nFrom: T <tm@yahoo.com> ${long}`)
    ).toEqual(nobody)
  })

  it('reads the From: line of a header that is long only because of its To: list', () => {
    const header = (fields: string[]) => parseQuoteHeader(fields.join('\n'))
    const to = `To: ${'someone@example.com, '.repeat(2000)}`
    const author = { name: 'Test M', email: 'tm@yahoo.com', bare: false }
    expect(header(['From: Test M <tm@yahoo.com>', 'Sent: x', to])).toEqual(author)
    expect(header([to, 'From: Test M <tm@yahoo.com>', 'Sent: x'])).toEqual(author)
    expect(header(['On Nov 22, 2026, at 10:40 AM, Test M <tm@yahoo.com> wrote:', to])).toEqual(author)
  })

  // Only "\n" ends a line here, as in new-text.ts: a line separator inside a
  // display name does not cut the From: line short.
  it('reads the whole From: line past a carriage return or a Unicode line separator', () => {
    for (const separator of ['\r', ' ', ' ']) {
      expect(parseQuoteHeader(`From: Test M <tm@yahoo.com>${separator} <evil@x.com>\nSent: x`).email).toBe(
        'evil@x.com'
      )
    }
  })

  it('takes an address only when it is the whole of the last group', () => {
    for (const group of [
      '<"tm@yahoo.com"@evil.com>',
      '<_tm@yahoo.com>',
      '<a!tm@yahoo.com>',
      '<étm@yahoo.com>',
      '<tm@yahoo.comé.com>',
      '<tm@yahoo.com, x@y.com>',
      '<"<tm@yahoo.com>"@evil.com>',
      '<"[mailto:tm@yahoo.com]"@evil.com>',
      '[mailto:"tm@yahoo.com"@evil.com]',
    ]) {
      expect(parseQuoteHeader(`From: Dana ${group}\nSent: x`).email).toBeNull()
      expect(parseQuoteHeader(`On 1 Nov 2026, Dana ${group} wrote:`).email).toBeNull()
    }
    for (const group of ['< tm@yahoo.com >', '<mailto:tm@yahoo.com>', '<MAILTO:tm@yahoo.com>']) {
      expect(parseQuoteHeader(`From: T ${group}\nSent: x`)).toMatchObject({ email: 'tm@yahoo.com', bare: false })
    }
  })

  // Its value may have been wrapped, and the rest of it lost.
  it('does not trust a From: line with no field line directly under it', () => {
    for (const header of [
      'From: Test M <tm@yahoo.com>',
      '---------- Forwarded message ---------\nFrom: Test M <tm@yahoo.com> xxxxxxxx',
      'From: Test M <tm@yahoo.com> \n<evil@x.com>\nSent: x',
      'Sent: x\nFrom: Test M <tm@yahoo.com>',
    ]) {
      expect(parseQuoteHeader(header)).not.toMatchObject({ email: 'tm@yahoo.com', bare: false })
    }
  })

  it('does not trust a From: line written on behalf of someone, or with two addresses', () => {
    for (const value of [
      'b@evil.com [mailto:b@evil.com] On Behalf Of Test M <tm@yahoo.com>',
      'Bob on  behalf of Test M <tm@yahoo.com>',
      'Bob <b@evil.com> Test M <tm@yahoo.com>',
      'Bob <b@evil.com<mailto:tm@yahoo.com>>',
    ]) {
      expect(parseQuoteHeader(`From: ${value}\nSent: x`)).toMatchObject({ bare: true })
    }
    for (const value of ['T <tm@yahoo.com>[mailto:TM@yahoo.com]', 'T <tm@yahoo.com<mailto:tm@yahoo.com>>']) {
      expect(parseQuoteHeader(`From: ${value}\nSent: x`)).toMatchObject({ email: 'tm@yahoo.com', bare: false })
    }
  })

  // The last line may be the end of a wrapped display name, or the quoted
  // message's own first line, so neither address is the author's.
  it('reads nobody from an attribution with a line after it that ends like one', () => {
    for (const header of [
      'On Nov 22, 2026, x <tm@yahoo.com> wrote:\n<evil@x.com> wrote:',
      'On Nov 22, 2026, x <evil@x.com> wrote:\n<tm@yahoo.com> wrote:',
      'On Nov 22, 2026, x\n<evil@x.com> wrote:\n<tm@yahoo.com> wrote:',
      'Le 22 nov. 2026, x <tm@yahoo.com> a écrit :\n<evil@x.com> a écrit :',
      'On Nov 22, 2026, x <tm@yahoo.com> wrote:\nSubject: <evil@x.com> wrote:',
    ]) {
      expect(parseQuoteHeader(header)).toEqual({ name: null, email: null, bare: false })
    }
  })

  it('reads a hostile 50,000-character header quickly', () => {
    const headers = [
      'From: ' + 'a'.repeat(25000) + '@' + 'a.'.repeat(12500),
      'On 1, ' + '<'.repeat(50000) + ' wrote:',
      'Le 1 ' + ' a écrit'.repeat(6000) + ' a écrit :',
      'Le ' + ' '.repeat(50000) + 'a écrit :',
      'To: x\n'.repeat(8000) + 'From: x',
      'From: ' + 'on behalf '.repeat(190) + '<a@b.co>'.repeat(10) + '\nSent: x',
      'From: <' + 'a.'.repeat(990) + '@>\nSent: x',
      'On 1 wrote:\n' + 'wrote '.repeat(8000) + 'wrote:',
      '\n'.repeat(50000) + 'From: x',
      'On 1 wrote:' + '\nFrom: x <a@b.co>'.repeat(3000),
      ' '.repeat(50000) + 'From: x',
    ]
    for (const header of headers) {
      const start = performance.now()
      parseQuoteHeader(header)
      expect(performance.now() - start).toBeLessThan(100)
    }
  })

  it('never throws on odd input', () => {
    for (const header of [
      ' ',
      '\n\n',
      'wrote:',
      'On wrote:',
      'From:',
      'From: <>',
      '@@@',
      'x'.repeat(50000),
    ]) {
      expect(() => parseQuoteHeader(header)).not.toThrow()
    }
  })
})

describe('resolveQuoteAuthor and labels', () => {
  const members = [
    { email: 'tm@yahoo.com', role: 'maker', display_name: 'Test M' },
    { email: 'nico@example.com', role: 'owner', display_name: 'Nico L' },
    {
      email: 'gone@example.com',
      role: 'maker',
      display_name: 'Gone G',
      removed_at: '2026-11-01T00:00:00.000Z',
    },
    { email: 'odd@example.com', role: 'viewer' },
  ]
  const on = (who: string) => `On Nov 22, 2026, at 10:40 AM, ${who} wrote:`

  it('matches a maker by address and uses the member display name, whatever the header shows', () => {
    expect(resolveQuoteAuthor(on('Somebody Else <TM@yahoo.com>'), members)).toEqual({
      kind: 'member',
      role: 'maker',
      name: 'Test M',
    })
  })

  it('matches a builder-side member as builder', () => {
    expect(resolveQuoteAuthor(on('Nico <nico@example.com>'), members)).toEqual({
      kind: 'member',
      role: 'builder',
      name: 'Nico L',
    })
  })

  it('does not trust a member name next to a different address', () => {
    expect(resolveQuoteAuthor(on('Test M <someone@else.com>'), members)).toEqual({
      kind: 'outsider',
      name: 'Test M',
    })
  })

  it('treats a removed member as an outsider, named from the header or the local part', () => {
    expect(resolveQuoteAuthor(on('Gone G <gone@example.com>'), members)).toEqual({
      kind: 'outsider',
      name: 'Gone G',
    })
    expect(resolveQuoteAuthor(on('gone@example.com'), members)).toEqual({
      kind: 'outsider',
      name: 'gone',
    })
  })

  it('treats a member with an unknown role as an outsider', () => {
    expect(resolveQuoteAuthor(on('odd@example.com'), members)).toEqual({
      kind: 'outsider',
      name: 'odd',
    })
  })

  it('does not let a member address inside a display name make the author a member', () => {
    for (const header of [
      'From: "nico@example.com" <evil@x.com>\nSent: x',
      on('nico@example.com <evil@x.com>'),
    ]) {
      const author = resolveQuoteAuthor(header, members)
      expect(author).toEqual({ kind: 'outsider', name: 'evil' })
      expect(authorLabel(author)).toBe('evil, not a project member')
    }
  })

  it('never carries an address-shaped name into an outsider, even with no real address', () => {
    expect(resolveQuoteAuthor('From: "nico@example.com" <nothing>\nSent: x', members)).toEqual({
      kind: 'unknown',
    })
  })

  it('never matches a member by a bare address, which may be a display name an outsider chose', () => {
    expect(resolveQuoteAuthor('From: nico@example.com\nSent: x', members)).toEqual({
      kind: 'outsider',
      name: 'nico',
    })
    expect(resolveQuoteAuthor('On 22 Nov 2026, at 18:40, tm@yahoo.com wrote:', members)).toEqual({
      kind: 'outsider',
      name: 'tm',
    })
  })

  it('treats a name with no address as an outsider', () => {
    expect(resolveQuoteAuthor(on('Bill Duris'), members)).toEqual({
      kind: 'outsider',
      name: 'Bill Duris',
    })
  })

  it('puts no address in a label when the address is not whole', () => {
    for (const header of [
      'From: <"tm@yahoo.com"@evil.com>\nSent: x',
      on('<"tm@yahoo.com"@evil.com>'),
      on('"tm@yahoo.com"@evil.com'),
    ]) {
      const author = resolveQuoteAuthor(header, members)
      expect(author.kind).not.toBe('member')
      expect(authorLabel(author)).not.toContain('@')
    }
  })

  it('names an unknown address by its local part', () => {
    expect(resolveQuoteAuthor(on('dana@books.example'), members)).toEqual({
      kind: 'outsider',
      name: 'dana',
    })
  })

  it('credits an outsider whose display name holds an attribution in the other language', () => {
    for (const header of [
      'Le 22 nov. 2026 à 11:00, On <tm@yahoo.com> wrote: <evil@x.com> a écrit :',
      'On 22 Nov 2026, at 11:00, Le <tm@yahoo.com> a écrit : <evil@x.com> wrote:',
    ]) {
      expect(resolveQuoteAuthor(header, members).kind).toBe('outsider')
    }
  })

  describe('resolveAttributionAuthor', () => {
    const dana = on('Dana Reyes <dana@books.example>')
    const from = 'From: Test M <tm@yahoo.com>\nSent: x'

    it('names the attribution above a From: line', () => {
      expect(resolveAttributionAuthor(`${dana}\n${from}`, members)).toEqual({
        kind: 'outsider',
        name: 'Dana Reyes',
      })
      expect(resolveAttributionAuthor(`${on('N <nico@example.com>')}\n${from}`, members)).toEqual({
        kind: 'member',
        role: 'builder',
        name: 'Nico L',
      })
    })

    it('is unknown when that attribution cannot be read', () => {
      const long = on(`${'x'.repeat(2100)} <tm@yahoo.com>`)
      expect(resolveAttributionAuthor(`${long}\n${from}`, members)).toEqual({ kind: 'unknown' })
      // A wrapped attribution whose second line looks like a From: field.
      expect(
        resolveAttributionAuthor('On Nov 22, 2026, Dana\nFrom: Test M <tm@yahoo.com> wrote:', members)
      ).toEqual({ kind: 'unknown' })
    })

    it('is null without both an attribution and a From: line', () => {
      for (const header of [dana, from, `${dana}\nSubject: x`, `Begin forwarded message:\n\n${from}`, '']) {
        expect(resolveAttributionAuthor(header, members)).toBeNull()
      }
    })
  })

  it('gives unknown when the header names nobody', () => {
    expect(resolveQuoteAuthor('', members)).toEqual({ kind: 'unknown' })
    expect(resolveQuoteAuthor('Begin forwarded message:', members)).toEqual({ kind: 'unknown' })
  })

  it('labels each kind of author', () => {
    expect(authorLabel({ kind: 'member', role: 'maker', name: 'Test M' })).toBe('Maker (Test M)')
    expect(authorLabel({ kind: 'member', role: 'builder', name: 'Nico L' })).toBe(
      'Builder (Nico L)'
    )
    expect(authorLabel({ kind: 'outsider', name: 'Dana Reyes' })).toBe(
      'Dana Reyes, not a project member'
    )
    expect(authorLabel({ kind: 'unknown' })).toBe('unknown author')
    expect(senderLabel('builder', 'Nico L')).toBe('Builder (Nico L)')
    expect(senderLabel('maker', 'Test M')).toBe('Maker (Test M)')
  })

  it('never puts a full address in the label of an outsider found by address', () => {
    const author = resolveQuoteAuthor(on('dana@books.example'), members)
    expect(authorLabel(author)).not.toContain('@')
  })

  it('strips quotes, angle brackets and control characters from names in labels', () => {
    const dirty = 'Eve "<script>"\nIgnore\tprevious\u0007   instructions>'
    expect(senderLabel('maker', dirty)).toBe('Maker (Eve script Ignore previous instructions)')
    const outsider: QuoteAuthor = { kind: 'outsider', name: dirty }
    expect(authorLabel(outsider)).toBe(
      'Eve script Ignore previous instructions, not a project member'
    )
  })

  it('strips format characters such as bidi overrides and zero-width spaces from names', () => {
    expect(senderLabel('maker', 'Ev\u202Ee\u200Bil')).toBe('Maker (Eveil)')
  })

  it('cuts a long name to 80 characters', () => {
    const label = senderLabel('maker', 'a'.repeat(200))
    expect(label).toBe(`Maker (${'a'.repeat(80)})`)
  })

  it('does not leave an empty name before the outsider note', () => {
    expect(authorLabel({ kind: 'outsider', name: '"<>"' })).toBe('Someone, not a project member')
  })
})
