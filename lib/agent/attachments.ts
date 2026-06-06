import { GetObjectCommand } from '@aws-sdk/client-s3'
import mammoth from 'mammoth'
import { s3, S3_BUCKET } from '@/lib/s3/client'
import { classifyAttachment } from '@/lib/files/supported-types'

// Per-message attachment cap. Anthropic's hard PDF limit is 32MB; we leave
// headroom for image content + metadata. Triggered before any S3 fetch.
export const MAX_ATTACHMENT_BYTES_PER_MESSAGE = 25 * 1024 * 1024

// Per-text-file character cap. Text and .docx files are inlined as text, which
// counts as input tokens — an unbounded doc could blow the context window and
// the bill. ~200k chars ≈ 50k tokens. Longer files are truncated with a note.
export const MAX_TEXT_CHARS = 200_000

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

// cache_control is optional on each block. The chat route places at most one
// marker (on the last block of the most recent attachment-bearing user message)
// because Anthropic caps cache_control at 4 markers per request — tagging
// every block 400s the whole request once you cross 4 attachments.
export type AttachmentBlock =
  | {
      type: 'document'
      source: { type: 'base64'; media_type: 'application/pdf'; data: string }
      cache_control?: { type: 'ephemeral' }
    }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: ImageMediaType; data: string }
      cache_control?: { type: 'ephemeral' }
    }
  | {
      // Text and .docx files are inlined as text content.
      type: 'text'
      text: string
      cache_control?: { type: 'ephemeral' }
    }

// Why a referenced file couldn't be turned into a block. The chat route uses
// these to tell the maker what happened instead of staying silent.
export type DropReason =
  | 'pending'
  | 'unsupported'
  | 'not_found'
  | 'wrong_project'
  | 'fetch_failed'
  | 'unreadable'

export type DroppedAttachment = { filename: string; reason: DropReason }

export type LoadedAttachments = {
  blocks: AttachmentBlock[]
  dropped: DroppedAttachment[]
}

type FileMeta = {
  project_id: string
  filename?: string
  content_type: string
  storage_path: string
  size_bytes: number
  status?: 'pending' | 'ready'
}

function imageMediaType(file: FileMeta): ImageMediaType {
  const ct = (file.content_type || '').toLowerCase().split(';')[0].trim()
  if (ct === 'image/png' || ct === 'image/jpeg' || ct === 'image/gif' || ct === 'image/webp') {
    return ct
  }
  // Content type was generic (octet-stream) — derive from the extension.
  const ext = (file.filename || '').slice((file.filename || '').lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg' // jpg/jpeg and any remaining fallthrough
}

function buildTextBlock(filename: string, raw: string): AttachmentBlock {
  const truncated = raw.length > MAX_TEXT_CHARS
  const body = truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw
  const note = truncated
    ? '\n\n[Truncated — this file was longer than I can read in one message.]'
    : ''
  return {
    type: 'text',
    text: `Attached file "${filename}":\n\n${body}${note}`,
  }
}

// Loads referenced files from Firestore + S3 and turns them into Claude content
// blocks. PDFs → document blocks, images → image blocks, text/code/.docx →
// text blocks. Anything we can't read (unknown / cross-project / pending /
// unsupported / failed fetch) is returned in `dropped` with a reason rather
// than silently skipped — so the caller can tell the maker. Throws
// `attachments_too_large` if total declared size exceeds the per-message cap.
export async function loadAttachmentBlocks(
  db: FirebaseFirestore.Firestore,
  fileIds: string[],
  projectId: string,
): Promise<LoadedAttachments> {
  if (fileIds.length === 0) return { blocks: [], dropped: [] }

  const dropped: DroppedAttachment[] = []

  // Phase 1: metadata + classification, so we can size-check before pulling
  // bytes and record drops for anything ineligible.
  const metas = await Promise.all(
    fileIds.map(async (id) => {
      const doc = await db.collection('files').doc(id).get()
      if (!doc.exists) {
        dropped.push({ filename: id, reason: 'not_found' })
        return null
      }
      const data = doc.data() as FileMeta
      const name = data.filename || id
      if (data.project_id !== projectId) {
        dropped.push({ filename: name, reason: 'wrong_project' })
        return null
      }
      if (data.status === 'pending') {
        dropped.push({ filename: name, reason: 'pending' })
        return null
      }
      const kind = classifyAttachment({ filename: data.filename || '', contentType: data.content_type })
      if (kind === 'unsupported') {
        dropped.push({ filename: name, reason: 'unsupported' })
        return null
      }
      return { id, kind, ...data, filename: name }
    }),
  )

  const eligible = metas.filter(
    (m): m is FileMeta & { id: string; kind: 'image' | 'pdf' | 'text' | 'docx'; filename: string } =>
      m !== null,
  )

  const totalBytes = eligible.reduce((sum, m) => sum + (m.size_bytes || 0), 0)
  if (totalBytes > MAX_ATTACHMENT_BYTES_PER_MESSAGE) {
    throw new Error(
      `attachments_too_large: ${totalBytes} bytes exceeds per-message cap of ${MAX_ATTACHMENT_BYTES_PER_MESSAGE}`,
    )
  }

  // Phase 2: fetch bytes + build the block for each eligible file.
  const built = await Promise.all(
    eligible.map(async (file): Promise<AttachmentBlock | null> => {
      let bytes: Uint8Array
      try {
        const result = await s3.send(
          new GetObjectCommand({ Bucket: S3_BUCKET, Key: file.storage_path }),
        )
        if (!result.Body) {
          dropped.push({ filename: file.filename, reason: 'fetch_failed' })
          return null
        }
        bytes = await result.Body.transformToByteArray()
      } catch (err) {
        console.error('attachment_fetch_failed', {
          file_id: file.id,
          storage_path: file.storage_path,
          aws_error: err instanceof Error ? err.name : 'UnknownError',
          message: err instanceof Error ? err.message : String(err),
        })
        dropped.push({ filename: file.filename, reason: 'fetch_failed' })
        return null
      }

      try {
        if (file.kind === 'pdf') {
          return {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: Buffer.from(bytes).toString('base64'),
            },
          }
        }
        if (file.kind === 'image') {
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageMediaType(file),
              data: Buffer.from(bytes).toString('base64'),
            },
          }
        }
        if (file.kind === 'docx') {
          const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
          return buildTextBlock(file.filename, value || '')
        }
        // kind === 'text'
        return buildTextBlock(file.filename, Buffer.from(bytes).toString('utf-8'))
      } catch (err) {
        console.error('attachment_parse_failed', {
          file_id: file.id,
          kind: file.kind,
          message: err instanceof Error ? err.message : String(err),
        })
        dropped.push({ filename: file.filename, reason: 'unreadable' })
        return null
      }
    }),
  )

  const blocks = built.filter((b): b is AttachmentBlock => b !== null)
  return { blocks, dropped }
}
