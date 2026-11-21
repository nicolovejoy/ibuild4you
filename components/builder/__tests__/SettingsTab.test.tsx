// @vitest-environment jsdom
// The builder Settings tab: sections that fold, controls that save as they
// change (no Save button), and archive and delete at the bottom.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { copy } from '@/lib/copy'
import type { Project } from '@/lib/types'

const t = copy.settings

// Every request, with its parsed body, so a test can read what was saved.
const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = []
let currentUser: { system_roles: string[] }
const apiFetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  calls.push({
    url,
    method: init?.method || 'GET',
    body: init?.body ? JSON.parse(init.body) : null,
  })
  const path = url.split('?')[0]
  if (path === '/api/users/me') return new Response(JSON.stringify(currentUser), { status: 200 })
  if (path.endsWith('/members')) {
    return new Response(
      JSON.stringify({
        members: [
          { id: 'm1', email: 'builder@example.com', display_name: 'Nico', role: 'owner' },
          {
            id: 'm2',
            email: 'maya@example.com',
            display_name: 'Maya',
            role: 'maker',
            brief_role: 'originator',
          },
          {
            id: 'm3',
            email: 'gone@example.com',
            display_name: 'Gone',
            role: 'maker',
            removed_at: '2026-11-01T00:00:00.000Z',
          },
        ],
      }),
      { status: 200 }
    )
  }
  return new Response(JSON.stringify({}), { status: 200 })
})
vi.mock('@/lib/firebase/api-fetch', () => ({
  apiFetch: (...a: [string, { method?: string; body?: string }?]) => apiFetch(...a),
}))
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'builder@example.com' },
    loading: false,
    signOut: vi.fn(),
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { SettingsTab } from '../SettingsTab'

const project = (extra: Partial<Project> = {}) =>
  ({
    id: 'p1',
    slug: 'cafe',
    title: 'Cafe',
    requester_email: 'maya@example.com',
    viewer_role: 'owner',
    language: 'en',
    ...extra,
  }) as Project

const onShare = vi.fn()
const onGoToConversations = vi.fn()

function renderTab(p: Project = project()) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SettingsTab project={p} onShare={onShare} onGoToConversations={onGoToConversations} />
    </QueryClientProvider>
  )
}

// The last PATCH to /api/projects (a settings save), or to the archive route.
const lastSave = () =>
  calls.filter((c) => c.method === 'PATCH' && c.url === '/api/projects').at(-1)?.body
const lastArchive = () => calls.filter((c) => c.url === '/api/projects/archive').at(-1)?.body

beforeEach(() => {
  calls.length = 0
  apiFetch.mockClear()
  onShare.mockClear()
  onGoToConversations.mockClear()
  currentUser = { system_roles: [] }
})
afterEach(cleanup)

describe('Settings tab: sections', () => {
  it('opens People and Sam, folds Connections, and each header carries a summary', async () => {
    renderTab(project({ github_repo: 'owner/cafe', auto_reminders_enabled: true }))

    const people = screen.getByRole('button', { name: new RegExp(t.people.heading) })
    const sam = screen.getByRole('button', { name: new RegExp(`^${t.sam.heading}`) })
    const connections = screen.getByRole('button', { name: new RegExp(t.connections.heading) })
    expect(people.getAttribute('aria-expanded')).toBe('true')
    expect(sam.getAttribute('aria-expanded')).toBe('true')
    expect(connections.getAttribute('aria-expanded')).toBe('false')

    // Two people are on the brief; the removed one is not counted.
    await waitFor(() => expect(people.textContent).toContain(t.people.summary(2)))
    expect(sam.textContent).toContain('English · Default model · reminders on')
    expect(connections.textContent).toContain('owner/cafe')
    expect(screen.queryByLabelText(t.connections.repo)).toBeNull()
  })

  it('folds and unfolds a section from its heading', () => {
    renderTab()
    const sam = screen.getByRole('button', { name: new RegExp(`^${t.sam.heading}`) })
    expect(screen.queryByLabelText(t.sam.language)).not.toBeNull()
    fireEvent.click(sam)
    expect(sam.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText(t.sam.language)).toBeNull()
  })

  it('offers an invite instead of the roster when the brief has no maker yet', () => {
    renderTab(project({ requester_email: undefined }))
    expect(screen.getByText(t.people.empty)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t.people.invite }))
    expect(onShare).toHaveBeenCalledWith('maker')
  })

  it('has no per-round fields and no Save button, and points to Conversations', () => {
    renderTab()
    expect(screen.queryByText(/Opening message/i)).toBeNull()
    expect(screen.queryByText(/Seed questions/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t.sam.nextRoundLink }))
    expect(onGoToConversations).toHaveBeenCalled()
  })
})

describe('Settings tab: each control saves as it changes', () => {
  it('saves the language alone', async () => {
    renderTab()
    fireEvent.change(screen.getByLabelText(t.sam.language), { target: { value: 'fr' } })
    await waitFor(() => expect(lastSave()).toBeTruthy())
    const body = lastSave()!
    expect(body.project_id).toBe('p1')
    expect(body.language).toBe('fr')
    // No other setting rides along, and no per-round field is ever sent.
    for (const key of [
      'model',
      'auto_reminders_enabled',
      'github_repo',
      'welcome_message',
      'seed_questions',
      'session_mode',
    ]) {
      expect(key in body).toBe(false)
    }
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t.saved))
  })

  it('saves a model choice, and Default as null', async () => {
    renderTab(project({ model: 'claude-opus-5-5' }))
    fireEvent.change(screen.getByLabelText(copy.agentModel.label), { target: { value: '' } })
    await waitFor(() => expect(lastSave()).toBeTruthy())
    expect(lastSave()!.model).toBeNull()
  })

  it('saves the reminders switch and shows its status at once', async () => {
    renderTab(project({ latest_session_created_at: new Date().toISOString() }))
    expect(screen.queryByText(t.reminders.sent(0))).toBeNull()
    fireEvent.click(screen.getByLabelText(new RegExp(t.sam.reminders)))
    await waitFor(() => expect(lastSave()?.auto_reminders_enabled).toBe(true))
    expect(screen.getByText(t.reminders.sent(0))).toBeTruthy()
  })

  it('saves the link-preview switch', async () => {
    renderTab()
    fireEvent.click(screen.getByLabelText(new RegExp(t.sam.hideTitle)))
    await waitFor(() => expect(lastSave()?.hide_title_in_previews).toBe(true))
  })

  it('saves the repo when the field loses focus, trimmed, and only when it changed', async () => {
    renderTab(project({ github_repo: 'owner/cafe' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.connections.heading) }))
    const input = screen.getByLabelText(t.connections.repo)

    fireEvent.blur(input)
    expect(lastSave()).toBeUndefined()

    fireEvent.change(input, { target: { value: ' owner/shop ' } })
    expect(lastSave()).toBeUndefined() // typing alone does not save
    fireEvent.blur(input)
    await waitFor(() => expect(lastSave()?.github_repo).toBe('owner/shop'))
  })

  it('clears the repo with an empty string', async () => {
    renderTab(project({ github_repo: 'owner/cafe' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.connections.heading) }))
    const input = screen.getByLabelText(t.connections.repo)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    await waitFor(() => expect(lastSave()?.github_repo).toBe(''))
  })

  it('says so when a save fails', async () => {
    apiFetch.mockImplementationOnce(async () => new Response(JSON.stringify({}), { status: 200 })) // /api/users/me
    renderTab(project({ requester_email: undefined }))
    apiFetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: 'language must be one of: en, fr' }), { status: 400 })
    )
    fireEvent.change(screen.getByLabelText(t.sam.language), { target: { value: 'fr' } })
    expect(await screen.findByText(new RegExp(t.saveFailed))).toBeTruthy()
  })
})

describe('Settings tab: archive and delete', () => {
  it('archives the brief for this viewer, then offers to bring it back', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: t.archive.action }))
    await waitFor(() => expect(lastArchive()).toEqual({ project_id: 'p1', archived: true }))
    expect(screen.getByRole('button', { name: t.archive.undo })).toBeTruthy()
    expect(screen.getByText(t.archive.archivedHelp)).toBeTruthy()
  })

  it('unarchives an archived brief', async () => {
    renderTab(project({ viewer_archived: true }))
    fireEvent.click(screen.getByRole('button', { name: t.archive.undo }))
    await waitFor(() => expect(lastArchive()).toEqual({ project_id: 'p1', archived: false }))
  })

  it('shows Delete to a system admin only, below Archive', async () => {
    renderTab()
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/users/me'))).toBe(true))
    expect(screen.queryByRole('button', { name: t.delete.action })).toBeNull()
    cleanup()

    currentUser = { system_roles: ['admin'] }
    renderTab()
    const del = await screen.findByRole('button', { name: t.delete.action })
    const archive = screen.getByRole('button', { name: t.archive.action })
    // Archive comes first in the document.
    expect(archive.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(del)
    expect(await screen.findByText(/to confirm/)).toBeTruthy()
  })
})
