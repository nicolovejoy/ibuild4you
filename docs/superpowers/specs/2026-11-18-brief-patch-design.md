# Payload as changes: `brief_patch`

Date: 2026-11-18. Status: approved by Nico 2026-11-18; built and merged as PR #268. Project 4 of the relay-efficiency programme (`2026-11-15-relay-efficiency-design.md`).

## Why

Every next-convo payload restates the whole brief, and anything the comms agent leaves out is deleted. On a long project (F4FC: 60 versions, about 22,600 characters) that makes each round slow to produce, and a forgotten decision disappears without anyone being told.

Nico wants a round to cost what changed in it, and wants nothing to leave the brief unless the payload says so by name.

## Goals

- In a normal round the comms agent sends only what changed. Everything it does not mention stays exactly as it is.
- Nothing is removed from the brief unless the payload names it.
- The builder sees what a payload will change before importing it.
- A whole rewrite is still possible, and happens when the brief is over budget or the builder asks for a compaction.

## Non-goals

- Shrinking the brief. A patch does not make anything smaller; compaction rounds do that, and they stay whole rewrites.
- Changing the note writer, Sam's prompt, or how notes are folded.
- A place for maker-facing test steps in a build report's `live` items. That is a separate small change after this one (it touches the report shape, not the payload).
- An operations vocabulary (`revise_decision`, `settle_risk`).

## Anti-goals

- A patch that silently drops, rewords or unlocks a locked decision.
- A paste that is half applied.
- A model habit (an empty string for "unchanged") wiping a field.

## Approaches

- **A. A partial brief in the brief's own shape, merged on the server (chosen).** The payload carries `brief_patch` instead of `brief`. One vocabulary, and the server already has everything a merge needs: the live brief, the lock restore, the provenance stamping and the risk owners all run unchanged on the merged result.
- **B. An operations list.** More exact, but a second vocabulary for a model to get wrong and for us to keep in step with the brief's shape.
- **C. The app folds notes itself.** Walks back #229, which moved curation to the comms agent on purpose.
- **Merge on the client instead.** Dropped: the Brief tab's cached brief can be stale, and the lock and provenance rules live on the server.

Who chooses patch or whole rewrite: the comms agent, by a rule the prep states from the measured size (Nico, 2026-11-18). One prep, one button.

## The payload

`brief_patch` replaces `brief` in a next-convo payload. A payload with both is refused.

```json
{
  "_payload_type": "next-convo",
  "_prep_stamp": { "brief_version": 60, "note_ids": ["n1"], "report_ids": [] },
  "brief_patch": {
    "constraints": "The whole new text of this field",
    "decisions": [{ "topic": "Bar ranges", "decision": "The decision as it now stands, whole" }],
    "features": ["A new feature"],
    "open_risks": [{ "text": "A new open risk", "owner": "maker" }],
    "shipped": [{ "date": "2026-11-18", "items": ["Something that went live"] }],
    "queued": ["Something newly planned"],
    "drop": {
      "decisions": ["Topic of a decision no longer in force"],
      "features": ["Exact text of a feature to remove"],
      "open_risks": ["Exact text of a settled risk"],
      "queued": ["Exact text of a queued item that shipped"]
    }
  },
  "welcome_message": "…"
}
```

Every key is optional. `{}` is a valid patch: the round changed nothing in the brief, and the notes still fold.

### Merge rules

Applied to the live brief, drops first, then additions.

- **Matching.** Every match in a patch (a decision's topic, the text of a feature, risk, queued or shipped item) goes by one key: lowercase, then every punctuation mark and every space removed (`matchKey` in `lib/brief/patch.ts`), so "sign-up" meets "sign up". An entry whose key is empty (only punctuation or spaces) matches nothing: a drop of it is unmatched, and an added one is appended as sent. The prep tells the comms agent to write straight ASCII quotes only, while stored text can hold curly ones, so an exact match would bounce drops the agent cannot write correctly. A drop that matches more than one entry removes all of them. A drop entry repeated in the same list (after matching) counts once. The prep still tells the comms agent to copy drop texts and topics from the brief as shown, because a drop that matches nothing refuses the whole payload. [My call, after the builder check.]
- **Text fields** (`problem`, `target_users`, `constraints`, `additional_context`): a non-empty string replaces the field. An empty or blank string is ignored. A patch cannot clear a text field; a whole rewrite can.
- **Decisions**: matched by topic. A known topic is replaced in place, keeping its position and the stored spelling of its topic, so the provenance stamping that follows (which matches on `topicKey`) still finds it. A new topic is appended. The incoming decision is otherwise taken as sent (`decision`, `locked`), so a patch may add a new locked decision, as a paste can today.
- **Features, queued**: each incoming string is appended unless a matching one is already there.
- **Open risks**: a new one is appended. One that matches an existing risk keeps the brief's stored text; only its owner can change (an owner sent replaces the stored one, none sent keeps it). That is how an owner is set or changed, and a straight-quoted restatement of a curly-quoted risk rewrites nothing. To reword a risk, drop the old text and add the new one.
- **Shipped**: an item already in any batch is skipped. A new item is appended to the batch with the same `date`, or a new batch is added; an item that was already shipped never makes an empty batch. A patch cannot remove or merge shipped batches; that is a compaction, so a whole rewrite.
- **Drop**: decisions by topic; features, open risks and queued by text. To reword a feature or a risk, drop the old text and add the new one.

### What is refused, and what is ignored

- **A drop that matches nothing refuses the whole paste**: 400 `{ error: 'patch_drop_unmatched', unmatched: { decisions: [...], features: [...], open_risks: [...], queued: [...] } }`. Nothing is written and no note is folded. The usual cause is a drop text that is not the brief's exact text, and the builder should see that, not a brief that still holds what was meant to go.
- **`brief` and `brief_patch` together**: refused (400).
- **A patch when the project has no brief yet**: refused (400). The first brief is a whole one. "No brief" means no brief doc, or a doc whose content is empty (the note writer creates an empty one to hang notes on); the test is the existing `hasBriefContent`. The prep says the same thing in that case (see The prep). [My call, after the builder check.]
- **A locked decision**: a patch never changes it. A replacement or a drop aimed at a locked topic is ignored, the lock comes back verbatim with its contest state, and the response lists the topics in `locks_kept` so the Brief tab can say so. This holds with or without a prep stamp. Unlocking stays what it is today: the structured editor, Accept and unlock, or Restore.
- **Unknown keys** in `brief_patch` or `drop` are ignored, as unknown brief keys are today.
- **Neither `brief` nor `brief_patch`**: a payload with neither is treated as an empty patch only when it carries a config field such as `welcome_message`. The preview warns when that would fold notes. Without a config field (`{}`, stray JSON) it is the old brief-only shape, and the server refuses it as an empty brief.

### The stamp and the paste guard

Unchanged. A stamped patch folds the notes and build reports the stamp lists. A stale stamp (an unlisted unfolded note, or a live version newer than the prep's) gets the existing 409 and the existing Save anyway. A forced stale patch is applied to the live brief; a drop that no longer matches still refuses.

An unstamped patch (hand-written JSON) is accepted and folds nothing, with the existing "not from a prep" warning. Locks are protected all the same.

### Provenance and owners

Nothing new. The merged brief goes through `stampDecisionProvenance` and `carryRiskOwners` exactly as a pasted whole brief does: an untouched decision keeps its stamps, a replaced one whose text really changed is stamped as a revision (from the folding note when there is one), a new topic gets its origin.

### No change, no version

When the merged brief equals the live one (an empty patch, or one whose every entry was already there), no new brief version is written. Notes and reports still fold, and the response carries the live version. [My call: a version per no-op would fill the history with identical copies.]

### Importing the same payload twice

An import is two requests: `PUT /api/briefs`, then `PATCH /api/projects` for the welcome and the other config. If the first saves and the second fails, the builder clicks Import again. A whole brief survives that (409, Save anyway). A patch with drops would not: its drops are already gone, so the retry would be refused and the welcome could not be imported without editing the JSON.

Fix, in the Brief tab: when the brief save succeeded and the config save failed, the tab remembers the pasted text and the saved version. Import again with the same text skips the brief save and sends only the config. The tab also keeps the first save's lock and size warnings and shows them after the retry succeeds. The error shown after the failed config save says the brief is saved and Import will retry the rest.

After a page reload that memory is gone and the retry is refused with `patch_drop_unmatched`. The refusal's wording covers it: if this payload was already imported, the brief is saved; remove `brief_patch` from the JSON to import the rest. [My call, after the builder check: no server record of applied stamps for a case this rare.]

## Where the code goes

- **`lib/brief/patch.ts` (new, pure, no Firebase).** `normalizeBriefPatch(raw)` coerces untrusted JSON into a typed `BriefPatch` (reusing `normalizeRisks`, `normalizeShipped`, `normalizeQueued`). `applyBriefPatch(live, patch)` returns `{ content, unmatched, locksTouched, summary }`, where `summary` counts what changed (decisions revised, added, dropped; features, risks, queued added and dropped; shipped items added; text fields replaced). It does not restore locks itself beyond reporting `locksTouched`; see below. Used by the server to apply and by the Brief tab to preview.
- **`BriefPatch` type** in `lib/types/index.ts`.
- **`PUT /api/briefs`** takes `patch` in place of `content` (exactly one of the two). For a patch it loads the live brief, applies the patch, refuses on unmatched drops, then runs the existing path with one difference: `restoreLocksOnPaste` always runs for a patch, stamped or not. The response adds `patch_summary` and `locks_kept`. `source` stays `'paste'`.
- **`parseNextConvoPayload`** gains a third mode, `{ mode: 'patch', patch, projectUpdate, stamp }`, and rejects a payload with both keys.
- **`useUpdateBrief`** and **`savePayload`** send `patch` for that mode. The size warning after an import comes from the server's `size_warning` for every mode (today the client measures `payload.brief`, which a patch does not have).

## What the builder sees

Under the paste box, beside the existing "Prepped from v60 · matches the brief" line, before Import is clicked:

```
Changes: 2 decisions revised, 1 added · 1 risk dropped · 1 feature added
```

and, when they apply, in the warning colour:

```
Will not import: no risk in the brief reads "Danny to send the bar list".
Locked, left as it is: "Two games stay separate".
```

The Brief tab computes this with `applyBriefPatch` against its cached brief, so it is a preview; the server's answer is the one that counts, and its `patch_drop_unmatched` error and `locks_kept` are shown in the same words after Import.

For a whole `brief`, the same line names the decisions the rewrite would remove:

```
Whole rewrite: removes 3 decisions: "Old pricing", "Beta list", "Logo colour"
```

[My call, small: it is the same diff, and it covers the compaction rounds, where the deletion risk remains. Drop it if unwanted.]

For a stamped whole rewrite the line leaves out locked decisions, since the server keeps them.

All wording goes in `lib/copy.ts`.

## The prep

- The task paragraph changes from "rewrite the brief whole" to: send what this round changes as `brief_patch`; everything you leave out stays as it is.
- The schema example shows `brief_patch` with `drop`, and says `brief` (the whole brief, same shape as before) is the alternative, never both.
- The `<current_brief>` block already states the size and the budget. It gains one line, written by code from the measured size:
  - at or under the budget: "Under budget: send `brief_patch`."
  - over the budget: "Over budget: this round, send the whole `brief`, rewritten and trimmed to fit."
  - no brief yet (none, or empty content): "No brief yet: send the whole `brief`."
- A rule: when the builder asks for a compaction in the chat, send the whole `brief` whatever the size.
- The rules that assumed a whole rewrite are reworded for both modes: "anything you leave out is gone" now applies to a whole `brief` only; a settled risk is dropped by its exact text after its answer is added; a queued item that shipped is dropped from `queued` and added to `shipped`; a revised decision is restated whole under its exact topic. The locked-decision rule becomes: do not include a locked decision in a patch at all.
- Near the budget (the existing 80% warning), the prep's line adds: drop before you add.
- The curation guide (both copies, pinned equal by a test) gets a short "Patch or whole rewrite" section and the same rewording.
- `app/dashboard/docs/next-conversation/page.tsx` and `docs/project-setup-json.md` document `brief_patch`.

The Brief tab's over-budget warning says the next prep will ask for a whole rewrite.

## Testing

Test first, as usual here.

- The retry: after a saved brief and a failed config save, Import with the same text sends only the config.
- `applyBriefPatch`: each merge rule, each match rule (a curly-quoted stored text dropped by its straight-quoted form), the empty-string rule, unmatched drops, locked topics reported, the summary counts, an empty patch returning content equal to the input.
- `PUT /api/briefs` with a patch: refusals (both keys, no brief yet, unmatched drop writes nothing and folds nothing); a lock aimed at comes back verbatim and is listed, stamped and unstamped; provenance on an untouched, a revised and a new decision; a no-op writes no version and still folds; the stale-prep 409 and force.
- `parseNextConvoPayload`: the patch mode, both keys refused, a whole brief and the legacy brief-only shape unchanged.
- The prep: the under-budget and over-budget lines, the schema lockstep test, the snapshot (updated on purpose), the curation-guide equality test.
- A whole `brief` paste behaves exactly as before; the existing tests stay green untouched.
- Preview: on `preview.ibuild4you.com`, paste a patch into a test project and check the preview line, the import, and the new version in History.

What tests cannot show: whether the comms agent writes good patches. F4FC is over budget, so its next round will be a whole rewrite by the new rule; the first real patch is the round after that.

## Left to the builder

- File and function names beyond those given.
- The exact wording of the prep rules and the copy strings, in the style of what is there.
- How the Brief tab lays out the preview lines.
- Whether the no-op check compares normalized content or the summary counts.
