# Brief Reader Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code in a build repo reads the current brief, its unfolded notes, and what is shipped and queued, through the existing read-only reader, started with a key fetched from 1Password.

**Architecture:** The pure markdown renderer (`scripts/lib/brief-markdown.mjs`) gains the missing sections. The reader (`scripts/mcp-briefs.mjs`) and the exporter (`scripts/export-brief.mjs`) load unfolded notes and pass them in. A new launcher (`scripts/brief-reader.mjs`) gets the read-only key from the environment or 1Password and starts the reader; its key handling lives in a pure module so it is tested without 1Password.

**Tech Stack:** Node ESM scripts (`.mjs`), vitest, firebase-admin, `@modelcontextprotocol/sdk`, the `op` CLI (at run time only).

**Spec:** `docs/superpowers/specs/2026-11-15-brief-reader-notes-design.md`

## Global Constraints

- Never run `op`, and never read, write or name any env file in a shell command. A hook rejects them, and tests must not need 1Password.
- The key is never printed, logged or put in an error message, in whole or in part.
- The launcher writes nothing to stdout itself. The reader speaks its protocol on stdout; everything the launcher says goes to stderr.
- `thumbs_down` and note ids are never rendered.
- `scripts/with-prod-env-ro.mjs` is not changed.
- Dates shown to a reader are `America/Los_Angeles`, never a UTC slice. `brief-markdown.mjs` already has `pacificDay(iso)` (`YYYY-MM-DD`).
- An existing caller that passes no `notes`, on a brief with no new fields, gets byte-identical output: the existing exact-output test in `scripts/lib/brief-markdown.test.mjs` must pass unedited.
- Plain code, commented where it is not obvious. No new dependencies.
- Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Run one test file with `npx vitest run <path>`. Before finishing a task run `npm test` and `npm run lint`.

## Review Focus

1. A note written before 2026-11-15 has `risks_resolved` as plain strings, and may lack whole fields (`lock_reversals`, `risks_added`). It renders, with no arrow and no crash. (Task 1)
2. A note whose `session_id` is null or names an archived conversation (not in `sessions`). Its heading shows the day alone, never "conversation undefined". (Task 1)
3. 1Password returns an empty string instead of failing (a known trap with this document item). The launcher refuses it with a plain line, and does not start the reader with an empty key. (Task 3)
4. `op` is not installed, not signed in, or Touch ID is cancelled. One plain stderr line, exit code 1, no stack trace, nothing from `op`'s output echoed. (Task 3)
5. A `shipped` entry that is not `{ date, items[] }` (hand-edited brief). It is skipped; the rest renders. (Task 1)

---

### Task 1: The brief markdown gains notes, shipped, queued, contested locks and a coverage line

**Files:**
- Modify: `scripts/lib/brief-markdown.mjs` (`renderBriefMd`, plus two small helpers)
- Test: `scripts/lib/brief-markdown.test.mjs`

**Interfaces:**
- Produces: `renderBriefMd({ project, brief, sessions, reviews, files = [], notes })`. `notes` is optional: `undefined` renders no notes section (existing callers unchanged); an array renders the section.
- Produces: `unfoldedNotes(noteDocs)`: takes `[{ id, created_at, folded_at, ... }]`, returns those with no `folded_at`, sorted by `created_at` ascending. Pure. Task 2 uses it.

A note is `{ id, session_id, created_at, folded_at, text, decisions: [{topic, decision}], risks_added: [string | {text, owner?}], risks_resolved: [string | {text, resolution}], lock_reversals: [{topic, proposed, reason}], thumbs_down? }`. Treat any missing list as empty and a missing `text` as `''`.

Exact output rules (section order in the document: Decisions, Open risks, **Shipped**, **Queued**, **New since the brief was last curated**, Files & artifacts, Reviewer annotations):

- **Coverage line.** Directly after the existing `Conversations: … Brief version: …` line, one more line built from whichever of these the project has, joined by a space, and no line at all when it has neither: `Notes cover conversations through <T>.` from `project.notes_through_at`, and `Maker last wrote <T>.` from `project.last_maker_message_at`. `<T>` is Pacific `YYYY-MM-DD HH:MM PT` (24-hour).
- **Contested lock.** On a decision line, when `d.locked` and `d.contested`, insert ` _(contested: maker asked for "<proposed>"; <reason>)_` after ` _(locked)_` and before the provenance suffix. Not rendered on an unlocked decision.
- **Shipped.** `## Shipped`, then for each valid batch, newest `date` first: `### <date>` and one `- <item>` per item. A batch is valid when `date` is a non-empty string and `items` is an array with at least one string. Section omitted when no valid batch.
- **Queued.** `## Queued` and one `- <item>` per string. Omitted when empty.
- **Notes.** Only when `brief` exists and `notes` is an array. Heading `## New since the brief was last curated`. With no notes, the body is the single line `No new notes since the brief was last curated.` Otherwise the body opens with `These notes are not in the brief above yet. Where a note and the brief disagree, the note is newer.` and then one block per note, in the order given:
  - `### <pacificDay(created_at)>, conversation <n>` where `n` comes from the same `convNumber` map decisions use; `### <pacificDay(created_at)>` when the session is null or not in `sessions`.
  - the note's trimmed `text`, when not empty
  - `Decisions:` and `- <topic>: <decision>` per decision
  - `New open risks:` and `- (<owner>) <text>` or `- <text>` per risk, the same form as the Open risks section
  - `Risks settled:` and `- <text> → <resolution>` when there is a resolution, else `- <text>`
  - `Maker asked to reverse a locked decision (on the brief as contested):` and `- <topic>: wants "<proposed>" (<reason>)`
  - each sub-list only when it has entries, separated from its neighbours by a blank line

- [ ] **Step 1: Write the failing tests**

Add to `scripts/lib/brief-markdown.test.mjs`, reusing the `project`, `brief`, `sessions`, `reviews` fixtures of the existing `describe('renderBriefMd')` (move them to module scope if needed, without changing them):

```js
describe('unfoldedNotes', () => {
  it('keeps notes with no folded_at, oldest first', () => {
    const docs = [
      { id: 'b', created_at: '2026-03-02T00:00:00Z', folded_at: null },
      { id: 'x', created_at: '2026-03-01T12:00:00Z', folded_at: '2026-03-03T00:00:00Z' },
      { id: 'a', created_at: '2026-03-01T00:00:00Z' },
    ]
    expect(unfoldedNotes(docs).map((n) => n.id)).toEqual(['a', 'b'])
  })
})

describe('renderBriefMd notes, shipped, queued, contested', () => {
  const note = {
    id: 'NOTEID123',
    session_id: 's2',
    created_at: '2026-03-05T20:00:00Z',
    folded_at: null,
    text: '  Sam wants pickup windows.  ',
    decisions: [{ topic: 'Pickup', decision: '15-minute windows' }],
    risks_added: ['Parking', { text: 'Opening hours', owner: 'maker' }],
    risks_resolved: ['Payment fees', { text: 'Menu size', resolution: 'Twelve items, no more' }],
    lock_reversals: [{ topic: 'Payment', proposed: 'Add cash', reason: 'confirmed Mar 5' }],
    thumbs_down: [{ excerpt: 'SECRET EXCERPT', reason: 'SECRET REASON' }],
  }

  it('omits the notes section when notes is not passed', () => {
    expect(renderBriefMd({ project, brief, sessions, reviews })).not.toContain('## New since')
  })

  it('says so when there are no new notes', () => {
    const md = renderBriefMd({ project, brief, sessions, reviews, notes: [] })
    expect(md).toContain('## New since the brief was last curated\n\nNo new notes since the brief was last curated.')
  })

  it('renders a note with every part, and never thumbs-down or the id', () => {
    const md = renderBriefMd({ project, brief, sessions, reviews, notes: [note] })
    expect(md).toContain('These notes are not in the brief above yet. Where a note and the brief disagree, the note is newer.')
    expect(md).toContain('### 2026-03-05, conversation 2\n\nSam wants pickup windows.')
    expect(md).toContain('Decisions:\n- Pickup: 15-minute windows')
    expect(md).toContain('New open risks:\n- Parking\n- (maker) Opening hours')
    expect(md).toContain('Risks settled:\n- Payment fees\n- Menu size → Twelve items, no more')
    expect(md).toContain(
      'Maker asked to reverse a locked decision (on the brief as contested):\n- Payment: wants "Add cash" (confirmed Mar 5)'
    )
    expect(md).not.toContain('SECRET')
    expect(md).not.toContain('NOTEID123')
  })

  it('renders an old or partial note without crashing', () => {
    const old = { id: 'o', session_id: null, created_at: '2026-03-05T20:00:00Z', text: 'Short.', decisions: [] }
    const md = renderBriefMd({ project, brief, sessions, reviews, notes: [old] })
    expect(md).toContain('### 2026-03-05\n\nShort.')
    expect(md).not.toContain('conversation undefined')
    expect(md).not.toContain('Risks settled:')
  })

  it('shows the day alone for a note from an archived conversation', () => {
    const md = renderBriefMd({ project, brief, sessions, reviews, notes: [{ ...note, session_id: 'gone' }] })
    expect(md).toContain('### 2026-03-05\n')
  })

  it('leaves out the notes section when there is no brief', () => {
    const md = renderBriefMd({ project, brief: null, sessions: [], reviews: [], notes: [] })
    expect(md).not.toContain('## New since')
  })

  it('renders shipped newest first, skips malformed batches, and renders queued', () => {
    const b = {
      ...brief,
      content: {
        ...brief.content,
        shipped: [
          { date: '2026-02-01', items: ['Menu page'] },
          { date: '2026-03-01', items: ['Ordering', 'Receipts'] },
          { date: '2026-03-02' },
          'junk',
        ],
        queued: ['Loyalty card'],
      },
    }
    const md = renderBriefMd({ project, brief: b, sessions, reviews })
    expect(md).toContain('## Shipped\n\n### 2026-03-01\n- Ordering\n- Receipts\n\n### 2026-02-01\n- Menu page')
    expect(md).not.toContain('### 2026-03-02')
    expect(md).toContain('## Queued\n\n- Loyalty card')
  })

  it('omits shipped and queued when empty', () => {
    const md = renderBriefMd({ project, brief, sessions, reviews })
    expect(md).not.toContain('## Shipped')
    expect(md).not.toContain('## Queued')
  })

  it('shows a contest on a locked decision only', () => {
    const contested = { proposed: 'Add cash', reason: 'confirmed Mar 5' }
    const b = {
      ...brief,
      content: {
        ...brief.content,
        decisions: [
          { topic: 'Payment', decision: 'Stripe only', locked: true, contested },
          { topic: 'Hosting', decision: 'Vercel', contested },
        ],
      },
    }
    const md = renderBriefMd({ project, brief: b, sessions, reviews })
    expect(md).toContain('- **Payment**: Stripe only _(locked)_ _(contested: maker asked for "Add cash"; confirmed Mar 5)_')
    expect(md).toContain('- **Hosting**: Vercel\n')
  })

  it('adds the coverage line from whichever stamps the project has', () => {
    const both = { ...project, notes_through_at: '2026-03-06T01:30:00Z', last_maker_message_at: '2026-03-06T18:05:00Z' }
    expect(renderBriefMd({ project: both, brief, sessions, reviews })).toContain(
      'Notes cover conversations through 2026-03-05 17:30 PT. Maker last wrote 2026-03-06 10:05 PT.'
    )
    const one = { ...project, last_maker_message_at: '2026-03-06T18:05:00Z' }
    const md = renderBriefMd({ project: one, brief, sessions, reviews })
    expect(md).toContain('Maker last wrote 2026-03-06 10:05 PT.')
    expect(md).not.toContain('Notes cover')
  })
})
```

Import `unfoldedNotes` alongside the existing imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/lib/brief-markdown.test.mjs`
Expected: the new tests FAIL (`unfoldedNotes` is not exported; sections missing). Every existing test still passes.

- [ ] **Step 3: Implement in `scripts/lib/brief-markdown.mjs`**

Export `unfoldedNotes(noteDocs)`. Add a module-private `pacificMinute(iso)` returning `YYYY-MM-DD HH:MM PT` with `Intl.DateTimeFormat` and `timeZone: 'America/Los_Angeles'`, `hourCycle: 'h23'`. Extend `renderBriefMd` per the output rules above. The `convNumber` map is currently built inside the decisions block; build it once where both decisions and notes can use it. Update the function's header comment to list the new sections and to say that thumbs-down and note ids are left out on purpose.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/lib/brief-markdown.test.mjs`
Expected: all PASS, including the untouched exact-output test.

- [ ] **Step 5: Full suite, lint, commit**

Run: `npm test` then `npm run lint`. Expected: both clean.

```bash
git add scripts/lib/brief-markdown.mjs scripts/lib/brief-markdown.test.mjs
git commit -m "feat(reader): brief markdown shows unfolded notes, shipped, queued and contested locks"
```

---

### Task 2: The reader and the exporter load unfolded notes; the reader gains `--check`

**Files:**
- Modify: `scripts/mcp-briefs.mjs` (`loadBriefBundle`, `list_briefs`, `get_brief`, new `--check` mode, header comment)
- Modify: `scripts/export-brief.mjs` (`exportProject`)

**Interfaces:**
- Consumes: `unfoldedNotes(noteDocs)` and `renderBriefMd({ ..., notes })` from Task 1.
- Produces: `node scripts/mcp-briefs.mjs --repo owner/name --check` prints one line per brief in scope to stdout and exits 0 without starting the server. Task 3's launcher passes `--check` through.

Neither script can be imported in a test (each connects to Firestore at the top level), so this task has no unit test of its own: the logic that can be wrong lives in Task 1's tested helpers, and the scripts only fetch and pass. Keep it that way; do not add logic here.

- [ ] **Step 1: Load notes in `mcp-briefs.mjs`**

In `loadBriefBundle`, after `brief` is chosen: when there is a brief, read `briefs/{brief.id}/notes` (one plain `.get()`, no `where`, no `orderBy`, so no index is needed), map docs to `{ id, ...data }`, and set `notes = unfoldedNotes(docs)`; with no brief, `notes = []`. Return `notes` in the bundle.

- [ ] **Step 2: Use them**

- `get_brief` passes `notes` to `renderBriefMd`. Its description becomes: `Get the full living brief for one slug as markdown: problem, target users, features, constraints, decisions (with provenance and any contested lock), open risks, what is shipped and queued, the notes written since the brief was last curated, and reviewer annotations. The notes are newer than the brief: read both.`
- Move the code that builds `list_briefs` rows into `async function listRows()` and add `new_notes: notes.length` to each row. `list_briefs` returns `JSON.stringify(await listRows(), null, 2)` as before.

- [ ] **Step 3: Add `--check`**

Before the transport is created: when `argv.includes('--check')`, print for each row of `listRows()` one line `"<slug>  v<brief_version>  updated <updated_at>  conversations <n>  new notes <n>"` (`v—` and `updated —` when there is no brief), or `No briefs in scope for <REPO>.` when there are none, then `process.exit(0)`. Document `--check` in the file's header comment, and say there that the launcher `scripts/brief-reader.mjs` is the way a build repo starts this server.

- [ ] **Step 4: Load notes in `export-brief.mjs`**

In `exportProject`, same read as Step 1, and pass `notes` to `renderBriefMd`. Import `unfoldedNotes`.

- [ ] **Step 5: Verify what can be verified without credentials**

Run: `node --check scripts/mcp-briefs.mjs && node --check scripts/export-brief.mjs` (syntax only). Expected: no output.
Run: `node scripts/mcp-briefs.mjs --check` Expected: the existing refusal `Refusing to start: --repo owner/name is required` and exit 1 (the scope check still comes first).
Run: `npm test` and `npm run lint`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add scripts/mcp-briefs.mjs scripts/export-brief.mjs
git commit -m "feat(reader): reader and exporter pass unfolded notes; --check lists briefs without serving"
```

---

### Task 3: The launcher gets the key from 1Password and starts the reader

**Files:**
- Create: `scripts/lib/reader-key.mjs`
- Create: `scripts/lib/reader-key.test.mjs`
- Create: `scripts/brief-reader.mjs`

**Interfaces:**
- Consumes: `scripts/mcp-briefs.mjs` and its `--repo` / `--check` arguments (Task 2).
- Produces (`scripts/lib/reader-key.mjs`):
  - `class ReaderKeyError extends Error`: its `message` is one plain line, safe to show.
  - `parseServiceAccountKey(text: string): string`: returns the trimmed text when it parses as a JSON object with non-empty string `client_email` and `private_key`; otherwise throws `ReaderKeyError`. The message never contains any of the input.
  - `resolveReaderKey({ env, fetchFromOnePassword }): { key: string, source: 'env' | '1password' }`: when `env.FIREBASE_SERVICE_ACCOUNT_RO` is a non-empty string, parses and returns it with source `'env'` and does not call `fetchFromOnePassword`. Otherwise calls `fetchFromOnePassword()` (returns a string, may throw) and parses the result. A throw from the fetch becomes a `ReaderKeyError` whose message names 1Password and includes only the thrown error's `code` (for example `ENOENT`) or exit `status` when present, never its `message`, `stdout` or `stderr`.
- Produces (`scripts/brief-reader.mjs`): the command a build repo registers, `node /abs/path/scripts/brief-reader.mjs --repo owner/name [--check]`.

- [ ] **Step 1: Write the failing tests** in `scripts/lib/reader-key.test.mjs`

```js
import { describe, it, expect, vi } from 'vitest'
import { ReaderKeyError, parseServiceAccountKey, resolveReaderKey } from './reader-key.mjs'

const GOOD = JSON.stringify({ client_email: 'ro@example.iam.gserviceaccount.com', private_key: 'PRIVATE-KEY-BODY' })

describe('parseServiceAccountKey', () => {
  it('returns the trimmed key when it has an email and a private key', () => {
    expect(parseServiceAccountKey(`\n${GOOD}\n`)).toBe(GOOD)
  })
  it.each([
    ['empty', ''],
    ['whitespace', '  \n'],
    ['not JSON', 'PRIVATE-KEY-BODY not json'],
    ['an array', '[]'],
    ['no private key', JSON.stringify({ client_email: 'a@b.c' })],
    ['empty private key', JSON.stringify({ client_email: 'a@b.c', private_key: '' })],
  ])('refuses %s without echoing the input', (_name, text) => {
    let err
    try { parseServiceAccountKey(text) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ReaderKeyError)
    expect(err.message).not.toContain('PRIVATE-KEY-BODY')
    expect(err.message).not.toContain('a@b.c')
  })
})

describe('resolveReaderKey', () => {
  it('uses the environment key and does not call 1Password', () => {
    const fetchFromOnePassword = vi.fn()
    expect(resolveReaderKey({ env: { FIREBASE_SERVICE_ACCOUNT_RO: GOOD }, fetchFromOnePassword })).toEqual({ key: GOOD, source: 'env' })
    expect(fetchFromOnePassword).not.toHaveBeenCalled()
  })
  it('fetches from 1Password when the environment has no key', () => {
    expect(resolveReaderKey({ env: {}, fetchFromOnePassword: () => GOOD })).toEqual({ key: GOOD, source: '1password' })
    expect(resolveReaderKey({ env: { FIREBASE_SERVICE_ACCOUNT_RO: '' }, fetchFromOnePassword: () => GOOD }).source).toBe('1password')
  })
  it('refuses an empty answer from 1Password', () => {
    expect(() => resolveReaderKey({ env: {}, fetchFromOnePassword: () => '' })).toThrow(ReaderKeyError)
  })
  it('turns a failed fetch into one safe line', () => {
    const boom = Object.assign(new Error('op: PRIVATE-KEY-BODY leaked in message'), { code: 'ENOENT', stderr: 'PRIVATE-KEY-BODY', stdout: 'PRIVATE-KEY-BODY' })
    let err
    try { resolveReaderKey({ env: {}, fetchFromOnePassword: () => { throw boom } }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ReaderKeyError)
    expect(err.message).toContain('1Password')
    expect(err.message).toContain('ENOENT')
    expect(err.message).not.toContain('PRIVATE-KEY-BODY')
    expect(err.message).not.toContain('\n')
  })
  it('reports an exit status when there is no code', () => {
    const boom = Object.assign(new Error('x'), { status: 1 })
    expect(() => resolveReaderKey({ env: {}, fetchFromOnePassword: () => { throw boom } })).toThrow(/1Password.*1/)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run scripts/lib/reader-key.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `scripts/lib/reader-key.mjs`**

Pure: no I/O, no `child_process`, no reading `process.env` (the caller passes `env`).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run scripts/lib/reader-key.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write `scripts/brief-reader.mjs`**

In this order:

1. Header comment: what it is, the registration snippet below, the Touch ID cost, and that the key is held in memory only.
2. If `--repo` has no value, print the usage line to stderr and exit 1. This comes before the key fetch so a bad registration never triggers Touch ID.
3. `resolveReaderKey({ env: process.env, fetchFromOnePassword })`, where `fetchFromOnePassword` is `execFileSync('op', ['document', 'get', 'ibuild4you-firestore-ro', '--vault', 'dev-secrets'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 })`. On `ReaderKeyError`: write `brief-reader: <message>` to stderr and exit 1. Any other error: `brief-reader: unexpected failure starting the reader.` and exit 1. No stack trace either way.
4. Spawn `process.execPath` with `[<absolute path to scripts/mcp-briefs.mjs, resolved from import.meta.url>, ...process.argv.slice(2)]`, `cwd` set to the repo root (the parent of `scripts/`), `stdio: 'inherit'`, and an env that is `process.env` plus `FIREBASE_SERVICE_ACCOUNT` set to the key and with `FIREBASE_SERVICE_ACCOUNT_RO` removed.
5. Pass the child's exit code or signal through, the way `scripts/with-prod-env-ro.mjs` does at its end.

The registration snippet for the header comment (a build repo's `.mcp.json`):

```json
{
  "mcpServers": {
    "ibuild-briefs": {
      "command": "node",
      "args": ["/Users/nico/src/ibuild4you/scripts/brief-reader.mjs", "--repo", "owner/name"]
    }
  }
}
```

- [ ] **Step 6: Verify without 1Password**

Run: `node scripts/brief-reader.mjs` Expected: usage line on stderr, exit 1, no Touch ID prompt.
Run: `FIREBASE_SERVICE_ACCOUNT_RO=nonsense node scripts/brief-reader.mjs --repo x/y --check; echo "exit $?"` Expected: one `brief-reader:` line on stderr that does not contain `nonsense`, then `exit 1`.
Run: `cd /tmp && FIREBASE_SERVICE_ACCOUNT_RO=nonsense node /Users/nico/src/ibuild4you/scripts/brief-reader.mjs --repo x/y --check; echo "exit $?"` Expected: the same, from another directory.
Do NOT run it with no key in the environment and a `--repo`: that calls 1Password.
Run: `npm test` and `npm run lint`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/reader-key.mjs scripts/lib/reader-key.test.mjs scripts/brief-reader.mjs
git commit -m "feat(reader): launcher fetches the read-only key from 1Password and starts the reader"
```

---

### Task 4: Docs (done by the controller, not a subagent)

**Files:**
- Modify: `CLAUDE.md` (Gotchas and runbooks: one entry on the brief reader; Next Steps queue: project 3 status)
- Modify: `docs/changelog.md` (prepend an entry)
- Modify: `docs/superpowers/specs/2026-11-15-relay-efficiency-design.md` (project 3 points to the reader design; the mirror is described as the return-leg project)

- [ ] **Step 1:** Write the three edits. The CLAUDE.md entry names the launcher, the registration snippet's location (the launcher's header), the `--check` command, the Touch ID cost, and that byside and prntd still point at the old wrapper.
- [ ] **Step 2:** Commit: `docs: brief reader runbook, changelog, and project 3 re-scoped`.

---

## After the plan

Not code, in this order: open the PR; Nico runs the `--check` command from another directory; on a pass, post the handoff entry to l6-music (spec section 5).
