import { S3Client } from '@aws-sdk/client-s3'

const REGION = process.env.AWS_REGION || 'us-east-1'

export const S3_BUCKET = process.env.AWS_S3_BUCKET || 'ibuild4you-files'

// Uses default credential chain (~/.aws/credentials, env vars, IAM role, etc.)
export const s3 = new S3Client({ region: REGION })
