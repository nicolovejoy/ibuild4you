import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'

// GET /api/admin/reminders/projects — admin-only list of reminder-eligible
// projects (those with a maker email) plus their auto-reminder toggle state.
// Powers the toggle on /admin/reminders so the admin can flip
// auto_reminders_enabled without opening each brief's Setup tab. The toggle
// itself reuses PATCH /api/projects (admins get implicit owner on all projects).

export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getAdminDb()
  const snap = await db.collection('projects').get()
  const projects = snap.docs
    .map((doc) => {
      const d = doc.data()
      return {
        id: doc.id,
        title: (d.title as string) || '(no title)',
        requester_email: (d.requester_email as string | undefined) || null,
        auto_reminders_enabled: d.auto_reminders_enabled === true,
        reminders_sent_count: (d.reminders_sent_count as number | undefined) ?? 0,
        last_reminder_sent_at: (d.last_reminder_sent_at as string | undefined) || null,
      }
    })
    // Only projects with a maker email can receive reminders.
    .filter((p) => p.requester_email)
    .sort((a, b) => a.title.localeCompare(b.title))

  return NextResponse.json({ projects })
}
