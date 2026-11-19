import { RequireSignIn } from '@/components/dashboard/RequireSignIn'
import { PayloadDoc } from '@/components/payload-doc'

// Annotated descriptor for the "next-convo" payload — the JSON you paste into a
// project's Brief tab to update its brief and steer the next session. Mirrors
// the schema in lib/agent/next-convo-prompt.ts (keep in sync).
const NEXT_CONVO_PAYLOAD = `{
  "_payload_type": "next-convo",
  "_prep_stamp": { "brief_version": 7, "note_ids": ["noteId1", "noteId2"], "report_ids": ["reportId1"] },
  "brief_patch": {
    "problem": "Optional. The whole new text of this field, only if it changed",
    "target_users": "Optional. The whole new text of this field, only if it changed",
    "features": ["A feature to add"],
    "constraints": "Optional. The whole new text of this field, only if it changed",
    "additional_context": "Optional. The whole new text of this field, only if it changed",
    "decisions": [{ "topic": "exact topic of a decision in the brief, or a new short label", "decision": "the decision as it now stands, whole" }],
    "open_risks": ["a new open risk as a plain string", { "text": "a new risk only one side can settle", "owner": "maker" }],
    "shipped": [{ "date": "YYYY-MM-DD", "items": ["what went out in this batch"] }],
    "queued": ["what is newly planned and not built yet"],
    "drop": {
      "decisions": ["topic of a decision no longer in force"],
      "features": ["text of a feature to remove"],
      "open_risks": ["text of a settled risk"],
      "queued": ["text of a queued item that shipped"]
    }
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
  '"_prep_stamp" is copied back unchanged from the next-convo prep, so the paste folds exactly the notes and build reports that prep carried (hand-written JSON leaves it out).',
  'Include "brief_patch" (only what changed) or "brief" (the whole brief, same nine fields, no drop) to save a new brief revision, never both; the other fields update the project and steer the next session.',
  'brief_patch is merged into the live brief; everything it leaves out stays. Every key is optional, and {} means the round changed nothing in the brief (the notes still fold).',
  'Merge rules: a text field (problem, target_users, constraints, additional_context) takes the whole new text, and an empty string does nothing. A decision is matched by topic (case, punctuation and spacing are ignored; copy topics as shown): a known topic is replaced, a new one is added. features, open_risks, queued and shipped add; an entry already there is not added twice (a shipped item already in any batch is skipped), and a new shipped item joins the batch with the same date. An open risk that matches one in the brief keeps the brief’s text and can only change its owner.',
  'drop removes decisions by topic and features, open_risks and queued by text. To reword a feature or a risk, drop the old text and add the new one. Texts are matched the same way: ignoring case, punctuation and spacing, so copy them as shown. A patch cannot remove or merge shipped batches or clear a text field; send a whole "brief" for that.',
  'Refused, and nothing is imported: a drop that matches nothing (the Brief tab names it), "brief" and "brief_patch" together, and a "brief_patch" for a project with no brief yet (the first brief is a whole one).',
  'A locked decision is never changed by a patch: do not include one. A restatement or drop aimed at a locked topic is ignored, the lock stays as it is, and the Brief tab says so.',
  'Only include fields the conversation actually addressed — omit the rest rather than inventing them.',
  'session_opener is accepted as a legacy alias for welcome_message — prefer welcome_message.',
  'shipped is dated batches of what has gone out; queued is what is next and not yet built. additional_context stays for background that is neither.',
  'Preserve prior brief content and decisions unless the conversation explicitly contradicts or reverses them. In a whole "brief", anything left out is gone.',
  'The prep asks for a whole "brief" when the brief is over 20,000 characters or has no content yet, or when the builder asks for a compaction; otherwise a "brief_patch".',
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
