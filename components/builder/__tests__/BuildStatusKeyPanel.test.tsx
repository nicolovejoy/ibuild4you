// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// The real hooks run against a small fake of /api/build-status/key, so the
// panel's states (no key, minted, revoked) follow the server's answers.

const KEY = 'bsk_TESTKEYTESTKEYTESTKEY12'
let serverHasKey = false
const apiFetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
  const method = init?.method ?? 'GET'
  if (method === 'POST') {
    serverHasKey = true
    return new Response(
      JSON.stringify({ repo: 'nicolovejoy/l6-music', key: KEY, created_at: 't', rotated: false }),
      { status: 201 }
    )
  }
  if (method === 'DELETE') {
    const revoked = serverHasKey
    serverHasKey = false
    return new Response(JSON.stringify({ ok: true, revoked }), { status: 200 })
  }
  return new Response(
    JSON.stringify({
      repo: 'nicolovejoy/l6-music',
      exists: serverHasKey,
      created_at: serverHasKey ? '2026-11-15T20:00:00.000Z' : null,
      last_used_at: null,
    }),
    { status: 200 }
  )
})
vi.mock('@/lib/firebase/api-fetch', () => ({
  apiFetch: (...a: [string, { method?: string }?]) => apiFetchMock(...a),
}))

import { BuildStatusKeyPanel } from '../BuildStatusKeyPanel'

const writeText = vi.fn().mockResolvedValue(undefined)

function renderPanel(props: { githubRepo?: string; isSystemAdmin?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BuildStatusKeyPanel
        projectId="p1"
        githubRepo={'githubRepo' in props ? props.githubRepo : 'nicolovejoy/l6-music'}
        isSystemAdmin={props.isSystemAdmin ?? true}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  serverHasKey = false
  apiFetchMock.mockClear()
  writeText.mockClear()
  vi.stubGlobal('confirm', () => true)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BuildStatusKeyPanel visibility', () => {
  it('renders nothing for a non-admin and asks the server for nothing', () => {
    const { container } = renderPanel({ isSystemAdmin: false })
    expect(container.firstChild).toBeNull()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('renders nothing when the brief has no repo', () => {
    const { container } = renderPanel({ githubRepo: '' })
    expect(container.firstChild).toBeNull()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('shows the set-the-repo line and no Mint button for a bare repo name', () => {
    renderPanel({ githubRepo: 'byside' })
    expect(
      screen.getByText('Set the GitHub repo to owner/name to mint a build status key.')
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mint' })).toBeNull()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })
})

describe('BuildStatusKeyPanel keys', () => {
  it('names the repo and offers Mint when there is no key', async () => {
    renderPanel()
    expect(screen.getByText('Build status key for nicolovejoy/l6-music')).toBeTruthy()
    expect(await screen.findByText('No key yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mint' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('after Mint shows the key in a plain read-only field and the op line without the key', async () => {
    const { container } = renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Mint' }))

    const key = (await screen.findByLabelText('Build status key')) as HTMLInputElement
    expect(key.value).toBe(KEY)
    expect(key.readOnly).toBe(true)
    expect(key.type).toBe('text')
    expect(key.getAttribute('autocomplete')).toBe('off')
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.getByText('Shown once. Minting again stops the old key at once.')).toBeTruthy()

    const op = screen.getByLabelText('1Password command') as HTMLInputElement
    expect(op.readOnly).toBe(true)
    // zsh-safe: no unquoted [...] glob; the key is read at a prompt, never typed in the line.
    expect(op.value).toBe(
      `read -rs "K?Paste key: " && echo && jq -n --arg p "$K" '{title:"ibuild4you-build-status-nicolovejoy-l6-music",category:"PASSWORD",fields:[{id:"password",type:"CONCEALED",purpose:"PASSWORD",value:$p}]}' | op item create --vault dev-secrets --format json | jq -r '.title + " saved in " + .vault.name'; unset K`
    )
    expect(op.value).toContain('ibuild4you-build-status-nicolovejoy-l6-music')
    expect(op.value).toContain('read -rs')
    expect(op.value).not.toContain('password[password]')
    expect(op.value).not.toContain(KEY)
    expect(screen.getByText('Run this, then paste the key at the "Paste key:" prompt.')).toBeTruthy()

    // Once minted the panel offers a new key and Revoke.
    expect(await screen.findByRole('button', { name: 'Mint a new key' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy()
    expect(screen.getByText(/^Minted /)).toBeTruthy()
  })

  it('Copy writes the key, and the second Copy writes the op line', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Mint' }))
    await screen.findByLabelText('Build status key')
    const [copyKey, copyOp] = screen.getAllByRole('button', { name: 'Copy' })
    fireEvent.click(copyKey)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(KEY))
    fireEvent.click(copyOp)
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('op item create'))
    )
  })

  it('Revoke drops the key and goes back to No key yet.', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Mint' }))
    await screen.findByLabelText('Build status key')
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    expect(await screen.findByText('No key yet.')).toBeTruthy()
    expect(screen.queryByLabelText('Build status key')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })
})
