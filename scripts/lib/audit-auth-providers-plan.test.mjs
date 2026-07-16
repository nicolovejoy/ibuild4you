import { describe, it, expect } from 'vitest'
import { activeMemberEmails, providerFlags } from './audit-auth-providers-plan.mjs'

describe('activeMemberEmails', () => {
  it('dedupes and normalizes across briefs', () => {
    const emails = activeMemberEmails([
      { email: 'Sam@Example.com', removed_at: null },
      { email: 'sam@example.com  ', removed_at: null },
      { email: 'dana@example.com', removed_at: null },
    ])
    expect(emails).toEqual(['dana@example.com', 'sam@example.com'])
  })

  it('excludes removed members', () => {
    const emails = activeMemberEmails([
      { email: 'active@example.com', removed_at: null },
      { email: 'gone@example.com', removed_at: '2026-01-01T00:00:00.000Z' },
    ])
    expect(emails).toEqual(['active@example.com'])
  })

  it('drops empty emails', () => {
    expect(activeMemberEmails([{ email: '', removed_at: null }])).toEqual([])
  })
})

describe('providerFlags', () => {
  it('flags a passcode-only account with no providers', () => {
    expect(providerFlags([])).toEqual({
      password: false,
      google: false,
      none: true,
      status: 'passcode-only',
    })
  })

  it('flags a password-migrated account', () => {
    expect(providerFlags([{ providerId: 'password' }])).toEqual({
      password: true,
      google: false,
      none: false,
      status: 'password',
    })
  })

  it('flags a Google-migrated account', () => {
    expect(providerFlags([{ providerId: 'google.com' }])).toEqual({
      password: false,
      google: true,
      none: false,
      status: 'google',
    })
  })

  it('flags an account with both providers', () => {
    expect(providerFlags([{ providerId: 'password' }, { providerId: 'google.com' }])).toEqual({
      password: true,
      google: true,
      none: false,
      status: 'password + google',
    })
  })

  it('flags no Firebase Auth account at all', () => {
    expect(providerFlags(null)).toEqual({
      password: false,
      google: false,
      none: true,
      status: 'no auth account',
    })
  })
})
