# Locked decisions: contest, don't remove (#197)

Drafted 2026-10-15 from the issue text (Nico's call: draft from the issue, no brainstorm). Issue: https://github.com/nicolovejoy/ibuild4you/issues/197

## Problem

The chat prompt tells Sam to challenge a maker who contradicts a locked decision and to treat it as changed only on explicit confirmation. So a conversation can legitimately reverse a lock. Brief regen (`regenerateBriefForProject` → `reconcileBrief` → `mergeLockedDecisions`) then re-injects the old lock verbatim, so the brief says "Stripe, locked" while the transcript says "Square, confirmed", until a builder edits the brief by hand. Meanwhile the Brief tab's save (structured or raw JSON) and History → Restore both go through `PUT /api/briefs`, which honours whatever `locked` flags the payload carries, so a paste that omits or unlocks a locked topic drops the lock with no warning.

Builder stays the only lock authority (#182 Q2). The brief must stop silently disagreeing with the transcript, and the builder must not drop a lock by accident.

## Part A — regen contests a lock, never removes it

### Data

`BriefDecision` gains an optional `contested` field:

```ts
export interface BriefDecisionContest {
  proposed: string // what the maker wants instead, in the maker's terms
  reason: string   // why, and when they confirmed it (free text from the model)
}
contested?: BriefDecisionContest
```

Only a **locked** decision may carry `contested`. Every write path strips it from an unlocked decision (regen merge, `PUT /api/briefs`, the Brief tab's JSON normaliser). `contested` is cleared only by a builder action (Part A accept/dismiss) or by a payload that omits it; regen never clears it (a regen that no longer sees the reversal in the transcript still carries the existing `contested` forward, because the builder hasn't ruled yet).

### Regen

- `UPDATE_BRIEF_TOOL` decision schema adds `contested: { proposed: string, reason: string }` (both required inside the object; the object itself optional). Description: "Only on a decision that is `locked`. Fill this when the maker explicitly confirmed, in the conversation, that they want the locked decision reversed: `proposed` is what they want instead, `reason` says why and when they confirmed it. Keep `topic`, `decision` and `locked` unchanged — never drop or reword a locked decision."
- `NEXT_CONVO_SYSTEM_PROMPT` lock rule (currently: record a contradiction in `open_risks`) becomes: carry the lock verbatim; a contradiction the maker did **not** explicitly confirm goes in `open_risks` as today; a reversal the maker **did** explicitly confirm fills `contested` on that decision and is not repeated in `open_risks`.
- Coercion in `regenerateBriefForProject` maps `contested` through when it is an object with non-empty string `proposed` and `reason`; anything else is dropped. A model-emitted `locked` is still dropped (#190).
- `mergeLockedDecisions(prev, next)`: for each locked `prev` decision, the result keeps `prev`'s `topic`, `decision`, `locked: true` and provenance verbatim; if `next` has a same-topic decision carrying `contested`, that `contested` is copied onto it, otherwise `prev`'s own `contested` (if any) is carried forward. Decisions taken from `next` (non-locked topics) have `contested` stripped.
- Provenance stamping (`stampDecisionProvenance`) is unchanged: `contested` rides along like any other field; an unchanged `decision` text keeps its stamps, so contesting never moves `decided_at`.

### Chat prompt

In the "Locked decisions — reconcile against these" block, a contested decision's line gains a suffix so Sam does not re-litigate it every session:

`- **Payment:** Stripe only — contested: the maker confirmed they want "Square" (switched POS provider, confirmed in conversation 3). A builder will decide; don't reopen it and don't treat it as changed.`

Maker view: unchanged.

### Brief tab

In the read view's Decisions section, a locked decision with `contested` shows:

- the existing `Locked` badge plus a `Contested` badge;
- one line: `Maker wants: <proposed> — <reason>`;
- three small actions: **Accept, keep locked** (decision text := proposed, stays locked), **Accept and unlock** (decision text := proposed, lock removed), **Dismiss** (lock and text unchanged). All three clear `contested`.

Each action saves the whole current brief with that one decision changed through the normal `PUT /api/briefs` (default source `paste`), so provenance stamps the accepted text as decided out-of-band and the outgoing version is archived (#194). While a resolve is in flight the three buttons are disabled; an error shows inline. These actions bypass the Part B guard (unlocking via Accept is deliberate).

Pure helper `resolveContest(decisions, topic, action)` in `lib/api/brief-merge.ts` does the list edit; `action` is `'accept' | 'accept_unlock' | 'dismiss'`. Topic match is the same case-insensitive trimmed key the merge uses. A topic with no contested decision returns the list unchanged.

## Part B — confirm before a save drops a lock

Pure helper `lostLocks(prev, next): string[]` in `lib/api/brief-merge.ts`: the `topic` (as spelled in `prev`) of every decision locked in `prev` that has no locked same-topic decision in `next`. Missing topic and unlocked topic both count. Order follows `prev`.

- **Brief tab Save** (structured and raw views, one `handleSave`): compute `lostLocks(currentBrief.decisions, toSave.decisions)`. If non-empty, do not submit; show inline `This save removes the lock on: X, Y. Continue?` with **Yes, save** and **Cancel**. Yes submits exactly the content that was checked; Cancel returns to the editor with the draft intact. If empty, save as today. The guard covers the structured editor's unlock toggle and row delete too (one guard, one code path; the cost is one extra click after a deliberate unlock).
- **History → Restore**: `BriefHistory` receives the live brief's decisions. When `lostLocks(live, archived)` is non-empty the existing confirm step's copy becomes `Restore vN? This removes the lock on: X, Y. The current brief is kept in history.`; otherwise today's generic copy. Still two-step, still `source: 'restore'`.
- No API change. Outside agents calling PUT directly get no prompt (a round-tripped brief carries the flag).

## Copy

All new strings live in `lib/copy.ts` under `brief`: `contestedBadge`, `contestedLine(proposed, reason)`, `contestAccept`, `contestAcceptUnlock`, `contestDismiss`, `contestError`, `lockLossWarning(topics)`, `lockLossConfirm`, `lockLossCancel`, `confirmRestoreLockLoss(version, topics)`.

## Tests

- `brief-merge`: contested copied onto the verbatim lock; prev's own contested carried when next has none; contested stripped from an unlocked decision; `lostLocks` on missing / unlocked / case-variant / unchanged; `resolveContest` three actions + unknown topic.
- Regen (`lib/api/__tests__/briefs.test.ts`): a model-emitted `contested` on a locked topic survives with the decision text unchanged and provenance unmoved; a model-emitted `locked` is still dropped; `contested` on an unlocked topic is dropped; malformed `contested` is dropped.
- `PUT /api/briefs` and `normalizeBriefContent`: `contested` kept on a locked decision, dropped on an unlocked one, dropped when malformed.
- Chat prompt: contested suffix present only for a contested lock.
- Brief tab (`components/builder/__tests__/BriefEditor.test.tsx`, new): the three resolve actions submit the expected content; the save guard fires only when a lock would be lost; Yes submits, Cancel does not.
- `BriefHistory`: restore confirm names the lost locks when there are any, generic copy otherwise.

## Out of scope

Auto-accept (noted in the issue as a later option once #194 shipped). Maker-side UI. API-level guard for outside agents. Changes to prep/next-convo surfaces that list locked decisions (they keep showing the locked text).
