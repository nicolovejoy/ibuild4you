// Centralized React Query key factories. Keep all keys behind these helpers
// so invalidation is grep-able and the same query never has two key shapes.

export const queryKeys = {
  currentUser: () => ['currentUser'] as const,
  projects: () => ['projects'] as const,
  project: (idOrSlug: string | undefined) => ['project', idOrSlug] as const,
  resolveProject: (slugOrId: string | undefined) => ['resolveProject', slugOrId] as const,
  passcode: (projectId: string | undefined) => ['passcode', projectId] as const,
  brief: (projectId: string | undefined) => ['brief', projectId] as const,
  sessions: (projectId: string | undefined) => ['sessions', projectId] as const,
  messages: (sessionId: string | undefined) => ['messages', sessionId] as const,
  files: (projectId: string | undefined) => ['files', projectId] as const,
  fileUrl: (fileId: string | undefined) => ['fileUrl', fileId] as const,
}
