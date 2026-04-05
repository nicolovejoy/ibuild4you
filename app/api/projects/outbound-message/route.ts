import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
} from '@/lib/api/firebase-server-helpers'
import { generateInviteMessage, generateNudgeMessage, generateReminderMessage } from '@/lib/agent/outbound-messages'
import type { BriefContent } from '@/lib/types'

// POST /api/projects/outbound-message — generate a contextual invite/nudge/reminder (builder+)
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id, type } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }
  if (!['invite', 'nudge', 'reminder'].includes(type)) {
    return NextResponse.json({ error: 'type must be invite, nudge, or reminder' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, project_id, auth.uid, auth.email, auth.systemRoles)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const projectDoc = await db.collection('projects').doc(project_id).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const projectData = projectDoc.data()!
  const projectTitle = projectData.title as string
  const projectContext = (projectData.context as string) || null
  const makerFirstName = (projectData.requester_first_name as string) || null
  const identity = (projectData.identity as string) || null

  try {
    let message: string

    if (type === 'invite') {
      message = await generateInviteMessage({
        projectTitle,
        projectContext,
        makerFirstName,
        seedQuestions: (body.seed_questions ?? projectData.seed_questions) as string[] | undefined,
        sessionMode: (body.session_mode ?? projectData.session_mode) as 'discover' | 'converge' | undefined,
      })
    } else if (type === 'nudge') {
      // Fetch brief for summary and open risks
      let briefSummary: string | null = null
      let openRisks: string[] = []
      const briefSnap = await db
        .collection('briefs')
        .where('project_id', '==', project_id)
        .orderBy('version', 'desc')
        .limit(1)
        .get()
      if (!briefSnap.empty) {
        const brief = briefSnap.docs[0].data().content as BriefContent
        const parts: string[] = []
        if (brief.problem) parts.push(brief.problem)
        if (brief.features?.length) parts.push(`Features: ${brief.features.join(', ')}`)
        if (parts.length) briefSummary = parts.join('. ')
        openRisks = brief.open_risks || []
      }

      message = await generateNudgeMessage({
        projectTitle,
        projectContext,
        makerFirstName,
        sessionMode: (body.session_mode ?? projectData.session_mode) as 'discover' | 'converge' | undefined,
        directives: (body.directives ?? projectData.builder_directives) as string[] | undefined,
        seedQuestions: (body.seed_questions ?? projectData.seed_questions) as string[] | undefined,
        builderNote: (body.nudge_note as string) || null,
        sessionNumber: (body.session_number as number) || 2,
        briefSummary,
        openRisks,
      })
    } else {
      message = await generateReminderMessage({
        projectTitle,
        projectContext,
        makerFirstName,
        sharedAt: (projectData.shared_at as string) || null,
      })
    }

    return NextResponse.json({ message })
  } catch (err) {
    console.error('Outbound message generation error:', err)
    return NextResponse.json({ error: 'Failed to generate message' }, { status: 500 })
  }
}
