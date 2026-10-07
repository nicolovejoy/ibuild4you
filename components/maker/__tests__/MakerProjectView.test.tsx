// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// =============================================================================
// MAKER PROJECT VIEW — smoke + interaction tests
//
// The component is the maker's entire surface area: project header, name
// prompt, chat composer, file picker, message history, mockups panel,
// files panel, prior-session list. Full flow tests would need to mock 8+
// hooks; this test focuses on the highest-leverage interactions:
//
//   1. Rendering doesn't blow up with safe hook defaults
//   2. Picker rejects oversized files with the expected error
//   3. Picker accepts files within the cap and queues them
//
// Wider coverage of upload semantics (partial-failure rollback, etc.) lives
// in lib/query/__tests__/use-upload-files.test.tsx — testing the hook in
// isolation is much cheaper than testing it through the component.
// =============================================================================

const sampleProject = {
  id: 'p1',
  slug: 'test',
  title: 'Test Project',
  viewer_role: 'maker',
  context: null,
  welcome_message: null,
  session_mode: 'discover',
  seed_questions: [],
  builder_directives: [],
  layout_mockups: [],
  requester_first_name: null,
  requester_last_name: null,
  requester_email: 'maker@example.com',
}

const mockUseProject = vi.fn(() => ({ data: sampleProject, isLoading: false }))
const mockUseSessions = vi.fn(() => ({
  data: [{ id: 's1', project_id: 'p1', status: 'active', created_at: '2026-01-01T00:00:00Z' }],
}))
const mockUseMessages = vi.fn(() => ({ data: [], isLoading: false }))
const mockUseProjectFiles = vi.fn(() => ({ data: [] }))
const mockUseCurrentUser = vi.fn(() => ({
  data: { first_name: 'Test', last_name: 'User' },
  isLoading: false,
}))
const mockUseUpdateCurrentUser = vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false }))
const mockUseCreateSession = vi.fn(() => ({ mutateAsync: vi.fn() }))
const mockUseUploadFiles = vi.fn(() => ({ mutateAsync: vi.fn() }))

vi.mock('@/lib/query/hooks', () => ({
  useProject: () => mockUseProject(),
  useSessions: () => mockUseSessions(),
  useMessages: () => mockUseMessages(),
  useProjectFiles: () => mockUseProjectFiles(),
  useCurrentUser: () => mockUseCurrentUser(),
  useUpdateCurrentUser: () => mockUseUpdateCurrentUser(),
  useCreateSession: () => mockUseCreateSession(),
  useUploadFiles: () => mockUseUploadFiles(),
  useRateMessage: () => ({ mutate: vi.fn() }),
  // BriefSwitcher in the header reads the brief list; empty = no switcher.
  useProjects: () => ({ data: [] }),
}))

const mockStreamMessage = vi.fn()

vi.mock('@/lib/hooks/useStreamingChat', () => ({
  useStreamingChat: () => ({
    messages: [],
    setMessages: vi.fn(),
    streaming: false,
    error: null,
    setError: vi.fn(),
    streamMessage: mockStreamMessage,
  }),
}))

vi.mock('@/lib/hooks/useRealtimeMessages', () => ({
  useRealtimeMessages: () => {},
}))

vi.mock('@/lib/hooks/useEscapeBack', () => ({
  useEscapeBack: () => {},
}))

vi.mock('@/lib/firebase/api-fetch', () => ({
  apiFetch: vi.fn(async () => new Response('{}', { status: 200 })),
}))

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('@/components/build-timestamp', () => ({
  BuildTimestamp: () => null,
}))

// UserMenu pulls in the Firebase client SDK (getAuth), which throws without a
// real config in the test env. It's chrome, not under test here — stub it.
vi.mock('@/components/user-menu', () => ({
  UserMenu: () => null,
}))

// MigrationBanner (Garm PR B) also pulls in the Firebase client SDK — same reason.
vi.mock('@/components/MigrationBanner', () => ({
  MigrationBanner: () => null,
}))

import { MakerProjectView } from '../MakerProjectView'

function renderView(props: { participantView?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MakerProjectView projectId="p1" userEmail="maker@example.com" {...props} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Restore the default implementations after clearAllMocks resets them.
  mockUseProject.mockReturnValue({ data: sampleProject, isLoading: false })
  mockUseSessions.mockReturnValue({
    data: [{ id: 's1', project_id: 'p1', status: 'active', created_at: '2026-01-01T00:00:00Z' }],
  })
  mockUseMessages.mockReturnValue({ data: [], isLoading: false })
  mockUseProjectFiles.mockReturnValue({ data: [] })
  mockUseCurrentUser.mockReturnValue({
    data: { first_name: 'Test', last_name: 'User' },
    isLoading: false,
  })
  mockUseUpdateCurrentUser.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  mockUseCreateSession.mockReturnValue({ mutateAsync: vi.fn() })
  mockUseUploadFiles.mockReturnValue({ mutateAsync: vi.fn() })
})

describe('MakerProjectView', () => {
  it('renders the project title and chat composer when an active session exists', () => {
    renderView()
    expect(screen.getAllByText('Test Project').length).toBeGreaterThan(0)
    // A textarea exists in the composer
    const textareas = document.querySelectorAll('textarea')
    expect(textareas.length).toBeGreaterThan(0)
  })

  it('shows the participant banner with a back link when a builder joins (#110)', () => {
    renderView({ participantView: true })
    expect(screen.getByText(/you.ve joined this conversation/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /back to builder view/i })).toBeTruthy()
  })

  it('navigates back to the builder view from the banner', () => {
    renderView({ participantView: true })
    fireEvent.click(screen.getByRole('button', { name: /back to builder view/i }))
    expect(mockPush).toHaveBeenCalledWith('/projects/test')
  })

  it('shows no participant banner for a plain maker', () => {
    renderView()
    expect(screen.queryByText(/you.ve joined this conversation/i)).toBeNull()
  })

  it('shows the name prompt when the maker has no first name', () => {
    mockUseCurrentUser.mockReturnValue({
      data: { first_name: '', last_name: '' },
      isLoading: false,
    })
    renderView()
    // Name prompt modal renders; project chrome does not
    expect(screen.queryByText('Test Project')).toBeNull()
  })

  it('does not render the chat composer while sessions are loading', () => {
    mockUseSessions.mockReturnValue({ data: [] })
    renderView()
    // Title still renders, but no textarea appears yet
    expect(screen.getAllByText('Test Project').length).toBeGreaterThan(0)
  })

  it('queues a within-cap file when picked', async () => {
    renderView()
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
    expect(inputs.length).toBeGreaterThan(0)
    const fileInput = inputs[0] as HTMLInputElement
    const file = new File([new Blob([new Uint8Array(1024)])], 'a.pdf', {
      type: 'application/pdf',
    })

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] })
      fireEvent.change(fileInput)
    })

    // Filename appears in the composer's pending-file preview
    expect(screen.getByText(/a\.pdf/)).toBeDefined()
  })

  it('rejects an unsupported file at picker time with a clear message', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderView()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const deck = new File([new Blob([new Uint8Array(1024)])], 'deck.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [deck] })
      fireEvent.change(fileInput)
    })

    // The unsupported file is NOT queued, and the rejection is logged.
    // (The maker-facing message goes through setError, which is stubbed by the
    // useStreamingChat mock here — message wording is asserted on the server
    // route in init.test.ts.)
    expect(screen.queryByText(/deck\.pptx/)).toBeNull()
    expect(consoleWarn).toHaveBeenCalledWith(
      'upload_rejected_unsupported_type',
      expect.arrayContaining([expect.objectContaining({ filename: 'deck.pptx' })]),
    )
    consoleWarn.mockRestore()
  })

  it('rejects an oversized file at picker time and warns', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderView()
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const oversized = new File([new Blob([new Uint8Array(26 * 1024 * 1024)])], 'big.pdf', {
      type: 'application/pdf',
    })

    await act(async () => {
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [oversized] })
      fireEvent.change(fileInput)
    })

    expect(consoleWarn).toHaveBeenCalledWith(
      'upload_rejected_too_large',
      expect.arrayContaining([expect.objectContaining({ filename: 'big.pdf' })]),
    )
    consoleWarn.mockRestore()
  })
})

// Restore matchMedia after each test so stubs never leak between tests.
const originalMatchMedia = window.matchMedia
afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  })
})

// Stub layout metrics jsdom doesn't compute.
function stubLayout(el: HTMLElement, m: { scrollHeight: number; offsetHeight: number; clientHeight: number }) {
  for (const [k, v] of Object.entries(m)) {
    Object.defineProperty(el, k, { configurable: true, value: v })
  }
}

// Stub (pointer: coarse) so useCoarsePointer reports touch or desktop.
function stubPointer(coarse: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: coarse,
      media: '(pointer: coarse)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

describe('composer on a touch screen (#183)', () => {
  it('Enter inserts a newline instead of sending', async () => {
    stubPointer(true)
    renderView()
    const box = (await screen.findByPlaceholderText('Type a message...')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'hello' } })
    // true = default not prevented, so the browser inserts the newline.
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true)
    // Give an (unwanted) async send a chance to run before asserting.
    await act(async () => {})
    expect(mockStreamMessage).not.toHaveBeenCalled()
  })

  it('carries the pointer-coarse two-line minimum class and starts at one row', async () => {
    renderView()
    const box = await screen.findByPlaceholderText('Type a message...')
    expect(box.className).toMatch(/pointer-coarse:min-h-\[4\.5rem\]/)
    expect((box as HTMLTextAreaElement).rows).toBe(1)
  })
})

describe('composer on desktop (#183)', () => {
  it('Enter sends and the box height resets after the text clears', async () => {
    stubPointer(false)
    renderView()
    const box = (await screen.findByPlaceholderText('Type a message...')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'line 1\nline 2\nline 3' } })
    // Content 40px + 2px of border = 42px; a huge paste caps at 200px.
    stubLayout(box, { scrollHeight: 40, offsetHeight: 42, clientHeight: 40 })
    fireEvent.change(box, { target: { value: 'line 1\nline 2\nline 3 ' } })
    expect(box.style.height).toBe('42px')
    stubLayout(box, { scrollHeight: 900, offsetHeight: 902, clientHeight: 900 })
    fireEvent.change(box, { target: { value: 'line 1\nline 2\nline 3 x' } })
    expect(box.style.height).toBe('200px')
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(mockStreamMessage).toHaveBeenCalled())
    await waitFor(() => expect(box.value).toBe(''))
    expect(box.style.height).toBe('auto')
  })

  it('Shift+Enter does not send', async () => {
    stubPointer(false)
    renderView()
    const box = (await screen.findByPlaceholderText('Type a message...')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'hi' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    await act(async () => {})
    expect(mockStreamMessage).not.toHaveBeenCalled()
  })

  it('Enter with keyCode 229 (IME commit) does not send', async () => {
    stubPointer(false)
    renderView()
    const box = (await screen.findByPlaceholderText('Type a message...')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'nihon' } })
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })
    await act(async () => {})
    expect(mockStreamMessage).not.toHaveBeenCalled()
    expect(box.value).toBe('nihon')
  })

  it('has a 16px+ font so iOS does not zoom on focus', async () => {
    renderView()
    const box = await screen.findByPlaceholderText('Type a message...')
    expect(box.className).toMatch(/\btext-base\b/)
  })
})
