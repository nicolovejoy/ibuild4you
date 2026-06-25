import { describe, it, expect } from 'vitest'
import { buildNewProjectPrompt } from '../new-project-prompt'
import { buildNextConvoPrompt } from '../next-convo-prompt'
import {
  parseNewProjectPayload,
  parseNextConvoPayload,
  NEXT_CONVO_IMPORT_FIELDS,
} from '@/lib/api/import-payload'
import { normalizeBriefContent } from '@/lib/api/brief-json'
import type { BriefContent } from '@/lib/types'

// =============================================================================
// PREP-PROMPT FERRY — #39 snapshot + paste-back round-trip
//
// The "ferry" is the copy-paste prep loop: a builder copies a prep prompt, pastes
// it into a Claude.ai (Max-sub) conversation, then pastes the returned JSON back.
// Two builders feed it:
//   - buildNewProjectPrompt()  → "new-project" payload (Dashboard Import JSON)
//   - buildNextConvoPrompt()   → "next-convo" payload  (Brief tab paste-back)
//
// IMPORTANT (verified 2026-06-25): the prep prompts are NOT config-driven the way
// docs/verify-38-39-plan.md's "8 permutations" assumed. session_mode /
// seed_questions / builder_directives / identity appear ONLY as output-schema
// field *descriptions* (instructions to the receiving Claude), never injected
// from the project's stored config. The only values that flow INTO the prompt:
//   - new-project: nothing (fully static)
//   - next-convo:  currentBrief (incl. decisions), conversationHistory,
//                  projectTitle, sessionCount
// So the snapshots below permute exactly those inputs; the unit suites
// (new-project-prompt.test.ts / next-convo-prompt.test.ts) already lockstep the
// schema field list. These snapshots catch regressions in the split's prose +
// the dynamic <project>/<current_brief>/<conversation_history> assembly.
// =============================================================================

const lockedBrief: BriefContent = {
  problem: 'Customers cannot order online',
  target_users: 'Local cafe regulars',
  features: ['Online ordering', 'Pickup scheduling'],
  constraints: 'Must work on mobile',
  additional_context: '',
  decisions: [
    { topic: 'Payments', decision: 'Stripe only', locked: true },
    { topic: 'Platform', decision: 'Web-first, no native app at launch' },
  ],
  open_risks: ['No plan yet for first 10 users'],
}

describe('new-project prep prompt (static)', () => {
  it('snapshot — fully static, no input', () => {
    expect(buildNewProjectPrompt()).toMatchSnapshot()
  })
})

describe('next-convo prep prompt — permute the inputs that actually flow in', () => {
  it('snapshot — empty: no brief, no history, session 0', () => {
    expect(
      buildNextConvoPrompt({
        currentBrief: null,
        conversationHistory: [],
        projectTitle: 'Untitled',
        sessionCount: 0,
      }),
    ).toMatchSnapshot()
  })

  it('snapshot — brief present (no decisions), 1 session', () => {
    expect(
      buildNextConvoPrompt({
        currentBrief: {
          problem: 'no online ordering',
          target_users: 'cafe customers',
          features: ['catalog'],
          constraints: '',
          additional_context: '',
          decisions: [],
          open_risks: [],
        },
        conversationHistory: [],
        projectTitle: "Sam's Cafe",
        sessionCount: 1,
      }),
    ).toMatchSnapshot()
  })

  it('snapshot — brief with locked + unlocked decisions and open_risks (case 8)', () => {
    expect(
      buildNextConvoPrompt({
        currentBrief: lockedBrief,
        conversationHistory: [],
        projectTitle: "Sam's Cafe",
        sessionCount: 2,
      }),
    ).toMatchSnapshot()
  })

  it('snapshot — with conversation history, higher session count', () => {
    expect(
      buildNextConvoPrompt({
        currentBrief: lockedBrief,
        conversationHistory: [
          { role: 'assistant', content: 'Welcome back — where did we land on payments?' },
          { role: 'user', content: 'Stripe is locked. Now I want to add gift cards.' },
        ],
        projectTitle: "Sam's Cafe",
        sessionCount: 4,
      }),
    ).toMatchSnapshot()
  })

  it('embeds the locked-decision carry-forward rule', () => {
    const p = buildNextConvoPrompt({
      currentBrief: lockedBrief,
      conversationHistory: [],
      projectTitle: 'X',
      sessionCount: 1,
    })
    // The brief's decisions (incl. the locked one) are serialized into the prompt
    expect(p).toContain('Stripe only')
    expect(p).toContain('"locked": true')
    // …and the rule telling the receiving Claude never to drop a locked decision
    expect(p).toMatch(/NEVER drop, reword, or unset a locked decision/)
  })
})

// =============================================================================
// PASTE-BACK ROUND-TRIP — the ferry's RETURN shape is accepted on the way back.
//
// next-convo output lands at BuilderProjectView:705 → parseNextConvoPayload,
// then brief → PUT /api/briefs (normalizeBriefContent is that route's validator).
// new-project output lands at the Dashboard Import modal → parseNewProjectPayload.
// =============================================================================

describe('paste-back: representative next-convo ferry output round-trips', () => {
  // A realistic payload a Max-sub Claude would return for case (b)/(c): full
  // config + a brief carrying a locked decision.
  const ferryOutput = JSON.stringify({
    _payload_type: 'next-convo',
    brief: {
      problem: 'Customers cannot order online',
      target_users: 'Local cafe regulars',
      features: ['Online ordering', 'Gift cards'],
      constraints: 'Must work on mobile',
      additional_context: '',
      decisions: [{ topic: 'Payments', decision: 'Stripe only', locked: true }],
      open_risks: ['Gift-card fraud path undefined'],
    },
    welcome_message: 'Welcome back, Sam — gift cards next?',
    session_mode: 'converge',
    seed_questions: ['Should gift cards be redeemable in-store?'],
    builder_directives: ['Push toward a decision on gift-card scope'],
    identity: 'A pragmatic intake guide',
  })

  it('parseNextConvoPayload accepts it and extracts brief + projectUpdate', () => {
    const r = parseNextConvoPayload(ferryOutput)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.mode).toBe('multi')
    if (r.value.mode !== 'multi') return
    // every NEXT_CONVO_IMPORT_FIELD present in the payload is forwarded to PATCH
    expect(r.value.projectUpdate.session_mode).toBe('converge')
    expect(r.value.projectUpdate.seed_questions).toEqual([
      'Should gift cards be redeemable in-store?',
    ])
    expect(r.value.projectUpdate.builder_directives).toEqual([
      'Push toward a decision on gift-card scope',
    ])
    expect(r.value.projectUpdate.identity).toBe('A pragmatic intake guide')
  })

  it('the extracted brief passes the PUT /api/briefs validator, preserving the locked decision', () => {
    const parsed = parseNextConvoPayload(ferryOutput)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.value.mode !== 'multi') return
    const norm = normalizeBriefContent(parsed.value.brief)
    expect(norm.ok).toBe(true)
    if (!norm.ok) return
    expect(norm.value.decisions).toEqual([
      { topic: 'Payments', decision: 'Stripe only', locked: true },
    ])
    expect(norm.value.features).toEqual(['Online ordering', 'Gift cards'])
  })

  it('rejects a next-convo payload pasted into the new-project slot (wrong place)', () => {
    const r = parseNewProjectPayload(ferryOutput)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/paste it into the Brief tab/)
  })
})

describe('paste-back: representative new-project ferry output round-trips', () => {
  const ferryOutput = JSON.stringify({
    _payload_type: 'new-project',
    title: "Sam's Cafe App",
    requester_email: 'sam@example.com',
    requester_first_name: 'Sam',
    session_mode: 'discover',
    seed_questions: ['What problem are you solving?'],
    brief: {
      problem: 'Customers cannot order online',
      features: ['Online ordering'],
      decisions: [],
    },
  })

  it('parseNewProjectPayload accepts it (title present)', () => {
    const r = parseNewProjectPayload(ferryOutput)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.title).toBe("Sam's Cafe App")
  })

  it('rejects a new-project payload pasted into the brief slot (wrong place)', () => {
    const r = parseNextConvoPayload(ferryOutput)
    // parseNextConvoPayload rejects because _payload_type !== 'next-convo'
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/Import JSON/)
  })
})
