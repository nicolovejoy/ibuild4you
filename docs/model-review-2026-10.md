# Model review, 2026-10 (issue #184)

List-price estimates only, derived from the measured token profile in the changelog (PR #178). Not billed numbers. Prices come from the `claude-api` skill's "Current Models (cached: 2026-10-06)" table and its Opus/Sonnet 5.5 sections. Where the skill gives only input/output, cache read = 0.1x input and cache write = 1.25x input (5-minute TTL), per the skill's Prompt Caching section; those cells are marked (derived).

## 1. Today

- `lib/agent/constants.ts` pins `AGENT_MODEL` and `BRIEF_MODEL` to `claude-sonnet-4-6`. Chat route (`app/api/chat/route.ts`) sends `temperature: AGENT_TEMPERATURE` (0.7), max_tokens 2048. Brief regen (`lib/api/briefs.ts`) sends `temperature: 0.3`, max_tokens 8192, and a forced `tool_choice: { type: 'tool', name: 'update_brief' }`.
- Price table (`lib/observability/anthropic-pricing.ts`) knows only `claude-sonnet-4-6` and `claude-haiku-4-5`. Both rows match the reference ($3/$15 and $1/$5; cache 0.1x / 1.25x). So today's costs are correct.
- It knows NONE of the 5.x models. `calculateCostUsd` returns 0 for an unknown model, so after any switch the admin usage page would show $0.00 for every call. The table must be extended in the same PR as any switch.

## 2. Candidates (all 1M context except Haiku 4.5 at 200K)

- `claude-sonnet-4-6` (current): $3 in / $15 out / $0.30 read / $3.75 write.
- `claude-sonnet-5-5`: $2 / $10 / $0.20 read (stated) / $2.50 write (derived).
- `claude-sonnet-5`: $2 / $10 / $0.20 / $2.50 (derived); superseded by 5.5.
- `claude-haiku-5-5`: $0.10 / $0.50 / $0.01 (derived) / $0.125 (derived); prices apply to prompts up to 100K tokens ($0.50 / $2.50 beyond).
- `claude-haiku-4-5`: $1 / $5 / $0.10 / $1.25 (matches app table); 200K context.
- `claude-opus-5-5`: $4 / $20 / $0.20 read (stated) / $5.00 write (derived).
- `claude-opus-5`, `-4-8`, `-4-7`, `-4-6`: $5 / $25 / $0.50 (derived) / $6.25 (derived).
- `claude-fable-5-1` (and `claude-fable-5`): $10 / $50 / $0.25 read (stated) / $12.50 write (derived). Mythos 5.1 is Project Glasswing only; not available to us.

## 3. Cost per chat turn, estimated

Turn 1 = 24.8k cache-write + 300 uncached in + 400 out. Turn 2+ = 24.8k cache-read + 300 in + 400 out.

- Sonnet 4.6: T1 0.0248x3.75 + 0.0003x3 + 0.0004x15 = $0.0999; T2+ 0.0248x0.30 + 0.0009 + 0.006 = $0.0143.
- Sonnet 5.5: T1 0.0248x2.50 + 0.0003x2 + 0.0004x10 = $0.0666; T2+ 0.0248x0.20 + 0.0006 + 0.004 = $0.0096.
- Haiku 5.5: T1 0.0248x0.125 + 0.0003x0.10 + 0.0004x0.50 = $0.0033; T2+ 0.0248x0.01 + 0.00003 + 0.0002 = $0.0005.
- Haiku 4.5: T1 0.0248x1.25 + 0.0003x1 + 0.0004x5 = $0.0333; T2+ 0.0248x0.10 + 0.0003 + 0.002 = $0.0048.
- Opus 5.5: T1 0.0248x5 + 0.0003x4 + 0.0004x20 = $0.1332; T2+ 0.0248x0.20 + 0.0012 + 0.008 = $0.0142.
- Opus 5 / 4.x: T1 0.0248x6.25 + 0.0003x5 + 0.0004x25 = $0.1665; T2+ 0.0248x0.50 + 0.0015 + 0.01 = $0.0239.
- Fable 5.1: T1 0.0248x12.5 + 0.0003x10 + 0.0004x50 = $0.333; T2+ 0.0248x0.25 + 0.003 + 0.02 = $0.0292.

Reading: Sonnet 5.5 is about 33% cheaper than 4.6 on both a cold and a warm turn. Opus 5.5 warm turns cost about the same as Sonnet 4.6 warm turns (cheap cache reads at $0.20) but cold turns cost about 33% more. Thinking tokens bill as output; Sonnet 5.5 and Opus 5.5 run adaptive thinking by default, so real output could exceed 400 tokens. This is the largest uncertainty in these numbers.

## 4. Cost per brief regeneration, estimated (30k uncached in + 3k out)

- Sonnet 4.6: 0.030x3 + 0.003x15 = $0.135.
- Sonnet 5.5: 0.030x2 + 0.003x10 = $0.090.
- Haiku 5.5: 0.030x0.10 + 0.003x0.50 = $0.0045.
- Haiku 4.5: 0.030x1 + 0.003x5 = $0.045.
- Opus 5.5: 0.030x4 + 0.003x20 = $0.180.
- Opus 5 / 4.x: 0.030x5 + 0.003x25 = $0.225.
- Fable 5.1: 0.030x10 + 0.003x50 = $0.450.

Regen already caches the ~1.5k-token tools+system prefix (briefs.ts), which is below any plausible cache minimum benefit here; the 30k is conversation history and brief, mostly uncached, so these figures are first-order.

## 5. What a switch would break or need re-checking

- Hard breaks on Sonnet 5.5 and Opus 5.5 (skill: "Forced tool use removed", "Sampling ... 400"):
  - Brief regen's `tool_choice: { type: 'tool', name: 'update_brief' }` returns a 400. Needs `auto` + prompt instruction + `strict: true` on the tool, or structured outputs. The code also relies on a tool_use block existing (`regenerate_brief_no_tool_use`), so `auto` adds a new failure mode; the circuit breaker (3 fails) exists but the cost-runaway runbook applies.
  - Non-default `temperature` (0.7 chat, 0.3 regen) returns a 400 on Sonnet 5.5 (and removed on Opus 5.5). Both calls need the parameter dropped; the temperature-based style tuning is lost.
  - Haiku 5.5 also 400s on non-default sampling; forced tool_choice is not listed as removed for it, but verify.
- Thinking: Sonnet 5.5 and Opus 5.5 default to adaptive thinking (Opus 5.5 cannot disable it; Sonnet 5.5 default effort `high`, Opus 5.5 default `medium`). For a chat agent that should answer in a few sentences, set low effort explicitly, watch latency and output tokens. Chat streams over SSE; thinking is omitted from display by default so the first token may be delayed.
- Price table: add every new model id, including cache rows, before the switch.
- Prompt caching: the skill says minimum cacheable prefix is model dependent (512-4096 tokens). The 24.8k system prompt clears any of them; the brief regen ~1.5k system+tools prefix may not on some models. Caches are per model, so a per-project override means separate cache namespaces. Re-run the api_usage check (turn 2 read ~24.8k).
- Posture tuning (`docs/conversational-posture-model.md`, GUARDRAILS and posture rules in `lib/agent/constants.ts`) was tuned on 4.x: challenge vague answers, one question per message, yield after two strikes, no exchange-count closing, no jargon, quick-choice options block. Need side-by-side on real sessions. The skill notes newer models often find older prompts too prescriptive.
- Refusal handling: the skill says to handle `stop_reason: "refusal"` and to add fallbacks for Sonnet 5.5/Opus 5.5; the chat SSE and regen code currently do neither.
- Priority Tier is not available on Sonnet 5.5 / Opus 5.5 (not in use here).

## 6. Recommendation

Trial `claude-sonnet-5-5` for the chat agent (about 33% cheaper per turn at list price, same tier as today), after dropping `temperature` and setting low effort explicitly, behind a per-project override (a `model` field on the project config with `AGENT_MODEL` as the default, or an env var for preview first). Leave brief regeneration on `claude-sonnet-4-6` for now: moving it needs the forced-tool-use rewrite, which touches locked-decision fidelity and the cost-runaway breaker, so do it as a second PR after chat is proven. Gate: land the price-table update first; run 2-3 real sessions on the same briefs side by side on preview; compare the admin usage page (real cost per turn, cache read tokens, output tokens including thinking) before and after, and eyeball posture behavior against the rules above. Haiku 5.5 is roughly 20x cheaper but is a quality bet for a conversation whose value is depth-extraction; consider it only for brief regen later, after Sonnet 5.5 is proven. Opus 5.5 and Fable 5.1 are not justified on cost for intake chat.

## 7. Sources

- `claude-api` skill: "Current Models (cached: 2026-10-06)" table; "Claude Opus 5.5", "Claude Sonnet 5.5", "Claude Haiku 5.5" sections; "Thinking & Effort"; "Prompt Caching (Quick Reference)"; "Common Pitfalls" (forced tool use, prefill, sampling); TypeScript README Prompt Caching (read ~0.1x, write ~1.25x).
- Repo: `lib/agent/constants.ts`, `lib/observability/anthropic-pricing.ts`, `lib/agent/prompt-cache.ts`, `lib/api/briefs.ts`, `app/api/chat/route.ts` (temperature), `docs/conversational-posture-model.md`, issue #184. Measured profile (24.8k write, then 24.8k read, ~85-90 new tokens per turn) taken from the task brief and CLAUDE.md note on PR #178, not re-derived from `api_usage`.
