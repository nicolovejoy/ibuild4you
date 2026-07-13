'use client'

import { useState } from 'react'
import {
  FileIcon,
  Image,
  Download,
  Trash2,
  Folder,
  Pencil,
  Check,
  X,
  Star,
  Link2,
  ExternalLink,
} from 'lucide-react'
import {
  useFileUrl,
  useDeleteFile,
  useRenameFolder,
  useDeleteFolder,
  useMoveFile,
  useUpdateFileMeta,
} from '@/lib/query/hooks'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { groupFilesByFolder, validateFolderName } from '@/lib/files/folders'
import { partitionPinned, isLinked } from '@/lib/files/artifacts'
import { StatusMessage } from './StatusMessage'
import { Modal } from './Modal'
import type { ProjectFile, FileFolder } from '@/lib/types'

export function FilesGrid({
  files,
  folders = [],
  canDelete = false,
  canManage = false,
}: {
  files: ProjectFile[]
  folders?: FileFolder[]
  canDelete?: boolean
  // Folder rename/delete + moving/pinning/describing files. Builder+ console
  // only — the server enforces the same gate regardless.
  canManage?: boolean
}) {
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)
  const updateMeta = useUpdateFileMeta()

  if (files.length === 0 && folders.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        <Image className="h-10 w-10 mx-auto mb-3 text-gray-300" />
        <p>No files shared yet.</p>
      </div>
    )
  }

  // Pinned artifacts surface in their own section at the top and drop out of
  // their folder/unfiled group, so they aren't shown twice.
  const { pinned, rest } = partitionPinned(files)
  const { sections, unfiled } = groupFilesByFolder(rest, folders)

  const togglePin = async (file: ProjectFile) => {
    setPinError(null)
    try {
      await updateMeta.mutateAsync({
        fileId: file.id,
        projectId: file.project_id,
        pinned: !file.pinned,
      })
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Could not update pin')
    }
  }

  const grid = (items: ProjectFile[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {items.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          canManage={canManage}
          onClick={() => setSelectedFile(file)}
          onTogglePin={() => togglePin(file)}
        />
      ))}
    </div>
  )

  return (
    <>
      {pinError && (
        <div className="mb-3">
          <StatusMessage type="error" message={pinError} onDismiss={() => setPinError(null)} />
        </div>
      )}
      <div className="space-y-5">
        {pinned.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-gray-600">
              <Star className="h-4 w-4 text-amber-500" fill="currentColor" />
              Pinned
            </p>
            {grid(pinned)}
          </div>
        )}

        {sections.map(({ folder, files: folderFiles }) => (
          <div key={folder.id} className="space-y-2">
            <FolderHeader folder={folder} count={folderFiles.length} canManage={canManage} />
            {folderFiles.length > 0 ? (
              grid(folderFiles)
            ) : (
              <p className="text-xs text-gray-400 pl-6">Empty folder.</p>
            )}
          </div>
        ))}

        {unfiled.length > 0 && (
          <div className="space-y-2">
            {(sections.length > 0 || pinned.length > 0) && (
              <p className="text-sm font-medium text-gray-500">Unfiled</p>
            )}
            {grid(unfiled)}
          </div>
        )}
      </div>

      {selectedFile && (
        <FilePreviewModal
          file={selectedFile}
          folders={folders}
          canDelete={canDelete}
          canManage={canManage}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </>
  )
}

function FolderHeader({
  folder,
  count,
  canManage,
}: {
  folder: FileFolder
  count: number
  canManage: boolean
}) {
  const renameFolder = useRenameFolder()
  const deleteFolder = useDeleteFolder()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(folder.name)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitRename = async () => {
    const validated = validateFolderName(name)
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    try {
      await renameFolder.mutateAsync({
        folderId: folder.id,
        projectId: folder.project_id,
        name: validated.name,
      })
      setEditing(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Folder className="h-4 w-4 text-gray-400 shrink-0" />
        {editing ? (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
              className="text-sm font-medium text-gray-700 border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-navy"
            />
            <button
              onClick={submitRename}
              disabled={renameFolder.isPending}
              aria-label="Save folder name"
              className="p-1 text-gray-500 hover:text-brand-navy rounded"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setEditing(false)
                setName(folder.name)
                setError(null)
              }}
              aria-label="Cancel rename"
              className="p-1 text-gray-500 hover:text-gray-700 rounded"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <span className="text-sm font-medium text-gray-700">{folder.name}</span>
            <span className="text-xs text-gray-400">{count}</span>
            {canManage && (
              <span className="flex items-center gap-0.5">
                <button
                  onClick={() => setEditing(true)}
                  aria-label={`Rename folder ${folder.name}`}
                  className="p-1 text-gray-300 hover:text-gray-600 rounded"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  aria-label={`Delete folder ${folder.name}`}
                  className="p-1 text-gray-300 hover:text-red-600 rounded"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-600 pl-6">{error}</p>}

      {confirming && (
        <div className="flex items-center gap-2 pl-6 text-sm">
          <span className="text-gray-600">
            Delete &ldquo;{folder.name}&rdquo;? Files move back to Unfiled.
          </span>
          <button
            onClick={async () => {
              try {
                await deleteFolder.mutateAsync({ folderId: folder.id, projectId: folder.project_id })
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Delete failed')
                setConfirming(false)
              }
            }}
            disabled={deleteFolder.isPending}
            className="px-2 py-0.5 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50"
          >
            {deleteFolder.isPending ? 'Deleting…' : 'Delete folder'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 rounded"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function FileCard({
  file,
  canManage,
  onClick,
  onTogglePin,
}: {
  file: ProjectFile
  canManage: boolean
  onClick: () => void
  onTogglePin: () => void
}) {
  const linked = isLinked(file)
  const isImage = !linked && !!file.content_type?.startsWith('image/')
  const { data: url } = useFileUrl(isImage ? file.id : undefined)

  const date = new Date(file.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

  // The star shows for pinned files always (so makers see the badge) and on
  // hover for builders on unpinned files (a quick-pin affordance).
  const showStar = file.pinned || canManage

  return (
    <div className="group relative bg-white rounded-lg border border-gray-200 overflow-hidden hover:border-gray-300 hover:shadow-sm transition-all">
      {showStar && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (canManage) onTogglePin()
          }}
          aria-label={file.pinned ? 'Unpin' : 'Pin'}
          disabled={!canManage}
          className={`absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-white/80 backdrop-blur-sm ${
            file.pinned ? 'text-amber-500' : 'text-gray-300 opacity-0 group-hover:opacity-100'
          } ${canManage ? 'hover:text-amber-500' : 'cursor-default'} transition-colors`}
        >
          <Star className="h-3.5 w-3.5" fill={file.pinned ? 'currentColor' : 'none'} />
        </button>
      )}
      <button onClick={onClick} className="block w-full text-left">
        <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
          {isImage && url ? (
            <img src={url} alt={file.filename} className="w-full h-full object-cover" />
          ) : linked ? (
            <Link2 className="h-8 w-8 text-gray-300" />
          ) : (
            <FileIcon className="h-8 w-8 text-gray-300" />
          )}
        </div>
        <div className="p-2">
          <p className="text-xs font-medium text-gray-700 truncate">{file.filename}</p>
          {file.description && (
            <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{file.description}</p>
          )}
          <p className="text-[10px] text-gray-400 mt-0.5">
            {file.uploaded_by_name || file.uploaded_by_email.split('@')[0]} &middot; {date}
          </p>
        </div>
      </button>
    </div>
  )
}

function FilePreviewModal({
  file,
  folders,
  canDelete = false,
  canManage = false,
  onClose,
}: {
  file: ProjectFile
  folders: FileFolder[]
  canDelete?: boolean
  canManage?: boolean
  onClose: () => void
}) {
  const linked = isLinked(file)
  const isImage = !linked && !!file.content_type?.startsWith('image/')
  const { data: url } = useFileUrl(isImage ? file.id : undefined)
  const deleteFile = useDeleteFile()
  const moveFile = useMoveFile()
  const updateMeta = useUpdateFileMeta()
  const [confirming, setConfirming] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [desc, setDesc] = useState(file.description ?? '')
  const [descError, setDescError] = useState<string | null>(null)

  const descDirty = desc.trim() !== (file.description ?? '').trim()

  const handleDelete = async () => {
    try {
      await deleteFile.mutateAsync({ fileId: file.id, projectId: file.project_id })
      onClose()
    } catch {
      // Error surfaced inline below; keep the modal open for retry.
    }
  }

  const handleMove = async (folderId: string | null) => {
    setMoveError(null)
    try {
      await moveFile.mutateAsync({ fileId: file.id, projectId: file.project_id, folderId })
      onClose()
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Move failed')
    }
  }

  const saveDescription = async () => {
    setDescError(null)
    try {
      await updateMeta.mutateAsync({ fileId: file.id, projectId: file.project_id, description: desc })
    } catch (err) {
      setDescError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const togglePin = async () => {
    setDescError(null)
    try {
      await updateMeta.mutateAsync({ fileId: file.id, projectId: file.project_id, pinned: !file.pinned })
    } catch (err) {
      setDescError(err instanceof Error ? err.message : 'Could not update pin')
    }
  }

  const handleDownload = async () => {
    const res = await apiFetch(`/api/files/${file.id}`)
    if (!res.ok) return
    const blob = await res.blob()
    const downloadUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = file.filename
    a.click()
    URL.revokeObjectURL(downloadUrl)
  }

  const date = new Date(file.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <Modal isOpen onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Preview: image, link, or generic file */}
        {linked ? (
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 py-12 bg-gray-50 rounded-lg text-brand-navy hover:bg-gray-100 transition-colors"
          >
            <ExternalLink className="h-5 w-5" />
            <span className="text-sm font-medium truncate max-w-[80%]">{file.url}</span>
          </a>
        ) : isImage ? (
          <div className="flex items-center justify-center bg-gray-50 rounded-lg overflow-hidden">
            {url ? (
              <img src={url} alt={file.filename} className="max-h-[60vh] max-w-full object-contain" />
            ) : (
              <div className="h-64 w-full animate-pulse bg-gray-100 rounded-lg" />
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-16 bg-gray-50 rounded-lg">
            <FileIcon className="h-16 w-16 text-gray-300" />
          </div>
        )}

        {/* Info + actions */}
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="font-medium text-gray-800 truncate">{file.filename}</p>
            <p className="text-sm text-gray-400">
              {file.uploaded_by_name || file.uploaded_by_email.split('@')[0]} &middot; {date}
              {typeof file.size_bytes === 'number' && ` · ${formatFileSize(file.size_bytes)}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canManage && (
              <button
                onClick={togglePin}
                disabled={updateMeta.isPending}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  file.pinned
                    ? 'text-amber-600 hover:bg-amber-50'
                    : 'text-gray-600 hover:text-brand-navy hover:bg-gray-100'
                }`}
              >
                <Star className="h-4 w-4" fill={file.pinned ? 'currentColor' : 'none'} />
                {file.pinned ? 'Pinned' : 'Pin'}
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setConfirming(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
            {linked ? (
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-brand-navy hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
            ) : (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-brand-navy hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            )}
          </div>
        </div>

        {/* Description — editable for builder+, read-only otherwise */}
        {canManage ? (
          <div className="space-y-1.5">
            <label htmlFor="artifact-desc" className="text-sm text-gray-500">
              Description
            </label>
            <div className="flex items-start gap-2">
              <input
                id="artifact-desc"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && descDirty) saveDescription()
                }}
                placeholder="One line — what this is, so the agent knows it exists"
                className="flex-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-navy"
              />
              {descDirty && (
                <button
                  onClick={saveDescription}
                  disabled={updateMeta.isPending}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-brand-navy rounded-lg hover:bg-brand-navy-light disabled:opacity-50 transition-colors"
                >
                  Save
                </button>
              )}
            </div>
            {descError && <p className="text-xs text-red-600">{descError}</p>}
          </div>
        ) : (
          file.description && <p className="text-sm text-gray-600">{file.description}</p>
        )}

        {/* Move to folder */}
        {canManage && folders.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="move-file-folder" className="text-sm text-gray-500">
              Folder:
            </label>
            <select
              id="move-file-folder"
              value={file.folder_id ?? ''}
              onChange={(e) => handleMove(e.target.value || null)}
              disabled={moveFile.isPending}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:opacity-50"
            >
              <option value="">Unfiled</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {moveError && <p className="text-xs text-red-600">{moveError}</p>}
          </div>
        )}

        {confirming && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-3">
            <p className="text-sm text-red-800">
              Delete &ldquo;{file.filename}&rdquo;? This removes the {linked ? 'link' : 'file'} and any agent references. This can&apos;t be undone.
            </p>
            {deleteFile.error && (
              <p className="text-xs text-red-600">{deleteFile.error.message}</p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={deleteFile.isPending}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleteFile.isPending ? 'Deleting…' : 'Delete'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={deleteFile.isPending}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
