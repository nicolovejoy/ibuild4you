// The next-convo prep's <build_status> block: the unfolded build reports that
// Claude Code posted from a build repo, for the comms agent to fold into the
// brief. Reports are shown oldest first; when they run long, the oldest are
// left out (the paste still folds them, since the stamp lists every one).
import type { BuildReport } from '@/lib/types'

// Total rendered length of the reports one prep shows.
export const REPORTS_PREP_CAP = 15000

function pacificParts(iso: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // h23 so midnight prints as 00:MM, not 24:MM.
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  return Object.fromEntries(parts.map((p) => [p.type, p.value]))
}

// "YYYY-MM-DD HH:MM PT"
function pacificMinute(iso: string): string {
  const p = pacificParts(iso)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} PT`
}

// "YYYY-MM-DD": the Pacific calendar day, for the report's `day` attribute.
function pacificDate(iso: string): string {
  const p = pacificParts(iso)
  return `${p.year}-${p.month}-${p.day}`
}

// "YYYY-MM-DD PT"
function pacificDay(iso: string): string {
  return `${pacificDate(iso)} PT`
}

// Report text comes from a build repo. Swapping the angle brackets for
// look-alikes means it can never close this block or open a <prep_stamp>, and
// folding line breaks into one space keeps each item on its own line, so it
// cannot fake a heading such as "Live (checked in production):".
function neutralize(text: string): string {
  return text.replace(/</g, '‹').replace(/>/g, '›').replace(/[\r\n]+/g, ' ')
}

// One <report>…</report>. The stale line appears when the report was made
// against an older brief version than the live one.
function renderReport(report: BuildReport, liveBriefVersion: number): string {
  const lines = [
    `<report id="${report.id}" posted="${pacificMinute(report.posted_at)}" day="${pacificDate(report.posted_at)}" brief_version="${report.brief_version_checked}">`,
  ]
  if (report.brief_version_checked < liveBriefVersion) {
    lines.push(
      `Made from v${report.brief_version_checked}; the brief is now v${liveBriefVersion}, so check its questions against the brief.`
    )
  }
  if (report.live.length > 0) {
    lines.push(
      'Live (checked in production):',
      ...report.live.map((l) => `- ${neutralize(l.what)} [checked: ${neutralize(l.checked)}]`)
    )
  }
  if (report.merged.length > 0) {
    lines.push('Merged, not deployed:', ...report.merged.map((m) => `- ${neutralize(m)}`))
  }
  if (report.proposed.length > 0) {
    lines.push('Proposed or not built:', ...report.proposed.map((p) => `- ${neutralize(p)}`))
  }
  if (report.questions.length > 0) {
    lines.push('Questions for the maker:', ...report.questions.map((q) => `- ${neutralize(q)}`))
  }
  lines.push('</report>')
  return lines.join('\n')
}

// Walk from the newest report to the oldest, keeping each while the rendered
// total stays within the cap; stop at the first that does not fit, so only
// older reports are left out. The newest is always kept, even alone over the
// cap. `liveBriefVersion` only adds the stale line to the measured length.
export function selectReportsForPrep(
  reports: BuildReport[],
  cap = REPORTS_PREP_CAP,
  liveBriefVersion = 0
): { shown: BuildReport[]; leftOut: number } {
  // ISO timestamps sort as strings. Newest first for the walk.
  const newestFirst = [...reports].sort((a, b) => b.posted_at.localeCompare(a.posted_at))
  const shown: BuildReport[] = []
  let total = 0
  for (const report of newestFirst) {
    const length = renderReport(report, liveBriefVersion).length
    if (shown.length > 0 && total + length > cap) break
    shown.push(report)
    total += length
  }
  return { shown: shown.reverse(), leftOut: reports.length - shown.length }
}

// The whole <build_status>…</build_status> block for the prep.
export function renderBuildStatusBlock({
  reports,
  latestPostedAt,
  liveBriefVersion,
}: {
  reports: BuildReport[]
  // When the newest report was posted, folded or not (null when there is none).
  latestPostedAt: string | null
  liveBriefVersion: number
}): string {
  if (reports.length === 0) {
    const latest = latestPostedAt ? ` The latest was ${pacificDay(latestPostedAt)}.` : ''
    return `<build_status>\nNo new build report since the brief was last curated.${latest}\n</build_status>`
  }
  const { shown, leftOut } = selectReportsForPrep(reports, REPORTS_PREP_CAP, liveBriefVersion)
  const parts: string[] = []
  if (leftOut > 0) {
    parts.push(
      `${leftOut} older report${leftOut === 1 ? '' : 's'} left out for length; this paste folds them too.`
    )
  }
  parts.push(shown.map((r) => renderReport(r, liveBriefVersion)).join('\n\n'))
  return `<build_status>\n${parts.join('\n')}\n</build_status>`
}
