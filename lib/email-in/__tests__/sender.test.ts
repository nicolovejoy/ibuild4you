import { describe, it, expect } from 'vitest'
import { checkSender } from '../sender'

const members = [
  { email: 'bduris@aol.com', role: 'maker', display_name: 'Bill Duris' },
  { email: 'nico@example.com', role: 'owner', display_name: 'Nico' },
  { email: 'app@example.com', role: 'apprentice' },
  { email: 'gone@example.com', role: 'maker', removed_at: '2026-11-01T00:00:00Z' },
]

describe('checkSender', () => {
  it('matches the address inside angle brackets, normalized, with the display name', () => {
    expect(checkSender({ from: '"Bill Duris" <BDuris@AOL.com>', dmarc: 'pass', members })).toEqual({
      ok: true,
      from_email: 'bduris@aol.com',
      from_name: 'Bill Duris',
      from_role: 'maker',
    })
  })

  it('matches a bare address with odd case and surrounding spaces', () => {
    expect(checkSender({ from: '  BDURIS@aol.COM ', dmarc: 'pass', members })).toMatchObject({
      ok: true,
      from_email: 'bduris@aol.com',
    })
  })

  it('matches a display name without quotes', () => {
    expect(
      checkSender({ from: 'Bill Duris <bduris@aol.com>', dmarc: 'pass', members })
    ).toMatchObject({
      ok: true,
      from_email: 'bduris@aol.com',
      from_name: 'Bill Duris',
    })
  })

  it('compares member emails normalized too', () => {
    const odd = [{ email: ' Bill@Example.COM', role: 'maker' }]
    expect(checkSender({ from: 'bill@example.com', dmarc: 'pass', members: odd })).toMatchObject({
      ok: true,
      from_email: 'bill@example.com',
    })
  })

  it('stamps apprentice as builder and falls back to the local part for the name', () => {
    expect(checkSender({ from: 'app@example.com', dmarc: 'pass', members })).toEqual({
      ok: true,
      from_email: 'app@example.com',
      from_name: 'app',
      from_role: 'builder',
    })
  })

  it('stamps owner and builder as builder', () => {
    expect(checkSender({ from: 'nico@example.com', dmarc: 'pass', members })).toMatchObject({
      ok: true,
      from_name: 'Nico',
      from_role: 'builder',
    })
    const withBuilder = [{ email: 'b@example.com', role: 'builder', display_name: 'B' }]
    expect(
      checkSender({ from: 'b@example.com', dmarc: 'pass', members: withBuilder })
    ).toMatchObject({
      ok: true,
      from_role: 'builder',
    })
  })

  it('falls back to the local part when the display name is blank', () => {
    const blank = [{ email: 'x@example.com', role: 'maker', display_name: '  ' }]
    expect(checkSender({ from: 'x@example.com', dmarc: 'pass', members: blank })).toMatchObject({
      ok: true,
      from_name: 'x',
    })
  })

  it('is auth_failed for a member when DMARC fails or is missing', () => {
    expect(checkSender({ from: 'bduris@aol.com', dmarc: 'fail', members })).toEqual({
      ok: false,
      reason: 'auth_failed',
      from_email: 'bduris@aol.com',
    })
    expect(checkSender({ from: 'bduris@aol.com', dmarc: null, members })).toEqual({
      ok: false,
      reason: 'auth_failed',
      from_email: 'bduris@aol.com',
    })
    expect(checkSender({ from: 'bduris@aol.com', dmarc: 'PASS ', members })).toMatchObject({
      reason: 'auth_failed',
    })
  })

  it('is not_member for a stranger, whatever DMARC says', () => {
    expect(checkSender({ from: 'stranger@x.com', dmarc: 'pass', members })).toEqual({
      ok: false,
      reason: 'not_member',
    })
    expect(checkSender({ from: 'stranger@x.com', dmarc: 'fail', members })).toEqual({
      ok: false,
      reason: 'not_member',
    })
  })

  it('is not_member for a removed member', () => {
    expect(checkSender({ from: 'gone@example.com', dmarc: 'pass', members })).toEqual({
      ok: false,
      reason: 'not_member',
    })
  })

  it('uses an active row when the same address also has a removed one', () => {
    const both = [
      { email: 'gone@example.com', role: 'builder', removed_at: '2026-11-01T00:00:00Z' },
      { email: 'gone@example.com', role: 'maker' },
    ]
    expect(checkSender({ from: 'gone@example.com', dmarc: 'pass', members: both })).toMatchObject({
      ok: true,
      from_role: 'maker',
    })
  })

  it('fails closed on a member row with an unknown or missing role', () => {
    const odd = [
      { email: 'weird@example.com', role: 'admin' },
      { email: 'none@example.com', role: undefined },
    ]
    expect(checkSender({ from: 'weird@example.com', dmarc: 'pass', members: odd })).toEqual({
      ok: false,
      reason: 'not_member',
    })
    expect(checkSender({ from: 'none@example.com', dmarc: 'pass', members: odd })).toEqual({
      ok: false,
      reason: 'not_member',
    })
  })

  it('is not_member for an empty or unparsable From', () => {
    expect(checkSender({ from: '', dmarc: 'pass', members })).toEqual({
      ok: false,
      reason: 'not_member',
    })
    expect(checkSender({ from: 'Bill Duris', dmarc: 'pass', members })).toEqual({
      ok: false,
      reason: 'not_member',
    })
  })
  it('uses the address after a quoted name, even when the name holds an address', () => {
    // The quoted name is free text: a member's address inside it must never be
    // the one checked. These are validly shaped, so they parse to the real
    // (last) address, which is not a member.
    for (const from of [
      '"<bduris@aol.com>" <attacker@evil.com>',
      '"Bill <bduris@aol.com>" <attacker@evil.com>',
    ]) {
      expect(checkSender({ from, dmarc: 'pass', members })).toEqual({
        ok: false,
        reason: 'not_member',
      })
    }
  })

  it('pins the real address when the one in the quoted name is not it', () => {
    const withAttacker = [...members, { email: 'attacker@evil.com', role: 'builder' }]
    expect(
      checkSender({
        from: '"<bduris@aol.com>" <attacker@evil.com>',
        dmarc: 'pass',
        members: withAttacker,
      })
    ).toMatchObject({ ok: true, from_email: 'attacker@evil.com', from_role: 'builder' })
  })

  it('fails closed on From shapes outside the two accepted ones', () => {
    for (const from of [
      'attacker@evil.com (<bduris@aol.com>)',
      'attacker@evil.com, <bduris@aol.com>',
      'Bill <bduris@aol.com> trailing',
      'bduris@aol.com, attacker@evil.com',
      '<bduris@aol.com>, <attacker@evil.com>',
      '<attacker@evil.com> <bduris@aol.com>',
      'Bill <x@y.com> <bduris@aol.com>',
      'Duris, Bill <bduris@aol.com>',
      'Bill (Home) <bduris@aol.com>',
      'bduris@aol.com (Bill)',
      '"Bill <bduris@aol.com>',
      '"Bill" "Duris" <bduris@aol.com>',
      'Bill "Duris" <bduris@aol.com>',
      '<bduris@aol.com',
      'bduris@aol.com>',
      '<>',
      '< bduris@aol.com >',
      '<bduris@aol.com>>',
      'Bill <<bduris@aol.com>',
    ]) {
      expect(checkSender({ from, dmarc: 'pass', members }), from).toEqual({
        ok: false,
        reason: 'not_member',
      })
    }
  })

  it('accepts a quoted name holding commas, brackets, parentheses and escaped quotes', () => {
    for (const from of [
      '"Duris, Bill" <bduris@aol.com>',
      '"Bill (Home)" <bduris@aol.com>',
      '"Bill \\"B\\" <x>, y" <bduris@aol.com>',
      '<bduris@aol.com>',
      '  "Bill"<bduris@aol.com>  ',
    ]) {
      expect(checkSender({ from, dmarc: 'pass', members }), from).toMatchObject({
        ok: true,
        from_email: 'bduris@aol.com',
      })
    }
  })

  it('rejects an address that is not plain printable ASCII', () => {
    const ken = [{ email: 'ken@mail.com', role: 'maker' }]
    // U+212A KELVIN SIGN lowercases to a plain k.
    expect(checkSender({ from: '\u212Aen@mail.com', dmarc: 'pass', members: ken })).toEqual({
      ok: false,
      reason: 'not_member',
    })
    expect(checkSender({ from: 'Ken <\u212Aen@mail.com>', dmarc: 'pass', members: ken })).toEqual({
      ok: false,
      reason: 'not_member',
    })
    // A zero-width space, bare and inside angle brackets.
    for (const from of ['bduris@aol.com\u200B', 'Bill <bduris@aol.com\u200B>']) {
      expect(checkSender({ from, dmarc: 'pass', members }), from).toEqual({
        ok: false,
        reason: 'not_member',
      })
    }
  })

  it('rejects addresses without exactly one @ and a valid shape', () => {
    for (const from of ['a@b@aol.com', '@aol.com', 'bduris@', 'bduris@aol', '<bduris@>']) {
      expect(checkSender({ from, dmarc: 'pass', members }), from).toEqual({
        ok: false,
        reason: 'not_member',
      })
    }
  })

  it('takes builder when active rows for one address disagree on role', () => {
    for (const rows of [
      [
        { email: 'dup@example.com', role: 'maker', display_name: 'Dup' },
        { email: 'dup@example.com', role: 'apprentice' },
      ],
      [
        { email: 'dup@example.com', role: 'apprentice' },
        { email: 'dup@example.com', role: 'maker', display_name: 'Dup' },
      ],
    ]) {
      expect(checkSender({ from: 'dup@example.com', dmarc: 'pass', members: rows })).toMatchObject({
        ok: true,
        from_role: 'builder',
      })
    }
  })
})
