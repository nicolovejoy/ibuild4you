import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  getUserDisplayName,
  requireRole,
} from '@/lib/api/firebase-server-helpers'
import { joinNames } from '@/lib/names'
import {
  generatePrepOutbound,
  prepConfigHash,
  type PrepInput,
} from '@/lib/agent/prep-outbound'
import { copy } from '@/lib/copy'
import type { BriefContent } from '@/lib/types'

// POST /api/projects/[id]/prep/generate — builder+. Eager "prep" call that drafts
// the maker nudge body + a one-line builder focus summary for the dispatch card.
// Idempotent: if the config fingerprint matches the last generation, returns the
// stored result without paying for another Sonnet call (cost guard). On model
// failure it silently falls back to the static template — never a hard error.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { id: projectId } = await params
  if (!projectId) {
    return NextResponse.json({ error: 'project id is required' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const force = body?.force === true

  const db = getAdminDb()
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const projectDoc = await db.collection('projects').doc(projectId).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const project = projectDoc.data()!

  // Latest brief (content + a change signal for the fingerprint).
  let brief: BriefContent | null = null
  let briefSignal: string | number = ''
  const briefSnap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()
  if (!briefSnap.empty) {
    const d = briefSnap.docs[0].data()
    brief = d.content as BriefContent
    briefSignal = (d.version as number) ?? (d.updated_at as string) ?? ''
  }

  // The nudge fans out to every active maker (#115), so the draft must greet
  // all of them — addressing only the first maker read as a mail-merge bug.
  // Falls back to the legacy requester_first_name on briefs with no member rows.
  const makerSnap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('role', '==', 'maker')
    .get()
  const firstNames: string[] = []
  for (const doc of makerSnap.docs) {
    const d = doc.data()
    if (d.removed_at || !d.email) continue
    const display = await getUserDisplayName(db, (d.user_id as string) || '', d.email as string)
    firstNames.push(display.split(' ')[0])
  }
  const makerNames = firstNames.length
    ? joinNames(firstNames)
    : ((project.requester_first_name as string | undefined) ?? null)

  const input: PrepInput = {
    projectTitle: (project.title as string) || 'your brief',
    makerNames,
    brief,
    sessionMode: (project.session_mode as 'discover' | 'converge' | undefined) ?? 'discover',
    seedQuestions: (project.seed_questions as string[] | undefined) ?? [],
    builderDirectives: (project.builder_directives as string[] | undefined) ?? [],
    welcomeMessage: (project.welcome_message as string | undefined) ?? null,
    voiceSample: (project.voice_sample as string | undefined) ?? null,
  }

  const hash = prepConfigHash({ ...input, briefSignal })

  // Cost guard: nothing changed since the last successful prep → serve stored.
  if (
    !force &&
    project.prep_config_hash === hash &&
    typeof project.prep_nudge === 'string' &&
    typeof project.prep_focus === 'string'
  ) {
    return NextResponse.json({
      focus: project.prep_focus,
      nudge_message: project.prep_nudge,
      cached: true,
    })
  }

  // Last session's messages, for the "where we left off" recap.
  const lastSessionSnap = await db
    .collection('sessions')
    .where('project_id', '==', projectId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .get()
  if (!lastSessionSnap.empty) {
    const msgSnap = await db
      .collection('messages')
      .where('session_id', '==', lastSessionSnap.docs[0].id)
      .orderBy('created_at', 'asc')
      .get()
    input.lastSessionMessages = msgSnap.docs.map((m) => ({
      role: m.data().role as string,
      content: (m.data().content as string) || '',
    }))
  }

  try {
    const result = await generatePrepOutbound(input, { project_id: projectId })
    await projectDoc.ref.update({
      prep_nudge: result.nudge_message,
      prep_focus: result.focus,
      prep_config_hash: hash,
      prep_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    return NextResponse.json({ ...result, cached: false })
  } catch (err) {
    // Silent fallback — never block the builder or send a blank email. Don't store
    // a hash, so a later call retries the model.
    console.log(
      JSON.stringify({
        event: 'prep_generate_fallback',
        project_id: projectId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    const focus = `${input.sessionMode === 'converge' ? 'Converge' : 'Discover'}${
      (input.sessionMode === 'converge' ? input.builderDirectives : input.seedQuestions)?.[0]
        ? ` · ${(input.sessionMode === 'converge' ? input.builderDirectives : input.seedQuestions)![0]}`
        : ''
    }`
    const nudge_message = copy.nudge.bodyText({
      projectTitle: input.projectTitle,
      sessionMode: input.sessionMode,
    })
    return NextResponse.json({ focus, nudge_message, cached: false, fallback: true })
  }
}
