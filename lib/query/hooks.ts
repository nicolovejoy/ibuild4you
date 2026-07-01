import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { queryKeys } from './keys'
import type { Project, Session, Message, Brief, SystemRole, ProjectFile, ProjectMemberSummary } from '@/lib/types'

// --- Current user ---

export type CurrentUser = {
  uid: string
  email: string
  system_roles: SystemRole[]
  first_name: string | null
  last_name: string | null
  account_label: string | null
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
    mutationFn: async (data: {
      first_name?: string
      last_name?: string
      account_label?: string
    }) => {
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
    mutationFn: async ({ project_id, email, first_name, last_name, role, brief_role }: { project_id: string; email: string; first_name?: string; last_name?: string; role?: string; brief_role?: string }) => {
      const res = await apiFetch('/api/projects/share', {
        method: 'POST',
        body: JSON.stringify({ project_id, email, first_name, last_name, role, brief_role }),
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
      queryClient.invalidateQueries({ queryKey: queryKeys.members(variables.project_id) })
    },
  })
}

// Builder-initiated direct email to the maker via Resend (invite / nudge /
// reminder). Server resolves the recipient + body; we just pick the kind.
export function useSendMakerEmail() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      project_id,
      kind,
      note,
    }: {
      project_id: string
      kind: 'invite' | 'nudge' | 'reminder'
      note?: string
    }) => {
      const res = await apiFetch(`/api/projects/${project_id}/email`, {
        method: 'POST',
        body: JSON.stringify({ kind, note }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to send email')
      }
      return res.json() as Promise<{ ok: true; emailId: string; to: string; suppressed?: boolean }>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
      queryClient.invalidateQueries({ queryKey: queryKeys.project(variables.project_id) })
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

// Correct the originator's email (#12). Re-keys the membership row +
// approved_emails on the server and reissues a passcode, so any invite sent to
// the wrong address stops working. Invalidates the project + passcode caches.
export function useChangeRequesterEmail() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ project_id, new_email }: { project_id: string; new_email: string }) => {
      const res = await apiFetch('/api/projects/share', {
        method: 'PATCH',
        body: JSON.stringify({ project_id, new_email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update email')
      }
      return res.json() as Promise<{ email: string; passcode: string }>
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
      queryClient.invalidateQueries({ queryKey: queryKeys.project(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.resolveProject(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.passcode(variables.project_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.members(variables.project_id) })
    },
  })
}

// --- Project members / roles (3c) ---

export function useProjectMembers(
  projectId: string | undefined,
  enabled = true,
  includeRemoved = false
) {
  return useQuery<ProjectMemberSummary[]>({
    // includeRemoved is part of the key so the two views cache separately;
    // mutations invalidate by the ['members', projectId] prefix, which matches both.
    queryKey: [...queryKeys.members(projectId), includeRemoved],
    enabled: !!projectId && enabled,
    queryFn: async () => {
      const res = await apiFetch(
        `/api/projects/${projectId}/members${includeRemoved ? '?include_removed=1' : ''}`
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load members')
      }
      const data = (await res.json()) as { members: ProjectMemberSummary[] }
      return data.members
    },
  })
}

export function useSetBriefRole(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ email, brief_role }: { email: string; brief_role: string | null }) => {
      const res = await apiFetch('/api/projects/role', {
        method: 'PATCH',
        body: JSON.stringify({ project_id: projectId, email, brief_role }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update role')
      }
      return res.json() as Promise<{ ok: boolean; brief_role: string | null }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.resolveProject(projectId) })
    },
  })
}

// Change a member's access tier (#106 P1). Distinct axis from brief_role: this
// is the permission level (owner/builder/apprentice/maker). The last active
// owner can't be demoted — the API guards it and surfaces the reason.
export function useSetMemberRole(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: string }) => {
      const res = await apiFetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update access tier')
      }
      return res.json() as Promise<{ ok: boolean; role: string }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.resolveProject(projectId) })
    },
  })
}

// Move a member out of a brief (#106 P2) — non-destructive (sets removed_at).
// The last owner can't be removed; the API guards it and surfaces the reason.
export function useRemoveMember(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (memberId: string) => {
      const res = await apiFetch(`/api/projects/${projectId}/members/${memberId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to remove member')
      }
      return res.json() as Promise<{ ok: boolean }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.resolveProject(projectId) })
    },
  })
}

// Restore a moved-out member (#106 P2) — clears removed_at.
export function useRestoreMember(projectId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (memberId: string) => {
      const res = await apiFetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ removed: false }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to restore member')
      }
      return res.json() as Promise<{ ok: boolean }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.resolveProject(projectId) })
    },
  })
}

// Reveal a single member's sign-in passcode on demand (#81), so the operator can
// re-send a previously-invited person THEIR OWN creds. A mutation (not a query)
// because the secret is fetched only on an explicit click, never cached.
export function useRevealMemberPasscode(projectId: string | undefined) {
  return useMutation({
    mutationFn: async (memberId: string) => {
      const res = await apiFetch(`/api/projects/${projectId}/members/${memberId}/passcode`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to reveal passcode')
      }
      return res.json() as Promise<{ passcode: string; email: string }>
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
      auto_reminders_enabled?: boolean
      github_repo?: string
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

// AI "prep" call for the dispatch card — drafts the maker nudge + a one-line
// builder focus summary in one shot. Idempotent server-side (returns cached when
// config is unchanged), so it's safe to fire eagerly on mount / after a save.
export function useGeneratePrep() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ project_id, force }: { project_id: string; force?: boolean }) => {
      const res = await apiFetch(`/api/projects/${project_id}/prep/generate`, {
        method: 'POST',
        body: JSON.stringify({ force: force ?? false }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to prep next session')
      }
      return res.json() as Promise<{
        focus: string
        nudge_message: string
        cached?: boolean
        fallback?: boolean
      }>
    },
    onSuccess: (data, variables) => {
      // Only refresh the project cache when something actually changed — avoids a
      // refetch loop when the eager mount-fire hits the cached path.
      if (!data.cached) {
        queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
        queryClient.invalidateQueries({ queryKey: queryKeys.project(variables.project_id) })
        queryClient.invalidateQueries({ queryKey: queryKeys.resolveProject(variables.project_id) })
      }
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

// Archive/unarchive a brief from the caller's own dashboard (per-viewer).
export function useArchiveProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ project_id, archived }: { project_id: string; archived: boolean }) => {
      const res = await apiFetch('/api/projects/archive', {
        method: 'PATCH',
        body: JSON.stringify({ project_id, archived }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update archive state')
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

export function useDeleteFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ fileId }: { fileId: string; projectId: string }): Promise<void> => {
      const res = await apiFetch(`/api/files/${fileId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Delete failed (${res.status})`)
      }
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
