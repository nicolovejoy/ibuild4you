// @vitest-environment jsdom
// The Conversations header's one dispatch button (Nudge or Start), and what the
// builder is told after a paste. Project 5: an import that re-opens the maker's
// old conversation must leave the header on Nudge, not offer Start, and the
// banner and the Start modal must say what will really open the conversation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { copy } from '@/lib/copy'
import { reminderText } from '@/lib/builder/reminder-line'

// GET answers by path. PUT /api/briefs and PATCH /api/projects answer fixed bodies.
const answers: Record<string, unknown> = {}
// When set, GET /api/messages waits for it, so a test can look at the header
// while the messages are still being fetched.
let messagesGate: Promise<void> | null = null
// What PATCH /api/projects says the import did (the real route answers it when
// the request carries payload_pasted_at). null = the import step threw.
let importApplied: 'applied' | 'no_session' | 'maker_replied' | null = 'applied'
const apiFetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const path = url.split('?')[0]
  const method = init?.method ?? 'GET'
  if (path === '/api/briefs' && method === 'PUT') {
    return new Response(JSON.stringify({ version: 4, content: {}, size_warning: null, locks_kept: [] }), { status: 200 })
  }
  if (path === '/api/projects' && method === 'PATCH') {
    const body = JSON.parse(init?.body ?? '{}')
    const answer = 'payload_pasted_at' in body ? { id: 'p1', import_applied: importApplied } : { id: 'p1' }
    return new Response(JSON.stringify(answer), { status: 200 })
  }
  if (path === '/api/projects/p1/email' && method === 'POST') {
    // Like the server: record the reminder on the project the next GET returns.
    answers['/api/projects'] = {
      ...(answers['/api/projects'] as object),
      last_nudged_at: '2026-11-23T22:10:00.000Z', // after the welcome the tests post (T3)
      last_nudged_method: 'email',
      last_nudged_to: ['maya@example.com'],
    }
    return new Response(
      JSON.stringify({ ok: true, results: [], to: ['maya@example.com'], suppressed: false }),
      { status: 200 }
    )
  }
  if (path === '/api/messages' && messagesGate) await messagesGate
  const answer = path in answers ? answers[path] : []
  return new Response(JSON.stringify(answer), { status: 200 })
})
vi.mock('@/lib/firebase/api-fetch', () => ({ apiFetch: (...a: [string]) => apiFetch(...a) }))
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'builder@example.com' }, loading: false, signOut: vi.fn() }),
}))
vi.mock('@/lib/hooks/useRealtimeMessages', () => ({ useRealtimeMessages: () => {} }))
vi.mock('@/components/brief-switcher', () => ({ BriefSwitcher: () => null }))
vi.mock('@/lib/hooks/useEscapeBack', () => ({ useEscapeBack: () => {} }))
// The query string of the page. router.replace updates it, so a successful
// import moves the view from the Brief tab to Conversations as it does for real.
let search = 'tab=conversations'
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (url: string) => {
      search = url.split('?')[1] ?? ''
    },
    push: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(search),
}))

import { BuilderProjectView } from '../BuilderProjectView'

const T0 = '2026-11-20T09:00:00.000Z'
const T1 = '2026-11-20T10:00:00.000Z'
const T2 = '2026-11-20T10:05:00.000Z'
const T3 = '2026-11-23T09:00:00.000Z'
const T4 = '2026-11-23T10:00:00.000Z'

const userMsg = (id: string, created_at: string) => ({ id, session_id: 's1', role: 'user', content: 'Hi', created_at })
const agentMsg = (id: string, created_at: string, kind?: string) => ({
  id,
  session_id: 's1',
  role: 'agent',
  content: 'Round two hello',
  created_at,
  ...(kind ? { kind } : {}),
})

// Renders the view and waits until the open conversation's messages have been
// fetched and applied. Before that the header has no messages and shows Nudge,
// so a test must not look at the button earlier.
async function renderView() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BuilderProjectView projectId="p1" />
    </QueryClientProvider>
  )
  await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/api/messages'))).toBe(true))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

beforeEach(() => {
  search = 'tab=conversations'
  messagesGate = null
  importApplied = 'applied'
  for (const key of Object.keys(answers)) delete answers[key]
  apiFetch.mockClear()
  answers['/api/projects'] = {
    id: 'p1',
    slug: 'cafe',
    title: 'Cafe',
    language: 'en',
    requester_email: 'maya@example.com',
    session_mode: 'discover',
    welcome_message: 'Round two hello',
  }
  answers['/api/briefs'] = { version: 3, content: { problem: 'Orders are slow' } }
  answers['/api/briefs/notes'] = { brief_id: 'b1', brief_version: 3, notes: [] }
  answers['/api/sessions'] = [
    { id: 's1', project_id: 'p1', status: 'active', created_at: T0, welcome_message: 'Round two hello' },
  ]
  answers['/api/build-status'] = { reports: [], latest_posted_at: null }
  answers['/api/projects/p1/members'] = { members: [] }
})
afterEach(() => {
  cleanup()
})

describe('Conversations header: Nudge or Start', () => {
  it('offers Nudge when an import posted a welcome after the maker last spoke', async () => {
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome')]
    await renderView()
    expect(await screen.findByRole('button', { name: /^Nudge/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start conversation 2/ })).toBeNull()
  })

  it('says waiting on the maker, not your turn, beside Nudge after an import-posted welcome', async () => {
    // The project fields say the maker spoke in this conversation (their message
    // is newer than it), but the import re-opened it with a welcome they have not answered.
    answers['/api/projects'] = {
      ...(answers['/api/projects'] as object),
      session_count: 1,
      latest_session_created_at: T0,
      last_maker_message_at: T1,
    }
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome')]
    await renderView()
    expect(await screen.findByRole('button', { name: /^Nudge/ })).toBeTruthy()
    expect(screen.getByText('Waiting on maya')).toBeTruthy()
    expect(screen.queryByText('Your turn')).toBeNull()
  })

  it('offers Start when the maker answered the import-posted welcome', async () => {
    answers['/api/messages'] = [
      userMsg('m1', T1),
      agentMsg('m2', T2),
      agentMsg('m3', T3, 'welcome'),
      userMsg('m4', T4),
    ]
    await renderView()
    expect(await screen.findByRole('button', { name: /Start conversation 2/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Nudge/ })).toBeNull()
  })

  it('offers Start when the maker spoke and no welcome is tagged (unchanged)', async () => {
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2)]
    await renderView()
    expect(await screen.findByRole('button', { name: /Start conversation 2/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Nudge/ })).toBeNull()
  })
})

const STAMP = { brief_version: 3, note_ids: [], report_ids: [] }
const payloadWithWelcome = JSON.stringify({
  _payload_type: 'next-convo',
  _prep_stamp: STAMP,
  brief_patch: { problem: 'Orders are very slow' },
  welcome_message: 'Fresh welcome',
})

// Pastes the payload on the Brief tab and clicks Import.
async function pasteAndImport(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  search = ''
  render(
    <QueryClientProvider client={client}>
      <BuilderProjectView projectId="p1" />
    </QueryClientProvider>
  )
  const box = await screen.findByLabelText(copy.brief.pastePlaceholder)
  fireEvent.change(box, { target: { value: payloadWithWelcome } })
  // Wait for the project to load, so the import knows the session mode.
  await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/api/projects'))).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.brief.importButton) }))
}

// The banner puts its first sentence and the config note in one paragraph.
const bannerHas = (text: string) => (content: string) => content.includes(text)

describe('the banner after a paste', () => {
  it('says the config applies to the open conversation', async () => {
    // An empty conversation: the maker has not spoken, so the config was applied to it.
    answers['/api/messages'] = []
    await pasteAndImport()
    // Wait for the open conversation's messages to load before reading the banner:
    // while they load the banner would say the same thing whatever they hold.
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/api/messages'))).toBe(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(await screen.findByText(bannerHas(copy.nextRound.importAppliedToOpen))).toBeTruthy()
    expect(screen.queryByText(bannerHas(copy.nextRound.importAppliesNext))).toBeNull()
  })

  it('says the config applies to the open conversation after the import posted a welcome the maker has not answered', async () => {
    // The maker spoke earlier; the import posted a tagged welcome after that.
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome')]
    await pasteAndImport()
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/api/messages'))).toBe(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(await screen.findByText(bannerHas(copy.nextRound.importAppliedToOpen))).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Nudge/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start conversation 2/ })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('never opens the Start modal from messages cached before the paste', async () => {
    // Cached before the paste: the maker spoke and the canned greeting followed.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['messages', 's1'], [
      userMsg('m1', T1),
      agentMsg('m2', T2),
      agentMsg('m3', T2, 'unqueued_greeting'),
    ])
    // The server now holds the import-posted welcome, but its answer is slow.
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome')]
    let release: () => void = () => {}
    messagesGate = new Promise<void>((resolve) => {
      release = resolve
    })
    await pasteAndImport(client)
    // Let the view move to Conversations and read the messages query.
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/api/messages'))).toBe(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    // The fetch is still pending: the header must not act on the stale cache.
    expect(screen.queryAllByRole('button', { name: /Start conversation 2/ })).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {
      release()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(await screen.findByRole('button', { name: /^Nudge/ })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says the config applies from the next conversation when the server could not apply the import', async () => {
    // The import step threw: the server answered import_applied null. The
    // messages look unanswered, but the banner believes the server.
    importApplied = null
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome')]
    await pasteAndImport()
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/api/messages'))).toBe(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(await screen.findByText(bannerHas(copy.nextRound.importAppliesNext))).toBeTruthy()
    expect(screen.queryByText(bannerHas(copy.nextRound.importAppliedToOpen))).toBeNull()
  })

  it('keeps Nudge and no dialog when a stale realtime snapshot lands after the import', async () => {
    // Cached before the paste: the maker spoke and the canned greeting followed.
    const stale = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T2, 'unqueued_greeting')]
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['messages', 's1'], stale)
    // The server holds the import-posted welcome.
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome')]
    let release: () => void = () => {}
    messagesGate = new Promise<void>((resolve) => {
      release = resolve
    })
    await pasteAndImport(client)
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/api/messages'))).toBe(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    // A stale snapshot from the realtime listener lands while the fetch is pending.
    await act(async () => {
      client.setQueryData(['messages', 's1'], stale)
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(screen.queryAllByRole('button', { name: /Start conversation 2/ })).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /^Nudge/ })).toBeTruthy()
    await act(async () => {
      release()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    // And again after the fresh messages are in: the stale list arrives late.
    await act(async () => {
      client.setQueryData(['messages', 's1'], stale)
      await new Promise((resolve) => setTimeout(resolve, 1900))
    })
    expect(screen.queryAllByRole('button', { name: /Start conversation 2/ })).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /^Nudge/ })).toBeTruthy()
    expect(screen.getByText(bannerHas(copy.nextRound.importAppliedToOpen))).toBeTruthy()
  })

  it('goes back to the messages once the banner is dismissed', async () => {
    // The server said the import applied, but the messages say the maker answered.
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome'), userMsg('m4', T4)]
    await pasteAndImport()
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/api/messages'))).toBe(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(await screen.findByRole('button', { name: /Start conversation 2/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Nudge/ })).toBeNull()
  })

  it('says the config applies from the next conversation when none is open', async () => {
    importApplied = 'no_session'
    answers['/api/sessions'] = []
    // No maker on the brief, so the header is on Invite and the banner shows.
    answers['/api/projects'] = { ...(answers['/api/projects'] as object), requester_email: undefined }
    await pasteAndImport()
    expect(await screen.findByText(bannerHas(copy.nextRound.importAppliesNext))).toBeTruthy()
    expect(screen.queryByText(bannerHas(copy.nextRound.importAppliedToOpen))).toBeNull()
  })
})

describe('the Start modal', () => {
  it('says the canned note will be posted when the welcome was already used and nothing is queued', async () => {
    answers['/api/projects'] = { ...(answers['/api/projects'] as object), welcome_message: 'Hello' }
    answers['/api/sessions'] = [
      { id: 's0', project_id: 'p1', status: 'completed', created_at: T0, welcome_message: 'Hello' },
      { id: 's1', project_id: 'p1', status: 'active', created_at: T1, welcome_message: 'Hello' },
    ]
    answers['/api/messages'] = [userMsg('m1', T2)]
    await renderView()
    fireEvent.click(await screen.findByRole('button', { name: /Start conversation 3/ }))
    const dialog = within(await screen.findByRole('dialog'))
    // Nothing was pasted since the maker spoke, so the kickoff posts the canned note.
    expect(dialog.getByText(copy.nextRound.openingNothingQueued)).toBeTruthy()
    expect(dialog.queryByText('Hello')).toBeNull()
  })

  it('says Sam greets with the new material when a paste is queued', async () => {
    answers['/api/projects'] = {
      ...(answers['/api/projects'] as object),
      welcome_message: 'Hello',
      payload_pasted_at: T4,
      last_maker_message_at: T2,
    }
    answers['/api/sessions'] = [
      { id: 's0', project_id: 'p1', status: 'completed', created_at: T0, welcome_message: 'Hello' },
      { id: 's1', project_id: 'p1', status: 'active', created_at: T1, welcome_message: 'Hello' },
    ]
    answers['/api/messages'] = [userMsg('m1', T2)]
    await renderView()
    fireEvent.click(await screen.findByRole('button', { name: /Start conversation 3/ }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(copy.nextRound.openingKickoff)).toBeTruthy()
  })
})

// Any of the five reminder sentences. The strip also says "Reminders on ...",
// which this does not match.
const REMINDER_SENTENCE = /No reminder sent|Reminder emailed|Reminder text copied|Automatic reminder|Reminder recorded/

describe('the last reminder on the header', () => {
  const emailedAt = '2026-11-23T22:10:00.000Z'

  it('shows the stored reminder beside Nudge after a reload', async () => {
    answers['/api/projects'] = {
      ...(answers['/api/projects'] as object),
      last_nudged_at: emailedAt,
      last_nudged_method: 'email',
      last_nudged_to: ['maya@example.com'],
    }
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome')]
    await renderView()
    expect(await screen.findByRole('button', { name: /^Nudge/ })).toBeTruthy()
    const line = reminderText({ kind: 'emailed', at: emailedAt, to: ['maya@example.com'] })
    expect(line).toBe('Reminder emailed to maya@example.com, November 23, 2:10 PM.')
    expect(screen.getByText(line)).toBeTruthy()
  })

  it('says no reminder was sent in the Nudge state when none was', async () => {
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome')]
    await renderView()
    expect(await screen.findByText('No reminder sent since the welcome was posted.')).toBeTruthy()
  })

  it('does not show a reminder from before the welcome was posted', async () => {
    answers['/api/projects'] = {
      ...(answers['/api/projects'] as object),
      last_nudged_at: T2,
      last_nudged_method: 'copy',
      last_nudged_to: null,
    }
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome')]
    await renderView()
    expect(await screen.findByText('No reminder sent since the welcome was posted.')).toBeTruthy()
    expect(screen.queryByText(/Reminder text copied/)).toBeNull()
  })

  it('shows nothing about reminders in the Start state when none was sent for this conversation', async () => {
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2)]
    await renderView()
    expect(await screen.findByRole('button', { name: /Start conversation 2/ })).toBeTruthy()
    expect(screen.queryByText(REMINDER_SENTENCE)).toBeNull()
  })

  it('shows a reminder sent for this conversation in the Start state', async () => {
    answers['/api/projects'] = {
      ...(answers['/api/projects'] as object),
      last_nudged_at: emailedAt,
      last_nudged_method: 'copy',
      last_nudged_to: null,
    }
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2)]
    await renderView()
    expect(await screen.findByRole('button', { name: /Start conversation 2/ })).toBeTruthy()
    expect(screen.getByText('Reminder text copied November 23, 2:10 PM. The app did not send it.')).toBeTruthy()
  })

  it('keeps the Nudge button after a reminder is sent', async () => {
    answers['/api/messages'] = [userMsg('m1', T1), agentMsg('m2', T2), agentMsg('m3', T3, 'welcome')]
    await renderView()
    fireEvent.click(await screen.findByRole('button', { name: /^Nudge/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Send reminder/ }))
    await waitFor(() =>
      expect(apiFetch.mock.calls.some(([u, init]) => u === '/api/projects/p1/email' && (init as { method?: string })?.method === 'POST')).toBe(true)
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: /^Nudge/ })).toBeTruthy()
    // The line now says it was emailed, to the address the server reported.
    expect(await screen.findByText(/^Reminder emailed to maya@example\.com, /)).toBeTruthy()
    expect(screen.queryByText(copy.reminderLine.none)).toBeNull()
  })
})
