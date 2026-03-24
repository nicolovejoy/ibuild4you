// Base entity type — all Firestore documents extend this
export interface BaseEntity {
  id: string
  created_at: string
  updated_at: string
}

// Project membership roles — each level includes everything below
export type MemberRole = 'owner' | 'builder' | 'apprentice' | 'maker'

// Project members collection — role lives on the project-person relationship
export interface ProjectMember extends BaseEntity {
  project_id: string
  user_id: string
  email: string
  role: MemberRole
  added_by: string // email of who added them
  passcode?: string
  first_name?: string
  last_name?: string
}

// Users collection — pure identity, no global role
export interface AppUser extends BaseEntity {
  email: string
  display_name?: string
  first_name?: string
  last_name?: string
}

// Projects collection — one per maker engagement
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
  welcome_message?: string // admin-reviewed welcome message for the maker
  seed_questions?: string[] // ordered questions the agent should weave in early
  builder_directives?: string[] // things agent should actively push toward
  session_mode?: 'discover' | 'converge' // current operating mode (default: discover)
  slug?: string // URL-friendly identifier derived from title
  layout_mockups?: WireframeMockup[] // wireframe layouts the agent can show in chat
  // Enriched by GET /api/projects
  session_count?: number
  last_message_at?: string | null
  last_message_by?: string | null
  last_maker_message_at?: string | null
  last_builder_activity_at?: string
  latest_session_created_at?: string | null
  brief_version?: number | null
  brief_decision_count?: number | null
  brief_feature_count?: number | null
}

// Sessions collection — each conversation between requester and agent
export interface Session extends BaseEntity {
  project_id: string
  status: 'active' | 'completed'
  summary?: string
  // Agent config snapshot — captured when session is created
  session_mode?: 'discover' | 'converge'
  seed_questions?: string[]
  builder_directives?: string[]
  welcome_message?: string
  layout_mockups?: WireframeMockup[]
  // Usage tracking — accumulated across all exchanges in the session
  model?: string
  token_usage_input?: number
  token_usage_output?: number
}

// Messages collection — individual messages within a session
export interface Message extends BaseEntity {
  session_id: string
  role: 'user' | 'agent'
  content: string
  sender_email?: string // who sent this message (for user messages)
  sender_display_name?: string // cached display name at write time
  file_ids?: string[] // attached file IDs
}

// Files collection — uploaded files within a project
export interface ProjectFile extends BaseEntity {
  project_id: string
  session_id?: string
  filename: string
  content_type: string
  size_bytes: number
  storage_path: string
  uploaded_by_email: string
  uploaded_by_uid: string
  uploaded_by_name?: string // cached display name at write time
}

// Briefs collection — the living brief for a project
export interface Brief extends BaseEntity {
  project_id: string
  version: number
  content: BriefContent
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

// Structured brief content sections
export interface BriefContent {
  problem: string
  target_users: string
  features: string[]
  constraints: string
  additional_context: string
  decisions?: BriefDecision[]
}

export interface BriefDecision {
  topic: string // short label ("Data source", "Ticker selection")
  decision: string // what was decided ("Reddit API for user sentiment")
}

// Wireframe mockup — visual layout the agent can show inline in chat
export interface WireframeSection {
  type: string // hero, text, cta, gallery, form, signup, nav, footer, map, video
  label: string // what the maker sees ("Custom Cakes")
  description: string // brief explanation ("Photo portfolio with sizes")
  page?: string // groups sections under page headings for multi-page layouts
}

export interface WireframeMockup {
  title: string // "Strategy A: Single Page"
  sections: WireframeSection[]
}
