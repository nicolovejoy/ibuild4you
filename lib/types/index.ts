// Base entity type — all Firestore documents extend this
export interface BaseEntity {
  id: string
  created_at: string
  updated_at: string
}

// User roles in the system
export type UserRole = 'requester' | 'builder'

// Users collection
export interface AppUser extends BaseEntity {
  email: string
  role: UserRole
  display_name?: string
}

// Projects collection — one per requester engagement
export interface Project extends BaseEntity {
  requester_id: string
  title: string
  status: 'active' | 'paused' | 'completed'
  context?: string // admin-provided context about the project/requester
  requester_email?: string // email of the intended requester (for sharing)
}

// Sessions collection — each conversation between requester and agent
export interface Session extends BaseEntity {
  project_id: string
  status: 'active' | 'completed'
  summary?: string
}

// Messages collection — individual messages within a session
export interface Message extends BaseEntity {
  session_id: string
  role: 'user' | 'agent'
  content: string
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
}
