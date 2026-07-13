'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, FolderPlus, Link2 } from 'lucide-react'
import { FilesGrid } from '@/components/ui/FilesGrid'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useUploadFiles, useProjectFolders, useCreateFolder, useCreateLink } from '@/lib/query/hooks'
import { validateFolderName } from '@/lib/files/folders'
import { validateLinkInput } from '@/lib/files/artifacts'
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
  const { data: folders } = useProjectFolders(projectId)
  const createFolder = useCreateFolder()
  const createLink = useCreateLink()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingFolder, setAddingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [addingLink, setAddingLink] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkName, setLinkName] = useState('')
  const [linkDesc, setLinkDesc] = useState('')

  const submitFolder = useCallback(async () => {
    const validated = validateFolderName(folderName)
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    setError(null)
    try {
      await createFolder.mutateAsync({ projectId, name: validated.name })
      setAddingFolder(false)
      setFolderName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create folder failed')
    }
  }, [folderName, projectId, createFolder])

  const submitLink = useCallback(async () => {
    const validated = validateLinkInput({ url: linkUrl, filename: linkName, description: linkDesc })
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    setError(null)
    try {
      await createLink.mutateAsync({
        projectId,
        url: validated.value.url,
        filename: linkName.trim() || undefined,
        description: validated.value.description,
      })
      setAddingLink(false)
      setLinkUrl('')
      setLinkName('')
      setLinkDesc('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add link failed')
    }
  }, [linkUrl, linkName, linkDesc, projectId, createLink])

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAddingLink((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Link2 className="h-4 w-4" />
            Add link
          </button>
          <button
            onClick={() => setAddingFolder((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FolderPlus className="h-4 w-4" />
            New folder
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-brand-navy text-white rounded-lg hover:bg-brand-navy-light disabled:opacity-50 transition-colors"
          >
            <Upload className="h-4 w-4" />
            {isUploading ? 'Uploading…' : 'Upload files'}
          </button>
        </div>
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

      {addingLink && (
        <div className="space-y-2 rounded-lg border border-gray-200 p-3">
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            autoFocus
            placeholder="https://…  (Figma, doc, live prototype…)"
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-navy"
          />
          <input
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            placeholder="Display name (optional — defaults to the URL)"
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-navy"
          />
          <input
            value={linkDesc}
            onChange={(e) => setLinkDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitLink()
              if (e.key === 'Escape') setAddingLink(false)
            }}
            placeholder="One line — what it is, so the agent knows it exists (optional)"
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-navy"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submitLink}
              disabled={createLink.isPending}
              className="px-3 py-1.5 text-sm font-medium text-white bg-brand-navy rounded-lg hover:bg-brand-navy-light disabled:opacity-50 transition-colors"
            >
              {createLink.isPending ? 'Adding…' : 'Add link'}
            </button>
            <button
              onClick={() => {
                setAddingLink(false)
                setLinkUrl('')
                setLinkName('')
                setLinkDesc('')
              }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {addingFolder && (
        <div className="flex items-center gap-2">
          <input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitFolder()
              if (e.key === 'Escape') setAddingFolder(false)
            }}
            autoFocus
            placeholder="Folder name"
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-navy"
          />
          <button
            onClick={submitFolder}
            disabled={createFolder.isPending}
            className="px-3 py-1.5 text-sm font-medium text-white bg-brand-navy rounded-lg hover:bg-brand-navy-light disabled:opacity-50 transition-colors"
          >
            {createFolder.isPending ? 'Creating…' : 'Create'}
          </button>
          <button
            onClick={() => {
              setAddingFolder(false)
              setFolderName('')
            }}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <StatusMessage type="error" message={error} onDismiss={() => setError(null)} />}

      {/* Builder console context — deletion + folder management are gated to
          builder+ on the server too (the maker view renders FilesGrid with
          folders but no manage props). */}
      <FilesGrid files={files} folders={folders ?? []} canDelete canManage />
    </div>
  )
}
