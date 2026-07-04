# #72 Design — Richer Prototype Perception via Loop

> **STATUS: DECIDED 2026-07-04** (deep-think session, approved).
> Implementation follows the slices in §4. Grounded in the current code at:
`lib/feedback/payload.ts`, `components/FeedbackWidget.tsx`, `app/api/feedback/route.ts`,
`lib/api/prototype-feedback.ts`, `lib/agent/prototype-feedback.ts`,
`app/api/chat/route.ts`, `app/api/chat/kickoff/route.ts`, `lib/s3/client.ts`,
`lib/agent/attachments.ts`, `firestore.indexes.json`, `scripts/e2e-72-feedback-chat.mjs`.

**One-paragraph summary of the position.** Sam is an intake conversationalist, not a
pixel-QA agent. What it needs to stop confabulating a walkthrough is *orientation* —
what page the maker was on, what that page is made of, what it's called — not pixels.
So v1 captures a **structured, text-shaped page outline** (route + title + headings +
landmark/interactive-element labels, never form values), riding along with Loop
submissions as an additive optional `capture` field, stored in a **new
`prototype_context` collection** (agent-facing, separate from the admin feedback
inbox), and rendered into the **system prompt** as a sibling of the existing
`renderPrototypeFeedbackBlock`. Screenshots stay maker-driven: the already-shipped
chat image-attachment path (#69) covers "look at this," and an explicit
`getDisplayMedia` capture button is a *post-pilot* option, costed below but
deliberately not in v1. byside/offer-builder is the pilot and shapes the scope
(copy-in widget, framework-agnostic DOM walk, PII-hostile redaction posture).

---

## 1. Positions on the six open questions

### Q1 — What to capture, and how

**Recommendation: a structured DOM/accessibility outline as text, built by a small
pure function that ships with the widget. No screenshots in the widget for v1.**

The capture is a walk of the live DOM producing a capped (~4 KB) text/JSON outline:

- `route` — `location.pathname` only (host + query stripped client-side; matches the
  server-side posture of `pathFromUrl()` in `lib/agent/prototype-feedback.ts`)
- `title` — `document.title`
- `outline` — headings hierarchy (`h1–h3` text, truncated per-item), landmark roles
  (`nav`/`main`/`aside`/`footer` with accessible names), nav link labels, button
  labels, form **field labels only** (never values; `type=password`/`hidden` skipped
  entirely), counts for repeated structures ("table: 12 rows", "list: 8 items")
- `viewport` (already on the wire), `capture_version: 1`

Explicitly **not** captured: text-node content outside headings/labels, input/textarea
values, query strings, cookies/storage, iframes, anything under a host-app
`data-loop-redact` attribute (escape hatch for the pilot).

**Rejected: `html2canvas` (or dom-to-image) screenshots.**
- *Fidelity failure modes are real and hit exactly our stack.* html2canvas re-implements
  CSS rendering rather than using the browser's; it breaks on modern CSS color
  functions (the Tailwind v4 `oklch()` breakage is notorious — this repo and its host
  apps are on Tailwind 4), webfonts, shadows, `object-fit`, and renders cross-origin
  images as blanks or taints the canvas so `toDataURL()` throws. A "silent" capture
  that lies about what the maker saw is worse for an agent than no capture.
- *It breaks the Loop distribution model.* Loop is two copied files with zero deps
  (`docs/loop.md`); html2canvas is a ~200 KB dependency every host app must adopt.
- *Cost/privacy:* image bytes need S3 + retention machinery on day one, and a
  screenshot captures everything on screen — including PII we then have to store.

**Rejected: `getDisplayMedia` as the default capture.**
- Browser permission prompt on *every* capture (no persistent grant for display
  capture), with a picker where the maker can select the wrong tab or their entire
  screen — an over-capture privacy hazard (email, Slack, other tabs).
- Requires a user gesture + HTTPS and has Safari quirks. As an *always-on* or
  per-submission mechanism it's a friction wall.
- It is, however, the *right* screenshot mechanism if a pilot proves screenshots are
  needed, because it's pixel-perfect and the permission prompt doubles as the consent
  moment. Kept as the Phase-5 option (see §4), explicitly maker-initiated.

**Why text wins for this consumer.** The agent's job is conversation grounding:
"you were on `/checkout`, which has a 3-step form (Contact, Payment, Review) and a
'Place order' button." An outline answers that with ~500–1,000 tokens, is previewable
by the maker before send (a screenshot is not meaningfully redactable), degrades
never (DOM walking always works), and is diff-able later (see §6). Pixels only beat
text for visual-design critique — which is not Sam's job (`DEFAULT_IDENTITY`:
"You're the intake step, not the developer").

**Hybrid stance (the practical judgment note, adopted):** cheap structural text always
(consent-gated, §Q4); screenshots only on explicit maker action — and for v1 that
explicit action *already exists*: pasting/attaching a screenshot in chat flows through
`loadAttachmentBlocks()` as an image block today. We don't rebuild that inside Loop
until the pilot shows makers won't leave the host app to do it.

### Q2 — How the agent consumes it

**Recommendation: text-shaped consumption in the system prompt, exactly parallel to
slice A.** A new pure module `lib/agent/prototype-context.ts` mirrors
`lib/agent/prototype-feedback.ts`:

- `summarizePrototypeContext(rows, nowMs, limit)` — newest-first, cap 3 captures,
  drop >14-day-old rows, truncate outlines
- `renderPrototypeContextBlock(items)` — a `## What the maker's screen looked like
  (structure)` block that (a) presents route/title/outline per capture with age
  labels, (b) repeats the honesty guardrail: "these are structural snapshots, not a
  live view — don't invent visual details (colors, imagery, layout) beyond them."

`lib/api/prototype-context.ts` adds `fetchPrototypeContext(db, slug, nowMs, limit)`
(sibling of `fetchPrototypeFeedback`), called from both `/api/chat` and
`/api/chat/kickoff` next to the existing `fetchPrototypeFeedback` call, feeding a new
optional `prototypeContext` param on `buildSystemPrompt` (`lib/agent/system-prompt.ts`
already takes `prototypeFeedback?: PrototypeFeedbackItem[]` — same pattern, additive).

**Interaction with SSE streaming + prompt caching (current mechanics, verified):**
- The chat route places exactly **one** `cache_control: ephemeral` marker, on the last
  block of the most recent attachment-bearing user message (`app/api/chat/route.ts`
  lines ~254–262). That marker caches the whole prefix: system prompt + history.
  A system-prompt byte change therefore invalidates that cache for one turn — but
  this is *already true* of slice A (a new feedback row changes the prompt) and of
  `gapSinceLastMakerMessageMs`. A new capture arrives at human cadence (per Loop
  submission), so the added invalidation is one cache re-write per capture, identical
  in profile to today's feedback behavior. No change to the caching strategy needed.
- SSE is output-side; a text block adds zero streaming complexity and ~500–1,000
  input tokens of prefill (single-digit ms class at this size).

**Rejected: vision-in-the-loop for v1 (image content block per turn).**
- The system prompt cannot carry images; an image must be threaded into `messages`,
  which touches the trickiest code in the route: the user-first rule, multi-human
  speaker prefixing, the attachment/cache-marker placement, and the dropped-attachment
  annotation pass. That is real regression surface for a capability text already
  covers.
- Cost/latency is strictly worse (§3) and a Loop-captured screenshot re-sent on every
  turn is the expensive kind of context.
- When a maker *does* share a screenshot via chat, the existing image-block path
  already gives Sam vision — so "vision when the human decides it matters" is live
  today at zero new code.

**Rejected: injecting context as a synthetic user message.** Pollutes stored history
semantics (messages collection is the durable transcript; kickoff deliberately avoids
storing synthetic turns) and would either get persisted or need a parallel
non-persisted assembly path. System prompt is the established channel for ambient
project state (brief, mockups, feedback).

### Q3 — Where the richer context lives (data path / collections)

**Recommendation: additive `capture` field on the existing wire contract; a new
`prototype_context` Firestore collection for storage; S3 only if/when screenshot bytes
exist (Phase 5).**

Wire (additive-safe per `lib/feedback/README.md` — new optional field, no renames):

```jsonc
// POST /api/feedback — everything existing unchanged; new OPTIONAL field:
"capture": {
  "v": 1,
  "route": "/checkout",          // path only, ≤300 chars
  "title": "Checkout — Byside",  // ≤200 chars
  "outline": "...",              // ≤4000 chars, server-sliced
}
```

Server behavior in `app/api/feedback/route.ts` (after existing validation/slug gate):
1. Write the `feedback/{id}` row **exactly as today** (no new fields on it beyond an
   optional `has_capture: true` convenience flag — keeps admin inbox queries cheap).
2. If `capture` present and shape-valid: write `prototype_context/{id}`:

```
project_id: <slug>            // same keying convention as feedback
feedback_id: <feedback doc id | null>   // null for capture-only posts (Phase 3)
source: 'loop-widget'
capture_version: 1
route, title, outline, viewport, user_agent
submitter_uid: <uid | null>
status: 'active'              // 'expired' after retention window — no hard deletes
created_at / updated_at (ISO strings, matching house style)
```

3. New composite index in `firestore.indexes.json`:
   `prototype_context (project_id ASC, created_at DESC)` — clone of the feedback index.

Capture-only submissions ("Show Sam this page", Phase 3) go to a **new sibling
endpoint `POST /api/prototype-context`** with the same anti-abuse stack (honeypot,
`_ts` window, per-IP rate limit, slug gate — factored into a shared helper) rather
than loosening `/api/feedback`'s `body`-required rule or adding a fake feedback type.

**Rejected: extending the `feedback` doc with capture fields.**
- Different consumer, different lifecycle: feedback rows drive the admin inbox,
  Resend notifications, status triage, and convert-to-GitHub. Captures are agent
  fodder with a short shelf life. Mixing them means either the inbox fills with
  body-less "context" rows or every consumer filters them forever.
- Retention diverges: feedback is kept indefinitely; captures expire in weeks.
- The framing doc's own worry ("may muddy the admin inbox") is correct.

**Rejected: S3 for the outline text.** It's ≤4 KB of text; Firestore doc limit is
1 MB. S3 (`ibuild4you-files`, `prototype-context/{slug}/{id}.png`, pattern per
`lib/s3/client.ts` + `lib/agent/attachments.ts`) is reserved for Phase-5 screenshot
bytes, with metadata staying in the `prototype_context` doc (`screenshot_key`).

### Q4 — Trigger + UX / consent

**Recommendation: explicit and previewable, in two tiers.**

- **Tier 1 (Phase 1): capture rides with a feedback submission.** The widget grows a
  checkbox: *"Include a snapshot of this page's structure"* with a "what's included"
  disclosure that renders the actual outline text about to be sent (text capture's
  killer feature: the consent artifact IS the payload — the maker can read exactly
  what leaves the page). Default **on**, because (a) the maker is already mid-explicit
  action (submitting a report about this very page), (b) the payload contains no
  typed text or values by construction, and (c) `pageUrl`/`viewport`/`userAgent`
  already ship silently today — the outline is a modest widening of an established
  disclosure, now made *more* visible, not less.
- **Tier 2 (Phase 3): a dedicated "Show Sam this page" button** in the widget —
  capture-only, inherently consensual, same preview affordance, posts to
  `/api/prototype-context`.
- **Passive attach-on-every-pageview: rejected.** Highest privacy surface, lowest
  signal density (mostly duplicate outlines), floods retention, and gives the agent
  stale ambient noise instead of "the page the maker cared enough to report from."
- If Phase 5 screenshots ship: the `getDisplayMedia` browser prompt is the consent
  moment, preceded by our own one-line explanation, and the captured frame is shown
  to the maker with a confirm/cancel before upload. Never silent.

### Q5 — Adoption forcing-function: byside pilot

**Recommendation: yes, byside/offer-builder is the pilot, and it shapes scope:**

- **Copy-in constraint holds.** The capture builder is a third small file
  (`lib/feedback/capture.ts`) that travels with `FeedbackWidget.tsx` + `payload.ts`.
  Zero npm deps, plain DOM APIs — works in any React/Next host without framework
  coupling. (This constraint alone kills html2canvas.)
- **PII posture is set by the pilot.** byside's closing-journey pages carry real
  transaction/client data — the structure-only, no-text-values, `data-loop-redact`
  design is chosen *because* the first real host is PII-dense. If the design is safe
  for byside it's safe for the bakery et al.
- **Pilot definition of done:** Loop embedded in offer-builder's root layout
  (`NEXT_PUBLIC_FEEDBACK_PROJECT_ID` → its `projects.slug`), ≥1 real maker submission
  with capture, and a session where Sam's "walk me through" answer cites the actual
  route + structure (verified by extending `scripts/e2e-72-feedback-chat.mjs`'s
  pattern against the real slug, and by eyeball on the real conversation).
- **Scope discipline it imposes:** ship Tier 1 only before embedding; the "Show Sam"
  button and any screenshot work are *reactions to pilot findings*, not prerequisites.
  The GitHub PAT + `github_repo` setup for offer-builder (per `docs/loop.md` triage
  section) rides along so the feedback half of Loop also becomes real there.

### Q6 — Privacy / retention

**What's captured / redacted** — see Q1 list. Summary contract, documented in the wire
README: *route path, page title, headings, landmark and control labels, counts.
Never: user-typed values, non-heading body text, query strings, password/hidden
fields, anything inside `data-loop-redact`.* `submitter_email` is not copied onto
capture rows (PII stays minimal; the linked feedback row already holds it under
existing rules). All PII stays in Firestore per house rules — nothing in code, docs,
or memory; all access via API routes with the Admin SDK.

**Who sees it:**
- **Agent:** last 3 `status == 'active'` captures ≤14 days old, via system prompt.
- **Admin:** a "snapshot included" chip on the feedback row in `/admin/feedback`, with
  the outline in a collapsible on the detail view (read via a new admin-gated GET).
  Captures are *not* their own inbox — no notification email change beyond an
  optional one-line "structure snapshot attached."
- **Maker:** the pre-send preview in the widget (Q4). No post-hoc maker-facing viewer
  in v1.

**Retention (no hard deletes — house rule):** a small addition to the existing cron
surface (`/api/cron/*` pattern) marks `prototype_context` rows `status: 'expired'`
after 30 days; the agent query already self-limits to 14 days so expiry is
belt-and-suspenders for the admin/read path. Phase-5 screenshot bytes: S3 lifecycle
rule (30-day expiration) on the `prototype-context/` prefix, metadata row retained
with `screenshot_key` nulled by the same cron — **flag for owner sign-off**, since
S3 lifecycle is byte deletion; if the no-hard-deletes rule is read to cover S3, fall
back to Glacier-tiering instead (`deleteS3Object` precedent in `lib/s3/client.ts`
suggests byte deletion is accepted practice for file cleanup, so lifecycle expiry is
consistent — but state it explicitly in the PR).

---

## 2. End-to-end data-flow sketch

```
HOST APP (byside, logged-in maker's browser session)
  FeedbackWidget submit (checkbox on)  |  "Show Sam this page" (Phase 3)
        │ buildPageCapture(document, location)      [lib/feedback/capture.ts — pure]
        │   → { v:1, route:"/checkout", title, outline:"# Checkout\nnav: Home|Offers…", }
        ▼
  POST https://ibuild4you.com/api/feedback          [additive field `capture`]
  POST https://ibuild4you.com/api/prototype-context [Phase 3, capture-only]
        │  CORS-open; honeypot + _ts window + 5/hr/IP rate limit + slug gate (shared)
        ▼
IBUILD4YOU SERVER (Admin SDK only)
  feedback/{id}            ← unchanged row (+ has_capture flag)
  prototype_context/{id}   ← slug-keyed capture row, status:'active'
  (Phase 5 only: S3 ibuild4you-files/prototype-context/{slug}/{id}.png + screenshot_key)
        │
        ▼  next maker turn
  /api/chat  &  /api/chat/kickoff
    fetchPrototypeFeedback(db, slug)      [existing]
    fetchPrototypeContext(db, slug)       [new — limit 3, ≤14d, status active]
        │
        ▼
  buildSystemPrompt({ …, prototypeFeedback, prototypeContext })
    → "## What the maker has reported…"   [existing block]
    → "## What the maker's screen looked like (structure)…"  [new block, text]
        │                                  INJECTION POINT: system prompt TEXT.
        │                                  No image content block in v1. Phase 5
        │                                  screenshots would append ONE image block
        │                                  to the final user turn via the existing
        │                                  AttachmentBlock machinery instead.
        ▼
  anthropic.messages.stream({ model: claude-sonnet-4-6, system, messages })
    - cache marker unchanged (last attachment block of latest attachment turn);
      a new capture invalidates that cache for exactly one turn, same as a new
      feedback row does today
    - SSE loop unchanged (text_delta → data: events → [DONE])
```

## 3. Cost / latency: vision path vs text-only (Sonnet 4.6: $3/M in, $15/M out)

Assumptions: one 1440×900 viewport screenshot; Anthropic image tokens ≈ (w×h)/750
with downscale capping a full-frame web screenshot around ~1,600 tokens. 20-turn
session; context (screenshot or outline) present in prefix every turn.

| | Text outline (recommended) | Screenshot as image block |
|---|---|---|
| Size per capture | ≤4 KB text ≈ 500–1,000 tok | ~200–500 KB PNG ≈ ~1,600 tok |
| Per turn, uncached | ~$0.0015–0.003 | ~$0.0048 |
| Per 20-turn session, uncached | ~$0.03–0.06 | ~$0.10 |
| With cache reads (0.1×) after write turn | ~$0.004–0.008/session | ~$0.012/session + 1.25× write |
| Added latency per turn | negligible (small prefill) | S3 GET + base64 (~50–300 ms server-side) + image prefill before first SSE token |
| Widget-side cost | ~0 (DOM walk, <10 ms) | upload 200–500 KB on maker's connection; capture UX prompt |
| Reliability | always works | html2canvas: broken renders; getDisplayMedia: prompt + wrong-surface risk |

Both are objectively cheap at this app's volume (session cost tracking via
`accumulateSessionUsage` already exists to verify). The decisive factors are not
dollars but reliability, redactability, and code-path risk — all favoring text.
The vision numbers above are the budget for Phase 5 if the pilot demands it: ~2–3×
text cost and one more moving part (S3 bytes + retention), which is affordable, so
Phase 5 is gated on *need*, not cost.

## 4. Phased implementation plan (thin, shippable, e2e-testable slices)

Existing harness: preview deploy at `preview.ibuild4you.com` against the sandboxed
`ibuild4you-preview` Firebase project (`docs/preview-firestore-split.md`), driven by
`scripts/e2e-*.mjs` Playwright scripts with seeded fixtures
(`scripts/e2e-72-feedback-chat.mjs`, `scripts/seed-72-feedback.mjs` pattern,
`with-preview-env.mjs` wrapper).

- **Slice B1 — wire + storage (no agent change).**
  `lib/feedback/capture.ts` (pure `buildPageCapture`), optional `capture` in
  `FeedbackPayload` + `buildFeedbackPayload`, widget checkbox + preview disclosure,
  server persist to `prototype_context`, new index, README contract update per the
  "Adding a new field" checklist, unit tests (`payload.test.ts`, new `capture.test.ts`
  under happy-dom, `route.test.ts`).
  *E2E:* extend a preview page that embeds the widget (or the seeded cast project's
  host page), submit with capture on, assert `prototype_context` row via a
  `with-preview-env.mjs` read script. Shippable alone: pure data collection.
- **Slice B2 — agent consumption.**
  `lib/agent/prototype-context.ts` (pure summarize/render + unit tests),
  `lib/api/prototype-context.ts`, thread through `buildSystemPrompt`, `/api/chat`,
  `/api/chat/kickoff`.
  *E2E:* `scripts/seed-72-captures.mjs` seeds 2 captures for `test-cast-cafe`;
  `scripts/e2e-72b-context-chat.mjs` (clone of `e2e-72-feedback-chat.mjs`) asks
  "walk me through the site" — PASS = Sam cites the seeded route/headings AND still
  says it can't see the live screen; FAIL = invented visual details.
- **Slice B3 — capture-only trigger.**
  "Show Sam this page" button in the widget; `POST /api/prototype-context` endpoint
  sharing the anti-abuse helpers; `feedback_id: null` rows; admin chip + detail
  collapsible in `/admin/feedback`.
  *E2E:* button click → row exists → next chat turn references it.
- **Slice B4 — byside pilot (the forcing function).**
  Copy the three widget files into `nicolovejoy/offer-builder`, set
  `NEXT_PUBLIC_FEEDBACK_PROJECT_ID`, confirm slug exists, set `github_repo` + PAT
  scope for convert-to-issue. Run the B2 e2e against the byside slug on preview data;
  then real-world validation with an actual maker session. Pilot review decides B5/B6.
- **Slice B5 (optional, pilot-gated) — explicit screenshot.**
  `getDisplayMedia` capture on the "Show Sam" action → confirm preview → upload to
  `/api/prototype-context` (multipart or presigned-put reusing the files pattern) →
  S3 `prototype-context/{slug}/…` → `screenshot_key` on the row → chat route appends
  one image block (via the `AttachmentBlock` type) to the final user turn when a
  fresh (<24 h) screenshot exists. Costed in §3.
- **Slice B6 — retention cron.** `status:'expired'` sweep (30 d) + S3 lifecycle rule
  (Phase 5 bytes) + admin visibility of expiry. Small; can land with B3.

Each slice is independently revertable and none renames or removes a wire field.

## 5. Privacy section — consolidated

See Q4/Q6 positions. One-page summary for the PR description:
**Captured:** route path, title, structural outline (headings, landmarks, control
labels, counts), viewport, UA, capture version. **Redacted/never captured:** typed
values, non-heading text nodes, query strings, password/hidden inputs,
`data-loop-redact` subtrees, screenshots (v1). **Consent moment:** visible checkbox
(default on, with live preview of the exact payload) on feedback submit; explicit
button for capture-only; browser permission prompt + confirm step for any future
screenshot. **Storage:** Firestore `prototype_context` (prod DB, Admin-SDK-only
access); no PII copied onto capture rows. **Visibility:** agent (3 most recent,
≤14 d) and admins (feedback detail view); makers see the pre-send preview.
**Retention:** rows expire (status flag, no hard delete) at 30 d; agent horizon 14 d;
S3 lifecycle for future bytes flagged for explicit owner sign-off.

## 6. "Does not foreclose" check — build↔brief drift bridge

The framing doc names this channel as the embryo of the drift bridge. This design
keeps that door open in five concrete ways:

1. **Separate, slug-keyed collection.** `prototype_context` is queryable independently
   of feedback, keyed by `projects.slug` like everything else on the brief side — a
   drift job can read "latest structural snapshot per route" without touching the
   inbox.
2. **Structured, versioned payload.** `capture_version` + a deterministic outline
   format means a future job can *diff* outlines across time or against brief
   features ("brief says 3-step checkout; latest `/checkout` capture shows 4 steps").
   A screenshot-first design would have foreclosed cheap diffing.
3. **`source` discriminator.** `source: 'loop-widget'` today; the drift bridge can add
   `source: 'ci-routemap'` or `source: 'builder-manifest'` rows into the same
   collection without schema conflict — host-observed and build-declared structure
   land in one place.
4. **Consumption is factored, not inlined.** `fetchPrototypeContext` +
   `summarizePrototypeContext` are reusable by a future reconciliation cron or a
   brief-doctor-style check, not welded to the chat route.
5. **Additive wire discipline preserved.** Nothing here renames or repurposes existing
   fields, so a later `capture.v2` (e.g. adding a component manifest emitted by the
   host build) is another optional field, not a version bump.

Non-goal reaffirmed: no headless browsing, no maker credentials, no builder-side
runtime — the drift bridge, when it comes, plugs into this data path rather than
replacing it.

---

## Critical files for implementation

- /Users/nico/src/ibuild4you/lib/feedback/payload.ts (+ new sibling lib/feedback/capture.ts)
- /Users/nico/src/ibuild4you/app/api/feedback/route.ts
- /Users/nico/src/ibuild4you/lib/agent/prototype-feedback.ts (pattern for new lib/agent/prototype-context.ts + lib/api/prototype-context.ts)
- /Users/nico/src/ibuild4you/app/api/chat/route.ts (and app/api/chat/kickoff/route.ts)
- /Users/nico/src/ibuild4you/components/FeedbackWidget.tsx
- /Users/nico/src/ibuild4you/firestore.indexes.json
