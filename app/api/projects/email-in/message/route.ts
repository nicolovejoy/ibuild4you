import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { listProjectEmails } from '@/lib/email-in/store'
import { emailProjectOf, loadSenderMembers } from '@/lib/email-in/members'
import { readProjectEmails } from '@/lib/email-in/reading'

// Ids are Firestore document ids and short; anything longer is not one.
const MAX_ID_LENGTH = 200

// A query value that is a non-empty string of a sane length, else null.
function idParam(value: string | null): string | null {
  return value && value.length <= MAX_ID_LENGTH ? value : null
}

// GET /api/projects/email-in/message?project_id=&email_id= — one stored email as
// the note writer read it (builder+): what its sender typed and each quoted
// message with the author the code credited. Never the sender's address, the
// message id, attachments or the raw stored text. Logs nothing: an email's text
// and subject stay out of the logs.
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const params = new URL(request.url).searchParams
  const projectId = idParam(params.get('project_id'))
  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }
  const emailId = idParam(params.get('email_id'))
  if (!emailId) {
    return NextResponse.json({ error: 'email_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const projectDoc = await db.collection('projects').doc(projectId).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // The project's own emails only, so another project's email id is a 404 here,
  // the same as an id that does not exist. What an email shows as new depends
  // on the emails before it and on none after it, so the reading runs over the
  // list, oldest first, up to and including this one. This is the reading the
  // note writer starts from: the writer may then cut a very long email to fit
  // its window, and members are read as they are now, not as they were when
  // the note was written.
  const emails = await listProjectEmails(db, projectId)
  const index = emails.findIndex((e) => e.id === emailId)
  if (index < 0) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 })
  }
  const members = await loadSenderMembers(db, emailProjectOf(projectId, projectDoc.data()))
  const readings = readProjectEmails(emails.slice(0, index + 1), members)
  const reading = readings[readings.length - 1]

  const { email } = reading
  return NextResponse.json({
    id: email.id,
    from_name: email.from_name,
    from_role: email.from_role,
    received_at: email.received_at,
    subject: email.subject,
    truncated: email.truncated,
    repeat: reading.repeat,
    typed: reading.typed,
    quotes: reading.quotes,
  })
}
