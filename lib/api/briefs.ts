import type { BriefContent } from '@/lib/types'
import {
  NEXT_CONVO_SYSTEM_PROMPT,
  buildNextConvoUserContent,
} from '@/lib/agent/next-convo-prompt'
import { BRIEF_MODEL, BRIEF_MAX_TOKENS, BRIEF_TEMPERATURE } from '@/lib/agent/constants'
import { logAnthropicCall } from '@/lib/observability/anthropic'
import { reconcileBrief } from '@/lib/api/brief-merge'
import Anthropic from '@anthropic-ai/sdk'

// Forced tool that the model must call. Using tool use (vs. asking for JSON in
// the prompt) eliminates the truncation-→-JSON.parse-throws bug class that
// caused a 5-min cron loop on the May 21 cost incident.
//
// Tools are part of the cached prefix (order: tools → system → messages), so
// changing this schema invalidates the system-prompt cache below. Don't tweak
// casually.
const UPDATE_BRIEF_TOOL = {
  name: 'update_brief',
  description: 'Save the updated project brief reflecting everything learned so far.',
  input_schema: {
    type: 'object' as const,
    properties: {
      problem: { type: 'string' },
      target_users: { type: 'string' },
      features: { type: 'array', items: { type: 'string' } },
      constraints: { type: 'string' },
      additional_context: { type: 'string' },
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            decision: { type: 'string' },
            locked: {
              type: 'boolean',
              description:
                'A locked decision is a durable constraint. Carry it forward verbatim — never drop or reword it.',
            },
          },
          required: ['topic', 'decision'],
        },
      },
      open_risks: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'problem',
      'target_users',
      'features',
      'constraints',
      'additional_context',
    ],
  },
}

// Regenerates the living brief for a project from the full conversation
// history. Used by:
//   - POST /api/briefs/generate (manual builder click)
//   - GET  /api/cron/notify     (auto-regen when a session goes idle)
// Throws on no messages, missing project, or model failure to return a tool_use block.
export async function regenerateBriefForProject(
  db: FirebaseFirestore.Firestore,
  projectId: string,
) {
  const sessionsSnap = await db
    .collection('sessions')
    .where('project_id', '==', projectId)
    .orderBy('created_at', 'asc')
    .get()

  const sessionIds = sessionsSnap.docs.map((d) => d.id)

  const allMessages: { role: string; content: string }[] = []
  for (const sid of sessionIds) {
    const msgSnap = await db
      .collection('messages')
      .where('session_id', '==', sid)
      .orderBy('created_at', 'asc')
      .get()
    for (const doc of msgSnap.docs) {
      allMessages.push({ role: doc.data().role, content: doc.data().content })
    }
  }

  if (allMessages.length === 0) {
    throw new Error('regenerate_brief_no_messages')
  }

  let currentBrief: BriefContent | null = null
  const briefSnap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()
  if (!briefSnap.empty) {
    currentBrief = briefSnap.docs[0].data().content as BriefContent
  }

  const projectDoc = await db.collection('projects').doc(projectId).get()
  const projectTitle = (projectDoc.data()?.title as string) || 'Untitled'

  const userContent = buildNextConvoUserContent({
    currentBrief,
    conversationHistory: allMessages,
    projectTitle,
    sessionCount: sessionIds.length,
  })

  // Prompt caching: two breakpoints.
  //   1. system block — caches tools + system together (~1.5k stable tokens).
  //      Hits across all projects within 5 min, so the cron's per-tick loop
  //      over idle projects pays the cache-write cost once.
  //   2. user content block — caches the project preamble + brief +
  //      conversation history. Hits when the same project is regenerated
  //      twice without a new maker message (cron + manual click, etc.).
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const callStart = Date.now()
  const response = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: BRIEF_MAX_TOKENS,
    temperature: BRIEF_TEMPERATURE,
    system: [
      {
        type: 'text',
        text: NEXT_CONVO_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userContent,
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ],
    tools: [UPDATE_BRIEF_TOOL],
    tool_choice: { type: 'tool', name: 'update_brief' },
  })

  if (response.usage) {
    void logAnthropicCall({
      project_id: projectId,
      route: 'brief.generate',
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

  // If the model hit max_tokens mid tool_use, the input is incomplete.
  // Surface this as a typed failure so the cron's circuit breaker can stop retrying.
  if (response.stop_reason === 'max_tokens') {
    throw new Error('regenerate_brief_max_tokens')
  }

  const toolUse = response.content.find(
    (block): block is Extract<typeof block, { type: 'tool_use' }> =>
      block.type === 'tool_use' && block.name === 'update_brief',
  )
  if (!toolUse) {
    throw new Error('regenerate_brief_no_tool_use')
  }

  const raw = toolUse.input as Partial<BriefContent>
  // Coerce shape — model may omit optional fields or send wrong types
  const briefContent: BriefContent = {
    problem: typeof raw.problem === 'string' ? raw.problem : '',
    target_users: typeof raw.target_users === 'string' ? raw.target_users : '',
    features: Array.isArray(raw.features)
      ? raw.features.filter((f): f is string => typeof f === 'string')
      : [],
    constraints: typeof raw.constraints === 'string' ? raw.constraints : '',
    additional_context:
      typeof raw.additional_context === 'string' ? raw.additional_context : '',
    decisions: Array.isArray(raw.decisions)
      ? raw.decisions
          .filter(
            (d): d is { topic: string; decision: string; locked?: boolean } =>
              !!d && typeof d.topic === 'string' && typeof d.decision === 'string',
          )
          .map((d) => ({
            topic: d.topic,
            decision: d.decision,
            ...(d.locked === true && { locked: true }),
          }))
      : [],
    open_risks: Array.isArray(raw.open_risks)
      ? raw.open_risks.filter(
          (r): r is string => typeof r === 'string' && r.trim().length > 0,
        )
      : [],
  }

  // #71: locked decisions are durable — re-inject any the model dropped or
  // reworded, so a constraint survives regen verbatim across many sessions.
  const reconciled = reconcileBrief(currentBrief, briefContent)

  return upsertBrief(db, projectId, reconciled)
}

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
