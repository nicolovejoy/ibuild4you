import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shadowCheckApprovedEmail, scheduleGarmShadowCheck, GARM_SHADOW_PROJECT } from '../garm-shadow'

// =============================================================================
// Garm shadow mode — observation only, never authoritative (see garm-shadow.ts
// header + docs/garm-consumer-plan.md Phase 4). garmCheck is mocked; no
// network, no real Garm.
// =============================================================================

vi.mock('../garm', () => ({ garmCheck: vi.fn() }))
import { garmCheck } from '../garm'

const OLD_ENV = { ...process.env }

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('shadowCheckApprovedEmail', () => {
  it('checks the ibuild4you project at viewer', async () => {
    vi.mocked(garmCheck).mockResolvedValue({ allowed: true, role: 'viewer' })
    await shadowCheckApprovedEmail('sam@example.com', true)
    expect(garmCheck).toHaveBeenCalledWith('sam@example.com', GARM_SHADOW_PROJECT, 'viewer')
  })

  it('stays silent when both agree (allowed/allowed)', async () => {
    vi.mocked(garmCheck).mockResolvedValue({ allowed: true, role: 'viewer' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await shadowCheckApprovedEmail('sam@example.com', true)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('stays silent when both agree (denied/denied)', async () => {
    vi.mocked(garmCheck).mockResolvedValue({ allowed: false, role: null })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await shadowCheckApprovedEmail('sam@example.com', false)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('logs a mismatch when local allows but Garm denies', async () => {
    vi.mocked(garmCheck).mockResolvedValue({ allowed: false, role: null })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await shadowCheckApprovedEmail('sam@example.com', true)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const line = warnSpy.mock.calls[0][0] as string
    expect(line).toContain('[garm-shadow] mismatch:')
    expect(line).toContain('local=true')
    expect(line).toContain('garm=false')
    expect(line).toContain('role=null')
    expect(line).toContain('route=isApprovedEmail')
  })

  it('logs a mismatch when local denies but Garm allows, including the display role', async () => {
    vi.mocked(garmCheck).mockResolvedValue({ allowed: true, role: 'owner' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await shadowCheckApprovedEmail('sam@example.com', false)
    const line = warnSpy.mock.calls[0][0] as string
    expect(line).toContain('local=false')
    expect(line).toContain('garm=true')
    expect(line).toContain('role=owner')
  })

  it('never includes the email in the mismatch log (PII)', async () => {
    vi.mocked(garmCheck).mockResolvedValue({ allowed: false, role: null })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await shadowCheckApprovedEmail('very-identifying-name@example.com', true)
    const loggedText = warnSpy.mock.calls.flat().join(' ')
    expect(loggedText).not.toContain('very-identifying-name')
    expect(loggedText).not.toContain('@example.com')
  })
})

describe('scheduleGarmShadowCheck — kill switch', () => {
  it('never invokes run when GARM_SHADOW is unset (default off)', async () => {
    delete process.env.GARM_SHADOW
    const run = vi.fn().mockResolvedValue(undefined)
    scheduleGarmShadowCheck(run)
    await Promise.resolve()
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
  })

  it('never invokes run when GARM_SHADOW=off', async () => {
    process.env.GARM_SHADOW = 'off'
    const run = vi.fn().mockResolvedValue(undefined)
    scheduleGarmShadowCheck(run)
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
  })

  it('never invokes run for any other stray value (only exactly "on" enables it)', async () => {
    process.env.GARM_SHADOW = 'true'
    const run = vi.fn().mockResolvedValue(undefined)
    scheduleGarmShadowCheck(run)
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
  })

  it('invokes run when GARM_SHADOW=on (falls back to plain fire-and-forget outside a request scope — no after() context in this test)', async () => {
    process.env.GARM_SHADOW = 'on'
    const run = vi.fn().mockResolvedValue(undefined)
    scheduleGarmShadowCheck(run)
    await Promise.resolve()
    await Promise.resolve()
    expect(run).toHaveBeenCalledOnce()
  })

  it('does not throw or reject the caller when run rejects', async () => {
    process.env.GARM_SHADOW = 'on'
    const run = vi.fn().mockRejectedValue(new Error('boom'))
    expect(() => scheduleGarmShadowCheck(run)).not.toThrow()
    // let the rejection settle without an unhandled-rejection failure
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
})
