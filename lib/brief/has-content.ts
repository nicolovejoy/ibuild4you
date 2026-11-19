import type { BriefContent } from '@/lib/types'

// True when any part of the brief holds something. The note writer creates an
// empty brief doc to hang notes on, so "has a brief" means this, not "a doc exists".
export function hasBriefContent(brief: BriefContent): boolean {
  return !!(
    brief.problem ||
    brief.target_users ||
    (brief.features && brief.features.length > 0) ||
    brief.constraints ||
    brief.additional_context ||
    (brief.decisions && brief.decisions.length > 0) ||
    (brief.open_risks && brief.open_risks.length > 0) ||
    (brief.shipped && brief.shipped.length > 0) ||
    (brief.queued && brief.queued.length > 0)
  )
}
