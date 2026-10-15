import { cache } from 'react'
import { getAdminDb } from '@/lib/firebase/admin'

// Server-only lookup for a brief's public link preview. Used by the per-brief
// layout's generateMetadata and its opengraph-image route.
//
// ⚠️ Both callers are UNAUTHENTICATED (link scrapers). Return only what a
// preview may show: the title (subject to hide_title_in_previews), language,
// and a session count. Never names, emails or brief contents.

export interface BriefPreview {
  id: string
  title: string | undefined
  language: unknown
  hideTitle: boolean
  sessionCount: number
}

/** Resolve a slug-or-id route param. Null when not found. */
async function lookupBriefPreview(slugOrId: string, opts: { withSessionCount?: boolean } = {}): Promise<BriefPreview | null> {
  const db = getAdminDb()
  let doc: FirebaseFirestore.DocumentSnapshot | null = null
  const bySlug = await db.collection('projects').where('slug', '==', slugOrId).limit(1).get()
  if (!bySlug.empty) {
    doc = bySlug.docs[0]
  } else {
    const byId = await db.collection('projects').doc(slugOrId).get()
    if (byId.exists) doc = byId
  }
  if (!doc) return null

  const data = doc.data() || {}
  let sessionCount = 0
  if (opts.withSessionCount) {
    const sessions = await db.collection('sessions').where('project_id', '==', doc.id).select().get()
    sessionCount = sessions.size
  }
  return {
    id: doc.id,
    title: typeof data.title === 'string' ? data.title : undefined,
    language: data.language,
    hideTitle: data.hide_title_in_previews === true,
    sessionCount,
  }
}

// Deduped per request: the brief layout calls this from both generateMetadata
// and its render.
export const resolveBriefPreview = cache(lookupBriefPreview)
