import { getAuthenticatedUser, getAdminDb, canAccessProject } from '@/lib/api/firebase-server-helpers'
import { buildSystemPrompt } from '@/lib/agent/system-prompt'
import { AGENT_MODEL, AGENT_MAX_TOKENS, AGENT_TEMPERATURE } from '@/lib/agent/constants'
import { isAdminEmail, ADMIN_EMAILS } from '@/lib/constants'
import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'
import type { BriefContent } from '@/lib/types'

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { session_id, content } = body

  if (!session_id || !content?.trim()) {
    return new Response(JSON.stringify({ error: 'session_id and content are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const db = getAdminDb()

  // Look up session → project, verify ownership
  const sessionDoc = await db.collection('sessions').doc(session_id).get()
  if (!sessionDoc.exists) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const projectId = sessionDoc.data()?.project_id
  const projectDoc = await db.collection('projects').doc(projectId).get()
  const projectData = projectDoc.data() || {}
  if (!projectDoc.exists || !canAccessProject(projectData, auth.uid, auth.email)) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const now = new Date().toISOString()

  // Store the user message
  await db.collection('messages').add({
    session_id,
    role: 'user',
    content: content.trim(),
    sender_email: auth.email,
    created_at: now,
    updated_at: now,
  })

  // Notify admin of non-admin chat activity (fire-and-forget)
  if (!isAdminEmail(auth.email)) {
    const projectTitle = projectData.title || 'Untitled project'
    getResend()
      .emails.send({
        from: 'iBuild4you <noreply@ibuild4you.com>',
        to: ADMIN_EMAILS,
        subject: `New chat: ${projectTitle}`,
        text: [
          `${auth.email} sent a message in "${projectTitle}"`,
          '',
          `Time: ${now}`,
          `Project: https://ibuild4you.com/projects/${projectId}`,
        ].join('\n'),
      })
      .catch((err) => console.error('Failed to send chat notification:', err))
  }

  // Load conversation history for this session
  const messagesSnap = await db
    .collection('messages')
    .where('session_id', '==', session_id)
    .orderBy('created_at', 'asc')
    .get()

  const messages = messagesSnap.docs.map((doc) => ({
    role: doc.data().role as 'user' | 'assistant',
    content: doc.data().content as string,
  }))
  // Map our 'agent' role to Claude's 'assistant' role
  const claudeMessages = messages.map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))

  // Claude requires conversations to start with a user message.
  // With a welcome message, the first stored message is 'assistant'.
  if (claudeMessages.length > 0 && claudeMessages[0].role === 'assistant') {
    claudeMessages.unshift({ role: 'user', content: 'Hi' })
  }

  // Count sessions for this project to determine session number
  const sessionsSnap = await db
    .collection('sessions')
    .where('project_id', '==', projectId)
    .orderBy('created_at', 'asc')
    .get()
  const sessionIds = sessionsSnap.docs.map((d) => d.id)
  const sessionNumber = sessionIds.indexOf(session_id) + 1

  // Load current brief if exists
  let briefContent: BriefContent | null = null
  const briefSnap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()
  if (!briefSnap.empty) {
    briefContent = briefSnap.docs[0].data().content as BriefContent
  }

  // Build system prompt — read config from session (snapshotted), fall back to project
  const sessionData = sessionDoc.data() || {}
  const projectContext = projectData.context as string | null || null
  const seedQuestions = (sessionData.seed_questions ?? projectData.seed_questions) as string[] | undefined
  const styleGuide = (sessionData.style_guide ?? projectData.style_guide) as string | undefined
  const builderDirectives = (sessionData.builder_directives ?? projectData.builder_directives) as string[] | undefined
  const sessionMode = (sessionData.session_mode ?? projectData.session_mode) as 'discover' | 'converge' | undefined
  const systemPrompt = buildSystemPrompt({
    briefContent,
    projectContext,
    sessionNumber,
    seedQuestions,
    styleGuide,
    builderDirectives,
    sessionMode,
  })

  // Stream response from Claude
  const stream = getAnthropic().messages.stream({
    model: AGENT_MODEL,
    system: systemPrompt,
    messages: claudeMessages,
    max_tokens: AGENT_MAX_TOKENS,
    temperature: AGENT_TEMPERATURE,
  })

  const encoder = new TextEncoder()
  let fullResponse = ''

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullResponse += event.delta.text
            const chunk = `data: ${JSON.stringify({ text: event.delta.text })}\n\n`
            controller.enqueue(encoder.encode(chunk))
          }
        }

        // Store the complete agent response
        const responseTime = new Date().toISOString()
        await db.collection('messages').add({
          session_id,
          role: 'agent',
          content: fullResponse,
          created_at: responseTime,
          updated_at: responseTime,
        })

        // Track token usage + model on the session
        const finalMessage = await stream.finalMessage()
        if (finalMessage.usage) {
          const sessionRef = db.collection('sessions').doc(session_id)
          const currentSession = (await sessionRef.get()).data() || {}
          const prevInput = (currentSession.token_usage_input as number) || 0
          const prevOutput = (currentSession.token_usage_output as number) || 0
          await sessionRef.update({
            token_usage_input: prevInput + finalMessage.usage.input_tokens,
            token_usage_output: prevOutput + finalMessage.usage.output_tokens,
            model: AGENT_MODEL,
            updated_at: responseTime,
          })
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        console.error('Stream error:', err)
        controller.error(err)
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
