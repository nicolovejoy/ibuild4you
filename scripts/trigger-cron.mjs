/**
 * Manually fire a prod cron endpoint with the CRON_SECRET bearer token.
 *
 * Vercel crons are just GET routes guarded by `Authorization: Bearer $CRON_SECRET`.
 * This lets us trigger one on demand (e.g. to generate a dry-run reminder_log row
 * for /admin/reminders without waiting for the daily 09:00 PT tick) instead of
 * waiting on the schedule. The secret is read from the environment (inject it via
 * scripts/with-prod-env.mjs) and never printed.
 *
 * SAFETY: this hits PRODUCTION. For the maker-reminders cron, real sends are gated
 * by REMINDER_DRY_RUN on Vercel — while that is set, firing this only logs
 * would-send decisions and sends no email.
 *
 * Usage:
 *   node scripts/with-prod-env.mjs node scripts/trigger-cron.mjs maker-reminders
 *   node scripts/with-prod-env.mjs node scripts/trigger-cron.mjs maker-reminders --base https://ibuild4you.com
 */

const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('CRON_SECRET not set. Run via: node scripts/with-prod-env.mjs node scripts/trigger-cron.mjs <cron-name>')
  process.exit(1)
}

const name = process.argv[2]
if (!name) {
  console.error('Usage: node scripts/trigger-cron.mjs <cron-name> [--base <url>]')
  process.exit(1)
}

const baseIdx = process.argv.indexOf('--base')
const base = baseIdx >= 0 ? process.argv[baseIdx + 1] : 'https://ibuild4you.com'
const url = `${base}/api/cron/${name}`

console.log(`Triggering ${url} ...`)
const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } })
const text = await res.text()
console.log(`HTTP ${res.status}`)
console.log(text)
process.exit(res.ok ? 0 : 1)
