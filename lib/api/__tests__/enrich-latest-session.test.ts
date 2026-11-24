import { describe, it, expect } from 'vitest'
import { enrichProjects } from '@/lib/api/enrich-projects'
import { getTurnIndicator } from '@/lib/turn-indicator'
import type { Project } from '@/lib/types'
import { remindersStripLine } from '@/lib/builder/conversations-view'

// Tiny stub: every query returns the rows of its collection (sessions,
// messages) or nothing (briefs). It ignores filters and limits, so both the
// last-message and the last-maker-message queries get every message row.
function stubDb(
  sessions: { id: string; status: string; created_at: string }[],
  messages: Record<string, unknown>[] = []
) {
  const rows = (name: string): Record<string, unknown>[] =>
    name === 'sessions' ? sessions : name === 'messages' ? messages : []
  const query = (name: string) => {
    const q = {
      where: () => q,
      orderBy: () => q,
      limit: () => q,
      select: () => q,
      async get() {
        const docs = rows(name).map((r) => ({ id: r.id, data: () => r }))
        return { docs, empty: docs.length === 0 }
      },
    }
    return q
  }
  return { collection: (name: string) => query(name) } as unknown as FirebaseFirestore.Firestore
}

const sessions = [{ id: 's1', status: 'active', created_at: '2026-10-10T00:00:00.000Z' }]
const makerMessage = { role: 'user', sender_email: 'maya@example.com', created_at: '2026-10-10T09:00:00.000Z' }

describe('enrichProjects latest_session_created_at', () => {
  it('uses the sessions when the stored value is not later', async () => {
    const [p] = await enrichProjects(stubDb(sessions), [{ id: 'p1', latest_session_created_at: '2026-10-09T00:00:00.000Z' }])
    expect(p.latest_session_created_at).toBe('2026-10-10T00:00:00.000Z')
  })

  it('keeps a later stored value: an import re-opened the conversation with a new welcome', async () => {
    const [p] = await enrichProjects(stubDb(sessions), [{ id: 'p1', latest_session_created_at: '2026-10-17T12:00:00.000Z' }])
    expect(p.latest_session_created_at).toBe('2026-10-17T12:00:00.000Z')
  })

  it('the strip no longer says paused (maker replied) after such a re-opening', () => {
    const base = {
      auto_reminders_enabled: true,
      requester_email: 'maya@example.com',
      last_maker_message_at: '2026-10-10T09:00:00.000Z',
    }
    const now = Date.parse('2026-10-18T00:00:00.000Z')
    expect(remindersStripLine({ ...base, latest_session_created_at: '2026-10-10T00:00:00.000Z' }, now)).toBe(
      'Reminders on · paused (maker replied)'
    )
    expect(remindersStripLine({ ...base, latest_session_created_at: '2026-10-17T12:00:00.000Z' }, now)).not.toContain(
      'paused (maker replied)'
    )
  })

  it('the dashboard badge says waiting on the maker in the re-opened case, and your turn when the stored value is not later', async () => {
    const input = (latest: string) => ({
      id: 'p1',
      requester_email: 'maya@example.com',
      session_count: 1,
      latest_session_created_at: latest,
    })

    // The maker's message (Oct 10, 09:00) is older than the stored re-opening (Oct 17).
    const [reopened] = await enrichProjects(stubDb(sessions, [makerMessage]), [input('2026-10-17T12:00:00.000Z')])
    expect(reopened.last_maker_message_at).toBe('2026-10-10T09:00:00.000Z')
    expect(getTurnIndicator(reopened as unknown as Project, 'builder')?.state).toBe('waiting')

    // Control: the stored value is not later than the session start, so the maker's message counts.
    const [control] = await enrichProjects(stubDb(sessions, [makerMessage]), [input('2026-10-09T00:00:00.000Z')])
    expect(getTurnIndicator(control as unknown as Project, 'builder')?.state).toBe('your_turn')
  })
})
