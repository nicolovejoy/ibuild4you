import type { Firestore } from 'firebase-admin/firestore'
import type { App } from '@/lib/types'

// =============================================================================
// Loop apps. An app is a host site that embeds the feedback widget. Doc id ==
// slug. `legacy_slugs` lets a widget keep posting an old id (e.g. a brief slug)
// and still resolve to the app. Slugs are unique across every canonical slug
// and every legacy slug.
// =============================================================================

export const APP_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const APP_SLUG_MAX = 64

export function isValidAppSlug(s: string): boolean {
  return s.length <= APP_SLUG_MAX && APP_SLUG_RE.test(s)
}

export class AppSlugInvalid extends Error {
  constructor(slug: string) {
    super(`Invalid app slug: ${slug}`)
    this.name = 'AppSlugInvalid'
  }
}

export class AppSlugTaken extends Error {
  constructor(slug: string) {
    super(`App slug already in use: ${slug}`)
    this.name = 'AppSlugTaken'
  }
}

// Find an app by canonical slug first, then by legacy slug.
export async function findAppBySlug(db: Firestore, slugOrLegacy: string): Promise<App | null> {
  const direct = await db.collection('apps').doc(slugOrLegacy).get()
  if (direct.exists) return { id: direct.id, ...(direct.data() as Omit<App, 'id'>) }

  const legacy = await db
    .collection('apps')
    .where('legacy_slugs', 'array-contains', slugOrLegacy)
    .limit(1)
    .get()
  if (legacy.empty) return null
  const doc = legacy.docs[0]
  return { id: doc.id, ...(doc.data() as Omit<App, 'id'>) }
}

// True when the slug is any app's canonical slug or appears in any legacy_slugs.
export async function isSlugTaken(db: Firestore, slug: string): Promise<boolean> {
  return (await findAppBySlug(db, slug)) !== null
}

export async function createApp(
  db: Firestore,
  input: {
    slug: string
    name: string
    created_by: string
    github_repo?: string
    feedback_requires_identity?: boolean
    brief_id?: string | null
    legacy_slugs?: string[]
  }
): Promise<App> {
  const { slug } = input
  // De-duplicate so an app never lists the same legacy slug twice.
  const legacy_slugs = input.legacy_slugs ? [...new Set(input.legacy_slugs)] : undefined
  if (!isValidAppSlug(slug)) throw new AppSlugInvalid(slug)
  for (const legacy of legacy_slugs ?? []) {
    if (!isValidAppSlug(legacy)) throw new AppSlugInvalid(legacy)
    // An app can't list its own slug as legacy, nor one another app already holds.
    if (legacy === slug || (await isSlugTaken(db, legacy))) throw new AppSlugTaken(legacy)
  }
  if (await isSlugTaken(db, slug)) throw new AppSlugTaken(slug)

  const now = new Date().toISOString()
  const data: Omit<App, 'id'> = {
    slug,
    name: input.name,
    created_by: input.created_by,
    created_at: now,
    updated_at: now,
  }
  // Firestore rejects undefined values, so only set optional fields that were given.
  if (input.github_repo !== undefined) data.github_repo = input.github_repo
  if (input.feedback_requires_identity !== undefined)
    data.feedback_requires_identity = input.feedback_requires_identity
  if (input.brief_id !== undefined) data.brief_id = input.brief_id
  if (legacy_slugs !== undefined) data.legacy_slugs = legacy_slugs

  // create() fails if the doc exists, so two concurrent creates of one slug
  // can't both succeed (the isSlugTaken check above is only a fast path).
  try {
    await db.collection('apps').doc(slug).create(data)
  } catch (err) {
    if ((err as { code?: number }).code === 6) throw new AppSlugTaken(slug) // ALREADY_EXISTS
    throw err
  }
  return { id: slug, ...data }
}
