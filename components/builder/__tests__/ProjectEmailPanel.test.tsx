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
  recent: { id: string; from_name: string; from_role: 'maker' | 'builder'; received_at: string; subject: string }[]
  dropped: {
    not_member: number
    auth_failed: number
    over_limit: number
    last_at: string | null
    last_auth_failed_from: string | null
  }
}
const noDrops = { not_member: 0, auth_failed: 0, over_limit: 0, last_at: null, last_auth_failed_from: null }
let status: Status
// What GET /api/projects/email-in/message answers: a body and a status.
let message: { body: unknown; status: number }
const apiFetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
  if (url.startsWith('/api/projects/email-in/message')) {
    return new Response(JSON.stringify(message.body), { status: message.status })
  }
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

const baseMessage = {
  id: 'e1',
  from_name: 'Bill Duris',
  from_role: 'maker',
  received_at: '2026-11-20T02:00:00.000Z',
  subject: 'Re: the menu',
  truncated: false,
  repeat: false,
  typed: '',
  quotes: [] as unknown[],
}

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
  message = { body: baseMessage, status: 200 }
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
        { id: 'e1', from_name: 'Bill Duris', from_role: 'maker', received_at: '2026-11-20T02:00:00.000Z', subject: 'Re: the menu' },
        { id: 'e2', from_name: 'Nico', from_role: 'builder', received_at: '2026-11-18T18:00:00.000Z', subject: '' },
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
    // Each row is a button that opens the email; its name is the row text.
    expect(screen.getByRole('button', { name: 'November 19 · Bill Duris (maker) · Re: the menu' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'November 18 · Nico (builder) · (no subject)' })).toBeTruthy()
    expect(screen.queryByText('Nothing received yet.')).toBeNull()
  })

  it('says so when nothing was received', async () => {
    status = { ...status, recent: [] }
    renderPanel()
    expect(await screen.findByText('Nothing received yet.')).toBeTruthy()
  })

  // A sender check that failed fails again on a resend, so the line offers what
  // works instead (F10).
  it('says what the sender check did, with the sender, and what works instead', async () => {
    status = { ...status, dropped: { ...noDrops, auth_failed: 2, last_auth_failed_from: 'bduris@aol.com' } }
    renderPanel()
    expect(
      await screen.findByText(
        '2 emails from bduris@aol.com were not read: the sender check failed for that address. Ask them to paste what they wrote into the conversation.'
      )
    ).toBeTruthy()
    expect(screen.queryByText(/send it again/)).toBeNull()
    expect(screen.queryByText(/DMARC/)).toBeNull()
  })

  it('names no address when the sender was not kept', async () => {
    status = { ...status, dropped: { ...noDrops, auth_failed: 1 } }
    renderPanel()
    expect(
      await screen.findByText(
        '1 email was not read: the sender check failed for the sender’s address. Ask the sender to paste what they wrote into the conversation.'
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
      screen.getByText('3 emails were not read: the project had reached its daily limit and took no more email that day.')
    ).toBeTruthy()
    expect(screen.queryByText(/sender check/)).toBeNull()
    expect(screen.queryByText(/tomorrow/)).toBeNull()
  })

  it('says once, after the dropped lines, when the last one happened (Pacific day)', async () => {
    // 03:00 UTC on Nov 20 is still Nov 19 in Pacific.
    status = {
      ...status,
      dropped: { ...noDrops, not_member: 1, over_limit: 3, last_at: '2026-11-20T03:00:00.000Z' },
    }
    renderPanel()
    const last = await screen.findByText('Last one: November 19.')
    expect(screen.getAllByText(/^Last one:/)).toHaveLength(1)
    const overLimit = screen.getByText(/daily limit/)
    // After the dropped lines in the page.
    expect(overLimit.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows no dropped line when every count is zero', async () => {
    status = { ...status, dropped: { ...noDrops, last_at: '2026-11-20T03:00:00.000Z' } }
    renderPanel()
    await screen.findByLabelText('Project email address')
    expect(screen.queryByText(/ignored|not read/)).toBeNull()
    expect(screen.queryByText(/Last one/)).toBeNull()
  })
})

// A row opens the stored email as the note writer read it, in a modal.
describe('ProjectEmailPanel opening an email', () => {
  const MENU_ROW = 'November 19 · Bill Duris (maker) · Re: the menu'
  const NO_SUBJECT_ROW = 'November 18 · Nico (builder) · (no subject)'

  beforeEach(() => {
    status = {
      address: ADDRESS,
      recent: [
        { id: 'e1', from_name: 'Bill Duris', from_role: 'maker', received_at: '2026-11-20T02:00:00.000Z', subject: 'Re: the menu' },
        { id: 'e/2', from_name: 'Nico', from_role: 'builder', received_at: '2026-11-18T18:00:00.000Z', subject: '' },
      ],
      dropped: noDrops,
    }
  })

  const open = async (row = MENU_ROW) => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: row }))
  }
    const messageCalls = () => apiFetchMock.mock.calls.filter(([url]) => url.startsWith('/api/projects/email-in/message'))

  it('asks for that row\'s email with both ids encoded, and titles the dialog with the subject', async () => {
    await open(NO_SUBJECT_ROW)
    // The row with no subject titles the dialog (no subject).
    expect(await screen.findByRole('heading', { name: '(no subject)' })).toBeTruthy()
    await waitFor(() => expect(messageCalls().length).toBe(1))
    expect(messageCalls()[0][0]).toBe('/api/projects/email-in/message?project_id=p1&email_id=e%2F2')
  })

  it('does not ask for any email until a row is clicked', async () => {
    renderPanel()
    await screen.findByRole('button', { name: MENU_ROW })
    expect(messageCalls()).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the from line, the intro and the subject as the title while it loads', async () => {
    await open()
    expect(screen.getByRole('heading', { name: 'Re: the menu' })).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).toContain('Loading…')
    expect(
      await screen.findByText('This is the email as the note writer read it. Its text never goes into the brief word for word.')
    ).toBeTruthy()
    expect(screen.getByText('November 19 · Bill Duris (maker)')).toBeTruthy()
  })

  it('shows typed text, a quote with context, inside and new lines, each caption once', async () => {
    message = {
      status: 200,
      body: {
        ...baseMessage,
        typed: 'Sounds good.\nSee you Friday.',
        quotes: [
          {
            header: 'On Nov 18, Bill wrote:',
            author: 'member',
            label: 'Bill Duris',
            lines: [
              { text: 'Old line one', kind: 'context', by: null },
              { text: 'Old line two', kind: 'context', by: null },
              { text: '', kind: 'context', by: null },
              { text: 'Old line three', kind: 'context', by: null },
              { text: 'My answer inline', kind: 'inside', by: 'Nico' },
              { text: 'A brand new line', kind: 'new', by: null },
            ],
          },
        ],
      },
    }
    await open()
    expect(await screen.findByText('Typed')).toBeTruthy()
    const typed = screen.getByText(/Sounds good\./)
    expect(typed.textContent).toBe('Sounds good.\nSee you Friday.')
    expect(typed.className).toContain('whitespace-pre-wrap')
    expect(screen.getByText('Quoted, written by Bill Duris')).toBeTruthy()
    expect(screen.getByText('On Nov 18, Bill wrote:')).toBeTruthy()
    // One caption per group: the blank line did not split the context group.
    expect(screen.getAllByText('Already recorded, shown for context')).toHaveLength(1)
    expect(screen.getAllByText('Written inside the quote by Nico')).toHaveLength(1)
    for (const text of ['Old line one', 'Old line two', 'Old line three', 'My answer inline', 'A brand new line']) {
      expect(screen.getByText(text)).toBeTruthy()
    }
    expect(screen.queryByText('Nothing in this email was new: every line was already held.')).toBeNull()
  })

  it('says a repeat was skipped', async () => {
    message = { status: 200, body: { ...baseMessage, repeat: true } }
    await open()
    expect(
      await screen.findByText('This email repeats an earlier one from the same sender, so the note writer skipped it.')
    ).toBeTruthy()
    // A repeat has nothing new by definition; it is not also called "nothing new".
    expect(screen.queryByText(/Nothing in this email was new/)).toBeNull()
  })

  it('says when nothing in the email was new', async () => {
    await open()
    expect(await screen.findByText('Nothing in this email was new: every line was already held.')).toBeTruthy()
    expect(screen.queryByText('Typed')).toBeNull()
  })

  it('says when the end of the email was cut', async () => {
    message = { status: 200, body: { ...baseMessage, typed: 'Hello', truncated: true } }
    await open()
    expect(await screen.findByText('This email was longer than the app keeps. The end of it was cut.')).toBeTruthy()
  })

  it('shows an error when the email cannot be loaded', async () => {
    message = { status: 500, body: {} }
    await open()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Could not load this email.')
  })

  it('closing the dialog removes it', async () => {
    await open()
    await screen.findByText('Nothing in this email was new: every line was already held.')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Re: the menu' })).toBeNull()
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
