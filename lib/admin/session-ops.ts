// Pure planners for the admin Brief-doctor curated operations (#105).
//
// No Firestore here: each planner takes the current session set (with per-session
// message counts the route has already counted) plus a `now` timestamp, and
// returns the writes to apply — or an { error } the route surfaces as a 400.
// The route applies sessionUpdates + projectPatch in a batch, inserts any
// messageInserts, and writes the audit row to `admin_actions`.
//
// Guarantees mirrored from scripts/fix-reopen-conversation.mjs:
//   - NON-DESTRUCTIVE: sessions are archived (status:'archived' + archived_at),
//     never deleted. Archiving a session WITH messages needs an explicit confirm.
//   - Denormalized counters (session_count, latest_session_created_at) are always
//     recomputed from the surviving (non-archived) set.

export interface PlannerSession {
  id: string
  status: string
  created_at: string
  messageCount: number
}

interface SessionUpdate {
  id: string
  patch: Record<string, unknown>
}

interface ProjectPatch {
  session_count: number
  latest_session_created_at: string | null
  updated_at: string
}

interface MessageInsert {
  session_id: string
  role: 'user' | 'agent'
  content: string
  created_at: string
  updated_at: string
}

export interface Plan {
  sessionUpdates: SessionUpdate[]
  projectPatch?: ProjectPatch // omitted when an op doesn't touch denormalized counters
  messageInserts: MessageInsert[]
  audit: Record<string, unknown>
}

type PlanResult = Plan | { error: string }

const archivePatch = (now: string) => ({ status: 'archived', archived_at: now, updated_at: now })

/** session_count + latest_session_created_at over the surviving session set. */
export function recomputeCounters(
  survivors: Array<{ id: string; created_at: string }>
): { session_count: number; latest_session_created_at: string | null } {
  const latest = survivors
    .map((s) => String(s.created_at))
    .sort()
    .at(-1)
  return { session_count: survivors.length, latest_session_created_at: latest ?? null }
}

function counterPatch(survivors: PlannerSession[], now: string): ProjectPatch {
  return { ...recomputeCounters(survivors), updated_at: now }
}

/**
 * Reopen a prior conversation: reactivate `reopenId`, optionally archive a
 * displaced empty session `archiveId`, recompute counters over survivors.
 */
export function planReopen({
  sessions,
  reopenId,
  archiveId,
  now,
}: {
  sessions: PlannerSession[]
  reopenId: string
  archiveId?: string
  now: string
}): PlanResult {
  const reopen = sessions.find((s) => s.id === reopenId)
  if (!reopen) return { error: `Reopen target ${reopenId} not found in this brief.` }

  const sessionUpdates: SessionUpdate[] = [{ id: reopenId, patch: { status: 'active', updated_at: now } }]

  if (archiveId) {
    const archive = sessions.find((s) => s.id === archiveId)
    if (!archive) return { error: `Archive target ${archiveId} not found in this brief.` }
    if (archive.messageCount > 0) {
      return { error: `Refusing: session ${archiveId} has ${archive.messageCount} messages. Reopen archives only an empty displaced session.` }
    }
    sessionUpdates.push({ id: archiveId, patch: archivePatch(now) })
  }

  const survivors = sessions.filter((s) => s.id !== archiveId)
  return {
    sessionUpdates,
    projectPatch: counterPatch(survivors, now),
    messageInserts: [],
    audit: {
      action: 'reopen_conversation',
      reopened_session_id: reopenId,
      archived_session_id: archiveId ?? null,
    },
  }
}

/**
 * Archive one conversation. Empty sessions archive freely; a session WITH
 * messages requires `typedConfirm` to equal the brief title (typed confirm).
 */
export function planArchive({
  sessions,
  sessionId,
  briefTitle,
  typedConfirm,
  now,
}: {
  sessions: PlannerSession[]
  sessionId: string
  briefTitle: string
  typedConfirm?: string
  now: string
}): PlanResult {
  const target = sessions.find((s) => s.id === sessionId)
  if (!target) return { error: `Session ${sessionId} not found in this brief.` }

  const hadMessages = target.messageCount > 0
  if (hadMessages && typedConfirm !== briefTitle) {
    return { error: `This conversation has ${target.messageCount} messages. To archive it, type the brief title to confirm.` }
  }

  const survivors = sessions.filter((s) => s.id !== sessionId)
  return {
    sessionUpdates: [{ id: sessionId, patch: archivePatch(now) }],
    projectPatch: counterPatch(survivors, now),
    messageInserts: [],
    audit: { action: 'archive_conversation', archived_session_id: sessionId, had_messages: hadMessages },
  }
}

/**
 * Testing reset: archive ALL (non-archived) sessions — reversible, never
 * deleted — leaving the brief with zero active conversations. The next session
 * the maker/agent opens is fresh.
 */
export function planResetToFresh({ sessions, now }: { sessions: PlannerSession[]; now: string }): Plan {
  const toArchive = sessions.filter((s) => s.status !== 'archived')
  return {
    sessionUpdates: toArchive.map((s) => ({ id: s.id, patch: archivePatch(now) })),
    projectPatch: { session_count: 0, latest_session_created_at: null, updated_at: now },
    messageInserts: [],
    audit: { action: 'reset_to_fresh', archived_session_ids: toArchive.map((s) => s.id) },
  }
}

/**
 * Testing helper: insert a synthetic message to flip turn-state (kickoff /
 * waiting-on-maker / reminder logic all read the message stream). Additive and
 * non-destructive.
 */
export function planAddSyntheticMessage({
  session,
  role,
  content,
  now,
}: {
  session: PlannerSession
  role: 'user' | 'agent'
  content: string
  now: string
}): PlanResult {
  if (role !== 'user' && role !== 'agent') return { error: `Invalid role "${role}" — must be user or agent.` }
  if (!content || !content.trim()) return { error: 'Message content must not be empty.' }

  return {
    sessionUpdates: [],
    messageInserts: [{ session_id: session.id, role, content, created_at: now, updated_at: now }],
    audit: { action: 'add_synthetic_message', session_id: session.id, role },
  }
}
