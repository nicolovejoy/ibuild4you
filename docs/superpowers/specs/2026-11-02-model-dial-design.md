# #189 — choose the agent model per brief (design)

Approved by Nico 2026-11-02. Copied from the session spec
(`small-three-spec.md`, "#189") so the reference survives.

- New optional project field `model` (string). Allowed values: `claude-sonnet-4-6`, `claude-sonnet-5-5`, `claude-opus-5-5`. Absent/empty = "Default" (today's behaviour). Validate on create (POST /api/projects) and PATCH (add to the accepted PATCH fields; 400 on any other value).
- Snapshotted into the session at creation like the other agent config fields; readers use `sessionData.model ?? projectData.model` (match how identity/session_mode are read in the chat and kickoff routes).
- Applies only to Sam's chat (`app/api/chat/route.ts`) and kickoff (`app/api/chat/kickoff/route.ts`). Note writer, welcome, prep and any other model use stay as they are.
- Precedence: brief's model > `CHAT_MODEL` env > `AGENT_MODEL`. The per-model request shape (5.x: no temperature, `output_config.effort: low`) must follow the chosen model via the existing `lib/agent/model-config.ts` (`resolveChatModel`, `chatModelOptions`, `acceptsTemperature`). Every selectable model already has a price row in `lib/observability/anthropic-pricing.ts`; logging must record the model actually used.
- UI: a dropdown on the builder Setup tab (find the existing agent config card), labels "Default", "Sonnet 4.6", "Sonnet 5.5", "Opus 5.5" in lib/copy.ts. Helper text: a change applies from the next conversation.
- Update CLAUDE.md: the Create JSON example/notes and the PATCH accepted-fields list mention `model`.

## Controller rulings (2026-11-02)

1. **The session snapshot is stored as `agent_model`, not `model`.** `sessions.model` already exists: the chat and kickoff routes write the model actually used after every turn (usage tracking, shown as "Model: …" on the Conversations tab). Snapshotting the brief's choice into the same field would make every existing session (all of which have `model` from usage) read as pinned to whatever model ran its first turn, and would make a Default session look pinned to the env model of the day. `sessions.model` stays the usage record.
2. **A Default session is pinned to Default.** At creation the snapshot always writes `agent_model: project.model || null` (null = Default). The reader is `resolveBriefModel(session, project)`: if the session has the `agent_model` key, use it (null → Default); only a legacy session without the key falls back to `project.model`. Plain `??` would let a Default session pick up a model chosen mid-conversation, contradicting the "applies from the next conversation" helper text.
3. The re-snapshot on a payload import into an open, unanswered session (`lib/sessions/apply-import.ts`) also refreshes `agent_model`, like the other config fields: that conversation has not really started.
4. PATCH `model: ''` or `model: null` stores `null` (Default). POST stores `model` only when it is a non-empty allowed value; any other non-empty value is a 400. At read time an unknown stored value is ignored (falls through to `CHAT_MODEL`/`AGENT_MODEL`), so a bad doc can never reach the API.
5. `model` is not added to the comms-agent payload schemas (new-project / next-convo prompts, `NEXT_CONVO_IMPORT_FIELDS`) or the payload docs pages: the model is the builder's call in the Setup tab. The create endpoint accepts it (spec), so a hand-written create payload can still set it.
6. The allowed list and its labels live in a client-safe module (`lib/agent/model-choices.ts`), since `model-config.ts` is server-only and the Setup tab needs the list.
