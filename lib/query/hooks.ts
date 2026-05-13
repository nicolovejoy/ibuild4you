import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { queryKeys } from './keys'
import type { Project, Session, Message, Brief, SystemRole, ProjectFile } from '@/lib/types'

// --- Current user ---

export type CurrentUser = {
  uid: string
  email: string
  system_roles: SystemRole[]
  first_name: string | null
  last_name: string | null
}

export function useCurrentUser() {
  return useQuery<CurrentUser>({
    queryKey: queryKeys.currentUser(),
    queryFn: async () => {
      const res = await apiFetch('/api/users/me')
      if (!res.ok) throw new Error('Failed to load user')
      return res.json()
    },
    staleTime: 1000 * 60 * 5, // 5 min — roles rarely change
  })
}

export function useUpdateCurrentUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: { first_name: string; last_name?: string }) => {
      const res = await apiFetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update user')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.currentUser() })
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    },
  })
}

// --- Projects ---

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: queryKeys.projects(),
    queryFn: async () => {
      const res = await apiFetch('/api/projects')
      if (!res.ok) throw new Error('Failed to load projects')
      return res.json()
    },
    staleTime: 60 * 1000, // 60s — list-level data
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
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
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
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
      queryClient.invalidateQueries({ queryKey: queryKeys.project(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.resolveProject(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.passcode(variables.project_id) })
    },
  })
}

export function useProjectPasscode(projectId: string | undefined) {
  return useQuery<string | null>({
    queryKey: queryKeys.passcode(projectId),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.passcode(variables) })
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: {
      project_id: string
      welcome_message?: string
      nudge_message?: string
      voice_sample?: string
      seed_questions?: string[]
      context?: string
      title?: string
      builder_directives?: string[]
      session_mode?: 'discover' | 'converge'
      requester_first_name?: string
      requester_last_name?: string
      last_nudged_at?: string
      last_builder_activity_at?: string
      identity?: string
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
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
      queryClient.invalidateQueries({ queryKey: queryKeys.project(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.resolveProject(variables.project_id) })
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

export function useGenerateOutboundMessage() {
  return useMutation({
    mutationFn: async (params: {
      project_id: string
      type: 'invite' | 'nudge' | 'reminder'
      nudge_note?: string
      session_mode?: 'discover' | 'converge'
      session_number?: number
      // invite-only — seed questions inform invite copy
      seed_questions?: string[]
    }) => {
      const res = await apiFetch('/api/projects/outbound-message', {
        method: 'POST',
        body: JSON.stringify(params),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate message')
      }
      return res.json() as Promise<{ message: string }>
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
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
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
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    },
  })
}

// Resolve a slug or Firestore ID to a single project. The response includes
// `viewer_role`, so callers no longer need a separate /api/projects/role hit.
export function useResolveProject(slugOrId: string | undefined) {
  return useQuery<Project>({
    queryKey: queryKeys.resolveProject(slugOrId),
    queryFn: async () => {
      const res = await apiFetch(`/api/projects?slug=${encodeURIComponent(slugOrId!)}`)
      if (!res.ok) throw new Error('Project not found')
      return res.json()
    },
    enabled: !!slugOrId,
    staleTime: 60 * 1000,
  })
}

// Single-project lookup by ID. Delegates to useResolveProject — the endpoint
// accepts either a slug or a Firestore doc ID.
export function useProject(projectId: string | undefined) {
  return useResolveProject(projectId)
}

export function useBrief(projectId: string | undefined) {
  return useQuery<Brief | null>({
    queryKey: queryKeys.brief(projectId),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.brief(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
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
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.project(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.resolveProject(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    },
  })
}

export function useSessions(projectId: string | undefined) {
  return useQuery<Session[]>({
    queryKey: queryKeys.sessions(projectId),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.messages(variables.sessionId) })
    },
  })
}

export function useMessages(sessionId: string | undefined) {
  return useQuery<Message[]>({
    queryKey: queryKeys.messages(sessionId),
    queryFn: async () => {
      const res = await apiFetch(`/api/messages?session_id=${sessionId}`)
      if (!res.ok) throw new Error('Failed to load messages')
      return res.json()
    },
    enabled: !!sessionId,
    staleTime: 0, // realtime listener (useRealtimeMessages) owns freshness
  })
}

// --- Files ---

export function useProjectFiles(projectId: string | undefined) {
  return useQuery<ProjectFile[]>({
    queryKey: queryKeys.files(projectId),
    queryFn: async () => {
      const res = await apiFetch(`/api/files?project_id=${projectId}`)
      if (!res.ok) throw new Error('Failed to load files')
      return res.json()
    },
    enabled: !!projectId,
  })
}

// Three-step upload flow (bypasses Vercel's ~4.5MB function-body cap):
//   1. POST /api/files/init   → { file_id, upload_url } and a pending Firestore doc
//   2. PUT  upload_url        → bytes go straight to S3
//   3. POST /api/files/:id/confirm → flips status to 'ready', returns ProjectFile
async function uploadOne(file: File, projectId: string, sessionId?: string): Promise<ProjectFile> {
  const initRes = await apiFetch('/api/files/init', {
    method: 'POST',
    body: JSON.stringify({
      project_id: projectId,
      session_id: sessionId,
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
    }),
  })
  if (!initRes.ok) {
    const data = await initRes.json().catch(() => ({}))
    throw new Error(data?.error || `Upload init failed (${initRes.status})`)
  }
  const { file_id, upload_url } = await initRes.json()

  const putRes = await fetch(upload_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
  if (!putRes.ok) {
    throw new Error(`Direct S3 upload failed (${putRes.status})`)
  }

  const confirmRes = await apiFetch(`/api/files/${file_id}/confirm`, { method: 'POST' })
  if (!confirmRes.ok) {
    const data = await confirmRes.json().catch(() => ({}))
    throw new Error(data?.error || `Upload confirm failed (${confirmRes.status})`)
  }
  return confirmRes.json() as Promise<ProjectFile>
}

// Atomic upload semantics: every file runs to completion independently. The
// mutation always resolves with both lists; one bad file no longer aborts the
// batch and orphans the successful uploads. Callers decide how to surface
// `failed` (typically: send the message with the successful subset, restore
// the failed files to the picker for retry).
export type UploadFilesResult = {
  uploaded: ProjectFile[]
  failed: { file: File; error: string }[]
}

export function useUploadFiles() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      sessionId,
      files,
    }: {
      projectId: string
      sessionId?: string
      files: File[]
    }): Promise<UploadFilesResult> => {
      const settled = await Promise.allSettled(
        files.map((f) => uploadOne(f, projectId, sessionId)),
      )
      const uploaded: ProjectFile[] = []
      const failed: { file: File; error: string }[] = []
      settled.forEach((s, i) => {
        if (s.status === 'fulfilled') {
          uploaded.push(s.value)
        } else {
          failed.push({
            file: files[i],
            error: s.reason instanceof Error ? s.reason.message : String(s.reason),
          })
        }
      })
      return { uploaded, failed }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.files(variables.projectId) })
    },
  })
}

export function useFileUrl(fileId: string | undefined) {
  return useQuery<string>({
    queryKey: queryKeys.fileUrl(fileId),
    queryFn: async () => {
      const res = await apiFetch(`/api/files/${fileId}`)
      if (!res.ok) throw new Error('Failed to load file')
      const blob = await res.blob()
      return URL.createObjectURL(blob)
    },
    enabled: !!fileId,
    staleTime: 1000 * 60 * 30, // 30 min — file content doesn't change
  })
}
