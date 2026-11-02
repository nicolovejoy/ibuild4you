# Per-brief agent model dial (#189) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A builder can pick Sam's model per brief (Default / Sonnet 4.6 / Sonnet 5.5 / Opus 5.5); chat and kickoff use it from the next conversation.

**Architecture:** Project field `model`, snapshotted onto each new session as `agent_model`; `resolveBriefModel` + `resolveChatModel(env, briefModel)` pick the model, `chatModelOptions` shapes the request; Setup-tab dropdown writes it through PATCH.

**Tech Stack:** Next.js API routes, Firebase Admin SDK, Anthropic SDK, vitest, React.

**Spec:** `docs/superpowers/specs/2026-11-02-model-dial-design.md` (includes controller rulings 1-6 — read them; they change the field name on the session).

## Global Constraints

- Allowed values exactly: `claude-sonnet-4-6`, `claude-sonnet-5-5`, `claude-opus-5-5`. Absent/empty/null = Default.
- Precedence: brief's model > `CHAT_MODEL` env > `AGENT_MODEL`.
- Session snapshot field is `agent_model` (`string | null`); `sessions.model` remains the usage record of the model actually used and keeps being written as today.
- Only `app/api/chat/route.ts` and `app/api/chat/kickoff/route.ts` change model selection. Note writer, welcome, prep untouched.
- Request shape and logging (`chatModelOptions`, `logAnthropicCall`, `accumulateSessionUsage`, `sessions.model`) use the resolved model.
- UI labels in `lib/copy.ts`: "Default", "Sonnet 4.6", "Sonnet 5.5", "Opus 5.5"; helper text says a change applies from the next conversation. Builder Setup tab is English only (no French twin).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `lib/build-info.json`.

## Review Focus

- A stored project/session value outside the allowed list (hand-edited doc): chat uses `CHAT_MODEL`/`AGENT_MODEL`, never sends the bad id (Task 1 test).
- Opus 5.5 chosen while `CHAT_MODEL` unset: request has no `temperature`, has `output_config.effort: 'low'` (Task 2 chat test).
- A legacy session with no `agent_model` key: falls back to the project's model (Task 1 test).
- PATCH `model: 'gpt-4'` → 400 and nothing written; PATCH `model: ''` → stored `null` (Task 2 test).
- Setup tab re-opened after save shows the saved choice; choosing Default saves `null` (Task 3 test).

---

### Task 1: Model choices + resolution helpers

**Files:**
- Create: `lib/agent/model-choices.ts`
- Modify: `lib/agent/model-config.ts`
- Test: `lib/agent/__tests__/model-config.test.ts` (extend), `lib/agent/__tests__/model-choices.test.ts` (create)

**Interfaces:**
- Produces (`model-choices.ts`, client-safe, no server imports): `export const BRIEF_MODELS = ['claude-sonnet-4-6', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const`; `export type BriefModel = (typeof BRIEF_MODELS)[number]`; `export function isBriefModel(v: unknown): v is BriefModel`.
- Produces (`model-config.ts`): `resolveChatModel(env = process.env, briefModel?: string | null): string` — `isBriefModel(briefModel)` → it; else trimmed `CHAT_MODEL`; else `AGENT_MODEL`. Existing one-arg calls keep working.
- Produces: `resolveBriefModel(session: Record<string, unknown>, project: Record<string, unknown>): string | null` — if `'agent_model' in session` return it when it is a string else null; otherwise `project.model` when a string else null. (Validation happens in `resolveChatModel`.)

- [ ] **Step 1: Failing tests:** `isBriefModel` true for each of the three ids, false for `''`, `null`, `'claude-opus-4-8'`, `'CLAUDE-SONNET-5-5'`. `resolveChatModel({}, 'claude-opus-5-5')` → `'claude-opus-5-5'`; `resolveChatModel({ CHAT_MODEL: 'claude-sonnet-5-5' }, 'claude-sonnet-4-6')` → `'claude-sonnet-4-6'`; `resolveChatModel({ CHAT_MODEL: 'claude-sonnet-5-5' }, null)` → `'claude-sonnet-5-5'`; `resolveChatModel({ CHAT_MODEL: 'claude-sonnet-5-5' }, 'gpt-4')` → `'claude-sonnet-5-5'`; `resolveChatModel({}, undefined)` → `AGENT_MODEL`. `resolveBriefModel({ agent_model: null }, { model: 'claude-opus-5-5' })` → `null`; `({ agent_model: 'claude-sonnet-4-6' }, { model: 'claude-opus-5-5' })` → `'claude-sonnet-4-6'`; `({}, { model: 'claude-opus-5-5' })` → `'claude-opus-5-5'`; `({}, {})` → `null`. `chatModelOptions('claude-opus-5-5')` has `output_config.effort === 'low'` and no `temperature`; `chatModelOptions('claude-sonnet-4-6')` has `temperature`.
- [ ] **Step 2: Run** `npx vitest run lib/agent/__tests__/model-config.test.ts lib/agent/__tests__/model-choices.test.ts` — FAIL.
- [ ] **Step 3: Implement**; update the header comment of `resolveChatModel` to state the precedence.
- [ ] **Step 4: Run** the same — PASS.
- [ ] **Step 5: Commit** `feat(agent): per-brief model choices and resolution (#189)`.

### Task 2: API — store, validate, snapshot, use

**Files:**
- Modify: `lib/types/index.ts` (`Project.model?: string | null`; `Session.agent_model?: string | null` with a comment distinguishing it from the usage field `model`)
- Modify: `app/api/projects/route.ts` (POST validation + first-session snapshot; PATCH allowed list + validation)
- Modify: `app/api/sessions/route.ts` (snapshot)
- Modify: `lib/sessions/apply-import.ts` (re-snapshot)
- Modify: `app/api/chat/route.ts`, `app/api/chat/kickoff/route.ts` (`resolveChatModel(process.env, resolveBriefModel(sessionData, projectData))`)
- Test: existing route tests under `app/api/projects/__tests__/`, `app/api/sessions/__tests__/`, `lib/sessions/__tests__/`, `app/api/chat/__tests__/chat.test.ts`, `app/api/chat/kickoff/__tests__/kickoff.test.ts` (find the files that already test these paths and extend them)

**Interfaces:**
- Consumes: `isBriefModel`, `resolveBriefModel`, `resolveChatModel(env, briefModel)` from Task 1.
- Produces: `projects.model` (`BriefModel | null`, absent on old docs); `sessions.agent_model` (`BriefModel | null`, always written on sessions created after this change).

- [ ] **Step 1: Failing tests:** POST with `model: 'claude-opus-5-5'` stores it and the first session gets `agent_model: 'claude-opus-5-5'`; POST without `model` → no project `model`, first session `agent_model: null`; POST `model: 'gpt-4'` → 400 `model must be one of: claude-sonnet-4-6, claude-sonnet-5-5, claude-opus-5-5`; PATCH `model: 'claude-sonnet-4-6'` stored; PATCH `model: ''` and `model: null` → stored `null`; PATCH `model: 'gpt-4'` → 400, no update call; sessions POST snapshots `agent_model` from the project (`null` when absent); apply-import writes `agent_model` onto the active session; chat route with session `agent_model: 'claude-opus-5-5'` and `CHAT_MODEL` set to `claude-sonnet-5-5` streams with `model: 'claude-opus-5-5'`, no `temperature`, `output_config.effort: 'low'`, and `sessions.model`/usage log record `claude-opus-5-5`; kickoff likewise; chat with session `agent_model: null` and project `model: 'claude-opus-5-5'` uses `CHAT_MODEL`.
- [ ] **Step 2: Run** the touched test files — FAIL.
- [ ] **Step 3: Implement.** Snapshot sites write `agent_model: isBriefModel(project.model) ? project.model : null` (a small exported helper in `model-choices.ts`, e.g. `briefModelSnapshot(project): BriefModel | null`, avoids repeating that at three sites — add it to Task 1's module with its own test). Validation error text exactly as in Step 1.
- [ ] **Step 4: Run** touched tests — PASS; then `npm test` once.
- [ ] **Step 5: Commit** `feat(agent): choose Sam's model per brief in chat and kickoff (#189)`.

### Task 3: Setup-tab dropdown, copy, CLAUDE.md

**Files:**
- Modify: `components/builder/BuilderProjectView.tsx` (`AgentConfigCard`: state, reset effect, select, save)
- Modify: `lib/copy.ts` (new `agentModel` section)
- Modify: `lib/query/hooks.ts` (`useUpdateProject` input: `model?: string | null`)
- Modify: `CLAUDE.md` (Create JSON example gains `"model": "claude-sonnet-5-5"`; a short note after the `language` paragraph: allowed values, Default, brief > `CHAT_MODEL` > `AGENT_MODEL`, chat + kickoff only, applies from the next conversation, snapshot field `agent_model`; PATCH accepted-fields list gains `model` (allowed ids, `''`/null = Default, else 400); the `CHAT_MODEL` env entry notes a brief's `model` overrides it)
- Test: `components/builder/__tests__/AgentModelSelect.test.tsx` if the select is extracted as a small exported component `AgentModelSelect({ value, onChange })` in `components/builder/AgentModelSelect.tsx` (recommended: `BuilderProjectView.tsx` is very large and has no AgentConfigCard test)

**Interfaces:**
- Consumes: `BRIEF_MODELS`, `BriefModel` from Task 1; PATCH `model` from Task 2.
- Copy keys (exact text) `copy.agentModel`: `label: 'Agent model'`, `default: 'Default'`, `options: { 'claude-sonnet-4-6': 'Sonnet 4.6', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5' }`, `help: 'Which model Sam talks with on this brief. A change applies from the next conversation. Default follows the app-wide setting.'`.

- [ ] **Step 1: Failing test** (jsdom): `AgentModelSelect` renders four options in order Default, Sonnet 4.6, Sonnet 5.5, Opus 5.5 with values `''` and the three ids; `value=''` selects Default; changing to Opus calls `onChange('claude-opus-5-5')`; changing to Default calls `onChange('')`; the help text is rendered.
- [ ] **Step 2: Run** `npx vitest run components/builder/__tests__/AgentModelSelect.test.tsx` — FAIL.
- [ ] **Step 3: Implement** the component and wire it into `AgentConfigCard` next to the Maker's language control: state `model` from `project.model || ''`, reset in the existing effect (add `project.model` to deps), save sends `model: model || null`.
- [ ] **Step 4: Run** the test — PASS; `npm test` once.
- [ ] **Step 5: Commit** `feat(builder): Setup-tab model dropdown; document model in CLAUDE.md (#189)`.
