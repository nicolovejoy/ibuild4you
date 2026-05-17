'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload } from 'lucide-react'
import { FilesGrid } from '@/components/ui/FilesGrid'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useUploadFiles } from '@/lib/query/hooks'
import type { ProjectFile } from '@/lib/types'

const MAX_FILE_SIZE = 25 * 1024 * 1024

export function BuilderFilesTab({
  projectId,
  files,
}: {
  projectId: string
  files: ProjectFile[]
}) {
  const uploadFiles = useUploadFiles()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startUpload = useCallback(async (incoming: FileList | File[]) => {
    setError(null)
    const list = Array.from(incoming)
    const oversized = list.find((f) => f.size > MAX_FILE_SIZE)
    if (oversized) {
      setError(`File "${oversized.name}" exceeds 25MB limit`)
      return
    }
    if (list.length === 0) return
    try {
      const { failed } = await uploadFiles.mutateAsync({ projectId, files: list })
      if (failed.length > 0) {
        setError(
          failed.length === 1
            ? `Failed to upload "${failed[0].file.name}": ${failed[0].error}`
            : `Failed to upload ${failed.length} files`,
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }, [projectId, uploadFiles])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      setDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) startUpload(e.dataTransfer.files)
  }, [startUpload])

  const isUploading = uploadFiles.isPending

  return (
    <div
      className={`space-y-4 rounded-lg transition-colors ${dragOver ? 'ring-2 ring-brand-navy ring-offset-2 bg-brand-navy/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {dragOver ? 'Drop files to upload' : 'Drop files here, or click upload.'}
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-brand-navy text-white rounded-lg hover:bg-brand-navy-light disabled:opacity-50 transition-colors"
        >
          <Upload className="h-4 w-4" />
          {isUploading ? 'Uploading…' : 'Upload files'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) startUpload(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {error && <StatusMessage type="error" message={error} onDismiss={() => setError(null)} />}

      <FilesGrid files={files} />
    </div>
  )
}
