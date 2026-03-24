import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole } from '@/lib/api/firebase-server-helpers'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { s3, S3_BUCKET } from '@/lib/s3/client'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { fileId } = await params

  const db = getAdminDb()
  const fileDoc = await db.collection('files').doc(fileId).get()

  if (!fileDoc.exists) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const fileData = fileDoc.data()!
  const role = await getProjectRole(db, fileData.project_id, auth.uid, auth.email)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: fileData.storage_path,
    }))

    if (!result.Body) {
      return NextResponse.json({ error: 'File data missing' }, { status: 502 })
    }

    const bytes = await result.Body.transformToByteArray()

    return new Response(Buffer.from(bytes) as unknown as BodyInit, {
      headers: {
        'Content-Type': fileData.content_type,
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileData.filename)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('S3 download failed:', err)
    return NextResponse.json({ error: 'File download failed' }, { status: 502 })
  }
}
