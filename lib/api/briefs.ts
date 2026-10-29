import type { BriefContent, BriefSource } from '@/lib/types'

// Upsert a brief: update the existing doc in place (increment version) or
// create a new one. `source` records who produced this version (#194).
export async function upsertBrief(
  db: FirebaseFirestore.Firestore,
  projectId: string,
  briefContent: BriefContent,
  source: BriefSource
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
    const existing = existingDoc.data()
    const currentVersion = (existing.version as number) || 0
    const newVersion = currentVersion + 1

    // #194: archive the outgoing version first so a bad regen or paste can be
    // rolled back from the Brief tab. Keyed by the outgoing version number;
    // no retention cap — briefs are a few KB.
    await existingDoc.ref
      .collection('versions')
      .doc(String(currentVersion))
      .set({
        version: currentVersion,
        content: existing.content ?? null,
        updated_at:
          (existing.updated_at as string | undefined) ??
          (existing.created_at as string | undefined) ??
          now,
        source: (existing.source as BriefSource | undefined) ?? null,
        archived_at: now,
      })

    await existingDoc.ref.update({
      content: briefContent,
      version: newVersion,
      updated_at: now,
      source,
    })

    return {
      id: existingDoc.id,
      project_id: projectId,
      version: newVersion,
      content: briefContent,
      updated_at: now,
      source,
    }
  } else {
    // Create new brief doc
    const docRef = await db.collection('briefs').add({
      project_id: projectId,
      version: 1,
      content: briefContent,
      created_at: now,
      updated_at: now,
      source,
    })

    return {
      id: docRef.id,
      project_id: projectId,
      version: 1,
      content: briefContent,
      created_at: now,
      updated_at: now,
      source,
    }
  }
}
