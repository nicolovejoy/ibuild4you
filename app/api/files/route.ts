import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, getUserDisplayName } from '@/lib/api/firebase-server-helpers'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { s3, S3_BUCKET } from '@/lib/s3/client'
import crypto from 'crypto'

const MAX_FILE_SIZE = 4 * 1024 * 1024 // 4MB

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const formData = await request.formData()
  const projectId = formData.get('project_id') as string | null
  const sessionId = formData.get('session_id') as string | null

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Collect files from form data
  const files: File[] = []
  for (const [, value] of formData.entries()) {
    if (value instanceof File) {
      files.push(value)
    }
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 })
  }

  // Validate sizes
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      console.warn('upload_rejected_too_large', {
        filename: file.name,
        size: file.size,
        content_type: file.type,
        project_id: projectId,
        uid: auth.uid,
      })
      return NextResponse.json(
        { error: `File "${file.name}" exceeds 4MB limit` },
        { status: 400 }
      )
    }
  }

  const now = new Date().toISOString()
  const uploaderName = await getUserDisplayName(db, auth.uid, auth.email)
  const results = []

  for (const file of files) {
    const fileId = crypto.randomUUID()
    const storagePath = `projects/${projectId}/${fileId}/${file.name}`
    const buffer = Buffer.from(await file.arrayBuffer())

    try {
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: storagePath,
        Body: buffer,
        ContentType: file.type,
      }))
    } catch (err) {
      const awsError = err instanceof Error ? err.name : 'UnknownError'
      console.error('upload_failed_s3', {
        filename: file.name,
        size: file.size,
        content_type: file.type,
        project_id: projectId,
        uid: auth.uid,
        aws_error: awsError,
        message: err instanceof Error ? err.message : String(err),
      })
      return NextResponse.json(
        { error: `Storage upload failed (${awsError})` },
        { status: 502 }
      )
    }

    const doc = {
      project_id: projectId,
      ...(sessionId && { session_id: sessionId }),
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
      storage_path: storagePath,
      uploaded_by_email: auth.email,
      uploaded_by_uid: auth.uid,
      uploaded_by_name: uploaderName,
      created_at: now,
      updated_at: now,
    }

    await db.collection('files').doc(fileId).set(doc)
    results.push({ id: fileId, ...doc })
  }

  return NextResponse.json(results, { status: 201 })
}

export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const snap = await db
    .collection('files')
    .where('project_id', '==', projectId)
    .orderBy('created_at', 'desc')
    .get()

  const files = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  return NextResponse.json(files)
}
