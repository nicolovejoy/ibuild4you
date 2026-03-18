# iBuild4you.com — Project Brief for Claude Code

## Intent

We are building an AI-powered project intake system. The target user is a non-technical person with an idea for an app, website, or digital tool. They interact with a conversational agent that guides them through discovery — extracting who uses the thing, what problem it solves, what the simplest version looks like, what already exists — and produces a structured "living brief" that evolves over multiple sessions.

There are three roles in the system:

- **Requester** (e.g. Jamie, a bakery owner) — chats with the agent, answers questions, reviews summaries
- **Agent** — conducts the conversation, extracts structure, produces and updates the living brief
- **Builder** (e.g. Nico) — reviews briefs on a dashboard, annotates them, and those annotations inform the agent's next session with the requester

## Architecture Origin

This project is cloned from NoteMaxxing, a Next.js App Router app. We are reusing:

- Next.js App Router on Vercel
- Firestore (new project, not piano-house-shared) with all DB access through API routes using Firebase Admin SDK — never from client components
- Firebase Auth with magic link login via Resend (replacing Google + email/password)
- Shared `apiFetch()` client helper with Bearer tokens
- React Query for state management
- Tailwind CSS v4 with @theme inline tokens
- Claude API (Sonnet) for agent conversations via SSE streaming

We are stripping out: folders/notebooks/notes data model, study features, import API, drag-and-drop reordering.

## Data Model (Initial)

- **users** — requester or builder role, email, auth metadata
- **projects** — one per requester engagement (Jamie's bakery = one project)
- **sessions** — each conversation between requester and agent, belonging to a project
- **messages** — individual messages within a session, with role (user/agent) and timestamp
- **briefs** — the living brief for a project, structured and versioned, updated after each session
- **reviews** — builder annotations on a brief, which feed back into the agent's context for the next session

## Agent Behavior

The agent's tone is neutral and non-opinionated. It slightly mirrors the requester's writing style but stays professional. It asks plain-language questions — never UX jargon like "user journeys" or "microservices."

Early sessions focus on broad discovery. Later sessions get more specific as the brief fills in. At natural checkpoints, the agent summarizes back to the requester for validation: "So you want X and Y but not Z, right?"

The agent's system prompt and conversation context will include:
- The current state of the living brief
- Any builder review annotations from the previous cycle
- The conversation history from prior sessions in this project

## What We Are NOT Building Yet

These are real planned features but explicitly out of scope for MVP:

- Auto-generated process flow diagrams
- Data architecture drafts
- Microservice architecture sketches
- Comparable app/website analysis
- "Just use Google Sheets" recommendations
- Whiteboard-style UI mockups

MVP is: conversational intake → structured living brief → builder review → next session picks up where we left off.

## Brand / Domain

- Domain: ibuild4you.com
- Brand direction: TBD (will evolve, don't over-invest in design yet)

## Team Context

This is a father-son project. Max (19, college freshman) is learning by doing. He has Claude Code installed and will be contributing to this repo. Code should be clear, well-commented where non-obvious, and follow the patterns established in NoteMaxxing. No clever abstractions — straightforward is better.
