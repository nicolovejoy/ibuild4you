// Canned greeting for a maker who returns when the builder has queued nothing
// new (#214). Not model output: it is stored with kind 'unqueued_greeting'.

import type { Firestore } from 'firebase-admin/firestore'
import { makerCopy } from '../copy-maker'
import type { Locale } from '../locale'
import { normalizeEmail } from '../email/normalize'

export function unqueuedGreeting(language: Locale, builderFirstName: string | null | undefined): string {
  const chat = makerCopy[language].chat
  return chat.nothingQueuedGreeting(builderFirstName?.trim() || chat.builderFallbackName)
}

/** First name of the project's owner (the builder), or null if unknown. */
export async function ownerFirstName(db: Firestore, projectId: string): Promise<string | null> {
  try {
    // No limit(1): an off-boarded owner row (removed_at set) can sort first.
    const members = await db
      .collection('project_members')
      .where('project_id', '==', projectId)
      .where('role', '==', 'owner')
      .get()
    const owner = members.docs.find((d) => !d.data().removed_at)
    const email = owner?.data().email as string | undefined
    if (!email) return null
    const users = await db.collection('users').where('email', '==', normalizeEmail(email)).limit(1).get()
    const first = users.docs[0]?.data().first_name as string | undefined
    return first?.trim() || null
  } catch (err) {
    // Error class only: never the owner's email.
    console.warn('[unqueued-greeting] owner_lookup_failed', (err as Error)?.name)
    return null
  }
}
