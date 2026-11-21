# Project setup JSON

The create and update payloads, and the rules for decisions, locks, provenance and open risks. Moved out of `CLAUDE.md` on 2026-11-18, word for word, to keep that file short.

Projects can be created and updated via JSON payloads. The dashboard's "Import JSON" tab accepts the create payload directly.

### Create (POST /api/projects)

Only `title` is required. All other fields are optional.

```json
{
  "title": "Sam's Cafe App",
  "requester_email": "sam@example.com",
  "requester_first_name": "Sam",
  "requester_last_name": "Lee",
  "participants": [
    { "email": "sam@example.com", "first_name": "Sam", "last_name": "Lee", "role": "maker" },
    { "email": "dana@example.com", "first_name": "Dana", "role": "apprentice", "brief_role": "contributor" }
  ],
  "context": "Background info the agent uses to skip basic discovery questions. Do not suggest technologies.",
  "welcome_message": "Hey Sam — tell me about your cafe idea!",
  "nudge_message": "Optional. When set, used verbatim as the outbound nudge text for the next session and skips AI generation. Leave blank to let the AI draft.",
  "voice_sample": "Optional. One paragraph showing how you'd text this person by hand. Used as a style anchor for AI-generated outbound copy (nudge/invite/reminder). Ignored when nudge_message is set.",
  "session_mode": "converge",
  "language": "fr",
  "model": "claude-sonnet-5-5",
  "hide_title_in_previews": false,
  "seed_questions": [
    "What problem are you trying to solve?",
    "Who are your customers?"
  ],
  "builder_directives": [
    "Focus on the ordering workflow"
  ],
  "brief": {
    "problem": "Customers can't order online",
    "target_users": "Local cafe customers",
    "features": ["Online ordering", "Pickup scheduling"],
    "constraints": "Must work on mobile",
    "additional_context": "",
    "decisions": [{ "topic": "Payment", "decision": "Stripe only", "locked": true }]
  },
  "session_opener": "Alias for welcome_message (either works)"
}
```

Side effects on create: generates slug, creates owner membership, creates a membership + approves email **for each participant** (see below; sign-in is via Google or the invite flow's password-setup link), creates first session (snapshots config), adds welcome message as first agent message, creates initial brief (if `brief` provided).

An open risk may be a plain string or `{ "text": "…", "owner": "maker" | "builder" }`: maker means only they can settle it, builder means it is the builder's to resolve. The note writer records owners on new risks, and every paste carries an existing owner forward by text match, also from folded notes (#220); the Brief tab lists maker-owned ones with Copy as markdown, and the dashboard row counts them.

**Participants.** `participants[]` seeds any number of people on a brief in one payload — each `{ email (required), first_name?, last_name?, role?, brief_role? }`. `role` is a `MemberRole` (`maker` | `apprentice` | `builder` | `owner`; default `maker`); `brief_role` defaults from role (maker→originator, apprentice→contributor, builder→reviewer). The legacy `requester_email`/`requester_first_name`/`requester_last_name` (+ `brief_role`) still work and are folded in as the first participant. Rules: dedup by lowercased email; the creator's own email is skipped (already the owner); the project doc's displayed requester is the first `maker` participant (else the first overall); **soft cap 20** (more → 400). No hard limit elsewhere — the chat roster name-tags arbitrarily many distinct senders. The response includes a `members: [{ email, role, brief_role }]` array (passcodes no longer minted or returned, PR D).

`language` (optional, `en` | `fr`, default English): the language the maker is addressed in — the agent converses in it from the first message, welcome/nudge copy is written in it, every outbound maker email (invite, nudge, reminder, the cron's reminder digest; `lib/email/outbound-copy.ts`) is sent in it, and link previews use it. The password-reset email follows the sign-in page's locale instead, since it has no brief. The brief itself always stays in English. `hide_title_in_previews` (optional boolean): a shared `/projects/<slug>` link previews with the brief title unless this is true (then the anonymous colour/glyph/code card). Previews are unauthenticated and cached by messaging apps — never names or brief contents.

`model` (optional, `claude-sonnet-4-6` | `claude-sonnet-5-5` | `claude-opus-5-5`; omitted, blank or null = Default) picks the model Sam talks with on this brief (#189). Precedence: the brief's `model` > `CHAT_MODEL` > `AGENT_MODEL`. Chat and kickoff only; welcome, prep and note writing keep their own models. It applies from the next conversation: a session snapshots it as `agent_model`, and sessions created under Default stay Default. Any other value is a 400. It is a Settings-tab setting, not part of the comms-agent payload schemas.

`seed_questions` reach the agent only in `discover` mode and `builder_directives` only in `converge` mode (#192); both are stored regardless, so flipping `session_mode` never loses them. Guardrails that must hold in every session (e.g. "do not suggest technologies") go in `context`, which is always sent. The Conversations tab's Next round panel shows the one for the current mode; a JSON payload that sets both in `discover` mode simply has its directives held until the mode flips.

`layout_mockups` (retired with the wireframes in #195 phase 2) is no longer accepted since this release (#210): create and PATCH treat it like any other unknown field and ignore it.

A decision may carry `"locked": true` — a durable constraint (locked convention / do-not-use rule). Locked decisions are carried verbatim by the curation prep's rules, and a stamped ferry-desk paste (one carrying a valid `prep_stamp`) cannot drop, reword or unlock one, nor clear or replace its `contested`/`contest_dismissed`: the server restores every lock from the live brief (`restoreLocksOnPaste`, #229). The agent must reconcile new intake against them: a maker statement contradicting a locked decision triggers an explicit confirm instead of a silent overwrite (#71). Set via the create payload or the Brief-tab JSON paste (`PUT /api/briefs`). Since #197 a lock may be **contested** instead: at note time the note writer sets `contested: { proposed, reason }` on the locked decision when the maker explicitly confirmed a reversal in conversation (`lock_reversals`); the text and lock stay verbatim, the chat prompt shows the contest so Sam neither reopens nor adopts it, and the Brief tab shows a `Contested` badge with **Accept, keep locked** / **Accept and unlock** / **Dismiss** (all save through `PUT /api/briefs`, source `paste`). `contested` is only ever kept on a locked decision. Dismiss records `contest_dismissed { proposed, at }` so a later note does not re-raise the same proposal; a different proposal still can.

Decision provenance (#121): code stamps `decided_in_session`/`decided_at` on a new topic and never trusts the model's. Since 2026-11-15 the stamps are stripped from the next-convo prep and the note writer's input and do not count toward the 20,000 curation budget (`briefWithoutProvenance`, `briefSizeChars`); the comms agent is told not to write them, and the server carries them from the stored brief by topic as before. Since #218 a changed decision on a known topic (matched by trimmed, case-insensitive `topic`) is a **revision**: the origin stamps stay verbatim and `revised_in_session`/`revised_at` record the latest revision (only the latest is kept; the version history has the trail). A changed decision with no origin stamp gets only `revised_*`. The Brief tab reads `conv 2 · Jul 11, revised conv 4 · Oct 17`; the markdown exports `(decided conv 2, 2026-07-11; revised conv 4, 2026-10-17)`. A History → Restore whose text differs from the live decision reads as a revision today, by design.

The Brief tab's editor (structured or raw) and History → Restore ask first when a save would drop a lock ("This save removes the lock on: …"); those saves are unstamped, so a confirmed unlock goes through. A stamped ferry-desk paste needs no prompt because the server restores its locks and contests. An unstamped paste (old prep, hand-written JSON) and direct PUT callers behave as before: no prompt, and the payload's decisions are saved as sent. That is a whole brief; a patch's locks are kept, stamped or not.

### Next-convo brief: `brief_patch` or `brief`

A next-convo payload (pasted on the Brief tab, `PUT /api/briefs`) carries either a whole `brief` or a `brief_patch`, never both (400). A `brief_patch` holds only what the round changed; the server merges it into the live brief (`lib/brief/patch.ts`), then runs the usual lock restore, provenance stamping and risk-owner carry on the result. The prep asks for a `brief_patch` when the brief is at or under the 20,000-character budget and a whole `brief` when it is over, has no content yet, or the builder asks for a compaction in the chat.

```json
"brief_patch": {
  "constraints": "The whole new text of this field",
  "decisions": [{ "topic": "Bar ranges", "decision": "The decision as it now stands, whole" }],
  "features": ["A new feature"],
  "open_risks": [{ "text": "A new open risk", "owner": "maker" }],
  "shipped": [{ "date": "2026-11-18", "items": ["Something that went live"] }],
  "queued": ["Something newly planned"],
  "drop": {
    "decisions": ["Topic of a decision no longer in force"],
    "features": ["Text of a feature to remove"],
    "open_risks": ["Text of a settled risk"],
    "queued": ["Text of a queued item that shipped"]
  }
}
```

Every key is optional; `{}` is a valid patch (the brief does not change, the notes still fold). Merge rules, drops first, then additions:
- Matching (a decision's topic, the text of a feature, risk, queued or shipped item) ignores case, punctuation and spacing. A repeated drop entry counts once.
- Text fields (`problem`, `target_users`, `constraints`, `additional_context`): a non-empty string replaces the field; an empty or blank one is ignored, so a patch cannot clear a field.
- Decisions: matched by topic, ignoring case, punctuation and spacing; copy topics as shown. A known topic is replaced in place (stored topic spelling and position kept); a new topic is appended.
- Features and queued: appended unless already there. Shipped: an item already in any batch is skipped; a new one joins the batch with the same `date`, or a new batch is added. A patch cannot remove or merge shipped batches (a compaction, so a whole `brief`).
- Open risks: a new one is appended. One that matches an existing risk keeps the brief's text; only its owner can change. To reword a feature or a risk, drop the old text and add the new one.
- `drop`: decisions by topic; features, open risks and queued by text.

Refused (400, nothing written, no note folded): `patch_drop_unmatched` when a drop matches nothing (the response lists the unmatched entries by list), `patch_no_brief` when the project has no brief doc or its content is empty (`hasBriefContent`), and `brief` with `brief_patch` together. Unknown keys are ignored.

Locks: a patch never changes a locked decision, stamped or not. A restatement or drop aimed at a locked topic is ignored, the lock returns verbatim with its contest state, and the response lists the topics in `locks_kept`. The prep tells the comms agent not to include a locked decision in a patch at all. A patch may add a new locked decision, as a paste can.

When the merged brief equals the live one, no version is written; notes and reports still fold and the response carries the live version. The response adds `patch_summary` and `locks_kept`.

### Update (PATCH /api/projects)

Requires `project_id`. Only these fields are accepted: `title`, `context`, `welcome_message`, `nudge_message`, `voice_sample`, `session_mode`, `seed_questions`, `builder_directives`, `requester_first_name`, `requester_last_name`, `last_nudged_at`, `prep_copied_at`, `payload_pasted_at`, `payload_pasted_version`, `last_builder_activity_at`, `identity`, `github_repo`, `auto_reminders_enabled`, `language` (`en`|`fr`, else 400), `model` (one of the three ids; `''`/null = Default; else 400), `hide_title_in_previews` (boolean, else 400). Changing `title` regenerates the slug.
