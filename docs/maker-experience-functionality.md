# Maker Experience — Functional Spec

A functional description of the experience we want to deliver to the **maker** — a non-technical person with an app or website idea who has agreed to work with iBuild4you to bring it into focus. This document defines *what the experience does*, not how it looks, and is written so a designer or design agent can imagine and propose interfaces without needing to read the current codebase.

## 1. Who the maker is and what they're feeling

Picture someone who has never commissioned software before. They have an idea they care about — a bakery ordering app, a community website for their neighborhood, a tool for their nonprofit. They've been pointed at iBuild4you by a builder they trust.

What they're bringing:
- Real domain knowledge — they know their problem better than anyone.
- A clear sense of what they want the result to feel like, even if they can't articulate the technical pieces.
- Hesitation. They've probably been burned before, or watched friends get burned, by "tech people" who took their money and disappeared, or who built the wrong thing, or who made them feel stupid for not knowing the lingo.

What they're afraid of:
- Being asked questions they don't know how to answer.
- Discovering halfway through that the thing being built isn't what they meant.
- Being charged for things they didn't authorize.
- Having to learn a new tool just to participate.
- Being talked down to or talked past.

What they want:
- To feel heard.
- To feel like progress is real, not just chatter.
- To trust that the person on the other end actually understands what they're trying to build.
- To be able to see, at any moment, "here is what we've agreed on so far" and feel confident it matches their head.

## 2. The arc of the maker experience

The full experience has a clear shape: *invitation → first conversation → returning conversations → handoff*. The maker should always know which phase they're in and what comes next.

### Phase 0 — Invitation

Before the maker ever signs in, somebody (their builder) has reached out: a text, an email, a short call. The invitation makes three things crystal clear:

- **Why they're being invited.** "I want to help you build [thing you've been talking about]. The first step is a conversation."
- **What they'll be asked to do.** "Show up, talk about your idea. No homework, no forms."
- **How long it takes.** "First conversation is usually 20–30 minutes. You can stop whenever and come back later."

The invitation has a single action: a link they tap. That link drops them straight into the experience — no app to download, no account to create from scratch, no password to invent on the spot.

### Phase 1 — First arrival

When the maker taps the invitation link, the experience greets them by name and reminds them — briefly — what this is and who invited them. There is *one* thing to do on this page: start talking.

The first conversation begins immediately. There is no settings screen, no onboarding tour, no consent modal beyond what's legally required. The interface assumes the maker is here to talk about their idea and removes everything that could distract from that.

### Phase 2 — Conversation

The conversation is the heart of the experience. An AI agent — presented as a knowledgeable, patient collaborator, not a chatbot — asks open questions and listens.

What the conversation feels like:
- **Plain language only.** No jargon. Never "user journey" or "MVP" or "tech stack." If the maker mentions one of these terms, the agent mirrors it back; if the maker doesn't, the agent doesn't introduce them.
- **One question at a time.** Never a wall of questions. The agent waits for an answer, reflects briefly to show understanding, and asks the next thing.
- **Genuinely curious.** When the maker says something interesting or unusual, the agent notices. "That's not how most people think about this — can you say more?"
- **No pressure to be tidy.** The maker can ramble, contradict themselves, change their mind mid-sentence. The agent welcomes that and helps them sort it out, not by pushing back, but by asking clarifying questions and offering to summarize.
- **Confidence-building.** When the maker offers a real piece of insight, the agent acknowledges it specifically. "That's a really important constraint — let me write that down." Not flattery, but recognition.

The maker can:
- Type messages, or speak them (voice-to-text).
- Share images, screenshots, or PDFs — sketches, examples of apps they like, paperwork relevant to the problem.
- Pause at any time. The conversation is saved. They can come back later — minutes, days, weeks — and pick up exactly where they left off.
- Ask the agent anything: "What did we decide about X?", "Can you remind me what this is for?", "What happens next?"

The maker cannot:
- Be locked out for inactivity.
- Lose their place by closing the tab.
- Run out of messages or hit a usage wall in the middle of a thought.
- Be moved on to the next phase without their consent.

### Phase 3 — Reflection and validation

At natural checkpoints in the conversation, the agent pauses and shows the maker a clear summary of what's been understood so far. This is the maker's chance to correct course. Not a wall of text — a focused readback:

- "Here's the problem you're trying to solve, in your words."
- "Here's who you said this is for."
- "Here are the features we've talked about that matter most."
- "Here's what you said you don't want, or what you want to wait on."

The maker can fix any of these in place — by talking to the agent. They never have to edit a form field. They never have to phrase something "correctly." If they say "no, that's not quite right, it's more like...", the agent updates the summary.

This readback is the moment the maker should feel a quiet sense of progress: *something concrete now exists that didn't exist before, and it's mine.*

### Phase 4 — Between conversations

After the first conversation, the maker is not stranded. They are not waiting blindly for someone to get back to them. They have:

- **A persistent "this is what we have so far" page.** Always accessible. Shows the current brief in plain language. Updates when the next conversation happens. No version numbers visible, no JSON, no jargon.
- **A clear sense of who's working on it.** "Your builder, [Name], is reviewing what we discussed. You'll hear from them in [X days]." Specificity over vagueness.
- **A way to add something they thought of later.** A simple "add a note" or "send a message" function — voice, text, or attachment. These additions are visible to their builder and feed the next conversation.
- **Confidence that nothing they shared was lost.** Files they uploaded are still there. Things they said are still in the brief. Nothing has quietly disappeared.

### Phase 5 — Returning conversations

When the maker comes back for the next conversation (prompted by their builder, on their own schedule, or both), the experience feels continuous, not repetitive.

- The agent doesn't restart from zero or re-ask basics. It opens by acknowledging what's already known and what the conversation is going to focus on this time.
- Where the prior conversation got fuzzy or stuck, the agent surfaces the open questions warmly. "Last time you weren't sure about X. Want to think about that today, or come back to it later?"
- If the builder has been thinking between sessions, the agent reflects that into the conversation gracefully. "[Builder name] has been thinking about how this would actually work, and they're wondering about Y." The builder's thinking enters as a co-participant's, not as a teacher's correction.
- The maker can always say "actually I want to talk about something completely different today." The agent goes with it.

### Phase 6 — Handoff

When the brief is complete enough that the builder is ready to start building, the maker is told — plainly, with their consent — that the discovery phase is wrapping up. They are not surprised by this transition. They know:

- What's been agreed.
- What happens next, in concrete terms: who builds, what they build, in what order, by when, at what cost.
- What their role is during building: how often they'll be asked to weigh in, what kind of decisions will come back to them, how they can request changes.
- That the conversation door doesn't close. They can still come back and add things, raise concerns, or ask questions.

The handoff is a milestone the maker can feel good about, not a fade-out.

## 3. Cross-cutting principles

These apply everywhere in the experience.

### Trust is built moment by moment

Every interaction should leave the maker feeling slightly more confident than they were a moment ago, not less. Small signals matter: an acknowledgment when they upload a file, a confirmation when something is saved, a warm "got it" when they share something hard to articulate. Conversely: dead-air, spinning loaders without explanation, error messages that read like stack traces, or any moment of "did that just go through?" — these erode trust fast and are non-negotiable to eliminate.

### The maker never has to translate

The maker speaks their language. The agent — and every screen the maker sees — speaks back in that same register. If the maker calls something "the order page," the system calls it "the order page" everywhere, forever. The maker is never asked to map their words to ours.

### Nothing is hidden from them, nothing is forced on them

The brief is always visible, in their language. The history of the conversation is always reachable. But the maker is never *required* to read it. They can engage as deeply or as lightly as they want and the experience adapts.

### Mobile-first, low-friction, anywhere

The whole experience works on a phone in a coffee shop on spotty wifi. The maker doesn't need to be at a desk. They don't need to install anything. A link, a tap, a conversation.

### Voice has equal standing with text

Many makers express themselves better out loud than in writing. Voice input is a first-class way to participate — not a buried accessibility feature. Voice attachments (a 30-second voice memo describing something complicated) are as normal as a text message.

### Files are evidence, not artifacts

When the maker uploads a sketch, a screenshot, an example from a competitor, or a PDF, the system understands that file is *evidence about their idea*, not just an attachment. The agent looks at it, references it specifically, and integrates it into the conversation: "I see in your sketch the menu sits on the left — is that intentional or just a starting point?" The maker should feel their materials were actually looked at, not filed away.

### The agent is helpful, never servile or showy

The agent is a knowledgeable collaborator. It doesn't fawn ("Great question!"), it doesn't apologize excessively, and it doesn't show off what it knows. It is calm, curious, and competent. When it doesn't understand something, it says so plainly and asks for help.

### Honesty about uncertainty

When something is undecided, the brief says so plainly: "Pricing is still open." When the agent isn't sure what the maker meant, it asks. When the builder hasn't reviewed something yet, the maker can see that, with a clear sense of when they will. The maker is never told the project is further along than it actually is.

### Pace is the maker's, not ours

The maker decides when conversations happen, when to come back, and when they need a break. Reminders (when used) are gentle, opt-out-able, and worded as "whenever you're ready" — never "you need to" or "you're behind." If a maker goes quiet for weeks, the system assumes life happened, not that they've lost interest.

## 4. The "always-on" maker artifacts

Three things the maker has access to at any time, from any phase:

1. **The living brief.** Their idea, in their language, as it currently stands. Plain prose, not a form. Sections — problem, who it's for, what it does, what it won't do, what's still open — but unobtrusively. Reads like a one-page summary a friend might write up after a good conversation.

2. **The conversation history.** Everything they and the agent have said, scrollable, searchable. Not required reading; just available.

3. **A way to reach a human.** Their builder's name and a way to contact them — not a support email, but the actual person responsible. The maker is never "submitting a ticket."

## 5. What the maker doesn't see

These exist for the system but are invisible to the maker:

- Builder annotations on the brief, builder directives, agent configuration, session boundaries, brief versions, project status flags.
- AI mechanics: model names, token counts, "thinking..." indicators that expose internals, regenerate buttons, prompt context.
- Anything administrative: passcodes, share links, permission levels, system roles.
- Failure modes from upstream services. If something is broken behind the scenes, the maker sees a calm message that something is being worked on, with an honest estimate.

## 6. Edge cases the experience must handle gracefully

- **The maker shares something deeply personal or sensitive.** The agent treats it appropriately. The system doesn't expose it casually in the brief without permission.
- **The maker gets stuck mid-conversation.** The agent offers a way forward: "We can come back to this later — want to talk about something else for now?"
- **The maker disagrees with how something has been captured.** They can fix it by saying so. No forms, no edit modes.
- **The maker brings up something out of scope (e.g. "can you also do my taxes").** The agent acknowledges warmly and redirects without making them feel foolish.
- **The maker hasn't returned in a long time.** The next interaction (whether prompted by them or the builder) acknowledges the gap without guilt-tripping and offers a clean way back in.
- **The maker wants to bring in another person — a partner, a co-founder, a domain expert.** The system has a clear way to do this without losing what's been built.
- **The maker decides to stop.** They can. Cleanly. Without being interrogated. Their materials don't vanish overnight; they have time to retrieve them.

## 7. What success looks like

After their first conversation, the maker should be able to say to a friend, accurately:

> "It was just a conversation. Someone — well, something — actually listened. And at the end I had this clean summary of what I'd been trying to say. It felt like progress."

After several conversations:

> "They know what I'm building now. I can see it in the summary, and it's right. I trust them to start working on it."

After the build is underway:

> "I knew what was happening. When something needed my input, they asked clearly. When I had a question, I could ask. I never felt lost."

If we hit those three sentences honestly for the first dozen makers, we have the right product.

## 8. Open questions the design exploration should address

Things we know we want but haven't settled the shape of:

- **How does the maker know a conversation has "ended"?** Is it a graceful suggestion from the agent ("we've covered a lot — good place to pause?"), the maker closing the tab, an explicit "I'm done for now" button? Or all three?
- **How does the brief evolve visibly?** Does the maker see edits happening live during the conversation? Or only at checkpoints? Or only between sessions?
- **What's the right cadence of returning?** Builder-driven? Maker-driven? Calendar-suggested? How do reminders feel without being pushy?
- **How does voice integrate?** Always-available mic button? Toggleable mode? Both?
- **How do shared materials (sketches, examples) live in the brief?** As inline references, a side gallery, both?
- **How does the maker bring in another person?** Read-only viewer link? Co-pilot mode? Hand-off?
- **What does the conversation look like on a small phone screen, one-handed, in the wild?** This is probably the dominant use case and deserves first-class design attention, not adaptation from a desktop layout.
- **How does the maker recover from an obvious AI mistake** — a misunderstanding, a hallucinated detail in the brief, a misread of an uploaded image? What's the lowest-friction undo?
- **How is the relationship with the builder made visible without making the maker feel managed?** The builder is the trusted human in the loop; that presence should feel like backup, not surveillance.

These are the right starting prompts for a design exploration — concrete enough to push on, open enough to invent against.
