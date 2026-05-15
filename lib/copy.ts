// Centralized user-facing copy. Edit this file to change text across the app.
// Organized by context. Functions accept dynamic values; strings are static.

export const copy = {
  // --- Invite & nudge messages ---
  invite: {
    body: ({ shareLink, email, passcode }: { shareLink: string; email: string; passcode: string | null }) =>
      [
        `I set up a quick conversation for you — an AI assistant will ask about what you're looking for, and I'll use that to start building.`,
        '',
        shareLink,
        '',
        `Sign in with Google, or use:`,
        `Email: ${email}`,
        `Passcode: ${passcode || '(loading...)'}`,
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
        ? 'Ready to narrow things down and lock in a few decisions.'
        : 'Want to dig into a few things from last time.'

      return [
        `New conversation ready for ${projectTitle}. ${note || modeHint}`,
        '',
        shareLink,
      ].join('\n')
    },
    reminder: ({ projectTitle, shareLink }: { projectTitle: string; shareLink: string }) =>
      [`Just a reminder — your conversation for ${projectTitle} is ready whenever you have a few minutes.`, '', shareLink].join('\n'),
  },

  // --- Dashboard ---
  // NOTE: in the UI the umbrella construct is called "brief". The internal data
  // model + API + collection are still named `project` / `projects` (avoiding a
  // sweeping rename across types, routes, tests). User-facing strings here use
  // "brief".
  dashboard: {
    title: 'Your briefs',
    emptyAdmin: 'Create a brief, set it up, and share it with a maker.',
    emptyMaker: "You don't have any briefs yet. Check back soon!",
    turnNeedsSetup: 'Needs setup',
    turnAwaitingMaker: (name: string) => `Waiting on ${name}`,
    turnYourTurn: 'Your turn',
    activityAgent: (time: string) => `Agent responded ${time}`,
    activityMaker: (name: string, time: string) => `${name} messaged ${time}`,
    activityGeneric: (time: string) => `Last active ${time}`,
    builderActivity: (time: string) => `You edited ${time}`,
    nudgedAt: (time: string) => `Nudged ${time}`,
    sharedAt: (time: string) => `Shared ${time}`,
  },

  // --- New brief modal (internal key kept as `newProject` to match data model) ---
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
    successMessage: (email: string) => `${email} has been approved and linked to this brief.`,
    sendLinkPrompt: 'Send them this link:',
  },

  // --- Setup tab ---
  setup: {
    agentSetup: 'Agent setup',
    conversationOpener: 'Conversation opener',
    conversationOpenerPlaceholder: 'The message the agent sends when the maker opens this conversation.',
    conversationOpenerGenerate: 'Generate',
    conversationOpenerRegenerate: 'Regenerate',
    seedQuestionsLabel: 'Seed questions',
    seedQuestionsDescription: 'Questions the agent should weave into the conversation early on.',
    seedQuestionsPlaceholder: 'What does a typical day look like for you?',
    directivesLabel: 'Builder directives',
    directivesDescription: 'Things the agent should actively drive toward.',
    directivesPlaceholder: 'Get them to pick 1-2 tickers to start with',
    modeLabel: 'Mode',
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
    completedSession: 'Completed conversation — read only',
    placeholder: 'Type a message...',
    makerEmptyState: 'Send a message to start the conversation.',
    builderEmptyState: 'No messages yet.',
    defaultWelcomeMessage: (projectTitle: string) =>
      `Hey! Welcome to ${projectTitle}. I'm here to help figure out what you're looking for — just a casual conversation, no technical knowledge needed.\n\nWhat's the idea you have in mind?`,
  },

  // --- Maker view ---
  maker: {
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
    notApprovedWrongAccount: 'Signed in with the wrong account? Sign out and try again.',
    signOut: 'Sign out',
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

  // --- About page ---
  about: {
    title: 'What is iBuild4you?',
    intro: "Someone sent you a link because they want to help you build something. Here's what to expect.",
    whatItIs: "iBuild4you is a tool that helps you describe your idea through a simple conversation. You chat with an AI assistant that asks questions about what you want to build — no technical knowledge needed. As you talk, it captures everything into a brief that your builder can use to start building.",
    whatHappensNext: "After your conversation, your builder reviews what you discussed and may set up a follow-up to dig deeper. You can come back anytime — your brief grows with each conversation.",
    privacy: "Your conversations are only visible to you and the builder who invited you.",
    cta: 'Ready to get started?',
  },

  // --- Delete confirmation ---
  deleteProject: {
    warning: "This permanently deletes this brief and all its conversations. This can't be undone.",
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
