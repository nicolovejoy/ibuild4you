import type { Firestore } from 'firebase-admin/firestore'
import { welcomeToPost } from './welcome'
import { briefModelSnapshot } from '@/lib/agent/model-choices'
import { makerRepliedSinceReopen, reopenPoint, type ReplyCheckMessage } from './maker-replied'

// Same five fields app/api/sessions/route.ts snapshots onto a new session
// (plus agent_model, always written, below).
const CONFIG_FIELDS = ['session_mode', 'seed_questions', 'builder_directives', 'welcome_message', 'identity'] as const

// What the import did to the open conversation.
export type ImportOutcome = {
  result: 'no_session' | 'maker_replied' | 'applied'
  // True only when result is 'applied' and a new welcome was posted (kind 'welcome').
  welcomePosted: boolean
}

// A builder imports a later payload (payload_pasted_at stamped) while a
// conversation is already open. The import re-opens the conversation when the
// maker has not spoken since its last opening (an import-posted welcome or the
// canned greeting; see maker-replied.ts). Then: drop the stale canned greeting,
// re-snapshot the new config onto the session, clear the "maker is waiting"
// flags, and post the new welcome if it is new for this round (#214). A new
// welcome replaces the unanswered opening instead of following it (Project 5).
// The import reads and writes in one transaction, so a maker reply or rating
// that lands meanwhile is seen. welcomePosted tells the builder's header whether
// the conversation now opens with a welcome the maker has not answered.
export async function applyImportToOpenSession(
  db: Firestore,
  projectId: string,
  project: Record<string, unknown>,
  now: string
): Promise<ImportOutcome> {
  // One transaction from the first read to the last write: a maker message or
  // a rating that lands while the import runs is either seen (Firestore re-runs
  // this callback with the new state) or waits until the import has committed.
  // The callback may run more than once, so it does nothing outside `tx`.
  return db.runTransaction(async (tx) => {
    // No orderBy: avoids a composite index; the active session is picked in memory.
    const sessionSnap = await tx.get(db.collection('sessions').where('project_id', '==', projectId))
    const active = sessionSnap.docs
      .filter((d) => d.data().status === 'active')
      .sort((a, b) => String(b.data().created_at).localeCompare(String(a.data().created_at)))[0]
    if (!active) return { result: 'no_session', welcomePosted: false }

    const msgSnap = await tx.get(
      db.collection('messages').where('session_id', '==', active.id).orderBy('created_at', 'asc')
    )
    const messages = msgSnap.docs
    const greetings = messages.filter((d) => d.data().kind === 'unqueued_greeting')
    const replyRows = messages.map((d) => d.data() as ReplyCheckMessage)
    if (makerRepliedSinceReopen(replyRows)) return { result: 'maker_replied', welcomePosted: false }

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

    for (const d of toDelete.values()) tx.delete(d.ref)

    const sessionUpdate: Record<string, unknown> = {}
    for (const field of CONFIG_FIELDS) {
      if (project[field] !== undefined) sessionUpdate[field] = project[field]
    }
    sessionUpdate.agent_model = briefModelSnapshot(project)
    tx.update(active.ref, {
      ...sessionUpdate,
      // With a welcome posted the conversation is already opened: stamp the kickoff
      // so it declines instead of greeting on top. Otherwise null re-arms it.
      last_kickoff_at: toPost ? now : null,
      unqueued_notified_at: null,
      updated_at: now,
    })
    const projectUpdate: Record<string, unknown> = { maker_waiting_since: null }
    // A posted welcome starts the automatic-reminder cadence over, as Start does
    // through POST /api/sessions. Otherwise the cron sees a maker message newer
    // than latest_session_created_at and skips with maker_already_responded, so
    // the new welcome would never be reminded. The field name is historical: here
    // it marks when the conversation was re-opened with a new welcome. The
    // dashboard recomputes its own value from the sessions (and keeps this one
    // when it is later), so nothing else reads it differently.
    if (toPost) projectUpdate.latest_session_created_at = now
    tx.update(db.collection('projects').doc(projectId), projectUpdate)

    if (toPost) {
      tx.set(db.collection('messages').doc(), {
        session_id: active.id,
        role: 'agent',
        kind: 'welcome',
        content: toPost,
        created_at: now,
        updated_at: now,
      })
    }

    return { result: 'applied', welcomePosted: toPost !== null }
  })
}
