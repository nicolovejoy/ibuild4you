import { normalizeEmail } from '@/lib/email/normalize'

// =============================================================================
// Garm client for Loop's delegating key (Loop apps, Phase B). SERVER-ONLY.
//
// Loop holds its own Garm consumer key (`GARM_LOOP_KEY`), distinct from the
// sign-in key (`GARM_KEY`, lib/garm.ts). This key is delegating: it can list
// delegable apps and grant/revoke owner and collaborator roles on them, acting
// as any owner named in `actor`. Treat it like an admin credential — never
// import this module from a client component, never log the key or an email.
//
// THE ONE RULE: gate on `allowed` from a /gnipahellir check (`loopCheck`).
// Never authorise by comparing role strings; roles returned by the list
// functions are for display and for choosing which apps to check.
//
// No copy of an admin list lives in this app: nothing here is cached, every
// call asks Garm. Check failures deny (fail closed); list/write failures throw
// a GarmLoopError so the caller can show an honest "Garm is unreachable".
// Garm contract: the garm repo's docs/apps.md ("Delegated endpoints") and
// docs/consuming.md ("Listing an email's grants").
// =============================================================================

export type LoopRole = 'owner' | 'collaborator' | 'viewer'

const TIMEOUT_MS = 2_000

/** `status` is Garm's HTTP status, or null for timeout/network/unconfigured. */
export class GarmLoopError extends Error {
  status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'GarmLoopError'
    this.status = status
  }
}

export function loopGarmConfigured(): boolean {
  return Boolean(process.env.GARM_URL && process.env.GARM_LOOP_KEY)
}

/** A preview deployment with no Loop key wired skips Garm (like the sign-in allowlist). */
export function loopGarmBypassed(): boolean {
  return process.env.VERCEL_ENV === 'preview' && !loopGarmConfigured()
}

// One request to Garm. Returns the parsed JSON body; throws GarmLoopError on
// unconfigured, network/timeout (status null), or any status not in `okStatuses`.
async function garmRequest(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  okStatuses: number[] = [200]
): Promise<unknown> {
  const url = process.env.GARM_URL
  const key = process.env.GARM_LOOP_KEY
  if (!url || !key) throw new GarmLoopError('garm loop not configured', null)

  const headers: Record<string, string> = { authorization: `Bearer ${key}` }
  if (body !== undefined) headers['content-type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // Deliberately not echoing the error: it can carry the URL (and so an email).
    throw new GarmLoopError('garm unreachable', null)
  }
  if (!okStatuses.includes(res.status)) {
    throw new GarmLoopError(`garm returned ${res.status}`, res.status)
  }
  try {
    return await res.json()
  } catch {
    // Write endpoints may answer with an empty body; reads parse defensively below.
    return {}
  }
}

// Pull an array field out of a response body; anything off-shape is an error.
function arrayField(data: unknown, field: string): Record<string, unknown>[] {
  const arr = (data as Record<string, unknown> | null)?.[field]
  if (!Array.isArray(arr)) throw new GarmLoopError('garm response off-shape', null)
  return arr as Record<string, unknown>[]
}

/**
 * Does `email` hold at least `minRole` on app `slug`? True only when Garm says
 * `allowed === true`. Any error (unconfigured, timeout, non-2xx, off-shape)
 * is false; never throws. Never cached.
 */
export async function loopCheck(
  email: string,
  slug: string,
  minRole: 'owner' | 'collaborator'
): Promise<boolean> {
  try {
    const data = await garmRequest('POST', '/gnipahellir', {
      email: normalizeEmail(email),
      project: slug,
      min_role: minRole,
    })
    return (data as { allowed?: unknown } | null)?.allowed === true
  } catch (err) {
    console.warn(
      `[garm-loop] check failed for ${slug} (fail-closed):`,
      err instanceof GarmLoopError ? err.status : 'error'
    )
    return false
  }
}

/** Every project the address holds a grant on (alias-resolved by Garm). */
export async function listGrantsForEmail(
  email: string
): Promise<Array<{ project: string; role: LoopRole }>> {
  const data = await garmRequest(
    'GET',
    `/gnipahellir/grants?email=${encodeURIComponent(normalizeEmail(email))}`
  )
  return arrayField(data, 'grants') as unknown as Array<{ project: string; role: LoopRole }>
}

/** Apps Garm has marked delegable. */
export async function listDelegableApps(): Promise<Array<{ slug: string; display_name: string }>> {
  const data = await garmRequest('GET', '/gnipahellir/apps')
  return arrayField(data, 'apps').map((a) => ({
    slug: String(a.slug),
    display_name: String(a.display_name),
  }))
}

/** An app's active exact-slug grants, every role. 404 throws with status 404. */
export async function listAppGrants(
  slug: string
): Promise<Array<{ email: string; role: LoopRole; created_at: string; created_by: string }>> {
  const data = await garmRequest('GET', `/gnipahellir/apps/${encodeURIComponent(slug)}/grants`)
  return arrayField(data, 'grants') as unknown as Array<{
    email: string
    role: LoopRole
    created_at: string
    created_by: string
  }>
}

/** Register a new delegable app in Garm. 201 resolves; anything else throws. */
export async function createGarmApp(
  actor: string,
  slug: string,
  displayName: string
): Promise<void> {
  await garmRequest(
    'POST',
    '/gnipahellir/apps',
    { actor: normalizeEmail(actor), slug, display_name: displayName },
    [201]
  )
}

/** Grant `role` on an app. 200 resolves; 403/409/etc. throw with that status. */
export async function grantOnApp(
  actor: string,
  slug: string,
  email: string,
  role: 'owner' | 'collaborator'
): Promise<void> {
  await garmRequest('POST', `/gnipahellir/apps/${encodeURIComponent(slug)}/grants`, {
    actor: normalizeEmail(actor),
    email: normalizeEmail(email),
    role,
  })
}

/** Revoke a person's grant on an app. 200 resolves; anything else throws. */
export async function revokeOnApp(actor: string, slug: string, email: string): Promise<void> {
  await garmRequest('DELETE', `/gnipahellir/apps/${encodeURIComponent(slug)}/grants`, {
    actor: normalizeEmail(actor),
    email: normalizeEmail(email),
  })
}
