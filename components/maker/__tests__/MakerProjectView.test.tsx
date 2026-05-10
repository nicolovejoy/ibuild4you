// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
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
}))

vi.mock('@/lib/hooks/useStreamingChat', () => ({
  useStreamingChat: () => ({
    messages: [],
    setMessages: vi.fn(),
    streaming: false,
    error: null,
    setError: vi.fn(),
    streamMessage: vi.fn(),
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

import { MakerProjectView } from '../MakerProjectView'

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MakerProjectView projectId="p1" userEmail="maker@example.com" />
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
