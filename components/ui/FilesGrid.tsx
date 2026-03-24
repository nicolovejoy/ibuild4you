'use client'

import { FileIcon, Image } from 'lucide-react'
import { useFileUrl } from '@/lib/query/hooks'
import { apiFetch } from '@/lib/firebase/api-fetch'
import type { ProjectFile } from '@/lib/types'

export function FilesGrid({ files }: { files: ProjectFile[] }) {
  if (files.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        <Image className="h-10 w-10 mx-auto mb-3 text-gray-300" />
        <p>No files shared yet.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {files.map((file) => (
        <FileCard key={file.id} file={file} />
      ))}
    </div>
  )
}

function FileCard({ file }: { file: ProjectFile }) {
  const isImage = file.content_type.startsWith('image/')
  const { data: url } = useFileUrl(isImage ? file.id : undefined)

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
  })

  return (
    <button
      onClick={handleDownload}
      className="group bg-white rounded-lg border border-gray-200 overflow-hidden hover:border-gray-300 hover:shadow-sm transition-all text-left"
    >
      {/* Thumbnail or icon */}
      <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
        {isImage && url ? (
          <img src={url} alt={file.filename} className="w-full h-full object-cover" />
        ) : (
          <FileIcon className="h-8 w-8 text-gray-300" />
        )}
      </div>
      {/* Meta */}
      <div className="p-2">
        <p className="text-xs font-medium text-gray-700 truncate">{file.filename}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">
          {file.uploaded_by_email.split('@')[0]} &middot; {date}
        </p>
      </div>
    </button>
  )
}
