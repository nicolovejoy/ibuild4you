// "Queued" = the builder has pasted a new brief payload since the maker last
// spoke, i.e. there is something new for the next conversation to cover.
// Read by the kickoff route, the chat route and the import PATCH to decide
// whether the agent may greet with new material or must say nothing is queued.
// Timestamps are UTC ISO strings, so lexical comparison is chronological.

export function isPayloadQueued(project: {
  payload_pasted_at?: string | null
  last_maker_message_at?: string | null
}): boolean {
  if (!project.payload_pasted_at) return false
  return project.payload_pasted_at > (project.last_maker_message_at ?? '')
}
