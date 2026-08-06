import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { processYouTubeRevocationJobs } from '@/lib/youtube/data-governance'
import {
  calculateYouTubeTokenExpiration,
  getMyYouTubeChannel,
  isYouTubeAuthorizationRevokedError,
  refreshYouTubeAccessToken,
  scopesToArray,
} from '@/lib/youtube/oauth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false

  const authHeader = request.headers.get('authorization')
  const cronHeader = request.headers.get('x-cron-secret')
  return authHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret
}

async function runRetentionCleanup(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient() as any
  // Enforce hard local retention deadlines before any provider network call.
  // Google latency, outages, or function timeouts must never block deletion.
  const { data: cleanup, error: cleanupError } = await admin.rpc('cleanup_stale_youtube_api_data', {
    p_retention_days: 29,
  })
  if (cleanupError) {
    console.error('YouTube data retention cleanup failed:', {
      code: cleanupError.code,
      message: cleanupError.message,
    })
    return NextResponse.json({ error: 'YouTube data retention cleanup failed' }, { status: 500 })
  }

  const verificationCutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()
  const { data: accounts, error: accountsError } = await admin
    .from('youtube_accounts')
    .select('id, user_id, scopes')
    .eq('status', 'active')
    .lte('last_authorization_verified_at', verificationCutoff)
    .order('last_authorization_verified_at', { ascending: true })
    .limit(25)

  if (accountsError) {
    console.error('YouTube authorization verification scan failed:', {
      code: accountsError.code,
      message: accountsError.message,
    })
    return NextResponse.json({ error: 'YouTube authorization verification scan failed' }, { status: 500 })
  }

  const verification = { checked: 0, refreshed: 0, revoked: 0, deferred: 0 }
  for (const account of accounts || []) {
    verification.checked += 1
    const { data: tokenRecord, error: tokenReadError } = await admin
      .from('youtube_account_tokens')
      .select('refresh_token')
      .eq('account_id', account.id)
      .single()

    if (tokenReadError || !tokenRecord?.refresh_token) {
      console.error('YouTube verification token read failed:', {
        accountId: account.id,
        code: tokenReadError?.code || 'missing_token',
      })
      verification.deferred += 1
      continue
    }

    try {
      const token = await refreshYouTubeAccessToken(tokenRecord.refresh_token)
      const channel = await getMyYouTubeChannel(token.access_token)
      const now = new Date().toISOString()
      const expiresAt = calculateYouTubeTokenExpiration(token.expires_in).toISOString()
      const scopes = token.scope ? scopesToArray(token.scope) : account.scopes

      const { error: accountUpdateError } = await admin
        .from('youtube_accounts')
        .update({
          channel_title: channel.title,
          channel_handle: channel.handle,
          thumbnail_url: channel.thumbnailUrl,
          subscriber_count: channel.subscriberCount,
          video_count: channel.videoCount,
          view_count: channel.viewCount,
          access_token_expires_at: expiresAt,
          scopes,
          status: 'active',
          last_authorization_verified_at: now,
          authorization_invalidated_at: null,
          updated_at: now,
        })
        .eq('id', account.id)
        .eq('user_id', account.user_id)
      if (accountUpdateError) throw new Error(`Account update failed: ${accountUpdateError.message}`)

      const { error: tokenUpdateError } = await admin
        .from('youtube_account_tokens')
        .update({
          access_token: token.access_token,
          access_token_expires_at: expiresAt,
          updated_at: now,
        })
        .eq('account_id', account.id)
      if (tokenUpdateError) throw new Error(`Token update failed: ${tokenUpdateError.message}`)
      verification.refreshed += 1
    } catch (error) {
      if (isYouTubeAuthorizationRevokedError(error)) {
        const { error: deletionError } = await admin.rpc('queue_youtube_account_deletion', {
          p_user_id: account.user_id,
          p_account_id: account.id,
        })
        if (deletionError) {
          console.error('Failed to delete revoked YouTube authorization:', {
            accountId: account.id,
            code: deletionError.code,
            message: deletionError.message,
          })
          return NextResponse.json({ error: 'Failed to delete revoked YouTube authorization' }, { status: 500 })
        }
        verification.revoked += 1
      } else {
        // A transport or provider outage must not be treated as revocation.
        // The 29-day cleanup deadline remains the hard retention backstop.
        verification.deferred += 1
      }
    }
  }

  const revocation = await processYouTubeRevocationJobs(admin, { limit: 25 })
  return NextResponse.json({ success: true, cleanup, verification, revocation })
}

export async function GET(request: NextRequest) {
  return runRetentionCleanup(request)
}

export async function POST(request: NextRequest) {
  return runRetentionCleanup(request)
}
