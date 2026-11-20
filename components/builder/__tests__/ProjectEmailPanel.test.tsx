// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// The real hooks run against a small fake of /api/projects/email-in, so the
// panel follows the server's answers (no address, then an address after Create).

const ADDRESS = 'musicforge-7k2q@inbox.ibuild4you.com'
type Status = {
  address: string | null
  recent: { from_name: string; from_role: 'maker' | 'builder'; received_at: string; subject: string }[]
  dropped: { not_member: number; auth_failed: number; over_limit: number; last_auth_failed_from: string | null }
}
const noDrops = { not_member: 0, auth_failed: 0, over_limit: 0, last_auth_failed_from: null }
let status: Status
const apiFetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
  if (init?.method === 'POST') {
    status = { ...status, address: ADDRESS }
    return new Response(JSON.stringify({ address: ADDRESS }), { status: 200 })
  }
  return new Response(JSON.stringify(status), { status: 200 })
})
vi.mock('@/lib/firebase/api-fetch', () => ({
  apiFetch: (...a: [string, { method?: string }?]) => apiFetchMock(...a),
}))

import { ProjectEmailPanel, canSeeProjectEmail } from '../ProjectEmailPanel'

const writeText = vi.fn().mockResolvedValue(undefined)

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProjectEmailPanel projectId="p1" />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  status = { address: null, recent: [], dropped: noDrops }
  apiFetchMock.mockClear()
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(cleanup)

describe('ProjectEmailPanel without an address', () => {
  it('shows "No address yet." and a Create button', async () => {
    renderPanel()
    expect(screen.getByText('Project email')).toBeTruthy()
    expect(await screen.findByText('No address yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create project email address' })).toBeTruthy()
    expect(screen.queryByText(/Keep this address on CC/)).toBeNull()
  })

  it('Create posts the project id, then shows the address', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Create project email address' }))
    const field = (await screen.findByLabelText('Project email address')) as HTMLInputElement
    expect(field.value).toBe(ADDRESS)
    const post = apiFetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post?.[0]).toBe('/api/projects/email-in')
    expect(JSON.parse((post?.[1] as { body: string }).body)).toEqual({ project_id: 'p1' })
    expect(screen.queryByRole('button', { name: 'Create project email address' })).toBeNull()
  })
})

describe('ProjectEmailPanel with an address', () => {
  beforeEach(() => {
    status = {
      address: ADDRESS,
      recent: [
        // 02:00 UTC on Nov 20 is still Nov 19 in Pacific.
        { from_name: 'Bill Duris', from_role: 'maker', received_at: '2026-11-20T02:00:00.000Z', subject: 'Re: the menu' },
        { from_name: 'Nico', from_role: 'builder', received_at: '2026-11-18T18:00:00.000Z', subject: '' },
      ],
      dropped: noDrops,
    }
  })

  it('shows the address in a read-only field, Copy writes it, and the how-to line', async () => {
    renderPanel()
    const field = (await screen.findByLabelText('Project email address')) as HTMLInputElement
    expect(field.value).toBe(ADDRESS)
    expect(field.readOnly).toBe(true)
    expect(screen.getByText('Keep this address on CC when you email the maker. It never replies.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDRESS))
    expect(screen.queryByText('No address yet.')).toBeNull()
  })

  it('lists one row per received email with a Pacific day', async () => {
    renderPanel()
    expect(await screen.findByText('Received')).toBeTruthy()
    expect(screen.getByText('November 19 · Bill Duris (maker) · Re: the menu')).toBeTruthy()
    expect(screen.getByText('November 18 · Nico (builder) · (no subject)')).toBeTruthy()
    expect(screen.queryByText('Nothing received yet.')).toBeNull()
  })

  it('says so when nothing was received', async () => {
    status = { ...status, recent: [] }
    renderPanel()
    expect(await screen.findByText('Nothing received yet.')).toBeTruthy()
  })

  it('says what the sender check did, with the sender', async () => {
    status = { ...status, dropped: { ...noDrops, auth_failed: 2, last_auth_failed_from: 'bduris@aol.com' } }
    renderPanel()
    expect(
      await screen.findByText(
        '2 emails from bduris@aol.com failed the sender check and were ignored. Ask them to send it again.'
      )
    ).toBeTruthy()
  })

  it('says what happened to mail from non-members and past the daily limit', async () => {
    status = { ...status, dropped: { ...noDrops, not_member: 1, over_limit: 3 } }
    renderPanel()
    expect(
      await screen.findByText(
        '1 email was ignored because the sender is not on this project. To have their mail read, add them as a member.'
      )
    ).toBeTruthy()
    expect(
      screen.getByText('3 emails were ignored because the project reached its daily limit. Try again tomorrow.')
    ).toBeTruthy()
    expect(screen.queryByText(/sender check/)).toBeNull()
  })

  it('shows no dropped line when every count is zero', async () => {
    renderPanel()
    await screen.findByLabelText('Project email address')
    expect(screen.queryByText(/ignored/)).toBeNull()
  })
})

describe('ProjectEmailPanel on a failed load', () => {
  it('shows the load error', async () => {
    apiFetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    renderPanel()
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the project email address.')
  })
})

// Who sees the panel: the viewers the GET accepts (builder or owner on the
// project, or a system admin, who is an implicit owner). Anyone else would only
// see a load error, so the mount hides the panel before the hook runs.
describe('canSeeProjectEmail', () => {
  it('accepts an owner and a builder', () => {
    expect(canSeeProjectEmail('owner', false)).toBe(true)
    expect(canSeeProjectEmail('builder', false)).toBe(true)
  })
  it('refuses an apprentice, a maker and a viewer with no role', () => {
    expect(canSeeProjectEmail('apprentice', false)).toBe(false)
    expect(canSeeProjectEmail('maker', false)).toBe(false)
    expect(canSeeProjectEmail(null, false)).toBe(false)
    expect(canSeeProjectEmail(undefined, false)).toBe(false)
  })
  it('accepts a system admin whatever the project role', () => {
    expect(canSeeProjectEmail('maker', true)).toBe(true)
    expect(canSeeProjectEmail(null, true)).toBe(true)
    expect(canSeeProjectEmail('admin', false)).toBe(true)
  })
})
