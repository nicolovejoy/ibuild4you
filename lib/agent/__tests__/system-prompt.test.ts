import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../system-prompt'
import { AGENT_BEHAVIOR_RULES, CONVERGE_BEHAVIOR_RULES, DEFAULT_IDENTITY } from '../constants'

// =============================================================================
// SYSTEM PROMPT TESTS
//
// buildSystemPrompt is a pure function — takes structured input, returns the
// system prompt string sent to Claude. These tests verify that each optional
// section appears (or doesn't) based on the input.
// =============================================================================

const emptyBrief = {
  problem: '',
  target_users: '',
  features: [] as string[],
  constraints: '',
  additional_context: '',
  decisions: [],
}

const minimalInput = {
  briefContent: null,
  projectContext: null,
  sessionNumber: 1,
}

describe('buildSystemPrompt', () => {
  it('includes the default identity when none provided', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).toContain(DEFAULT_IDENTITY)
  })

  it('uses custom identity when provided', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      identity: 'You are a format review assistant helping evaluate document structure.',
    })
    expect(result).toContain('You are a format review assistant')
    expect(result).not.toContain(DEFAULT_IDENTITY)
  })

  it('uses discover behavior rules by default', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).toContain(AGENT_BEHAVIOR_RULES)
    expect(result).not.toContain(CONVERGE_BEHAVIOR_RULES)
  })

  it('uses converge behavior rules when session_mode is converge', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(result).toContain(CONVERGE_BEHAVIOR_RULES)
    expect(result).not.toContain(AGENT_BEHAVIOR_RULES)
  })

  it('includes project context when provided', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      projectContext: 'Sam owns a cafe in Portland',
    })
    expect(result).toContain('## Background')
    expect(result).toContain('Sam owns a cafe in Portland')
  })

  it('omits background section when no context', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).not.toContain('## Background')
  })

  it('includes numbered seed questions', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      seedQuestions: ['What does the app do?', 'Who uses it?'],
    })
    expect(result).toContain('## Topics to explore')
    expect(result).toContain('1. What does the app do?')
    expect(result).toContain('2. Who uses it?')
  })

  it('omits seed questions section when empty', () => {
    const result = buildSystemPrompt({ ...minimalInput, seedQuestions: [] })
    expect(result).not.toContain('## Topics to explore')
  })

  it('includes numbered builder directives', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      builderDirectives: ['Focus on data flow', 'Do not suggest architectures'],
    })
    expect(result).toContain('## Directives')
    expect(result).toContain('1. Focus on data flow')
    expect(result).toContain('2. Do not suggest architectures')
  })

  it('omits directives section when empty', () => {
    const result = buildSystemPrompt({ ...minimalInput, builderDirectives: [] })
    expect(result).not.toContain('## Directives')
  })

  it('includes layout mockups when provided', () => {
    const mockup = {
      title: 'Homepage',
      sections: [{ type: 'hero', label: 'Welcome', description: 'Hero section' }],
    }
    const result = buildSystemPrompt({
      ...minimalInput,
      layoutMockups: [mockup],
    })
    expect(result).toContain('## Layout mockups')
    expect(result).toContain('Homepage')
    expect(result).toContain('```wireframe')
  })

  it('includes generic layout visualization section when no mockups', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).toContain('## Layout visualization')
    expect(result).not.toContain('## Layout mockups')
  })

  it('includes decisions when brief has them', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: {
        ...emptyBrief,
        decisions: [{ topic: 'Payment', decision: 'Stripe only' }],
      },
    })
    expect(result).toContain('## Decisions already made')
    expect(result).toContain('**Payment:** Stripe only')
  })

  it('omits decisions section when brief has none', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: emptyBrief,
    })
    expect(result).not.toContain('## Decisions already made')
  })

  it('renders locked decisions in a separate reconciliation block (#71)', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: {
        ...emptyBrief,
        decisions: [
          { topic: 'Stack', decision: 'Next.js, no Vue', locked: true },
          { topic: 'Payment', decision: 'Stripe only' },
        ],
      },
    })
    expect(result).toContain('## Locked decisions — reconcile against these')
    expect(result).toContain('**Stack:** Next.js, no Vue')
    // The locked block instructs the agent to confirm reversals, not silently append.
    expect(result).toMatch(/contradicts.*locked decision/i)
    // The non-locked decision still goes in the regular block.
    expect(result).toContain('## Decisions already made')
    expect(result).toContain('**Payment:** Stripe only')
    // A locked decision must not be duplicated into the regular block.
    const regularBlock = result.split('## Decisions already made')[1] ?? ''
    expect(regularBlock).not.toContain('Next.js, no Vue')
  })

  it('renders the prototype-feedback block when items are present (#72)', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      prototypeFeedback: [
        { type: 'bug', body: 'Checkout button does nothing', path: '/checkout', ageLabel: 'today', resolved: false },
      ],
    })
    expect(result).toContain('## What the maker has reported from the prototype')
    expect(result).toContain('Checkout button does nothing')
    expect(result).toContain('(on /checkout)')
    expect(result).toContain('cannot see the live screen')
  })

  it('omits the prototype-feedback block when there are no items', () => {
    const result = buildSystemPrompt({ ...minimalInput, prototypeFeedback: [] })
    expect(result).not.toContain('## What the maker has reported from the prototype')
  })

  it('omits the locked block when no decision is locked', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: {
        ...emptyBrief,
        decisions: [{ topic: 'Payment', decision: 'Stripe only' }],
      },
    })
    expect(result).not.toContain('## Locked decisions')
  })

  it('includes formatted brief when it has content', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: {
        ...emptyBrief,
        problem: 'Customers cannot order online',
        target_users: 'Local cafe customers',
        features: ['Online ordering', 'Pickup scheduling'],
        constraints: 'Must work on mobile',
      },
    })
    expect(result).toContain('## Current brief')
    expect(result).toContain('**Problem:** Customers cannot order online')
    expect(result).toContain('**Target users:** Local cafe customers')
    expect(result).toContain('- Online ordering')
    expect(result).toContain('- Pickup scheduling')
    expect(result).toContain('**Constraints:** Must work on mobile')
  })

  it('omits brief section when all fields are empty', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: emptyBrief,
    })
    expect(result).not.toContain('## Current brief')
  })

  it('says first session for sessionNumber 1', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionNumber: 1 })
    expect(result).toContain('This is the first session')
    expect(result).not.toContain('session #')
  })

  it('says session number for subsequent sessions', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionNumber: 3 })
    expect(result).toContain('This is session #3')
    expect(result).toContain("pick up where things left off")
  })

  // Posture model tests
  it('includes posture vocabulary in discover mode', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).toContain('Your postures:')
    expect(result).toContain('**Curious**')
    expect(result).toContain('**Deepening**')
    expect(result).toContain('**Challenging**')
    expect(result).toContain('**Confirming**')
    expect(result).toContain('**Yielding**')
    expect(result).toContain('**Closing**')
  })

  it('includes posture vocabulary in converge mode', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(result).toContain('Your postures:')
    expect(result).toContain('**Curious**')
    expect(result).toContain('**Challenging**')
  })

  it('includes signal-to-posture mapping', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).toContain('Reading the user')
    expect(result).toContain('Rich, specific answer → Deepen')
    expect(result).toContain('Vague or optimistic answer → Challenge')
  })

  it('includes guardrails in both modes', () => {
    const discover = buildSystemPrompt(minimalInput)
    const converge = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(discover).toContain('One question per message')
    expect(discover).toContain('Two-strike rule')
    expect(discover).toContain('Accuracy before restatement')
    expect(converge).toContain('One question per message')
    expect(converge).toContain('Two-strike rule')
  })

  it('uses discover gravity in discover mode and converge gravity in converge mode', () => {
    const discover = buildSystemPrompt(minimalInput)
    const converge = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(discover).toContain('Session gravity: discover')
    expect(discover).not.toContain('Session gravity: converge')
    expect(converge).toContain('Session gravity: converge')
    expect(converge).not.toContain('Session gravity: discover')
  })

  it('includes open risks when brief has them', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: {
        ...emptyBrief,
        open_risks: ['No plan for getting first users', 'Pricing model undecided'],
      },
    })
    expect(result).toContain('## Open risks')
    expect(result).toContain('No plan for getting first users')
    expect(result).toContain('Pricing model undecided')
  })

  it('omits open risks section when brief has none', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: emptyBrief,
    })
    expect(result).not.toContain('## Open risks')
  })

  it('uses quality gates instead of exchange count for closing', () => {
    const discover = buildSystemPrompt(minimalInput)
    const converge = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(discover).toContain('Do not close based on exchange count')
    expect(converge).toContain('Do not close based on exchange count')
    expect(discover).not.toContain('8–12 exchanges')
    expect(converge).not.toContain('8–12 exchanges')
  })

  // ---------------------------------------------------------------------------
  // Maker name (#27)
  // ---------------------------------------------------------------------------

  it('includes ## Maker section when makerFirstName is set', () => {
    const result = buildSystemPrompt({ ...minimalInput, makerFirstName: 'Sam' })
    expect(result).toContain('## Maker')
    expect(result).toContain('**Name:** Sam')
  })

  it('omits ## Maker section when makerFirstName is undefined', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).not.toContain('## Maker\n')
  })

  it('## Maker section includes last name when both are provided', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      makerFirstName: 'Sam',
      makerLastName: 'Lee',
    })
    expect(result).toContain('**Name:** Sam Lee')
  })

  // ---------------------------------------------------------------------------
  // Welcome-back recap (#26)
  // ---------------------------------------------------------------------------

  it('omits ## Returning after a break when gap is undefined', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).not.toContain('## Returning after a break')
  })

  it('omits ## Returning after a break when gap is under one hour', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      gapSinceLastMakerMessageMs: 30 * 60 * 1000,
    })
    expect(result).not.toContain('## Returning after a break')
  })

  it('includes ## Returning after a break when gap is at least one hour', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      gapSinceLastMakerMessageMs: 2 * 60 * 60 * 1000,
    })
    expect(result).toContain('## Returning after a break')
    expect(result).toContain('briefly recap')
  })

  it.each([
    [2 * 60 * 60 * 1000, 'a few hours'],
    [12 * 60 * 60 * 1000, 'a few hours'],
    [24 * 60 * 60 * 1000, 'about a day'],
    [3 * 24 * 60 * 60 * 1000, 'a few days'],
    [10 * 24 * 60 * 60 * 1000, 'over a week'],
  ])('humanizes a gap of %i ms as "%s"', (gapMs, expectedPhrase) => {
    const result = buildSystemPrompt({ ...minimalInput, gapSinceLastMakerMessageMs: gapMs })
    expect(result).toContain(expectedPhrase)
  })

  // ---------------------------------------------------------------------------
  // Yield to maker (#28)
  // ---------------------------------------------------------------------------

  it('Directives block no longer pins the old "don\'t leave the session" wording', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      builderDirectives: ['Focus on data flow'],
    })
    expect(result).not.toContain("don't leave the session without covering them")
  })

  it('Directives block frames directives as priorities, not a script', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      builderDirectives: ['Focus on data flow'],
    })
    expect(result).toContain('priorities, not a script')
  })

  it('GUARDRAILS includes the "Their direction wins" rule in both modes', () => {
    const discover = buildSystemPrompt(minimalInput)
    const converge = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(discover).toContain('Their direction wins')
    expect(converge).toContain('Their direction wins')
  })

  // ---------------------------------------------------------------------------
  // Multi-human brief (5b)
  // ---------------------------------------------------------------------------

  it('omits the multi-human block for a single participant', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      makerFirstName: 'Maria',
      participants: [{ name: 'Maria', brief_role: 'originator' }],
    })
    expect(result).not.toContain("## Who's in this conversation")
    // Single participant still gets the regular ## Maker framing.
    expect(result).toContain('## Maker')
    expect(result).toContain('**Name:** Maria')
  })

  it('renders the multi-human roster with role labels when 2+ participants', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      makerFirstName: 'Maria',
      participants: [
        { name: 'Maria', brief_role: 'originator' },
        { name: 'Tom', brief_role: 'contributor' },
      ],
    })
    expect(result).toContain("## Who's in this conversation")
    expect(result).toContain('- **Maria** — Originator')
    expect(result).toContain('- **Tom** — Contributor')
    // Multi-human mode replaces the single-maker block, not stacks with it.
    expect(result).not.toContain('## Maker')
  })

  it('labels a participant without a brief_role as Participant', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      participants: [
        { name: 'Maria', brief_role: 'originator' },
        { name: 'Owner', brief_role: null },
      ],
    })
    expect(result).toContain('- **Owner** — Participant')
  })

  // ---------------------------------------------------------------------------
  // Agent self-awareness (#69): role disclosure + capability honesty
  // ---------------------------------------------------------------------------

  it('default identity frames Sam as intake, not the developer', () => {
    expect(DEFAULT_IDENTITY).toContain('intake step, not the developer')
  })

  it('guardrails clarify Sam is intake not the builder, in both modes', () => {
    const discover = buildSystemPrompt(minimalInput)
    const converge = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(discover).toContain("intake, not the builder")
    expect(converge).toContain("intake, not the builder")
  })

  it('guardrails tell Sam to admit it cannot see the running app, in both modes', () => {
    const discover = buildSystemPrompt(minimalInput)
    const converge = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(discover).toContain("You can't see their app")
    expect(discover).toContain('paste a screenshot')
    expect(converge).toContain("You can't see their app")
  })

  it('first-session intro discloses the intake role', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionNumber: 1 })
    expect(result).toContain("their developer will build from")
  })
})
