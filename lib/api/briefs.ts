import type { BriefContent } from '@/lib/types'
import { buildNextConvoPrompt } from '@/lib/agent/next-convo-prompt'
import { BRIEF_MODEL, BRIEF_MAX_TOKENS, BRIEF_TEMPERATURE } from '@/lib/agent/constants'
import { logAnthropicCall } from '@/lib/observability/anthropic'
import Anthropic from '@anthropic-ai/sdk'

// Regenerates the living brief for a project from the full conversation
// history. Used by:
//   - POST /api/briefs/generate (manual builder click)
//   - GET  /api/cron/notify     (auto-regen when a session goes idle)
// Throws on no messages, missing project, or unparseable Claude output.
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

  const prompt = buildNextConvoPrompt({
    currentBrief,
    conversationHistory: allMessages,
    projectTitle,
    sessionCount: sessionIds.length,
  })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const callStart = Date.now()
  const response = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: BRIEF_MAX_TOKENS,
    temperature: BRIEF_TEMPERATURE,
    messages: [{ role: 'user', content: prompt }],
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

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')

  const parsed = JSON.parse(text)
  const briefContent: BriefContent = parsed.brief || parsed

  // Validate / coerce shape — keep matches the manual route's behavior
  if (typeof briefContent.problem !== 'string') briefContent.problem = ''
  if (typeof briefContent.target_users !== 'string') briefContent.target_users = ''
  if (!Array.isArray(briefContent.features)) briefContent.features = []
  if (typeof briefContent.constraints !== 'string') briefContent.constraints = ''
  if (typeof briefContent.additional_context !== 'string') briefContent.additional_context = ''
  if (!Array.isArray(briefContent.decisions)) briefContent.decisions = []
  briefContent.decisions = briefContent.decisions.filter(
    (d) => d && typeof d.topic === 'string' && typeof d.decision === 'string',
  )
  if (!Array.isArray(briefContent.open_risks)) briefContent.open_risks = []
  briefContent.open_risks = briefContent.open_risks.filter(
    (r: unknown) => typeof r === 'string' && (r as string).trim(),
  )

  return upsertBrief(db, projectId, briefContent)
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
