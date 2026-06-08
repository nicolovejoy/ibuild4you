// Shared kickoff decision logic (#31). Used client-side to decide whether to
// fire a greeting on session open, and conceptually mirrored server-side to
// re-validate. Pure + side-effect-free so it's trivially unit-testable.

const ONE_HOUR_MS = 60 * 60 * 1000

export const KICKOFF_GAP_MS = ONE_HOUR_MS

type KickoffMessage = { role: 'user' | 'agent'; created_at?: string }

/**
 * Decide whether to fire an agent kickoff greeting on session open.
 *
 * Scope (locked 2026-06-07): returning-after-a-break only. We fire only when
 * the maker already has messages in this session AND it's been ≥1hr since their
 * last one. Fresh sessions are skipped entirely — the stored welcome message
 * already greets them, so kicking off there would double-greet.
 *
 * @param messages chronological (oldest first; last element is newest)
 * @param nowMs    current time in epoch ms
 */
export function shouldKickoff(messages: KickoffMessage[], nowMs: number): boolean {
  if (messages.length === 0) return false

  // The maker is mid-turn if the last message is theirs — don't interrupt.
  const last = messages[messages.length - 1]
  if (last.role !== 'agent') return false

  // Returning-after-a-break only: there must be prior maker activity to recap.
  const makerMessages = messages.filter((m) => m.role === 'user')
  if (makerMessages.length === 0) return false

  const lastMakerAtMs = makerMessages.reduce((max, m) => {
    const t = m.created_at ? new Date(m.created_at).getTime() : 0
    return t > max ? t : max
  }, 0)
  if (!lastMakerAtMs) return false

  return nowMs - lastMakerAtMs >= KICKOFF_GAP_MS
}
