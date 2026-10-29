// Per-conversation brief notes (#229), stored at briefs/{briefId}/notes.
// A note is a short record of what one conversation changed. Notes stay
// "unfolded" until the builder's curated paste folds them into the brief;
// folded notes are kept with folded_at set, never deleted.

import type { Firestore } from 'firebase-admin/firestore'
import type { BriefNote, PrepStamp } from '@/lib/types'

// Note ids are Firestore auto-ids (alphanumeric) and can arrive from an
// untrusted pasted payload. Whitelist the shape: Firestore's doc() throws
// synchronously on '', '.', '..', '/', '__x__' and over-long ids.
export function isValidNoteId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9]{1,128}$/.test(id)
}

function notesRef(db: Firestore, briefId: string) {
  return db.collection('briefs').doc(briefId).collection('notes')
}

// All notes, oldest first.
export async function listNotes(db: Firestore, briefId: string): Promise<BriefNote[]> {
  const snap = await notesRef(db, briefId).orderBy('created_at', 'asc').get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<BriefNote, 'id'>), id: d.id }))
}

// Filtered in memory: about one note per conversation, so no composite index.
export async function listUnfoldedNotes(db: Firestore, briefId: string): Promise<BriefNote[]> {
  return (await listNotes(db, briefId)).filter((n) => !n.folded_at)
}

// For the chat and kickoff prompts: bonus context, so a read failure (or no
// brief yet) degrades to no notes instead of failing the turn. Logs the
// brief id only, never note content.
export async function fetchUnfoldedNotes(db: Firestore, briefId: string | null): Promise<BriefNote[]> {
  if (!briefId) return []
  try {
    return await listUnfoldedNotes(db, briefId)
  } catch (err) {
    console.error('[brief-notes] unfolded notes read failed for brief', briefId, err)
    return []
  }
}

export async function addNote(
  db: Firestore,
  briefId: string,
  note: Omit<BriefNote, 'id'>
): Promise<string> {
  const ref = await notesRef(db, briefId).add(note)
  return ref.id
}

// Stamp folded_at on each listed id that exists and is still unfolded.
export async function foldNotes(
  db: Firestore,
  briefId: string,
  noteIds: string[],
  now: string
): Promise<void> {
  const ref = notesRef(db, briefId)
  for (const id of noteIds) {
    if (!isValidNoteId(id)) continue
    const snap = await ref.doc(id).get()
    if (!snap.exists) continue
    if ((snap.data() as { folded_at?: string | null }).folded_at) continue
    await ref.doc(id).update({ folded_at: now })
  }
}

export function isEmptyNote(
  n: Pick<BriefNote, 'text' | 'decisions' | 'risks_added' | 'risks_resolved' | 'lock_reversals'>
): boolean {
  return (
    !n.text.trim() &&
    n.decisions.length === 0 &&
    n.risks_added.length === 0 &&
    n.risks_resolved.length === 0 &&
    n.lock_reversals.length === 0
  )
}

// Parse the `_prep_stamp` a prep payload carries back. Null unless well-formed.
export function parsePrepStamp(raw: unknown): PrepStamp | null {
  if (!raw || typeof raw !== 'object') return null
  const { brief_version, note_ids } = raw as Record<string, unknown>
  if (typeof brief_version !== 'number' || !Number.isInteger(brief_version) || brief_version < 0)
    return null
  if (!Array.isArray(note_ids) || !note_ids.every(isValidNoteId)) return null
  return { brief_version, note_ids: note_ids as string[] }
}
