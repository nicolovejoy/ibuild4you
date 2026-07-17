import { describe, it, expect } from 'vitest'
import { POST } from '../passcode/route'
import { copy } from '@/lib/copy'

// Garm PR D: passcode login is retired. The route stays (old clients / stale
// login pages may still POST here) but always answers 410 Gone with friendly
// copy pointing at Google / email+password. It must never touch Firestore or
// mint a token — there are no admin-SDK mocks here on purpose: any regression
// that reintroduces a lookup would throw and fail these tests.

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/passcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/passcode (retired — 410 Gone)', () => {
  it('returns 410 with the retirement copy for a well-formed request', async () => {
    const res = await POST(makeRequest({ email: 'test@example.com', passcode: 'ABC123' }))
    expect(res.status).toBe(410)
    const data = await res.json()
    expect(data.error).toBe(copy.auth.passcodeRetired)
  })

  it('returns 410 even for a malformed body (no credential sniffing)', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(410)
  })

  it('returns 410 for a non-JSON body', async () => {
    const res = await POST(
      new Request('http://localhost/api/auth/passcode', { method: 'POST', body: 'not json' })
    )
    expect(res.status).toBe(410)
  })

  it('never returns a token', async () => {
    const res = await POST(makeRequest({ email: 'test@example.com', passcode: 'ABC123' }))
    const data = await res.json()
    expect(data.token).toBeUndefined()
  })
})
