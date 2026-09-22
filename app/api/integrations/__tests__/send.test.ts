import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFakeFirestore } from '@/lib/integration/__tests__/fake-firestore'
import { REPLY_CLAIM_MS } from '@/lib/integration/store'
import { SECRET, UUID, UUID2, postJson, errorCode } from './helpers'

let fake = createFakeFirestore()
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }))
const generate = vi.fn()
vi.mock('@/lib/integration/facilitator', () => ({
  generateFacilitatorReply: (...a: unknown[]) => generate(...a),
}))

import { POST } from '../stars-demo/messages/route'

const PATH = '/api/integrations/stars-demo/messages'
const G = 'stars-demo:r2:star-data'
const send = {
  round: 'r2',
  topic_id: 'star-data',
  participant_id: 'p_1',
  author_label: 'Participant A',
  idempotency_key: `r2:star-data:p_1:${UUID}`,
  body: 'synthetic message one',
  topic_title: 'Synthetic title',
  topic_prompt: 'Synthetic prompt',
}
const participant = (id: string, label: string, topics: string[]) => ({
  namespace: 'stars-demo',
  round: 'r2',
  participant_id: id,
  author_label: label,
  topic_ids: topics,
  created_at: '0',
})
const facilitators = () => fake.all('integration_messages').filter((m) => m.kind === 'facilitator')

beforeEach(() => {
  vi.stubEnv('STARS_INTEGRATION_SECRET', SECRET)
  fake = createFakeFirestore()
  fake.seed('integration_groups', G, {
    namespace: 'stars-demo',
    round: 'r2',
    topic_id: 'star-data',
    version: 'v1',
    created_at: '0',
    updated_at: '0',
  })
  fake.seed('integration_participants', 'stars-demo:r2:p_1', participant('p_1', 'Participant A', ['star-data']))
  fake.seed('integration_participants', 'stars-demo:r2:p_2', participant('p_2', 'Participant B', ['admissions']))
  generate.mockReset().mockResolvedValue({ ok: true, body: 'synthetic reply' })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('POST messages (send)', () => {
  it('401s without the secret and writes nothing', async () => {
    expect((await postJson(POST, PATH, send, {})).status).toBe(401)
    expect(fake.all('integration_messages')).toHaveLength(0)
  })

  it('400s invalid_request for a malformed body, writing nothing and calling no model', async () => {
    expect(await errorCode(await postJson(POST, PATH, { ...send, body: '' }))).toBe('invalid_request')
    expect(
      await errorCode(await postJson(POST, PATH, { ...send, idempotency_key: `r2:admissions:p_1:${UUID}` }))
    ).toBe('invalid_request')
    expect(fake.all('integration_messages')).toHaveLength(0)
    expect(generate).not.toHaveBeenCalled()
  })

  it('403s forbidden for an unmapped participant, one not in this topic, or a topic never ensured', async () => {
    expect(
      await errorCode(
        await postJson(POST, PATH, { ...send, participant_id: 'p_9', idempotency_key: `r2:star-data:p_9:${UUID}` })
      )
    ).toBe('forbidden')
    expect(
      await errorCode(
        await postJson(POST, PATH, {
          ...send,
          participant_id: 'p_2',
          author_label: 'Participant B',
          idempotency_key: `r2:star-data:p_2:${UUID}`,
        })
      )
    ).toBe('forbidden')
    expect(
      await errorCode(
        await postJson(POST, PATH, {
          ...send,
          topic_id: 'self-service',
          idempotency_key: `r2:self-service:p_1:${UUID}`,
        })
      )
    ).toBe('forbidden')
    expect(fake.all('integration_messages')).toHaveLength(0)
  })

  it('400s invalid_request when the label differs from the ensured one, writing nothing', async () => {
    expect(await errorCode(await postJson(POST, PATH, { ...send, author_label: 'Participant Q' }))).toBe(
      'invalid_request'
    )
    expect(fake.all('integration_messages')).toHaveLength(0)
  })

  it('409s stale when seen_version is not current, writing nothing', async () => {
    const res = await postJson(POST, PATH, { ...send, seen_version: 'old' })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('stale')
    expect(fake.all('integration_messages')).toHaveLength(0)
    expect(generate).not.toHaveBeenCalled()
  })

  it('stores the participant message, then the reply, and returns both with a new version', async () => {
    const res = await postJson(POST, PATH, { ...send, seen_version: 'v1' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.round).toBe('r2')
    expect(body.topic_id).toBe('star-data')
    expect(body.version).not.toBe('v1')
    expect(body.message).toEqual({
      id: expect.any(String),
      kind: 'participant',
      author_id: 'p_1',
      author_label: 'Participant A',
      body: 'synthetic message one',
      created_at: expect.any(String),
    })
    expect(body.reply).toEqual({
      id: expect.any(String),
      kind: 'facilitator',
      body: 'synthetic reply',
      created_at: expect.any(String),
      depends_on_message_ids: [body.message.id],
      depends_on_participant_ids: ['p_1'],
    })
    expect(fake.all('integration_messages')).toHaveLength(2)
    const arg = generate.mock.calls[0][0]
    expect(arg.topicTitle).toBe('Synthetic title')
    expect(arg.topicPrompt).toBe('Synthetic prompt')
    expect(arg.history.map((m: { id: string }) => m.id)).toEqual([body.message.id])
    expect(fake.get('integration_groups', G)).not.toHaveProperty('topic_title')
  })

  it('replays a completed key unchanged with no second write or model call', async () => {
    const first = await (await postJson(POST, PATH, send)).json()
    const again = await (await postJson(POST, PATH, { ...send, body: 'changed text ignored' })).json()
    expect(again.message).toEqual(first.message)
    expect(again.reply).toEqual(first.reply)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(fake.all('integration_messages')).toHaveLength(2)
  })

  it('202s reply_pending on model failure, clears the claim, keeps the message, regenerates on the next retry', async () => {
    generate.mockResolvedValueOnce({ ok: false })
    const failed = await postJson(POST, PATH, send)
    expect(failed.status).toBe(202)
    expect(await errorCode(failed)).toBe('reply_pending')
    expect(fake.all('integration_messages')).toHaveLength(1)
    expect((fake.all('integration_messages')[0] as { reply_claim_token: string | null }).reply_claim_token).toBeNull()

    const retry = await postJson(POST, PATH, send)
    expect(retry.status).toBe(200)
    expect((await retry.json()).reply.body).toBe('synthetic reply')
    expect(fake.all('integration_messages')).toHaveLength(2)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('202s reply_pending while another request holds the generation claim', async () => {
    let release!: () => void
    generate.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r({ ok: true, body: 'synthetic reply' })
        })
    )
    const inFlight = postJson(POST, PATH, send)
    await new Promise((r) => setTimeout(r, 0))
    const concurrent = await postJson(POST, PATH, send)
    expect(concurrent.status).toBe(202)
    expect(await errorCode(concurrent)).toBe('reply_pending')
    release()
    expect((await inFlight).status).toBe(200)
    expect(fake.all('integration_messages')).toHaveLength(2)
  })

  it("an attempt that lost its claim discards its reply and returns the winner's", async () => {
    generate.mockImplementationOnce(async (arg: { history: { id: string }[] }) => {
      // Simulate a re-claim by a later retry that already wrote the reply.
      const id = arg.history[0].id
      fake.seed('integration_messages', id, {
        ...fake.get('integration_messages', id)!,
        reply_claim_token: null,
        reply_claimed_at: null,
      })
      fake.seed('integration_messages', 'winner', {
        group_id: G,
        namespace: 'stars-demo',
        round: 'r2',
        topic_id: 'star-data',
        kind: 'facilitator',
        body: 'winner reply',
        depends_on_message_ids: [id],
        depends_on_participant_ids: ['p_1'],
        created_at: '9',
      })
      return { ok: true, body: 'loser reply' }
    })
    const res = await postJson(POST, PATH, send)
    expect(res.status).toBe(200)
    expect((await res.json()).reply.body).toBe('winner reply')
    expect(facilitators()).toHaveLength(1)
  })

  it('regenerates after a stuck claim expires', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-22T10:00:00.000Z') })
    await postJson(POST, PATH, send)
    const id = fake.all('integration_messages').find((m) => m.kind === 'participant')!.id
    // Detach the first reply so the retry has no reply to replay, then stick a claim.
    facilitators().forEach((m) => fake.seed('integration_messages', m.id, { ...m, group_id: 'moved' }))
    fake.seed('integration_messages', id, {
      ...fake.get('integration_messages', id)!,
      reply_claimed_at: new Date().toISOString(),
      reply_claim_token: 'stuck',
    })
    vi.setSystemTime(Date.now() + REPLY_CLAIM_MS + 1)
    const res = await postJson(POST, PATH, send)
    expect(res.status).toBe(200)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('202s reply_pending, never 503, when storage fails after the message was written', async () => {
    generate.mockImplementationOnce(async () => {
      ;(fake.db as unknown as { runTransaction: unknown }).runTransaction = async () => {
        throw new Error('storage detail')
      }
      return { ok: true, body: 'synthetic reply' }
    })
    const res = await postJson(POST, PATH, send)
    expect(res.status).toBe(202)
    expect(await errorCode(res)).toBe('reply_pending')
  })

  it('503s unavailable when storage fails before anything is written', async () => {
    ;(fake.db as unknown as { runTransaction: unknown }).runTransaction = async () => {
      throw new Error('storage detail')
    }
    const res = await postJson(POST, PATH, send)
    expect(res.status).toBe(503)
    expect(await errorCode(res)).toBe('unavailable')
    expect(fake.all('integration_messages')).toHaveLength(0)
  })

  it('a second participant in the same topic shows up in depends_on_participant_ids', async () => {
    fake.seed('integration_participants', 'stars-demo:r2:p_3', participant('p_3', 'Participant C', ['star-data']))
    await postJson(POST, PATH, send)
    const res = await postJson(POST, PATH, {
      ...send,
      participant_id: 'p_3',
      author_label: 'Participant C',
      idempotency_key: `r2:star-data:p_3:${UUID2}`,
      body: 'synthetic two',
    })
    expect((await res.json()).reply.depends_on_participant_ids.sort()).toEqual(['p_1', 'p_3'])
  })

  it('never touches product collections', async () => {
    await postJson(POST, PATH, send)
    for (const c of ['sessions', 'messages', 'projects', 'project_members', 'briefs', 'users']) {
      expect(fake.all(c)).toHaveLength(0)
    }
  })
})
