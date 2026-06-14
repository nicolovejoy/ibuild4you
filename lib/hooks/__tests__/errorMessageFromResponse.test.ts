import { describe, it, expect } from 'vitest'
import { errorMessageFromResponse } from '../chat-error'

// The chat route now always returns a JSON error envelope, but upstream layers
// (gateways, framework crashes, timeouts) can still hand the client a non-JSON
// body. errorMessageFromResponse must never throw on those — it degrades to a
// status-based message instead of masking the failure with a JSON parse error.

function res(body: string, status: number, contentType = 'application/json') {
  return new Response(body, { status, headers: { 'Content-Type': contentType } })
}

describe('errorMessageFromResponse', () => {
  it('returns the error field from a JSON envelope', async () => {
    const msg = await errorMessageFromResponse(res(JSON.stringify({ error: 'Session not found' }), 404))
    expect(msg).toBe('Session not found')
  })

  it('falls back to the status when JSON has no error field', async () => {
    const msg = await errorMessageFromResponse(res(JSON.stringify({ ok: false }), 400))
    expect(msg).toBe('Chat request failed (400)')
  })

  it('does not throw on a non-JSON (HTML) body, degrades to status', async () => {
    const msg = await errorMessageFromResponse(res('<html>500</html>', 500, 'text/html'))
    expect(msg).toBe('Chat request failed (500)')
  })

  it('does not throw on an empty body', async () => {
    const msg = await errorMessageFromResponse(res('', 502))
    expect(msg).toBe('Chat request failed (502)')
  })
})
