import { GetObjectCommand } from '@aws-sdk/client-s3'
import { s3, S3_BUCKET } from '@/lib/s3/client'

// Per-message attachment cap. Anthropic's hard PDF limit is 32MB; we leave
// headroom for image content + metadata. Triggered before any S3 fetch.
export const MAX_ATTACHMENT_BYTES_PER_MESSAGE = 25 * 1024 * 1024

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export type AttachmentBlock =
  | {
      type: 'document'
      source: { type: 'base64'; media_type: 'application/pdf'; data: string }
      cache_control: { type: 'ephemeral' }
    }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: ImageMediaType; data: string }
      cache_control: { type: 'ephemeral' }
    }

type FileMeta = {
  project_id: string
  content_type: string
  storage_path: string
  size_bytes: number
  status?: 'pending' | 'ready'
}

function isSupported(contentType: string) {
  return contentType === 'application/pdf' || SUPPORTED_IMAGE_TYPES.has(contentType)
}

// Loads referenced files from Firestore + S3 and turns them into Claude content
// blocks. Skips unknown / cross-project / pending / unsupported files. Throws
// `attachments_too_large` if total declared size exceeds the per-message cap.
// Logs and skips files whose S3 fetch fails (one bad object shouldn't kill the
// whole turn).
export async function loadAttachmentBlocks(
  db: FirebaseFirestore.Firestore,
  fileIds: string[],
  projectId: string,
): Promise<AttachmentBlock[]> {
  if (fileIds.length === 0) return []

  // Fetch metadata first so we can size-check before pulling bytes.
  const metas = await Promise.all(
    fileIds.map(async (id) => {
      const doc = await db.collection('files').doc(id).get()
      if (!doc.exists) return null
      const data = doc.data() as FileMeta
      if (data.project_id !== projectId) return null
      if (data.status === 'pending') return null
      if (!isSupported(data.content_type)) return null
      return { id, ...data }
    }),
  )

  const eligible = metas.filter((m): m is FileMeta & { id: string } => m !== null)

  const totalBytes = eligible.reduce((sum, m) => sum + (m.size_bytes || 0), 0)
  if (totalBytes > MAX_ATTACHMENT_BYTES_PER_MESSAGE) {
    throw new Error(
      `attachments_too_large: ${totalBytes} bytes exceeds per-message cap of ${MAX_ATTACHMENT_BYTES_PER_MESSAGE}`,
    )
  }

  const blocks = await Promise.all(
    eligible.map(async (file): Promise<AttachmentBlock | null> => {
      try {
        const result = await s3.send(
          new GetObjectCommand({ Bucket: S3_BUCKET, Key: file.storage_path }),
        )
        if (!result.Body) return null
        const bytes = await result.Body.transformToByteArray()
        const data = Buffer.from(bytes).toString('base64')

        if (file.content_type === 'application/pdf') {
          return {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data },
            cache_control: { type: 'ephemeral' },
          }
        }
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: file.content_type as ImageMediaType,
            data,
          },
          cache_control: { type: 'ephemeral' },
        }
      } catch (err) {
        console.error('attachment_fetch_failed', {
          file_id: file.id,
          storage_path: file.storage_path,
          aws_error: err instanceof Error ? err.name : 'UnknownError',
          message: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    }),
  )

  return blocks.filter((b): b is AttachmentBlock => b !== null)
}
