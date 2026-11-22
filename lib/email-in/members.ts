import type { Firestore } from 'firebase-admin/firestore'
import { getUserDisplayName } from '@/lib/api/firebase-server-helpers'
import { normalizeEmail } from '@/lib/email/normalize'
import type { SenderMember } from './sender'

// The project's member rows with display names resolved, as checkSender and
// resolveQuoteAuthor take them. Moved from the inbound webhook route, unchanged,
// so the note writer and the builder's email panel read members the same way.

// The project fields the loader reads: its id, and the requester fields that
// can name a member who has never signed in.
export interface EmailProject {
  id: string
  requester_email: string // normalized, '' when absent
  requester_name: string | null // formatted as getUserDisplayName does
}

// The name of an active member, resolved the way the members route builds
// ProjectMemberSummary.display_name (the rows carry none): their users row,
// else the email's local part. A maker who has never signed in has no users
// row, so before that last fallback the project's requester name is used when
// the member is the requester.
async function memberDisplayName(
  db: Firestore,
  project: EmailProject,
  uid: string,
  email: string
): Promise<string> {
  const name = await getUserDisplayName(db, uid, email)
  // getUserDisplayName gives the local part when nothing names the member.
  const unnamed = name === email.split('@')[0]
  if (
    unnamed &&
    project.requester_name &&
    project.requester_email &&
    normalizeEmail(email) === project.requester_email
  ) {
    return project.requester_name
  }
  return name
}

// The project's member rows, display names resolved. Removed rows are passed
// through, unresolved, so checkSender sees them as removed.
export async function loadSenderMembers(
  db: Firestore,
  project: EmailProject
): Promise<SenderMember[]> {
  const snap = await db.collection('project_members').where('project_id', '==', project.id).get()
  return Promise.all(
    snap.docs.map(async (doc) => {
      const d = doc.data()
      const email = typeof d.email === 'string' ? d.email : ''
      // Any truthy removed_at counts as removed, whatever its type.
      const removed_at = d.removed_at ? String(d.removed_at) : null
      const uid = typeof d.user_id === 'string' ? d.user_id : ''
      return {
        email,
        role: d.role,
        removed_at,
        display_name:
          removed_at || !email ? undefined : await memberDisplayName(db, project, uid, email),
      }
    })
  )
}
