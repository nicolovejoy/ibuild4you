// Build reports (return leg), stored at projects/{projectId}/build_reports.
// A report is what a build repo says is live, merged, proposed and still
// unanswered. Reports stay "unfolded" until the builder's curated paste folds
// them into the brief; folded reports are kept with folded_at set, never deleted.

import type { Firestore } from 'firebase-admin/firestore'
import type { BuildReport } from '@/lib/types'
import { isValidNoteId } from '@/lib/api/brief-notes'
import { reportBodyHash, type BuildReportBody } from './report'

// The same body posted again inside this window is a retry, not a new report.
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000

function reportsRef(db: Firestore, projectId: string) {
  return db.collection('projects').doc(projectId).collection('build_reports')
}

// All reports, oldest first.
export async function listReports(db: Firestore, projectId: string): Promise<BuildReport[]> {
  const snap = await reportsRef(db, projectId).orderBy('posted_at', 'asc').get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<BuildReport, 'id'>), id: d.id }))
}

// Filtered in memory, as notes are: a handful of reports per brief, no composite index.
export async function listUnfoldedReports(
  db: Firestore,
  projectId: string
): Promise<BuildReport[]> {
  return (await listReports(db, projectId)).filter((r) => !r.folded_at)
}

// Stores a report, unless it repeats the latest one within the duplicate window.
// Only the latest report is compared, so A, B, A stores all three.
export async function addReport(
  db: Firestore,
  projectId: string,
  input: { repo: string; brief_version_checked: number; report: BuildReportBody },
  now: Date = new Date()
): Promise<{ posted_at: string; duplicate: boolean }> {
  const ref = reportsRef(db, projectId)
  const body_hash = reportBodyHash(input.report)

  // Single-field order inside one subcollection: no composite index.
  const latest = await ref.orderBy('posted_at', 'desc').limit(1).get()
  if (!latest.empty) {
    const last = latest.docs[0].data() as { body_hash?: string; posted_at: string }
    const age = now.getTime() - Date.parse(last.posted_at)
    if (last.body_hash === body_hash && age < DUPLICATE_WINDOW_MS) {
      return { posted_at: last.posted_at, duplicate: true }
    }
  }

  const posted_at = now.toISOString()
  const doc: Omit<BuildReport, 'id'> = {
    repo: input.repo,
    brief_version_checked: input.brief_version_checked,
    live: input.report.live,
    merged: input.report.merged,
    proposed: input.report.proposed,
    questions: input.report.questions,
    body_hash,
    posted_at,
    folded_at: null,
  }
  await ref.add(doc)
  return { posted_at, duplicate: false }
}

// Stamp folded_at on each listed id that exists and is still unfolded.
// Returns the ids it actually folded.
export async function foldReports(
  db: Firestore,
  projectId: string,
  reportIds: string[],
  now: string
): Promise<string[]> {
  const ref = reportsRef(db, projectId)
  const folded: string[] = []
  for (const id of reportIds) {
    if (!isValidNoteId(id)) continue
    const snap = await ref.doc(id).get()
    if (!snap.exists) continue
    if ((snap.data() as { folded_at?: string | null }).folded_at) continue
    await ref.doc(id).update({ folded_at: now })
    folded.push(id)
  }
  return folded
}
