// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { FeedbackInbox } from '../FeedbackInbox'
import { copy } from '@/lib/copy'

const apiFetch = vi.fn()
vi.mock('@/lib/firebase/api-fetch', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }))
vi.mock('@/lib/query/hooks', () => ({ useApps: () => ({ data: [] }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  project_id: 'app',
  type: 'bug',
  body: `body ${id}`,
  status: 'new',
  submitter_email: null,
  created_at: '2026-11-01T00:00:00.000Z',
  ...extra,
})

let lists: unknown[][]
let failIds: Set<string>

const json = (data: unknown, ok = true) => ({ ok, json: async () => data })

beforeEach(() => {
  failIds = new Set()
  lists = [[row('a'), row('b')]]
  apiFetch.mockReset()
  apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url.includes('/replies')) return json([])
    const m = url.match(/^\/api\/admin\/feedback\/([^/?]+)$/)
    if (m && init?.method) return failIds.has(m[1]) ? json({ error: 'no' }, false) : json({})
    const next = lists.length > 1 ? lists.shift()! : lists[0]
    return json(next)
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const listCalls = () =>
  apiFetch.mock.calls.filter(
    (c) => typeof c[0] === 'string' && c[0].startsWith('/api/admin/feedback?') || c[0] === '/api/admin/feedback'
  )
const mutations = (method: string) =>
  apiFetch.mock.calls.filter((c) => c[1]?.method === method)

async function selectBoth() {
  const boxes = await screen.findAllByRole('checkbox', { name: copy.adminFeedback.selectRow })
  fireEvent.click(boxes[0])
  fireEvent.click(boxes[1])
}

describe('FeedbackInbox bulk actions', () => {
  it('checking two rows shows the count and Archive selected', async () => {
    render(<FeedbackInbox />)
    await selectBoth()
    expect(screen.getByText('2 selected')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archive selected' })).toBeTruthy()
  })

  it('Delete selected is hidden unless canDelete', async () => {
    const { unmount } = render(<FeedbackInbox />)
    await selectBoth()
    expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull()
    unmount()
    render(<FeedbackInbox canDelete />)
    await selectBoth()
    expect(screen.getByRole('button', { name: 'Delete selected' })).toBeTruthy()
  })

  it('Select all shown selects every row', async () => {
    render(<FeedbackInbox />)
    await screen.findAllByRole('checkbox', { name: 'Select' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown' }))
    expect(screen.getByText('2 selected')).toBeTruthy()
  })

  it('Archive selected PATCHes each id then refetches', async () => {
    render(<FeedbackInbox />)
    await selectBoth()
    const before = listCalls().length
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before))
    const patches = mutations('PATCH')
    expect(patches.map((c) => c[0]).sort()).toEqual(['/api/admin/feedback/a', '/api/admin/feedback/b'])
    expect(patches.every((c) => c[1].body === JSON.stringify({ archived: true }))).toBe(true)
  })

  it('Delete asks first and sends nothing when cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<FeedbackInbox canDelete />)
    await selectBoth()
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    expect(confirm).toHaveBeenCalledWith(copy.adminFeedback.confirmDelete(2))
    expect(mutations('DELETE')).toHaveLength(0)
  })

  it('Delete sends one DELETE per id when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<FeedbackInbox canDelete />)
    await selectBoth()
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    await waitFor(() => expect(mutations('DELETE')).toHaveLength(2))
  })

  it('Show archived refetches with include_archived, badges rows, offers Unarchive', async () => {
    lists = [[row('a')], [row('a'), row('z', { archived_at: '2026-11-02T00:00:00.000Z' })]]
    render(<FeedbackInbox />)
    await screen.findByText('body a')
    expect(screen.queryByText('Archived')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await screen.findByText('body z')
    expect(listCalls().some((c) => String(c[0]).includes('include_archived=1'))).toBe(true)
    expect(screen.getByText('Archived')).toBeTruthy()
    const boxes = screen.getAllByRole('checkbox', { name: 'Select' })
    fireEvent.click(boxes[1])
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive selected' }))
    await waitFor(() => expect(mutations('PATCH')).toHaveLength(1))
    expect(mutations('PATCH')[0][1].body).toBe(JSON.stringify({ archived: false }))
  })

  it('a partial failure shows bulkFailed and still refetches', async () => {
    failIds = new Set(['b'])
    render(<FeedbackInbox />)
    await selectBoth()
    const before = listCalls().length
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    await screen.findByText('1 of 2 could not be changed.')
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before))
  })
})
