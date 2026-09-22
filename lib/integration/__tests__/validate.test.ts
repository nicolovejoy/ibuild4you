import { describe, it, expect } from 'vitest'
import {
  parseSend,
  parseDelete,
  parseEnsure,
  parseErase,
  parseNamespaceErase,
  parseListQuery,
} from '../validate'

const UUID = '123e4567-e89b-42d3-a456-426614174000'
const send = {
  round: 'r2',
  topic_id: 'star-data',
  participant_id: 'p_1',
  author_label: 'Participant A',
  idempotency_key: `r2:star-data:p_1:${UUID}`,
  body: '  synthetic message one  ',
  topic_title: 'Synthetic title',
  topic_prompt: 'Synthetic prompt',
}

describe('parseSend', () => {
  it('accepts a valid body and trims the message', () => {
    const r = parseSend(send)
    expect(r?.body).toBe('synthetic message one')
    expect(r?.seen_version).toBeUndefined()
  })
  it('keeps seen_version when present', () => {
    expect(parseSend({ ...send, seen_version: 'v1' })?.seen_version).toBe('v1')
  })
  it('rejects wrong round, unknown topic, bad ids, empty or long fields', () => {
    expect(parseSend({ ...send, round: 'r1' })).toBeNull()
    expect(parseSend({ ...send, topic_id: 'other' })).toBeNull()
    expect(parseSend({ ...send, participant_id: 'has space' })).toBeNull()
    expect(parseSend({ ...send, participant_id: 'x'.repeat(129) })).toBeNull()
    expect(parseSend({ ...send, body: '   ' })).toBeNull()
    expect(parseSend({ ...send, body: 'x'.repeat(4001) })).toBeNull()
    expect(parseSend({ ...send, author_label: 'x'.repeat(41) })).toBeNull()
    expect(parseSend({ ...send, topic_title: '' })).toBeNull()
    expect(parseSend({ ...send, topic_prompt: undefined })).toBeNull()
  })
  it('rejects a key whose topic or participant disagrees with the body, or is not r2:topic:participant:uuid', () => {
    expect(parseSend({ ...send, idempotency_key: `r2:admissions:p_1:${UUID}` })).toBeNull()
    expect(parseSend({ ...send, idempotency_key: `r2:star-data:p_2:${UUID}` })).toBeNull()
    expect(parseSend({ ...send, idempotency_key: 'r2:star-data:p_1:not-a-uuid' })).toBeNull()
  })
  it('rejects non-objects', () => {
    expect(parseSend(null)).toBeNull()
    expect(parseSend('x')).toBeNull()
  })
})

describe('parseDelete', () => {
  const del = {
    round: 'r2',
    topic_id: 'admissions',
    participant_id: 'p_1',
    message_id: 'm_1',
    idempotency_key: `r2:admissions:p_1:${UUID}`,
  }
  it('accepts a valid body', () => {
    expect(parseDelete(del)).toEqual(del)
  })
  it('rejects a missing message_id or a key of the wrong shape', () => {
    expect(parseDelete({ ...del, message_id: '' })).toBeNull()
    expect(parseDelete({ ...del, idempotency_key: 'del:1' })).toBeNull()
    expect(parseDelete({ ...del, idempotency_key: `r2:star-data:p_1:${UUID}` })).toBeNull()
  })
})

describe('parseEnsure', () => {
  const ens = { round: 'r2', participant_id: 'p_1', author_label: 'Participant A', topic_ids: ['star-data', 'self-service'] }
  it('accepts a valid body and carries no key', () => {
    expect(parseEnsure(ens)).toEqual(ens)
  })
  it('rejects empty, unknown or duplicate topics and a long label', () => {
    expect(parseEnsure({ ...ens, topic_ids: [] })).toBeNull()
    expect(parseEnsure({ ...ens, topic_ids: ['nope'] })).toBeNull()
    expect(parseEnsure({ ...ens, topic_ids: ['star-data', 'star-data'] })).toBeNull()
    expect(parseEnsure({ ...ens, author_label: 'x'.repeat(41) })).toBeNull()
  })
})

describe('parseErase', () => {
  const erase = { round: 'r2', participant_id: 'p_1', operation_key: `r2:erase:p_1:${UUID}` }
  it('accepts a valid body', () => {
    expect(parseErase(erase)).toEqual(erase)
  })
  it('rejects a key whose participant disagrees or of the wrong shape', () => {
    expect(parseErase({ ...erase, operation_key: `r2:erase:p_2:${UUID}` })).toBeNull()
    expect(parseErase({ ...erase, operation_key: `r2:star-data:p_1:${UUID}` })).toBeNull()
    expect(parseErase({ round: 'r2', participant_id: 'p_1' })).toBeNull()
  })
})

describe('parseNamespaceErase', () => {
  it('accepts r2:namespace-erase:uuid only', () => {
    expect(parseNamespaceErase({ round: 'r2', operation_key: `r2:namespace-erase:${UUID}` })).toEqual({
      round: 'r2',
      operation_key: `r2:namespace-erase:${UUID}`,
    })
    expect(parseNamespaceErase({ round: 'r2', operation_key: `r2:erase:p_1:${UUID}` })).toBeNull()
    expect(parseNamespaceErase({ round: 'r2' })).toBeNull()
  })
})

describe('parseListQuery', () => {
  it('reads round and topic from the query string', () => {
    expect(parseListQuery(new URL('http://x/api?round=r2&topic_id=admissions'))).toEqual({
      round: 'r2',
      topic_id: 'admissions',
    })
    expect(parseListQuery(new URL('http://x/api?round=r2'))).toBeNull()
    expect(parseListQuery(new URL('http://x/api?round=r1&topic_id=admissions'))).toBeNull()
  })
})
