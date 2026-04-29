import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'

// =============================================================================
// FILES ROUTE TESTS — POST /api/files
//
// Phase 1 focus: validation, error mapping, and structured logging on every
// failure path. Follow-on phases (presigned upload, agent integration) will
// extend this suite — see docs/file-upload-plan.md.
// =============================================================================

const mockGetProjectRole = vi.fn()
const mockGetUserDisplayName = vi.fn()
const mockS3Send = vi.fn()

const setCalls: { id: string; data: Record<string, unknown> }[] = []
const mockSet = vi.fn(async (data: Record<string, unknown>) => {
  setCalls.push({ id: lastDocId, data })
})
let lastDocId = ''

const mockCollection = vi.fn(() => ({
  doc: vi.fn((id?: string) => {
    lastDocId = id || ''
    return { set: mockSet }
  }),
}))

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'user@ibuild4you.com',
    error: null,
    systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  getUserDisplayName: (...args: unknown[]) => mockGetUserDisplayName(...args),
}))

vi.mock('@/lib/s3/client', () => ({
  s3: { send: (...args: unknown[]) => mockS3Send(...args) },
  S3_BUCKET: 'test-bucket',
}))

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: vi.fn((input) => ({ input })),
}))

function makeFile(name: string, size: number, type = 'application/pdf'): File {
  return new File([new Uint8Array(size)], name, { type })
}

function makeRequest(formData: FormData) {
  return new Request('http://localhost/api/files', {
    method: 'POST',
    body: formData,
  })
}

beforeEach(() => {
  setCalls.length = 0
  mockSet.mockClear()
  mockGetProjectRole.mockReset().mockResolvedValue('owner')
  mockGetUserDisplayName.mockReset().mockResolvedValue('Test User')
  mockS3Send.mockReset().mockResolvedValue({})
})

describe('POST /api/files', () => {
  describe('validation', () => {
    it('returns 400 when project_id is missing', async () => {
      const fd = new FormData()
      fd.append('files', makeFile('a.pdf', 1024))
      const res = await POST(makeRequest(fd))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/project_id/)
    })

    it('returns 400 when no files attached', async () => {
      const fd = new FormData()
      fd.append('project_id', 'p1')
      const res = await POST(makeRequest(fd))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/no files/i)
    })

    it('returns 404 when caller has no project role', async () => {
      mockGetProjectRole.mockResolvedValue(null)
      const fd = new FormData()
      fd.append('project_id', 'p1')
      fd.append('files', makeFile('a.pdf', 1024))
      const res = await POST(makeRequest(fd))
      expect(res.status).toBe(404)
    })
  })

  describe('size limit', () => {
    it('returns 400 with filename + 4MB cap message when file is oversized', async () => {
      const fd = new FormData()
      fd.append('project_id', 'p1')
      fd.append('files', makeFile('big.pdf', 5 * 1024 * 1024))
      const res = await POST(makeRequest(fd))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('big.pdf')
      expect(body.error).toMatch(/4MB/i)
    })

    it('logs filename + size + content_type on size rejection', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const fd = new FormData()
      fd.append('project_id', 'p1')
      fd.append('files', makeFile('big.pdf', 5 * 1024 * 1024))
      await POST(makeRequest(fd))
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('upload_rejected_too_large'),
        expect.objectContaining({
          filename: 'big.pdf',
          size: 5 * 1024 * 1024,
          content_type: 'application/pdf',
        }),
      )
      consoleWarn.mockRestore()
    })

    it('does not call S3 when a file is rejected for size', async () => {
      const fd = new FormData()
      fd.append('project_id', 'p1')
      fd.append('files', makeFile('big.pdf', 5 * 1024 * 1024))
      await POST(makeRequest(fd))
      expect(mockS3Send).not.toHaveBeenCalled()
    })
  })

  describe('S3 errors', () => {
    it('returns 502 with AWS error name when S3 PutObject rejects', async () => {
      mockS3Send.mockRejectedValue(Object.assign(new Error('Access denied'), { name: 'AccessDenied' }))
      const fd = new FormData()
      fd.append('project_id', 'p1')
      fd.append('files', makeFile('a.pdf', 1024))
      const res = await POST(makeRequest(fd))
      expect(res.status).toBe(502)
      const body = await res.json()
      expect(body.error).toMatch(/storage/i)
      expect(body.error).toContain('AccessDenied')
    })

    it('logs filename + size + content_type + AWS error name on S3 failure', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockS3Send.mockRejectedValue(Object.assign(new Error('No bucket'), { name: 'NoSuchBucket' }))
      const fd = new FormData()
      fd.append('project_id', 'p1')
      fd.append('files', makeFile('a.pdf', 1024, 'application/pdf'))
      await POST(makeRequest(fd))
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('upload_failed_s3'),
        expect.objectContaining({
          filename: 'a.pdf',
          size: 1024,
          content_type: 'application/pdf',
          aws_error: 'NoSuchBucket',
        }),
      )
      consoleError.mockRestore()
    })

    it('does not write a Firestore doc when S3 upload fails', async () => {
      mockS3Send.mockRejectedValue(Object.assign(new Error('fail'), { name: 'AccessDenied' }))
      const fd = new FormData()
      fd.append('project_id', 'p1')
      fd.append('files', makeFile('a.pdf', 1024))
      await POST(makeRequest(fd))
      expect(mockSet).not.toHaveBeenCalled()
    })
  })

  describe('happy path', () => {
    it('returns 201 with file metadata on success', async () => {
      const fd = new FormData()
      fd.append('project_id', 'p1')
      fd.append('session_id', 's1')
      fd.append('files', makeFile('a.pdf', 1024))
      const res = await POST(makeRequest(fd))
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({
        filename: 'a.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
        project_id: 'p1',
        session_id: 's1',
      })
      expect(mockS3Send).toHaveBeenCalledTimes(1)
      expect(mockSet).toHaveBeenCalledTimes(1)
    })

    it('handles multiple files in one request', async () => {
      const fd = new FormData()
      fd.append('project_id', 'p1')
      fd.append('files', makeFile('a.pdf', 1024))
      fd.append('files', makeFile('b.png', 2048, 'image/png'))
      const res = await POST(makeRequest(fd))
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body).toHaveLength(2)
      expect(mockS3Send).toHaveBeenCalledTimes(2)
      expect(mockSet).toHaveBeenCalledTimes(2)
    })
  })
})
