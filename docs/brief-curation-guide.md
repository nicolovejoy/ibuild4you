> Canonical copy: `lib/agent/curation-guide.ts` (`BRIEF_CURATION_GUIDE`), embedded in the next-convo prep. Edit both; a test pins them equal.

BRIEF CURATION GUIDE

Who reads the brief
- Sam, the intake agent, reads it at the start of every conversation with the maker: it is how Sam knows what is settled, what not to ask again, and where to steer.
- The comms agent (you, when you curate) reads it to prepare each next conversation.
- Claude Code reads it when the build starts.
No person reads it as a document. Write for those agents: terse, factual, no narrative.

Size
- Keep the brief JSON (the "brief" object, serialized) under 20,000 characters. Smaller is better: the whole brief goes into every chat turn.
- Near the budget, merge and drop before you add.

Keep
- What Sam needs so it does not ask the maker again: facts about the maker's world, their preferences, every decision still in force.
- What Sam needs to steer: open risks, gaps, what the maker is unsure about.

Merge
- Duplicates and near-duplicates (the same feature or fact raised in different conversations) into one entry.
- A feature and its refinements into one feature.

Drop
- History: who said what and when, how a decision was reached, earlier wording. The app keeps every past version.
- Detail a later decision superseded.
- Open risks a note marks as settled.

Decisions
- A locked decision ("locked": true) is copied verbatim, every field. Never reword it, never drop it, never unset the lock.
- When a note records that the maker asked to reverse a locked decision, the app has already put that on the brief as "contested". Carry "contested" and "contest_dismissed" exactly as they appear; do not change the decision, the lock or the contest yourself. The builder settles it.
- When a note revises a decision, keep that decision's "topic" text exactly as it is on the brief and change only "decision". The app matches decisions by topic; a reworded topic reads as a new decision and loses its history.
- Keep each decision within the question it answered, in the maker's own words.
- Carry decided_in_session, decided_at, revised_in_session and revised_at through unchanged.

Open risks
- Every open risk is an object with "text" and "owner": "maker" when only the maker can settle it (their preference, a fact about their world, a choice that is theirs), "builder" when it is the builder's to resolve (technical, scheduling, something the builder said they would look into).
- Carry an existing owner forward. Give an ownerless risk the owner that fits.

Shipped and queued
- "shipped" is dated batches of things already built: { "date": "YYYY-MM-DD", "items": [...] }. Keep every batch; only when the size budget presses, merge or drop the oldest first.
- A dated "we shipped X" passage in additional_context belongs in "shipped". Move it there.
- "queued" is a list of things planned but not built. When a note says a queued item shipped, remove it from "queued" and add it to the latest "shipped" batch.
- Always carry "shipped" and "queued" forward: a brief written without them loses them.

Language
- The brief is in English whatever language the maker speaks, because the agents that read it work in English. Translate the maker's words.
