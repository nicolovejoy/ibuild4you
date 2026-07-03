# #72 — Agent perceives the prototype (Loop context capture)

> **STATUS: NEEDS A DEEP THINK — do not start coding.** This doc frames the
> problem and pins down current state so the next session (run on a top model)
> can design the approach first. The "Open design questions" are the point of
> the session; the "Proposed shape" below is a starting sketch, not a decision.

## The need (from #72)

Makers ask the intake agent (Sam) to "walk me through the site." Sam has **no
view of the running prototype**, so it confabulates. #69 already shipped the
near-term honesty fix (Sam admits it can't see the app + accepts a pasted
screenshot). This issue is the **durable capability**: let the agent actually
*perceive* the deployed host app.

## Direction already chosen (don't relitigate)

**Extend Loop; do NOT build agent-driven headless browsing.** Headless browsing
would force us to store maker credentials, run a browser runtime, and re-solve
"authenticated presence inside the host app." Loop already runs *as the
logged-in maker in their own session*, so it sidesteps all of that. This
constraint is settled — the deep think is about *how* to extend Loop, not
whether to.

## Current state (verified this session — build on it, don't rebuild)

The Loop → agent **text** channel already exists ("slice A", shipped):

- **Wire contract:** `lib/feedback/README.md` + `lib/feedback/payload.ts`. Loop
  `POST`s to `/api/feedback`; today it captures `pageUrl`, `userAgent`,
  `viewport` alongside the human's `type`/`body`. The contract is **additive-safe**
  (new optional fields don't break existing embeds). Overview: `docs/loop.md`.
- **Feedback rows** are keyed by `projects.slug` (`Feedback.project_id === slug`),
  with a `(project_id ASC, created_at DESC)` composite index already in
  `firestore.indexes.json`.
- **Agent already reads it:** `lib/api/prototype-feedback.ts` `fetchPrototypeFeedback()`
  pulls the recent N feedback rows for a slug and runs them through the pure
  `summarizePrototypeFeedback()` (`lib/agent/prototype-feedback.ts`); both
  `/api/chat` and `/api/chat/kickoff` inject the result into the system prompt.

So the plumbing for "host-app signal → brief → agent prompt" is **live for text**.
#72's remaining work is richer *perception* (visual/structural), and routing it
to the agent as something it can actually reason over.

## Open design questions (the deep think)

1. **What to capture, and how.** Screenshot (via `getDisplayMedia` /
   `html2canvas` / `<canvas>`)? A DOM outline / accessibility tree? Current
   route only? Each has very different fidelity, payload size, privacy surface,
   and browser-permission friction. `getDisplayMedia` prompts the user every
   time; `html2canvas` is silent but imperfect. Which combination is worth it?
2. **How the agent consumes it.** Is this a vision path (send the screenshot as
   an image block to Sonnet — the app already uses the Anthropic SDK directly,
   and image input is supported) or a text-shaped description the model reads?
   Vision changes cost + latency + the message-construction path in
   `/api/chat`. Decide the consumption model before the capture model.
3. **Where the richer context lives.** Extend the `feedback` doc with optional
   capture fields, or a **new `prototype_context` collection** (host→agent is a
   different consumer than human→builder feedback — mixing them into one
   collection may muddy the admin inbox)? What's the retention/size story for
   image bytes (S3 like uploads, à la `lib/s3/`)?
4. **Trigger + UX.** Does the maker explicitly "share what I'm looking at," or
   does Loop passively attach context to every submission? Explicit is lower
   privacy-risk and higher signal; passive is lower friction. Consent model for
   DOM/screenshot capture.
5. **Adoption forcing-function.** This only pays off if a host app actually
   embeds Loop. **offer-builder / byside** is the active candidate (real users,
   real closing-journey brief). Piloting there doubles as the push to finally
   move into Loop. Is byside the pilot, and does that shape scope?
6. **Privacy / scope.** DOM + screenshots can capture PII from the host app.
   What's redacted, what's stored, for how long, and who can see it (admin
   inbox vs agent-only context)?

## Proposed shape (STARTING SKETCH — expect the deep think to revise)

- Additive Loop fields: optional `capture: { screenshotKey?, route?, domOutline? }`.
- Screenshot bytes → S3 (reuse `lib/s3/`), metadata → Firestore; text/route →
  the doc directly.
- A `fetchPrototypeContext()` sibling to `fetchPrototypeFeedback()` that the
  chat/kickoff routes call; if it's a vision path, thread an image block into
  the message array rather than the system prompt text.
- Pilot on byside; gate behind an explicit "show Sam what I'm seeing" action.

## Ties to

This host→brief context channel is the embryo of the **build↔brief drift
bridge** (the "later" half of the brief-reconciliation issue). Whatever data
path we pick here should not foreclose that.

## Pointers for next session

- `lib/feedback/README.md`, `lib/feedback/payload.ts`, `components/FeedbackWidget.tsx`
- `docs/loop.md`
- `lib/api/prototype-feedback.ts`, `lib/agent/prototype-feedback.ts`
- `app/api/chat/route.ts` + `app/api/chat/kickoff/route.ts` (where feedback is injected)
- `lib/s3/` (byte storage pattern), `firestore.indexes.json`
- offer-builder repo (`nicolovejoy/offer-builder`) as the pilot host app
