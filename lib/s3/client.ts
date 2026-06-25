import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'

const REGION = process.env.AWS_REGION || 'us-east-1'

export const S3_BUCKET = process.env.AWS_S3_BUCKET || 'ibuild4you-files'

// Uses default credential chain (~/.aws/credentials, env vars, IAM role, etc.)
export const s3 = new S3Client({ region: REGION })

// Delete one object by key. DeleteObject is idempotent — S3 succeeds even if the
// key is already gone — so callers don't need to pre-check existence. Shared by
// single-file delete (#23a) and the project-delete sweep (#16 cleanup).
export async function deleteS3Object(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }))
}
