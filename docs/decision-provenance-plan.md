# #121 — Decision provenance: plan (DECIDED 2026-07-11)

**Goal:** every decision on `brief.decisions[]` carries where it came from — additive optional fields, stamped by code (never trusted from the model). Answers "when did we lock X" in a click; unlocks #122's round headers.

## Schema (additive)

`BriefDecision` (`lib/types/index.ts`) gains:

```ts
decided_in_session?: string | null // session doc id; null = decided out-of-band (e.g. prep chat → paste)
decided_at?: string                // ISO timestamp
```

- Session **id**, not conversation number — ids are stable; number is derived at render (builder view already has `numberOf`) and by the exporter (it walks sessions).
- Old decisions without stamps stay unstamped. **No backfill.**

## Core mechanic — one pure function, used by BOTH write paths

New in `lib/api/brief-merge.ts` (TDD first):

```ts
stampDecisionProvenance(args: {
  prev: BriefDecision[] | undefined   // decisions on the previous brief version
  next: BriefDecision[]               // post-reconcile list about to be persisted
  sessionId: string | null            // stamping context (null on paste path)
  now: string                         // ISO
}): BriefDecision[]
```

Rules (match by the existing `topicKey` — trimmed, case-insensitive topic):

1. **New topic** (no prev match): stamp `{ decided_in_session: sessionId, decided_at: now }` — unless the incoming decision already carries explicit provenance (paste path may legitimately supply it; honor it).
2. **Unchanged** (prev match, same decision text): carry the prev stamps forward verbatim (including "no stamps" — never fabricate).
3. **Changed** (prev match, different text): restamp with current context (the issue's "new/changed this round").
4. Run **after** `mergeLockedDecisions` — locked decisions come through verbatim from prev, so rule 2 preserves their stamps automatically (issue requirement: locked merge preserves stamps).

**Model-echo hazard (important):** the regen model sees the current brief (with stamps) in its prompt and will echo/hallucinate provenance fields in its output. On the **regen path, strip any model-emitted `decided_*` fields before stamping** — prev-carry-forward is the only source of truth there. On the **paste path, honor explicit fields** (an outside agent may know the real provenance).

## Write paths to wire

1. **Regen** — `lib/api/briefs.ts` `regenerateBriefForProject`: after `reconcileBrief` (line ~208). Stamping session = the **latest non-archived session that has messages** (reuse `lib/sessions/active.ts` `excludeArchived` so it agrees with conversation numbering; the transcript-building loop above stays as-is).
2. **Paste/import** — the Brief-tab payload lands via `PUT /api/briefs` (`app/api/briefs/route.ts`): run the same function with `sessionId: null` against the latest stored brief version. This also **restores stamps the outside agent dropped** when round-tripping the brief JSON through the prep chat (rule 2 carry-forward).
3. **Create payload** (`POST /api/projects` with `brief.decisions`): stamp `decided_at: now`, `decided_in_session: null` for decisions without explicit fields. Low priority — include if cheap.

## Prompt/schema surfaces

- `lib/agent/next-convo-prompt.ts` (the ferry prompt) documents the brief JSON schema for the outside agent: add the two optional fields, stating "carry these through unchanged if present; you may set them when you know the real provenance; omit otherwise." (Without this, round-trips drop stamps and we depend entirely on carry-forward — which works, but say it anyway.)
- The regen system prompt (`NEXT_CONVO_SYSTEM_PROMPT` used by `regenerateBriefForProject`) needs **no** change — code stamps; do not ask the model to reason about provenance.
- Check `lib/api/brief-json.ts` `serializeBriefContent` and any decision-shape validation in PUT /api/briefs for field whitelists that would strip the new fields.

## Display (minimal, this round)

- **Builder Brief read view** (`components/builder/BriefEditor.tsx`): decisions already render; append a quiet suffix when stamps exist — `· conv 2 · Jul 11` (number via loaded sessions; date-only when `decided_in_session` is null → `· added Jul 11`). Unstamped decisions render exactly as today.
- **Markdown exports** — `formatBrief()` in `BuilderProjectView.tsx` and `scripts/export-brief.mjs`: append `(decided conv 2, 2026-07-11)` / `(added 2026-07-11)`. The exporter can map id→number from the sessions it already walks.
- NOT this round: maker view changes, round-timeline grouping (#122), any admin UI.

## Tests (TDD order)

1. `lib/api/__tests__/brief-merge.test.ts` — `stampDecisionProvenance`: new-topic stamp; unchanged carry-forward (incl. unstamped stays unstamped); changed-text restamp; locked decision keeps stamps through merge+stamp pipeline; explicit payload provenance honored; model-echo stripped (regen mode).
2. Regen route test: stamped session id = latest non-archived with messages.
3. PUT /api/briefs test: paste with dropped stamps → restored from prev; paste with explicit stamps → honored.
4. Existing 961 stay green (schema is additive; `mergeLockedDecisions` untouched).

## Verify

- Preview e2e (new script, follow `e2e-124-brief-tab.mjs` pattern): create brief with a decision via import → regen via synthetic conversation… regen needs a real Anthropic call, so instead: paste a payload adding a NEW decision → reload Brief tab → the new decision shows an `added <date>` suffix; the pre-existing decision shows none. That exercises schema, PUT stamping, carry-forward, and display without paying for a model call.
- Manual optional: fire a real regen on a preview brief and eyeball a conv-N stamp.

## Non-goals / guardrails

- No hard migration, no backfill, no new collections.
- Never let the model author provenance on the regen path.
- Don't restamp on every regen (idempotence: unchanged text ⇒ stamps untouched) — this is what makes `decided_at` mean "decided", not "last regenerated".
