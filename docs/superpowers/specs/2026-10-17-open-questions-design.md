# #220 Open questions for the maker — design

Issue: https://github.com/nicolovejoy/ibuild4you/issues/220
Proposal it argues from: `docs/proposals/2026-10-17-tideline-improvements.md` (§ #220).
Written 2026-10-17 by the agent without a brainstorm (Nico: "just go. i wasn't
there"); every call below is the agent's unless marked as Nico's.

## Intent

During the Tideline run the builder's coding agent kept carrying "still owed by
the maker" items that the brief had already closed, because nothing in the
brief said which open risks the maker owes versus which are the builder's.
Give open risks an **owner**, show the maker-owned ones in one place on the
Brief tab with a copy-as-markdown button, count them on the dashboard row, and
tell the agent (Sam) which risks it should ask the maker about. The brief
becomes the one source the coding agent reads from.

Nico's decision (proposal §Decided 3): #219's `queued` is the builder's build
list; #220's open questions are what the maker owes. They stay separate.

## Goals

- A typed owner on open risks, set by the regen model where it can and by the
  builder by hand, surviving regen the way locks survive (a forgotten tag must
  not silently empty the view — that is the stale-list problem again).
- One place on the Brief tab that lists the maker-owned risks and copies them
  as markdown.
- The agent asks the maker about maker-owned risks and does not push the maker
  on builder-owned ones.

## Non-goals

- No maker-facing change. The maker's brief card and chat UI do not show
  ownership; Sam simply asks.
- No cross-project aggregate view. "Dashboard" in the issue means the builder
  UI; the per-brief Brief tab is where the coding agent already reads from.
- No resolution workflow (tick-off, done-at). A question is answered when the
  next regen drops the risk or the builder deletes it.
- No French copy: everything here is builder-side and agent-side, English.

## Data model

`BriefContent.open_risks` stays an array but its elements become
`string | BriefRisk`:

```ts
export type BriefRiskOwner = 'maker' | 'builder'
export interface BriefRisk { text: string; owner?: BriefRiskOwner }
open_risks?: Array<string | BriefRisk>
```

**Canonical form (agent's call):** a risk with no owner is stored as a plain
string; a risk with an owner is stored as `{ text, owner }`. `{ text }` with no
owner collapses to the string. Reason: every existing brief, fixture, test and
paste payload stays valid and byte-identical, the raw JSON view stays readable,
and the owner is visible exactly where it exists. The cost is that every reader
goes through two helpers instead of treating the element as a string.

Helpers in a new `lib/brief/risks.ts` (no `lib/brief` existed; it is the right
home for brief-shape helpers that both client and server import):

- `riskText(r: string | BriefRisk): string`
- `riskOwner(r: string | BriefRisk): BriefRiskOwner | undefined`
- `normalizeRisks(raw: unknown): Array<string | BriefRisk>` — accepts anything,
  keeps strings with non-empty trimmed text and objects with a non-empty
  `text`; an `owner` other than `'maker' | 'builder'` is dropped (the text is
  kept); output is canonical. Non-arrays → `[]`.
- `makerQuestions(content: BriefContent | undefined): string[]` — texts of the
  maker-owned risks, in brief order.
- `carryRiskOwners(current: Array<string | BriefRisk> | undefined, next: Array<string | BriefRisk>): Array<string | BriefRisk>` —
  for each element of `next` with no owner whose text matches (trimmed,
  case-insensitive) an element of `current` that had an owner, restore that
  owner. Everything else passes through unchanged. Mirrors how locked decisions
  survive regen (#71): the model may forget the field; code puts it back.

Every writer of `open_risks` normalizes through `normalizeRisks`: the raw-view
parser (`lib/api/brief-json.ts`), `PUT /api/briefs`, the create payload
(`POST /api/projects`), and the regen coercion (`lib/api/briefs.ts`). The regen
coercion then applies `carryRiskOwners(currentBrief.open_risks, …)` next to
`reconcileBrief`. The paste/PUT path does **not** carry owners: a builder who
pastes a risk as a plain string meant it that way (same rule as a paste that
drops a lock, which asks instead — here nothing is lost that the builder did
not type).

## Regen

The `update_brief` tool schema's `open_risks.items` becomes
`{ type: 'object', properties: { text: string, owner: enum ['maker','builder'] }, required: ['text'] }`
with a description. The coercion still accepts plain strings so a model that
emits the old shape loses nothing.

Prompt rule (added to `NEXT_CONVO_SYSTEM_PROMPT` next to the open-risks rule,
and in the tool description): set `owner: "maker"` when only the maker can
settle it (their preference, a fact about their world, a decision that is
theirs to make); `owner: "builder"` when it is the builder's to resolve
(technical, scheduling, something the builder said they would look into); omit
when unclear. Carry an existing owner forward unless the conversation resolved
the risk. The schema line in the prompt shows both forms:
`"open_risks": ["plain-language risk", { "text": "…", "owner": "maker" }]`.

## Agent context

In `lib/agent/system-prompt.ts` the `## Open risks` block keeps its order and
renders each risk as:

- maker-owned: `- <text> (the maker owes an answer — ask them when it fits)`
- builder-owned: `- <text> (the builder's to resolve — don't push the maker on it)`
- no owner: `- <text>` (unchanged)

This is a stable-block change: the system prompt's cached prefix changes once
per deploy, as any prompt edit does.

## Builder UI

### Brief tab: Open questions card

A new `components/builder/OpenQuestionsCard.tsx` rendered by the Brief tab
**inside the ferry desk, after the import notices and before the Details
fold** — the ferry desk is the page; Details is collapsed by default and the
coding agent's one source must not hide behind a twiddle. `FerryDesk` gains an
optional `openQuestions?: React.ReactNode` slot in that position.

Content, hidden entirely when there are no maker-owned risks:

- Heading: `Open questions for {maker first name}` with a count in the usual
  grey (`copy.brief.openQuestionsTitle(name, n)`); the name is the project's
  `requester_first_name`, falling back to `copy.brief.openQuestionsFallbackName`
  = `the maker`.
- The maker-owned risk texts as a bulleted list, brief order.
- A `Copy as markdown` button in the Brief tab's existing small
  Copy/Check icon style, 2-second `Copied!` flash, that writes
  `openQuestionsMarkdown(...)` to the clipboard. No stamp is written: the
  prep-copied stamp means "the round is harvested", and copying questions is
  not that.

`data-testid="open-questions"` on the card, `open-questions-copy` on the button.

### Markdown

Pure function `openQuestionsMarkdown({ title, makerName, questions }): string`
in `lib/builder/open-questions.ts`:

```
## Open questions for Mara — Tideline

- Which three tide stations matter most?
- Should the app work offline?
```

Exactly: an H2 `Open questions for <makerName> — <title>`, a blank line, one
`- ` bullet per question, trailing newline. The copy button is disabled and
the function is not called when `questions` is empty.

### Brief read view and editor

- `BriefReadView` (in `BriefEditor.tsx`): each risk shows a small badge before
  its text when owned — `Maker` (navy-tinted, `bg-blue-100 text-blue-800`) or
  `Builder` (`bg-gray-100 text-gray-700`) — in the Locked-badge style.
- `StructuredEditor`: `StringListField` for open risks is replaced by a new
  `RiskListField` in the same file: one row per risk with the text input, an
  owner `<select aria-label="Owner">` (options `—` / `Maker` / `Builder`, values
  `''` / `maker` / `builder`), and the remove button; the add row is text-only
  (a new risk starts unowned). Changing owner to `—` collapses the element back
  to a string (canonical form). Features keep `StringListField` untouched.
- Raw view: `serializeBriefContent` passes the canonical array through;
  `parseBriefJson` accepts both shapes via `normalizeRisks`.

### Copy markdown (whole brief)

`formatBrief()` in `BuilderProjectView.tsx` today omits open risks entirely.
Add an `## Open risks` section after Decisions: `- <text>` unowned,
`- (maker) <text>`, `- (builder) <text>`. `scripts/lib/brief-markdown.mjs`
renders the same three forms so the ops export matches the in-app one.

### Dashboard row

`lib/api/enrich-projects.ts` adds `brief_maker_question_count` (number, 0 when
no brief) computed with `makerQuestions`. `Project` gains the optional field.
The dashboard card's grey meta line appends `· N for {maker first name}` after
the decisions count when `N > 0` **and** the viewer is builder-side
(`copy-maker.ts` dashboard: `makerQuestions: (n, name) => …` English only; the
FR dashboard twin gets the same function because the maker copy object is
typed as one shape, but a maker never sees it — the builder-side guard is
what hides it).

## Docs

- `CLAUDE.md` Project Setup JSON: one sentence after the `brief` example that
  an open risk may be `{ "text", "owner": "maker" | "builder" }` and what owner
  means; Data Model `briefs` bullet gains the owner note; Agent Behavior Rules
  gets a sentence on asking the maker about maker-owned risks.
- `app/dashboard/docs/start-a-brief/page.tsx` and
  `app/dashboard/docs/next-conversation/page.tsx`: the `open_risks` example
  line shows both forms.
- `docs/changelog.md` entry.

## Verification

- Unit: `lib/brief/__tests__/risks.test.ts` (helpers), brief-json round-trip of
  both shapes, `lib/api/__tests__/briefs.test.ts` (coercion of objects and
  strings, owner carry-forward when the model drops it, no carry when the text
  changed), system-prompt suffixes, enrich-projects count,
  `lib/builder/__tests__/open-questions.test.ts` (markdown exact string),
  `OpenQuestionsCard` (hidden at zero, list, copy writes the markdown),
  `BriefEditor` (badge in read view, owner select round-trips to canonical),
  `scripts/lib/brief-markdown.test.mjs`.
- Preview walk-through `scripts/e2e-220-open-questions.mjs` as the test admin:
  create a brief via `POST /api/projects` whose `brief.open_risks` mixes a plain
  string, a maker-owned and a builder-owned risk; open the Brief tab; the card
  lists exactly the maker-owned text; Copy writes the exact markdown to the
  stubbed clipboard; the dashboard row shows `1 for <name>`; `PUT /api/briefs`
  flips the builder-owned risk to maker-owned; the card and row show 2.
- Worktree rule: `npm run build` (dummy `NEXT_PUBLIC_FIREBASE_*`) **and**
  `npm run type-check` before claiming clean; never commit `lib/build-info.json`.

## Left to the builder

- Exact Tailwind classes beyond the two badge tints named above.
- Test fixture wording.
- Where in `enrich-projects.ts` the brief content is already read (reuse that
  read; do not add a second Firestore query).
