// Centralized user-facing copy. Edit this file to change text across the app.
// Organized by context. Functions accept dynamic values; strings are static.

export const copy = {
  // --- Invite & nudge messages ---
  invite: {
    body: ({ shareLink, email, passcode }: { shareLink: string; email: string; passcode: string | null }) =>
      [
        `Hey! I've set up a project for us to work on together — just a short conversation to figure out what you need.`,
        '',
        `Here's your link:`,
        shareLink,
        '',
        `Sign in with Google, or use these credentials:`,
        `Email: ${email}`,
        `Passcode: ${passcode || '(loading...)'}`,
        '',
        `No rush — you can come back anytime to pick up where you left off.`,
      ].join('\n'),
    emailLabel: 'Invite message',
  },
  nudge: {
    body: ({ projectTitle, shareLink, note, sessionMode }: {
      projectTitle: string
      shareLink: string
      note?: string
      sessionMode?: 'discover' | 'converge'
    }) => {
      const modeHint = sessionMode === 'converge'
        ? 'This time we want to narrow things down and lock in some decisions.'
        : 'We want to dig deeper into a few things from last time.'

      return [
        `Hey! Thanks for the last conversation about ${projectTitle} — really helpful.`,
        '',
        note || modeHint,
        '',
        `Same link as before:`,
        shareLink,
        '',
        `Just sign in when you have a few minutes — there'll be a fresh chat ready to go.`,
      ].join('\n')
    },
  },

  // --- Dashboard ---
  dashboard: {
    title: 'Your projects',
    emptyAdmin: 'Create a project, set it up, and share it with a maker.',
    emptyMaker: "You don't have any projects yet. Check back soon!",
    turnNeedsSetup: 'Needs setup',
    turnAwaitingMaker: (name: string) => `Waiting on ${name}`,
    turnYourTurn: 'Your turn',
    activityAgent: (time: string) => `Agent responded ${time}`,
    activityMaker: (name: string, time: string) => `${name} messaged ${time}`,
    activityGeneric: (time: string) => `Last active ${time}`,
    nudgedAt: (time: string) => `Nudged ${time}`,
    sharedAt: (time: string) => `Shared ${time}`,
  },

  // --- New project modal ---
  newProject: {
    titlePlaceholder: "Jamie's Bakery Website",
    contextLabel: 'Context for the agent',
    contextPlaceholder: "Jamie owns a bakery in downtown Portland. She wants to let customers order online and pick up in store. She's not technical at all...",
    contextHelp: "Background info the agent will use to skip basic discovery questions.",
  },

  // --- Share modal (dashboard) ---
  shareModal: {
    emailLabel: 'Their email address',
    emailPlaceholder: 'jamie@example.com',
    emailHelp: "They'll be approved automatically. You'll get a link to send them.",
    successMessage: (email: string) => `${email} has been approved and linked to this project.`,
    sendLinkPrompt: 'Send them this link:',
  },

  // --- Setup tab ---
  setup: {
    agentSetup: 'Agent setup',
    sessionOpener: 'Session opener',
    sessionOpenerPlaceholder: 'The message the agent sends when the maker opens this session.',
    sessionOpenerGenerate: 'Generate',
    sessionOpenerRegenerate: 'Regenerate',
    seedQuestionsLabel: 'Seed questions',
    seedQuestionsDescription: 'Questions the agent should weave into the conversation early on.',
    seedQuestionsPlaceholder: 'What does a typical day look like for you?',
    directivesLabel: 'Builder directives',
    directivesDescription: 'Things the agent should actively drive toward.',
    directivesPlaceholder: 'Get them to pick 1-2 tickers to start with',
    sessionModeLabel: 'Session mode',
    discoverDescription: 'Broad exploration — the agent asks open-ended questions',
    convergeDescription: 'Push for decisions — the agent narrows scope and presents options',
    shareWithMaker: 'Share with maker',
    makerPasscode: 'Maker passcode',
    passcodeHelp: 'Share this passcode with the maker so they can sign in',
  },

  // --- Brief tab ---
  brief: {
    copyPrepContext: 'Copy prep context',
    copyPrepHelp: 'Copy the prep context, paste into Claude to discuss strategy, then ask for output and paste the JSON below.',
    importPlaceholder: 'Paste JSON here (multi-field with brief/session_opener/directives/mode, or brief-only)...',
    importButton: 'Import JSON',
    emptyTitle: 'No brief yet',
    emptyDescription: 'Copy the prep context for Claude and paste the response above, or use Generate via API.',
  },

  // --- Chat ---
  chat: {
    agentLabel: 'iBuild4you assistant',
    completedSession: 'Completed session — read only',
    placeholder: 'Type a message...',
    makerEmptyState: 'Send a message to start the conversation.',
    builderEmptyState: 'No messages yet.',
  },

  // --- Maker view ---
  maker: {
    briefCardTitle: 'What we know so far',
    previousConversations: 'Previous conversations',
  },

  // --- Auth ---
  auth: {
    welcome: 'Welcome',
    signInPrompt: 'Sign in to continue',
    signInGoogle: 'Sign in with Google',
    signInPasscode: 'Sign in with passcode',
    pascodeDivider: 'or sign in with a passcode',
    notApprovedTitle: 'Hang tight!',
    notApprovedMessage: (email: string) =>
      `Thanks for signing up. Your account (${email}) isn't approved yet. We'll let you know when you're in.`,
  },

  // --- Landing page ---
  landing: {
    tagline: "Have an idea for an app or website but not sure where to start? Our AI guides you through the details and turns your idea into a clear plan — no technical knowledge needed.",
    howItWorks: 'How it works',
    steps: [
      { title: 'Tell us your idea', desc: 'Chat with our AI assistant about what you want to build. No jargon, just a conversation.' },
      { title: 'We figure out the details', desc: "As you talk, we capture everything you've described so your builder knows exactly what you need." },
      { title: 'Refine over time', desc: 'Come back anytime to add more details. Your plan evolves as your thinking does.' },
    ],
    interestTitle: 'Interested?',
    interestSubtitle: "We're invite-only right now. Let us know you're interested and we'll be in touch.",
    interestSuccess: 'Thanks for your interest!',
    interestSuccessDetail: "We'll be in touch when we have a spot for you.",
  },

  // --- Delete confirmation ---
  deleteProject: {
    warning: "This permanently deletes the project, all conversations, and the brief. This can't be undone.",
    confirmLabel: 'Type "delete" to confirm',
  },

  // --- General ---
  loading: 'Loading...',
}

// Display name formatter: "Jamie B" or "Nico L"
export function formatDisplayName(firstName?: string | null, lastName?: string | null): string | null {
  if (!firstName) return null
  if (lastName) return `${firstName} ${lastName.charAt(0)}`
  return firstName
}
