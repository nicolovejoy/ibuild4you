// @vitest-environment jsdom
// The Conversations header's one dispatch button (Nudge or Start), and what the
// builder is told after a paste. Project 5: an import that re-opens the maker's
// old conversation must leave the header on Nudge, not offer Start.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const answers: Record<string, unknown> = {}
const apiFetch = vi.fn(async (url: string) => {
  const path = url.split('?')[0]
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=conversations'),
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
