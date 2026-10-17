# Lock Contest (#197) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brief regen may *contest* a locked decision (proposed change + reason) but never remove it; the Brief tab lets a builder accept or dismiss the contest; any Brief-tab save or restore that would drop a lock asks first.

**Architecture:** A new optional `contested` field on `BriefDecision`, allowed only on a locked decision. Regen's tool schema and prompt let the model fill it; `mergeLockedDecisions` copies it onto the verbatim lock. Three pure helpers in `lib/api/brief-merge.ts` (`mergeLockedDecisions` extension, `lostLocks`, `resolveContest`) carry all the logic; the Brief tab UI and `BriefHistory` call them. No API shape change beyond the new field passing through `PUT /api/briefs`.

**Tech Stack:** Next.js App Router, TypeScript, vitest (+ @testing-library/react with `// @vitest-environment jsdom` for components), Anthropic forced tool use for regen.

**Spec:** `docs/superpowers/specs/2026-10-15-lock-contest.md`

## Global Constraints

- Only builders set locks: a model-emitted `locked` is still dropped on regen (#190). `contested` may exist only on a `locked: true` decision; every write path strips it otherwise.
- Locked `topic`/`decision`/`locked`/provenance come verbatim from the previous brief through regen (#71, #121). Contesting must not move `decided_at`.
- Topic identity is `topic.trim().toLowerCase()` (existing `topicKey`).
- All new user-facing strings go in `lib/copy.ts` under `brief`.
- No `window.confirm`/alerts: inline two-step confirms, as `BriefHistory` already does.
- Run `npm test`, `npm run type-check`, `npm run lint` before every commit. The `UPDATE_BRIEF_TOOL` schema and `NEXT_CONVO_SYSTEM_PROMPT` are part of a cached prefix — change them exactly as specified, once.
- `NEXT_CONVO_SYSTEM_PROMPT` is also snapshotted by `lib/agent/__tests__/prep-prompts-snapshot.test.ts`; after the one specified wording change, refresh that snapshot (`npx vitest run lib/agent/__tests__/prep-prompts-snapshot.test.ts -u`) and confirm the snapshot diff contains only the lock-rule line.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A paste that round-trips a brief containing a contested lock must keep `contested` (PUT keeps it on a locked decision) — otherwise the raw-JSON view would silently dismiss a contest. Pinned in Task 3.
2. A regen that no longer mentions the reversal must not clear an existing `contested` (builder hasn't ruled). Pinned in Task 1 (`mergeLockedDecisions` carries prev's contested when next has none).
3. "Accept and unlock" must not trigger the Part B guard (it is the deliberate path). Pinned in Task 4.
4. A `contested` with empty `proposed` or non-string `reason` from the model must be dropped, not persisted half-formed. Pinned in Task 2.
5. The save guard must not fire when the builder merely edits a locked decision's text or adds decisions (locks unchanged). Pinned in Task 1 (`lostLocks` unchanged case) and Task 4.

---

### Task 1: Types + pure helpers in brief-merge

**Files:**
- Modify: `lib/types/index.ts` (BriefDecision, ~line 287)
- Modify: `lib/api/brief-merge.ts`
- Test: `lib/api/__tests__/brief-merge.test.ts`

**Interfaces:**
- Produces: `BriefDecisionContest { proposed: string; reason: string }`, `BriefDecision.contested?: BriefDecisionContest`; `lostLocks(prev, next): string[]`; `resolveContest(decisions, topic, action: ContestAction): BriefDecision[]` with `export type ContestAction = 'accept' | 'accept_unlock' | 'dismiss'`; `mergeLockedDecisions` now carries/copies `contested`.

- [ ] **Step 1: Add the type**

In `lib/types/index.ts`, after `locked?: boolean` on `BriefDecision`:

```ts
  // #197: regen may *contest* a locked decision (the maker explicitly confirmed
  // a reversal in conversation) but never remove it. Only ever set on a locked
  // decision; cleared by a builder's Accept/Dismiss on the Brief tab.
  contested?: BriefDecisionContest
```

and add above `BriefDecision`:

```ts
export interface BriefDecisionContest {
  proposed: string // what the maker wants instead
  reason: string // why, and when they confirmed it
}
```

- [ ] **Step 2: Write the failing tests**

Append to `lib/api/__tests__/brief-merge.test.ts` (extend the import to include `lostLocks`, `resolveContest`):

```ts
describe('mergeLockedDecisions — contested locks (#197)', () => {
  const contest = { proposed: 'Square', reason: 'switched POS, confirmed in conversation 3' }

  it('copies a model-emitted contested onto the verbatim lock', () => {
    const prev = [{ topic: 'Payment', decision: 'Stripe only', locked: true, decided_at: '2026-01-01T00:00:00.000Z' }]
    const next = [{ topic: 'payment', decision: 'Square', contested: contest }]
    expect(mergeLockedDecisions(prev, next)).toEqual([
      { topic: 'Payment', decision: 'Stripe only', locked: true, decided_at: '2026-01-01T00:00:00.000Z', contested: contest },
    ])
  })

  it('carries an existing contested forward when regen no longer mentions it', () => {
    const prev = [{ topic: 'Payment', decision: 'Stripe only', locked: true, contested: contest }]
    const next = [{ topic: 'Payment', decision: 'Stripe only' }]
    expect(mergeLockedDecisions(prev, next)).toEqual([
      { topic: 'Payment', decision: 'Stripe only', locked: true, contested: contest },
    ])
  })

  it('a newer contested replaces the older one', () => {
    const prev = [{ topic: 'Payment', decision: 'Stripe only', locked: true, contested: contest }]
    const newer = { proposed: 'PayPal', reason: 'changed again, conversation 4' }
    const next = [{ topic: 'Payment', decision: 'Stripe only', contested: newer }]
    expect(mergeLockedDecisions(prev, next)[0].contested).toEqual(newer)
  })

  it('strips contested from a non-locked decision', () => {
    const prev = [d('Stack', 'Next.js', true)]
    const next = [{ topic: 'Auth', decision: 'Google', contested: contest }]
    expect(mergeLockedDecisions(prev, next)).toEqual([
      { topic: 'Stack', decision: 'Next.js', locked: true },
      { topic: 'Auth', decision: 'Google' },
    ])
  })

  it('strips contested from regen output even when nothing was locked', () => {
    const next = [{ topic: 'Auth', decision: 'Google', contested: contest }]
    expect(mergeLockedDecisions([], next)).toEqual([{ topic: 'Auth', decision: 'Google' }])
  })
})

describe('lostLocks (#197 Part B)', () => {
  it('returns nothing when every lock survives, even if text or order changed', () => {
    const prev = [d('Stack', 'Next.js', true), d('Auth', 'Google')]
    const next = [d('Auth', 'Google'), d('stack ', 'Next.js, no Vue', true), d('DB', 'Firestore')]
    expect(lostLocks(prev, next)).toEqual([])
  })

  it('names a locked topic that is missing from next', () => {
    expect(lostLocks([d('Stack', 'Next.js', true)], [d('Auth', 'Google')])).toEqual(['Stack'])
  })

  it('names a locked topic that next carries unlocked', () => {
    expect(lostLocks([d('Stack', 'Next.js', true)], [d('Stack', 'Next.js')])).toEqual(['Stack'])
  })

  it('lists several in prev order and ignores unlocked prev decisions', () => {
    const prev = [d('A', '1', true), d('B', '2'), d('C', '3', true)]
    expect(lostLocks(prev, [])).toEqual(['A', 'C'])
  })

  it('handles undefined', () => {
    expect(lostLocks(undefined, undefined)).toEqual([])
    expect(lostLocks([d('A', '1', true)], undefined)).toEqual(['A'])
  })
})

describe('resolveContest (#197 Part A)', () => {
  const contest = { proposed: 'Square', reason: 'switched POS' }
  const list = (): BriefDecision[] => [
    { topic: 'Payment', decision: 'Stripe only', locked: true, contested: contest, decided_at: '2026-01-01T00:00:00.000Z' },
    d('Auth', 'Google'),
  ]

  it('accept: takes the proposed text, keeps the lock, clears contested', () => {
    expect(resolveContest(list(), 'payment', 'accept')).toEqual([
      { topic: 'Payment', decision: 'Square', locked: true, decided_at: '2026-01-01T00:00:00.000Z' },
      d('Auth', 'Google'),
    ])
  })

  it('accept_unlock: takes the proposed text and removes the lock', () => {
    expect(resolveContest(list(), 'Payment', 'accept_unlock')).toEqual([
      { topic: 'Payment', decision: 'Square', decided_at: '2026-01-01T00:00:00.000Z' },
      d('Auth', 'Google'),
    ])
  })

  it('dismiss: clears contested and changes nothing else', () => {
    expect(resolveContest(list(), 'Payment', 'dismiss')).toEqual([
      { topic: 'Payment', decision: 'Stripe only', locked: true, decided_at: '2026-01-01T00:00:00.000Z' },
      d('Auth', 'Google'),
    ])
  })

  it('returns the list unchanged for a topic with no contest', () => {
    const l = list()
    expect(resolveContest(l, 'Auth', 'accept')).toEqual(l)
    expect(resolveContest(l, 'Nope', 'dismiss')).toEqual(l)
  })
})

describe('contestFor (#197)', () => {
  it('accepts a well-formed contest on a locked decision only', () => {
    expect(contestFor(true, { proposed: 'Square', reason: 'why' })).toEqual({ proposed: 'Square', reason: 'why' })
    expect(contestFor(false, { proposed: 'Square', reason: 'why' })).toBeUndefined()
  })
  it('rejects malformed input', () => {
    expect(contestFor(true, undefined)).toBeUndefined()
    expect(contestFor(true, 'Square')).toBeUndefined()
    expect(contestFor(true, { proposed: '', reason: 'why' })).toBeUndefined()
    expect(contestFor(true, { proposed: 'Square', reason: 3 })).toBeUndefined()
    expect(contestFor(true, { proposed: 'Square' })).toBeUndefined()
  })
})
```

(Also import `contestFor` and `BriefDecisionContest` where needed; `d` is the existing test helper.)

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run lib/api/__tests__/brief-merge.test.ts`
Expected: FAIL (lostLocks / resolveContest not exported; contested assertions fail).

- [ ] **Step 4: Implement**

In `lib/api/brief-merge.ts`, replace the body of `mergeLockedDecisions` from `const lockedKeys` down with:

```ts
  const lockedKeys = new Set(lockedPrev.map(topicKey))
  const nextByKey = new Map(nextList.map((d) => [topicKey(d), d]))

  // Keep regen's non-locked-topic decisions in order; drop any that collide with
  // a locked topic (regen may have reworded a locked decision under its topic —
  // the locked verbatim version wins). A contest only makes sense on a lock, so
  // it is stripped from everything else (#197).
  const fromNext = nextList
    .filter((d) => !lockedKeys.has(topicKey(d)))
    .map(withoutContest)

  // Locked decisions first (durable, prominent), then regen's contributions.
  // #197: a locked decision keeps its text verbatim but picks up `contested`
  // when regen emitted one for its topic; an existing contest is carried
  // forward until a builder rules on it (regen never clears a contest).
  return [
    ...lockedPrev.map((d) => {
      const incoming = nextByKey.get(topicKey(d))?.contested
      return { ...d, locked: true, ...(incoming ? { contested: incoming } : {}) }
    }),
    ...fromNext,
  ]
```

Note the early return `if (lockedPrev.length === 0) return nextList` must become `if (lockedPrev.length === 0) return nextList.map(withoutContest)`.

Add the helpers:

```ts
function withoutContest(d: BriefDecision): BriefDecision {
  if (d.contested === undefined) return d
  const rest = { ...d }
  delete rest.contested
  return rest
}

// --- #197 Part B: which locks would a save drop? ---
// Topics (spelled as in `prev`) locked in `prev` that `next` does not carry as
// locked — missing entirely or present but unlocked. Pure; the Brief tab and
// History → Restore use it to ask before submitting.
export function lostLocks(
  prev: BriefDecision[] | undefined,
  next: BriefDecision[] | undefined,
): string[] {
  const nextLocked = new Set((next ?? []).filter((d) => d.locked).map(topicKey))
  return (prev ?? [])
    .filter((d) => d.locked && !nextLocked.has(topicKey(d)))
    .map((d) => d.topic)
}

// Accept a `contested` value only when it is well-formed AND the decision is
// locked (#197). Used by every write path that takes decisions from outside
// (regen coercion, PUT /api/briefs, the raw-JSON normaliser).
export function contestFor(
  locked: boolean,
  raw: unknown,
): BriefDecisionContest | undefined {
  if (!locked || !raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  if (typeof c.proposed !== 'string' || !c.proposed.trim()) return undefined
  if (typeof c.reason !== 'string' || !c.reason.trim()) return undefined
  return { proposed: c.proposed, reason: c.reason }
}

// --- #197 Part A: builder rules on a contested lock ---
export type ContestAction = 'accept' | 'accept_unlock' | 'dismiss'

// accept        → decision text becomes the proposal, lock kept
// accept_unlock → decision text becomes the proposal, lock removed
// dismiss       → nothing changes but the contest is cleared
// Pure; a topic with no contest returns the list unchanged.
export function resolveContest(
  decisions: BriefDecision[],
  topic: string,
  action: ContestAction,
): BriefDecision[] {
  const key = topic.trim().toLowerCase()
  return decisions.map((d) => {
    if (topicKey(d) !== key || !d.contested) return d
    const base = withoutContest(d)
    if (action === 'dismiss') return base
    const accepted = { ...base, decision: d.contested.proposed }
    if (action === 'accept') return accepted
    const unlocked = { ...accepted }
    delete unlocked.locked
    return unlocked
  })
}
```

- [ ] **Step 5: Run tests, type-check, lint**

Run: `npx vitest run lib/api/__tests__/brief-merge.test.ts && npm run type-check && npm run lint`
Expected: all PASS / clean. (Existing merge tests must still pass unchanged.)

- [ ] **Step 6: Commit**

```bash
git add lib/types/index.ts lib/api/brief-merge.ts lib/api/__tests__/brief-merge.test.ts
git commit -m "feat(brief-merge): contested field on locked decisions, lostLocks and resolveContest helpers (#197)"
```

---

### Task 2: Regen — schema, prompt rule, coercion

**Files:**
- Modify: `lib/api/briefs.ts` (UPDATE_BRIEF_TOOL ~line 35-50; coercion ~line 203-212)
- Modify: `lib/agent/next-convo-prompt.ts` (lock rule, line 58)
- Test: `lib/api/__tests__/briefs.test.ts`
- Snapshot: `lib/agent/__tests__/__snapshots__/prep-prompts-snapshot.test.ts.snap` (refresh)

**Interfaces:**
- Consumes: `mergeLockedDecisions` contested behaviour from Task 1 (via `reconcileBrief`).
- Produces: regen persists `contested` on a locked topic when the model emits a well-formed one.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('regenerateBriefForProject', …)` in `lib/api/__tests__/briefs.test.ts`, after the `ignores a lock the model invents` test:

```ts
  // #197 — regen may contest a lock but never remove it.
  function seedLockedPayment(extra: Record<string, unknown> = {}) {
    sessionsByProject.p1 = [{ id: 's1', data: () => ({}) }]
    messagesBySession.s1 = [{ id: 'm1', data: () => ({ role: 'user', content: 'hi' }) }]
    projectDocs.p1 = { exists: true, data: () => ({ title: 'X' }) }
    briefsByProject.p1 = [
      {
        id: 'brief-1',
        data: () => ({
          version: 2,
          content: {
            ...validBrief,
            decisions: [
              { topic: 'Payment', decision: 'Stripe only', locked: true, decided_in_session: 's0', decided_at: '2026-01-01T00:00:00.000Z', ...extra },
            ],
          },
        }),
        ref: briefRef,
      },
    ]
  }
  const persistedDecisions = () =>
    (mockBriefUpdate.mock.calls[0] as unknown as [{ content: { decisions: Array<Record<string, unknown>> } }])[0].content.decisions

  it('keeps a model-emitted contested on a locked topic; text, lock and stamps unchanged (#197)', async () => {
    seedLockedPayment()
    const contested = { proposed: 'Square', reason: 'switched POS provider, confirmed in conversation 3' }
    mockMessagesCreate.mockResolvedValue(
      toolUseResponse({ ...validBrief, decisions: [{ topic: 'Payment', decision: 'Square', contested }] }),
    )
    await regenerateBriefForProject(makeDb(), 'p1')
    expect(persistedDecisions()).toEqual([
      { topic: 'Payment', decision: 'Stripe only', locked: true, contested, decided_in_session: 's0', decided_at: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('drops contested on an unlocked topic and still drops a model-emitted lock (#197)', async () => {
    seedLockedPayment()
    mockMessagesCreate.mockResolvedValue(
      toolUseResponse({
        ...validBrief,
        decisions: [
          { topic: 'Payment', decision: 'Stripe only' },
          { topic: 'Auth', decision: 'Google', locked: true, contested: { proposed: 'Email', reason: 'x' } },
        ],
      }),
    )
    await regenerateBriefForProject(makeDb(), 'p1')
    const byTopic = Object.fromEntries(persistedDecisions().map((d) => [d.topic as string, d]))
    expect(byTopic.Auth.locked).toBeUndefined()
    expect(byTopic.Auth.contested).toBeUndefined()
    expect(byTopic.Payment.contested).toBeUndefined()
  })

  it('drops a malformed contested (missing or empty fields) (#197)', async () => {
    seedLockedPayment()
    mockMessagesCreate.mockResolvedValue(
      toolUseResponse({ ...validBrief, decisions: [{ topic: 'Payment', decision: 'Stripe only', contested: { proposed: '', reason: 'x' } }] }),
    )
    await regenerateBriefForProject(makeDb(), 'p1')
    expect(persistedDecisions()[0].contested).toBeUndefined()
  })

  it('carries an existing contested forward when the model omits it (#197)', async () => {
    const contested = { proposed: 'Square', reason: 'earlier' }
    seedLockedPayment({ contested })
    mockMessagesCreate.mockResolvedValue(
      toolUseResponse({ ...validBrief, decisions: [{ topic: 'Payment', decision: 'Stripe only' }] }),
    )
    await regenerateBriefForProject(makeDb(), 'p1')
    expect(persistedDecisions()[0].contested).toEqual(contested)
  })

  it('advertises contested in the update_brief tool schema (#197)', async () => {
    seedLockedPayment()
    mockMessagesCreate.mockResolvedValue(toolUseResponse(validBrief))
    await regenerateBriefForProject(makeDb(), 'p1')
    const args = mockMessagesCreate.mock.calls[0][0]
    const decisionProps = args.tools[0].input_schema.properties.decisions.items.properties
    expect(decisionProps.contested.required).toEqual(['proposed', 'reason'])
    expect(args.system[0].text).toMatch(/contested/)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/api/__tests__/briefs.test.ts`
Expected: the five new tests FAIL.

- [ ] **Step 3: Schema**

In `UPDATE_BRIEF_TOOL`, after the `locked` property inside `decisions.items.properties`:

```ts
            contested: {
              type: 'object',
              description:
                'Only on a decision that is locked. Fill this when the maker explicitly confirmed, in the conversation, that they want the locked decision reversed: proposed = what they want instead, reason = why and when they confirmed it. Keep topic, decision and locked unchanged — never drop or reword a locked decision.',
              properties: {
                proposed: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['proposed', 'reason'],
            },
```

- [ ] **Step 4: Coercion**

Replace the decisions coercion in `regenerateBriefForProject` with:

```ts
    decisions: Array.isArray(raw.decisions)
      ? raw.decisions
          .filter(
            (d): d is BriefDecision =>
              !!d && typeof d.topic === 'string' && typeof d.decision === 'string',
          )
          // Only builders set locks (#182). A `locked` flag the model emits is
          // dropped here; the locks that exist come back verbatim from the
          // previous brief in reconcileBrief below. A well-formed `contested`
          // (#197) rides through; reconcileBrief keeps it only on a real lock.
          .map((d) => {
            // `locked: true` here only means "shape-check the contest"; the
            // merge below keeps it solely on a decision that is really locked.
            const contested = contestFor(true, d.contested)
            return { topic: d.topic, decision: d.decision, ...(contested ? { contested } : {}) }
          })
      : [],
```

(Import `BriefDecision` from `@/lib/types` alongside `BriefContent` if not already, and `contestFor` from `./brief-merge` next to `reconcileBrief`.)

- [ ] **Step 5: Prompt rule**

In `lib/agent/next-convo-prompt.ts` replace the single `locked` bullet (line 58) with exactly:

```
- A decision may carry \`"locked": true\` — a durable constraint (e.g. a locked convention or do-not-use rule). NEVER drop, reword, or unset a locked decision; carry it forward verbatim with \`"locked": true\`. If the conversation contains a statement that contradicts a locked decision but the user did not explicitly confirm reversing it, keep the locked decision as-is and record the contradiction in \`open_risks\` (e.g. "conflicts with locked decision: <topic>"). If the user DID explicitly confirm the reversal, keep the locked decision as-is and add \`"contested": { "proposed": "<what they want instead>", "reason": "<why, and when they confirmed it>" }\` on that decision instead of an open risk — a builder decides whether the lock changes. Never set \`contested\` on an unlocked decision.
```

- [ ] **Step 6: Tests, snapshot, gates**

Run: `npx vitest run lib/api/__tests__/briefs.test.ts` → PASS.
Run: `npx vitest run lib/agent/__tests__/prep-prompts-snapshot.test.ts` → expect snapshot FAIL on the lock line only; then `npx vitest run lib/agent/__tests__/prep-prompts-snapshot.test.ts -u` and check `git diff lib/agent/__tests__/__snapshots__/` shows only that bullet changing.
Run: `npm test && npm run type-check && npm run lint` → clean.

- [ ] **Step 7: Commit**

```bash
git add lib/api/briefs.ts lib/agent/next-convo-prompt.ts lib/api/__tests__/briefs.test.ts lib/agent/__tests__/__snapshots__/
git commit -m "feat(regen): model may contest a locked decision, never remove it (#197)"
```

---

### Task 3: PUT route, JSON normaliser, chat-prompt suffix

**Files:**
- Modify: `app/api/briefs/route.ts` (decisions normalisation ~line 72-90)
- Modify: `lib/api/brief-json.ts` (`normalizeBriefContent` decisions loop)
- Modify: `lib/agent/system-prompt.ts` (locked block ~line 157-167)
- Test: `app/api/briefs/__tests__/briefs.test.ts`, `lib/api/__tests__/brief-json.test.ts`, `lib/agent/__tests__/system-prompt.test.ts`

**Interfaces:**
- Consumes: `BriefDecisionContest` type (Task 1).
- Produces: `contested` survives a PUT and a raw-view round-trip on a locked decision; the chat prompt shows a contested suffix.

- [ ] **Step 1: Failing tests**

`app/api/briefs/__tests__/briefs.test.ts`, inside `describe('PUT /api/briefs')`, after the `preserves the locked flag` test:

```ts
  it('keeps contested on a locked decision and drops it elsewhere or when malformed (#197)', async () => {
    const contested = { proposed: 'Square', reason: 'switched POS' }
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: {
        ...validContent,
        decisions: [
          { topic: 'Payment', decision: 'Stripe only', locked: true, contested },
          { topic: 'Auth', decision: 'Google', contested },
          { topic: 'DB', decision: 'Firestore', locked: true, contested: { proposed: 'x' } },
        ],
      },
    }))
    const decisions = mockUpsertBrief.mock.calls[0][2].decisions
    expect(decisions[0].contested).toEqual(contested)
    expect(decisions[1].contested).toBeUndefined()
    expect(decisions[2].contested).toBeUndefined()
  })
```

`lib/api/__tests__/brief-json.test.ts`, inside `describe('normalizeBriefContent')`:

```ts
  it('keeps contested on a locked decision only, and only when well-formed (#197)', () => {
    const contested = { proposed: 'Square', reason: 'switched POS' }
    const r = normalizeBriefContent({
      decisions: [
        { topic: 'Payment', decision: 'Stripe only', locked: true, contested },
        { topic: 'Auth', decision: 'Google', contested },
        { topic: 'DB', decision: 'Firestore', locked: true, contested: { proposed: 'x', reason: 3 } },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.decisions).toEqual([
        { topic: 'Payment', decision: 'Stripe only', locked: true, contested },
        { topic: 'Auth', decision: 'Google' },
        { topic: 'DB', decision: 'Firestore', locked: true },
      ])
    }
  })
```

`lib/agent/__tests__/system-prompt.test.ts`, after the `renders locked decisions in a separate reconciliation block` test:

```ts
  it('marks a contested lock so the agent neither reopens nor adopts it (#197)', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: {
        ...emptyBrief,
        decisions: [
          { topic: 'Payment', decision: 'Stripe only', locked: true, contested: { proposed: 'Square', reason: 'switched POS, confirmed in conversation 3' } },
          { topic: 'Stack', decision: 'Next.js, no Vue', locked: true },
        ],
      },
    })
    expect(result).toContain('**Payment:** Stripe only — contested: the maker confirmed they want "Square" (switched POS, confirmed in conversation 3). A builder will decide; don\'t reopen it and don\'t treat it as changed.')
    expect(result).toContain('**Stack:** Next.js, no Vue\n')
    expect(result).not.toContain('**Stack:** Next.js, no Vue — contested')
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/api/briefs lib/api/__tests__/brief-json.test.ts lib/agent/__tests__/system-prompt.test.ts`
Expected: three new tests FAIL.

- [ ] **Step 3: Shared validator**

`contestFor(locked, raw)` already exists in `lib/api/brief-merge.ts` (Task 1). Import it in the route and the normaliser.

- [ ] **Step 4: Route**

In `app/api/briefs/route.ts` decisions `.map`, after the `locked` spread add:

```ts
            // #197: a contest survives a round-trip only on a locked decision.
            ...(contestFor(d.locked === true, d.contested) && { contested: contestFor(d.locked === true, d.contested) }),
```

(Prefer computing `const contested = contestFor(d.locked === true, d.contested)` once per decision; restructure the arrow to a block body.) Import `contestFor` from `@/lib/api/brief-merge`.

- [ ] **Step 5: JSON normaliser**

In `lib/api/brief-json.ts` decisions loop, after the `locked` spread:

```ts
        ...(() => {
          const contested = contestFor(dd.locked === true, dd.contested)
          return contested ? { contested } : {}
        })(),
```

(Or compute `contested` above the `decisions.push` and spread it — either is fine; keep it readable.) Import `contestFor`.

- [ ] **Step 6: Chat prompt suffix**

In `lib/agent/system-prompt.ts`, replace the locked-decisions line mapping with:

```ts
${lockedDecisions.map((d) => `- **${d.topic}:** ${d.decision}${contestSuffix(d)}`).join('\n')}
```

and add near the other helpers in that file:

```ts
// #197: a contested lock is shown as still standing, with what the maker asked
// for, so the agent neither re-litigates it each session nor treats it as done.
function contestSuffix(d: BriefDecision): string {
  if (!d.contested) return ''
  return ` — contested: the maker confirmed they want "${d.contested.proposed}" (${d.contested.reason}). A builder will decide; don't reopen it and don't treat it as changed.`
}
```

(Import `BriefDecision` type if the file doesn't already.)

- [ ] **Step 7: Gates**

Run: `npm test && npm run type-check && npm run lint` → clean. If `lib/agent/__tests__/prep-prompts-snapshot.test.ts` or any other snapshot changes here, STOP and report — only Task 2 is allowed to touch snapshots.

- [ ] **Step 8: Commit**

```bash
git add app/api/briefs/route.ts lib/api/brief-json.ts lib/api/brief-merge.ts lib/agent/system-prompt.ts app/api/briefs/__tests__/briefs.test.ts lib/api/__tests__/brief-json.test.ts lib/agent/__tests__/system-prompt.test.ts
git commit -m "feat(briefs): contested survives PUT and the raw view on a lock; chat prompt marks a contested lock (#197)"
```

---

### Task 4: Brief tab — accept/dismiss, save guard, restore guard, copy

**Files:**
- Modify: `lib/copy.ts` (`brief` block)
- Modify: `components/builder/BriefEditor.tsx`
- Modify: `components/builder/BriefHistory.tsx`
- Create: `components/builder/__tests__/BriefEditor.test.tsx`
- Modify: `components/builder/__tests__/BriefHistory.test.tsx`

**Interfaces:**
- Consumes: `lostLocks`, `resolveContest`, `ContestAction` from `@/lib/api/brief-merge`; `useUpdateBrief` (`mutateAsync({ project_id, content, source? })`, `isPending`, `error`).
- Produces: `BriefHistory` gains optional prop `currentDecisions?: BriefDecision[]`.

- [ ] **Step 1: Copy**

In `lib/copy.ts` `brief:` block, after `cancelRestore`, add:

```ts
    confirmRestoreLockLoss: (version: number, topics: string[]) =>
      `Restore v${version}? This removes the lock on: ${topics.join(', ')}. The current brief is kept in history.`,
    // #197 — contested locks and the lock-loss guard
    contestedBadge: 'Contested',
    contestedLine: (proposed: string, reason: string) => `Maker wants: ${proposed} — ${reason}`,
    contestAccept: 'Accept, keep locked',
    contestAcceptUnlock: 'Accept and unlock',
    contestDismiss: 'Dismiss',
    contestError: "Couldn't save that — try again.",
    lockLossWarning: (topics: string[]) => `This save removes the lock on: ${topics.join(', ')}. Continue?`,
    lockLossConfirm: 'Yes, save',
    lockLossCancel: 'Cancel',
```

- [ ] **Step 2: Failing component tests**

Create `components/builder/__tests__/BriefEditor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

const mockMutateAsync = vi.fn(async () => ({}))
vi.mock('@/lib/query/hooks', () => ({
  useUpdateBrief: () => ({ mutateAsync: mockMutateAsync, isPending: false, error: null }),
}))
vi.mock('../BriefHistory', () => ({ BriefHistory: () => null }))

import { BriefEditor } from '../BriefEditor'
import type { BriefContent } from '@/lib/types'

const contested = { proposed: 'Square', reason: 'switched POS, confirmed in conversation 3' }
const base: BriefContent = {
  problem: 'Customers cannot order online',
  target_users: 'Cafe customers',
  features: [],
  constraints: '',
  additional_context: '',
  decisions: [
    { topic: 'Payment', decision: 'Stripe only', locked: true, contested },
    { topic: 'Stack', decision: 'Next.js', locked: true },
    { topic: 'Auth', decision: 'Google' },
  ],
  open_risks: [],
}

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const renderEditor = () => render(<BriefEditor projectId="p1" content={base} version={3} />)
const savedDecisions = () => (mockMutateAsync.mock.calls[0] as unknown as [{ content: BriefContent }])[0].content.decisions

describe('BriefEditor — contested locks (#197 Part A)', () => {
  it('shows the contest and three actions on a contested lock only', () => {
    renderEditor()
    expect(screen.getByText('Contested')).toBeTruthy()
    expect(screen.getByText(/Maker wants: Square — switched POS/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Accept, keep locked' })).toHaveLength(1)
  })

  it('Accept, keep locked saves the proposal with the lock kept and contest cleared', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Accept, keep locked' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()).toEqual([
      { topic: 'Payment', decision: 'Square', locked: true },
      { topic: 'Stack', decision: 'Next.js', locked: true },
      { topic: 'Auth', decision: 'Google' },
    ])
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({ project_id: 'p1' })
  })

  it('Accept and unlock saves the proposal unlocked, without the lock-loss guard', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Accept and unlock' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()[0]).toEqual({ topic: 'Payment', decision: 'Square' })
    expect(screen.queryByText(/removes the lock on/)).toBeNull()
  })

  it('Dismiss keeps text and lock, clears the contest', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()[0]).toEqual({ topic: 'Payment', decision: 'Stripe only', locked: true })
  })
})

describe('BriefEditor — lock-loss guard (#197 Part B)', () => {
  const enterRaw = () => {
    fireEvent.click(screen.getByRole('button', { name: /Edit brief/ }))
    fireEvent.click(screen.getByRole('button', { name: /Raw JSON/ }))
    return screen.getByRole('textbox') as HTMLTextAreaElement
  }

  it('asks before a raw save that unlocks or drops a locked topic, then saves on Yes', async () => {
    renderEditor()
    const ta = enterRaw()
    fireEvent.change(ta, {
      target: {
        value: JSON.stringify({ ...base, decisions: [{ topic: 'Payment', decision: 'Stripe only' }, { topic: 'Auth', decision: 'Google' }] }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('This save removes the lock on: Payment, Stack. Continue?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()).toEqual([
      { topic: 'Payment', decision: 'Stripe only' },
      { topic: 'Auth', decision: 'Google' },
    ])
  })

  it('Cancel keeps the draft and saves nothing', () => {
    renderEditor()
    const ta = enterRaw()
    fireEvent.change(ta, { target: { value: JSON.stringify({ ...base, decisions: [] }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(screen.queryByText(/removes the lock on/)).toBeNull()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('"decisions": []')
  })

  it('saves straight away when every lock survives (text edits, new decisions)', async () => {
    renderEditor()
    const ta = enterRaw()
    fireEvent.change(ta, {
      target: {
        value: JSON.stringify({
          ...base,
          decisions: [...(base.decisions ?? []).map((d) => ({ ...d, decision: d.decision + '!' })), { topic: 'DB', decision: 'Firestore' }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(screen.queryByText(/removes the lock on/)).toBeNull()
  })
})
```

Note: the guard's Cancel button must be distinguishable from the editor's existing Cancel. Give the guard's cancel the accessible name `Cancel` and ensure only ONE button named exactly `Cancel` is rendered while the guard is showing (hide the editor's Save/Cancel row while the guard is up). If that proves awkward, name the guard button `Keep editing` and update the test and copy (`lockLossCancel`) accordingly — record which in the report.

In `components/builder/__tests__/BriefHistory.test.tsx`, add:

```tsx
  it('restore confirm names the locks that would be lost (#197)', () => {
    render(
      <BriefHistory
        projectId="p1"
        currentDecisions={[{ topic: 'Payment', decision: 'Stripe only', locked: true }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    expect(screen.getByText('Restore v3? This removes the lock on: Payment. The current brief is kept in history.')).toBeTruthy()
  })

  it('restore confirm stays generic when no lock would be lost (#197)', () => {
    mockVersions = [
      { version: 3, content: { problem: 'v3', decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true }] }, updated_at: '2026-10-10T19:12:00.000Z', source: 'regen', archived_at: '2026-10-11T00:00:00.000Z' },
    ]
    render(
      <BriefHistory
        projectId="p1"
        currentDecisions={[{ topic: 'Payment', decision: 'Stripe only', locked: true }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(screen.getByText(/Restore v3\? The current brief is kept in history/)).toBeTruthy()
  })
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run components/builder`
Expected: new tests FAIL.

- [ ] **Step 4: BriefHistory**

```tsx
export function BriefHistory({
  projectId,
  currentDecisions,
}: {
  projectId: string
  // #197: the live brief's decisions, so Restore can name the locks it would drop.
  currentDecisions?: BriefDecision[]
}) {
```

and in the confirm span:

```tsx
                  <span className="text-gray-700">
                    {(() => {
                      const lost = lostLocks(currentDecisions, (v.content as BriefContent | undefined)?.decisions)
                      return lost.length > 0 ? c.confirmRestoreLockLoss(v.version, lost) : c.confirmRestore(v.version)
                    })()}
                  </span>
```

(Extract to a small `restoreConfirmCopy(v)` helper inside the component rather than an IIFE if that reads better.) Import `lostLocks` and the types.

- [ ] **Step 5: BriefEditor**

Imports: add `lostLocks, resolveContest, type ContestAction` from `@/lib/api/brief-merge`, `copy` from `@/lib/copy`, and `AlertTriangle` from lucide-react (optional icon for the guard).

State in `BriefEditor`:

```tsx
  // #197 Part B: a save that would drop a lock is held here until confirmed.
  const [pendingSave, setPendingSave] = useState<{ content: BriefContent; lost: string[] } | null>(null)
  // #197 Part A: which contested topic is being resolved (disables the buttons).
  const [resolveError, setResolveError] = useState<string | null>(null)
```

Replace `handleSave` with:

```tsx
  const submit = async (toSave: BriefContent) => {
    setPendingSave(null)
    await updateBrief.mutateAsync({ project_id: projectId, content: toSave })
    setMode('view') // saved — back to the read view
  }

  const handleSave = async () => {
    let toSave: BriefContent
    if (editView === 'raw') {
      const r = parseBriefJson(rawText)
      if (!r.ok) {
        setError(r.error)
        return
      }
      toSave = r.value
      setDraft(r.value)
    } else {
      toSave = draft
    }
    setError(null)
    // #197 Part B: never drop a lock silently — ask first.
    const lost = lostLocks(base.decisions, toSave.decisions)
    if (lost.length > 0) {
      setPendingSave({ content: toSave, lost })
      return
    }
    await submit(toSave)
  }

  // #197 Part A: builder rules on a contested lock. Saves the whole brief with
  // that one decision changed through the normal PUT (provenance stamps the
  // accepted text as decided out-of-band; the outgoing version is archived).
  // Deliberate, so it bypasses the lock-loss guard.
  const resolve = async (topic: string, action: ContestAction) => {
    setResolveError(null)
    try {
      await updateBrief.mutateAsync({
        project_id: projectId,
        content: { ...base, decisions: resolveContest(base.decisions ?? [], topic, action) },
      })
    } catch {
      setResolveError(copy.brief.contestError)
    }
  }
```

Also reset `setPendingSave(null)` in the `version` effect and in `cancelEdit`/`enterEdit`.

Read view: pass `onResolve={resolve}`, `resolving={updateBrief.isPending}`, `resolveError={resolveError}` to `DecisionsSection`, and `currentDecisions={base.decisions}` to `BriefHistory`.

Edit mode footer: when `pendingSave` is set, render the guard INSTEAD of the Save/Cancel row:

```tsx
        {pendingSave ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 pt-3 border-t border-gray-100 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden />
            <span className="text-gray-800">{copy.brief.lockLossWarning(pendingSave.lost)}</span>
            <LoadingButton
              variant="primary"
              size="sm"
              loading={updateBrief.isPending}
              loadingText="Saving…"
              onClick={() => submit(pendingSave.content)}
            >
              {copy.brief.lockLossConfirm}
            </LoadingButton>
            <button onClick={() => setPendingSave(null)} className="text-xs text-gray-500 hover:text-gray-800">
              {copy.brief.lockLossCancel}
            </button>
          </div>
        ) : (
          /* existing Save brief / Cancel row, unchanged */
        )}
```

`DecisionsSection` props become:

```tsx
function DecisionsSection({
  decisions,
  sessions,
  onResolve,
  resolving,
  resolveError,
}: {
  decisions: BriefDecision[] | undefined
  sessions?: Session[]
  onResolve: (topic: string, action: ContestAction) => void
  resolving: boolean
  resolveError: string | null
})
```

and inside each `<li>`, after the existing `Locked` badge:

```tsx
                {d.locked && d.contested && (
                  <span
                    className="inline-flex items-center mr-1.5 px-1 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-semibold uppercase tracking-wide align-middle"
                    title="The maker confirmed in conversation that they want this changed — you decide"
                  >
                    {copy.brief.contestedBadge}
                  </span>
                )}
```

and after the provenance suffix, still inside the `<li>`:

```tsx
                {d.locked && d.contested && (
                  <div className="mt-1 ml-1 pl-2 border-l-2 border-rose-200 text-xs">
                    <p className="text-gray-700">{copy.brief.contestedLine(d.contested.proposed, d.contested.reason)}</p>
                    <div className="mt-1 flex flex-wrap gap-3">
                      <button disabled={resolving} onClick={() => onResolve(d.topic, 'accept')} className="font-medium text-brand-navy hover:underline disabled:opacity-40">{copy.brief.contestAccept}</button>
                      <button disabled={resolving} onClick={() => onResolve(d.topic, 'accept_unlock')} className="font-medium text-brand-navy hover:underline disabled:opacity-40">{copy.brief.contestAcceptUnlock}</button>
                      <button disabled={resolving} onClick={() => onResolve(d.topic, 'dismiss')} className="text-gray-500 hover:underline disabled:opacity-40">{copy.brief.contestDismiss}</button>
                    </div>
                  </div>
                )}
```

and after the `</ul>`: `{resolveError && <p className="mt-2 text-xs text-red-500">{resolveError}</p>}`.

The structured editor's `DecisionsField` needs no change (it edits `topic`/`decision`/`locked`; `contested` rides along on the object spread, and the server strips it if the builder unlocks).

- [ ] **Step 6: Gates**

Run: `npx vitest run components/builder && npm test && npm run type-check && npm run lint` → clean.

- [ ] **Step 7: Commit**

```bash
git add lib/copy.ts components/builder/BriefEditor.tsx components/builder/BriefHistory.tsx components/builder/__tests__/BriefEditor.test.tsx components/builder/__tests__/BriefHistory.test.tsx
git commit -m "feat(brief-tab): accept/dismiss a contested lock; confirm before a save or restore drops a lock (#197)"
```

---

### Task 5: Docs

**Files:**
- Modify: `CLAUDE.md` (Data Model `briefs` bullet; Project Setup JSON locked paragraph; Next Steps `2026-10-08 follow-through` paragraph)
- Modify: `docs/changelog.md` (prepend)
- Modify: `docs/brief-rules-digest.md` (the two drift rows about paste unlocking and regen vs. locks, if present — mark resolved by #197)

- [ ] **Step 1: CLAUDE.md**

In the Project Setup JSON paragraph that starts `A decision may carry "locked": true`, append:

> Since #197 regen may **contest** a lock instead: when the maker explicitly confirmed a reversal in conversation, the model fills `contested: { proposed, reason }` on the locked decision; the text and lock stay verbatim, the chat prompt shows the contest so Sam neither reopens nor adopts it, and the Brief tab shows a `Contested` badge with **Accept, keep locked** / **Accept and unlock** / **Dismiss** (all save through `PUT /api/briefs`, source `paste`). `contested` is only ever kept on a locked decision. Any Brief-tab save (structured or raw) or History → Restore that would drop a lock asks first ("This save removes the lock on: …"); direct PUT callers get no prompt.

In Next Steps, after `Digest Q1 decided → **#197** …` add: `**#197 SHIPPED 2026-10-15** (spec `docs/superpowers/specs/2026-10-15-lock-contest.md`).`

- [ ] **Step 2: Changelog**

Prepend to `docs/changelog.md` under the top heading (match the existing entry style):

```
**2026-10-15 (#197 lock contest):** Regen may contest a locked decision but never remove it. `BriefDecision.contested { proposed, reason }` — the `update_brief` tool schema and `NEXT_CONVO_SYSTEM_PROMPT` tell the model to fill it only when the maker explicitly confirmed a reversal (an unconfirmed contradiction still goes to `open_risks`); `mergeLockedDecisions` keeps the lock verbatim and copies/carries `contested`, and strips it from any unlocked decision; `PUT /api/briefs` and the raw-JSON normaliser keep it on a lock only (`contestFor`). Chat prompt: a contested lock's line says what the maker wants and that a builder decides. Brief tab: `Contested` badge + Accept-keep-locked / Accept-and-unlock / Dismiss (`resolveContest`, saved through the normal PUT). Part B: `lostLocks` guards every Brief-tab save with an inline "This save removes the lock on: X. Continue?" and History → Restore's confirm names the locks it would drop. Spec `docs/superpowers/specs/2026-10-15-lock-contest.md`, plan `docs/superpowers/plans/2026-10-15-lock-contest.md`.
```

- [ ] **Step 3: Digest**

`grep -n "unlock\|locked" docs/brief-rules-digest.md`; for the row(s) stating that a paste can unlock a locked decision silently, or that regen and the chat prompt disagree on reversals, append ` — resolved by #197 (2026-10-15)`. Do not rewrite the rows.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/changelog.md docs/brief-rules-digest.md
git commit -m "docs: lock contest (#197)"
```
