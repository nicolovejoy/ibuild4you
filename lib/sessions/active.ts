// Shared predicate for hiding admin-archived conversations (#105 Phase 3).
// A session with status 'archived' was reversibly hidden by the Brief-doctor; it
// should not appear in conversation lists, count toward session totals, or feed
// agent context. A missing status (legacy sessions) is treated as visible.

export type WithStatus = { status?: string | null }

export const isArchivedSession = (s: WithStatus): boolean => s.status === 'archived'

export const excludeArchived = <T extends WithStatus>(list: T[]): T[] =>
  list.filter((s) => !isArchivedSession(s))
