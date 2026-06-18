// Centralized user-facing copy. Edit this file to change text across the app.
// Organized by context. Functions accept dynamic values; strings are static.

export const copy = {
  // --- Invite & nudge messages ---
  invite: {
    body: ({
      projectTitle,
      shareLink,
      email,
      passcode,
    }: {
      projectTitle: string
      shareLink: string
      email: string
      passcode: string | null
    }) =>
      [
        `I'm putting together a brief for ${projectTitle} and want your input to shape it.`,
        '',
        `The link below opens a conversation where you can share what you're looking for. We'll come back to it across a few sessions to fill in the picture.`,
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
    // Just the message body, no share link. Used as the template fallback when
    // AI prep is unavailable; the link is appended separately (mirrors how a
    // saved nudge_message override is handled).
    bodyText: ({
      projectTitle,
      note,
      sessionMode,
    }: {
      projectTitle: string
      note?: string
      sessionMode?: 'discover' | 'converge'
    }) => {
      const modeHint =
        sessionMode === 'converge'
          ? 'Ready to narrow things down and lock in a few decisions.'
          : 'Want to dig into a few things from last time.'
      return `New conversation ready for ${projectTitle}. ${note || modeHint}`
    },
    body: ({
      projectTitle,
      shareLink,
      note,
      sessionMode,
    }: {
      projectTitle: string
      shareLink: string
      note?: string
      sessionMode?: 'discover' | 'converge'
    }) => [copy.nudge.bodyText({ projectTitle, note, sessionMode }), '', shareLink].join('\n'),
    reminder: ({ projectTitle, shareLink }: { projectTitle: string; shareLink: string }) =>
      [
        `Just a reminder — your conversation for ${projectTitle} is ready whenever you have a few minutes.`,
        '',
        shareLink,
      ].join('\n'),
  },

  // Subjects for builder-initiated outbound email (sent via Resend from the
  // builder Setup tab). Bodies reuse copy.invite.body / copy.nudge.* above.
  email: {
    subject: {
      invite: (projectTitle: string) => `Your brief for "${projectTitle}"`,
      nudge: (projectTitle: string) => `New conversation ready for "${projectTitle}"`,
      reminder: (projectTitle: string) => `Your conversation for "${projectTitle}" is ready`,
    },
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
    archive: 'Archive',
    unarchive: 'Unarchive',
    // Role/turn-state sections (#44). Titles head each group; emptyHint shows on
    // empty role sections only (awaiting/done skip the hint to avoid clutter).
    sections: {
      awaiting: { title: 'Awaiting you' },
      yours: { title: 'Yours', emptyHint: 'No briefs you started.' },
      reviewing: { title: 'Reviewing', emptyHint: 'Nothing to review right now.' },
      contributing: { title: 'Contributing', emptyHint: "No briefs you're contributing to." },
      done: { title: 'Done' },
      archived: { title: 'Archived' },
    },
  },

  // --- New brief modal (internal key kept as `newProject` to match data model) ---
  newProject: {
    titlePlaceholder: "Sam's Cafe Website",
    contextLabel: 'Context for the agent',
    contextPlaceholder:
      "Sam owns a cafe in downtown Portland. They want to let customers order online and pick up in store. They're not technical at all...",
    contextHelp: 'Background info the agent will use to skip basic discovery questions.',
  },

  // --- Share modal (dashboard) ---
  shareModal: {
    emailLabel: 'Their email address',
    emailPlaceholder: 'sam@example.com',
    emailHelp: "They'll be approved automatically. You'll get a link to send them.",
    successMessage: (email: string) => `${email} has been approved and linked to this brief.`,
    sendLinkPrompt: 'Send them this link:',
  },

  // --- Setup tab ---
  setup: {
    agentSetup: 'Agent setup',
    conversationOpener: 'Opening message',
    conversationOpenerPlaceholder:
      'The message the assistant sends when the maker opens the next session.',
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
    copyPrepHelp:
      'Copy the prep context, paste into Claude to discuss strategy, then ask for output and paste the JSON below.',
    importPlaceholder:
      'Paste JSON here (multi-field with brief/session_opener/directives/mode, or brief-only)...',
    importButton: 'Import JSON',
    emptyTitle: 'No brief yet',
    emptyDescription:
      'Copy the prep context for Claude and paste the response above, or use Generate via API.',
  },

  // --- Chat ---
  chat: {
    agentLabel: 'Sam',
    completedSession: 'Completed conversation — read only',
    placeholder: 'Type a message...',
    makerEmptyState: 'Send a message to start the conversation.',
    builderEmptyState: 'No messages yet.',
    defaultWelcomeMessage: (projectTitle: string) =>
      `Hey! Welcome to ${projectTitle}. I'm here to help figure out what you're looking for — just a casual conversation, no technical knowledge needed.\n\nWhat's the idea you have in mind?`,
  },

  // --- Maker view ---
  maker: {
    previousConversations: 'Previous sessions',
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
    tagline:
      'Have an idea for an app or website but not sure where to start? Our AI guides you through the details and turns your idea into a clear plan — no technical knowledge needed.',
    howItWorks: 'How it works',
    steps: [
      {
        title: 'Tell us your idea',
        desc: 'Chat with our AI assistant about what you want to build. No jargon, just a conversation.',
      },
      {
        title: 'We figure out the details',
        desc: "As you talk, we capture everything you've described so your builder knows exactly what you need.",
      },
      {
        title: 'Refine over time',
        desc: 'Come back anytime to add more details. Your plan evolves as your thinking does.',
      },
    ],
    interestTitle: 'Interested?',
    interestSubtitle:
      "We're invite-only right now. Let us know you're interested and we'll be in touch.",
    interestSuccess: 'Thanks for your interest!',
    interestSuccessDetail: "We'll be in touch when we have a spot for you.",
  },

  // --- About page ---
  about: {
    title: 'What is iBuild4you?',
    intro: 'an experiment in RAAC - Rapid asynchronous assisted communication',
    whatItIs:
      'Initially conceived as an intake process for friends who wanted my help with coding on various projects, I now see this as a generalized conversation platform that enables people to communicate with each other with the assistance of an agent to facilitate the process. I — meaning Nico, the human behind iBuild4you. Now meet our assistant, Sam:',
    whoIsRoanHeading: 'Meet Sam Scribe',
    whoIsRoan:
      'Sam is the assistant in the middle of the conversation — there to help everyone involved think more clearly and understand each other. Nico (and you!) help tune Sam as this evolves.',
    briefHeading: 'The Brief (project?)',
    briefIntro:
      "What was first called a project (could be better) is now called a brief. It's focused on some topic, and evolves as a series of assisted conversations, with some artifacts at times (one of us uploads some files, say). Sam works within the brief to evolve conversations and help them cover the intended scope.",
    rolesIntroHeading: 'Roles in a brief',
    rolesIntro:
      "I'm trying to formulate the right way to frame the different participants in a conversation. For now we're thinking about originator, contributor, reviewer. In the initial framing it was a Maker and a Builder. Feedback encouraged, always.",
    privacyIntroHeading: 'Privacy - in progress',
    privacy:
      "Your brief should only be visible to the people invited to it, but given that this is an early-stage project, with one developer who has a dozen projects or more, don't share things that are too personal here, please!",
    cta: 'Ready to get started?',
    voiceNote: "This page was written by Nico with Sam's help, and edited by hand.",
  },

  // --- Glossary — single source of truth for terminology ---
  // Used by the About page and as tooltip text across the app.
  // Keep `short` ≤ 90 chars so it works as a hover tooltip.
  //
  // NOTE: RAAC vocab (Sam Scribe / Originator / Contributor / Reviewer /
  // Builder-as-downstream) is the UI's vocabulary — chrome badges resolve role
  // labels via lib/roles/display.ts; builder nav uses Sessions / Setup. The
  // assistant is "Sam" in chat (agentLabel) and "Sam Scribe" on the About page.
  glossary: {
    brief: {
      term: 'Brief',
      short:
        'The living document at the center of everything — grows every time someone weighs in.',
    },
    roan: {
      term: 'Sam Scribe',
      short: 'The assistant that carries questions between people and keeps the brief up to date.',
    },
    originator: {
      term: 'Originator',
      short: 'The person who brought the idea to this brief. Usually the first to write.',
    },
    contributor: {
      term: 'Contributor',
      short: 'Adds their own voice, questions, and context to the brief alongside the originator.',
    },
    reviewer: {
      term: 'Reviewer',
      short:
        "Annotates and validates — flags what's missing or unclear and steers the next session.",
    },
    builderDownstream: {
      term: 'Builder',
      short: 'Downstream: the person who reads the finished brief and writes the software.',
    },
    session: {
      term: 'Session',
      short: 'One conversation between you and Sam. You can come back across many.',
    },
    setup: {
      term: 'Setup',
      short: 'Context, seed questions, and directives that shape what Sam opens with next.',
    },
    files: {
      term: 'Files',
      short: 'Anything attached to a brief — PDFs, images, docs Sam can reference.',
    },
    needsSetup: {
      term: 'Needs setup',
      short: "This brief hasn't been shared yet — still needs a link sent.",
      detail:
        "No conversation has started yet. Until you share this brief with the person it's for and they send their first message, Sam has nothing to work with.",
      todo: 'Share the brief link with the requester to start their first conversation.',
    },
  },

  // --- Delete confirmation ---
  deleteProject: {
    warning: "This permanently deletes this brief and all its conversations. This can't be undone.",
    confirmLabel: 'Type "delete" to confirm',
  },

  // --- General ---
  loading: 'Loading...',
}

// Display name formatter: first name + last initial (e.g. "Sam L")
export function formatDisplayName(
  firstName?: string | null,
  lastName?: string | null
): string | null {
  if (!firstName) return null
  if (lastName) return `${firstName} ${lastName.charAt(0)}`
  return firstName
}

// Short maker name for inline references: first name, else the email local-part,
// else a generic fallback. Centralizes the `first || email.split('@')[0] || …`
// ladder repeated across the dashboard, builder view, and the notify cron.
export function getMakerShortName(
  firstName?: string | null,
  email?: string | null,
  fallback = 'maker'
): string {
  return firstName || email?.split('@')[0] || fallback
}
