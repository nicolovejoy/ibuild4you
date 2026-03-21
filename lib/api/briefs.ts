import type { BriefContent } from '@/lib/types'

// Upsert a brief: update existing doc in place (increment version) or create new
export async function upsertBrief(
  db: FirebaseFirestore.Firestore,
  projectId: string,
  briefContent: BriefContent
) {
  const now = new Date().toISOString()

  const existingSnap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    // Update existing brief in place, increment version
    const existingDoc = existingSnap.docs[0]
    const currentVersion = (existingDoc.data().version as number) || 0
    const newVersion = currentVersion + 1

    await existingDoc.ref.update({
      content: briefContent,
      version: newVersion,
      updated_at: now,
    })

    return {
      id: existingDoc.id,
      project_id: projectId,
      version: newVersion,
      content: briefContent,
      updated_at: now,
    }
  } else {
    // Create new brief doc
    const docRef = await db.collection('briefs').add({
      project_id: projectId,
      version: 1,
      content: briefContent,
      created_at: now,
      updated_at: now,
    })

    return {
      id: docRef.id,
      project_id: projectId,
      version: 1,
      content: briefContent,
      created_at: now,
      updated_at: now,
    }
  }
}
