// Single source of truth for which uploaded files the agent can read.
//
// Both the upload route (rejects unsupported before storing) and the agent
// attachment loader (turns files into Claude content blocks) classify through
// here, so the two never drift — the bug we're fixing was exactly that drift:
// the upload path accepted anything, the agent path silently dropped what it
// couldn't read, and nobody told the maker.
//
// Classification keys off BOTH content-type and filename extension. Browsers
// routinely send an empty or `application/octet-stream` content-type for text,
// code, and even .docx files, so the extension is a necessary fallback.

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'docx' | 'unsupported'

// The four image formats Claude's vision supports natively.
const IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Text-ish application/* content types (text/* is matched by prefix below).
const TEXT_CONTENT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/x-ndjson',
])

// Plain-text and source-code extensions we read as UTF-8 text.
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'jsonl',
  'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'env',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
  'kt', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'php', 'swift', 'sh', 'bash',
  'zsh', 'sql', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue', 'svelte',
])

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) return ''
  return filename.slice(dot + 1).toLowerCase()
}

function normalizeContentType(contentType: string): string {
  // Drop parameters like "; charset=utf-8" and normalize case.
  return (contentType || '').toLowerCase().split(';')[0].trim()
}

export function classifyAttachment({
  filename,
  contentType,
}: {
  filename: string
  contentType: string
}): AttachmentKind {
  const ct = normalizeContentType(contentType)
  const ext = extensionOf(filename || '')

  if (IMAGE_CONTENT_TYPES.has(ct) || IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (ct === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ct === DOCX_CONTENT_TYPE || ext === 'docx') return 'docx'
  if (ct.startsWith('text/') || TEXT_CONTENT_TYPES.has(ct) || TEXT_EXTENSIONS.has(ext)) {
    return 'text'
  }
  return 'unsupported'
}

export function isSupportedUpload(file: {
  filename: string
  contentType: string
}): boolean {
  return classifyAttachment(file) !== 'unsupported'
}

// Shown to makers when an upload is rejected. Kept plain and non-jargony.
export const SUPPORTED_TYPES_LABEL =
  'PDFs, images, text or code files, and Word (.docx) documents'
