import { useCallback, useState } from 'react'
import { useUpdateProject } from '@/lib/query/hooks'

/**
 * Copy a nudge/reminder message to the clipboard and record it as "sent"
 * (copying is treated as sending). Flips `copied` true for 2s and stamps
 * `last_nudged_at` + `last_builder_activity_at` on the project.
 *
 * Extracted from the two identical copy-and-track blocks in BuilderProjectView
 * (RenudgeCard + PrepNextSession).
 */
export function useNudgeCopy(projectId: string) {
  const [copied, setCopied] = useState(false)
  const updateProject = useUpdateProject()

  const copyNudge = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      const now = new Date().toISOString()
      updateProject.mutate({
        project_id: projectId,
        last_nudged_at: now,
        last_builder_activity_at: now,
      })
    },
    [projectId, updateProject]
  )

  return { copied, copyNudge }
}
