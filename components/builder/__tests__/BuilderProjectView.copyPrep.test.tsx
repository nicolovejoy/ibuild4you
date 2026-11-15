// @vitest-environment jsdom
// The Brief tab's "Copy next-convo prep" button: what it puts on the clipboard
// (reports in the block and the stamp) and what it tells the builder.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { copy } from '@/lib/copy'

// Route each URL to a canned JSON answer; a value of null means "answer 500".
const answers: Record<string, unknown> = {}
const apiFetch = vi.fn(async (url: string) => {
  const path = url.split('?')[0]
  const answer = path in answers ? answers[path] : []
  if (answer === null) return new Response('{}', { status: 500 })
  return new Response(JSON.stringify(answer), { status: 200 })
})
vi.mock('@/lib/firebase/api-fetch', () => ({ apiFetch: (...a: [string]) => apiFetch(...a) }))
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'builder@example.com' }, loading: false, signOut: vi.fn() }),
}))
vi.mock('@/lib/hooks/useRealtimeMessages', () => ({ useRealtimeMessages: () => {} }))
// The switcher lists all briefs from the same URL the project lookup uses; not under test.
vi.mock('@/components/brief-switcher', () => ({ BriefSwitcher: () => null }))
vi.mock('@/lib/hooks/useEscapeBack', () => ({ useEscapeBack: () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { BuilderProjectView } from '../BuilderProjectView'

const writeText = vi.fn()

const report = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  repo: 'nicolovejoy/cafe',
  brief_version_checked: 3,
  posted_at: '2026-11-14T18:00:00.000Z',
  folded_at: null,
  live: [{ what: `Shipped ${id}`, checked: 'opened the page' }],
  merged: [],
  proposed: [],
  questions: [],
  ...extra,
})

function setAnswers({ reports, notes = [] }: { reports: unknown; notes?: unknown[] }) {
  answers['/api/projects'] = { id: 'p1', slug: 'cafe', title: 'Cafe', language: 'en', requester_email: 'sam@example.com' }
  answers['/api/briefs'] = { version: 3, content: { problem: 'Orders are slow' } }
  answers['/api/briefs/notes'] = { brief_id: 'b1', brief_version: 3, notes }
  answers['/api/sessions'] = []
  answers['/api/build-status'] = reports
}

async function clickCopyPrep() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BuilderProjectView projectId="p1" />
    </QueryClientProvider>
  )
  const button = await screen.findByRole('button', { name: new RegExp(copy.brief.copyPrep) })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
}

// The prep's stamp: the JSON inside <prep_stamp>.
function stampOf(prep: string) {
  const match = prep.match(/<prep_stamp>\n([\s\S]*?)\n<\/prep_stamp>/)
  return JSON.parse(match![1])
}

beforeEach(() => {
  for (const key of Object.keys(answers)) delete answers[key]
  apiFetch.mockClear()
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(cleanup)

describe('Brief tab: copy next-convo prep with build reports', () => {
  it('puts two reports in the build_status block and the stamp, and says how many', async () => {
    setAnswers({
      reports: { reports: [report('r1'), report('r2', { posted_at: '2026-11-15T18:00:00.000Z' })], latest_posted_at: '2026-11-15T18:00:00.000Z' },
      notes: [{ id: 'n1', created_at: '2026-11-14T10:00:00.000Z', text: 'A note', decisions: [], risks_added: [], risks_resolved: [], lock_reversals: [] }],
    })
    await clickCopyPrep()
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const prep = writeText.mock.calls[0][0] as string
    expect(prep).toContain('<build_status>')
    expect(prep).toContain('<report id="r1"')
    expect(prep).toContain('<report id="r2"')
    expect(stampOf(prep)).toEqual({ brief_version: 3, note_ids: ['n1'], report_ids: ['r1', 'r2'] })
    expect(await screen.findByText(copy.brief.copyPrepReports(2))).toBeTruthy()
    expect(screen.getByText('Includes 2 build reports from Code.')).toBeTruthy()
  })

  it('lists every unfolded report in the stamp even when the cap leaves some out', async () => {
    // Each report is a bit over 6,000 characters, so only two of three fit the 15,000 cap.
    const long = 'x'.repeat(480)
    const big = (id: string, day: number) =>
      report(id, {
        posted_at: `2026-11-${10 + day}T18:00:00.000Z`,
        live: Array.from({ length: 12 }, (_, i) => ({ what: `${long} ${i}`, checked: 'looked' })),
      })
    setAnswers({
      reports: { reports: [big('r1', 1), big('r2', 2), big('r3', 3)], latest_posted_at: '2026-11-13T18:00:00.000Z' },
    })
    await clickCopyPrep()
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const prep = writeText.mock.calls[0][0] as string
    expect(prep).toContain('1 older report left out for length')
    expect(prep).not.toContain('<report id="r1"')
    expect(stampOf(prep).report_ids).toEqual(['r1', 'r2', 'r3'])
    // No notes here, so the no-new-notes notice comes first in the same message.
    expect(await screen.findByText(new RegExp(copy.brief.copyPrepReports(3)))).toBeTruthy()
  })

  it('uses the singular for one report and shows it after the no-new-notes notice', async () => {
    setAnswers({ reports: { reports: [report('r1')], latest_posted_at: '2026-11-14T18:00:00.000Z' } })
    await clickCopyPrep()
    const notice = await screen.findByText(new RegExp(copy.brief.copyPrepReports(1)))
    // With reports, the prep is not "only the brief as it stands", so the
    // no-new-notes notice drops that clause.
    expect(notice.textContent).toBe(
      'Prep copied. There are no new notes since the brief was last curated. Includes 1 build report from Code.'
    )
    expect(notice.textContent).not.toContain('carries only the brief')
    expect(copy.brief.copyPrepNoNewNotesWithReports).toBe(
      'Prep copied. There are no new notes since the brief was last curated.'
    )
  })

  it('says nothing about reports when there are none, and stamps an empty list', async () => {
    setAnswers({ reports: { reports: [], latest_posted_at: null } })
    await clickCopyPrep()
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const prep = writeText.mock.calls[0][0] as string
    expect(stampOf(prep).report_ids).toEqual([])
    expect(prep).toContain('No new build report since the brief was last curated.')
    const notice = await screen.findByText(copy.brief.copyPrepNoNewNotes)
    expect(notice.textContent).not.toContain('build report')
  })

  it('writes nothing to the clipboard when the reports cannot be loaded', async () => {
    setAnswers({ reports: null })
    await clickCopyPrep()
    expect(await screen.findByText(copy.brief.copyPrepReportsFailed)).toBeTruthy()
    expect(writeText).not.toHaveBeenCalled()
  })
})
