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

// A project holding this many unfolded reports takes no more until the builder
// folds some. A leaked key must not be able to flood a project and push the
// real reports out of the prep's size cap.
export const MAX_UNFOLDED_REPORTS = 50

function reportsRef(db: Firestore, projectId: string) {
  return db.collection('projects').doc(projectId).collection('build_reports')
}

function toReport(d: { id: string; data: () => unknown }): BuildReport {
  return { ...(d.data() as Omit<BuildReport, 'id'>), id: d.id }
}

// All reports, oldest first.
export async function listReports(db: Firestore, projectId: string): Promise<BuildReport[]> {
  const snap = await reportsRef(db, projectId).orderBy('posted_at', 'asc').get()
  return snap.docs.map(toReport)
}

// Unfolded reports, oldest first. Reports are always written with
// folded_at: null, so an equality filter finds them (single field, no
// composite index); the order is applied here in memory.
export async function listUnfoldedReports(
  db: Firestore,
  projectId: string
): Promise<BuildReport[]> {
  const snap = await reportsRef(db, projectId).where('folded_at', '==', null).get()
  return snap.docs.map(toReport).sort((a, b) => a.posted_at.localeCompare(b.posted_at))
}

// posted_at of the newest report, folded or not; null when none was ever posted.
export async function latestReportAt(db: Firestore, projectId: string): Promise<string | null> {
  const snap = await reportsRef(db, projectId).orderBy('posted_at', 'desc').limit(1).get()
  if (snap.empty) return null
  return (snap.docs[0].data() as { posted_at: string }).posted_at
}

// Stores a report, unless it repeats the latest one (same lists and same
// brief_version_checked) within the duplicate window, or the project already
// holds MAX_UNFOLDED_REPORTS unfolded reports (full: true, nothing stored).
// Only the latest report is compared, so A, B, A stores all three.
// The check-then-write is best-effort, not atomic: two posts racing can both store.
export async function addReport(
  db: Firestore,
  projectId: string,
  input: { repo: string; brief_version_checked: number; report: BuildReportBody },
  now: Date = new Date()
): Promise<{ posted_at: string | null; duplicate: boolean; full: boolean }> {
  const ref = reportsRef(db, projectId)
  const body_hash = reportBodyHash(input.report)

  // Single-field order inside one subcollection: no composite index.
  const latest = await ref.orderBy('posted_at', 'desc').limit(1).get()
  if (!latest.empty) {
    const last = latest.docs[0].data() as {
      body_hash?: string
      brief_version_checked?: number
      posted_at: string
    }
    const age = now.getTime() - Date.parse(last.posted_at)
    if (
      last.body_hash === body_hash &&
      last.brief_version_checked === input.brief_version_checked &&
      age < DUPLICATE_WINDOW_MS
    ) {
      return { posted_at: last.posted_at, duplicate: true, full: false }
    }
  }

  const unfolded = await ref.where('folded_at', '==', null).count().get()
  if (unfolded.data().count >= MAX_UNFOLDED_REPORTS) {
    return { posted_at: null, duplicate: false, full: true }
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
  return { posted_at, duplicate: false, full: false }
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
