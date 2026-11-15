# Relay efficiency: brief prep, notes, and the Code relay

Date: 2026-11-15. Status: programme spec. Project 1 is designed in full and approved for build (Nico, 2026-11-15). Projects 2 to 6 each record the problem, the options and a recommended approach; each gets its own short design pass before it is built.

## Why

A problem statement written from Danny's project (F4FC, 21 conversations, Oct 12 to Nov 15) listed seven groups of friction in how a long project runs: the brief is rewritten whole each round, notes lose detail, the builder can't see where a payload stands, and build facts go stale on the way from Claude Code to the maker. Nico wants the practices and the app changed so a long, active project costs less of his time and stops sending the maker wrong information.

Two root causes sit under most of the list:

1. The brief is rewritten whole, by hand, every round (groups 1 and 2).
2. Nobody in the relay can see the facts directly. Claude Code in the build repo can't read the brief or the notes, and the brief has no verified view of what is deployed (groups 4 and 5).

## What the code says about the report

Checked on main at `799b500`.

- The 20,000 characters is a warning, never a refusal (`lib/agent/brief-size.ts:12`). It is measured on compact JSON (`lib/agent/next-convo-prompt.ts:125`); the prep only displays the brief pretty-printed.
- Provenance stamps do not need to travel. On a paste the server carries each unchanged decision's stamps from the stored brief and ignores incoming ones (`lib/api/brief-merge.ts:247`), and keeps the origin on a revised one (`:257`). Sam's prompt renders a decision as topic and text only (`lib/agent/system-prompt.ts:231`, `:242`). The stamps still count toward the size.
- A note's decision is `{ topic, decision }` and a settled risk is its text only (`lib/api/note-writer.ts:50`, `:69`). The note prompt does not tell the writer to restate a revised decision in full (`lib/agent/note-prompt.ts:26`).
- An import into an open conversation is meant to be all or nothing: re-snapshot the config and post the welcome if the maker has not replied, else do nothing (`lib/sessions/apply-import.ts`). See project 5 for what was found on the reported cases.
- Structured test results were issue #217, closed as not planned on 2026-11-02 with "reopen if structured pass/fail results become a real need".
- No route lets a build repo read a brief or its notes. The only keyed read is Loop feedback (`GET /api/feedback/read`).

## Goals

- A round of prep on a long project starts from the content, not from trimming.
- A note never loses the answer to a question or the standing detail of a decision.
- Nothing reaches the maker as "live" unless someone checked production.
- Claude Code works from the current brief and notes without Nico carrying them.
- The builder can see at a glance where a payload stands.

## Non-goals

- Replacing the ferry desk. The comms agent stays a separate chat and the builder stays the one who loads a payload (#229).
- A maker email inbox (problem 7). A builder note with "Sam replies" off already carries maker email into the conversation, and from there into a note.
- Changing who Sam is or how Sam talks.

## Anti-goals

- Any change that lets a model silently drop or reword a locked decision.
- Maker names, emails or brief contents going anywhere public.
- A stored brief that loses its decision history.

## Order

1. Quick batch (this spec, build now).
2. Practice rules for build repos (text below, no code).
3. Code reads the brief and notes directly.
4. Payload as changes instead of a whole rewrite.
5. Payload status on the Brief tab, plus the two reported bugs.
6. Reopen #217 (structured test results).

---

## Project 1: quick batch

Two PRs. PR A changes what the comms agent is given and told. PR B changes what a note records.

### PR A: the prep

**A1. Stamps leave the prep and the size count.**

- A pure helper returns a brief with `decided_in_session`, `decided_at`, `revised_in_session` and `revised_at` removed from every decision (`stripDecisionProvenance` in `lib/api/brief-merge.ts` already does this for a decision list).
- The prep renders that stripped brief in `<current_brief>` and reports its compact size.
- `briefSizeWarning` measures the same stripped brief, so the Brief tab, the paste response and the prep agree on one number.
- The prep's schema example drops the four stamp fields. The rule "carry them through unchanged" becomes: do not write these fields; the app keeps each decision's history by its topic. The same change goes in the curation guide (both copies; a test pins them equal).
- The note writer's `<current_brief>` uses the same stripped brief. It has no use for stamps and pays for them on every note.
- No server change. A payload that still carries stamps (an old prep) behaves as today. The stored brief, the Brief tab's "conv 2 · Jul 11" line, the version history and the markdown export keep the stamps.
- Tests: a paste with no stamps keeps every stamp on unchanged decisions and stamps a revision on a changed one; the prep text contains no stamp field; the size helper ignores stamps.

Expected effect on F4FC: the comms agent's estimate is 5 to 6 thousand characters of stamps in 22.6 thousand, which puts the brief back under budget with nothing lost. Not measured from here; the Brief tab will show the real figure after deploy.

**A2. The welcome keeps live, proposed and to-test apart.**

One new rule in the prep, beside the existing `welcome_message` rule:

> In `welcome_message`, keep three kinds of statement apart, each in its own short paragraph, and only when there is something to say: what is live now, what is proposed and not built, and what you would like them to try. "Live" means it is in `shipped`, or the builder told you in this chat that it is deployed. Say plainly that a proposed thing does not exist yet. Give test steps only for things that are live. Never describe a proposed screen, button or choice as if the maker can already see it.

No structural change to the welcome: it stays one string, posted word for word.

**A3. The builder is told when a prep has nothing new.**

When "Copy next-convo prep" runs with no unfolded notes, the confirmation says so: the prep is copied, and there are no new notes since the brief was last curated. The wording goes in `lib/copy.ts`. The prep is still copied, because the builder may want to plan a round with no new notes.

### PR B: the note

All three are changes to the note writer's prompt and tool schema, so the system-prompt cache is rewritten once after deploy.

**B1. A settled risk carries its answer.**

- `risks_resolved` items become `{ text, resolution }`. `text` is the open risk's exact text, as today. `resolution` is one sentence: what the maker decided or said, in their words.
- The stored type accepts both shapes (`string | { text, resolution? }`), the same way `open_risks` accepts a string or an object. Old notes read unchanged. Helpers in `lib/brief/risks.ts` return the text and the resolution.
- Everything that renders a note shows the answer when there is one: the prep (`Risks settled`), Sam's "New since the brief was last curated" block, the Brief tab's notes list, and the notes-since-curation input to the next note.
- The prep gains a rule: when a note settles a risk with an answer, write the answer into the brief (as a decision when the maker committed to a choice, else in the field that fits) before dropping the risk.

**B2. A revised decision is restated whole.**

The note prompt's decision rule gains: when the maker changes part of a decision already in the brief, write the whole decision as it now stands, keeping everything in the brief's text that still holds. When what they said is a separate point on the same subject, give it its own topic and leave the brief's decision alone.

This is the fix for "the two games stay separate" replacing the bar ranges.

**B3. A promise to follow up becomes an open risk.**

The note prompt's risk rule gains: when the maker says they will send, check or decide something later, add it to `risks_added` with owner `maker`, worded as what is still owed. When the builder side owes it, owner `builder`. This was not in the list Nico approved; it is added here because it is one sentence in the same prompt and is the fix for "details to follow" notes. Drop it if unwanted.

### What can't be checked by tests

A1's server behaviour, the shapes, the renderers and the copy are unit-tested. Whether the comms agent and the note writer follow the new prompt rules shows up only in real use. First check: Nico's next prep and next note on F4FC.

---

## Project 2: practice rules for build repos

No code. These go in the build repo's CLAUDE.md, starting with l6-music. If they hold up, propose them to prompt-lab as a shared convention for every repo that builds for a maker.

> **Build status for a maker**
>
> - Never say a change is live, deployed or available unless you checked production in this session, and say what you checked (the deployed commit, or the page loading). Otherwise say "merged, not deployed".
> - A status report is for the comms agent, not the maker. Write facts in three lists: live now (date and what you checked), merged but not deployed, and proposed or not built. Then the questions. No prose addressed to the maker, and no test steps for anything outside "live now".
> - Before you list a question as still owed, check it against the current brief and notes, and name the brief version or date you checked against. If your copy is older than the maker's last conversation, ask Nico for the current one.
> - Every number or file fact in a report is re-read from the current files in this session, never taken from earlier notes or from CLAUDE.md.

## Project 3: Code reads the brief and notes directly

**Re-scoped 2026-11-15, after the design pass.** Two facts changed the picture. A read-only reader for build repos already exists (`scripts/mcp-briefs.mjs`, #133) and only lacked notes, a registration in l6-music and a start that works on the laptop. And three of the eight build repos are public (tideline, prntd, ibuild4you), so a mirror would have to refuse them. Nico's decision: fix the reader now (`2026-11-15-brief-reader-notes-design.md`), and treat option A below as a separate, later project whose point is the return leg (Code posts its status as a comment and the prep picks it up) and cloud sessions. The options below are kept as written for that project's design pass.

Problem: Code's reports list answered questions as owed and repeat stale facts, because Code sees the brief only when Nico pastes it.

Options:

- **A. Mirror to a GitHub issue in the build repo (recommended).** On each note and each paste, the app updates one pinned issue in `projects.github_repo`: the body is the brief's markdown export, each new note is a comment. Code reads it with `gh`, which already works in local and cloud sessions. The app's GitHub token already has issue read and write on the eight build repos. Cost: maker content sits in a GitHub issue, so the repo must be private (l6-music is; the app must refuse a public repo).
- **B. A keyed read endpoint,** like the Loop read key: `GET /api/briefs/read` returns the brief and unfolded notes. Clean, but the key is a secret the agent can't fetch on this setup (the secrets hook blocks `op`, and cloud sessions have no 1Password), so Nico would still be in the loop.
- **C. Keep the manual paste** and add a reminder on the Brief tab when the build repo's copy is older than the last note. Cheapest; removes nothing.

A second step, once A exists: Code posts its three-list status as a comment on the same issue, and the prep pulls the comments made since the last paste into a `<build_status>` block. That takes Nico out of the Code to comms-agent leg as well.

Open for the design pass: whether notes go as comments or in the body; whether the mirror is on by default per project; what Code's status comment must contain for the app to trust "live".

## Project 4: payload as changes

Problem: every payload must restate every decision still in force, and anything left out is deleted.

Options:

- **A. A partial brief (recommended).** The payload may carry `brief_patch` in the brief's own shape: text fields replace when present; decisions merge by topic (present means add or replace); features, risks, shipped and queued add; an explicit `drop` block names what to remove. Locks are protected as today. The whole-brief `brief` stays accepted, for the occasional round that restates and compacts old decisions (problem 1.4).
- **B. An operations list** (`revise_decision`, `settle_risk`, and so on). More exact, more for a model to get wrong, and a second vocabulary to keep in step with the brief's shape.
- **C. The app folds simple notes itself** and the comms agent only compacts now and then. This walks back #229, which moved curation to the comms agent on purpose.

Open for the design pass: how the Brief tab previews a patch before it is applied; whether the size warning should suggest a compaction round; how the paste guard's stamp works with a patch.

## Project 5: payload status, and the two reported bugs

Problem: the builder could not tell whether a payload had been loaded, shared or answered, and two flows behaved unexpectedly.

Proposed: one status line on the Brief tab built from stamps the project already has (`payload_pasted_at`, `payload_pasted_version`, `shared_at`, `last_maker_message_at`, `prep_copied_at`): "v55 loaded Nov 14 · conversation 21 started Nov 14 · maker replied Nov 15". Display work only.

The two reports were traced through the code on 2026-11-15. Neither was reproduced against live data, so each needs a failing test or a preview run before its fix.

**Report: a welcome landed in an open conversation while the old directives kept running, and the maker saw two welcomes.**

- The server never posts a welcome without re-copying the config onto the same session, in one batch (`lib/sessions/apply-import.ts:62-84`). So "new welcome, old directives" has two likely causes, neither a split write: the payload left out `builder_directives` (the project's old ones are re-copied), or the brief was in discover mode, where directives are not sent at all.
- Two welcomes is real. An import into an open conversation removes only the canned "nothing queued" greeting (`apply-import.ts:59`). A welcome posted when the conversation was created stays, and the new one is added after it.
- The banner tells the builder the opposite of what happened. After a paste that is not followed by "start", it says "agent config applies from the next conversation" (`components/builder/BuilderProjectView.tsx:1185-1192`), while the server has just applied the config to the open conversation when the maker has not replied in it.

**Report: "Start conversation N" emailed the maker and the thread was empty.**

- Designed, in one case: on a return conversation with no welcome, or with a welcome an earlier conversation already used, the thread starts empty and Sam's kickoff greets when the maker opens it (`lib/sessions/welcome.ts:23-27`).
- Probably not designed, in another. The import and the header disagree on whether the maker has replied. The import counts only maker messages after the last canned greeting (`apply-import.ts:35-39`); the header and the new-session route count any maker message (`BuilderProjectView.tsx:1104`, `app/api/sessions/route.ts:132-139`). Sequence: the maker spoke, the kickoff posted the canned greeting, the builder imports. The import posts the new welcome into that old conversation; the header then offers "start"; the new conversation treats the welcome as used and opens empty, with the welcome stranded in the closed one.
- Nothing warns the builder. The Start modal's "Opens with" line shows the project's welcome whether or not it will be posted (`BuilderProjectView.tsx:2289`), and the result line says only "Conversation N created. Emailed …".

Fixes to design in this project's pass: one shared rule for "has the maker replied in this conversation" used by the import, the header and the new-session route; a banner that says what the server did; a Start modal that shows what will actually open the thread (the welcome, or Sam's greeting); and a ruling on whether a new welcome replaces or follows one the maker has not answered.

Not determined: whether a builder's own note in the conversation should count as a reply here. It counts in the import and the header and is excluded only in the kickoff (#254).

## Project 6: structured test results

Reopen #217 with this report as the evidence its closing note asked for: on F4FC the comms agent hand-picks from 10 to 15 questions and tests per relay, and pass or fail per step is not reliably captured. Nico's call; nothing is built until he reopens it.

## Left alone

- Problem 6.1 (no queue for relayed questions): maker-owned open risks are the queue today. Revisit after project 4, when adding a risk no longer costs a whole rewrite.
- Problem 7 (maker email): see non-goals.
