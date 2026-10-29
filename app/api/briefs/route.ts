import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { upsertBrief } from '@/lib/api/briefs'
import { contestFor, dismissedFor, restoreLocksOnPaste, stampDecisionProvenance, topicKey } from '@/lib/api/brief-merge'
import { carryRiskOwners, normalizeRisks } from '@/lib/brief/risks'
import { foldNotes, listUnfoldedNotes, parsePrepStamp } from '@/lib/api/brief-notes'
import { briefSizeWarning } from '@/lib/agent/brief-size'
import type { BriefContent, BriefNote, BriefSource, PrepStamp } from '@/lib/types'

// GET /api/briefs?project_id=xxx — get the latest brief for a project
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const snapshot = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()

  if (snapshot.empty) {
    return NextResponse.json(null)
  }

  const doc = snapshot.docs[0]
  return NextResponse.json({ id: doc.id, ...doc.data() })
}

// PUT /api/briefs — upsert a brief from pasted JSON (builder+)
export async function PUT(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id, content, source: rawSource, prep_stamp: rawStamp, force } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, project_id, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  // Validate BriefContent shape
  const validationError = validateBriefContent(content)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  // Normalize the content
  const briefContent: BriefContent = {
    problem: typeof content.problem === 'string' ? content.problem : '',
    target_users: typeof content.target_users === 'string' ? content.target_users : '',
    features: Array.isArray(content.features) ? content.features.filter((f: unknown) => typeof f === 'string') : [],
    constraints: typeof content.constraints === 'string' ? content.constraints : '',
    additional_context: typeof content.additional_context === 'string' ? content.additional_context : '',
    decisions: Array.isArray(content.decisions)
      ? content.decisions
          .filter(
            (d: unknown) => d && typeof (d as Record<string, unknown>).topic === 'string' && typeof (d as Record<string, unknown>).decision === 'string'
          )
          .map((d: Record<string, unknown>) => {
            // #197: a contest survives a round-trip only on a locked decision.
            const contested = contestFor(d.locked === true, d.contested)
            const dismissed = dismissedFor(d.locked === true, d.contest_dismissed)
            return {
              topic: d.topic as string,
              decision: d.decision as string,
              // #71: preserve the durable-constraint flag set by the builder.
              ...(d.locked === true && { locked: true }),
              ...(contested && { contested }),
              ...(dismissed && { contest_dismissed: dismissed }),
              // #121: explicit provenance in the payload is honored — an outside
              // agent may know the real origin. Anything else is stamped below.
              ...(typeof d.decided_at === 'string' && { decided_at: d.decided_at }),
              ...((typeof d.decided_in_session === 'string' || d.decided_in_session === null) && {
                decided_in_session: d.decided_in_session as string | null,
              }),
              ...(typeof d.revised_at === 'string' && { revised_at: d.revised_at }),
              ...((typeof d.revised_in_session === 'string' || d.revised_in_session === null) && {
                revised_in_session: d.revised_in_session as string | null,
              }),
            }
          })
      : [],
    open_risks: normalizeRisks(content.open_risks),
  }

  // #194: the Brief tab's Restore re-submits an archived version through this
  // same path so locks and provenance behave as a paste; only 'restore' is
  // accepted from the client — regen/create are server-side sources.
  const source: BriefSource = rawSource === 'restore' ? 'restore' : 'paste'

  // #229: the prep stamp only matters on a paste (a Restore ignores it). A
  // stamp that is present but malformed is refused rather than treated as
  // "no stamp", which would silently skip the guard.
  let stamp: PrepStamp | null = null
  if (source === 'paste' && rawStamp !== undefined && rawStamp !== null) {
    stamp = parsePrepStamp(rawStamp)
    if (!stamp) {
      return NextResponse.json({ error: 'prep_stamp is malformed' }, { status: 400 })
    }
  }

  // The latest stored brief: provenance and risk owners carry forward from
  // it, and the paste guard compares its version with the stamp.
  const prevSnap = await db
    .collection('briefs')
    .where('project_id', '==', project_id)
    .orderBy('version', 'desc')
    .limit(1)
    .get()
  const prevDoc = prevSnap.empty ? null : prevSnap.docs[0]
  const prevContent = prevDoc ? (prevDoc.data().content as BriefContent | undefined) : null
  const liveVersion = prevDoc ? ((prevDoc.data().version as number) || 0) : 0

  // #229 paste guard. Notes the stamp lists are the ones the comms agent saw;
  // any other unfolded note was written after the prep was copied. Stale →
  // 409 and nothing written, unless the builder chose Save anyway (force).
  // Unlisted notes are never folded, forced or not, so Sam and the next prep
  // still see them.
  let listed: BriefNote[] = []
  if (stamp) {
    const unfolded = prevDoc ? await listUnfoldedNotes(db, prevDoc.id) : []
    const stamped = new Set(stamp.note_ids)
    listed = unfolded.filter((n) => stamped.has(n.id))
    const unlisted = unfolded.filter((n) => !stamped.has(n.id))
    const stale = unlisted.length > 0 || liveVersion > stamp.brief_version
    if (stale && force !== true) {
      return NextResponse.json(
        {
          error: 'stale_prep',
          unlisted_notes: unlisted.map((n) => ({ id: n.id, created_at: n.created_at })),
          live_version: liveVersion,
          prep_version: stamp.brief_version,
        },
        { status: 409 }
      )
    }
  }

  // #229 (kept guarantee #71/#197): a stamped paste is the comms agent's
  // rewrite, so it can't drop or reword a lock or change its contest state —
  // the live brief's locks come back verbatim with their contest fields.
  // Unstamped saves (structured editor, Accept/Dismiss, Restore, a raw paste)
  // skip this: their unlock or dismiss is deliberate, and the Brief tab asks
  // before one drops a lock.
  if (stamp) {
    briefContent.decisions = restoreLocksOnPaste(prevContent?.decisions, briefContent.decisions)
  }

  // #121: stamp decision provenance against the latest stored brief. Paste path
  // stamps sessionId null ("decided out-of-band"); carry-forward also restores
  // stamps an outside agent dropped when round-tripping the brief JSON.
  // #229: a new topic a folded note introduced takes that note's session and
  // time instead, and a topic a folded note revised takes it as the revision
  // (notes are oldest first, so the later note wins).
  const originByTopic = new Map<string, { session_id: string | null; at: string }>()
  for (const n of listed) {
    for (const d of n.decisions ?? []) {
      originByTopic.set(topicKey(d), { session_id: n.session_id, at: n.created_at })
    }
  }
  briefContent.decisions = stampDecisionProvenance({
    prev: prevContent?.decisions,
    next: briefContent.decisions ?? [],
    sessionId: null,
    now: new Date().toISOString(),
    originByTopic,
  })

  // #229 Q3: an ownerless risk takes its owner by text match from the stored
  // brief or from a folded note's risks_added (a note wins over the brief).
  briefContent.open_risks = carryRiskOwners(
    [...normalizeRisks(prevContent?.open_risks), ...listed.flatMap((n) => normalizeRisks(n.risks_added))],
    briefContent.open_risks ?? []
  )

  const result = await upsertBrief(db, project_id, briefContent, source)

  // Fold the listed notes now the brief that absorbed them is saved. A fold
  // failure must not turn a saved paste into an error: the notes stay
  // unfolded (Sam still sees them) and the next prep lists them again.
  let folded: string[] = []
  if (stamp && listed.length > 0) {
    const ids = listed.map((n) => n.id)
    try {
      await foldNotes(db, result.id, ids, new Date().toISOString())
      folded = ids
    } catch (err) {
      console.error('[briefs] folding notes failed for brief', result.id, 'notes', ids, err)
    }
  }

  return NextResponse.json({ ...result, folded, size_warning: briefSizeWarning(briefContent) })
}

function validateBriefContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') {
    return 'content must be an object with BriefContent shape'
  }

  const c = content as Record<string, unknown>

  // At least one field should have data
  const hasData =
    (typeof c.problem === 'string' && c.problem.length > 0) ||
    (typeof c.target_users === 'string' && c.target_users.length > 0) ||
    (Array.isArray(c.features) && c.features.length > 0) ||
    (typeof c.constraints === 'string' && c.constraints.length > 0) ||
    (typeof c.additional_context === 'string' && c.additional_context.length > 0) ||
    (Array.isArray(c.decisions) && c.decisions.length > 0)

  if (!hasData) {
    return 'Brief content is empty — at least one field must have data'
  }

  return null
}

