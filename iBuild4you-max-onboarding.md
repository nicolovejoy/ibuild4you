# iBuild4you.com — Hey Max, Here's What We're Building

## The Big Idea

People have ideas for apps and websites but don't know how to describe what they need. We're building a tool that has a friendly AI conversation with them to figure it out — kind of like a really good first meeting with a client, except the AI is doing the meeting.

Behind the scenes, every answer gets organized into a structured document called a "living brief" that we (the builders) use to actually plan and build their thing.

## How It Works

1. **Someone like Jamie** (dad's friend who runs a small bakery) lands on iBuild4you.com
2. She gets a **magic link** email to log in — no passwords to remember
3. An **AI chat** walks her through questions: Who uses your thing? What do they do? What exists today? What's the simplest version?
4. The AI builds a **living brief** from her answers — structured, not just a chat log
5. **We review** the brief on our side, add notes
6. **Next time Jamie comes back**, the AI picks up where we left off, informed by our review

## The Stack

We're cloning the architecture from NoteMaxxing (dad's note-taking app). That means:

- **Next.js** (App Router) — the web framework
- **Firebase Auth** — login system (magic links via Resend)
- **Firestore** — the database
- **Vercel** — where it runs
- **Tailwind CSS v4** — styling
- **React Query** — data fetching
- **Claude API** — the AI conversations

You've already got Claude Code installed on your PC at school. Tomorrow we'll get it on your Mac too.

## Your First Tasks

Don't worry about understanding everything above yet. Here's what we'll do together:

1. Get Claude Code running on your Mac
2. Clone the NoteMaxxing repo as our starting point
3. Set up a new Firebase project for iBuild4you
4. Get a basic "hello world" version deployed to Vercel
5. Start stripping out the note-taking stuff we don't need

We'll take it one step at a time. Ask questions constantly — that's the whole point.
