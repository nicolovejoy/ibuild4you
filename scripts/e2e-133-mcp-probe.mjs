#!/usr/bin/env node
// Live probe for the read-only briefs MCP server (#133). Spawns the server
// through the read-only prod wrapper, scoped to a repo, and drives every tool
// over stdio JSON-RPC — grading the shapes, not the PII. Run from the repo root:
//
//   node scripts/e2e-133-mcp-probe.mjs [--repo nicolovejoy/byside]
//
// It hits real prod data (read-only), so it needs .env.local with
// FIREBASE_SERVICE_ACCOUNT_RO — same as export-brief.mjs.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const repo = process.argv.includes('--repo')
  ? process.argv[process.argv.indexOf('--repo') + 1]
  : 'nicolovejoy/byside'

let pass = 0
let fail = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}
const textOf = (res) => (res.content?.[0]?.text ?? '')

const transport = new StdioClientTransport({
  command: 'node',
  args: [
    'scripts/with-prod-env-ro.mjs',
    'node',
    'scripts/mcp-briefs.mjs',
    '--repo',
    repo,
  ],
})
const client = new Client({ name: 'e2e-133-probe', version: '1.0.0' })

try {
  await client.connect(transport)
  check('connect + initialize', true, `scoped to ${repo}`)

  const tools = (await client.listTools()).tools.map((t) => t.name).sort()
  check(
    'tools/list has the 4 read tools',
    ['get_artifacts', 'get_brief', 'get_conversation', 'list_briefs'].every((t) =>
      tools.includes(t)
    ),
    tools.join(', ')
  )

  const listed = await client.callTool({ name: 'list_briefs', arguments: {} })
  const briefs = JSON.parse(textOf(listed))
  check('list_briefs returns an array', Array.isArray(briefs), `${briefs.length} brief(s)`)
  check(
    'list_briefs rows have slug + title + conversations',
    briefs.length > 0 &&
      briefs.every((b) => typeof b.slug === 'string' && 'title' in b && 'conversations' in b),
    briefs.map((b) => b.slug).join(', ')
  )

  const slug = briefs[0]?.slug
  if (!slug) {
    check('has at least one brief to drill into', false, 'no briefs in scope — cannot continue')
  } else {
    const brief = await client.callTool({ name: 'get_brief', arguments: { slug } })
    const briefMd = textOf(brief)
    check('get_brief returns markdown', briefMd.startsWith('# Brief:'), `${briefMd.length} chars`)

    const nConvos = briefs[0].conversations
    if (nConvos > 0) {
      const convo = await client.callTool({ name: 'get_conversation', arguments: { slug, n: 1 } })
      const convoMd = textOf(convo)
      check(
        'get_conversation(1) returns a transcript',
        convoMd.includes('— conversation 1 of'),
        `${convoMd.length} chars`
      )
      const oob = await client.callTool({
        name: 'get_conversation',
        arguments: { slug, n: 9999 },
      })
      check('get_conversation out-of-range is a clean error', oob.isError === true, textOf(oob))
    } else {
      check('brief has conversations to fetch', false, 'brief has 0 conversations (skipped)')
    }

    const artifacts = await client.callTool({ name: 'get_artifacts', arguments: { slug } })
    const arts = JSON.parse(textOf(artifacts))
    check(
      'get_artifacts returns an array with source defaulted',
      Array.isArray(arts) && arts.every((a) => typeof a.source === 'string'),
      `${arts.length} artifact(s)`
    )

    const bogus = await client.callTool({
      name: 'get_brief',
      arguments: { slug: 'definitely-not-a-real-slug-xyz' },
    })
    check('get_brief on out-of-scope slug is a clean error', bogus.isError === true, textOf(bogus))
  }
} catch (e) {
  check('probe ran without throwing', false, e.message)
} finally {
  await client.close().catch(() => {})
}

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
