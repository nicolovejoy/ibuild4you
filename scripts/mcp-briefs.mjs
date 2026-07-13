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
// No write tools exist. The write path (brief edits) rides Nico's Max sub via
// the copy-paste JSON ferry, never the metered API (#84 cost-routing).

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { repoMatches, renderBriefMd, renderSessionMd } from './lib/brief-markdown.mjs'

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
const db = getFirestore()

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
  return { brief, sessions, reviews, files, fileNames }
}

// --- MCP server ---

const server = new McpServer({ name: 'ibuild-briefs', version: '1.0.0' })

const asText = (text) => ({ content: [{ type: 'text', text }] })
const asError = (message) => ({ content: [{ type: 'text', text: message }], isError: true })

server.registerTool(
  'list_briefs',
  {
    title: 'List briefs',
    description:
      `List the ibuild4you briefs for ${REPO}: slug, title, brief version, last update, and conversation count. Use a slug with get_brief or get_conversation.`,
    inputSchema: {},
  },
  async () => {
    const projects = await loadScopedProjects()
    const rows = []
    for (const project of projects.values()) {
      const { brief, sessions } = await loadBriefBundle(project)
      rows.push({
        slug: project.slug || project.id,
        title: project.title,
        brief_version: brief ? brief.version : null,
        updated_at: brief ? brief.updated_at : null,
        conversations: sessions.length,
      })
    }
    rows.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    return asText(JSON.stringify(rows, null, 2))
  }
)

server.registerTool(
  'get_brief',
  {
    title: 'Get brief',
    description:
      'Get the full living brief for one slug as markdown: problem, target users, features, constraints, decisions (with provenance), open risks, and reviewer annotations.',
    inputSchema: { slug: z.string().describe('Brief slug from list_briefs') },
  },
  async ({ slug }) => {
    let project
    try {
      project = await resolveInScope(slug)
    } catch (e) {
      return asError(e.message)
    }
    const { brief, sessions, reviews } = await loadBriefBundle(project)
    return asText(renderBriefMd({ project, brief, sessions, reviews }))
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

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`ibuild-briefs MCP server ready — scoped to ${REPO}`)
