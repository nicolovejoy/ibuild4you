// Read-only smoke for Loop's Garm key (Phase B). Lists the delegable apps and
// each app's grant counts by role. Prints no emails and never the key.
//
// Run: GARM_LOOP_KEY=op://dev-secrets/garm-consumer-loop/password op run -- node scripts/garm-loop-smoke.mjs
// (`op run` resolves the op:// reference in the environment variable.)

const base = process.env.GARM_URL || 'https://garm.prompt-labs.org'
const key = process.env.GARM_LOOP_KEY
if (!key) {
  console.error('GARM_LOOP_KEY is not set (run under `op run`, see the header).')
  process.exit(1)
}

async function get(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${key}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  })
  if (res.status !== 200) {
    console.error(`GET ${path.split('?')[0]} -> ${res.status}`)
    process.exit(1)
  }
  return res.json()
}

const { apps } = await get('/gnipahellir/apps')
console.log(`${apps.length} delegable apps`)
for (const app of apps) {
  const { grants } = await get(`/gnipahellir/apps/${encodeURIComponent(app.slug)}/grants`)
  const counts = {}
  for (const g of grants) counts[g.role] = (counts[g.role] || 0) + 1
  const summary = Object.entries(counts).map(([r, n]) => `${r}=${n}`).join(' ') || 'no grants'
  console.log(`${app.slug} (${app.display_name}): ${summary}`)
}
