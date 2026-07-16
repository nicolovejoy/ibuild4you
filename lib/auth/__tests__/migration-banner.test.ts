import { describe, it, expect } from 'vitest'
import { hasMigratedCredential, shouldShowMigrationBanner } from '../migration-banner'

describe('hasMigratedCredential', () => {
  it('is false for a passcode-only account (no providers)', () => {
    expect(hasMigratedCredential([])).toBe(false)
  })

  it('is true once a password provider is linked', () => {
    expect(hasMigratedCredential(['password'])).toBe(true)
  })

  it('is true once a Google provider is linked', () => {
    expect(hasMigratedCredential(['google.com'])).toBe(true)
  })

  it('is true for an account with both providers', () => {
    expect(hasMigratedCredential(['password', 'google.com'])).toBe(true)
  })

  it('ignores unrelated provider ids', () => {
    expect(hasMigratedCredential(['phone'])).toBe(false)
  })
})

describe('shouldShowMigrationBanner', () => {
  it('shows for a passcode-only account not yet dismissed', () => {
    expect(shouldShowMigrationBanner([], false)).toBe(true)
  })

  it('hides once dismissed this session, even if still unmigrated', () => {
    expect(shouldShowMigrationBanner([], true)).toBe(false)
  })

  it('hides for a migrated account regardless of dismissal', () => {
    expect(shouldShowMigrationBanner(['password'], false)).toBe(false)
    expect(shouldShowMigrationBanner(['google.com'], true)).toBe(false)
  })
})
