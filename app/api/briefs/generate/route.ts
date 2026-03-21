import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, canAccessProject } from '@/lib/api/firebase-server-helpers'
import { buildBriefPrompt } from '@/lib/agent/brief-prompt'
import { BRIEF_MODEL, BRIEF_MAX_TOKENS, BRIEF_TEMPERATURE } from '@/lib/agent/constants'
import Anthropic from '@anthropic-ai/sdk'
import type { BriefContent } from '@/lib/types'

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// POST /api/briefs/generate — generate/update the brief for a project
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  // Verify ownership
  const projectDoc = await db.collection('projects').doc(project_id).get()
  if (!projectDoc.exists || !canAccessProject(projectDoc.data()!, auth.uid, auth.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Load all messages across all sessions for this project
  const sessionsSnap = await db
    .collection('sessions')
    .where('project_id', '==', project_id)
    .orderBy('created_at', 'asc')
    .get()

  const sessionIds = sessionsSnap.docs.map((d) => d.id)

  // Collect all messages in order
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
    return NextResponse.json({ error: 'No messages to generate brief from' }, { status: 400 })
  }

  // Load current brief
  let currentBrief: BriefContent | null = null
  let currentVersion = 0
  const briefSnap = await db
    .collection('briefs')
    .where('project_id', '==', project_id)
    .orderBy('version', 'desc')
    .limit(1)
    .get()

  if (!briefSnap.empty) {
    currentBrief = briefSnap.docs[0].data().content as BriefContent
    currentVersion = briefSnap.docs[0].data().version as number
  }

  // Build prompt and call Claude
  const prompt = buildBriefPrompt({
    currentBrief,
    conversationHistory: allMessages,
  })

  try {
    const response = await getAnthropic().messages.create({
      model: BRIEF_MODEL,
      max_tokens: BRIEF_MAX_TOKENS,
      temperature: BRIEF_TEMPERATURE,
      messages: [{ role: 'user', content: prompt }],
    })

    // Extract text from response
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')

    // Parse the JSON response
    const briefContent: BriefContent = JSON.parse(text)

    // Validate shape
    if (typeof briefContent.problem !== 'string') briefContent.problem = ''
    if (typeof briefContent.target_users !== 'string') briefContent.target_users = ''
    if (!Array.isArray(briefContent.features)) briefContent.features = []
    if (typeof briefContent.constraints !== 'string') briefContent.constraints = ''
    if (typeof briefContent.additional_context !== 'string') briefContent.additional_context = ''
    if (!Array.isArray(briefContent.decisions)) briefContent.decisions = []
    briefContent.decisions = briefContent.decisions.filter(
      (d) => d && typeof d.topic === 'string' && typeof d.decision === 'string'
    )

    // Store new version
    const now = new Date().toISOString()
    const newVersion = currentVersion + 1
    const docRef = await db.collection('briefs').add({
      project_id,
      version: newVersion,
      content: briefContent,
      created_at: now,
      updated_at: now,
    })

    return NextResponse.json({
      id: docRef.id,
      project_id,
      version: newVersion,
      content: briefContent,
      created_at: now,
      updated_at: now,
    })
  } catch (err) {
    console.error('Brief generation error:', err)
    return NextResponse.json({ error: 'Failed to generate brief' }, { status: 500 })
  }
}
