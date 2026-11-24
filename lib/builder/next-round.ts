import type { Project, Session } from '@/lib/types'
import { welcomeToPost } from '@/lib/sessions/welcome'
import { isPayloadQueued } from '@/lib/sessions/queued'

// =============================================================================
// NEXT ROUND (read-only panel on the builder Conversations tab)
//
// What the next conversation would open with if it were started now, read
// from the project's per-round fields. Those fields are set by each paste and
// are not edited by hand, so the panel only shows them.
//
// The opening follows the same rule as POST /api/sessions (welcomeToPost). One
// difference: the client's session list leaves out admin-archived
// conversations, which the server does count as "earlier". After an admin
// reset the panel can therefore say a welcome will be posted that the server
// then holds back.
// =============================================================================

export type NextRoundOpening =
  | { kind: 'welcome'; text: string } // the builder's welcome, word for word
  | { kind: 'default' } // first conversation, no welcome set: the default copy
  | { kind: 'kickoff' } // return conversation, a paste is queued: Sam greets with it
  | { kind: 'nothing_queued' } // return conversation, nothing pasted since the maker spoke: the canned note

export interface NextRound {
  opening: NextRoundOpening
  mode: 'discover' | 'converge'
  // Seed questions in discover mode, builder directives in converge mode:
  // only the list for the current mode reaches the agent.
  points: string[]
  nudge: string | null
  pastedAt: string | null
  pastedVersion: number | null
}

export function nextRound(args: {
  project: Pick<
    Project,
    | 'welcome_message'
    | 'session_mode'
    | 'seed_questions'
    | 'builder_directives'
    | 'nudge_message'
    | 'payload_pasted_at'
    | 'payload_pasted_version'
    | 'last_maker_message_at'
  >
  // The conversations the builder can see, in any order.
  sessions: Pick<Session, 'id' | 'welcome_message'>[]
  // The open conversation, when the maker has not spoken in it: it has not
  // "used" its welcome, so the same text is posted again in the next one.
  unusedSessionId: string | null
}): NextRound {
  const { project, sessions, unusedSessionId } = args
  const isFirstSession = sessions.length === 0

  const welcome = welcomeToPost({
    isFirstSession,
    welcome: project.welcome_message,
    earlierWelcomes: sessions.filter((s) => s.id !== unusedSessionId).map((s) => s.welcome_message),
  })
  const opening: NextRoundOpening = welcome
    ? { kind: 'welcome', text: welcome }
    : isFirstSession
      ? { kind: 'default' }
      : // The kickoff of a new, empty return conversation posts the canned
        // "nothing queued yet" note unless a paste is queued (isUnqueuedReturn).
        isPayloadQueued(project)
        ? { kind: 'kickoff' }
        : { kind: 'nothing_queued' }

  const mode = project.session_mode || 'discover'
  const points = (mode === 'discover' ? project.seed_questions : project.builder_directives) || []
  const nudge = project.nudge_message && project.nudge_message.trim() ? project.nudge_message : null

  return {
    opening,
    mode,
    points,
    nudge,
    pastedAt: project.payload_pasted_at || null,
    pastedVersion: project.payload_pasted_version ?? null,
  }
}
