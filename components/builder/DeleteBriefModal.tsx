'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { useDeleteProject } from '@/lib/query/hooks'
import { copy } from '@/lib/copy'
import type { Project } from '@/lib/types'

// Owner-only destructive delete, opened from the Settings tab's Delete row
// (moved off the dashboard card in #16). Type-"delete"-to-confirm; on success the brief
// is gone, so we leave the brief view for the dashboard.
export function DeleteBriefModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const router = useRouter()
  const [confirmation, setConfirmation] = useState('')
  const deleteProject = useDeleteProject()
  const canDelete = confirmation.toLowerCase() === 'delete'

  return (
    <Modal isOpen onClose={onClose} title={`Delete "${project.title}"?`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-700">{copy.deleteProject.warning}</p>
        <div>
          <label
            htmlFor="brief-delete-confirm"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Type <span className="font-mono font-bold">delete</span> to confirm
          </label>
          <input
            id="brief-delete-confirm"
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="delete"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
            autoFocus
          />
        </div>
        {deleteProject.error && (
          <StatusMessage type="error" message={deleteProject.error.message} />
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <LoadingButton
            variant="danger"
            loading={deleteProject.isPending}
            loadingText="Deleting..."
            disabled={!canDelete}
            onClick={async () => {
              try {
                await deleteProject.mutateAsync(project.id)
                router.push('/dashboard')
              } catch {
                // error shown via deleteProject.error
              }
            }}
          >
            Delete
          </LoadingButton>
        </div>
      </div>
    </Modal>
  )
}
