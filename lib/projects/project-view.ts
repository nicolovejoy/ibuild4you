import type { MemberRole } from '@/lib/types'

// =============================================================================
// PROJECT VIEW SELECTION + MAKER-ACTIVITY SEMANTICS (#110)
//
// Builder-side roles (owner, builder, and the resolve endpoint's 'admin')
// get the read-only BuilderProjectView by default (#120) and can explicitly
// join the maker chat via ?view=chat. Maker-side roles (maker, apprentice)
// always get the chat.
// =============================================================================

// viewer_role as returned by GET /api/projects?slug=… — 'admin' is the
// system-admin marker, distinct from any project_members role.
export type ProjectViewerRole = MemberRole | 'admin'

export function isBuilderSideRole(role: ProjectViewerRole | null): boolean {
  return role === 'owner' || role === 'builder' || role === 'admin'
}

// Which view /projects/[id] renders for this role + ?view= param.
export function selectProjectView(
  role: ProjectViewerRole | null,
  viewParam: string | null
): 'builder' | 'maker' {
  if (!isBuilderSideRole(role)) return 'maker'
  return viewParam === 'chat' ? 'maker' : 'builder'
}

// Server-side: whether a chat message from this project role counts as maker
// activity (last_maker_message_at, notify debounce, reminder-cycle reset).
// Builder-side senders participate without silencing maker nudges or moving
// the turn indicator. getProjectRole resolves system admins to 'owner', so a
// role-based check covers them too.
export function countsAsMakerActivity(role: MemberRole | null): boolean {
  return role === 'maker' || role === 'apprentice'
}

export type BuilderTabId = 'brief' | 'conversations' | 'people' | 'setup'

// The tab a builder lands on when the URL doesn't name one.
export const DEFAULT_BUILDER_TAB: BuilderTabId = 'brief'

const BUILDER_TABS: BuilderTabId[] = ['brief', 'conversations', 'people', 'setup']

// Map legacy ?tab= values (sessions/files) so old links/bookmarks land on
// the right tab after the IA flatten.
const LEGACY_TAB: Record<string, BuilderTabId> = {
  sessions: 'conversations',
  files: 'brief',
}

// Which builder tab the URL asks for. An explicit (or legacy) ?tab= wins.
// Without one, a ?session= link means "show me that conversation" — the
// conversation picker writes those with no tab — otherwise the brief.
export function resolveBuilderTab(tab: string | null, session: string | null): BuilderTabId {
  const raw = tab || ''
  if ((BUILDER_TABS as string[]).includes(raw)) return raw as BuilderTabId
  if (LEGACY_TAB[raw]) return LEGACY_TAB[raw]
  return session ? 'conversations' : DEFAULT_BUILDER_TAB
}
