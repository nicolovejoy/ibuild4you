/**
 * Cron route authorization. Vercel sends `Authorization: Bearer <CRON_SECRET>`.
 *
 * FAILS CLOSED: an unset CRON_SECRET denies every request rather than disabling
 * the check. The previous `if (secret && ...)` shape silently made these routes
 * public whenever the env var went missing — see docs/reliability-hardening-plan.md.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const authHeader = request.headers.get('Authorization')
  return authHeader === `Bearer ${secret}`
}
