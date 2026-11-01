// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// #245: the owner/builder message box under the open conversation.
const apiFetch = vi.fn()
const streamMessage = vi.fn()
let hookError: string | null = null
vi.mock('@/lib/firebase/api-fetch', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }))
vi.mock('@/lib/hooks/useStreamingChat', () => ({
  useStreamingChat: () => ({
    streamMessage: (...a: unknown[]) => streamMessage(...a),
    streaming: false,
    error: hookError,
    setError: vi.fn(),
  }),
}))

import { ConversationComposer } from '../ConversationComposer'

function renderComposer() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ConversationComposer projectId="p1" sessionId="s1" />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  streamMessage.mockReset()
  hookError = null
  streamMessage.mockResolvedValue(true)
})
afterEach(cleanup)

function type(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Write to the conversation…'), { target: { value: text } })
}

describe('ConversationComposer', () => {
  it('shows a checked "Sam replies" checkbox', () => {
    renderComposer()
    const box = screen.getByLabelText('Sam replies') as HTMLInputElement
    expect(box.checked).toBe(true)
  })

  it('disables Send for whitespace and enables it for text', () => {
    renderComposer()
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    type('   ')
    expect(send.disabled).toBe(true)
    type('hello')
    expect(send.disabled).toBe(false)
  })

  it('checked + Send streams the message', async () => {
    renderComposer()
    type('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(streamMessage).toHaveBeenCalledWith('s1', 'hello'))
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('unchecked + Send posts a note, clears the text and re-checks', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, reply: false }), { status: 201 }))
    renderComposer()
    fireEvent.click(screen.getByLabelText('Sam replies'))
    type('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    const [url, init] = apiFetch.mock.calls[0]
    expect(url).toBe('/api/chat')
    expect(JSON.parse(init.body)).toEqual({ session_id: 's1', content: 'hello', reply: false })
    await waitFor(() =>
      expect((screen.getByPlaceholderText('Write to the conversation…') as HTMLTextAreaElement).value).toBe('')
    )
    expect((screen.getByLabelText('Sam replies') as HTMLInputElement).checked).toBe(true)
  })

  it('a 403 shows the error and keeps the text', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403 }))
    renderComposer()
    fireEvent.click(screen.getByLabelText('Sam replies'))
    type('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Not allowed')
    expect((screen.getByPlaceholderText('Write to the conversation…') as HTMLTextAreaElement).value).toBe('hello')
  })

  it('a failed reply keeps the text and shows the hook error', async () => {
    hookError = 'Chat request failed (500)'
    streamMessage.mockResolvedValue(false)
    renderComposer()
    type('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(streamMessage).toHaveBeenCalled())
    expect(screen.getByText('Chat request failed (500)')).toBeTruthy()
    expect((screen.getByPlaceholderText('Write to the conversation…') as HTMLTextAreaElement).value).toBe('hello')
  })
})
