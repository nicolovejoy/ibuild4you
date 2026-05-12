# Maker re-engagement: nag flow, opt-out, feedback, share modal

Status: proposal / discussion draft
Audience: Ryan (builder, idea originator), Nico
Last updated: 2026-05-11

This is a starting point for the conversation. Decisions are explicitly
deferred — the goal here is to make the shape of the problem and the design
choices clear enough to argue about productively.

---

## The problem

Today, maker re-engagement is fully builder-mediated:

- The agent generates invite / nudge / reminder text.
- The builder copy-pastes that text into their own SMS or email client.
- The maker either responds (in our chat) or goes silent.

That gives us **one signal** from makers: "did they send a message in the
last N days." That signal conflates at least three different states:

- busy this week, will be back
- losing interest, drifting away
- explicitly done with the project but hasn't said so

We have no way to tell these apart, and no way for a maker to *tell* us
they're paused without typing it into the chat (which most won't do —
silence is easier than honesty).

Result: builders nag with no information about why the silence exists, and
we lose makers who would have come back if we'd given them an honest
"snooze" affordance.

---

## What exists today (briefly)

- **Resend** is integrated for admin-only emails: cron digest to
  `NOTIFICATION_EMAILS` when a maker has new unread messages, and admin
  notification on landing-page interest form submission.
- **No maker-facing email is sent by iBuild4you.** Every maker message
  today is builder-copy-paste.
- **Idle signals** on the project doc: `last_maker_message_at`,
  `last_builder_activity_at`, `last_nudged_at` (really "last copied"),
  `shared_at`, `notify_after`/`notify_pending_since`/`notify_last_sent_at`,
  `latest_session_created_at`.
- **Outbound copy generators** for invite / nudge / reminder, recently
  upgraded with a `voice_sample` style anchor and a `nudge_message`
  verbatim override.
- **Cron** runs every 5 min: sends admin digests + auto-regenerates idle
  briefs. Does not email makers.
- **No project status beyond `active | paused | completed`**, and nothing
  writes `paused` today.

---

## Proposal

### 1. Snooze flow — maker-clickable links in every outbound email

Every iBuild4you → maker email ends with five one-click links:

- Thanks — remind me in **3 days**
- Thanks — remind me in **7 days**
- Thanks — remind me in **14 days**
- Thanks — remind me in **30 days**
- **No more reminders for this project, thanks**

Each link is a signed JWT (or HMAC token) hitting
`/api/email-action?token=<token>`. No login required — the token *is* the
auth, scoped to the project and action.

**Snooze (1-4):**

- Sets `project.snoozed_until = now + N days`
- Lands on a small page: "Got it — I'll check back on May 25." with a
  one-click "Actually, sooner" that opens the project.

**Opt-out (5):**

- Sets `project.status = 'paused'`, `project.pause_reason = 'user_opted_out'`
- Lands on a feedback page (see § 3)
- **The unsubscribe is committed by the click, not by the form.** If they
  bounce without filling it, they stay unsubscribed.

### 2. Snooze values: discussion

Proposed: `3, 7, 14, 30`.

Trade-offs we should talk through:

- **Why not 1 day?** If we just sent the nudge today, a 1-day snooze
  effectively means "re-nag tomorrow." That trains the maker to hit
  "no more reminders" the second time. Cutting 1 day is the safer default
  but loses the "I'll have time tomorrow" honest case.
- **Why include 30?** Without a long option, makers who genuinely want a
  long pause will pick "no more reminders" instead. That over-counts
  opt-outs and loses people we could have kept. Matt is the canonical
  example: he probably wants 30+ days right now, not "lost forever."
- **Alternative if 4 buttons isn't enough**: surface "remind in 60 / 90
  days" on the snooze landing page after they click 30 — progressive
  disclosure for the long tail without cluttering every email.

Open question for Ryan: do the values feel right? Are there builder-side
constraints I'm missing? (e.g., does Ryan care if a maker is silent for
30+ days from a billing or workflow perspective?)

### 3. Feedback collection at opt-out

This is the biggest product-research opportunity in the entire system —
the only moment we have explicit permission to ask "why didn't this
work for you?" from someone with a real opinion.

**Design principles:**

1. **One sentence, conversational tone.** "Got it — I'll stop bugging
   you. Mind telling me why?" Not a survey. Not a form. A question.
2. **Make it skippable without guilt.** The unsubscribe already happened.
   No "are you sure?" or "to complete the unsubscribe…"
3. **Quick-tap chips + optional free-text.** No required fields, no
   star ratings, no NPS.

**Proposed chips** (subject to discussion):

- Lost interest in the idea
- Not the right time
- Building it / using something else
- Just didn't click
- Other → reveals free-text

Plus one optional "anything else?" free-text field. Single **Done** button.

**Data stored:** `project.feedback_at_pause = { reason_chip, free_text,
submitted_at }`. Persists even if the project later reactivates.

Open question for Ryan: are there specific things you'd want to know from
people who opt out? The chips should reflect real builder decisions —
"what would change your roadmap if you saw 60% of opt-outs picking X?"

### 4. Schema additions

New fields on `projects`:

```
snoozed_until: string | null     // ISO; cron skips this project until then
pause_reason: 'user_opted_out'   // why we're paused
             | 'user_paused'     // (future: explicit pause from app UI)
             | 'auto_idle'       // (future: never-responded auto-pause)
             | null
feedback_at_pause: {
  reason_chip?: string
  free_text?: string
  submitted_at: string  // ISO
} | null
last_email_sent_at: string | null      // (today we track "copied"; once we send,
                                        //  this becomes meaningful)
last_email_action_at: string | null    // when the maker last clicked a link
last_email_action: 'snooze_3' | 'snooze_7' | 'snooze_14' | 'snooze_30'
                 | 'opt_out' | null
```

Decision needed: do we keep `status` strictly `active | paused | completed`
and use `snoozed_until` as a soft pause signal? Or add `snoozed` as a
distinct status? My instinct: keep status simple, use `snoozed_until` as
the gate. A snooze is "active, but quiet for now."

### 5. Cron behavior changes

`/api/cron/notify` adds a third pass:

- For each `active` project where `snoozed_until` is null or past,
  evaluate maker silence:
  - **N days since last maker message** AND no recent builder activity:
    send a re-engagement email (uses existing nudge generator + voice
    anchor) with the 5 action links appended.
- For each project where `snoozed_until <= now`, clear the snooze. The
  next eligible pass will then email them as normal.
- Skip projects with `status !== 'active'`.

Open question for Ryan: what's the right base cadence? My instinct is
something gentle — maybe 7-day intervals once a maker has gone silent,
escalating to 14 after the second snooze, then stopping. We should
*never* send more than ~6 emails before forcing a hard stop.

### 6. Builder dashboard surface

Turn-indicator and project list need to show new states:

- "Snoozed until May 25" (instead of ambiguous "Waiting on Matt")
- "Matt opted out: lost interest" (with timestamp + reason chip)
- "Replied to nudge May 10" (positive signal)

Builders should be able to manually un-snooze ("I had a conversation
offline, they're ready"), with confirmation that this re-enables emails.

### 7. Share modal rework — coupled but separable

The current "Share with maker" modal is stale once a project has been
shared. It mixes two distinct jobs:

- **Initial share**: collect email, send invite, hand off login details.
- **Ongoing maker management**: see engagement, send re-engagement
  messages, manage the relationship.

Today it's the same UI for both. Problems:

- Invite message is AI-generated at share-time and never refreshed —
  weeks-old "excited to dig in..." copy is still showing on the modal.
- Passcode is front-and-center every time; useful on day 1, noise after.
- No engagement state visible (last login, last message, last reminder).
- No action affordances: the only button is "Copy message."
- The "Project link" textbox duplicates the link already in the message.

**Proposed split:**

- **Pre-share**: focused modal — name, email, "Send invite via email"
  (Resend) + "Copy text" fallback. Small. Same as today, basically.
- **Post-share**: promote to a "Maker" tab/section in the project page,
  alongside Setup / Brief / Sessions / Files. Sub-sections:
  - **Status** — shared date, last login, last message, current state
    (active / snoozed-until-X / opted-out + reason), session count.
  - **Re-engage** — AI-drafted current nudge (refreshed on open), with
    "Send via email" / "Copy text" / "Regenerate."
  - **Login** — collapsed by default; link + passcode (revealable) +
    "Reset & email new passcode."
  - **Lifecycle** — pause / reactivate / mark-completed; maker's own
    pause reason if they opted out.

**Trigger logic:** the "Share with maker" button stays visible until first
maker login. After that, replace it with a "Maker" tab on the project page.

This is a meaningful UI rework — probably should happen *after* the nag
flow ships, because the new tab needs the new status/snooze data to be
worth its existence. Pre-nag-flow, it would just be the existing modal
spread across more pixels.

---

## Sequencing

Suggested order if we ship this:

1. **Schema + signed-token route** (`snoozed_until`, `pause_reason`,
   `last_email_action*`, `/api/email-action`). No UI changes yet.
2. **Send maker-facing email from cron** — use existing nudge generator,
   append action links, send via Resend. Cadence behind a feature flag /
   manual opt-in per project at first.
3. **Action endpoint landing pages** — snooze confirmation, opt-out
   feedback collection.
4. **Builder dashboard surfaces** snoozed/opted-out state.
5. **Share modal rework** — only after (1-4) so the new tab has real data.

(1) and (2) deliver value with no UI rework; (3) makes the data
collection real; (4-5) close the loop.

---

## Things we explicitly deferred

- **Inbound email parsing** (Resend can do this — webhook to a route that
  parses replies). Heavier than action links and harder to classify
  reliably. Skip for v1. Action links cover the high-value cases.
- **SMS** — even though Resend doesn't do SMS, the builder-copy-paste
  workflow still works for SMS. Don't try to automate that path now.
- **Per-builder vs per-project nag preferences.** Today this is
  per-project, which is right for the current scale.
- **Rate limiting / abuse on signed-token links.** Tokens should be
  single-use or short-TTL; concrete spec deferred to implementation.

---

## Open questions to discuss with Ryan

1. **Snooze values**: `3/7/14/30`? Or include 1 day? Or push to 60/90?
2. **Feedback chips**: what would actually help your roadmap if you saw
   the histogram?
3. **Base cadence after opt-in to nag**: 7 / 14 / final? Or different?
4. **Auto-pause on extended silence** — if a maker never clicks anything
   and we've sent 4 emails over 8 weeks, should we auto-pause them with
   reason `auto_idle`? Or keep nagging at low cadence indefinitely?
5. **Share modal split** — agree that this should wait for (1-4) to
   ship first? Or interleave?
6. **Re-engagement email "from" identity** — currently `noreply@`.
   Should re-engagement come from the builder's name? Affects deliver-
   ability and trust.
