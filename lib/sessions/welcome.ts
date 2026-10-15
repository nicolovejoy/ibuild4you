// Which builder-written welcome_message, if any, becomes a new conversation's
// first agent message. Posted word for word: builders put links and testing
// steps in it, and Sam's generated greeting paraphrased them away (a return
// session once lost the app URL entirely).
//
// - First conversation: always opens with a welcome. Returns null when none
//   is set so the caller can fall back to its default copy.
// - Return conversation: opens with the welcome only if it was written for
//   this round, i.e. no earlier conversation already used the same text.
//   welcome_message lives on the project and persists between rounds, so
//   without this check a stale "a first screen is live" note would replay on
//   every new conversation. With nothing new to post, the conversation starts
//   empty and Sam's kickoff greeting opens it (lib/agent/kickoff.ts).
export function welcomeToPost({
  isFirstSession,
  welcome,
  earlierWelcomes,
}: {
  isFirstSession: boolean
  welcome: string | null | undefined
  earlierWelcomes: (string | null | undefined)[]
}): string | null {
  const text = typeof welcome === 'string' ? welcome.trim() : ''
  if (!text) return null
  if (isFirstSession) return welcome as string
  const used = earlierWelcomes.some((w) => typeof w === 'string' && w.trim() === text)
  return used ? null : (welcome as string)
}
