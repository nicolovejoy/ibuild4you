import type { Firestore } from 'firebase-admin/firestore'
import { welcomeToPost } from './welcome'

// Same five fields app/api/sessions/route.ts snapshots onto a new session.
const CONFIG_FIELDS = ['session_mode', 'seed_questions', 'builder_directives', 'welcome_message', 'identity'] as const

// A builder imports a later payload (payload_pasted_at stamped) while a
// conversation is already open. If the maker hasn't answered yet, the canned
// greeting stored at open time is stale: drop it, re-snapshot the new config
// onto the session, clear the "maker is waiting" flags, and post the new
// welcome if it is new for this round (#214).
export async function applyImportToOpenSession(
  db: Firestore,
  projectId: string,
  project: Record<string, unknown>,
  now: string
): Promise<'no_session' | 'maker_replied' | 'applied'> {
  // No orderBy: avoids a composite index; the active session is picked in memory.
  const sessionSnap = await db.collection('sessions').where('project_id', '==', projectId).get()
  const active = sessionSnap.docs
    .filter((d) => d.data().status === 'active')
    .sort((a, b) => String(b.data().created_at).localeCompare(String(a.data().created_at)))[0]
  if (!active) return 'no_session'

  const msgSnap = await db
    .collection('messages')
    .where('session_id', '==', active.id)
    .orderBy('created_at', 'asc')
    .get()
  const messages = msgSnap.docs
  const greetings = messages.filter((d) => d.data().kind === 'unqueued_greeting')
  const lastGreeting = greetings[greetings.length - 1]
  const makerReplied = messages.some(
    (d) =>
      d.data().role === 'user' &&
      (!lastGreeting || String(d.data().created_at) > String(lastGreeting.data().created_at))
  )
  if (makerReplied) return 'maker_replied'

  const batch = db.batch()
  for (const g of greetings) batch.delete(g.ref)

  const sessionUpdate: Record<string, unknown> = {}
  for (const field of CONFIG_FIELDS) {
    if (project[field] !== undefined) sessionUpdate[field] = project[field]
  }
  batch.update(active.ref, {
    ...sessionUpdate,
    last_kickoff_at: null,
    unqueued_notified_at: null,
    updated_at: now,
  })
  batch.update(db.collection('projects').doc(projectId), { maker_waiting_since: null })

  // Archived sessions count as "earlier" too, same as session creation.
  const welcome = welcomeToPost({
    isFirstSession: false,
    welcome: project.welcome_message as string | undefined,
    earlierWelcomes: sessionSnap.docs
      .filter((d) => d.id !== active.id)
      .map((d) => d.data().welcome_message as string | undefined),
  })
  if (welcome) {
    batch.set(db.collection('messages').doc(), {
      session_id: active.id,
      role: 'agent',
      content: welcome,
      created_at: now,
      updated_at: now,
    })
  }

  await batch.commit()
  return 'applied'
}
