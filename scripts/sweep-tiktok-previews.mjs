#!/usr/bin/env node
// Run hourly with --env-file=<private env path> (Node 20+). No credentials in arguments.
// Deletion is idempotent. Keep tombstones seven days to catch uploads completing
// after a task was deleted. Physical cleanup failures leave a retryable queue row.
import { createClient } from '@supabase/supabase-js'
import OSS from 'ali-oss'

async function main() {
  const bucket = process.env.TIKTOK_PREVIEW_OSS_BUCKET
  const region = process.env.TIKTOK_PREVIEW_OSS_REGION
  if (!bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || bucket === (process.env.ALIYUN_OSS_BUCKET || 'tokfactory-videos') || !['oss-us-east-1','oss-us-west-1'].includes(region) || !process.env.TIKTOK_PREVIEW_OSS_ACCESS_KEY_ID || !process.env.TIKTOK_PREVIEW_OSS_ACCESS_KEY_SECRET) throw new Error('config')
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const oss = new OSS({ bucket, region, endpoint: `https://${region}.aliyuncs.com`, secure: true, timeout: 60_000,
    accessKeyId: process.env.TIKTOK_PREVIEW_OSS_ACCESS_KEY_ID, accessKeySecret: process.env.TIKTOK_PREVIEW_OSS_ACCESS_KEY_SECRET })
  if (process.argv.includes('--dry-run')) { console.log('Configuration parsed; no remote operations.'); return }
  // Never remove DB queue entries against a misconfigured/public/versioned bucket.
  const acl = await oss.getBucketACL(bucket)
  const versioning = await oss.getBucketVersioning(bucket)
  if (acl.acl !== 'private' || versioning.versionStatus) throw new Error('unsafe_bucket')
  try {
    await oss.getBucketPolicy(bucket)
    throw new Error('unsafe_policy')
  } catch (error) {
    if (error?.code !== 'NoSuchBucketPolicy') throw error
  }
  const { error: expiredError } = await db.from('tiktok_task_previews').delete().eq('ready', false)
    .lt('expires_at', new Date(Date.now() - 86400_000).toISOString())
  if (expiredError) throw new Error('expire_failed')
  const { data: rows, error } = await db.from('tiktok_preview_cleanup').select('*')
    .lte('next_attempt_at', new Date().toISOString()).order('next_attempt_at').limit(100)
  if (error) throw new Error('queue_failed')
  let completed = 0
  let failed = 0
  for (const row of rows) {
    try {
      if (![row.owner_id, row.upload_id].every(id => /^[0-9a-f-]{36}$/.test(id))) throw new Error('invalid_id')
      for (const kind of ['video', 'poster']) await oss.delete(`tiktok-previews/${row.owner_id}/${row.upload_id}/${kind}`)
      const next = Date.parse(row.retain_until) <= Date.now()
        ? db.from('tiktok_preview_cleanup').delete().eq('upload_id', row.upload_id)
        : db.from('tiktok_preview_cleanup').update({ next_attempt_at: new Date(Date.now() + 3600_000).toISOString() }).eq('upload_id', row.upload_id)
      const { error: updateError } = await next
      if (updateError) throw new Error('queue_update_failed')
      completed++
    } catch { failed++ }
  }
  console.log(JSON.stringify({ completed, failed, remainingPossible: rows.length === 100 }))
  if (failed) process.exitCode = 1
}
main().catch(() => { console.error('Preview cleanup failed; no queue entries were intentionally discarded.'); process.exitCode = 1 })
