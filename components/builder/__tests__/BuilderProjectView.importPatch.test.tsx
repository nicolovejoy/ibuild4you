// @vitest-environment jsdom
// The Brief tab's Import button with a brief_patch payload: what it sends to
// PUT /api/briefs, what it shows for the answers, and the retry after a saved
// brief whose config PATCH failed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { copy } from '@/lib/copy'

// GET answers by path. PUT /api/briefs and PATCH /api/projects are scripted per test.
const answers: Record<string, unknown> = {}
let putBrief: () => Response
let patchProject: () => Response
const apiFetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const path = url.split('?')[0]
  const method = init?.method ?? 'GET'
  if (path === '/api/briefs' && method === 'PUT') return putBrief()
  if (path === '/api/projects' && method === 'PATCH') return patchProject()
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

// Calls to one route and method, with the parsed JSON body.
function callsTo(path: string, method: string) {
  return apiFetch.mock.calls
    .filter(([url, init]) => url.split('?')[0] === path && (init?.method ?? 'GET') === method)
    .map(([, init]) => JSON.parse(init!.body!))
}

const STAMP = { brief_version: 3, note_ids: [], report_ids: [] }
const patchPayload = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    _payload_type: 'next-convo',
    _prep_stamp: STAMP,
    brief_patch: { problem: 'Orders are very slow' },
    ...extra,
  })

async function paste(text: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BuilderProjectView projectId="p1" />
    </QueryClientProvider>
  )
  const box = await screen.findByLabelText(copy.brief.pastePlaceholder)
  fireEvent.change(box, { target: { value: text } })
  return box
}

const importButton = () => screen.getByRole('button', { name: new RegExp(copy.brief.importButton) })

beforeEach(() => {
  for (const key of Object.keys(answers)) delete answers[key]
  apiFetch.mockClear()
  answers['/api/projects'] = { id: 'p1', slug: 'cafe', title: 'Cafe', language: 'en', requester_email: 'sam@example.com', session_mode: 'discover' }
  answers['/api/briefs'] = { version: 3, content: { problem: 'Orders are slow' } }
  answers['/api/briefs/notes'] = { brief_id: 'b1', brief_version: 3, notes: [] }
  answers['/api/sessions'] = []
  answers['/api/build-status'] = { reports: [], latest_posted_at: null }
  putBrief = () => json({ version: 4, content: {}, size_warning: null, locks_kept: [] })
  patchProject = () => json({ id: 'p1' })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Brief tab: import a brief_patch payload', () => {
  it('sends patch and no content, with the prep stamp', async () => {
    await paste(patchPayload())
    // Wait for the project to load so session_mode is known and nothing warns falsely.
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => u.startsWith('/api/projects'))).toBe(true))
    fireEvent.click(importButton())
    await waitFor(() => expect(callsTo('/api/briefs', 'PUT')).toHaveLength(1))
    const body = callsTo('/api/briefs', 'PUT')[0]
    expect(body.patch).toEqual({ problem: 'Orders are very slow' })
    expect('content' in body).toBe(false)
    expect(body.project_id).toBe('p1')
    expect(body.prep_stamp).toEqual(STAMP)
  })

  it('names the locked topics a patch left alone', async () => {
    putBrief = () => json({ version: 4, content: {}, size_warning: null, locks_kept: ['Payments', 'Data source'] })
    await paste(patchPayload())
    fireEvent.click(importButton())
    expect(await screen.findByText('Locked, left as it is: "Payments", "Data source".')).toBeTruthy()
  })

  it('shows the size warning from the response', async () => {
    putBrief = () => json({ version: 4, content: {}, size_warning: 'The server says this brief is too big.', locks_kept: [] })
    await paste(patchPayload())
    fireEvent.click(importButton())
    expect(await screen.findByText('The server says this brief is too big.')).toBeTruthy()
  })

  it('shows what was not imported when drops match nothing', async () => {
    putBrief = () =>
      json(
        { error: 'patch_drop_unmatched', unmatched: { decisions: ['Hosting'], features: [], open_risks: ['Slow wifi'], queued: [] } },
        400
      )
    await paste(patchPayload())
    fireEvent.click(importButton())
    const shown = await screen.findByText(/Not imported: no decision in the brief has the topic "Hosting"\./)
    expect(shown.textContent).toBe(
      'Not imported: no decision in the brief has the topic "Hosting". Not imported: no risk in the brief reads "Slow wifi". If this payload was already imported, the brief is saved: remove "brief_patch" from the JSON to import the rest, and choose Save anyway if asked.'
    )
  })

  it('says a patch needs an existing brief', async () => {
    putBrief = () => json({ error: 'patch_no_brief' }, 400)
    await paste(patchPayload())
    fireEvent.click(importButton())
    expect(await screen.findByText(copy.brief.patchNoBrief)).toBeTruthy()
    expect(copy.brief.patchNoBrief).toBe('This project has no brief yet. The first one must be a whole "brief".')
  })

  it('warns that a patch not made from a prep folded no notes', async () => {
    await paste(JSON.stringify({ brief_patch: { problem: 'x' } }))
    fireEvent.click(importButton())
    expect(await screen.findByText(copy.brief.pasteNotFromPrep)).toBeTruthy()
  })

  it('keeps Save anyway working for a patch after a stale-prep 409', async () => {
    let calls = 0
    putBrief = () => {
      calls += 1
      if (calls === 1) {
        return json({ error: 'stale_prep', unlisted_notes: [{ id: 'n9', created_at: '2026-11-18T10:00:00.000Z' }], live_version: 3, prep_version: 3 }, 409)
      }
      return json({ version: 4, content: {}, size_warning: null, locks_kept: [] })
    }
    await paste(patchPayload())
    fireEvent.click(importButton())
    fireEvent.click(await screen.findByRole('button', { name: copy.brief.saveAnyway }))
    await waitFor(() => expect(callsTo('/api/briefs', 'PUT')).toHaveLength(2))
    const [first, second] = callsTo('/api/briefs', 'PUT')
    expect(first.force).toBeUndefined()
    expect(second.force).toBe(true)
    expect(second.patch).toEqual({ problem: 'Orders are very slow' })
    expect('content' in second).toBe(false)
  })

  it('after a saved brief and a failed config PATCH, Import again sends only the PATCH', async () => {
    // The view logs the failed config PATCH; keep that out of the test output.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let patches = 0
    patchProject = () => {
      patches += 1
      return patches === 1 ? json({ error: 'boom' }, 500) : json({ id: 'p1' })
    }
    await paste(patchPayload({ welcome_message: 'Hello again' }))
    fireEvent.click(importButton())
    expect(await screen.findByText(copy.brief.configSaveFailedBriefSaved)).toBeTruthy()
    expect(copy.brief.configSaveFailedBriefSaved).toBe(
      'The brief is saved, but the rest of the payload was not. Click Import again to retry the rest.'
    )
    expect(callsTo('/api/briefs', 'PUT')).toHaveLength(1)

    fireEvent.click(importButton())
    await waitFor(() => expect(callsTo('/api/projects', 'PATCH')).toHaveLength(2))
    // Still one brief save, and the retry PATCH carries the version the first save made.
    expect(callsTo('/api/briefs', 'PUT')).toHaveLength(1)
    expect(callsTo('/api/projects', 'PATCH')[1]).toMatchObject({ welcome_message: 'Hello again', payload_pasted_version: 4 })
    await waitFor(() => expect(screen.queryByText(copy.brief.configSaveFailedBriefSaved)).toBeNull())
  })

  it('shows the first save\'s lock and size warnings after the retry succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    putBrief = () => json({ version: 4, content: {}, size_warning: 'The server says this brief is too big.', locks_kept: ['T'] })
    let patches = 0
    patchProject = () => {
      patches += 1
      return patches === 1 ? json({ error: 'boom' }, 500) : json({ id: 'p1' })
    }
    await paste(patchPayload({ welcome_message: 'Hello again' }))
    fireEvent.click(importButton())
    await screen.findByText(copy.brief.configSaveFailedBriefSaved)
    // The failed attempt stays on the error; the warnings wait for the retry.
    expect(screen.queryByText('Locked, left as it is: "T".')).toBeNull()

    fireEvent.click(importButton())
    expect(await screen.findByText('Locked, left as it is: "T".')).toBeTruthy()
    expect(screen.getByText('The server says this brief is too big.')).toBeTruthy()
    // Still one brief save: the warnings came from memory, not a second PUT.
    expect(callsTo('/api/briefs', 'PUT')).toHaveLength(1)
  })

  it('forgets the saved brief when the paste text changes', async () => {
    // The view logs the failed config PATCH; keep that out of the test output.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let patches = 0
    patchProject = () => {
      patches += 1
      return patches === 1 ? json({ error: 'boom' }, 500) : json({ id: 'p1' })
    }
    const box = await paste(patchPayload({ welcome_message: 'Hello again' }))
    fireEvent.click(importButton())
    await screen.findByText(copy.brief.configSaveFailedBriefSaved)
    fireEvent.change(box, { target: { value: patchPayload({ welcome_message: 'Hello once more' }) } })
    fireEvent.click(importButton())
    await waitFor(() => expect(callsTo('/api/briefs', 'PUT')).toHaveLength(2))
  })
})

describe('Brief tab: a whole brief paste', () => {
  it('still sends content, and takes its size warning from the response', async () => {
    putBrief = () => json({ version: 4, content: {}, size_warning: 'Too big, says the server.' })
    await paste(JSON.stringify({ _prep_stamp: STAMP, brief: { problem: 'p' } }))
    fireEvent.click(importButton())
    expect(await screen.findByText('Too big, says the server.')).toBeTruthy()
    const body = callsTo('/api/briefs', 'PUT')[0]
    expect(body.content).toEqual({ problem: 'p' })
    expect('patch' in body).toBe(false)
  })
})
