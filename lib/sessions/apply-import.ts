import type { Firestore } from 'firebase-admin/firestore'
import { welcomeToPost } from './welcome'
import { briefModelSnapshot } from '@/lib/agent/model-choices'
import { makerRepliedSinceReopen, reopenPoint, type ReplyCheckMessage } from './maker-replied'

// Same five fields app/api/sessions/route.ts snapshots onto a new session
// (plus agent_model, always written, below).
const CONFIG_FIELDS = ['session_mode', 'seed_questions', 'builder_directives', 'welcome_message', 'identity'] as const

// A builder imports a later payload (payload_pasted_at stamped) while a
// conversation is already open. The import re-opens the conversation when the
// maker has not spoken since its last opening (an import-posted welcome or the
// canned greeting; see maker-replied.ts). Then: drop the stale canned greeting,
// re-snapshot the new config onto the session, clear the "maker is waiting"
// flags, and post the new welcome if it is new for this round (#214). A new
// welcome replaces the unanswered opening instead of following it (Project 5).
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
  const replyRows = messages.map((d) => d.data() as ReplyCheckMessage)
  if (makerRepliedSinceReopen(replyRows)) return 'maker_replied'

  // The welcome the session already opened with (its snapshot, read before we
  // overwrite it) counts as used, so re-importing an unchanged welcome is a no-op.
  // Archived sessions count as "earlier" too, same as session creation.
  const welcome = welcomeToPost({
    isFirstSession: false,
    welcome: project.welcome_message as string | undefined,
    earlierWelcomes: sessionSnap.docs.map((d) => d.data().welcome_message as string | undefined),
  })
  // Also skip a welcome already present as an agent message in this session.
  const alreadyPosted =
    welcome !== null &&
    messages.some(
      (d) => d.data().role === 'agent' && String(d.data().content ?? '').trim() === welcome.trim()
    )
  const toPost = alreadyPosted ? null : welcome

  // Canned greetings go, except one the maker rated (deleting it would leave
  // projects.thumbs_down_count too high). When a new welcome is posted, the unanswered opening
  // goes too: every agent message at or after the opening point (>=, because an
  // earlier import's welcome has created_at equal to its own point). We only get
  // here when the maker has not spoken after that point, so none of these was
  // answered. Agent messages before it (Sam's replies to the maker) stay, and so
  // does a message the maker rated.
  const toDelete = new Map<string, (typeof messages)[number]>()
  for (const g of greetings) {
    if (!g.data().rating) toDelete.set(g.id, g)
  }
  if (toPost) {
    const point = reopenPoint(replyRows)
    for (const d of messages) {
      const m = d.data()
      if (m.role !== 'agent' || m.rating) continue
      if (point === null || String(m.created_at ?? '') >= point) toDelete.set(d.id, d)
    }
  }

  const batch = db.batch()
  for (const d of toDelete.values()) batch.delete(d.ref)

  const sessionUpdate: Record<string, unknown> = {}
  for (const field of CONFIG_FIELDS) {
    if (project[field] !== undefined) sessionUpdate[field] = project[field]
  }
  sessionUpdate.agent_model = briefModelSnapshot(project)
  batch.update(active.ref, {
    ...sessionUpdate,
    // With a welcome posted the conversation is already opened: stamp the kickoff
    // so it declines instead of greeting on top. Otherwise null re-arms it.
    last_kickoff_at: toPost ? now : null,
    unqueued_notified_at: null,
    updated_at: now,
  })
  batch.update(db.collection('projects').doc(projectId), { maker_waiting_since: null })

  if (toPost) {
    batch.set(db.collection('messages').doc(), {
      session_id: active.id,
      role: 'agent',
      kind: 'welcome',
      content: toPost,
      created_at: now,
      updated_at: now,
    })
  }

  await batch.commit()
  return 'applied'
}
