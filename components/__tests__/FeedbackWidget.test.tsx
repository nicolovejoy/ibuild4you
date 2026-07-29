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

    render(<FeedbackWidget projectId="sample-cafe" />)

    // Advance past the server's MIN_RENDER_AGE_MS check.
    vi.advanceTimersByTime(3000)

    await user.click(screen.getByRole('button', { name: /idea/i }))
    await user.type(screen.getByPlaceholderText(/what's up/i), 'add gluten-free section')
    await user.type(screen.getByPlaceholderText(/email/i), 'sam@example.com')
    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      projectId: 'sample-cafe',
      type: 'idea',
      body: 'add gluten-free section',
      submitterEmail: 'sam@example.com',
      website: '',
    })
    expect(typeof body._ts).toBe('number')

    expect(await screen.findByText(/thanks — got it/i)).toBeInTheDocument()
  })

  it('blocks submit and shows an error when body is empty', async () => {
    const fetchMock = mockFetch({ ok: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<FeedbackWidget projectId="sample-cafe" />)
    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/describe your feedback/i)
  })

  it('shows the server error message when the request fails', async () => {
    mockFetch({ ok: false, status: 429, json: { error: 'Too many submissions' } })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<FeedbackWidget projectId="sample-cafe" />)
    await user.type(screen.getByPlaceholderText(/what's up/i), 'something is broken')
    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many submissions/i)
  })

  // #72 slice B1 — the structural snapshot rides along by default, is
  // previewable, and is droppable via the checkbox.
  it('includes a page capture by default, excluding the widget itself', async () => {
    const fetchMock = mockFetch({ ok: true, status: 201, json: { id: 'fb_1' } })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const h1 = document.createElement('h1')
    h1.textContent = 'Host Page Heading'
    document.body.appendChild(h1)
    try {
      render(<FeedbackWidget projectId="sample-cafe" />)
      vi.advanceTimersByTime(3000)
      await user.type(screen.getByPlaceholderText(/what's up/i), 'the header looks off')
      await user.click(screen.getByRole('button', { name: /send feedback/i }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.capture.v).toBe(1)
      expect(body.capture.outline).toContain('h1: Host Page Heading')
      // The widget's own controls must not leak into the capture.
      expect(body.capture.outline).not.toContain('Send feedback')
    } finally {
      h1.remove()
    }
  })

  it('omits the capture when the checkbox is unticked', async () => {
    const fetchMock = mockFetch({ ok: true, status: 201, json: { id: 'fb_1' } })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<FeedbackWidget projectId="sample-cafe" />)
    vi.advanceTimersByTime(3000)
    await user.click(screen.getByRole('checkbox', { name: /snapshot/i }))
    await user.type(screen.getByPlaceholderText(/what's up/i), 'no snapshot please')
    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.capture).toBeUndefined()
  })

  it('keeps the honeypot field hidden from assistive tech and tab order', () => {
    const { container } = render(<FeedbackWidget projectId="sample-cafe" />)
    const honeypot = container.querySelector('input[name="website"]')
    expect(honeypot).not.toBeNull()
    expect(honeypot).toHaveAttribute('aria-hidden', 'true')
    expect(honeypot).toHaveAttribute('tabindex', '-1')
  })

  // #149 — host-app identity relay.
  it('includes identityAssertion in the payload when provided', async () => {
    const fetchMock = mockFetch({ ok: true, status: 201, json: { id: 'fb_1' } })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<FeedbackWidget projectId="sample-cafe" identityAssertion="header.sig" />)
    vi.advanceTimersByTime(3000)
    await user.type(screen.getByPlaceholderText(/what's up/i), 'signed-in feedback')
    await user.click(screen.getByRole('button', { name: /send feedback/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.identityAssertion).toBe('header.sig')
  })

  it('hides the manual email input when identityAssertion is provided', () => {
    render(<FeedbackWidget projectId="sample-cafe" identityAssertion="header.sig" />)
    expect(screen.queryByPlaceholderText(/email/i)).not.toBeInTheDocument()
  })

  it('shows the manual email input when identityAssertion is absent', () => {
    render(<FeedbackWidget projectId="sample-cafe" />)
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument()
  })
})
