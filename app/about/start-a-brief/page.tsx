import { PayloadDoc } from '@/components/payload-doc'

// Annotated descriptor for the "new-project" payload — the JSON you paste into
// the Dashboard's "Import JSON" tab to create a project. Mirrors the schema in
// lib/agent/new-project-prompt.ts (keep in sync).
const NEW_PROJECT_PAYLOAD = `{
  "_payload_type": "new-project",
  "title": "Project name shown in the dashboard (required)",
  "requester_email": "Maker's email. Creates a maker membership and approves the email for sign-in.",
  "requester_first_name": "Maker's first name",
  "requester_last_name": "Maker's last name",
  "context": "Background the agent uses to skip basic discovery questions. Multi-sentence is fine.",
  "welcome_message": "The greeting the agent sends when the maker first opens the project. Sets tone.",
  "nudge_message": "Optional. Verbatim outbound nudge text used to invite the maker back. Omit to let the system auto-draft.",
  "voice_sample": "Optional. One paragraph showing how the builder texts this person by hand — anchors AI-generated outbound copy.",
  "identity": "Optional. Custom agent persona override. Omit unless you want a non-default persona.",
  "session_mode": "discover (broad exploration) or converge (narrow toward decisions). Defaults to discover.",
  "seed_questions": ["Questions the agent should weave into the first session"],
  "builder_directives": ["Instructions injected into the agent's system prompt — e.g. 'do not suggest technologies'"],
  "layout_mockups": [
    {
      "title": "Strategy name — shown to the maker as a visual wireframe layout",
      "sections": [
        { "type": "hero|text|cta|gallery|form|signup|nav|footer|map|video", "label": "Section label", "description": "What this section does" }
      ]
    }
  ],
  "brief": {
    "problem": "What problem the maker is trying to solve. Omit the whole brief if not enough is known yet.",
    "target_users": "Who the intended users are",
    "features": ["Feature 1", "Feature 2"],
    "constraints": "Any constraints, limitations, or things the maker explicitly doesn't want",
    "additional_context": "Anything else that doesn't fit the categories above",
    "decisions": [{ "topic": "short label", "decision": "what was decided" }],
    "open_risks": ["plain-language description of something unresolved, unclear, or risky"]
  }
}`

const NOTES = [
  'Only "title" is required. Everything else is optional — omit any field you have no signal for rather than inventing one.',
  '"_payload_type" must be the first key. Paste this into the Dashboard’s "Import JSON" tab (not the Brief tab inside a project).',
  'requester_email, requester_first_name, and requester_last_name are create-only — they spin up the maker’s membership and approve their email for sign-in.',
  'session_opener is accepted as a legacy alias for welcome_message — prefer welcome_message.',
  'Omit the entire "brief" object if not enough is known yet; the agent will discover it during the first session.',
]

export default function StartABriefPayloadPage() {
  return (
    <PayloadDoc
      title="Starting a brief"
      endpoint="POST /api/projects"
      intro="The payload that creates a new project and its first session. Paste it into the Dashboard's Import JSON tab, or POST it directly. Field values below describe what each field is for — replace them with real content."
      json={NEW_PROJECT_PAYLOAD}
      notes={NOTES}
    />
  )
}
