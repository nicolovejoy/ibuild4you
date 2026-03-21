# Iteration Architecture: Discover → Converge

## Overview

Sessions with a maker follow a lifecycle: early sessions are **divergent** (broad discovery), later sessions are **convergent** (narrowing scope, forcing decisions). The builder controls when to shift modes based on how the brief is shaping up.

## The Lifecycle

```
Builder sets up project
  → Session 1 (discover mode): broad exploration
  → Builder reviews brief, adds directives, switches to converge
  → Session 2 (converge mode): push for decisions
  → Builder reviews, maybe flips back to discover if new scope opens
  → Repeat until brief is buildable
```

Mode isn't a one-way progression. The builder can go discover → converge → discover again.

## Data Model

### Project-level fields

```
session_mode: 'discover' | 'converge'   (default: discover)
builder_directives: string[]             (things to drive toward)
```

Both live on the project (not session). The builder updates them between sessions as part of the review/prep step.

### Brief decisions

```
decisions: BriefDecision[]  (AI-extracted only)

BriefDecision {
  topic: string      // "Data source"
  decision: string   // "Reddit API for user sentiment"
}
```

Decisions are extracted by the brief generation model — the builder cannot manually add/edit them. This keeps the brief as source-of-truth from conversations.

## System Prompt Assembly

The system prompt is assembled in order:

1. **Identity** — "You are the iBuild4you project intake assistant."
2. **Behavior rules** — `AGENT_BEHAVIOR_RULES` (discover) or `CONVERGE_BEHAVIOR_RULES` (converge)
3. **Style guide** — per-maker tone notes
4. **Background** — project context
5. **Seed questions** (discover) or **Builder directives** (converge)
6. **Decisions already made** — from brief, so the agent doesn't revisit them
7. **Current brief** — what we know so far
8. **Session context** — session number, greeting behavior

### Discover vs Converge behavior

| Aspect | Discover | Converge |
|--------|----------|----------|
| Questions | Open-ended | Present 2-3 concrete options |
| Vagueness | Explore it | Propose something specific |
| Technical details | Never mention | OK at high level when it helps narrow scope |
| Ambitious ideas | Explore freely | Park as "phase 2/3", refocus |
| Pacing | 8-12 exchanges, offer to wrap up | 8-12 exchanges, summarize decided scope at end |

### Directives vs Seed Questions

- **Seed questions** (discover): "Weave in naturally" — the agent works them in when they fit
- **Builder directives** (converge): "Don't skip these" — the agent actively steers toward covering them

The UI shows one or the other based on the current mode.

## Data Flow

```
Builder reviews brief
  ↓
Sets directives + picks mode (discover/converge)
  ↓
Maker opens chat → system prompt includes mode + directives + prior decisions
  ↓
Agent behaves according to mode
  ↓
After session, brief is regenerated
  ↓
Brief extraction includes decisions (maker committed to specific choices)
  ↓
Builder reviews updated brief + decisions → sets up next session
```

## Brief Evolution

Session 1 (discover):
```json
{
  "problem": "wants to track social sentiment for stock trading",
  "features": ["sentiment dashboard", "Reddit/Twitter scanning"],
  "decisions": []
}
```

Session 2 (converge):
```json
{
  "problem": "wants to track social sentiment for stock trading",
  "features": ["sentiment dashboard", "Reddit scanning", "3 ticker limit"],
  "decisions": [
    { "topic": "Data source", "decision": "Reddit only — Twitter API too expensive" },
    { "topic": "Ticker limit", "decision": "Start with 3 tickers max" }
  ]
}
```

## Backward Compatibility

All new fields are optional. Existing projects default to discover mode with no directives and no decisions. No migration needed.
