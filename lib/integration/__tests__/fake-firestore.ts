type Doc = Record<string, unknown>
type Filter = { field: string; op: '==' | 'array-contains'; value: unknown }

class AlreadyExists extends Error {
  code = 6
  constructor() {
    super('6 ALREADY_EXISTS: Document already exists')
  }
}

// Supports exactly what lib/integration/store.ts uses: doc get/create/set/
// update/delete, add, where (==, array-contains), orderBy, limit, batch,
// runTransaction. Transactions apply immediately; tests are single-threaded.
export function createFakeFirestore() {
  const data = new Map<string, Map<string, Doc>>()
  let auto = 0
  const table = (name: string) => {
    if (!data.has(name)) data.set(name, new Map())
    return data.get(name)!
  }

  type Snap = { id: string; exists: boolean; data: () => Doc | undefined; ref: Ref }
  type Ref = {
    id: string
    path: string
    get: () => Promise<Snap>
    create: (d: Doc) => Promise<void>
    set: (d: Doc) => Promise<void>
    update: (p: Doc) => Promise<void>
    delete: () => Promise<void>
  }

  const snapOf = (name: string, id: string): Snap => {
    const d = table(name).get(id)
    return { id, exists: d !== undefined, data: () => (d ? { ...d } : undefined), ref: ref(name, id) }
  }

  const ref = (name: string, id: string): Ref => ({
    id,
    path: `${name}/${id}`,
    get: async () => snapOf(name, id),
    create: async (doc) => {
      if (table(name).has(id)) throw new AlreadyExists()
      table(name).set(id, { ...doc })
    },
    set: async (doc) => {
      table(name).set(id, { ...doc })
    },
    update: async (patch) => {
      const cur = table(name).get(id)
      if (!cur) throw new Error('5 NOT_FOUND')
      table(name).set(id, { ...cur, ...patch })
    },
    delete: async () => {
      table(name).delete(id)
    },
  })

  const run = (name: string, filters: Filter[], order: string[], limit: number | null) => {
    let rows = [...table(name).entries()].map(([id, d]) => ({ id, d }))
    for (const f of filters) {
      rows = rows.filter(({ d }) =>
        f.op === '=='
          ? d[f.field] === f.value
          : Array.isArray(d[f.field]) && (d[f.field] as unknown[]).includes(f.value)
      )
    }
    rows.sort((a, b) => {
      for (const field of order) {
        const x = String(a.d[field] ?? '')
        const y = String(b.d[field] ?? '')
        if (x !== y) return x < y ? -1 : 1
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    if (limit !== null) rows = rows.slice(0, limit)
    const docs = rows.map(({ id }) => snapOf(name, id))
    return { docs, empty: docs.length === 0, size: docs.length }
  }

  const query = (
    name: string,
    filters: Filter[] = [],
    order: string[] = [],
    limit: number | null = null
  ): Record<string, unknown> => ({
    where: (field: string, op: '==' | 'array-contains', value: unknown) =>
      query(name, [...filters, { field, op, value }], order, limit),
    orderBy: (field: string) => query(name, filters, [...order, field], limit),
    limit: (n: number) => query(name, filters, order, n),
    get: async () => run(name, filters, order, limit),
  })

  const nextId = () => `auto-${String(++auto).padStart(4, '0')}`
  const collection = (name: string) => ({
    ...query(name),
    doc: (id?: string) => ref(name, id ?? nextId()),
    add: async (doc: Doc) => {
      const id = nextId()
      table(name).set(id, { ...doc })
      return ref(name, id)
    },
  })

  const batch = () => {
    const ops: (() => Promise<void>)[] = []
    return {
      delete: (r: Ref) => {
        ops.push(() => r.delete())
      },
      update: (r: Ref, patch: Doc) => {
        ops.push(() => r.update(patch))
      },
      set: (r: Ref, doc: Doc) => {
        ops.push(() => r.set(doc))
      },
      commit: async () => {
        for (const op of ops) await op()
      },
    }
  }

  const runTransaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const tx = {
      get: (r: Ref) => r.get(),
      create: (r: Ref, doc: Doc) => {
        const name = r.path.split('/')[0]
        if (table(name).has(r.id)) throw new AlreadyExists()
        table(name).set(r.id, { ...doc })
      },
      set: (r: Ref, doc: Doc) => {
        void r.set(doc)
      },
      update: (r: Ref, patch: Doc) => {
        void r.update(patch)
      },
      delete: (r: Ref) => {
        void r.delete()
      },
    }
    return fn(tx)
  }

  const db = { collection, batch, runTransaction } as unknown as FirebaseFirestore.Firestore

  return {
    db,
    seed: (name: string, id: string, doc: Doc) => {
      table(name).set(id, { ...doc })
    },
    all: (name: string) => [...table(name).entries()].map(([id, d]) => ({ id, ...d })),
    get: (name: string, id: string) => {
      const d = table(name).get(id)
      return d ? { id, ...d } : null
    },
  }
}
