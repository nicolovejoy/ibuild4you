// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { FeedbackWidget } from '../FeedbackWidget'

function mockFetch(response: { ok: boolean; status?: number; json?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 201 : 400),
    json: async () => response.json ?? {},
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('<FeedbackWidget>', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-05-13T12:00:00Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('submits a valid payload to /api/feedback', async () => {
    const fetchMock = mockFetch({ ok: true, status: 201, json: { id: 'fb_1' } })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<FeedbackWidget projectId="bakery-louise" />)

    // Advance past the server's MIN_RENDER_AGE_MS check.
    vi.advanceTimersByTime(3000)

    await user.click(screen.getByRole('button', { name: /idea/i }))
    await user.type(screen.getByPlaceholderText(/what's up/i), 'add gluten-free section')
    await user.type(screen.getByPlaceholderText(/email/i), 'jamie@example.com')
    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      projectId: 'bakery-louise',
      type: 'idea',
      body: 'add gluten-free section',
      submitterEmail: 'jamie@example.com',
      website: '',
    })
    expect(typeof body._ts).toBe('number')

    expect(await screen.findByText(/thanks — got it/i)).toBeInTheDocument()
  })

  it('blocks submit and shows an error when body is empty', async () => {
    const fetchMock = mockFetch({ ok: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<FeedbackWidget projectId="bakery-louise" />)
    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/describe your feedback/i)
  })

  it('shows the server error message when the request fails', async () => {
    mockFetch({ ok: false, status: 429, json: { error: 'Too many submissions' } })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<FeedbackWidget projectId="bakery-louise" />)
    await user.type(screen.getByPlaceholderText(/what's up/i), 'something is broken')
    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many submissions/i)
  })

  it('keeps the honeypot field hidden from assistive tech and tab order', () => {
    const { container } = render(<FeedbackWidget projectId="bakery-louise" />)
    const honeypot = container.querySelector('input[name="website"]')
    expect(honeypot).not.toBeNull()
    expect(honeypot).toHaveAttribute('aria-hidden', 'true')
    expect(honeypot).toHaveAttribute('tabindex', '-1')
  })
})
