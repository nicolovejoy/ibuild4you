import Anthropic from '@anthropic-ai/sdk'
import { AGENT_MODEL, AGENT_TEMPERATURE } from './constants'

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// --- Invite message (first share with a maker) ---

interface InviteParams {
  projectTitle: string
  projectContext?: string | null
  makerFirstName?: string | null
  seedQuestions?: string[]
  sessionMode?: 'discover' | 'converge'
}

const INVITE_SYSTEM_PROMPT = `You are writing a short text/email from a project builder to someone they're inviting to a guided conversation about their app or website idea.

Rules:
- 2-3 sentences maximum
- Be warm and specific to the project — mention what the conversation will be about
- Reference the person by name if provided
- Do NOT include any links, emails, passcodes, or sign-in instructions — those are added separately
- Do NOT use jargon like "user journeys", "microservices", "tech stack", "MVP", etc.
- This is casual — like a text message from someone you know`

export async function generateInviteMessage(params: InviteParams): Promise<string> {
  const parts = [`Generate an invite message for a project called "${params.projectTitle}".`]
  if (params.makerFirstName) parts.push(`The person's name is ${params.makerFirstName}.`)
  if (params.projectContext) parts.push(`Background: ${params.projectContext}`)
  if (params.seedQuestions?.length) {
    parts.push(`The conversation will explore: ${params.seedQuestions.slice(0, 3).join(', ')}`)
  }
  if (params.sessionMode === 'converge') {
    parts.push('This session is about narrowing down specifics and making decisions.')
  }

  const response = await getAnthropic().messages.create({
    model: AGENT_MODEL,
    system: INVITE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: parts.join('\n') }],
    max_tokens: 512,
    temperature: AGENT_TEMPERATURE,
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  return textBlock?.text || ''
}

// --- Nudge message (new session ready) ---

interface NudgeParams {
  projectTitle: string
  projectContext?: string | null
  makerFirstName?: string | null
  sessionMode?: 'discover' | 'converge'
  builderNote?: string | null
  sessionNumber: number
  voiceSample?: string | null
}

const NUDGE_SYSTEM_PROMPT_BASE = `You are writing a short text/email from a project builder to someone who has an ongoing conversation about their app or website idea. A new conversation session is ready.

Rules:
- 2-3 sentences maximum
- Reference the person by name if provided
- Do NOT include any links — those are added separately
- Keep it casual and short — this is a text message, not corporate copy
- Do NOT list multiple topics; pick a single hook (the builder's note, otherwise something specific from the project) and lead with that
- Do NOT use jargon like "user journeys", "microservices", "tech stack", "MVP", etc.`

function buildNudgeSystemPrompt(voiceSample?: string | null): string {
  if (voiceSample && voiceSample.trim()) {
    return `${NUDGE_SYSTEM_PROMPT_BASE}\n\nVoice anchor — mimic this builder's voice, register, and sentence shape. Match their cadence, not just their vocabulary:\n${voiceSample.trim()}`
  }
  return NUDGE_SYSTEM_PROMPT_BASE
}

export async function generateNudgeMessage(params: NudgeParams): Promise<string> {
  const parts = [`Generate a nudge message for session ${params.sessionNumber} of "${params.projectTitle}".`]
  if (params.makerFirstName) parts.push(`The person's name is ${params.makerFirstName}.`)
  if (params.builderNote) parts.push(`Builder's note — use this as the single hook for the nudge: ${params.builderNote}`)
  if (params.sessionMode === 'converge') {
    parts.push('This session is about narrowing down and making decisions.')
  } else {
    parts.push('This session is about exploring and discovering more about the idea.')
  }
  if (params.projectContext) parts.push(`Background: ${params.projectContext}`)

  const response = await getAnthropic().messages.create({
    model: AGENT_MODEL,
    system: buildNudgeSystemPrompt(params.voiceSample),
    messages: [{ role: 'user', content: parts.join('\n') }],
    max_tokens: 512,
    temperature: AGENT_TEMPERATURE,
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  return textBlock?.text || ''
}

// --- Reminder message (maker hasn't started yet) ---

interface ReminderParams {
  projectTitle: string
  projectContext?: string | null
  makerFirstName?: string | null
  sharedAt?: string | null
}

const REMINDER_SYSTEM_PROMPT = `You are writing a brief, friendly reminder to someone who was invited to a guided conversation about their app or website idea but hasn't started yet.

Rules:
- 1-2 sentences maximum
- Be warm, not pushy
- Reference how long ago they were invited if that info is available
- Reference the person by name if provided
- Do NOT include any links — those are added separately
- Do NOT use jargon`

export async function generateReminderMessage(params: ReminderParams): Promise<string> {
  const parts = [`Generate a reminder for "${params.projectTitle}".`]
  if (params.makerFirstName) parts.push(`The person's name is ${params.makerFirstName}.`)
  if (params.sharedAt) {
    const days = Math.floor((Date.now() - new Date(params.sharedAt).getTime()) / (1000 * 60 * 60 * 24))
    if (days === 0) parts.push('They were invited earlier today.')
    else if (days === 1) parts.push('They were invited yesterday.')
    else parts.push(`They were invited ${days} days ago.`)
  }
  if (params.projectContext) parts.push(`Background: ${params.projectContext}`)

  const response = await getAnthropic().messages.create({
    model: AGENT_MODEL,
    system: REMINDER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: parts.join('\n') }],
    max_tokens: 256,
    temperature: AGENT_TEMPERATURE,
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  return textBlock?.text || ''
}
