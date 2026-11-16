// The build report a build repo posts back to the app: what is live, merged,
// proposed, and which questions it has. This file is the shape and its
// validation only; storing and serving reports live elsewhere.
import { createHash } from 'node:crypto'

export const REPORT_LIMITS = { itemsPerList: 30, charsPerString: 500, charsTotal: 4000 }

export interface BuildReportBody {
  // Only what was checked in production belongs here; `checked` says how.
  live: { what: string; checked: string }[]
  merged: string[]
  proposed: string[]
  questions: string[]
}

type ValidationResult = { ok: true; report: BuildReportBody } | { ok: false; error: string }

const LIST_NAMES = ['live', 'merged', 'proposed', 'questions'] as const

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

// Checks a report body from a build repo. Strings are trimmed, unknown fields
// are dropped, and a missing list counts as an empty one. Checks run in this
// order: shape, per-item, per-list count, per-string length, total, emptiness.
export function validateReport(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('The report must be an object with the lists live, merged, proposed, questions.')
  }
  const input = raw as Record<string, unknown>

  const report: BuildReportBody = { live: [], merged: [], proposed: [], questions: [] }
  let total = 0
  let itemCount = 0

  for (const name of LIST_NAMES) {
    const value = input[name]
    if (value === undefined || value === null) continue
    if (!Array.isArray(value)) return fail(`${name} must be a list.`)

    // Per-item shape: every string trimmed and non-empty, live items complete.
    const strings: string[] = [] // every string in this list, for the length check
    for (let i = 0; i < value.length; i++) {
      const item: unknown = value[i]
      if (name === 'live') {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          return fail(`live[${i}] must be { "what", "checked" }.`)
        }
        const { what, checked } = item as Record<string, unknown>
        if (typeof what !== 'string' || what.trim() === '') {
          return fail(`live[${i}] must be { "what", "checked" }.`)
        }
        if (typeof checked !== 'string' || checked.trim() === '') {
          return fail(
            `live[${i}] has no "checked". Say what was checked in production, or move it to "merged".`
          )
        }
        report.live.push({ what: what.trim(), checked: checked.trim() })
        strings.push(what.trim(), checked.trim())
      } else {
        if (typeof item !== 'string' || item.trim() === '') {
          return fail(`${name}[${i}] must be a non-empty string.`)
        }
        report[name].push(item.trim())
        strings.push(item.trim())
      }
    }

    if (value.length > REPORT_LIMITS.itemsPerList) {
      return fail(`${name} has ${value.length} items; the limit is ${REPORT_LIMITS.itemsPerList}.`)
    }

    for (let i = 0; i < strings.length; i++) {
      if (strings[i].length > REPORT_LIMITS.charsPerString) {
        // A live item holds two strings (what, checked) per index.
        const index = name === 'live' ? Math.floor(i / 2) : i
        return fail(
          `${name}[${index}] is ${strings[i].length} characters; the limit is ${REPORT_LIMITS.charsPerString}.`
        )
      }
      total += strings[i].length
    }
    itemCount += value.length
  }

  if (total > REPORT_LIMITS.charsTotal) {
    return fail(`The report is ${total} characters; the limit is ${REPORT_LIMITS.charsTotal}.`)
  }
  if (itemCount === 0) {
    return fail('The report is empty. At least one of live, merged, proposed, questions needs an item.')
  }

  return { ok: true, report }
}

// sha256 hex of the validated body, keys in a fixed order, so the same report
// always hashes the same (used to spot a duplicate post).
export function reportBodyHash(report: BuildReportBody): string {
  const ordered = {
    live: report.live.map((item) => ({ what: item.what, checked: item.checked })),
    merged: report.merged,
    proposed: report.proposed,
    questions: report.questions,
  }
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}
