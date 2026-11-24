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

// GET answers by path. PUT /api/briefs and PATCH /api/projects answer fixed bodies.
const answers: Record<string, unknown> = {}
const apiFetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const path = url.split('?')[0]
  const method = init?.method ?? 'GET'
  if (path === '/api/briefs' && method === 'PUT') {
    return new Response(JSON.stringify({ version: 4, content: {}, size_warning: null, locks_kept: [] }), { status: 200 })
  }
  if (path === '/api/projects' && method === 'PATCH') return new Response(JSON.stringify({ id: 'p1' }), { status: 200 })
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
  for (const key of Object.keys(answers)) delete answers[key]
  apiFetch.mockClear()
  answers['/api/projects'] = {
    id: 'p1',
    slug: 'cafe',
    title: 'Cafe',
    language: 'en',
    requester_email: 'sam@example.com',
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
async function pasteAndImport() {
  search = ''
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
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
    answers['/api/messages'] = []
    await pasteAndImport()
    expect(await screen.findByText(bannerHas(copy.nextRound.importAppliedToOpen))).toBeTruthy()
    expect(screen.queryByText(bannerHas(copy.nextRound.importAppliesNext))).toBeNull()
  })

  it('says the config applies from the next conversation when none is open', async () => {
    answers['/api/sessions'] = []
    // No maker on the brief, so the header is on Invite and the banner shows.
    answers['/api/projects'] = { ...(answers['/api/projects'] as object), requester_email: undefined }
    await pasteAndImport()
    expect(await screen.findByText(bannerHas(copy.nextRound.importAppliesNext))).toBeTruthy()
    expect(screen.queryByText(bannerHas(copy.nextRound.importAppliedToOpen))).toBeNull()
  })
})

describe('the Start modal', () => {
  it("shows Sam's greeting when the welcome was already used", async () => {
    answers['/api/projects'] = { ...(answers['/api/projects'] as object), welcome_message: 'Hello' }
    answers['/api/sessions'] = [
      { id: 's0', project_id: 'p1', status: 'completed', created_at: T0, welcome_message: 'Hello' },
      { id: 's1', project_id: 'p1', status: 'active', created_at: T1, welcome_message: 'Hello' },
    ]
    answers['/api/messages'] = [userMsg('m1', T2)]
    await renderView()
    fireEvent.click(await screen.findByRole('button', { name: /Start conversation 3/ }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(copy.nextRound.openingKickoff)).toBeTruthy()
    expect(dialog.queryByText('Hello')).toBeNull()
  })
})
