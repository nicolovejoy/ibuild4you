import type { Project, MemberRole } from '@/lib/types'

type ViewerRole = MemberRole | 'admin' | null

interface TurnIndicator {
  label: string
  className: string
}

export function getTurnIndicator(
  project: Project | undefined,
  viewerRole: ViewerRole
): TurnIndicator | null {
  if (!project) return null

  if (project.status === 'completed') {
    return { label: 'Completed', className: 'bg-gray-100 text-gray-600' }
  }

  if (!project.requester_email || !project.session_count) {
    return { label: 'Needs setup', className: 'bg-gray-100 text-gray-600' }
  }

  const makerName = project.requester_first_name || project.requester_email.split('@')[0]
  const isMaker = viewerRole === 'maker'

  const makerMessagedInCurrentSession = project.last_maker_message_at
    && project.latest_session_created_at
    && project.last_maker_message_at > project.latest_session_created_at

  if (makerMessagedInCurrentSession) {
    // Maker has responded — builder's turn
    if (isMaker) {
      return { label: 'Waiting for builder', className: 'bg-blue-100 text-blue-700' }
    }
    return { label: 'Your turn', className: 'bg-amber-100 text-amber-700' }
  }

  // Maker hasn't responded yet — maker's turn
  if (isMaker) {
    return { label: 'Your turn', className: 'bg-amber-100 text-amber-700' }
  }
  return { label: `Waiting on ${makerName}`, className: 'bg-blue-100 text-blue-700' }
}
