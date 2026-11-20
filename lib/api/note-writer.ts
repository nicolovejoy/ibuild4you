// Per-conversation note writer (#229). Replaces the whole-brief regen: after a
// conversation goes idle, the model writes a short note of what the new
// messages added or changed, stored at briefs/{briefId}/notes. The brief itself
// is left alone, except for one automatic edit: an explicitly confirmed
// reversal of a locked decision marks that decision `contested` (#197) so the
// Contested badge and Sam's "don't reopen" behaviour don't wait for a paste.
//
// Where it starts: projects.notes_through_at (created_at of the newest message,
// or received_at of the newest email, a note has covered), else the live
// brief's updated_at (the old regen already covered everything before it),
// else the very beginning.
//
// Email-in: emails members sent to the project's address (project_emails) join
// the chat messages as one stream ordered by time. Each email is first cut to
// what the app has not already seen (lib/email-in/new-text.ts).

import Anthropic from '@anthropic-ai/sdk'
import type {
  BriefContent,
  BriefDecision,
  BriefNote,
  BriefNoteLockReversal,
  BriefNoteThumbsDown,
  ProjectEmail,
} from '@/lib/types'
import { BRIEF_MODEL, BRIEF_TEMPERATURE, EMAIL_WINDOW_CHAR_LIMIT, NOTE_MAX_TOKENS } from '@/lib/agent/constants'
import { NOTE_SYSTEM_PROMPT, buildNoteUserContent, type Message as NoteTurn } from '@/lib/agent/note-prompt'
import { logAnthropicCall } from '@/lib/observability/anthropic'
import { addNote, isEmptyNote, listUnfoldedNotes } from '@/lib/api/brief-notes'
import { upsertBrief } from '@/lib/api/briefs'
import { contestFor, normalizeDecisionText, topicKey } from '@/lib/api/brief-merge'
import { normalizeResolvedRisks, normalizeRisks } from '@/lib/brief/risks'
import { isArchivedSession } from '@/lib/sessions/active'
import { isBuilderSideRole } from '@/lib/roles/member-role'
import { listProjectEmails } from '@/lib/email-in/store'
import { seenLines, splitNewText } from '@/lib/email-in/new-text'

// How many messages before the first new one go in as continuity context.
const EARLIER_CONTEXT_COUNT = 6

// How much of a 👎 reply the note quotes.
const THUMBS_DOWN_EXCERPT_LENGTH = 160

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
      risks_resolved: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, resolution: { type: 'string' } },
          required: ['text', 'resolution'],
        },
      },
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

type Msg = {
  role: string
  content: string
  created_at: string
  session_id: string
  builder?: boolean
  // The maker's 👎 on an agent reply. Read by code only; the prompt builder
  // never sees it.
  thumbsDown?: { reason: string | null }
}

// Sam's 👎 replies among the new messages, as note entries: a short excerpt
// (whitespace collapsed) and the maker's reason when they gave one.
function thumbsDownEntries(messages: Msg[]): BriefNoteThumbsDown[] {
  return messages
    .filter((m) => m.thumbsDown)
    .map((m) => {
      const flat = (m.content ?? '').replace(/\s+/g, ' ').trim()
      const excerpt =
        flat.length > THUMBS_DOWN_EXCERPT_LENGTH ? `${flat.slice(0, THUMBS_DOWN_EXCERPT_LENGTH)}…` : flat
      const reason = m.thumbsDown!.reason
      return reason ? { excerpt, reason } : { excerpt }
    })
}

// The stream the note writer reads: chat messages and emails, oldest first.
// `at` is a message's created_at or an email's received_at, as stored.
type EmailItem = { kind: 'email'; at: string; email: ProjectEmail; typed: string; quotedUnseen: string }
type StreamItem = { kind: 'message'; at: string; msg: Msg } | EmailItem

// Marks where an email too long for one note was cut.
const CUT_MARK = '[cut here]'

// Each email's new text. Its seen set is the stored text of every email on the
// project before it (in the window or not), so a line someone quoted again is
// dropped and a quote of mail the app never received is kept.
function splitEmails(emails: ProjectEmail[]): EmailItem[] {
  const seen = new Set<string>()
  return emails.map((email) => {
    const text = email.text ?? ''
    const { typed, quotedUnseen } = splitNewText(text, seen)
    // Added after the split: an email is never evidence against itself.
    for (const line of seenLines([text])) seen.add(line)
    return { kind: 'email', at: email.received_at, email, typed, quotedUnseen }
  })
}

// Merge the two time-ordered lists. Each keeps its own order; on equal
// timestamps the chat message comes first.
function mergeStream(messages: Msg[], emails: EmailItem[]): StreamItem[] {
  const out: StreamItem[] = []
  let e = 0
  for (const msg of messages) {
    while (e < emails.length && emails[e].at < msg.created_at) out.push(emails[e++])
    out.push({ kind: 'message', at: msg.created_at, msg })
  }
  while (e < emails.length) out.push(emails[e++])
  return out
}

const hasText = (item: StreamItem) =>
  item.kind === 'message' || item.typed !== '' || item.quotedUnseen !== ''

// Cut to at most n UTF-16 units without splitting an emoji's surrogate pair.
function cutTo(s: string, n: number): string {
  const cut = s.slice(0, n)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

// One email longer than the limit on its own: typed text is kept first, the
// quoted part gets whatever room is left, and CUT_MARK ends the part cut.
function cutEmail(item: EmailItem): EmailItem {
  const typed = cutTo(item.typed, EMAIL_WINDOW_CHAR_LIMIT)
  const quotedUnseen = cutTo(item.quotedUnseen, EMAIL_WINDOW_CHAR_LIMIT - typed.length)
  return quotedUnseen
    ? { ...item, typed, quotedUnseen: `${quotedUnseen}\n${CUT_MARK}` }
    : { ...item, typed: `${typed}\n${CUT_MARK}`, quotedUnseen: '' }
}

// This note's window: the longest prefix of the new items whose emails hold at
// most EMAIL_WINDOW_CHAR_LIMIT characters of new text (chat adds nothing to
// the sum). It stops before the email that would pass the limit, and the rest
// waits for the next run. An email that passes the limit alone is cut instead,
// so it cannot hold the stream back. Never empty when `items` is not.
function takeWindow(items: StreamItem[]): { window: StreamItem[]; truncated: boolean } {
  const window: StreamItem[] = []
  let used = 0
  let truncated = false
  for (const item of items) {
    if (item.kind === 'email') {
      const size = item.typed.length + item.quotedUnseen.length
      if (used + size > EMAIL_WINDOW_CHAR_LIMIT) {
        if (used > 0) break
        window.push(cutEmail(item))
        truncated = true
        used = EMAIL_WINDOW_CHAR_LIMIT
        continue
      }
      used += size
    }
    window.push(item)
  }
  return { window, truncated }
}

const PACIFIC_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })

// A stream item as the prompt builder takes it. An email's day is the Pacific
// calendar date it was received (en-CA formats as YYYY-MM-DD).
function toTurn(item: StreamItem): NoteTurn {
  if (item.kind === 'message') return item.msg
  return {
    role: 'email',
    content: '',
    email: {
      role: item.email.from_role,
      name: item.email.from_name,
      day: PACIFIC_DAY.format(new Date(item.email.received_at)),
      typed: item.typed,
      quotedUnseen: item.quotedUnseen,
    },
  }
}

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
    risks_resolved: normalizeResolvedRisks(raw.risks_resolved),
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

  // Owner/builder senders (#245): their turns are labelled Builder so the note
  // never records them as the maker's words. Same member lookup as the chat
  // roster; a sender with no member row stays User, as today.
  const membersSnap = await db.collection('project_members').where('project_id', '==', projectId).get()
  const builderEmails = new Set(
    membersSnap.docs.filter((d) => isBuilderSideRole(d.data().role)).map((d) => d.data().email as string)
  )

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
        ...(d.role === 'user' && builderEmails.has(d.sender_email as string) ? { builder: true } : {}),
        ...(d.role === 'agent' && d.rating === 'down'
          ? { thumbsDown: { reason: (d.rating_reason as string | null | undefined) ?? null } }
          : {}),
      })
    }
  }
  all.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))

  // Chat and email as one stream. `start` compares the same way for both, so
  // an item stamped exactly at notes_through_at is never read twice.
  const stream = mergeStream(all, splitEmails(await listProjectEmails(db, projectId)))
  const firstNew = start === null ? 0 : stream.findIndex((item) => item.at > start)
  if (firstNew === -1 || stream.length === 0) throw new Error('write_note_no_messages')
  const earlierContext = stream.slice(Math.max(0, firstNew - EARLIER_CONTEXT_COUNT), firstNew)
  const { window, truncated } = takeWindow(stream.slice(firstNew))
  const covered = window.length
  const through = window[window.length - 1].at
  const newMessages = window.flatMap((item) => (item.kind === 'message' ? [item.msg] : []))
  const newEmails = window.filter((item): item is EmailItem => item.kind === 'email')

  // Nothing for the model to read: every item in the window is an email the
  // app had already seen in full. No call; the window still advances, or every
  // cron tick would come back to it.
  if (!window.some(hasText)) {
    await projectRef.update({ notes_through_at: through })
    return { note_id: null, covered, through }
  }

  // Latest non-archived session that owns a covered message; null when the
  // window held emails only.
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

  // Notes written since the last paste: the model builds on them so notes
  // between pastes don't contradict or repeat each other. A read failure
  // throws before the model call, so the breaker counts it and the next run
  // retries the same window.
  const notesSinceCuration = briefDoc ? await listUnfoldedNotes(db, briefDoc.id) : []

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
            // An email with nothing new left is covered but not shown.
            text: buildNoteUserContent({
              currentBrief,
              notesSinceCuration,
              earlierContext: earlierContext.filter(hasText).map(toTurn),
              newMessages: window.filter(hasText).map(toTurn),
            }),
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

  const thumbsDown = thumbsDownEntries(newMessages)
  const body = {
    ...coerceNote((toolUse.input ?? {}) as Record<string, unknown>),
    ...(thumbsDown.length > 0 && { thumbs_down: thumbsDown }),
  }
  // A lock reversal contests the live brief without a paste, so it needs the
  // maker's own chat turn. Never from an email or a Builder line alone.
  if (!newMessages.some((m) => m.role === 'user' && !m.builder)) body.lock_reversals = []

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
      // Stamped by code from the window, never by the model.
      ...(newEmails.length > 0 && {
        email_ids: newEmails.map((item) => item.email.id),
        email_sources: newEmails.filter(hasText).map((item) => ({
          from_name: item.email.from_name,
          from_role: item.email.from_role,
          received_at: item.email.received_at,
        })),
        ...(truncated && { email_truncated: true }),
      }),
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

  return { note_id: noteId, covered, through }
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
