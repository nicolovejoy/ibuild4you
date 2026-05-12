// Builds the "new-project" prep prompt.
//
// Used by the Dashboard's "Copy new-project prep" button in the New Project
// modal's Import JSON tab. The receiving Claude returns a "new-project"
// payload (POST /api/projects shape — requires title; includes requester
// fields for create-only side effects like maker membership + email approval).
export function buildNewProjectPrompt(): string {
  return `NEW-PROJECT PREP — output a "new-project" payload to CREATE a new iBuild4you project.
The first key of your JSON output MUST be \`"_payload_type": "new-project"\`.
\`title\` is required. Include \`requester_email\`, \`requester_first_name\`, \`requester_last_name\` if known — these drive maker membership and email approval.

I'm a project builder on iBuild4you setting up a new intake project. Help me think through the setup: who the maker is, what we know about the idea, what the agent's first session should focus on, and any seed questions or directives that would help.

When I say "give me the output", produce ONLY valid JSON matching this schema (no markdown, no code fences). \`_payload_type\` MUST be the first key.

{
  "_payload_type": "new-project",
  "title": "Project name shown in the dashboard (required)",
  "requester_email": "Maker's email. Required to share the project with them later — creates a maker membership and approves the email for sign-in.",
  "requester_first_name": "Maker's first name",
  "requester_last_name": "Maker's last name",
  "context": "Background info the agent uses to skip basic discovery questions. Multi-sentence is fine.",
  "welcome_message": "The greeting the agent sends when the maker opens the project for the first time. Sets tone.",
  "nudge_message": "Optional. Verbatim outbound nudge text used to invite the maker back. Omit to let the system auto-draft.",
  "voice_sample": "Optional. One paragraph showing how the builder texts this person by hand — anchors AI-generated outbound copy.",
  "identity": "Optional. Custom agent persona override. Omit unless the builder explicitly wants a non-default persona.",
  "session_mode": "discover (broad exploration) or converge (narrow toward decisions). Defaults to discover when omitted.",
  "seed_questions": ["Questions the agent should weave into the first session"],
  "builder_directives": ["Instructions injected into the agent's system prompt — e.g. 'do not suggest technologies', 'focus on the ordering workflow'"],
  "layout_mockups": [
    {
      "title": "Strategy name — shown to the maker as a visual wireframe layout",
      "sections": [
        { "type": "hero|text|cta|gallery|form|signup|nav|footer|map|video", "label": "Section label", "description": "What this section does" }
      ]
    }
  ],
  "brief": {
    "problem": "What problem the maker is trying to solve. Omit the brief entirely if not enough is known yet.",
    "target_users": "Who the intended users are",
    "features": ["Feature 1", "Feature 2"],
    "constraints": "Any constraints, limitations, or things the maker explicitly doesn't want",
    "additional_context": "Any other relevant information that doesn't fit the above categories",
    "decisions": [{ "topic": "short label", "decision": "what was decided" }],
    "open_risks": ["plain-language description of something unresolved, unclear, or risky"]
  }
}

Rules:
- Only include top-level fields we've actually discussed. Omit fields with no signal — don't invent a \`nudge_message\` or \`voice_sample\` from thin air.
- \`session_opener\` is accepted as a legacy alias for \`welcome_message\` — prefer \`welcome_message\`.
- \`title\` is required; everything else is optional.
- Omit the entire \`brief\` object if not enough is known to seed it — the agent will discover during the first session.
- Extract brief content ONLY from what we discussed. Do not invent or assume.
- Features should be distinct, actionable items (not vague goals).
- A decision = the builder/maker committed to a specific choice (not just mentioned an option).
- Open risks = things that are unresolved, unclear, or risky. Examples: "no plan for getting first users", "pricing model undecided".`
}
