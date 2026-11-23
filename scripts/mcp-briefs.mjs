#!/usr/bin/env node
// Read-only MCP server exposing ibuild4you briefs + transcripts to an external
// agent (e.g. a Claude Code session in a consumer repo). Same data the file-drop
// exporter (export-brief.mjs) produces, same rendering (scripts/lib/brief-markdown.mjs),
// but served on demand instead of dumped to disk.
//
// ALWAYS launch through the read-only wrapper so writes are physically
// impossible (datastore.viewer key), and ALWAYS scope to one repo:
//
//   node scripts/with-prod-env-ro.mjs node scripts/mcp-briefs.mjs --repo nicolovejoy/byside
//
// --repo is REQUIRED and fail-closed: without it the server refuses to start,
// so an unscoped server can never leak every brief into whatever repo
// registered it. Every project whose github_repo maps to --repo is visible;
// nothing else is. Registered per consumer repo via a checked-in .mcp.json.
//
// The launcher scripts/brief-reader.mjs is the way a build repo starts this
// server (it supplies the credentials through 1Password and passes --repo).
//
// --check prints one line per brief in scope (slug, brief version, last update,
// conversation count, notes not yet folded into the brief), then one line saying
// whether a build status key is present (never the key), and exits 0 without
// starting the server. A quick way to confirm the scope and credentials work.
//
// Firestore is read-only. The one write tool, post_build_status, never touches
// Firestore: it posts a build status report to the app (POST /api/build-status,
// base from --status-base, default https://ibuild4you.com) with the repo's own
// status key, which can add a report and nothing else. The launcher passes that
// key (or the reason there is none) as BUILD_STATUS_KEY / BUILD_STATUS_KEY_REASON
// at run time; this server reads both and removes them from the environment.
// Brief edits still ride Nico's Max sub via the copy-paste JSON ferry, never
// the metered API (#84 cost-routing).

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { repoMatches, renderBriefMd, renderSessionMd, unfoldedNotes } from './lib/brief-markdown.mjs'
import { noKeyMessage, postBuildStatus, validStatusBase } from './lib/build-status-post.mjs'

const argv = process.argv.slice(2)
const flagValue = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const REPO = flagValue('--repo')

// Fail closed: no repo scope → refuse to start (an unscoped server would leak
// every brief into whatever repo registered it).
if (!REPO) {
  console.error('Refusing to start: --repo owner/name is required (fail-closed scope).')
  console.error('Usage: node scripts/with-prod-env-ro.mjs node scripts/mcp-briefs.mjs --repo owner/name')
  process.exit(1)
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (run via scripts/with-prod-env-ro.mjs).')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(sa)) })
delete process.env.FIREBASE_SERVICE_ACCOUNT // the credential object holds the key from here; nothing else needs it in the environment
const db = getFirestore()

// The status key, held in memory only and never printed or returned. Without
// the launcher neither variable is set, which reads as no key. The key rides a
// Bearer header, so a --status-base that is not https (or local http) discards
// it: the reader still starts, and post_build_status says why it cannot post.
const STATUS_BASE = flagValue('--status-base') || 'https://ibuild4you.com'
const STATUS_BASE_OK = validStatusBase(STATUS_BASE)
const STATUS_KEY = STATUS_BASE_OK ? process.env.BUILD_STATUS_KEY || null : null
const STATUS_KEY_REASON = STATUS_BASE_OK
  ? process.env.BUILD_STATUS_KEY_REASON || 'not started through brief-reader.mjs'
  : '--status-base must be https'
delete process.env.BUILD_STATUS_KEY
delete process.env.BUILD_STATUS_KEY_REASON

// --- data access (all single-field queries, sort in memory; no indexes) ---

// Every project whose github_repo maps to the scoped repo. Re-queried per call
// so newly-labelled or renamed briefs show up without a restart.
async function loadScopedProjects() {
  const snap = await db.collection('projects').get()
  const out = new Map() // slug -> { id, ...data }
  for (const d of snap.docs) {
    const data = d.data()
    if (data.github_repo && repoMatches(data.github_repo, REPO)) {
      const slug = data.slug || d.id
      out.set(slug, { id: d.id, ...data })
    }
  }
  return out
}

// Resolve a slug within scope, or throw a caller-facing error. Defense in
// depth: never trust the client to only ask for slugs it owns.
async function resolveInScope(slug) {
  const projects = await loadScopedProjects()
  const project = projects.get(slug)
  if (!project) {
    throw new Error(
      `No brief with slug "${slug}" in ${REPO}. Call list_briefs to see available slugs.`
    )
  }
  return project
}

// Fetch + shape everything the brief renderer needs for one project.
async function loadBriefBundle(project) {
  const [briefSnap, sessionSnap, reviewSnap, fileSnap] = await Promise.all([
    db.collection('briefs').where('project_id', '==', project.id).get(),
    db.collection('sessions').where('project_id', '==', project.id).get(),
    db.collection('reviews').where('project_id', '==', project.id).get(),
    db.collection('files').where('project_id', '==', project.id).get(),
  ])
  const briefs = briefSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  briefs.sort((a, b) => (b.version || 0) - (a.version || 0))
  const brief = briefs[0] || null
  // Match the app + exporter: exclude archived, sort oldest-first.
  const sessions = sessionSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => s.status !== 'archived')
  sessions.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
  const reviews = reviewSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const files = fileSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const fileNames = new Map(files.map((f) => [f.id, f.filename || f.id]))
  // Notes newer than the curated brief. A plain read of the subcollection (no
  // where/orderBy, so no index); unfoldedNotes filters and sorts in memory.
  let notes = []
  if (brief) {
    const noteSnap = await db.collection('briefs').doc(brief.id).collection('notes').get()
    notes = unfoldedNotes(noteSnap.docs.map((d) => ({ id: d.id, ...d.data() })))
  }
  return { brief, sessions, reviews, files, fileNames, notes }
}

// --- MCP server ---

const server = new McpServer({ name: 'ibuild-briefs', version: '1.0.0' })

const asText = (text) => ({ content: [{ type: 'text', text }] })
const asError = (message) => ({ content: [{ type: 'text', text: message }], isError: true })

// slug -> the brief version get_brief last served this session. A report says
// which version it was checked against, so posting needs a get_brief first.
const servedVersion = new Map()

// One row per brief in scope, sorted by title. Shared by list_briefs and --check.
async function listRows() {
  const projects = await loadScopedProjects()
  const rows = []
  for (const project of projects.values()) {
    const { brief, sessions, notes } = await loadBriefBundle(project)
    rows.push({
      slug: project.slug || project.id,
      title: project.title,
      brief_version: brief ? brief.version : null,
      updated_at: brief ? brief.updated_at : null,
      conversations: sessions.length,
      new_notes: notes.length,
    })
  }
  rows.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  return rows
}

server.registerTool(
  'list_briefs',
  {
    title: 'List briefs',
    description:
      `List the ibuild4you briefs for ${REPO}: slug, title, brief version, last update, conversation count, and new_notes (notes written since the brief was last curated; get_brief includes them). Use a slug with get_brief or get_conversation.`,
    inputSchema: {},
  },
  async () => asText(JSON.stringify(await listRows(), null, 2))
)

server.registerTool(
  'get_brief',
  {
    title: 'Get brief',
    description:
      'Get the full living brief for one slug as markdown: problem, target users, features, constraints, decisions (with provenance and any contested lock), open risks, what is shipped and queued, the notes written since the brief was last curated, and reviewer annotations. The notes are newer than the brief: read both.',
    inputSchema: { slug: z.string().describe('Brief slug from list_briefs') },
  },
  async ({ slug }) => {
    let project
    try {
      project = await resolveInScope(slug)
    } catch (e) {
      return asError(e.message)
    }
    const { brief, sessions, reviews, files, notes } = await loadBriefBundle(project)
    servedVersion.set(slug, brief?.version ?? 0)
    return asText(renderBriefMd({ project, brief, sessions, reviews, files, notes }))
  }
)

server.registerTool(
  'get_conversation',
  {
    title: 'Get conversation transcript',
    description:
      'Get the full transcript of conversation N for a slug as markdown (N is 1-based, oldest first, matching the count from list_briefs).',
    inputSchema: {
      slug: z.string().describe('Brief slug from list_briefs'),
      n: z.number().int().positive().describe('1-based conversation number'),
    },
  },
  async ({ slug, n }) => {
    let project
    try {
      project = await resolveInScope(slug)
    } catch (e) {
      return asError(e.message)
    }
    const { sessions, fileNames } = await loadBriefBundle(project)
    const session = sessions[n - 1]
    if (!session) {
      return asError(
        `Conversation ${n} does not exist for "${slug}" (it has ${sessions.length}).`
      )
    }
    const msgSnap = await db.collection('messages').where('session_id', '==', session.id).get()
    const messages = msgSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    messages.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    return asText(
      renderSessionMd({ project, session, n, total: sessions.length, messages, fileNames })
    )
  }
)

server.registerTool(
  'get_artifacts',
  {
    title: 'Get artifacts',
    description:
      'List the files/artifacts attached to a brief (metadata only, no bytes): filename, source, description, url for links, pinned flag, folder, size, type, created date.',
    inputSchema: { slug: z.string().describe('Brief slug from list_briefs') },
  },
  async ({ slug }) => {
    let project
    try {
      project = await resolveInScope(slug)
    } catch (e) {
      return asError(e.message)
    }
    const { files } = await loadBriefBundle(project)
    const artifacts = files
      .map((f) => ({
        filename: f.filename || f.id,
        // #83 additive fields — default sensibly on the current schema.
        source: f.source || 'uploaded',
        description: f.description || null,
        url: f.url || null,
        pinned: f.pinned || false,
        folder: f.folder_id || null,
        size_bytes: f.size_bytes ?? null,
        content_type: f.content_type || null,
        created_at: f.created_at || null,
      }))
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    return asText(JSON.stringify(artifacts, null, 2))
  }
)

// Registered even without a key, so the agent gets a clear "give it to Nico"
// answer instead of a missing tool.
server.registerTool(
  'post_build_status',
  {
    title: 'Post build status',
    description:
      'Post this session\'s build status for one brief to the ibuild4you app, so the comms agent sees it in the next prep without Nico copying it. Report what this session did and found, not the whole state of the repo. Rules: (1) "live" is only for what you checked in production; every live item says what you checked. Merged but not deployed goes in "merged". (2) Proposed or unbuilt work goes in "proposed", never in "live". (3) Put questions only the maker can answer in "questions"; read the brief and notes first so you do not ask one they already answer. (4) Write for the comms agent: plain, short, no file paths the maker would not know. (5) When a live item is something the maker can try, add "try_it" to it: the steps in plain words (where to go, what to tap, what they should see). Only on live items, and only steps you ran yourself: in production, or in an end-to-end test that passed against a production build of the same code. In that second case, say in "checked" that the page itself was not seen in production. Call get_brief for the slug first.',
    inputSchema: {
      slug: z.string().describe('Brief slug from list_briefs'),
      live: z
        .array(z.object({ what: z.string(), checked: z.string(), try_it: z.string().optional() }))
        .optional()
        .describe(
          'What is live in production, each with what you checked. Optional try_it: what the maker can do to try it, in plain words they would use (where to go, what to tap, what they should see)'
        ),
      merged: z.array(z.string()).optional().describe('Merged but not yet deployed'),
      proposed: z.array(z.string()).optional().describe('Proposed or unbuilt work'),
      questions: z.array(z.string()).optional().describe('Questions only the maker can answer'),
    },
  },
  async ({ slug, live, merged, proposed, questions }) => {
    try {
      await resolveInScope(slug)
    } catch (e) {
      return asError(e.message)
    }
    if (!STATUS_KEY) return asError(noKeyMessage(REPO, STATUS_KEY_REASON))
    if (!servedVersion.has(slug)) return asError('Read the brief with get_brief first, then post.')
    const { ok, text } = await postBuildStatus({
      fetch,
      base: STATUS_BASE,
      key: STATUS_KEY,
      repo: REPO,
      slug,
      briefVersion: servedVersion.get(slug),
      report: { live, merged, proposed, questions },
    })
    return ok ? asText(text) : asError(text)
  }
)

// --check: list what is in scope and exit, without serving. Runs after the
// --repo refusal above and before the transport, so stdout stays free for the
// MCP protocol in normal serving mode.
if (argv.includes('--check')) {
  const rows = await listRows()
  if (!rows.length) {
    console.log(`No briefs in scope for ${REPO}.`)
  }
  for (const r of rows) {
    const version = r.brief_version == null ? '—' : r.brief_version
    const updated = r.updated_at || '—'
    console.log(
      `${r.slug}  v${version}  updated ${updated}  conversations ${r.conversations}  new notes ${r.new_notes}`
    )
  }
  console.log(STATUS_KEY ? 'build status key: present' : `build status key: none (${STATUS_KEY_REASON})`)
  process.exit(0)
}

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`ibuild-briefs MCP server ready — scoped to ${REPO}`)
