# Brief reader for build repos: notes, shipped and queued, and a start that works on the laptop

Date: 2026-11-15. Status: short design, approved by Nico 2026-11-15 with the 1Password start. This is project 3 of the relay-efficiency programme (`2026-11-15-relay-efficiency-design.md`), re-scoped after the design pass.

## Why

Claude Code in a build repo lists answered questions as owed and repeats stale facts, because it sees the brief only when Nico pastes it. l6-music's rule today is "ask Nico for the current brief".

The programme spec recommended mirroring the brief to a GitHub issue. The design pass found that a reader already exists: `scripts/mcp-briefs.mjs` (#133) serves the live brief and full transcripts to a build repo, read-only, scoped to one repo, and is registered in byside and prntd. It has three gaps:

1. It predates notes (#229), `shipped` and `queued` (#219), and contested locks (#197). Since #229 the brief is no longer rewritten after each conversation, so the reader shows a brief that can be several conversations behind with nothing saying so.
2. It is not registered in l6-music.
3. It cannot start on the laptop. `scripts/with-prod-env-ro.mjs` reads the local env file from the current directory, which for a server started from a build repo is that repo, and the laptop's ibuild4you env file has no read-only key (and should not get one, see the design).

## Goals

- Code in a build repo reads the current brief, every note not yet folded into it, and what is shipped and queued, with no paste from Nico.
- The reader starts from any build repo on the laptop.
- l6-music uses it, and its "ask Nico" rule becomes "read it yourself".

## Non-goals

- The GitHub-issue mirror. It becomes its own project, designed around the return leg (Code posts its status, the prep picks it up).
- Cloud sessions. The reader is local only; in a cloud session Code still asks Nico.
- Any write path. The reader stays read-only on a viewer-only key.
- Registering the reader in repos other than l6-music (the same file works whenever wanted).

## Anti-goals

- Maker content leaving Firestore for a third party.
- A reader that can see briefs outside its repo (the `--repo` scope stays required).
- 👎 excerpts or reasons reaching a build repo: they are for the builder only.

## Approaches

- **Fix the existing reader (picked by Nico, 2026-11-15).** Small, no maker content on GitHub, works for public build repos (tideline, prntd), always live. Local sessions only, and no way for Code to post back.
- **Mirror to a GitHub issue.** Works in cloud sessions and gives Code somewhere to post status. Bigger, must refuse the three public repos, puts maker content on GitHub, and adds a sync that can fail. Deferred to its own project.
- **A keyed read endpoint.** Dropped: the key is a secret the agent cannot fetch on this setup.

## Design

### 1. The brief markdown (`scripts/lib/brief-markdown.mjs`, `renderBriefMd`)

Pure function, tested in `scripts/lib/brief-markdown.test.mjs`. It gains an optional `notes` list (unfolded notes, oldest first) and renders:

- **Header.** After the version line, when the project has them: how far notes cover (`notes_through_at`) and when the maker last wrote (`last_maker_message_at`), both as Pacific dates. This is what Code names when it says what it checked against.
- **A contested lock.** A locked decision with `contested` shows the request beside the lock: what the maker asked for and why. The decision text stays as it is.
- **`## Shipped`** as dated batches, newest first, and **`## Queued`** as a list. Each is left out when empty.
- **`## New since the brief was last curated`**, placed after open risks. One `###` block per note: its Pacific day and conversation number, the note's text, then `Decisions`, `New open risks` (with owner), `Risks settled` (the risk, then ` → ` and the answer when the note has one; a plain string and `{ text, resolution }` both render), and requests to reverse a lock. When there are no unfolded notes the section says so in one line, so Code knows notes were checked. With no brief, the section is left out.
- Never rendered: `thumbs_down`, note ids.

The wording follows the prep's note block (`renderNote` in `lib/agent/next-convo-prompt.ts`) so Code and the comms agent read the same thing.

### 2. The two callers

`scripts/mcp-briefs.mjs` and `scripts/export-brief.mjs` read `briefs/{id}/notes`, keep notes with no `folded_at`, sort oldest first and pass them in. `get_brief`'s description says it includes notes, shipped and queued. `list_briefs` adds a count of unfolded notes per brief.

### 3. The start: a launcher that gets the key from 1Password (Nico's choice, 2026-11-15)

The read-only key reads all of production Firestore (every maker conversation and email, and the Loop signing secrets), so it stays off the laptop's disk. A new launcher, `scripts/brief-reader.mjs`, is what a build repo registers:

- It takes the same arguments as the reader (`--repo owner/name`, required).
- If `FIREBASE_SERVICE_ACCOUNT_RO` is already in its environment it uses that. Otherwise it fetches the 1Password document `ibuild4you-firestore-ro` (vault `dev-secrets`) with the `op` CLI, which asks for Touch ID.
- It checks that what came back is a service-account key (parses, has a client email and a private key) and never prints it. On any failure it exits with one plain line on stderr saying what to do.
- It runs `scripts/mcp-briefs.mjs` in its own process (an `import`, not a child process), whatever directory it was called from. The first build passed the key to a child through the child's start-up environment; the whole-branch review caught that any process running as the same user can read a start-up environment with `ps` for as long as the reader runs. Set at run time in the launcher's own process, the key is not visible that way, and the reader removes it from the environment once Firebase has it. (When the key is supplied through `FIREBASE_SERVICE_ACCOUNT_RO` instead of 1Password, that variable is visible in the launcher's start-up environment; that is the caller's choice.)

Known cost: a Touch ID prompt when a session starts in a build repo. A missed prompt means no brief tools until the reader is reconnected (`/mcp`).

A build repo's `.mcp.json` then holds only the launcher's path and the repo name, so how the key is fetched can change later in one place.

`scripts/with-prod-env-ro.mjs` is not changed. byside's and prntd's registrations still point at it and should move to the launcher; that is a follow-up, not part of this change.

### 4. A check that prints no brief content

`scripts/mcp-briefs.mjs --check` (passed through by the launcher) prints one line per brief in scope (slug, version, last update, conversations, unfolded notes) and exits, instead of serving. Nico runs it once from another directory to prove the start works; the agent does not, because the secrets hook keeps `op` out of its hands on purpose.

### 5. l6-music

A handoff entry asks the l6-music session to add `.mcp.json` (the launcher's path and its own repo name) and to change its third build-status rule: read the brief with `get_brief` and name the version and dates from its header; ask Nico only when the tools are missing (a cloud session, or a missed Touch ID). Posted once the change is merged and Nico's check has passed.

## Checks

- Unit tests for every new part of the markdown and for the launcher's key handling (which source it uses, what it rejects), written first.
- From the laptop: Nico runs the launcher with `--check` from another directory, scoped to l6-music, and confirms it lists the brief with its version and note count.
- What tests cannot show: whether Code's reports improve. First check: the next l6-music status report.

## Docs

CLAUDE.md gains a runbook line on the reader; `docs/changelog.md` gets its entry; the programme spec's project 3 is amended to point here and to describe the mirror as the return-leg project.

## Left to the builder

Exact markdown wording, test names, and how the launcher is split so its key handling can be tested without 1Password.
