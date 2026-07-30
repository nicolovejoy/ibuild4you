import { describe, it, expect } from 'vitest'
import {
  selectProjectView,
  isBuilderSideRole,
  countsAsMakerActivity,
} from '@/lib/projects/project-view'

// =============================================================================
// PROJECT VIEW SELECTION (#110)
//
// Pins the role → view dispatch for /projects/[id]. Builder-side roles
// (owner, builder, admin) get the read-only BuilderProjectView by default and
// can explicitly join the maker chat via ?view=chat; maker-side roles
// (maker, apprentice) always get the chat. These tests exist because the
// dispatch previously lived untested in page.tsx and locked admins out of
// every conversation.
// =============================================================================

describe('selectProjectView', () => {
  it('gives maker-side roles the maker view regardless of the view param', () => {
    expect(selectProjectView('maker', null)).toBe('maker')
    expect(selectProjectView('maker', 'chat')).toBe('maker')
    expect(selectProjectView('apprentice', null)).toBe('maker')
    expect(selectProjectView('apprentice', 'chat')).toBe('maker')
  })

  it('gives builder-side roles the builder view by default', () => {
    expect(selectProjectView('owner', null)).toBe('builder')
    expect(selectProjectView('builder', null)).toBe('builder')
    expect(selectProjectView('admin', null)).toBe('builder')
  })

  it('lets builder-side roles join the chat via ?view=chat', () => {
    expect(selectProjectView('owner', 'chat')).toBe('maker')
    expect(selectProjectView('builder', 'chat')).toBe('maker')
    expect(selectProjectView('admin', 'chat')).toBe('maker')
  })

  it('ignores unknown view params', () => {
    expect(selectProjectView('owner', 'banana')).toBe('builder')
    expect(selectProjectView('builder', '')).toBe('builder')
  })
})

describe('isBuilderSideRole', () => {
  it('is true for owner, builder, and admin', () => {
    expect(isBuilderSideRole('owner')).toBe(true)
    expect(isBuilderSideRole('builder')).toBe(true)
    expect(isBuilderSideRole('admin')).toBe(true)
  })

  it('is false for maker, apprentice, and null', () => {
    expect(isBuilderSideRole('maker')).toBe(false)
    expect(isBuilderSideRole('apprentice')).toBe(false)
    expect(isBuilderSideRole(null)).toBe(false)
  })
})

describe('countsAsMakerActivity', () => {
  it('counts maker and apprentice messages', () => {
    expect(countsAsMakerActivity('maker')).toBe(true)
    expect(countsAsMakerActivity('apprentice')).toBe(true)
  })

  it('excludes builder-side senders and null', () => {
    // getProjectRole resolves system admins to 'owner', so 'owner' also
    // covers the admin case server-side.
    expect(countsAsMakerActivity('builder')).toBe(false)
    expect(countsAsMakerActivity('owner')).toBe(false)
    expect(countsAsMakerActivity(null)).toBe(false)
  })
})
