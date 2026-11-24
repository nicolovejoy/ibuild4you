// One rule for "which membership row is this person's": the active one (#295).
//
// A removed row (removed_at set) stays in project_members for the history, and
// a person can have a removed row next to an active one (an email re-key, an
// alias). So a lookup must never take the first row with limit(1): it reads
// every matching row and picks the active one. The removed row is returned
// apart, for callers that need to say "this person was removed".

import { isActiveMember } from '@/lib/members/lifecycle'

type MemberDoc = FirebaseFirestore.QueryDocumentSnapshot

export interface MemberRows {
  active: MemberDoc | undefined // the row to read and write
  removed: MemberDoc | undefined // a removed row, when there is one
}

/** The project's membership rows matching one field (user_id or email). */
export async function findMemberRows(
  db: FirebaseFirestore.Firestore,
  projectId: string,
  field: 'user_id' | 'email',
  value: string
): Promise<MemberRows> {
  const snap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where(field, '==', value)
    .get()
  return {
    active: snap.docs.find((d) => isActiveMember(d.data())),
    removed: snap.docs.find((d) => !isActiveMember(d.data())),
  }
}

/**
 * The viewer's own rows on a project: by uid first, then by email (a member who
 * has not claimed yet has no user_id). An active row found either way wins over
 * a removed row found the other way.
 */
export async function findViewerMemberRows(
  db: FirebaseFirestore.Firestore,
  projectId: string,
  userId: string,
  email: string
): Promise<MemberRows> {
  const byUid = await findMemberRows(db, projectId, 'user_id', userId)
  if (byUid.active) return byUid
  const byEmail = await findMemberRows(db, projectId, 'email', email)
  return { active: byEmail.active, removed: byUid.removed ?? byEmail.removed }
}
