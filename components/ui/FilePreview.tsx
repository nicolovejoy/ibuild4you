'use client'

import { X, FileIcon } from 'lucide-react'
import { useFileUrl } from '@/lib/query/hooks'
import type { ProjectFile } from '@/lib/types'

function isImageType(contentType: string) {
  return contentType.startsWith('image/')
}

// Preview for an already-uploaded file (fetches via auth-gated endpoint)
export function UploadedFilePreview({
  file,
  compact = false,
}: {
  file: ProjectFile
  compact?: boolean
}) {
  const { data: url } = useFileUrl(file.id)

  if (isImageType(file.content_type)) {
    return (
      <div className={compact ? 'inline-block' : ''}>
        {url ? (
          <img
            src={url}
            alt={file.filename}
            className={`rounded-lg object-cover ${compact ? 'max-h-40 max-w-48' : 'max-h-64 max-w-full'}`}
          />
        ) : (
          <div className={`bg-gray-100 rounded-lg animate-pulse ${compact ? 'h-20 w-24' : 'h-32 w-40'}`} />
        )}
      </div>
    )
  }

  return (
    <div className="inline-flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm">
      <FileIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
      <span className="truncate max-w-[200px]">{file.filename}</span>
      <span className="text-gray-400 text-xs">{formatFileSize(file.size_bytes)}</span>
    </div>
  )
}

// Preview for a local File (pending upload, with optional remove button)
export function LocalFilePreview({
  file,
  onRemove,
}: {
  file: File
  onRemove?: () => void
}) {
  const isImage = file.type.startsWith('image/')
  const url = isImage ? URL.createObjectURL(file) : null

  return (
    <div className="relative inline-block group">
      {isImage && url ? (
        <img
          src={url}
          alt={file.name}
          className="h-16 w-16 rounded-lg object-cover border border-gray-200"
          onLoad={() => URL.revokeObjectURL(url)}
        />
      ) : (
        <div className="h-16 px-3 flex items-center gap-2 bg-gray-50 rounded-lg border border-gray-200 text-xs">
          <FileIcon className="h-4 w-4 text-gray-400" />
          <span className="truncate max-w-[100px]">{file.name}</span>
        </div>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 bg-gray-700 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
