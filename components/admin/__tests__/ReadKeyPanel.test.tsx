// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

// The revealed read key is shown once. It sits in a plain read-only field with
// password-manager autofill suppressed, so 1Password cannot offer to overwrite
// it with a saved ibuild4you login (supersedes the #246 save-to-1Password form).

const mintMock = vi.fn()
const revokeMock = vi.fn()
vi.mock('@/lib/query/hooks', () => ({
  useAppReadKey: () => ({
    data: { exists: true, created_at: null },
    isLoading: false,
    error: null,
  }),
  useMintAppReadKey: () => ({ mutateAsync: mintMock, isPending: false }),
  useRevokeAppReadKey: () => ({ mutateAsync: revokeMock, isPending: false }),
}))
const apiFetchMock = vi.fn()
vi.mock('@/lib/firebase/api-fetch', () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }))

import { ReadKeyPanel } from '../ReadKeyPanel'

const writeText = vi.fn().mockResolvedValue(undefined)
const fetchSpy = vi.fn()

beforeEach(() => {
  mintMock.mockReset()
  revokeMock.mockReset()
  apiFetchMock.mockReset()
  fetchSpy.mockReset()
  writeText.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
  vi.stubGlobal('confirm', () => true)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function mintKey(key = 'lrk_test_123') {
  mintMock.mockResolvedValueOnce({ key })
  fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))
  await screen.findByLabelText('Read key')
}

describe('ReadKeyPanel reveal', () => {
  it('shows the key in a plain read-only text field outside any form', async () => {
    const { container } = render(<ReadKeyPanel slug="l6-music" />)
    await mintKey()
    const key = screen.getByLabelText('Read key') as HTMLInputElement
    expect(key.value).toBe('lrk_test_123')
    expect(key.readOnly).toBe(true)
    // Not a login-looking form: no <form>, no password field, no username field.
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByLabelText('Item name')).toBeNull()
  })

  it('suppresses password-manager autofill on the key field', async () => {
    render(<ReadKeyPanel slug="l6-music" />)
    await mintKey()
    const key = screen.getByLabelText('Read key') as HTMLInputElement
    expect(key.type).toBe('text')
    expect(key.getAttribute('autocomplete')).toBe('off')
    expect(key.hasAttribute('data-1p-ignore')).toBe(true)
    expect(key.getAttribute('data-lpignore')).toBe('true')
    expect(key.getAttribute('data-form-type')).toBe('other')
    expect(key.getAttribute('name')).not.toMatch(/pass|user|login/i)
  })

  it('makes no network call on its own after minting', async () => {
    render(<ReadKeyPanel slug="l6-music" />)
    await mintKey()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('Copy writes the minted key', async () => {
    render(<ReadKeyPanel slug="l6-music" />)
    await mintKey()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('lrk_test_123'))
  })

  it('a second mint replaces the shown key', async () => {
    render(<ReadKeyPanel slug="l6-music" />)
    await mintKey()
    mintMock.mockResolvedValueOnce({ key: 'lrk_test_456' })
    fireEvent.click(screen.getByRole('button', { name: 'Rotate key' }))
    await waitFor(() =>
      expect((screen.getByLabelText('Read key') as HTMLInputElement).value).toBe('lrk_test_456')
    )
  })

  it('revoke removes the key field', async () => {
    render(<ReadKeyPanel slug="l6-music" />)
    await mintKey()
    revokeMock.mockResolvedValueOnce({})
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(screen.queryByLabelText('Read key')).toBeNull())
  })
})
