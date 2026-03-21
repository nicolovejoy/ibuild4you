# Iteration Architecture: Discover → Converge

## Overview

Sessions with a maker follow a lifecycle: early sessions are **divergent** (broad discovery), later sessions are **convergent** (narrowing scope, forcing decisions). The builder controls when to shift modes based on how the brief is shaping up.

## The Lifecycle

```
Builder sets up project + shares
  → Session 1 (discover mode): broad exploration
  → Builder reviews brief, preps session 2 (mode, directives, welcome)
  → Click "Create session 2 & copy nudge" → sends maker a message
  → Session 2 (converge mode): push for decisions
  → Builder reviews, preps session 3 if needed
  → Repeat until brief is buildable
```

Mode isn't a one-way progression. The builder can go discover → converge → discover again.

## Data Model

### Project-level fields (staging area for next session)

```
session_mode: 'discover' | 'converge'   (default: discover)
seed_questions: string[]                 (for discover mode)
builder_directives: string[]             (for converge mode)
welcome_message: string                  (greeting when session opens)
style_guide: string                      (tone/approach notes)
```

These are the "staging area" — the builder edits them while prepping the next session. When the session is created, they get snapshotted onto the session document.

### Session-level fields (immutable snapshot)

```
session_mode, seed_questions, builder_directives, welcome_message, style_guide
  — copied from project at session creation time
model: string                            (e.g. "claude-sonnet-4-20250514")
token_usage_input: number                (accumulated input tokens)
token_usage_output: number               (accumulated output tokens)
```

Once a session starts, its config is locked. The chat route reads config from the session (falling back to project for backward compatibility). Token usage is accumulated across all exchanges in the session.

### Brief decisions

```
decisions: BriefDecision[]  (AI-extracted only)

BriefDecision {
  topic: string      // "Data source"
  decision: string   // "Reddit API for user sentiment"
}
```

Decisions are extracted by the brief generation model — the builder cannot manually add/edit them. This keeps the brief as source-of-truth from conversations.

## Between-Sessions Flow

1. Session N ends naturally (maker stops chatting)
2. Brief auto-updates with decisions extracted from conversation
3. Builder reviews the brief on the project page
4. Builder clicks "Prep session N+1" — expands full setup form
5. Builder sets mode (discover/converge), questions/directives, welcome message, style guide
6. Builder adds optional nudge note
7. Builder clicks "Create session N+1 & copy nudge"
   - Config saves to project (staging area)
   - New session created with config snapshot
   - Previous active session marked as completed
   - Welcome message added as first message
   - Nudge message shown to copy and send to maker

The builder always sees the locked config for completed sessions ("Session 1 setup" with lock icon, read-only, showing mode, questions/directives, token usage, and model).

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

Config is read from the session document (snapshotted at creation), with fallback to project for sessions created before snapshotting was implemented.

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
Opens "Prep session N+1" → sets mode, directives/questions, welcome, style
  ↓
Clicks "Create session & copy nudge" → config saved + snapshotted + session created
  ↓
Sends nudge to maker → maker opens chat → config read from session snapshot
  ↓
Agent behaves according to snapshotted mode + directives
  ↓
Token usage tracked per exchange, accumulated on session
  ↓
After session, brief regenerated with decisions
  ↓
Builder reviews brief + session stats → preps next session
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

## What Gets Tracked Per Session

Each session document stores:
- **Config snapshot**: mode, seed questions/directives, welcome message, style guide
- **Usage**: model name, input tokens (accumulated), output tokens (accumulated)
- **Status**: active → completed (when next session is created)

This gives the foundation for learning: you can compare config choices, token efficiency, and decision extraction rates across sessions and projects.

## Backward Compatibility

All new fields are optional. Existing projects default to discover mode with no directives and no decisions. Sessions without config snapshots fall back to reading from the project. No migration needed.
