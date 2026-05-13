import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, getUserDisplayName } from '@/lib/api/firebase-server-helpers'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3, S3_BUCKET } from '@/lib/s3/client'
import crypto from 'crypto'

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB — Anthropic PDF cap is 32MB
const UPLOAD_URL_TTL_SECONDS = 300 // 5 minutes

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json().catch(() => ({}))
  const { project_id, session_id, filename, content_type, size_bytes } = body as {
    project_id?: string
    session_id?: string
    filename?: string
    content_type?: string
    size_bytes?: number
  }

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }
  if (!filename) {
    return NextResponse.json({ error: 'filename is required' }, { status: 400 })
  }
  if (!content_type) {
    return NextResponse.json({ error: 'content_type is required' }, { status: 400 })
  }
  if (typeof size_bytes !== 'number' || size_bytes <= 0) {
    return NextResponse.json({ error: 'size_bytes is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const role = await getProjectRole(db, project_id, auth.uid, auth.email, auth.systemRoles, auth)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (size_bytes > MAX_FILE_SIZE) {
    console.warn('upload_rejected_too_large', {
      filename,
      size: size_bytes,
      content_type,
      project_id,
      uid: auth.uid,
    })
    return NextResponse.json(
      { error: `File "${filename}" exceeds 25MB limit` },
      { status: 413 },
    )
  }

  const fileId = crypto.randomUUID()
  const storagePath = `projects/${project_id}/${fileId}/${filename}`

  let uploadUrl: string
  try {
    uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: storagePath,
        ContentType: content_type,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    )
  } catch (err) {
    const awsError = err instanceof Error ? err.name : 'UnknownError'
    console.error('upload_init_failed', {
      filename,
      size: size_bytes,
      content_type,
      project_id,
      uid: auth.uid,
      aws_error: awsError,
      message: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: `Storage init failed (${awsError})` },
      { status: 502 },
    )
  }

  const uploaderName = await getUserDisplayName(db, auth.uid, auth.email)
  const now = new Date().toISOString()

  await db.collection('files').doc(fileId).set({
    project_id,
    ...(session_id && { session_id }),
    filename,
    content_type,
    size_bytes,
    storage_path: storagePath,
    uploaded_by_email: auth.email,
    uploaded_by_uid: auth.uid,
    uploaded_by_name: uploaderName,
    status: 'pending',
    created_at: now,
    updated_at: now,
  })

  return NextResponse.json(
    { file_id: fileId, upload_url: uploadUrl, storage_path: storagePath },
    { status: 201 },
  )
}
