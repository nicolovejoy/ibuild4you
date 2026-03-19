import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/firebase/api-fetch'
import type { Project, Session, Message } from '@/lib/types'

// --- Projects ---

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await apiFetch('/api/projects')
      if (!res.ok) throw new Error('Failed to load projects')
      return res.json()
    },
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ title, context }: { title: string; context?: string }) => {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ title, context }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create project')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useShareProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ project_id, email }: { project_id: string; email: string }) => {
      const res = await apiFetch('/api/projects/share', {
        method: 'POST',
        body: JSON.stringify({ project_id, email }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to share project')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useClaimProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (project_id: string) => {
      const res = await apiFetch('/api/projects/claim', {
        method: 'POST',
        body: JSON.stringify({ project_id }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to claim project')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

// --- Sessions ---

export function useSessions(projectId: string | undefined) {
  return useQuery<Session[]>({
    queryKey: ['sessions', projectId],
    queryFn: async () => {
      const res = await apiFetch(`/api/sessions?project_id=${projectId}`)
      if (!res.ok) throw new Error('Failed to load sessions')
      return res.json()
    },
    enabled: !!projectId,
  })
}

// --- Messages ---

export function useMessages(sessionId: string | undefined) {
  return useQuery<Message[]>({
    queryKey: ['messages', sessionId],
    queryFn: async () => {
      const res = await apiFetch(`/api/messages?session_id=${sessionId}`)
      if (!res.ok) throw new Error('Failed to load messages')
      return res.json()
    },
    enabled: !!sessionId,
  })
}
