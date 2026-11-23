// @vitest-environment jsdom
// The Brief tab's "Write note now" button: when the writer finds nothing
// relevant it writes no note (note_id null), and the builder is told so
// instead of the dialog closing as if a note had been written (#276).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { copy } from '@/lib/copy'

const answers: Record<string, unknown> = {}
let postNote: () => Response
const apiFetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const path = url.split('?')[0]
  const method = init?.method ?? 'GET'
  if (path === '/api/briefs/notes' && method === 'POST') return postNote()
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
  useSearchParams: () => new URLSearchParams(),
}))

import { BuilderProjectView } from '../BuilderProjectView'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

async function openWriteNoteDialog() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BuilderProjectView projectId="p1" />
    </QueryClientProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: copy.brief.writeNoteNow }))
  return screen.findByRole('button', { name: copy.brief.writeNoteSubmit })
}

beforeEach(() => {
  for (const key of Object.keys(answers)) delete answers[key]
  apiFetch.mockClear()
  answers['/api/projects'] = { id: 'p1', slug: 'cafe', title: 'Cafe', language: 'en', requester_email: 'sam@example.com', session_mode: 'discover' }
  answers['/api/briefs'] = { version: 3, content: { problem: 'Orders are slow' } }
  answers['/api/briefs/notes'] = { brief_id: 'b1', brief_version: 3, notes: [] }
  answers['/api/sessions'] = []
  answers['/api/build-status'] = { reports: [], latest_posted_at: null }
  postNote = () => json({ note_id: 'n1', covered: 2, through: '2026-11-23T10:00:00.000Z' })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Brief tab: Write note now', () => {
  it('says no note was written when the writer found nothing relevant', async () => {
    postNote = () => json({ note_id: null, covered: 1, through: '2026-11-23T10:00:00.000Z' })
    fireEvent.click(await openWriteNoteDialog())
    expect(await screen.findByText(copy.brief.writeNoteNothingRelevant)).toBeTruthy()
    expect(copy.brief.writeNoteNothingRelevant).toBe(
      'Nothing relevant to the brief was said since the last note, so no note was written.'
    )
    // The dialog stays open: it did not close as if a note had been written.
    expect(screen.queryByRole('button', { name: copy.brief.writeNoteSubmit })).toBeTruthy()
  })

  it('closes the dialog without a notice when a note was written', async () => {
    fireEvent.click(await openWriteNoteDialog())
    await waitFor(() => expect(screen.queryByRole('button', { name: copy.brief.writeNoteSubmit })).toBeNull())
    expect(screen.queryByText(copy.brief.writeNoteNothingRelevant)).toBeNull()
  })

  it('clears the notice when the dialog is opened again', async () => {
    postNote = () => json({ note_id: null, covered: 1, through: '2026-11-23T10:00:00.000Z' })
    fireEvent.click(await openWriteNoteDialog())
    await screen.findByText(copy.brief.writeNoteNothingRelevant)
    fireEvent.click(screen.getByRole('button', { name: copy.brief.writeNoteCancel }))
    await waitFor(() => expect(screen.queryByText(copy.brief.writeNoteNothingRelevant)).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: copy.brief.writeNoteNow }))
    await screen.findByRole('button', { name: copy.brief.writeNoteSubmit })
    expect(screen.queryByText(copy.brief.writeNoteNothingRelevant)).toBeNull()
  })
})
