// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

// #246: the revealed read key sits in a form a password manager can save from.

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

describe('ReadKeyPanel reveal form', () => {
  it('renders a username field and a masked key field in a form', async () => {
    const { container } = render(<ReadKeyPanel slug="l6-music" />)
    await mintKey()
    const form = container.querySelector('form')!
    expect(form).toBeTruthy()
    const user = screen.getByLabelText('Item name') as HTMLInputElement
    expect(form.contains(user)).toBe(true)
    expect(user.value).toBe('loop-read-key-l6-music')
    expect(user.getAttribute('autocomplete')).toBe('username')
    expect(user.readOnly).toBe(false)
    const key = screen.getByLabelText('Read key') as HTMLInputElement
    expect(form.contains(key)).toBe(true)
    expect(key.type).toBe('password')
    expect(key.getAttribute('autocomplete')).toBe('new-password')
    expect(key.value).toBe('lrk_test_123')
    expect(key.readOnly).toBe(false)
    expect(form.hasAttribute('action')).toBe(false)
  })

  it('never submits: preventDefault, no network call', async () => {
    const { container } = render(<ReadKeyPanel slug="l6-music" />)
    await mintKey()
    const form = container.querySelector('form')!
    const prevented: boolean[] = []
    form.addEventListener('submit', (e) => prevented.push(e.defaultPrevented))
    fireEvent.click(screen.getByRole('button', { name: 'Save to password manager' }))
    const notCancelled = fireEvent.submit(form)
    expect(notCancelled).toBe(false)
    expect(prevented.length).toBeGreaterThan(0)
    expect(prevented.every(Boolean)).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('Copy writes the minted key even after the field was edited', async () => {
    render(<ReadKeyPanel slug="l6-music" />)
    await mintKey()
    fireEvent.change(screen.getByLabelText('Read key'), { target: { value: 'edited' } })
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

  it('revoke removes the form', async () => {
    const { container } = render(<ReadKeyPanel slug="l6-music" />)
    await mintKey()
    revokeMock.mockResolvedValueOnce({})
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(container.querySelector('form')).toBeNull())
  })
})
