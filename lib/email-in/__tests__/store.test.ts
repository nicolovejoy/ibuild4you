import { describe, it, expect, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type { ProjectEmail } from '@/lib/types'

// FieldValue.increment as a marker the fake db can apply.
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
}))

import { storeProjectEmail, recordDrop, listProjectEmails, EMAIL_TEXT_MAX } from '../store'

type Doc = Record<string, unknown>

// Apply an update patch with dotted keys and increment markers, the way
// Firestore's update() does.
function applyPatch(target: Doc, patch: Doc): Doc {
  const out: Doc = structuredClone(target)
  for (const [key, value] of Object.entries(patch)) {
    const path = key.split('.')
    let node = out
    for (const part of path.slice(0, -1)) {
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {}
      node = node[part] as Doc
    }
    const last = path[path.length - 1]
    const inc = (value as { __increment?: number } | null)?.__increment
    node[last] = inc !== undefined ? ((node[last] as number | undefined) ?? 0) + inc : value
  }
  return out
}

// In-memory stand-in for the project_emails and projects collections:
// project_emails supports doc(id).get()/create(), where('project_id','==').get()
// and .select(...).get(); projects supports doc(id).get()/update().
function makeDb() {
  const emails = new Map<string, Doc>()
  const projects = new Map<string, Doc>([
    ['p1', { title: 'One' }],
    ['p2', { title: 'Two' }],
  ])
  const calls = { emailReads: 0, selects: [] as string[][] }

  const whereProject = (projectId: string, fields?: string[]) => ({
    get: async () => {
      calls.emailReads++
      const docs = [...emails.entries()]
        .filter(([, d]) => d.project_id === projectId)
        .map(([id, d]) => {
          const shown = fields
            ? Object.fromEntries(fields.filter((f) => f in d).map((f) => [f, d[f]]))
            : d
          return { id, data: () => shown }
        })
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
  })

  const db = {
    collection: (name: string) => {
      if (name === 'project_emails') {
        return {
          doc: (id: string) => ({
            get: async () => ({ id, exists: emails.has(id), data: () => emails.get(id) }),
            create: async (data: Doc) => {
              if (emails.has(id)) {
                throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 })
              }
              emails.set(id, data)
            },
          }),
          where: (field: string, op: string, value: string) => {
            if (field !== 'project_id' || op !== '==') {
              throw new Error(`unexpected query ${field} ${op} (needs a composite index?)`)
            }
            return {
              ...whereProject(value),
              select: (...fields: string[]) => {
                calls.selects.push(fields)
                return whereProject(value, fields)
              },
              orderBy: () => {
                throw new Error('orderBy after where needs a composite index')
              },
            }
          },
        }
      }
      if (name === 'projects') {
        return {
          doc: (id: string) => ({
            get: async () => ({ id, exists: projects.has(id), data: () => projects.get(id) }),
            update: async (patch: Doc) => {
              if (!projects.has(id)) throw new Error('NOT_FOUND')
              projects.set(id, applyPatch(projects.get(id)!, patch))
            },
          }),
        }
      }
      throw new Error(`unexpected collection ${name}`)
    },
  }
  return { db: db as unknown as Firestore, emails, projects, calls }
}

const email = (over: Partial<ProjectEmail> = {}): Omit<ProjectEmail, 'id'> => ({
  project_id: 'p1',
  from_email: 'bduris@aol.com',
  from_name: 'Bill Duris',
  from_role: 'maker',
  received_at: '2026-11-20T10:00:00.000Z',
  sent_at: null,
  subject: 'Re: the app',
  message_id: '<abc@aol.com>',
  text: 'Thursday works.',
  truncated: false,
  attachments: [],
  ...over,
})

// Seeds n accepted emails for p1, one minute apart, ending at `end`.
function seed(emails: Map<string, Doc>, n: number, end: string, projectId = 'p1') {
  const endMs = Date.parse(end)
  for (let i = 0; i < n; i++) {
    const at = new Date(endMs - i * 60_000).toISOString()
    emails.set(`seed${i}_${projectId}`, email({ project_id: projectId, received_at: at }))
  }
}

describe('storeProjectEmail', () => {
  it('stores under <emailId>_<project_id> and sets last_email_at', async () => {
    const { db, emails, projects } = makeDb()
    expect(await storeProjectEmail(db, 'em1', email())).toBe('stored')
    expect(emails.get('em1_p1')).toEqual(email())
    expect(projects.get('p1')?.last_email_at).toBe('2026-11-20T10:00:00.000Z')
  })

  it('stores one email CC to two projects once for each', async () => {
    const { db, emails } = makeDb()
    expect(await storeProjectEmail(db, 'em1', email())).toBe('stored')
    expect(await storeProjectEmail(db, 'em1', email({ project_id: 'p2' }))).toBe('stored')
    expect([...emails.keys()].sort()).toEqual(['em1_p1', 'em1_p2'])
  })

  it('a retry of the same id is duplicate and moves nothing', async () => {
    const { db, emails, projects } = makeDb()
    await storeProjectEmail(db, 'em1', email())
    const retry = email({ received_at: '2026-11-20T11:00:00.000Z', text: 'changed' })
    expect(await storeProjectEmail(db, 'em1', retry)).toBe('duplicate')
    expect(emails.get('em1_p1')?.received_at).toBe('2026-11-20T10:00:00.000Z')
    expect(emails.get('em1_p1')?.text).toBe('Thursday works.')
    expect(projects.get('p1')?.last_email_at).toBe('2026-11-20T10:00:00.000Z')
  })

  it('a create that races and loses is duplicate', async () => {
    const { db, emails, projects } = makeDb()
    // Another delivery creates the doc between our existence check and create().
    const real = db.collection('project_emails')
    const racing = {
      ...db,
      collection: (name: string) => {
        if (name !== 'project_emails') return db.collection(name)
        return {
          ...real,
          doc: (id: string) => ({
            get: async () => ({ id, exists: false, data: () => undefined }),
            create: async (data: Doc) => {
              emails.set(id, { ...data, text: 'first writer' })
              return real.doc(id).create(data)
            },
          }),
        }
      },
    } as unknown as Firestore
    expect(await storeProjectEmail(racing, 'em1', email())).toBe('duplicate')
    expect(emails.get('em1_p1')?.text).toBe('first writer')
    expect(projects.get('p1')?.last_email_at).toBeUndefined()
  })

  it('rethrows a create error that is not already-exists', async () => {
    const { db } = makeDb()
    const real = db.collection('project_emails')
    const failing = {
      collection: (name: string) => {
        if (name !== 'project_emails') return db.collection(name)
        return {
          ...real,
          doc: (id: string) => ({
            get: async () => ({ id, exists: false, data: () => undefined }),
            create: async () => {
              throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 })
            },
          }),
        }
      },
    } as unknown as Firestore
    await expect(storeProjectEmail(failing, 'em1', email())).rejects.toThrow('UNAVAILABLE')
  })

  it('the 51st email in 24 hours is over_limit and writes nothing', async () => {
    const { db, emails, projects } = makeDb()
    seed(emails, 50, '2026-11-20T09:59:00.000Z')
    expect(await storeProjectEmail(db, 'em51', email())).toBe('over_limit')
    expect(emails.has('em51_p1')).toBe(false)
    expect(emails.size).toBe(50)
    expect(projects.get('p1')?.last_email_at).toBeUndefined()
  })

  it('the 50th email in 24 hours is still stored', async () => {
    const { db, emails } = makeDb()
    seed(emails, 49, '2026-11-20T09:59:00.000Z')
    expect(await storeProjectEmail(db, 'em50', email())).toBe('stored')
    expect(emails.size).toBe(50)
  })

  it('counts only the last 24 hours, and only this project', async () => {
    const { db, emails } = makeDb()
    // 49 inside the window, many more just outside it, and 60 on another project.
    seed(emails, 49, '2026-11-20T09:59:00.000Z')
    for (let i = 0; i < 20; i++) {
      const at = new Date(Date.parse('2026-11-19T10:00:00.000Z') - i * 60_000).toISOString()
      emails.set(`old${i}_p1`, email({ received_at: at }))
    }
    seed(emails, 60, '2026-11-20T09:59:00.000Z', 'p2')
    expect(await storeProjectEmail(db, 'em1', email())).toBe('stored')
  })

  it('a retry of an already-stored email at the limit is duplicate, not over_limit', async () => {
    const { db, emails, projects } = makeDb()
    seed(emails, 49, '2026-11-20T09:59:00.000Z')
    expect(await storeProjectEmail(db, 'em50', email())).toBe('stored')
    // The project now holds 50 in the window; the webhook for em50 is retried.
    const retry = email({ received_at: '2026-11-20T10:05:00.000Z' })
    expect(await storeProjectEmail(db, 'em50', retry)).toBe('duplicate')
    expect(projects.get('p1')?.last_email_at).toBe('2026-11-20T10:00:00.000Z')
  })

  it('reads only received_at for the flood count, not every email text', async () => {
    const { db, emails, calls } = makeDb()
    seed(emails, 3, '2026-11-20T09:59:00.000Z')
    await storeProjectEmail(db, 'em1', email())
    expect(calls.selects).toEqual([['received_at']])
  })

  it('exports the stored text cap', () => {
    expect(EMAIL_TEXT_MAX).toBe(50_000)
  })
})

describe('recordDrop', () => {
  it('not_member increments its counter and sets last_at, with no address', async () => {
    const { db, projects } = makeDb()
    await recordDrop(db, 'p1', 'not_member', 'stranger@x.com')
    await recordDrop(db, 'p1', 'not_member')
    const p = projects.get('p1')!
    const dropped = p.email_in_dropped as Record<string, unknown>
    expect(dropped.not_member).toBe(2)
    expect(typeof dropped.last_at).toBe('string')
    expect(dropped.last_auth_failed_from).toBeUndefined()
    expect(JSON.stringify(p)).not.toContain('stranger')
  })

  it('over_limit never writes an address either', async () => {
    const { db, projects } = makeDb()
    await recordDrop(db, 'p1', 'over_limit', 'bduris@aol.com')
    const p = projects.get('p1')!
    expect((p.email_in_dropped as Record<string, unknown>).over_limit).toBe(1)
    expect(JSON.stringify(p)).not.toContain('bduris')
  })

  it('auth_failed increments and keeps the claimed member address', async () => {
    const { db, projects } = makeDb()
    await recordDrop(db, 'p1', 'auth_failed', 'bduris@aol.com')
    const dropped = projects.get('p1')!.email_in_dropped as Record<string, unknown>
    expect(dropped.auth_failed).toBe(1)
    expect(dropped.last_auth_failed_from).toBe('bduris@aol.com')
    expect(dropped.not_member).toBeUndefined()
  })

  it('leaves the project’s other fields alone', async () => {
    const { db, projects } = makeDb()
    await recordDrop(db, 'p1', 'not_member')
    expect(projects.get('p1')?.title).toBe('One')
  })
})

describe('listProjectEmails', () => {
  it('returns the project’s emails oldest first, with id set', async () => {
    const { db } = makeDb()
    await storeProjectEmail(db, 'b', email({ received_at: '2026-11-20T12:00:00.000Z' }))
    await storeProjectEmail(db, 'a', email({ received_at: '2026-11-20T08:00:00.000Z' }))
    await storeProjectEmail(db, 'c', email({ received_at: '2026-11-20T10:00:00.000Z' }))
    await storeProjectEmail(db, 'x', email({ project_id: 'p2' }))
    const out = await listProjectEmails(db, 'p1')
    expect(out.map((e) => e.id)).toEqual(['a_p1', 'c_p1', 'b_p1'])
    expect(out[0]).toMatchObject({ project_id: 'p1', text: 'Thursday works.' })
  })

  it('is empty for a project with no emails', async () => {
    const { db } = makeDb()
    expect(await listProjectEmails(db, 'p2')).toEqual([])
  })
})
