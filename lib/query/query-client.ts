import { QueryClient } from '@tanstack/react-query'

// staleTime tiers (overridden per-hook where appropriate):
//   default: 30s for list-shaped reads
//   useCurrentUser: 5min   — roles rarely change
//   useProjects / useResolveProject: 60s
//   useMessages: 0         — realtime listener owns freshness
//   useFileUrl: 30min      — file content doesn't change
//
// retry: 1 — kept conservative. During Firestore quota incidents the retry
// doubles burn; the auth-cache + read-budget work upstream mitigates that.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
    },
    mutations: {
      retry: 1,
    },
  },
})
