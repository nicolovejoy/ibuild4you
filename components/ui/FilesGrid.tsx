'use client'

import { useState } from 'react'
import { FileIcon, Image, Download } from 'lucide-react'
import { useFileUrl } from '@/lib/query/hooks'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { Modal } from './Modal'
import type { ProjectFile } from '@/lib/types'

export function FilesGrid({ files }: { files: ProjectFile[] }) {
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null)

  if (files.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        <Image className="h-10 w-10 mx-auto mb-3 text-gray-300" />
        <p>No files shared yet.</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {files.map((file) => (
          <FileCard key={file.id} file={file} onClick={() => setSelectedFile(file)} />
        ))}
      </div>

      {selectedFile && (
        <FilePreviewModal file={selectedFile} onClose={() => setSelectedFile(null)} />
      )}
    </>
  )
}

function FileCard({ file, onClick }: { file: ProjectFile; onClick: () => void }) {
  const isImage = file.content_type.startsWith('image/')
  const { data: url } = useFileUrl(isImage ? file.id : undefined)

  const date = new Date(file.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

  return (
    <button
      onClick={onClick}
      className="group bg-white rounded-lg border border-gray-200 overflow-hidden hover:border-gray-300 hover:shadow-sm transition-all text-left"
    >
      <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
        {isImage && url ? (
          <img src={url} alt={file.filename} className="w-full h-full object-cover" />
        ) : (
          <FileIcon className="h-8 w-8 text-gray-300" />
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-medium text-gray-700 truncate">{file.filename}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">
          {file.uploaded_by_name || file.uploaded_by_email.split('@')[0]} &middot; {date}
        </p>
      </div>
    </button>
  )
}

function FilePreviewModal({ file, onClose }: { file: ProjectFile; onClose: () => void }) {
  const isImage = file.content_type.startsWith('image/')
  const { data: url } = useFileUrl(file.id)

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
        {/* Image preview or file icon */}
        {isImage ? (
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

        {/* File info + download */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-800">{file.filename}</p>
            <p className="text-sm text-gray-400">
              {file.uploaded_by_name || file.uploaded_by_email.split('@')[0]} &middot; {date} &middot; {formatFileSize(file.size_bytes)}
            </p>
          </div>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-brand-navy hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Download className="h-4 w-4" />
            Download
          </button>
        </div>
      </div>
    </Modal>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
