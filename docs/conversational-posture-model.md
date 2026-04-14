# The Conversational Posture Model

## The opportunity

The iBuild4you agent conducts conversations well enough to extract surface-level information, but it fails to extract depth. Across multiple makers — Eric (format review), Diane (campus app), Elijah (tide app), Owen (music practice) — the same pattern repeats: the agent asks a question, accepts whatever comes back, and moves on. It rarely pushes back on vague answers, rarely follows a rich answer into more specific territory, and wraps up based on exchange count rather than information quality.

The result is briefs with holes. Diane's cold-start problem got zero pushback. Eric's session 1 ended with a summary while five seed questions remained unasked. Elijah's session produced three exchanges of thin information. The agent is polite and productive-feeling, but it leaves value on the table.

The root cause is that the agent's behavior rules describe a single mode of operation — curious and yielding — without a framework for shifting to other modes based on what the conversation actually needs.

## The mental model: postures

A **conversational posture** is the agent's behavioral stance in a given exchange. It's not a personality — it's a response pattern triggered by what the user just said and shaped by the session context.

The starting set of postures:

- **Curious** — open exploration, broad questions. "Tell me more about that."
- **Deepening** — following a thread into specifics. "Walk me through exactly how you'd notate that."
- **Challenging** — pushing back on vague or hand-wavy answers. "That makes sense long-term, but what about the first week?"
- **Confirming** — summarizing back to validate understanding. "So you want X but not Y, right?"
- **Yielding** — accepting the answer and moving on. The topic is handled or the user has disengaged.
- **Closing** — wrapping up the session. Summarizing what was gathered, signaling next steps.

These are extensible. New postures can be added as session types evolve (e.g., a "Demonstrating" posture for sessions where the agent shows the user something and asks for reactions, or a "Coaching" posture for sessions where the agent helps the user think through a decision).

## The stuck pattern

Today the agent oscillates between Curious and Yielding:

1. Ask a broad question (Curious)
2. Accept whatever comes back (Yielding)
3. Ask the next question (Curious)
4. After N exchanges, wrap up (Closing)

It almost never shifts to Challenging when the user gives a vague answer. It almost never shifts to Deepening when the user gives a rich, specific answer that deserves follow-up. And it enters Closing based on exchange count rather than signal quality — a timer, not a gate.

## What governs posture shifts

Three layers, in order of authority:

### 1. User signals (real-time trigger)

Every exchange from the user carries a signal that should inform the agent's next posture:

- Rich, specific answer → shift to Deepening (follow the thread)
- Vague or optimistic answer → shift to Challenging (push back)
- Short, dismissive answer → shift to Yielding (this topic is done)
- Domain-specific correction → stay in Confirming (get it right this time)
- Repeated disengagement on a topic → Yield and try a different topic
- User volunteers new information unprompted → shift to Deepening

The agent's job is to read these signals and respond with the appropriate posture, not to default to the same one every time.

### 2. Session gravity (mode weighting)

The session mode creates a center of gravity — it doesn't constrain which postures are available, but it biases which ones the agent favors:

**Discover mode** pulls toward Curious and Deepening. The agent should spend more time exploring and less time confirming. It should resist Closing until the topic space feels genuinely mapped. Challenging is available but used sparingly — discover mode is about breadth.

**Converge mode** pulls toward Challenging and Confirming. The agent should push for decisions, present concrete options, and validate commitments. Curious is available but only to fill genuine gaps — converge mode is about depth on specific topics.

Session gravity is a bias, not a constraint. A discover session can still challenge a vague answer. A converge session can still explore an unexpected new thread.

### 3. Builder directives (overrides)

Builder directives are the highest-authority behavioral control. They can:

- **Pin a posture**: "Always challenge vague adoption plans" forces the agent into Challenging on that specific topic regardless of session gravity.
- **Suppress a posture**: "Never close early — this person has more to say" blocks the Closing posture until the builder's conditions are met.
- **Shift the identity**: "This is a product feedback session, not product discovery — extract opinions, don't suggest solutions" reframes the agent's entire orientation.
- **Add posture-specific behavior**: "When challenging, don't suggest your own solutions — just name the gap and ask how they'd solve it."

### Guardrails (hard constraints)

Guardrails prevent known failure modes regardless of posture:

- **One question per message.** If the agent has a follow-up, it waits for the answer first. Never end a message with two separate questions.
- **Two-strike rule.** If the user doesn't engage with a topic after two attempts, yield and move on. Don't rephrase the same question hoping for a different answer.
- **Accuracy before restatement.** When the user explains something domain-specific, don't immediately paraphrase it. If unsure, ask a clarifying question. Getting a restatement wrong erodes trust fast.
- **Quality gates for Closing.** The agent cannot enter the Closing posture based on exchange count alone. Closing requires: sufficient depth on the key topics, at least one attempt to challenge a vague answer (if any occurred), and coverage of the builder's seed questions or directives.

## Structural suggestions

Two changes to the platform would support this model:

**1. Make the agent's identity layer configurable.**

The current hardcoded identity ("You are the iBuild4you project intake assistant. Your job is to help the user describe their app or website idea") doesn't fit non-standard sessions like Eric's format review or Elijah's "just build it" demand. The identity should be overridable at the project or session level, with a sensible default for standard intake sessions. The posture model works regardless of identity — a format review agent and a product intake agent both need the same set of postures, just with different gravity.

**2. Add an open risks field to the brief.**

The brief currently captures what the user wants but not what's unresolved or risky. A place to record open risks ("cold start — no plan for first users," "pickup notation — format can't handle cross-section boundaries") gives the builder a natural input for session 2 directives. Risks become the seeds for Challenging posture in the next session.

## What this enables

With postures and governance in place:

- **Eric's session 1** would have gone deeper. When Eric said "I did not notice that distinction" about numbered sections, the agent would have shifted to Deepening ("interesting — what did you think those sections were?") instead of immediately asking two new questions.

- **Diane's session** would have challenged the cold-start hand-wave. "If it gets traction it'll naturally become a go-to" would have triggered Challenging: "That makes sense once it's rolling, but how do the first 20 students hear about it?"

- **Elijah's session** would have recognized thin, disengaged answers and either deepened on the one topic he cared about (the tide app) or yielded gracefully instead of producing three exchanges of nothing.

- **Session endings** would be earned, not timed. The agent wraps up when it has what it needs, not when a counter says so.

The posture set is a starting vocabulary. As iBuild4you handles more session types — technical reviews, design feedback, coaching conversations — new postures can be added without changing the governance model. The governance stack (signals → gravity → directives → guardrails) stays the same.
