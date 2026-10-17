// "Queued" = the builder has pasted a new brief payload since the maker last
// spoke, i.e. there is something new for the next conversation to cover.
// Read by the kickoff route, the chat route and the import PATCH to decide
// whether the agent may greet with new material or must say nothing is queued.
// Timestamps are UTC ISO strings, so lexical comparison is chronological.

type QueueStamps = {
  payload_pasted_at?: string | null
  prep_copied_at?: string | null
  last_maker_message_at?: string | null
}

export function isPayloadQueued(project: QueueStamps): boolean {
  if (!project.payload_pasted_at) return false
  return project.payload_pasted_at > (project.last_maker_message_at ?? '')
}

// "Harvested" = the builder copied the next-convo prep after the maker last
// spoke, i.e. this round is over on the builder's side and the maker is now
// waiting on them.
export function roundHarvested(project: QueueStamps): boolean {
  return typeof project.prep_copied_at === 'string' && project.prep_copied_at > (project.last_maker_message_at ?? '')
}

// The one rule for the canned "nothing queued" greeting (#214, post-review
// ruling 2026-10-17). Nothing pasted since the maker last spoke is not enough on
// its own: last_maker_message_at moves on every maker turn, so that is true for
// the rest of every round, mid-intake included. The greeting is for a maker who
// comes back *between* rounds: either the session holds none of their messages
// yet (an empty return session), or the builder has harvested the round.
export function isUnqueuedReturn(args: { project: QueueStamps; sessionHasMakerMessage: boolean }): boolean {
  if (isPayloadQueued(args.project)) return false
  return !args.sessionHasMakerMessage || roundHarvested(args.project)
}
