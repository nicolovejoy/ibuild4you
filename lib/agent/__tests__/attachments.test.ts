import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadAttachmentBlocks, MAX_ATTACHMENT_BYTES_PER_MESSAGE, MAX_TEXT_CHARS } from '../attachments'

// =============================================================================
// ATTACHMENTS — turns file_ids into Claude content blocks
//
// PDFs become `document` blocks, images become `image` blocks, and text/code
// files plus Word .docx become `text` blocks (the latter extracted with
// mammoth). Anything we can't read — pending, missing, cross-project,
// unsupported, or a failed fetch — is reported in `dropped` (with a reason)
// instead of vanishing silently, so the chat route can tell the maker.
//
// Returns { blocks, dropped }. Blocks are NOT individually tagged with
// cache_control — Anthropic caps cache_control at 4 markers per request; the
// chat route places one marker strategically. A per-message byte cap protects
// against Anthropic's 32MB PDF limit; a per-text char cap bounds token cost.
// =============================================================================

const mockS3Send = vi.fn()
vi.mock('@/lib/s3/client', () => ({
  s3: { send: (...args: unknown[]) => mockS3Send(...args) },
  S3_BUCKET: 'test-bucket',
}))
vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn((input) => ({ input })),
}))

const mockExtractRawText = vi.fn()
vi.mock('mammoth', () => ({
  default: { extractRawText: (...args: unknown[]) => mockExtractRawText(...args) },
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

function utf8(text: string) {
  return new TextEncoder().encode(text)
}

beforeEach(() => {
  fileDocs.clear()
  mockS3Send.mockReset()
  mockExtractRawText.mockReset()
})

describe('loadAttachmentBlocks', () => {
  it('returns empty blocks and drops when fileIds is empty', async () => {
    const { blocks, dropped } = await loadAttachmentBlocks(mockDb, [], 'p1')
    expect(blocks).toEqual([])
    expect(dropped).toEqual([])
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('builds a document block for a PDF', async () => {
    setFile('f1', {
      project_id: 'p1',
      filename: 'a.pdf',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/a.pdf',
      size_bytes: 1024,
      status: 'ready',
    })
    mockS3Send.mockResolvedValue(bytesResponse(new Uint8Array([1, 2, 3])))

    const { blocks, dropped } = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(dropped).toEqual([])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf' },
    })
    expect(blocks[0]).not.toHaveProperty('cache_control')
    // base64 of [1,2,3] = "AQID"
    expect((blocks[0] as { source: { data: string } }).source.data).toBe('AQID')
  })

  it('builds an image block for a PNG', async () => {
    setFile('f1', {
      project_id: 'p1',
      filename: 'a.png',
      content_type: 'image/png',
      storage_path: 'projects/p1/f1/a.png',
      size_bytes: 1024,
      status: 'ready',
    })
    mockS3Send.mockResolvedValue(bytesResponse(new Uint8Array([4, 5, 6])))

    const { blocks } = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png' },
    })
    expect(blocks[0]).not.toHaveProperty('cache_control')
  })

  it('derives image media type from extension when content type is generic', async () => {
    setFile('f1', {
      project_id: 'p1',
      filename: 'photo.jpg',
      content_type: 'application/octet-stream',
      storage_path: 'projects/p1/f1/photo.jpg',
      size_bytes: 1024,
      status: 'ready',
    })
    mockS3Send.mockResolvedValue(bytesResponse(new Uint8Array([7])))

    const { blocks } = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks[0]).toMatchObject({
      type: 'image',
      source: { media_type: 'image/jpeg' },
    })
  })

  it('builds a text block for a plain-text file, including the filename', async () => {
    setFile('f1', {
      project_id: 'p1',
      filename: 'notes.txt',
      content_type: 'text/plain',
      storage_path: 'projects/p1/f1/notes.txt',
      size_bytes: 11,
      status: 'ready',
    })
    mockS3Send.mockResolvedValue(bytesResponse(utf8('hello world')))

    const { blocks, dropped } = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(dropped).toEqual([])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    const text = (blocks[0] as { text: string }).text
    expect(text).toContain('notes.txt')
    expect(text).toContain('hello world')
    expect(mockExtractRawText).not.toHaveBeenCalled()
  })

  it('extracts text from a .docx via mammoth', async () => {
    setFile('f1', {
      project_id: 'p1',
      filename: 'brief.docx',
      content_type: 'application/octet-stream',
      storage_path: 'projects/p1/f1/brief.docx',
      size_bytes: 2048,
      status: 'ready',
    })
    mockS3Send.mockResolvedValue(bytesResponse(new Uint8Array([0x50, 0x4b])))
    mockExtractRawText.mockResolvedValue({ value: 'Extracted bakery requirements', messages: [] })

    const { blocks, dropped } = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(dropped).toEqual([])
    expect(mockExtractRawText).toHaveBeenCalledTimes(1)
    expect(blocks[0].type).toBe('text')
    const text = (blocks[0] as { text: string }).text
    expect(text).toContain('brief.docx')
    expect(text).toContain('Extracted bakery requirements')
  })

  it('truncates very long text and notes that it was cut', async () => {
    const huge = 'x'.repeat(MAX_TEXT_CHARS + 5000)
    setFile('f1', {
      project_id: 'p1',
      filename: 'big.txt',
      content_type: 'text/plain',
      storage_path: 'projects/p1/f1/big.txt',
      size_bytes: huge.length,
      status: 'ready',
    })
    mockS3Send.mockResolvedValue(bytesResponse(utf8(huge)))

    const { blocks } = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    const text = (blocks[0] as { text: string }).text
    expect(text.length).toBeLessThan(huge.length)
    expect(text.toLowerCase()).toContain('truncated')
  })

  it('drops files belonging to a different project (with reason)', async () => {
    setFile('f1', {
      project_id: 'other-project',
      filename: 'a.pdf',
      content_type: 'application/pdf',
      storage_path: 'projects/other-project/f1/a.pdf',
      size_bytes: 1024,
      status: 'ready',
    })

    const { blocks, dropped } = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks).toEqual([])
    expect(dropped).toEqual([{ filename: 'a.pdf', reason: 'wrong_project' }])
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('drops pending files (with reason)', async () => {
    setFile('f1', {
      project_id: 'p1',
      filename: 'a.pdf',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/a.pdf',
      size_bytes: 1024,
      status: 'pending',
    })

    const { blocks, dropped } = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks).toEqual([])
    expect(dropped).toEqual([{ filename: 'a.pdf', reason: 'pending' }])
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('drops files that do not exist (with reason)', async () => {
    const { blocks, dropped } = await loadAttachmentBlocks(mockDb, ['ghost'], 'p1')
    expect(blocks).toEqual([])
    expect(dropped).toEqual([{ filename: 'ghost', reason: 'not_found' }])
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('drops unsupported content types (with reason) instead of silently skipping', async () => {
    setFile('f1', {
      project_id: 'p1',
      filename: 'deck.pptx',
      content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      storage_path: 'projects/p1/f1/deck.pptx',
      size_bytes: 100,
      status: 'ready',
    })

    const { blocks, dropped } = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks).toEqual([])
    expect(dropped).toEqual([{ filename: 'deck.pptx', reason: 'unsupported' }])
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it('treats missing status as ready (legacy files)', async () => {
    setFile('f1', {
      project_id: 'p1',
      filename: 'a.pdf',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/a.pdf',
      size_bytes: 1024,
      // no status field — legacy file
    })
    mockS3Send.mockResolvedValue(bytesResponse(new Uint8Array([1])))

    const { blocks } = await loadAttachmentBlocks(mockDb, ['f1'], 'p1')
    expect(blocks).toHaveLength(1)
  })

  it('throws when total attachment bytes exceed the per-message cap', async () => {
    setFile('f1', {
      project_id: 'p1',
      filename: 'big.pdf',
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
      project_id: 'p1', filename: 'a.pdf',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/a.pdf',
      size_bytes: half,
      status: 'ready',
    })
    setFile('f2', {
      project_id: 'p1', filename: 'b.pdf',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f2/b.pdf',
      size_bytes: half,
      status: 'ready',
    })

    await expect(loadAttachmentBlocks(mockDb, ['f1', 'f2'], 'p1')).rejects.toThrow(
      /attachments_too_large/i,
    )
  })

  it('reports a dropped file (with reason) if its S3 fetch fails, keeps the rest', async () => {
    setFile('f1', {
      project_id: 'p1', filename: 'a.pdf',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f1/a.pdf',
      size_bytes: 1024,
      status: 'ready',
    })
    setFile('f2', {
      project_id: 'p1', filename: 'b.pdf',
      content_type: 'application/pdf',
      storage_path: 'projects/p1/f2/b.pdf',
      size_bytes: 1024,
      status: 'ready',
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockS3Send
      .mockResolvedValueOnce(bytesResponse(new Uint8Array([1])))
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NoSuchKey' }))

    const { blocks, dropped } = await loadAttachmentBlocks(mockDb, ['f1', 'f2'], 'p1')
    expect(blocks).toHaveLength(1)
    expect(dropped).toEqual([{ filename: 'b.pdf', reason: 'fetch_failed' }])
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('attachment_fetch_failed'),
      expect.objectContaining({ file_id: 'f2', aws_error: 'NoSuchKey' }),
    )
    consoleError.mockRestore()
  })
})
