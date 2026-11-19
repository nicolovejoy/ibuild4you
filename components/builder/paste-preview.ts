// What a pasted next-convo payload will do to the live brief, as the lines the
// Brief tab shows under the paste box before Import. Pure: FerryDesk only
// renders what this returns. A patch is run through the same applyBriefPatch
// the server uses, so the preview and the import cannot disagree.
import { copy } from '@/lib/copy'
import { parseNextConvoPayload } from '@/lib/api/import-payload'
import { applyBriefPatch, normalizeBriefPatch, removedDecisionTopics } from '@/lib/brief/patch'
import { hasBriefContent } from '@/lib/brief/has-content'
import type { BriefContent } from '@/lib/types'

export type PastePreviewLine = {
  id: 'changes' | 'unmatched' | 'locks' | 'rewrite' | 'no-brief'
  text: string
  warn: boolean // warning style, like a stale version line
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

// A whole brief is untrusted pasted JSON, so check the one part the rewrite
// line reads. Null when its decisions are not a list we can compare.
function wholeBriefForCompare(brief: unknown): BriefContent | null {
  if (!isPlainObject(brief)) return null
  const raw = brief.decisions
  if (raw !== undefined && !Array.isArray(raw)) return null
  const decisions = (raw ?? []).filter(
    (d): d is { topic: string; decision: string } => isPlainObject(d) && typeof d.topic === 'string'
  )
  return { ...(brief as unknown as BriefContent), decisions }
}

// The preview runs on every keystroke and the pasted JSON and the stored brief
// are both untrusted shapes, so any failure means no preview, never a crash.
export function pastePreviewLines(pasteValue: string, briefContent: BriefContent | null): PastePreviewLine[] {
  try {
    return buildLines(pasteValue, briefContent)
  } catch {
    return []
  }
}

function buildLines(pasteValue: string, briefContent: BriefContent | null): PastePreviewLine[] {
  if (pasteValue.trim() === '') return []
  const parsed = parseNextConvoPayload(pasteValue)
  if (!parsed.ok) return []
  const payload = parsed.value
  const live = briefContent && hasBriefContent(briefContent) ? briefContent : null

  if (payload.mode === 'patch') {
    // The first brief must be a whole one, so a patch has nothing to merge into.
    if (!live) return [{ id: 'no-brief', text: copy.brief.patchNoBrief, warn: true }]
    const patch = normalizeBriefPatch(payload.patch)
    if (!patch) return []
    const { summary, unmatched, locksTouched } = applyBriefPatch(live, patch)
    const lines: PastePreviewLine[] = [{ id: 'changes', text: copy.brief.patchPreview(summary), warn: false }]
    const anyUnmatched = Object.values(unmatched).some((list) => list.length > 0)
    if (anyUnmatched) {
      lines.push({ id: 'unmatched', text: copy.brief.patchDropUnmatched(unmatched, true), warn: true })
    }
    if (locksTouched.length > 0) {
      lines.push({ id: 'locks', text: copy.brief.patchLocksKept(locksTouched), warn: true })
    }
    return lines
  }

  // A whole brief (multi, or the bare legacy form) drops a decision by leaving
  // it out. Nothing to compare against when there is no live brief.
  if (!live) return []
  const next = wholeBriefForCompare(payload.brief)
  if (!next) return []
  // A stamped paste has its locks restored by the server (restoreLocksOnPaste),
  // so a locked decision left out is not lost. An unstamped raw paste loses them.
  const lockedTopics = new Set((live.decisions ?? []).filter((d) => d.locked).map((d) => d.topic))
  const removed = removedDecisionTopics(live, next).filter((t) => !(payload.stamp && lockedTopics.has(t)))
  if (removed.length === 0) return []
  return [{ id: 'rewrite', text: copy.brief.wholeRewriteRemoves(removed), warn: true }]
}
