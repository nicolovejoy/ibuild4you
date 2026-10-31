# Brief shipped[] and queued[] (#219) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the living brief two optional fields, `shipped` (dated batches of what went out) and `queued` (what is next), so `additional_context` stays background instead of turning into a changelog.

**Architecture:** Two optional keys on `BriefContent`, normalized at every hard-coded key list (paste, create, raw editor). Sam's prompt shows the last two shipped batches and the whole queue; the curation prep knows the schema so a curated paste keeps them and moves changelog text out of `additional_context`. The Brief tab shows them and the markdown export carries them.

**Tech Stack:** Next.js App Router, TypeScript, vitest.

**Spec:** GitHub issue #219 ("Add optional 'shipped' (array of {date, items}) and 'queued' (array of strings) to the brief so additional_context stays background. The prep export should show the last two shipped entries and the full queue."). No separate design doc; rulings below are provisional (controller-made 2026-10-30, Nico asked to keep going).

## Rulings

- R1 "Prep export" read as what Sam reads at the start of the next conversation (the chat system prompt): last two `shipped` entries (latest by date) + full `queued`. The comms agent's curation prep already receives the whole brief as JSON; unchanged. Cost if wrong: one render tweak.
- R2 Shape: `shipped: { date: string; items: string[] }[]`, `date` is `YYYY-MM-DD` (Pacific calendar day, written by a human or the comms agent; no code stamps it). `queued: string[]`. Both optional; omitted when empty, like `open_risks` on create.
- R3 Validation follows `open_risks`: a present non-array field is a 400 / parse error; inside the array, malformed entries are dropped (entry without a `YYYY-MM-DD` date or with no non-empty string item; non-string or blank queue items). Items are trimmed.
- R4 Sam treats `queued` as not built yet: never says a queued item exists or gives a date for it. Shipped batches are what the maker can try now.
- R5 Curation: keep every `shipped` entry unless the 20,000-char budget presses, then merge or drop the oldest first; a dated "we shipped X" passage in `additional_context` moves into `shipped`; a queued item that a note says shipped moves to the latest `shipped` batch. The note writer is not changed.
- R6 Brief tab: read view shows both; structured editor edits `queued` with the existing `StringListField`; `shipped` is edited in the raw JSON view only (no new widget). Cost if wrong: a later small UI task.

## Global Constraints

- Builder-facing UI text goes in `lib/copy.ts` (Brief tab is English-only, like the rest of it).
- `docs/brief-curation-guide.md` and `lib/agent/curation-guide.ts` must stay identical (pinned by `lib/agent/__tests__/curation-guide.test.ts`).
- Snapshot `lib/agent/__tests__/__snapshots__/prep-prompts-snapshot.test.ts.snap` is updated with `-u` only after reading the diff.
- In this worktree run BOTH `npm run build` (with dummy `NEXT_PUBLIC_FIREBASE_*` exported) and `npm run type-check`, plus `npm run lint` and `npm test`, before claiming clean.
- Do not change `additional_context` semantics or remove it.

## Review Focus

- A paste of an old brief with no `shipped`/`queued` keys must keep working and save without those keys (no `[]` noise required).
- A curated paste that omits `shipped` drops it (the paste is the whole brief, by design); the prep's rules must therefore tell the comms agent to carry them.
- A brief whose only content is `queued` or `shipped` is not "empty" (briefs PUT `validateBriefContent` hasData).
- `shipped` order in storage is whatever was pasted; "last two" is by `date` descending, not array position.
- Raw-JSON editor round-trip (`parseBriefJson` → `serializeBriefContent`) preserves both fields.

---

### Task 1: Data shape and normalization

**Files:**
- Modify: `lib/types/index.ts` (`BriefContent`, new `BriefShipped` type near `BriefRisk`)
- Create: `lib/brief/shipped.ts`
- Modify: `lib/api/brief-json.ts` (`normalizeBriefContent`, `serializeBriefContent`; `emptyBrief` unchanged since fields are optional)
- Modify: `app/api/briefs/route.ts` (inline normalization next to `open_risks`; `validateBriefContent` hasData)
- Modify: `app/api/projects/route.ts` (seed brief: spread in only when non-empty, like `open_risks`)
- Test: `lib/brief/__tests__/shipped.test.ts`, `lib/api/__tests__/brief-json.test.ts`, `app/api/briefs/__tests__/briefs.test.ts`, `app/api/projects/__tests__/create-project.test.ts`

**Interfaces:**
- Produces: `type BriefShipped = { date: string; items: string[] }`; `BriefContent.shipped?: BriefShipped[]`; `BriefContent.queued?: string[]`.
- Produces (`lib/brief/shipped.ts`): `normalizeShipped(v: unknown): BriefShipped[]`, `normalizeQueued(v: unknown): string[]`, `isShippedArrayShape(v: unknown): boolean` (true for undefined or any array; false for a present non-array), `latestShipped(list: BriefShipped[] | undefined, n: number): BriefShipped[]` (sorted by date desc, ties keep array order).

- [ ] Step 1: tests in `lib/brief/__tests__/shipped.test.ts`: normalizeShipped keeps `{date:'2026-10-17', items:[' A ','B']}` as `items:['A','B']`; drops entries with date `'Oct 17'`, missing date, or no non-blank string items; non-array → `[]`. normalizeQueued trims, drops blank and non-strings. latestShipped of dates `2026-09-01, 2026-10-17, 2026-10-01` with n=2 → `2026-10-17, 2026-10-01`.
- [ ] Step 2: brief-json tests: round-trip of a brief with both fields through `parseBriefJson`→`serializeBriefContent`→`parseBriefJson` is equal; `shipped: "x"` and `queued: {}` each give `ok:false`; a brief without them normalizes with no `shipped`/`queued` keys.
- [ ] Step 3: briefs PUT tests: both fields saved normalized; `{ queued: ['Next'] }` with all else empty is accepted (not "empty"); `shipped: 'x'` → 400. Create-project test: seed keeps both when present, omits keys when absent.
- [ ] Step 4: run, see failures; implement; run the four test files green.
- [ ] Step 5: commit `feat(brief): shipped and queued fields (#219)`.

### Task 2: Agent prompts

**Files:**
- Modify: `lib/agent/system-prompt.ts` (new section after "## Open risks", before "## Current brief"; `hasBriefContent` counts both)
- Modify: `lib/agent/next-convo-prompt.ts` (schema block + rules), `lib/agent/new-project-prompt.ts` (schema block)
- Modify: `lib/agent/curation-guide.ts` and `docs/brief-curation-guide.md` (identical text, new "Shipped and queued" section per R5)
- Test: `lib/agent/__tests__/system-prompt.test.ts`, `next-convo-prompt.test.ts`, `new-project-prompt.test.ts`, prep snapshot

**Interfaces:**
- Consumes: `latestShipped` from Task 1.

- [ ] Step 1: system-prompt tests: with 3 shipped batches, the prompt contains a `## Shipped recently` section listing only the two latest by date as `- 2026-10-17: A; B`; with `queued: ['X']` a `## Queued (not built yet)` section with `- X` and the R4 instruction ("never tell the maker a queued item exists or when it will ship"); with neither field, neither heading appears. Both sections go in the stable (cached) system block, not the volatile one.
- [ ] Step 2: next-convo / new-project tests: schema key lists include `shipped` and `queued`; next-convo rules text says to carry `shipped` and `queued` forward and to move dated shipped history out of `additional_context`.
- [ ] Step 3: implement; update the curation guide in both files; run tests; review the snapshot diff, then `npx vitest run lib/agent -u` and confirm only the expected lines changed.
- [ ] Step 4: commit `feat(agent): Sam and curation know shipped and queued (#219)`.

### Task 3: Brief tab, export, docs

**Files:**
- Modify: `components/builder/BriefEditor.tsx` (`hasAnyContent`, `BriefReadView` sections, `StructuredEditor` queued `StringListField`)
- Modify: `components/builder/BuilderProjectView.tsx` (`formatBrief` markdown: `## Shipped` with `### <date>` + bullets, newest first; `## Queued` bullets; `hasBriefContent`)
- Modify: `lib/copy.ts` (labels: "Shipped", "Queued", editor hint "Edit shipped batches in the raw JSON view")
- Modify: `app/dashboard/docs/start-a-brief/page.tsx`, `app/dashboard/docs/next-conversation/page.tsx` (schema lines + one NOTES line)
- Modify: `CLAUDE.md` (Data Model briefs line: mention `shipped`/`queued`), `docs/changelog.md` (prepend entry)
- Test: `components/builder/__tests__/BriefEditor.test.tsx`

- [ ] Step 1: BriefEditor tests: read view shows "Shipped" with dates newest first and items, and "Queued" items; structured editor adding a queued item saves `queued` in the PUT body; a brief with only `queued` is not treated as empty.
- [ ] Step 2: implement; run tests; build + type-check + lint + full test.
- [ ] Step 3: commit `feat(brief-tab): show and edit shipped and queued (#219)`.
