// Per-conversation note writer (#229). Replaces the whole-brief regen: after a
// conversation goes idle, the model writes a short note of what the new
// messages added or changed, stored at briefs/{briefId}/notes. The brief itself
// is left alone, except for one automatic edit: an explicitly confirmed
// reversal of a locked decision marks that decision `contested` (#197) so the
// Contested badge and Sam's "don't reopen" behaviour don't wait for a paste.
//
// Where it starts: projects.notes_through_at (created_at of the newest message
// a note has covered), else the live brief's updated_at (the old regen already
// covered everything before it), else the very beginning.

import Anthropic from '@anthropic-ai/sdk'
import type { BriefContent, BriefDecision, BriefNote, BriefNoteLockReversal } from '@/lib/types'
import { BRIEF_MODEL, BRIEF_TEMPERATURE, NOTE_MAX_TOKENS } from '@/lib/agent/constants'
import { NOTE_SYSTEM_PROMPT, buildNoteUserContent } from '@/lib/agent/note-prompt'
import { logAnthropicCall } from '@/lib/observability/anthropic'
import { addNote, isEmptyNote } from '@/lib/api/brief-notes'
import { upsertBrief } from '@/lib/api/briefs'
import { contestFor, normalizeDecisionText, topicKey } from '@/lib/api/brief-merge'
import { normalizeRisks } from '@/lib/brief/risks'
import { isArchivedSession } from '@/lib/sessions/active'

// How many messages before the first new one go in as continuity context.
const EARLIER_CONTEXT_COUNT = 6

export const EMPTY_BRIEF: BriefContent = {
  problem: '',
  target_users: '',
  features: [],
  constraints: '',
  additional_context: '',
  decisions: [],
  open_risks: [],
}

// Tools are part of the cached prefix (tools → system), so changing this
// schema invalidates the system-prompt cache. Don't tweak casually.
const WRITE_NOTE_TOOL = {
  name: 'write_note',
  description:
    'Save a short note of what this conversation added or changed relative to the brief.',
  input_schema: {
    type: 'object' as const,
    properties: {
      text: { type: 'string' },
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { topic: { type: 'string' }, decision: { type: 'string' } },
          required: ['topic', 'decision'],
        },
      },
      risks_added: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            owner: { type: 'string', enum: ['maker', 'builder'] },
          },
          required: ['text'],
        },
      },
      risks_resolved: { type: 'array', items: { type: 'string' } },
      lock_reversals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            proposed: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['topic', 'proposed', 'reason'],
        },
      },
    },
    required: ['text', 'decisions', 'risks_added', 'risks_resolved', 'lock_reversals'],
  },
}

type Msg = { role: string; content: string; created_at: string; session_id: string }

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

// Coerce the model's tool input into a note body. Anything malformed is dropped.
function coerceNote(raw: Record<string, unknown>) {
  const decisions = Array.isArray(raw.decisions)
    ? raw.decisions
        .filter(
          (d): d is { topic: string; decision: string } =>
            !!d &&
            nonEmpty((d as Record<string, unknown>).topic) &&
            nonEmpty((d as Record<string, unknown>).decision)
        )
        .map((d) => ({ topic: d.topic.trim(), decision: d.decision.trim() }))
    : []
  const risks_resolved = Array.isArray(raw.risks_resolved)
    ? raw.risks_resolved.filter(nonEmpty).map((s) => s.trim())
    : []
  const lock_reversals: BriefNoteLockReversal[] = Array.isArray(raw.lock_reversals)
    ? raw.lock_reversals
        .filter((r): r is BriefNoteLockReversal => {
          const o = r as Record<string, unknown>
          return !!o && nonEmpty(o.topic) && nonEmpty(o.proposed) && nonEmpty(o.reason)
        })
        .map((r) => ({
          topic: r.topic.trim(),
          proposed: r.proposed.trim(),
          reason: r.reason.trim(),
        }))
    : []
  return {
    text: typeof raw.text === 'string' ? raw.text.trim() : '',
    decisions,
    risks_added: normalizeRisks(raw.risks_added),
    risks_resolved,
    lock_reversals,
  }
}

// Apply lock reversals to the live decisions: set `contested` on a matching
// locked decision, unless the builder already dismissed the same proposal or
// it proposes the current text. Returns null when nothing changed.
function applyLockReversals(
  decisions: BriefDecision[],
  reversals: BriefNoteLockReversal[]
): BriefDecision[] | null {
  let changed = false
  const out = decisions.map((d) => {
    if (!d.locked) return d
    const r = reversals.find((x) => x.topic.trim().toLowerCase() === topicKey(d))
    if (!r) return d
    const proposed = normalizeDecisionText(r.proposed)
    if (d.contest_dismissed && normalizeDecisionText(d.contest_dismissed.proposed) === proposed)
      return d
    if (normalizeDecisionText(d.decision) === proposed) return d
    const contested = contestFor(true, { proposed: r.proposed, reason: r.reason })
    if (!contested) return d
    if (
      d.contested &&
      d.contested.proposed === contested.proposed &&
      d.contested.reason === contested.reason
    )
      return d
    changed = true
    return { ...d, contested }
  })
  return changed ? out : null
}

export async function writeNoteForProject(
  db: FirebaseFirestore.Firestore,
  projectId: string
): Promise<{ note_id: string | null; covered: number; through: string }> {
  const projectRef = db.collection('projects').doc(projectId)
  const projectSnap = await projectRef.get()
  const notesThroughAt = projectSnap.data()?.notes_through_at as string | null | undefined

  const briefSnap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()
  const briefDoc = briefSnap.empty ? null : briefSnap.docs[0]
  const start: string | null =
    notesThroughAt || ((briefDoc?.data().updated_at as string | undefined) ?? null)

  // Every message on the project, across all sessions, oldest first.
  const sessionsSnap = await db
    .collection('sessions')
    .where('project_id', '==', projectId)
    .orderBy('created_at', 'asc')
    .get()
  const sessionOrder = new Map<string, number>()
  const archived = new Set<string>()
  const all: Msg[] = []
  sessionsSnap.docs.forEach((s, i) => {
    sessionOrder.set(s.id, i)
    if (isArchivedSession(s.data())) archived.add(s.id)
  })
  for (const s of sessionsSnap.docs) {
    const msgSnap = await db
      .collection('messages')
      .where('session_id', '==', s.id)
      .orderBy('created_at', 'asc')
      .get()
    for (const m of msgSnap.docs) {
      const d = m.data()
      all.push({
        role: d.role as string,
        content: d.content as string,
        created_at: (d.created_at as string) ?? '',
        session_id: s.id,
      })
    }
  }
  all.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))

  const firstNew = start === null ? 0 : all.findIndex((m) => m.created_at > start)
  if (firstNew === -1 || all.length === 0) throw new Error('write_note_no_messages')
  const newMessages = all.slice(firstNew)
  const earlierContext = all.slice(Math.max(0, firstNew - EARLIER_CONTEXT_COUNT), firstNew)
  const through = newMessages[newMessages.length - 1].created_at

  // Latest non-archived session that owns a covered message.
  let sessionId: string | null = null
  for (const m of newMessages) {
    if (archived.has(m.session_id)) continue
    if (sessionId === null || sessionOrder.get(m.session_id)! > sessionOrder.get(sessionId)!) {
      sessionId = m.session_id
    }
  }

  // The brief as the model sees it. With no brief doc yet, the model is told
  // so; an empty brief is created later only if a note needs a parent.
  const currentBrief: BriefContent | null = briefDoc
    ? ((briefDoc.data().content as BriefContent) ?? EMPTY_BRIEF)
    : null

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const callStart = Date.now()
  const response = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: NOTE_MAX_TOKENS,
    temperature: BRIEF_TEMPERATURE,
    system: [{ type: 'text', text: NOTE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildNoteUserContent({ currentBrief, earlierContext, newMessages }),
          },
        ],
      },
    ],
    tools: [WRITE_NOTE_TOOL],
    tool_choice: { type: 'tool', name: 'write_note' },
  })

  if (response.usage) {
    void logAnthropicCall({
      project_id: projectId,
      route: 'brief.note',
      model: BRIEF_MODEL,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      duration_ms: Date.now() - callStart,
    })
  }

  // A truncated tool call is incomplete: typed failure so the breaker counts it.
  if (response.stop_reason === 'max_tokens') throw new Error('write_note_max_tokens')

  const toolUse = response.content.find(
    (block): block is Extract<typeof block, { type: 'tool_use' }> =>
      block.type === 'tool_use' && block.name === 'write_note'
  )
  if (!toolUse) throw new Error('write_note_no_tool_use')

  const body = coerceNote((toolUse.input ?? {}) as Record<string, unknown>)

  // Persist: note → notes_through_at → brief contest. A throw before
  // notes_through_at moves leaves it where it was, so the next run retries
  // the same window. The contest step runs after the window has advanced and
  // is best-effort: if it threw after the note was saved, a retry would write
  // a second note over the same messages.
  let noteId: string | null = null
  if (!isEmptyNote(body)) {
    // Notes need a parent brief doc.
    const briefId = briefDoc
      ? briefDoc.id
      : (await upsertBrief(db, projectId, EMPTY_BRIEF, 'create')).id
    const note: Omit<BriefNote, 'id'> = {
      session_id: sessionId,
      created_at: new Date().toISOString(),
      folded_at: null,
      ...body,
    }
    noteId = await addNote(db, briefId, note)
  }

  await projectRef.update({ notes_through_at: through })

  if (body.lock_reversals.length > 0) {
    try {
      await applyContests(db, projectId, body.lock_reversals)
    } catch (err) {
      // No brief content in the log: ids and the error message only.
      console.error('write_note_contest_failed', {
        project_id: projectId,
        note_id: noteId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { note_id: noteId, covered: newMessages.length, through }
}

// Re-read the live brief right before writing (the model call is slow and the
// builder may have saved in the meantime), apply the reversals to that fresh
// content, and save a version with source 'note' only if something changed.
async function applyContests(
  db: FirebaseFirestore.Firestore,
  projectId: string,
  reversals: BriefNoteLockReversal[]
): Promise<void> {
  const snap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()
  if (snap.empty) return // no brief, so no locked decisions to contest
  const live = (snap.docs[0].data().content as BriefContent) ?? EMPTY_BRIEF
  const decisions = applyLockReversals(live.decisions ?? [], reversals)
  if (decisions) await upsertBrief(db, projectId, { ...live, decisions }, 'note')
}
