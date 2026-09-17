import { previewKey, previewPostPolicy } from './private-preview-contract'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OSS = require('ali-oss')

/** Deliberately NOT the public/CDN media bucket. No public URL is ever returned. */
export function previewStorage() {
  const bucket = process.env.TIKTOK_PREVIEW_OSS_BUCKET
  const region = process.env.TIKTOK_PREVIEW_OSS_REGION
  // Keep retained preview media aligned with the current US-storage disclosure.
  if (!['oss-us-east-1', 'oss-us-west-1'].includes(region || '')) throw new Error('preview_region_not_supported')
  if (!bucket || bucket === (process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos') || !process.env.TIKTOK_PREVIEW_OSS_ACCESS_KEY_ID || !process.env.TIKTOK_PREVIEW_OSS_ACCESS_KEY_SECRET || !/^oss-[a-z0-9-]+$/.test(region || '') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('preview_storage_not_configured')
  const client = new OSS({
    region, bucket, secure: true, timeout: 60_000,
    endpoint: `https://${region}.aliyuncs.com`,
    accessKeyId: process.env.TIKTOK_PREVIEW_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.TIKTOK_PREVIEW_OSS_ACCESS_KEY_SECRET || '',
  })
  const origin = `https://${bucket}.${region}.aliyuncs.com`
  return {
    async assertPrivate() {
      const acl = await client.getBucketACL(bucket)
      if (acl.acl !== 'private') throw new Error('preview_bucket_not_private')
      const versioning = await client.getBucketVersioning(bucket)
      if (versioning.versionStatus) throw new Error('preview_bucket_versioning_not_supported')
      // A public bucket policy may override ACLs. Only an absent policy is accepted.
      try {
        await client.getBucketPolicy(bucket)
        throw new Error('preview_bucket_policy_not_supported')
      } catch (error) {
        if ((error as { code?: string }).code !== 'NoSuchBucketPolicy') throw error
      }
    },
    upload(ownerId: string, uploadId: string, kind: 'video' | 'poster', type: string, size: number, expiresAt: string) {
      const key = previewKey(ownerId, uploadId, kind)
      const signed = client.calculatePostSignature(previewPostPolicy(bucket, key, type, size, expiresAt))
      return { url: origin, fields: {
        key, 'x-oss-content-type': type, 'x-oss-object-acl': 'private',
        'x-oss-forbid-overwrite': 'true', success_action_status: '204',
        OSSAccessKeyId: signed.OSSAccessKeyId, policy: signed.policy, Signature: signed.Signature,
      } }
    },
    async verify(ownerId: string, uploadId: string, kind: 'video' | 'poster', type: string, size: number) {
      const key = previewKey(ownerId, uploadId, kind)
      const [head, acl] = await Promise.all([client.head(key), client.getACL(key)])
      if (Number(head.res.headers['content-length']) !== size || head.res.headers['content-type']?.split(';')[0] !== type || acl.acl !== 'private') throw new Error('preview_object_invalid')
    },
    readUrl(ownerId: string, uploadId: string, kind: 'video' | 'poster') {
      return client.signatureUrl(previewKey(ownerId, uploadId, kind), { expires: 60 }) as string
    },
  }
}
