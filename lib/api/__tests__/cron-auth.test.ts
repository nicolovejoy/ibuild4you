import { describe, it, expect, afterEach } from 'vitest'
import { isAuthorizedCron } from '../cron-auth'

// CRON_SECRET must never leak into these tests as real secret material —
// this is a placeholder value, not a credential.
const FAKE_SECRET = 'test-cron-secret-value'

function requestWithAuth(header?: string) {
  return new Request('http://localhost/api/cron/example', {
    headers: header !== undefined ? { Authorization: header } : {},
  })
}

describe('isAuthorizedCron', () => {
  const OLD_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...OLD_ENV }
  })

  // The whole point of this task: previously `if (secret && ...)` short-circuited
  // to "allow" whenever CRON_SECRET was unset, making the route public. This
  // must fail closed instead.
  it('denies when CRON_SECRET is unset, even with a plausible Authorization header', () => {
    delete process.env.CRON_SECRET
    const request = requestWithAuth(`Bearer ${FAKE_SECRET}`)
    expect(isAuthorizedCron(request)).toBe(false)
  })

  it('denies when CRON_SECRET is set to an empty string', () => {
    process.env.CRON_SECRET = ''
    const request = requestWithAuth(`Bearer ${FAKE_SECRET}`)
    expect(isAuthorizedCron(request)).toBe(false)
  })

  it('denies when CRON_SECRET is set but the Authorization header is absent', () => {
    process.env.CRON_SECRET = FAKE_SECRET
    const request = requestWithAuth()
    expect(isAuthorizedCron(request)).toBe(false)
  })

  it('denies when CRON_SECRET is set but the header value is wrong', () => {
    process.env.CRON_SECRET = FAKE_SECRET
    const request = requestWithAuth('Bearer wrong-value')
    expect(isAuthorizedCron(request)).toBe(false)
  })

  it('allows when CRON_SECRET is set and the header is exactly "Bearer <secret>"', () => {
    process.env.CRON_SECRET = FAKE_SECRET
    const request = requestWithAuth(`Bearer ${FAKE_SECRET}`)
    expect(isAuthorizedCron(request)).toBe(true)
  })
})
