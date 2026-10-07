# Brief rules digest — as enforced 2026-10-07

For each rule: what the code does, where (file:line), and a checkbox row for Nico.
Mark [ ] keep · [ ] change · [ ] drop. Changes become follow-up issues.

## 1. What the agent is told (system prompt)
- **Persona is "Sam", intake only** — Default identity says Sam sits in the middle of a living brief, surfaces gaps, does not decide, and is not the developer. A per-project `identity` replaces it. `lib/agent/constants.ts:17`, `lib/agent/system-prompt.ts:54`.
  - [ ] keep · [ ] change · [ ] drop
- **Mode picks the rule set** — `converge` gets the converge rules; anything else gets discover. `lib/agent/system-prompt.ts:55`.
  - [ ] keep · [ ] change · [ ] drop
- **Discover gravity** — Curious and Deepening; challenge sparingly; open-ended questions; never suggest technical implementation. `lib/agent/constants.ts:81-88`.
  - [ ] keep · [ ] change · [ ] drop
- **Converge gravity** — Challenging and Confirming; offer 2-3 concrete options; high-level tech allowed; park ambitious ideas as "phase 2". `lib/agent/constants.ts:121-129`.
  - [ ] keep · [ ] change · [ ] drop
- **Six postures and read-the-user mapping** — Curious, Deepening, Challenging, Confirming, Yielding, Closing, with a rule table mapping user answers to the next posture. `lib/agent/constants.ts:23-39`.
  - [ ] keep · [ ] change · [ ] drop
- **Summarize back is a posture, not a schedule** — Confirming is one of six postures; no code trigger for "at natural checkpoints". `lib/agent/constants.ts:27`.
  - [ ] keep · [ ] change · [ ] drop
- **Accuracy before restatement** — On domain-specific explanations, do not paraphrase back; ask a clarifying question if unsure. `lib/agent/constants.ts:63`.
  - [ ] keep · [ ] change · [ ] drop
- **Maker's direction wins** — If the user asks for something else, do it even if it drops the seed questions or directives. `lib/agent/constants.ts:58`.
  - [ ] keep · [ ] change · [ ] drop
- **One question per message; two-strike yield** — `lib/agent/constants.ts:60-61`.
  - [ ] keep · [ ] change · [ ] drop
- **Frustration brake** — If answers turn terse, ask at most one short question and offer to wrap up. `lib/agent/constants.ts:62`.
  - [ ] keep · [ ] change · [ ] drop
- **Plain language, banned jargon list** — Names "user journeys", "microservices", "tech stack", "MVP", "wireframes", "sprints". Note Sam itself emits "wireframe" blocks. `lib/agent/constants.ts:64`.
  - [ ] keep · [ ] change · [ ] drop
- **Concise, neutral, mirrors style** — `lib/agent/constants.ts:65-66`.
  - [ ] keep · [ ] change · [ ] drop
- **Intake-not-builder expectation** — Remind users Sam hands a brief to a developer; set this early. `lib/agent/constants.ts:67`.
  - [ ] keep · [ ] change · [ ] drop
- **Cannot see the app** — Sam says so rather than inventing a tour; offers screenshots. `lib/agent/constants.ts:68`.
  - [ ] keep · [ ] change · [ ] drop
- **Quick-choice buttons** — Optional `options` block, 2-4 choices, one per message, at the end. `lib/agent/constants.ts:41-54`.
  - [ ] keep · [ ] change · [ ] drop
- **Closing gate, not exchange count** — Discover closes on depth, seed questions covered, one vague answer challenged; converge on directives covered and decisions confirmed. Close with summary, beta note, feedback ask. `lib/agent/constants.ts:96-107`, `lib/agent/constants.ts:137-148`.
  - [ ] keep · [ ] change · [ ] drop
- **Name handling** — Solo maker: address by first name, verify the name once on first contact. Never say a trailing last initial. `lib/agent/system-prompt.ts:82-91`, `lib/agent/constants.ts:59`.
  - [ ] keep · [ ] change · [ ] drop
- **Multi-human mediation** — With 2+ speakers, messages are name-prefixed; Sam surfaces differences and asks how to reconcile instead of picking a side. Roster is "who has posted in this session", not all members. `lib/agent/system-prompt.ts:67-81`.
  - [ ] keep · [ ] change · [ ] drop
- **Seed questions are injected in both modes** — Woven in "when they fit". `lib/agent/system-prompt.ts:93-101`.
  - [ ] keep · [ ] change · [ ] drop
- **Directives are injected in both modes** — Described as "priorities, not a script"; defers to maker direction. `lib/agent/system-prompt.ts:103-111`.
  - [ ] keep · [ ] change · [ ] drop
- **Layout mockups / wireframe blocks** — Builder mockups are shown if present; otherwise a generic "use only when it helps" block. `lib/agent/system-prompt.ts:113-149`.
  - [ ] keep · [ ] change · [ ] drop
- **Locked decisions reconcile rule** — Locked decisions are "not open for casual revisiting"; a contradicting user statement must be surfaced by name and only treated as changed on explicit confirm. `lib/agent/system-prompt.ts:154-164`.
  - [ ] keep · [ ] change · [ ] drop
- **Unlocked decisions: don't revisit** — "Decided in prior sessions. Don't revisit unless the user brings them up." `lib/agent/system-prompt.ts:166-174`.
  - [ ] keep · [ ] change · [ ] drop
- **Open risks as probe targets** — Listed for Challenging or Deepening. `lib/agent/system-prompt.ts:176-184`.
  - [ ] keep · [ ] change · [ ] drop
- **Current brief block** — Problem, users, features, constraints, additional context (decisions and risks are separate blocks). `lib/agent/system-prompt.ts:186-194`, `lib/agent/system-prompt.ts:255-267`.
  - [ ] keep · [ ] change · [ ] drop
- **Session 1 vs 2+ context line** — Session 1: introduce, say a developer builds from the brief. Session 2+: greet warmly, briefly, no re-introduction. `lib/agent/system-prompt.ts:226-238`.
  - [ ] keep · [ ] change · [ ] drop
- **Returning-after-break recap** — If the gap since the maker's last message is at least 1 hour, recap in 1-2 sentences then ask the focus. Gap is humanized to a few hours / about a day / a few days / over a week. `lib/agent/system-prompt.ts:41-49`, `lib/agent/system-prompt.ts:218-224`.
  - [ ] keep · [ ] change · [ ] drop

## 2. How the brief is regenerated and merged
- **Input is everything** — Regen reads all messages from all sessions of the project, archived sessions included, plus the latest brief. Throws if there are no messages. `lib/api/briefs.ts:71-102`.
  - [ ] keep · [ ] change · [ ] drop
- **Forced tool call** — The model must call `update_brief`; output is bounded by 8192 tokens at temperature 0.3. `lib/api/briefs.ts:23-60`, `lib/api/briefs.ts:158`, `lib/agent/constants.ts:14-15`.
  - [ ] keep · [ ] change · [ ] drop
- **Truncation is a typed failure** — `max_tokens` stop or no tool call throws, which feeds the breaker. `lib/api/briefs.ts:178-188`.
  - [ ] keep · [ ] change · [ ] drop
- **Model is told to extract only what the user said** — Do not invent; preserve prior information unless contradicted; a decision means a committed choice. `lib/agent/next-convo-prompt.ts:55-61`.
  - [ ] keep · [ ] change · [ ] drop
- **Output is coerced** — Wrong types become empty values; decision entries keep only topic, decision, and `locked` when exactly true. `lib/api/briefs.ts:190-218`.
  - [ ] keep · [ ] change · [ ] drop
- **Locked decisions survive regen verbatim, in code** — Any locked decision in the previous brief is re-injected exactly, placed first; a model rewrite under the same topic (case-insensitive) is discarded. `lib/api/brief-merge.ts:29-48`, `lib/api/briefs.ts:222`.
  - [ ] keep · [ ] change · [ ] drop
- **Regen cannot unlock** — Nothing in the regen path can remove a lock. But a model can create a new lock (`locked: true` is accepted from output). `lib/api/briefs.ts:210`.
  - [ ] keep · [ ] change · [ ] drop
- **Contradictions go to open_risks** — The model is told to keep the locked decision and log "conflicts with locked decision" in `open_risks`. This is prompt-only, not code-checked. `lib/agent/next-convo-prompt.ts:62`.
  - [ ] keep · [ ] change · [ ] drop
- **Unlocked decisions and everything else: model may rewrite freely** — Problem, users, features, constraints, context, open risks, and unlocked decisions all come from the model. `lib/api/brief-merge.ts:41-47`.
  - [ ] keep · [ ] change · [ ] drop
- **Decision provenance stamped by code** — New topic gets session id and time; unchanged text keeps the previous stamp; changed text restamps. Model-echoed stamps are stripped. `lib/api/brief-merge.ts:89-114`, `lib/api/briefs.ts:228-236`.
  - [ ] keep · [ ] change · [ ] drop
- **Stamp session** — The latest non-archived session that has messages. `lib/api/briefs.ts:79-98`.
  - [ ] keep · [ ] change · [ ] drop
- **Save overwrites in place** — Existing brief doc is updated and `version` incremented; no history of prior content is kept. `lib/api/briefs.ts:256-274`.
  - [ ] keep · [ ] change · [ ] drop
- **Pasted JSON (PUT) bypasses the lock merge** — Builder-or-higher can replace a brief; decisions get provenance stamps but `mergeLockedDecisions` is not called, so a paste can drop or unlock a locked decision. `app/api/briefs/route.ts:42-113`.
  - [ ] keep · [ ] change · [ ] drop
- **Locked-first display** — Helper orders locked decisions first for the brief view and markdown export. `lib/api/brief-merge.ts:120-125`.
  - [ ] keep · [ ] change · [ ] drop
- **Regen prompt is the builder copy-paste prompt reused** — It still asks for a `next-convo` JSON with welcome_message, nudge, mode, directives, etc., but only the `update_brief` tool fields are read. `lib/agent/next-convo-prompt.ts:15-50`.
  - [ ] keep · [ ] change · [ ] drop

## 3. When regen runs (gate)
- **Cron cadence** — `/api/cron/notify` runs every 5 minutes. `vercel.json:4-5`.
  - [ ] keep · [ ] change · [ ] drop
- **Idle trigger** — A project is a candidate once its last maker message is over 10 minutes old. `app/api/cron/notify/route.ts:7`, `app/api/cron/notify/route.ts:26-30`.
  - [ ] keep · [ ] change · [ ] drop
- **Skip if brief is already fresh** — Skip when the brief's `updated_at` is not older than the last maker message. `app/api/cron/notify/route.ts:74`.
  - [ ] keep · [ ] change · [ ] drop
- **Skip if every member archived the brief** — `app/api/cron/notify/route.ts:83-89`.
  - [ ] keep · [ ] change · [ ] drop
- **Circuit breaker** — After 3 consecutive failures the project is skipped. A maker message newer than the streak start resets the whole streak. `lib/api/brief-regen-gate.ts:16`, `lib/api/brief-regen-gate.ts:27-43`.
  - [ ] keep · [ ] change · [ ] drop
- **Failure bookkeeping** — Each failure bumps the count and stores the error text (200 chars) and time on the project. Success clears them. `app/api/cron/notify/route.ts:94-111`.
  - [ ] keep · [ ] change · [ ] drop
- **Manual regen** — `POST /api/briefs/generate` (builder+) runs regen immediately and clears the breaker counters. `app/api/briefs/generate/route.ts:5-11`, `app/api/briefs/generate/route.ts:28-33`.
  - [ ] keep · [ ] change · [ ] drop

## 4. Who speaks first / return sessions
- **Only session 1 gets the canned welcome** — Later sessions get no stored welcome even if `welcome_message` is set; archived sessions do not count. `app/api/sessions/route.ts:64-76`, `app/api/sessions/route.ts:122-131`.
  - [ ] keep · [ ] change · [ ] drop
- **Kickoff fires on an empty return session, any gap** — Requires prior maker history anywhere on the project. `lib/agent/kickoff.ts:56`.
  - [ ] keep · [ ] change · [ ] drop
- **Kickoff on a non-empty session needs a 1-hour gap** — Measured from the maker's last message. `lib/agent/kickoff.ts:7`, `lib/agent/kickoff.ts:58`.
  - [ ] keep · [ ] change · [ ] drop
- **Never interrupt a mid-turn maker** — No kickoff if the last stored message is not from the agent. `lib/agent/kickoff.ts:33-34`, `app/api/chat/kickoff/route.ts:105-111`.
  - [ ] keep · [ ] change · [ ] drop
- **First-ever session is declined** — No maker history means no kickoff. `app/api/chat/kickoff/route.ts:124`.
  - [ ] keep · [ ] change · [ ] drop
- **Maker-side roles only** — Builder, admin, and owner-tier viewers never consume a kickoff. `app/api/chat/kickoff/route.ts:81-84`.
  - [ ] keep · [ ] change · [ ] drop
- **One greeting per return, plus a 30s debounce** — `last_kickoff_at` is stamped before streaming; no second greeting until the maker speaks. `app/api/chat/kickoff/route.ts:33`, `app/api/chat/kickoff/route.ts:126-138`.
  - [ ] keep · [ ] change · [ ] drop
- **Multi-human kickoff greets the opener by name** — Synthetic final turn names whoever opened the session. `app/api/chat/kickoff/route.ts:165-176`.
  - [ ] keep · [ ] change · [ ] drop

## 5. Other context injected
- **Models and limits** — Chat and brief both use `claude-sonnet-4-6`; chat max 2048 tokens at temperature 0.7. `lib/agent/constants.ts:1-3`, `lib/agent/constants.ts:6`.
  - [ ] keep · [ ] change · [ ] drop
- **Config is read from the session snapshot** — Mode, seed questions, directives, identity, mockups are snapshotted at session creation with fallback to project. Maker name and time gap are read live. `lib/agent/system-prompt.ts:9-11`, `app/api/sessions/route.ts:102`.
  - [ ] keep · [ ] change · [ ] drop
- **Sibling locked decisions (#142)** — Locked decisions from other briefs sharing the same `github_repo`, max 20, ordered by sibling title; the agent must confirm before treating any as changed. Briefs without a `github_repo` get none. `lib/agent/sibling-decisions.ts:16-39`, `lib/agent/sibling-decisions.ts:48-54`, `lib/api/sibling-decisions.ts:19-29`.
  - [ ] keep · [ ] change · [ ] drop
- **Prototype feedback (#72)** — Up to 8 recent Loop reports, each cut to 280 characters, resolved ones marked. `lib/agent/prototype-feedback.ts:29-30`.
  - [ ] keep · [ ] change · [ ] drop
- **Prototype page captures (#72 B2)** — At most 3 captures, none older than 14 days, outline cut to 2000 characters; told not to invent visuals. `lib/agent/prototype-context.ts:22-26`, `lib/agent/prototype-context.ts:81-85`.
  - [ ] keep · [ ] change · [ ] drop
- **Pinned artifacts (#83)** — Up to 10 pinned files or links, names and descriptions only; told they have not been read. `lib/agent/artifact-context.ts:24`, `lib/agent/artifact-context.ts:54`.
  - [ ] keep · [ ] change · [ ] drop
- **Round-two facilitator is a separate prompt** — Own identity and rules; sees none of the brief context; never proposes tools or fixes. `lib/agent/system-prompt.ts:274-279`, `lib/agent/constants.ts:154-172`.
  - [ ] keep · [ ] change · [ ] drop

## 6. Doc vs code drift
- **`docs/mode-system.md` is not about session modes** — Its title and body cover viewer role glyphs and Conversation/Console chrome (header says "design agreed, not built"). Discover/converge session mode is not described there; the code is `lib/agent/system-prompt.ts:55` and `docs/iteration-architecture.md`.
- **Decisions are "AI-extracted only; builder cannot add/edit"** (`docs/iteration-architecture.md`, Brief decisions) vs code: pasted JSON can set decisions and `locked` (`app/api/briefs/route.ts:42-113`), and the create payload accepts `brief.decisions` with `locked` (`CLAUDE.md`, Project Setup JSON).
- **Locked decisions change only via "an explicit maker confirm (a separate, deliberate flow)"** (`lib/api/brief-merge.ts:10-12`) vs code: no such flow exists; regen never unlocks, and the only unlock path is the unguarded paste (`app/api/briefs/route.ts:42-113`).
- **Seed questions only in discover, directives only in converge** ("UI shows one or the other", `docs/iteration-architecture.md`) vs code: both are injected in every mode (`lib/agent/system-prompt.ts:93-111`).
- **Directives are "Don't skip these"** (`docs/iteration-architecture.md`) and "highest-authority behavioral control" that can pin or suppress postures (`docs/conversational-posture-model.md`) vs code: "priorities, not a script", with the maker's direction overriding (`lib/agent/system-prompt.ts:107`, `lib/agent/constants.ts:58`).
- **Pacing "8-12 exchanges"** (`docs/iteration-architecture.md`) vs code: "Do not close based on exchange count" (`lib/agent/constants.ts:96`, `lib/agent/constants.ts:137`).
- **Welcome message "added as first message" of each new session** (`docs/iteration-architecture.md`, Between-Sessions Flow step 7) vs code: first session only (`app/api/sessions/route.ts:122-131`). `CLAUDE.md` already has this right.
- **Prompt assembly order list** (`docs/iteration-architecture.md`) omits participants, layout mockups, locked decisions, sibling decisions, prototype feedback and captures, pinned artifacts; actual order is `lib/agent/system-prompt.ts:54-238`.
- **Identity text quoted as "iBuild4you project intake assistant"** (`docs/conversational-posture-model.md`) vs code: the persona is "Sam" (`lib/agent/constants.ts:17`). Session model example "claude-sonnet-4-20250514" (`docs/iteration-architecture.md`) vs `claude-sonnet-4-6` (`lib/agent/constants.ts:1`).
- **CLAUDE.md "Early sessions broad, later more specific"** vs code: nothing keys on session number for depth; only the builder-set `session_mode` does (`lib/agent/system-prompt.ts:55`, `lib/agent/system-prompt.ts:226-238`).
- **CLAUDE.md PATCH field list** omits `github_repo`, `auto_reminders_enabled`, `feedback_requires_identity`, which the route accepts (`app/api/projects/route.ts:190`).

## 7. Open questions for Nico
1. Should a pasted brief (PUT) be allowed to drop or unlock a locked decision, or should it run the same lock merge as regen?
2. Should a model-created `locked: true` in regen output be honoured, or may only builders set locks?
3. Should seed questions and directives be mode-scoped as the docs say, or stay injected in both modes?
4. Should a builder-set `welcome_message` ever post on session 2+, given it is silently unused today?
5. Is the 10-minute idle plus 5-minute cron cadence right, and is overwrite-in-place (no brief history) acceptable?
6. Should the banned-jargon list exclude "wireframes" while Sam is also told to emit wireframe blocks?
