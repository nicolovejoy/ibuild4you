// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { copy } from '@/lib/copy'
import { makerCopy } from '@/lib/copy-maker'
import { LocaleContext } from '@/components/locale-context'
import { queryKeys } from '@/lib/query/keys'
import ProjectPage from '../page'

// The project page when the lookup fails (#291): a 404 says the brief was not
// found, any other failure says it could not be loaded, and neither hangs on
// Loading. The lookup is scripted per case through apiFetch.

type Answer = Promise<Response>
const apiFetch = vi.fn<(path: string) => Answer>()
vi.mock('@/lib/firebase/api-fetch', () => ({ apiFetch: (...a: [string]) => apiFetch(...a) }))
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'viewer@example.com' },
    loading: false,
    isAuthenticated: true,
    signOut: vi.fn(),
  }),
}))
vi.mock('@/lib/hooks/useApproval', () => ({
  useApproval: () => ({ approved: true, loading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: 'gone-brief' }),
  useSearchParams: () => new URLSearchParams(''),
}))
// Stand-ins for the two views: a marker tells a test the view is mounted.
vi.mock('@/components/builder/BuilderProjectView', () => ({
  BuilderProjectView: () => <div data-testid="project-view" />,
}))
vi.mock('@/components/maker/MakerProjectView', () => ({
  MakerProjectView: () => <div data-testid="project-view" />,
}))

const lookups = () =>
  apiFetch.mock.calls.filter(([path]) => path.startsWith('/api/projects?slug=')).length
const answerEveryLookup = (status: number, body: object) =>
  apiFetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })))

// The app's default retry (one), without its delay between tries.
function renderPage(wrapper: (children: ReactNode) => ReactNode = (c) => c) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
  render(<QueryClientProvider client={client}>{wrapper(<ProjectPage />)}</QueryClientProvider>)
  return client
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  apiFetch.mockReset()
})
afterEach(cleanup)

describe('ProjectPage when the brief cannot be shown', () => {
  it('says the brief was not found, links to the dashboard, and asks only once on a 404', async () => {
    answerEveryLookup(404, { error: 'Project not found' })
    renderPage()

    expect(await screen.findByText(copy.projectPage.notFound)).toBeTruthy()
    const link = screen.getByRole('link', { name: copy.projectPage.backToDashboard })
    expect(link.getAttribute('href')).toBe('/dashboard')
    expect(screen.queryByText(copy.loading)).toBeNull()
    await wait(50)
    expect(lookups()).toBe(1)
  })

  it('says the brief could not be loaded after one retry on a server error', async () => {
    answerEveryLookup(500, { error: 'boom' })
    renderPage()

    expect(await screen.findByText(copy.projectPage.loadFailed)).toBeTruthy()
    await wait(50)
    expect(lookups()).toBe(2)
  })

  it('says it in French for a French viewer', async () => {
    answerEveryLookup(404, { error: 'Project not found' })
    renderPage((children) => (
      <LocaleContext.Provider
        value={{
          locale: 'fr',
          preferredLocale: 'fr',
          setLocale: () => {},
          rememberLocale: () => {},
          setBriefLanguage: () => {},
          setPageLocale: () => {},
        }}
      >
        {children}
      </LocaleContext.Provider>
    ))

    expect(await screen.findByText(makerCopy.fr.projectPage.notFound)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: makerCopy.fr.projectPage.backToDashboard })
    ).toBeTruthy()
  })

  it('still shows Loading while the lookup is pending', async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}))
    renderPage()

    expect(await screen.findByText(copy.loading)).toBeTruthy()
    expect(screen.queryByText(copy.projectPage.notFound)).toBeNull()
    expect(screen.queryByText(copy.projectPage.loadFailed)).toBeNull()
  })

  describe('after the brief has loaded', () => {
    // First lookup answers with a project; anything else (the auto-claim) answers 200.
    async function renderLoaded() {
      const project = { id: 'p1', slug: 'gone-brief', viewer_role: 'maker' }
      apiFetch.mockImplementation((path) =>
        Promise.resolve(
          new Response(JSON.stringify(path.startsWith('/api/projects?slug=') ? project : {}), {
            status: 200,
          })
        )
      )
      const client = renderPage()
      expect(await screen.findByTestId('project-view')).toBeTruthy()
      return client
    }

    // Refetch the page's lookup, then let React Query's batched notification reach the page.
    async function refetchLookup(client: QueryClient) {
      await act(async () => {
        await client.refetchQueries({ queryKey: queryKeys.resolveProject('gone-brief') })
        await wait(20)
      })
    }

    it('keeps the loaded view when a later refetch fails', async () => {
      const client = await renderLoaded()
      answerEveryLookup(500, { error: 'boom' })

      await refetchLookup(client)

      expect(screen.getByTestId('project-view')).toBeTruthy()
      expect(screen.queryByText(copy.projectPage.loadFailed)).toBeNull()
      expect(screen.queryByText(copy.projectPage.notFound)).toBeNull()
    })

    it('switches to not found when a later refetch answers 404', async () => {
      const client = await renderLoaded()
      answerEveryLookup(404, { error: 'Project not found' })

      await refetchLookup(client)

      expect(screen.getByText(copy.projectPage.notFound)).toBeTruthy()
      expect(screen.queryByTestId('project-view')).toBeNull()
    })
  })
})
