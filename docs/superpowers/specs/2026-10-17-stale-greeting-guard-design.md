# Stale-greeting guard (#214) — design

Status: approved by Nico in principle 2026-10-17 ("just go"); design calls below are Claude's, marked **(call)**.

## Intent

From the Tideline run: a maker opened the brief before the builder had imported the next-convo payload, and the agent greeted them with a generic "Welcome back, what do you want to focus on?". That greeting pretends a next conversation is ready when nothing is. Three fixes, from the issue:

1. In that state the agent says the builder has not queued anything yet and offers to take notes.
2. The builder is notified.
3. A payload imported after that point still applies to the open session if the maker has not yet replied.

## What "nothing queued" means **(call)**

A payload is **queued** for the current round when the builder pasted it after the maker last spoke:

```
queued = payload_pasted_at != null && payload_pasted_at > (last_maker_message_at ?? '')
```

`payload_pasted_at` is the stamp the ferry desk writes on import (PR #222). `last_maker_message_at` is set by `/api/chat` on every maker turn. On a brief with no maker history at all the question does not arise (first session, welcome posts verbatim); the guard only applies when kickoff would otherwise greet (`no_maker_history` already declines).

The server computes this in one helper, `lib/sessions/queued.ts` `isPayloadQueued(project)`, used by the kickoff route, the chat route and the import PATCH. The client does not decide.

**Post-review ruling (2026-10-17).** `!isPayloadQueued` alone is not enough for the kickoff: `last_maker_message_at` moves on every maker turn, so it holds for the rest of every round, and a maker back from lunch mid-intake would get the canned note. The canned greeting fires only on a return **between rounds**:

```
unqueuedReturn = !queued && (sessionHasNoMakerMessage || roundHarvested)
roundHarvested = prep_copied_at != null && prep_copied_at > (last_maker_message_at ?? '')
```

`sessionHasNoMakerMessage`: the active session holds no `role: 'user'` message (an empty return session). `roundHarvested`: the builder copied the next-convo prep after the maker last spoke. Both live in `lib/sessions/queued.ts` as `isUnqueuedReturn({ project, sessionHasMakerMessage })`, which the kickoff route calls. A first session always holds the maker's own messages once they have spoken (before that, `no_maker_history` declines), so it never gets the note. The chat route's "Nothing queued" block is unchanged: it needs the greeting in history, which only exists if this rule fired.

## Behaviour

### 1. Kickoff with nothing queued

In `/api/chat/kickoff`, after the existing guards pass, if `isUnqueuedReturn(...)` (see the ruling above):

- Do **not** call the model. Post a canned agent message instead and stream it back in the same SSE shape the client already consumes (one text chunk, then `[DONE]`), so the maker view needs no new code path. **(call)** Canned, not model-written: the content is a statement of fact about the builder, not conversation, and it must not drift.
- Copy, in the brief's language, from `lib/copy.ts` (EN) and `lib/copy-maker.ts` (FR), `chat.nothingQueuedGreeting(builderFirstName)`:
  - EN: "Hi — {builder} hasn't queued our next conversation yet, so I don't have anything new to go through with you. If something's on your mind in the meantime, tell me and I'll keep notes for {builder}."
  - FR: the French twin, same register as the other maker copy.
  - `builderFirstName` is the project owner's `first_name` from `users` (looked up via the `owner` membership), falling back to "your builder" / "votre builder" **(call)**.
- The stored message carries `kind: 'unqueued_greeting'` (new optional `Message.kind`; nothing else sets it). It is how the import step finds and removes the stale greeting later.
- Stamp `sessions.last_kickoff_at` as today (so the decline path `already_kicked_off` keeps working).
- Stamp `projects.maker_waiting_since = now` (new field, ISO string) unless already set.
- Notify the builder (below). The kickoff response to the client is unchanged.

### Chat while nothing is queued

If the maker replies in that state, `/api/chat` adds a volatile system block **(call)**:

```
## Nothing queued
The builder has not prepared this conversation yet. Do not run discovery or push toward decisions. Listen, take notes, reflect back what the maker says, and tell them the builder will pick it up. Keep it short.
```

Only when `!isPayloadQueued(project)` **and** the active session contains an `unqueued_greeting` message. Normal chat elsewhere is untouched.

### 2. Builder notification

Two channels, both from the kickoff route, both best-effort (never fail the greeting):

- **Email, immediately.** Resend to `NOTIFICATION_EMAILS`, same pattern as `/api/feedback`. Subject: `{maker} opened "{title}" — nothing queued`. Body: one line saying what happened, the time (Pacific), and the dashboard link to the brief. Sent at most once per session (`sessions.unqueued_notified_at`). Honours `FEEDBACK_NOTIFY_SUPPRESS === 'on'` so preview e2e never emails **(call)**; the flag's CLAUDE.md entry gets one sentence saying it now covers this email too.
- **Dashboard.** `getTurnIndicator` gains a state ahead of `your_turn`: when `maker_waiting_since` is set, the builder sees "Maker waiting — nothing queued" (EN; FR twin for the maker copy table is not needed, the dashboard is builder-side). `maker_waiting_since` is cleared by the import PATCH (step 3) and by `/api/chat` on a maker turn (the normal "your turn" takes over).

### 3. A later import applies to the open session

In `PATCH /api/projects`, when the body carries `payload_pasted_at` (i.e. this PATCH is the ferry-desk import), after the project update:

1. Load the active session. If none, stop.
2. If the session has **any maker message after its last `unqueued_greeting`**, stop: the maker has replied, the normal Start flow handles it (the builder's modal already auto-opens after import).
3. Otherwise, in one batch:
   - delete the `unqueued_greeting` message(s) in that session;
   - re-snapshot `session_mode`, `seed_questions`, `builder_directives`, `welcome_message`, `identity` from the freshly updated project onto the session (the same five fields `POST /api/sessions` snapshots);
   - clear `sessions.last_kickoff_at` and `unqueued_notified_at` so a fresh kickoff can greet with the queued config;
   - post the new `welcome_message` as the opener if `welcomeToPost` says it is new for this round (`lib/sessions/welcome.ts`, same rule as session creation); otherwise leave the session with no opener and let kickoff greet on the maker's next visit;
   - clear `projects.maker_waiting_since`.
4. The maker's open tab sees the change live through `useRealtimeMessages` (stale greeting disappears, welcome appears).

The builder's Start modal still auto-opens after import. Clicking Start creates a new session as today; the open session has by then already been cleaned, so either path leaves no stale greeting behind.

## Non-goals

- No change to `shouldKickoff` on the client; the server decides.
- No per-project builder email; `NOTIFICATION_EMAILS` is the recipient, as everywhere else.
- No retroactive cleanup of greetings already stored on prod.
- Not addressing whether a maker's open tab switches sessions when the builder clicks Start (separate, pre-existing).

## Anti-goals

- Never post the canned greeting on a brief's first session or when `no_maker_history` would decline: the welcome message owns that moment.
- Never let a notification failure fail the greeting or the import.
- Never move `last_maker_message_at` or `notify_*` from the kickoff path (kickoff stays silent on the builder-turn state; `maker_waiting_since` is the only project write).

## Data

- `Message.kind?: 'unqueued_greeting'` (optional; absent on every other message).
- `Session.last_kickoff_at?: string` (declare the field the route already writes), `Session.unqueued_notified_at?: string`.
- `Project.maker_waiting_since?: string | null` (ISO). Not on the PATCH allowlist; server-written only.
- No Firestore index changes (lookups are by session id and `created_at` order, already indexed).

## Tests (TDD)

- `lib/sessions/__tests__/queued.test.ts`: `isPayloadQueued` truth table (no paste, paste before last maker message, paste after, no maker history).
- `app/api/chat/kickoff/__tests__/kickoff.test.ts`: unqueued → canned message stored with `kind`, no Anthropic call, `maker_waiting_since` set, email sent once (second kickoff on the same session does not resend), suppressed under `FEEDBACK_NOTIFY_SUPPRESS=on`; queued → unchanged behaviour.
- `app/api/chat/__tests__/chat.test.ts`: "Nothing queued" block present only in the unqueued-with-greeting case; maker turn clears `maker_waiting_since`.
- `app/api/projects/__tests__/update-delete-project.test.ts`: import PATCH removes the greeting, re-snapshots, posts/omits the welcome per `welcomeToPost`, clears stamps; does nothing when the maker has replied; `maker_waiting_since` rejected from the client allowlist.
- `lib/__tests__/turn-indicator.test.ts`: new state ordering.
- `lib/__tests__/copy.test.ts`: EN/FR twins present.
- Preview e2e `scripts/e2e-214-stale-greeting.mjs`: needs a maker identity (test cast); if `.test-cast-passwords.json` is absent on this machine, the script exits 0 with "SKIPPED" and says why, and the PR says the maker-side leg was not driven.

## Left to the builder

File names and helper placement beyond those named here; the exact French copy (follow `prompt-lab/workflow/localization/fr-glossary.md`); the email HTML (reuse `textToEmailHtml`).
