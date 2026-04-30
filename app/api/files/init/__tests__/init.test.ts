import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'

// =============================================================================
// FILES INIT ROUTE TESTS — POST /api/files/init
//
// Phase 2 of the upload plan: client requests a presigned PUT URL to upload
// directly to S3, bypassing Vercel's 4.5MB function-body cap. This route
// validates auth, role, and size, creates a `pending` Firestore doc, and
// returns the upload URL. Client follows up with /api/files/[id]/confirm.
// =============================================================================

const MAX_FILE_SIZE = 25 * 1024 * 1024

const mockGetProjectRole = vi.fn()
const mockGetUserDisplayName = vi.fn()
const mockGetSignedUrl = vi.fn()

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
  s3: {},
  S3_BUCKET: 'test-bucket',
}))

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: vi.fn((input) => ({ input })),
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/files/init', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  setCalls.length = 0
  mockSet.mockClear()
  mockGetProjectRole.mockReset().mockResolvedValue('owner')
  mockGetUserDisplayName.mockReset().mockResolvedValue('Test User')
  mockGetSignedUrl.mockReset().mockResolvedValue('https://s3.example.com/signed-url')
})

describe('POST /api/files/init', () => {
  describe('validation', () => {
    it.each([
      ['project_id', { filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 1024 }],
      ['filename', { project_id: 'p1', content_type: 'application/pdf', size_bytes: 1024 }],
      ['content_type', { project_id: 'p1', filename: 'a.pdf', size_bytes: 1024 }],
      ['size_bytes', { project_id: 'p1', filename: 'a.pdf', content_type: 'application/pdf' }],
    ])('returns 400 when %s is missing', async (field, body) => {
      const res = await POST(makeRequest(body))
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toMatch(new RegExp(field))
    })

    it('returns 404 when caller has no project role', async () => {
      mockGetProjectRole.mockResolvedValue(null)
      const res = await POST(makeRequest({
        project_id: 'p1', filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 1024,
      }))
      expect(res.status).toBe(404)
    })
  })

  describe('size limit', () => {
    it('returns 413 when size exceeds 25MB', async () => {
      const res = await POST(makeRequest({
        project_id: 'p1',
        filename: 'huge.pdf',
        content_type: 'application/pdf',
        size_bytes: MAX_FILE_SIZE + 1,
      }))
      expect(res.status).toBe(413)
      const data = await res.json()
      expect(data.error).toContain('huge.pdf')
      expect(data.error).toMatch(/25MB/i)
    })

    it('logs filename + size + content_type on size rejection', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await POST(makeRequest({
        project_id: 'p1',
        filename: 'huge.pdf',
        content_type: 'application/pdf',
        size_bytes: MAX_FILE_SIZE + 1,
      }))
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('upload_rejected_too_large'),
        expect.objectContaining({
          filename: 'huge.pdf',
          size: MAX_FILE_SIZE + 1,
          content_type: 'application/pdf',
        }),
      )
      consoleWarn.mockRestore()
    })

    it('does not call presigner or write Firestore on size rejection', async () => {
      await POST(makeRequest({
        project_id: 'p1',
        filename: 'huge.pdf',
        content_type: 'application/pdf',
        size_bytes: MAX_FILE_SIZE + 1,
      }))
      expect(mockGetSignedUrl).not.toHaveBeenCalled()
      expect(mockSet).not.toHaveBeenCalled()
    })

    it('accepts a file at exactly the cap', async () => {
      const res = await POST(makeRequest({
        project_id: 'p1',
        filename: 'big.pdf',
        content_type: 'application/pdf',
        size_bytes: MAX_FILE_SIZE,
      }))
      expect(res.status).toBe(201)
    })
  })

  describe('happy path', () => {
    it('returns 201 with file_id, upload_url, and storage_path', async () => {
      const res = await POST(makeRequest({
        project_id: 'p1',
        filename: 'a.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
        session_id: 's1',
      }))
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data).toMatchObject({
        upload_url: 'https://s3.example.com/signed-url',
      })
      expect(data.file_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(data.storage_path).toContain('p1')
      expect(data.storage_path).toContain('a.pdf')
    })

    it('writes a pending Firestore doc with metadata', async () => {
      await POST(makeRequest({
        project_id: 'p1',
        filename: 'a.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
        session_id: 's1',
      }))
      expect(mockSet).toHaveBeenCalledTimes(1)
      const written = setCalls[0].data
      expect(written).toMatchObject({
        project_id: 'p1',
        session_id: 's1',
        filename: 'a.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
        uploaded_by_email: 'user@ibuild4you.com',
        uploaded_by_uid: 'user-123',
        uploaded_by_name: 'Test User',
        status: 'pending',
      })
      expect(written.created_at).toBeTypeOf('string')
      expect(written.storage_path).toBeTypeOf('string')
    })

    it('omits session_id from doc when not provided', async () => {
      await POST(makeRequest({
        project_id: 'p1',
        filename: 'a.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
      }))
      expect(mockSet).toHaveBeenCalledTimes(1)
      expect(setCalls[0].data).not.toHaveProperty('session_id')
    })
  })

  describe('presigner errors', () => {
    it('returns 502 with structured log when getSignedUrl fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockGetSignedUrl.mockRejectedValue(
        Object.assign(new Error('cred fail'), { name: 'CredentialsProviderError' }),
      )
      const res = await POST(makeRequest({
        project_id: 'p1',
        filename: 'a.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
      }))
      expect(res.status).toBe(502)
      const data = await res.json()
      expect(data.error).toContain('CredentialsProviderError')
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('upload_init_failed'),
        expect.objectContaining({
          filename: 'a.pdf',
          aws_error: 'CredentialsProviderError',
        }),
      )
      expect(mockSet).not.toHaveBeenCalled()
      consoleError.mockRestore()
    })
  })
})
