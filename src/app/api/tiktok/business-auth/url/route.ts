import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  isSocialCommentPlatformEnabled,
  isSocialCommentsApiEnabled,
} from '@/lib/social-comments/feature-flag'
import {
  buildTikTokBusinessAuthorizationUrl,
  generateTikTokBusinessState,
} from '@/lib/tiktok/business-oauth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    if (!isSocialCommentsApiEnabled() || !isSocialCommentPlatformEnabled('tiktok')) {
      return NextResponse.json({ error: 'TikTok 评论功能当前未启用' }, { status: 404 })
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => null) as { accountId?: unknown } | null
    const accountId = typeof body?.accountId === 'string' ? body.accountId : ''
    if (!accountId) {
      return NextResponse.json({ error: '请选择需要开启评论管理的 TikTok 账号' }, { status: 400 })
    }

    const { data: account, error: accountError } = await supabase
      .from('tiktok_accounts')
      .select('id')
      .eq('id', accountId)
      .eq('user_id', user.id)
      .eq('account_type', 'normal')
      .maybeSingle()

    if (accountError) {
      return NextResponse.json({ error: '读取 TikTok 账号失败' }, { status: 500 })
    }
    if (!account) {
      return NextResponse.json({ error: 'TikTok 账号不存在或不可授权' }, { status: 404 })
    }

    const state = generateTikTokBusinessState()
    const authUrl = buildTikTokBusinessAuthorizationUrl(state)
    const admin = createAdminClient()
    const { data: generationRow, error: generationError } = await admin
      .from('tiktok_accounts')
      .select('business_comment_auth_generation')
      .eq('id', accountId)
      .eq('user_id', user.id)
      .eq('account_type', 'normal')
      .maybeSingle()
    const { data: existingAuthorization, error: authorizationError } = await admin
      .from('tiktok_business_account_tokens')
      .select('status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (generationError || authorizationError || !generationRow?.business_comment_auth_generation) {
      return NextResponse.json({ error: '无法确认 TikTok 评论授权代次' }, { status: 503 })
    }
    if (existingAuthorization?.status === 'revocation_pending') {
      return NextResponse.json(
        { error: '评论授权正在断开，请等待完成后再重新授权' },
        { status: 409, headers: { 'Retry-After': '60' } },
      )
    }
    const now = new Date().toISOString()
    const { error: pendingCleanupError } = await admin
      .from('tiktok_business_auth_states')
      .update({
        status: 'expired',
        completed_at: now,
        error_code: 'expired',
        error_message: 'Authorization session expired.',
      })
      .eq('user_id', user.id)
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .lt('expires_at', now)

    const { error: processingCleanupError } = await admin
      .from('tiktok_business_auth_states')
      .update({
        status: 'expired',
        completed_at: now,
        error_code: 'processing_lease_expired',
        error_message: 'Authorization processing lease expired.',
      })
      .eq('user_id', user.id)
      .eq('account_id', accountId)
      .eq('status', 'processing')
      .lt('processing_expires_at', now)

    if (pendingCleanupError || processingCleanupError) {
      console.error('[TikTok Business OAuth] Failed to clean expired state:', {
        code: pendingCleanupError?.code || processingCleanupError?.code || 'database_error',
      })
      return NextResponse.json({ error: '无法初始化 TikTok 评论授权' }, { status: 500 })
    }

    const { error: stateError } = await admin
      .from('tiktok_business_auth_states')
      .insert({
        state,
        user_id: user.id,
        account_id: accountId,
        account_generation: generationRow.business_comment_auth_generation,
        status: 'pending',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })

    if (stateError) {
      if (stateError.code === '23505') {
        return NextResponse.json(
          { error: '该账号已有进行中的评论授权，请完成后再试' },
          { status: 409 },
        )
      }
      console.error('[TikTok Business OAuth] Failed to store state:', { code: stateError.code || 'database_error' })
      return NextResponse.json({ error: '无法初始化 TikTok 评论授权' }, { status: 500 })
    }

    return NextResponse.json({
      authUrl,
    })
  } catch (error) {
    const publicMessage = error instanceof Error
      && error.message.startsWith('TikTok Business OAuth configuration is incomplete.')
      ? 'TikTok Business OAuth configuration is incomplete.'
      : '无法生成 TikTok 评论授权链接'
    console.error('[TikTok Business OAuth] URL generation failed:', {
      name: error instanceof Error ? error.name : 'Error',
      code: 'authorization_url_failed',
    })
    return NextResponse.json(
      { error: publicMessage },
      { status: 500 },
    )
  }
}
