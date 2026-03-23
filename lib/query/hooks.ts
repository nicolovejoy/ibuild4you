import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/firebase/api-fetch'
import type { Project, Session, Message, Brief, MemberRole } from '@/lib/types'

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
    mutationFn: async (payload: { title: string; [key: string]: unknown }) => {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify(payload),
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
    mutationFn: async ({ project_id, email, first_name, last_name }: { project_id: string; email: string; first_name?: string; last_name?: string }) => {
      const res = await apiFetch('/api/projects/share', {
        method: 'POST',
        body: JSON.stringify({ project_id, email, first_name, last_name }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to share project')
      }
      return res.json() as Promise<{ email: string; project_id: string; passcode: string }>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project', variables.project_id] })
      queryClient.invalidateQueries({ queryKey: ['sessions', variables.project_id] })
      queryClient.invalidateQueries({ queryKey: ['passcode', variables.project_id] })
    },
  })
}

export function useProjectPasscode(projectId: string | undefined) {
  return useQuery<string | null>({
    queryKey: ['passcode', projectId],
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/share?project_id=${projectId}`)
      if (!res.ok) return null
      const data = await res.json()
      return data.passcode || null
    },
    enabled: !!projectId,
  })
}

export function useResetPasscode() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (project_id: string) => {
      const res = await apiFetch('/api/projects/share', {
        method: 'PATCH',
        body: JSON.stringify({ project_id }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to reset passcode')
      }
      return res.json() as Promise<{ passcode: string }>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['passcode', variables] })
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      project_id: string
      welcome_message?: string
      seed_questions?: string[]
      context?: string
      title?: string
      builder_directives?: string[]
      session_mode?: 'discover' | 'converge'
      requester_first_name?: string
      requester_last_name?: string
      last_nudged_at?: string
      last_builder_activity_at?: string
      layout_mockups?: import('@/lib/types').WireframeMockup[]
    }) => {
      const res = await apiFetch('/api/projects', {
        method: 'PATCH',
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const resp = await res.json()
        throw new Error(resp.error || 'Failed to update project')
      }
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project', variables.project_id] })
    },
  })
}

export function useGenerateWelcome() {
  return useMutation({
    mutationFn: async (projectId: string) => {
      const res = await apiFetch('/api/projects/welcome', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate welcome message')
      }
      return res.json() as Promise<{ welcome_message: string }>
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (projectId: string) => {
      const res = await apiFetch(`/api/projects?project_id=${projectId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete project')
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

export function useProject(projectId: string | undefined) {
  return useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: async () => {
      // Fetch from the list endpoint and find the one we want
      const res = await apiFetch('/api/projects')
      if (!res.ok) throw new Error('Failed to load project')
      const projects: Project[] = await res.json()
      const project = projects.find((p) => p.id === projectId)
      if (!project) throw new Error('Project not found')
      return project
    },
    enabled: !!projectId,
  })
}

// Resolve a slug or Firestore ID to a project. Used by the project page
// where the URL param could be either format.
export function useResolveProject(slugOrId: string | undefined) {
  return useQuery<Project>({
    queryKey: ['resolveProject', slugOrId],
    queryFn: async () => {
      const res = await apiFetch(`/api/projects?slug=${encodeURIComponent(slugOrId!)}`)
      if (!res.ok) throw new Error('Project not found')
      return res.json()
    },
    enabled: !!slugOrId,
  })
}

export function useProjectRole(projectId: string | undefined) {
  return useQuery<MemberRole | null>({
    queryKey: ['projectRole', projectId],
    queryFn: async () => {
      const res = await apiFetch(`/api/projects/role?project_id=${projectId}`)
      if (!res.ok) throw new Error('Failed to load role')
      const data = await res.json()
      return data.role as MemberRole | null
    },
    enabled: !!projectId,
  })
}

export function useBrief(projectId: string | undefined) {
  return useQuery<Brief | null>({
    queryKey: ['brief', projectId],
    queryFn: async () => {
      const res = await apiFetch(`/api/briefs?project_id=${projectId}`)
      if (!res.ok) throw new Error('Failed to load brief')
      return res.json()
    },
    enabled: !!projectId,
  })
}

export function useUpdateBrief() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ project_id, content }: { project_id: string; content: unknown }) => {
      const res = await apiFetch('/api/briefs', {
        method: 'PUT',
        body: JSON.stringify({ project_id, content }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update brief')
      }
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['brief', variables.project_id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

// --- Sessions ---

export function useCreateSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ project_id }: { project_id: string }) => {
      const res = await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ project_id }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create session')
      }
      return res.json() as Promise<Session>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', variables.project_id] })
      queryClient.invalidateQueries({ queryKey: ['project', variables.project_id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

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

export function useDeleteMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ messageId }: { messageId: string; sessionId: string }) => {
      const res = await apiFetch(`/api/messages?message_id=${messageId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete message')
      }
      return res.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['messages', variables.sessionId] })
    },
  })
}

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
