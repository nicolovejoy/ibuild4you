import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildFacilitatorTurns, generateFacilitatorReply } from '../facilitator'
import type { MessageRow } from '../types'

const logAnthropicCall = vi.fn(async (..._args: unknown[]) => {})
vi.mock('@/lib/observability/anthropic', () => ({
  logAnthropicCall: (...a: unknown[]) => logAnthropicCall(...a),
}))

const base = { namespace: 'stars-demo', round: 'r2' as const, topic_id: 'star-data' as const, group_id: 'g1' }
const history: MessageRow[] = [
  {
    ...base,
    id: 'u1',
    kind: 'participant',
    author_id: 'p_1',
    author_label: 'Participant A',
    idempotency_key: 'k1',
    reply_claimed_at: null,
    reply_claim_token: null,
    body: 'synthetic one',
    created_at: '1',
  },
  {
    ...base,
    id: 'r1',
    kind: 'facilitator',
    body: 'synthetic reply',
    depends_on_message_ids: ['u1'],
    depends_on_participant_ids: ['p_1'],
    created_at: '2',
  },
  {
    ...base,
    id: 'u2',
    kind: 'participant',
    author_id: 'p_2',
    author_label: 'Participant B',
    idempotency_key: 'k2',
    reply_claimed_at: null,
    reply_claim_token: null,
    body: 'synthetic two',
    created_at: '3',
  },
]

describe('buildFacilitatorTurns', () => {
  it('prefixes participant turns with the stored label and maps roles', () => {
    expect(buildFacilitatorTurns(history)).toEqual([
      { role: 'user', content: 'Participant A: synthetic one' },
      { role: 'assistant', content: 'synthetic reply' },
      { role: 'user', content: 'Participant B: synthetic two' },
    ])
  })
  it('merges consecutive participant turns so roles alternate', () => {
    expect(buildFacilitatorTurns([history[0], history[2]])).toEqual([
      { role: 'user', content: 'Participant A: synthetic one\n\nParticipant B: synthetic two' },
    ])
  })
  it('drops a leading facilitator turn', () => {
    expect(buildFacilitatorTurns([history[1], history[2]])).toEqual([
      { role: 'user', content: 'Participant B: synthetic two' },
    ])
  })
  it('never places participant text anywhere but a user turn', () => {
    for (const t of buildFacilitatorTurns(history)) {
      if (t.role !== 'user') expect(t.content).not.toContain('synthetic one')
    }
  })
})

describe('generateFacilitatorReply', () => {
  const create = vi.fn()
  const anthropic = { messages: { create } } as unknown as import('@anthropic-ai/sdk').default
  const input = { groupId: 'g1', topicTitle: 'Synthetic title', topicPrompt: 'Synthetic prompt', history, anthropic }

  beforeEach(() => {
    create.mockReset()
    logAnthropicCall.mockClear()
  })

  it('sends a cached facilitator system prompt, no streaming, and returns the text', async () => {
    create.mockResolvedValue({
      content: [{ type: 'text', text: '  synthetic answer ' }],
      usage: { input_tokens: 5, output_tokens: 3 },
    })
    expect(await generateFacilitatorReply(input)).toEqual({ ok: true, body: 'synthetic answer' })
    const args = create.mock.calls[0][0]
    expect(args.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(args.system[0].text).toContain('Synthetic title')
    expect(args.system[0].text).toContain('Synthetic prompt')
    expect(args.messages).toHaveLength(3)
    expect(args.stream).toBeUndefined()
    expect(logAnthropicCall).toHaveBeenCalledWith(
      expect.objectContaining({ route: 'integration.chat', project_id: 'g1' })
    )
  })

  it('maps any failure or an empty completion to not-ok, never rethrowing', async () => {
    create.mockRejectedValue(Object.assign(new Error('provider detail that must not leak'), { status: 429 }))
    expect(await generateFacilitatorReply(input)).toEqual({ ok: false })
    create.mockRejectedValue(new Error('other provider detail'))
    expect(await generateFacilitatorReply(input)).toEqual({ ok: false })
    create.mockResolvedValue({ content: [], usage: { input_tokens: 5, output_tokens: 0 } })
    expect(await generateFacilitatorReply(input)).toEqual({ ok: false })
  })
})
