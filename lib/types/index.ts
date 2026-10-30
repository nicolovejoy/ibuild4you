import type { Locale } from '@/lib/locale'
// Base entity type — all Firestore documents extend this
export interface BaseEntity {
  id: string
  created_at: string
  updated_at: string
}

// Project membership roles — access tier; each level includes everything below
export type MemberRole = 'owner' | 'builder' | 'apprentice' | 'maker'

// Brief role — what a person is *doing* in a specific brief (RAAC vocabulary).
// Distinct from MemberRole, which is the access tier. Today they overlap
// (maker→originator, builder→reviewer, apprentice→contributor) but they're
// conceptually separate axes; this field separates them in the data model.
export type BriefRole = 'originator' | 'contributor' | 'reviewer'

// Member summary returned by GET /api/projects/[id]/members (Roles panel).
export interface ProjectMemberSummary {
  id: string
  email: string
  display_name: string
  role: MemberRole | null
  brief_role: BriefRole | null
  added_by: string | null
  created_at: string | null
  removed_at: string | null // when this member was moved out of the brief (#106); null = active
}

// System-level roles — platform-wide capabilities (not project-scoped)
export type SystemRole = 'admin' | 'support'

// Projects collection — one per maker engagement.
// UI-LEVEL NAMING: this construct is called "brief" in user-facing copy
// (dashboard, modals, share text). The data model + API + routes keep the
// `project` / `projects` name to avoid a sweeping rename. When in doubt,
// "Project" in code === "Brief" in UI.
export interface Project extends BaseEntity {
  requester_id: string
  title: string
  status: 'active' | 'paused' | 'completed'
  context?: string // admin-provided context about the project/maker
  requester_email?: string // email of the intended maker (for sharing)
  requester_first_name?: string
  requester_last_name?: string
  shared_at?: string // when the project was shared with the maker
  last_nudged_at?: string // when the builder last copied a nudge message
  prep_copied_at?: string // when the builder last copied the prep prompt (client-set, UTC ISO)
  payload_pasted_at?: string // when the builder last pasted a brief payload (client-set, UTC ISO)
  maker_waiting_since?: string | null // set when the maker greeted/spoke into an unqueued session (#214); cleared when a payload is queued
  payload_pasted_version?: number // brief version that last paste produced (client-set, from the PUT /api/briefs result)
  welcome_message?: string // admin-reviewed welcome message for the maker
  nudge_message?: string // builder-authored outbound nudge; used verbatim when set
  voice_sample?: string // builder's voice anchor for AI-generated outbound copy
  // AI-prepped "next session" handoff (slice 2). Written only by /prep/generate,
  // never the client PATCH. nudge_message override still wins over prep_nudge.
  prep_nudge?: string // AI-drafted nudge body (no link); default when no override
  prep_focus?: string // AI one-line builder focus summary for the dispatch card
  prep_config_hash?: string // fingerprint of the inputs prep_* was generated from
  prep_generated_at?: string // ISO timestamp of the last successful prep generation
  seed_questions?: string[] // ordered questions the agent should weave in early
  builder_directives?: string[] // things agent should actively push toward
  session_mode?: 'discover' | 'converge' // current operating mode (default: discover)
  slug?: string // URL-friendly identifier derived from title
  identity?: string // custom agent identity/persona (overrides default)
  github_repo?: string // "owner/name" — the brief's codebase, for sibling decisions (#142)
  // Language the maker is addressed in (agent replies, outbound copy, link
  // previews). Absent = English. The brief content itself stays English.
  language?: Locale
  // Link previews show the brief title unless this is true (then the anonymous
  // colour/glyph/code card). Previews are public to anyone holding the link.
  hide_title_in_previews?: boolean
  // Debounced maker-activity notifications — cron at /api/cron/notify reads these
  notify_after?: string | null // ISO timestamp; cron sends email once this passes
  notify_pending_since?: string | null // ISO timestamp of first unnotified maker message
  notify_last_sent_at?: string | null // ISO timestamp of last notification email
  // Auto-reminder cron (/api/cron/maker-reminders, daily). Only `=== true` opts in.
  // Set to `true` automatically on project creation; existing projects stay opt-out
  // until a builder flips the Setup-tab toggle. Maker messaging resets count + ts.
  auto_reminders_enabled?: boolean
  reminders_sent_count?: number
  last_reminder_sent_at?: string | null
  // Written by the notify cron's note writer (app/api/cron/notify, #229; the
  // field names predate it). The error is cleared on the next successful note;
  // the Brief tab shows it until then.
  brief_regen_failures?: number
  brief_regen_last_error?: string | null
  brief_regen_last_error_at?: string | null
  // #229: created_at of the newest message any brief note has covered.
  notes_through_at?: string | null
  // Enriched by GET /api/projects
  session_count?: number
  last_message_at?: string | null
  last_message_by?: string | null
  last_maker_message_at?: string | null
  last_builder_activity_at?: string
  latest_session_created_at?: string | null
  brief_version?: number | null
  brief_updated_at?: string | null
  brief_decision_count?: number | null
  brief_feature_count?: number | null
  brief_maker_question_count?: number | null
  viewer_role?: MemberRole | 'admin' | null
  viewer_brief_role?: BriefRole | null // viewer's stored brief_role (chrome badges)
  viewer_archived?: boolean // whether the viewer archived this brief (per-viewer, from their membership)
  has_active_session?: boolean
}

// Sessions collection — each conversation between requester and agent
export interface Session extends BaseEntity {
  project_id: string
  status: 'active' | 'completed' | 'archived' // 'archived' = reversibly hidden (admin Brief-doctor, #105)
  archived_at?: string | null
  last_kickoff_at?: string // when the agent last greeted this session via kickoff (#214)
  unqueued_notified_at?: string // when the builder was last told the maker is waiting with nothing queued (#214)
  summary?: string
  // Agent config snapshot — captured when session is created
  session_mode?: 'discover' | 'converge'
  seed_questions?: string[]
  builder_directives?: string[]
  welcome_message?: string
  identity?: string
  // Usage tracking — accumulated across all exchanges in the session
  model?: string
  token_usage_input?: number
  token_usage_output?: number
  // Accumulated list-price cost estimate (USD). Computed from full usage incl.
  // cache tokens, so it stays accurate even though the token totals above are
  // the uncached remainder. See lib/observability/session-cost.ts.
  token_cost_usd?: number
}

// Messages collection — individual messages within a session
export interface Message extends BaseEntity {
  session_id: string
  role: 'user' | 'agent'
  content: string
  sender_email?: string // who sent this message (for user messages)
  sender_display_name?: string // cached display name at write time
  file_ids?: string[] // attached file IDs
  kind?: 'unqueued_greeting' // canned "nothing queued" greeting, not model output (#214)
  rating?: 'up' | 'down' | null // maker's 👍/👎 on an agent message (#130)
}

// Files collection — uploaded files and artifacts within a project.
// "Artifacts" (#83) evolve this collection in place: additive optional fields,
// no migration. A legacy upload has none of them and keeps working.
export interface ProjectFile extends BaseEntity {
  project_id: string
  session_id?: string
  filename: string
  // Bytes-backed fields — present for uploaded/agent artifacts, absent for
  // linked artifacts (which point at an external URL, no S3 object).
  content_type?: string
  size_bytes?: number
  storage_path?: string
  uploaded_by_email: string
  uploaded_by_uid: string
  uploaded_by_name?: string // cached display name at write time
  // Phase 2 upload flow: 'pending' until the client confirms direct-to-S3
  // upload completed, then 'ready'. Files written before this field existed
  // are treated as ready by the UI.
  status?: 'pending' | 'ready'
  // Flat folder assignment (#23b). Absent/null = unfiled.
  folder_id?: string | null
  // --- Artifacts (#83), all additive/optional ---
  // Where the artifact came from. Absent = 'uploaded' (legacy).
  source?: 'uploaded' | 'agent' | 'linked'
  // Linked artifacts only: the external URL. Such docs have no storage_path.
  url?: string
  // One-line human- or agent-written note. Feeds agent context + the MCP reader.
  description?: string
  // Load-bearing artifact — sorts first, named in the agent prompt (#83 Phase B).
  pinned?: boolean
  // Coarse attribution (#43-lite).
  created_by_role?: 'maker' | 'builder' | 'agent'
}

// File folders collection — flat, per-project organization for files (#23b).
// Purely organizational: deleting a folder moves its files back to unfiled.
export interface FileFolder extends BaseEntity {
  project_id: string
  name: string
  created_by_email?: string
}

// Briefs collection — the living brief for a project
// #194: who produced a brief version. Archived versions carry the source that
// produced THEM, so the history reads "v3 — regen", "v4 — paste".
export type BriefSource = 'create' | 'paste' | 'regen' | 'restore' | 'note'

export interface Brief extends BaseEntity {
  project_id: string
  version: number
  content: BriefContent
  source?: BriefSource // absent on briefs written before #194
}

// One archived brief version (briefs/{id}/versions/{version}).
export interface BriefVersion {
  version: number
  content: BriefContent
  updated_at: string
  source: BriefSource | null
  archived_at: string
}

// Reviews collection — builder annotations on a brief
export interface Review extends BaseEntity {
  brief_id: string
  project_id: string
  reviewer_id: string
  annotations: ReviewAnnotation[]
}

export interface ReviewAnnotation {
  section: string
  comment: string
  created_at: string
}

// Interest form submissions from the landing page
export interface InterestSubmission extends BaseEntity {
  name: string
  email: string
  how_found: string
  want_to_try: boolean
  what_for: string
}

// A host app that embeds the Loop widget. Document id == slug. Feedback belongs
// to the app, not to a brief. No admin list lives here (created_by is provenance only).
export interface App extends BaseEntity {
  slug: string
  name: string
  github_repo?: string
  feedback_requires_identity?: boolean
  brief_id?: string | null // optional link to a projects doc
  legacy_slugs?: string[] // old widget slugs still accepted (resolve to this app)
  created_by: string
}

// What /api/admin/apps returns: the app plus how the caller reaches it.
export type AppAccess = 'admin' | 'owner' | 'collaborator'
export type AppWithAccess = App & { access: AppAccess }

// One row of an app's admin list (read live from Garm, never stored here).
export interface AppAdmin {
  email: string
  role: 'owner' | 'collaborator'
  created_at?: string
  created_by?: string
}

// Feedback submissions from the FeedbackWidget embedded on client sites.
// projectId on the wire is an app slug (or one of its legacy slugs); widget
// submissions are rejected when it doesn't match an app.
export type FeedbackType = 'bug' | 'idea' | 'other'
export type FeedbackStatus = 'new' | 'acknowledged' | 'in_progress' | 'done' | 'wontfix' | 'spam'

export interface Feedback extends BaseEntity {
  project_id: string // app slug (canonical)
  type: FeedbackType
  body: string
  submitter_email: string | null
  submitter_uid: string | null // set only when submitter is signed into ibuild4you
  // #149: true when submitter_email came from a verified host-app identity
  // assertion (not just typed into the widget's email field). Absent/false on
  // rows that predate #149 or are unverified.
  submitter_email_verified?: boolean
  page_url: string
  user_agent: string
  viewport: string
  status: FeedbackStatus
  internal_notes: string | null
  github_issue_url: string | null
  // Subcollection: feedback/{id}/replies — see FeedbackReply below.
}

// Replies live under feedback/{id}/replies and capture the back-and-forth.
// Inbound mail (Resend webhook) appends `from: 'submitter', via_email: true`
// replies; admin notes added through the dashboard set `from: 'admin'`.
export interface FeedbackReply extends BaseEntity {
  feedback_id: string
  from: 'submitter' | 'admin'
  from_email: string // denormalized for display without lookups
  body: string
  via_email: boolean // true if this reply arrived via inbound mail
}

// An open risk may carry an owner (#220). Helpers live in lib/brief/risks.ts.
export type BriefRiskOwner = 'maker' | 'builder'
export interface BriefRisk {
  text: string
  owner?: BriefRiskOwner
}

// Structured brief content sections
export interface BriefContent {
  problem: string
  target_users: string
  features: string[]
  constraints: string
  additional_context: string
  decisions?: BriefDecision[]
  open_risks?: Array<string | BriefRisk> // string = unowned; see lib/brief/risks.ts, #220
}

export interface BriefDecisionContest {
  proposed: string // what the maker wants instead
  reason: string // why, and when they confirmed it
}

export interface BriefContestDismissed {
  proposed: string // the proposal a builder dismissed
  at: string // ISO
}

export interface BriefDecision {
  topic: string // short label ("Data source", "Ticker selection")
  decision: string // what was decided ("Reddit API for user sentiment")
  // Locked = a durable constraint (the build's locked convention / do-not-use
  // list). Survives a stamped ferry-desk paste verbatim (the server restores
  // it, #229) and the agent must reconcile new intake against it rather than
  // silently overwriting. See lib/api/brief-merge.ts (#71).
  locked?: boolean
  // #197: the note writer may *contest* a locked decision (the maker explicitly
  // confirmed a reversal in conversation, #229) but never remove it. Only ever
  // set on a locked decision; cleared by a builder's Accept/Dismiss on the
  // Brief tab (a stamped paste can't clear it).
  contested?: BriefDecisionContest
  // #197: a builder dismissed a contest. Remembered so a later note does not
  // raise the same proposal again.
  // Only on a locked decision. Cleared when the lock is accepted/changed.
  contest_dismissed?: BriefContestDismissed
  // Provenance (#121) — stamped by code (stampDecisionProvenance), never by the
  // model. Session doc id (stable; conversation number is derived at render);
  // null = decided out-of-band (e.g. prep chat → paste). Old decisions without
  // stamps stay unstamped — no backfill.
  decided_in_session?: string | null
  decided_at?: string // ISO timestamp
  // #218: when the decision text changes on an already-stamped topic, the
  // origin above stays and the latest revision is stamped here (code-side,
  // same rules). Only the most recent revision is kept; the full trail is in
  // the brief's version history (#194).
  revised_in_session?: string | null
  revised_at?: string // ISO timestamp
}

// #229: a short per-conversation note under briefs/{id}/notes.
export interface BriefNoteLockReversal {
  topic: string
  proposed: string
  reason: string
}

export interface BriefNote {
  id: string
  session_id: string | null
  created_at: string
  folded_at: string | null
  text: string
  decisions: { topic: string; decision: string }[]
  risks_added: Array<string | BriefRisk>
  risks_resolved: string[]
  lock_reversals: BriefNoteLockReversal[]
}

// #229: what a prep payload carries back as `_prep_stamp`.
export interface PrepStamp {
  brief_version: number
  note_ids: string[]
}
