import { RequireSignIn } from '@/components/dashboard/RequireSignIn'
import { PayloadDoc } from '@/components/payload-doc'

// Annotated descriptor for the "next-convo" payload — the JSON you paste into a
// project's Brief tab to update its brief and steer the next session. Mirrors
// the schema in lib/agent/next-convo-prompt.ts (keep in sync).
const NEXT_CONVO_PAYLOAD = `{
  "_payload_type": "next-convo",
  "_prep_stamp": { "brief_version": 7, "note_ids": ["noteId1", "noteId2"] },
  "brief": {
    "problem": "What problem the user is trying to solve",
    "target_users": "Who the intended users are",
    "features": ["Feature 1", "Feature 2"],
    "constraints": "Any constraints, limitations, or things the user explicitly doesn't want",
    "additional_context": "Anything else that doesn't fit the categories above",
    "decisions": [{ "topic": "short label", "decision": "what was decided" }],
    "open_risks": ["plain-language description of something unresolved, unclear, or risky", { "text": "a risk only one side can settle", "owner": "maker" }],
    "shipped": [{ "date": "YYYY-MM-DD", "items": ["what went out in this batch"] }],
    "queued": ["what is next and not built yet"]
  },
  "welcome_message": "Posted word for word as the agent's first message when the maker opens the next session. Omit it to let the agent greet them itself.",
  "nudge_message": "Optional. Verbatim outbound nudge text used to invite the maker back. Omit to let the system auto-draft.",
  "voice_sample": "Optional. One paragraph showing how the builder texts this person by hand — anchors AI-generated outbound copy.",
  "identity": "Optional. Custom agent persona override. Omit unless you want a non-default persona.",
  "context": "Optional. Background the agent uses to skip basic discovery questions. Update only if new background surfaced.",
  "session_mode": "discover (broad exploration) or converge (narrow toward decisions).",
  "seed_questions": ["Questions the agent should weave into the early part of the next session (discover mode only)"],
  "builder_directives": ["Instructions injected into the agent's system prompt — e.g. 'push toward a decision on auth flow' (converge mode only; put always-on guardrails in context)"]
}`

const NOTES = [
  'Paste this into the Brief tab inside an existing project (not the Dashboard’s Import JSON modal).',
  '"_payload_type" must be the first key. Do NOT include title, requester_email, or maker names — those are create-only fields.',
  '"_prep_stamp" is copied back unchanged from the next-convo prep, so the paste folds exactly the notes that prep carried (hand-written JSON leaves it out).',
  'Include the "brief" object to save a new brief revision; the other fields update the project and steer the next session.',
  'Only include fields the conversation actually addressed — omit the rest rather than inventing them.',
  'session_opener is accepted as a legacy alias for welcome_message — prefer welcome_message.',
  'shipped is dated batches of what has gone out; queued is what is next and not yet built. additional_context stays for background that is neither.',
  'Preserve prior brief content and decisions unless the conversation explicitly contradicts or reverses them.',
]

export default function NextConversationPayloadPage() {
  return (
    <RequireSignIn>
      <PayloadDoc
        title="Starting the next conversation"
        endpoint="PATCH /api/projects + new brief revision"
        intro="The payload that updates an existing brief and shapes the maker's next session — what the agent opens with, what to focus on, and any new decisions. Paste it into the project's Brief tab. Field values below describe what each field is for — replace them with real content."
        json={NEXT_CONVO_PAYLOAD}
        notes={NOTES}
      />
    </RequireSignIn>
  )
}
