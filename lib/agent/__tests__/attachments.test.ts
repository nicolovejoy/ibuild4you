import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadAttachmentBlocks, MAX_ATTACHMENT_BYTES_PER_MESSAGE } from '../attachments'

// =============================================================================
// ATTACHMENTS — turns file_ids into Claude content blocks
//
// PDFs become `document` blocks, images become `image` blocks. Unsupported
// types and `pending` files are filtered out. Blocks are NOT individually
// tagged with cache_control — Anthropic caps cache_control at 4 markers per
// request and we'd 400 with >4 attachments. The chat route places one marker
// on the last block of the most recent attachment-bearing user message.
// A per-message byte cap protects against Anthropic's 32MB PDF limit.
// =============================================================================

const mockS3Send = vi.fn()
vi.mock('@/lib/s3/client', () => ({
  s3: { send: (...args: unknown[]) => mockS3Send(...args) },
  S3_BUCKET: 'test-bucket',
}))
vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn((input) => ({ input })),
}))

type FileDoc = {
  exists: boolean
  data: () => Record<string, unknown>
}
const fileDocs = new Map<string, FileDoc>()

const mockDb = {
  collection: vi.fn(() => ({
    doc: vi.fn((id: string) => ({
      get: vi.fn(async () => fileDocs.get(id) || { exists: false, data: () => ({}) }),
    })),
  })),
} as unknown as FirebaseFirestore.Firestore

function setFile(id: string, data: Record<string, unknown>) {
  fileDocs.set(id, { exists: true, data: () => data })
}

function bytesResponse(buf: Uint8Array) {
  return { Body: { transformToByteArray: async () => buf } }
}

beforeEach(() => {
  fileDocs.clear()
  mockS3Send.mockReset()
})

describe('loadAttachmentBlocks', () => {
  it('returns an empty array when fileIds is empty', async () => {
    const blocks = await loadAttachmentBlocks(mockDb, [], 'p1')
    expect(blocks).toEqual([])
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('builds a document block for a PDF', async () => {
    setFile('f1', {
      project_id: 'p1',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/a.pdf',
      size_bytes: 1024,
      status: 'ready',
    })
    mockS3Send.mockResolvedValue(bytesResponse(new Uint8Array([1, 2, 3])))

    const blocks = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf' },
    })
    // No cache_control on individual blocks — chat route adds one strategically.
    expect(blocks[0]).not.toHaveProperty('cache_control')
    // base64 of [1,2,3] = "AQID"
    expect((blocks[0] as { source: { data: string } }).source.data).toBe('AQID')
  })

  it('builds an image block for a PNG', async () => {
    setFile('f1', {
      project_id: 'p1',
      content_type: 'image/png',
      storage_path: 'projects/p1/f1/a.png',
      size_bytes: 1024,
      status: 'ready',
    })
    mockS3Send.mockResolvedValue(bytesResponse(new Uint8Array([4, 5, 6])))

    const blocks = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png' },
    })
    expect(blocks[0]).not.toHaveProperty('cache_control')
  })

  it('skips files belonging to a different project', async () => {
    setFile('f1', {
      project_id: 'other-project',
      content_type: 'application/pdf',
      storage_path: 'projects/other-project/f1/a.pdf',
      size_bytes: 1024,
      status: 'ready',
    })

    const blocks = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks).toEqual([])
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('skips pending files', async () => {
    setFile('f1', {
      project_id: 'p1',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/a.pdf',
      size_bytes: 1024,
      status: 'pending',
    })

    const blocks = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks).toEqual([])
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('skips files that do not exist', async () => {
    const blocks = await loadAttachmentBlocks(mockDb, ['ghost'], 'p1')
    expect(blocks).toEqual([])
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('skips unsupported content types (e.g. text/plain)', async () => {
    setFile('f1', {
      project_id: 'p1',
      content_type: 'text/plain',
      storage_path: 'projects/p1/f1/notes.txt',
      size_bytes: 100,
      status: 'ready',
    })

    const blocks = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks).toEqual([])
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('treats missing status as ready (legacy files)', async () => {
    setFile('f1', {
      project_id: 'p1',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/a.pdf',
      size_bytes: 1024,
      // no status field — legacy file
    })
    mockS3Send.mockResolvedValue(bytesResponse(new Uint8Array([1])))

    const blocks = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks).toHaveLength(1)
  })

  it('throws when total attachment bytes exceed the per-message cap', async () => {
    setFile('f1', {
      project_id: 'p1',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/big.pdf',
      size_bytes: MAX_ATTACHMENT_BYTES_PER_MESSAGE + 1,
      status: 'ready',
    })

    await expect(loadAttachmentBlocks(mockDb, ['f1'], 'p1')).rejects.toThrow(
      /attachments_too_large/i,
    )
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('caps multiple files by their summed declared size', async () => {
    const half = Math.floor(MAX_ATTACHMENT_BYTES_PER_MESSAGE / 2) + 100
    setFile('f1', {
      project_id: 'p1',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/a.pdf',
      size_bytes: half,
      status: 'ready',
    })
    setFile('f2', {
      project_id: 'p1',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f2/b.pdf',
      size_bytes: half,
      status: 'ready',
    })

    await expect(loadAttachmentBlocks(mockDb, ['f1', 'f2'], 'p1')).rejects.toThrow(
      /attachments_too_large/i,
    )
  })

  it('continues if S3 fetch fails for one file (returns blocks for the rest)', async () => {
    setFile('f1', {
      project_id: 'p1',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/a.pdf',
      size_bytes: 1024,
      status: 'ready',
    })
    setFile('f2', {
      project_id: 'p1',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f2/b.pdf',
      size_bytes: 1024,
      status: 'ready',
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockS3Send
      .mockResolvedValueOnce(bytesResponse(new Uint8Array([1])))
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NoSuchKey' }))

    const blocks = await loadAttachmentBlocks(mockDb, ['f1', 'f2'], 'p1')
    expect(blocks).toHaveLength(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('attachment_fetch_failed'),
      expect.objectContaining({ file_id: 'f2', aws_error: 'NoSuchKey' }),
    )
    consoleError.mockRestore()
  })
})
