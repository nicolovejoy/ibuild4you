// Enrich project docs with last activity, session count, and brief metadata.
//
// Per project: 1 sessions query (narrowed with .select) + at most 2 message
// queries (limit 1 each) + 1 brief query. Was: 1 + (10 reads × N chunks) + 1.
// For typical projects with <30 sessions this is 4 reads instead of ~12.
//
// Lives in lib/ (not the route file) so it can be exported for read-budget
// tests — Next.js Route files only allow HTTP method exports.
export async function enrichProjects(
  db: FirebaseFirestore.Firestore,
  projectDocs: { id: string; [key: string]: unknown }[],
  viewerRoles?: Map<string, string> // project_id → role
) {
  return Promise.all(
    projectDocs.map(async (project) => {
      // Sessions: only status + created_at — payload stays small, reads still N.
      const sessionsSnap = await db
        .collection('sessions')
        .where('project_id', '==', project.id)
        .select('status', 'created_at')
        .get()

      const sessionIds = sessionsSnap.docs.map((d) => d.id)
      const firstChunk = sessionIds.slice(0, 30) // 'in' supports up to 30

      let lastMessageAt: string | null = null
      let lastMessageBy: string | null = null
      let lastMakerMessageAt: string | null = null

      if (firstChunk.length > 0) {
        const requesterEmail = project.requester_email as string | undefined

        // Most recent message across all sessions.
        const lastAnyPromise = db
          .collection('messages')
          .where('session_id', 'in', firstChunk)
          .orderBy('created_at', 'desc')
          .limit(1)
          .get()

        // Most recent maker message — needs the composite index. If the index
        // hasn't been deployed yet, Firestore returns FAILED_PRECONDITION (9)
        // and we skip this field rather than 500 the whole list.
        const lastMakerPromise = requesterEmail
          ? db
              .collection('messages')
              .where('session_id', 'in', firstChunk)
              .where('role', '==', 'user')
              .where('sender_email', '==', requesterEmail)
              .orderBy('created_at', 'desc')
              .limit(1)
              .get()
              .catch((err: unknown) => {
                const code = (err as { code?: number } | null)?.code
                if (code === 9) {
                  console.warn('[enrichProjects] last_maker_message_at composite index missing')
                  return null
                }
                throw err
              })
          : Promise.resolve(null)

        const [lastAnySnap, lastMakerSnap] = await Promise.all([
          lastAnyPromise,
          lastMakerPromise,
        ])

        if (!lastAnySnap.empty) {
          const msg = lastAnySnap.docs[0].data()
          lastMessageAt = msg.created_at as string
          lastMessageBy = msg.role === 'user'
            ? (msg.sender_email as string) || null
            : 'agent'
        }
        if (lastMakerSnap && !lastMakerSnap.empty) {
          lastMakerMessageAt = lastMakerSnap.docs[0].data().created_at as string
        }
      }

      // Latest brief — single doc.
      const briefSnap = await db
        .collection('briefs')
        .where('project_id', '==', project.id)
        .orderBy('version', 'desc')
        .limit(1)
        .get()

      let briefVersion: number | null = null
      let briefDecisionCount: number | null = null
      let briefFeatureCount: number | null = null
      if (!briefSnap.empty) {
        const briefData = briefSnap.docs[0].data()
        briefVersion = (briefData.version as number) || null
        const content = briefData.content as { decisions?: unknown[]; features?: unknown[] } | undefined
        briefDecisionCount = Array.isArray(content?.decisions) ? content.decisions.length : 0
        briefFeatureCount = Array.isArray(content?.features) ? content.features.length : 0
      }

      // Derived from the sessions snapshot.
      let latestSessionCreatedAt: string | null = null
      let hasActiveSession = false
      for (const doc of sessionsSnap.docs) {
        const data = doc.data()
        const createdAt = data.created_at as string
        if (!latestSessionCreatedAt || createdAt > latestSessionCreatedAt) {
          latestSessionCreatedAt = createdAt
        }
        if (data.status === 'active') hasActiveSession = true
      }

      return {
        ...project,
        session_count: sessionsSnap.size,
        last_message_at: lastMessageAt,
        last_message_by: lastMessageBy,
        last_maker_message_at: lastMakerMessageAt,
        latest_session_created_at: latestSessionCreatedAt,
        brief_version: briefVersion,
        brief_decision_count: briefDecisionCount,
        brief_feature_count: briefFeatureCount,
        viewer_role: viewerRoles?.get(project.id) ?? null,
        has_active_session: hasActiveSession,
      }
    })
  )
}
