import { NOTIFICATION_EMAILS } from '@/lib/constants'
import { listAppGrants, loopGarmConfigured } from '@/lib/garm-loop'

/**
 * Who gets the new-feedback email for an app: NOTIFICATION_EMAILS first, then
 * the app's Garm owners and collaborators (de-duplicated). Role strings pick
 * recipients here; they decide no access. Garm unconfigured or unreachable →
 * NOTIFICATION_EMAILS alone, so a Garm outage never silences the notification.
 */
export async function feedbackRecipients(appSlug: string): Promise<string[]> {
  if (!loopGarmConfigured()) return [...NOTIFICATION_EMAILS]
  try {
    const grants = await listAppGrants(appSlug)
    const people = grants
      .filter((g) => g.role === 'owner' || g.role === 'collaborator')
      .map((g) => g.email)
    return [...new Set([...NOTIFICATION_EMAILS, ...people])]
  } catch {
    // Never log the error body or any address.
    console.error('[feedback] garm recipients unavailable')
    return [...NOTIFICATION_EMAILS]
  }
}
