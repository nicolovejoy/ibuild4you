import { describe, it, expect } from 'vitest'
import { enrichProjects } from '@/lib/api/enrich-projects'
import { getTurnIndicator } from '@/lib/turn-indicator'
import type { Project } from '@/lib/types'
import { remindersStripLine } from '@/lib/builder/conversations-view'

// Tiny stub: every query returns the rows of its collection (sessions) or
// nothing (messages, briefs). Enough for the latest-session field.
function stubDb(sessions: { id: string; status: string; created_at: string }[]) {
  const rows = (name: string) => (name === 'sessions' ? sessions : [])
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

  it('the dashboard badge says waiting on the maker in the re-opened case', async () => {
    const [p] = await enrichProjects(stubDb(sessions), [
      {
        id: 'p1',
        requester_email: 'maya@example.com',
        session_count: 1,
        last_maker_message_at: '2026-10-10T09:00:00.000Z',
        latest_session_created_at: '2026-10-17T12:00:00.000Z',
      },
    ])
    expect(getTurnIndicator(p as unknown as Project, 'builder')?.state).toBe('waiting')
  })
})
