// Shared kickoff decision logic (#31). Used client-side to decide whether to
// fire a greeting on session open, and conceptually mirrored server-side to
// re-validate. Pure + side-effect-free so it's trivially unit-testable.

const ONE_HOUR_MS = 60 * 60 * 1000

export const KICKOFF_GAP_MS = ONE_HOUR_MS

type KickoffMessage = { role: 'user' | 'agent'; created_at?: string }

/**
 * Decide whether to fire an agent kickoff greeting on session open.
 *
 * Scope (locked 2026-06-07; relaxed for #70): returning-after-a-break only. We
 * fire when there's prior maker activity to recap AND it's been ≥1hr since the
 * maker's last message. Prior activity is judged at the **project** level, not
 * just this session — since #70 a return session starts empty (no canned
 * welcome), so a builder-pre-created blank session still earns a state-aware
 * recap. A true first-ever session (no maker history anywhere) is skipped: the
 * stored welcome message already greets them, so kicking off would double-greet.
 *
 * @param messages chronological (oldest first; last element is newest)
 * @param nowMs    current time in epoch ms
 * @param opts.projectLastMakerMessageAt latest maker message across the whole
 *        project (ISO). Lets an empty return session recognize prior history.
 */
export function shouldKickoff(
  messages: KickoffMessage[],
  nowMs: number,
  opts?: { projectLastMakerMessageAt?: string | null },
): boolean {
  // The maker is mid-turn if the last message is theirs — don't interrupt.
  const last = messages[messages.length - 1]
  if (last && last.role !== 'agent') return false

  // Returning-after-a-break only: there must be prior maker activity to recap,
  // either in this session or anywhere else on the project.
  const lastMakerInSessionMs = messages
    .filter((m) => m.role === 'user')
    .reduce((max, m) => {
      const t = m.created_at ? new Date(m.created_at).getTime() : 0
      return t > max ? t : max
    }, 0)
  const projectMakerMs = opts?.projectLastMakerMessageAt
    ? new Date(opts.projectLastMakerMessageAt).getTime()
    : 0
  const lastMakerAtMs = Math.max(lastMakerInSessionMs, projectMakerMs)
  if (!lastMakerAtMs) return false

  return nowMs - lastMakerAtMs >= KICKOFF_GAP_MS
}
