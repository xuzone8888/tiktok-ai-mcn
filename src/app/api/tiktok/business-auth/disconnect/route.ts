import crypto from 'crypto'

import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  revokeTikTokBusinessAccessToken,
} from '@/lib/tiktok/business-oauth'

export const dynamic = 'force-dynamic'

const REVOCATION_LEASE_SECONDS = 60
const SAFE_REVOCATION_ERROR = 'TikTok comment authorization revocation requires retry.'
const AMBIGUOUS_REVOCATION_CODES = new Set([
  'provider_revocation_unknown',
  'provider_revocation_rejected',
])

function getProviderWriteOutcome(error: unknown): 'unknown' | 'rejected' | null {
  if (!error || typeof error !== 'object') return null
  const outcome = (error as { providerWriteOutcome?: unknown }).providerWriteOutcome
  return outcome === 'unknown' || outcome === 'rejected' ? outcome : null
}

function firstRpcRow(value: unknown): {
  access_token: string
  business_open_id: string
  previous_error_code: string | null
} | null {
  if (!Array.isArray(value) || value.length !== 1) return null
  const row = value[0] as Record<string, unknown>
  if (typeof row.access_token !== 'string' || typeof row.business_open_id !== 'string') return null
  if (!row.access_token.trim() || !row.business_open_id.trim()) return null
  return {
    access_token: row.access_token,
    business_open_id: row.business_open_id,
    previous_error_code: typeof row.previous_error_code === 'string'
      ? row.previous_error_code
      : null,
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as {
    accountId?: unknown
    confirmUnknown?: unknown
  } | null
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : ''
  const confirmUnknown = body?.confirmUnknown === true
  if (!accountId) {
    return NextResponse.json({ error: '请选择需要断开评论授权的 TikTok 账号' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: account, error: accountError } = await admin
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
    return NextResponse.json({ error: 'TikTok 账号不存在或不可操作' }, { status: 404 })
  }

  const revocationToken = crypto.randomUUID()
  const actionLogId = crypto.randomUUID()
  const { data: claimData, error: claimError } = await admin.rpc(
    'begin_tiktok_business_token_revocation',
    {
      p_account_id: accountId,
      p_user_id: user.id,
      p_revocation_token: revocationToken,
      p_action_log_id: actionLogId,
      p_lease_seconds: REVOCATION_LEASE_SECONDS,
      p_manual_confirmation: confirmUnknown,
    },
  )

  if (claimError) {
    console.error('[TikTok Business OAuth] Disconnect claim failed:', claimError.code)
    return NextResponse.json({ error: '无法安全启动评论授权断开流程' }, { status: 503 })
  }

  const claimed = firstRpcRow(claimData)
  if (!claimed) {
    const { data: current, error: currentError } = await admin
      .from('tiktok_business_account_tokens')
      .select('status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (currentError) {
      return NextResponse.json({ error: '无法确认评论授权状态' }, { status: 503 })
    }
    if (!current) {
      return NextResponse.json({ disconnected: true })
    }
    return NextResponse.json(
      { error: '评论授权正在断开，请稍后刷新状态' },
      { status: 409, headers: { 'Retry-After': '60' } },
    )
  }

  if (AMBIGUOUS_REVOCATION_CODES.has(claimed.previous_error_code || '') && !confirmUnknown) {
    const previousErrorCode = claimed.previous_error_code || 'provider_revocation_unknown'
    const { data: deferred, error: deferError } = await admin.rpc(
      'defer_tiktok_business_token_revocation',
      {
        p_account_id: accountId,
        p_user_id: user.id,
        p_revocation_token: revocationToken,
        p_action_log_id: actionLogId,
        p_error_code: previousErrorCode,
        p_error_message: SAFE_REVOCATION_ERROR,
      },
    )
    if (deferError || deferred !== true) {
      return NextResponse.json({ error: '无法确认评论授权撤销状态' }, { status: 503 })
    }
    return NextResponse.json(
      {
        code: 'revocation_confirmation_required',
        error: 'TikTok 撤销结果无法自动确认。请先在 TikTok 授权设置中确认已撤销，再选择本地完成断开。',
      },
      { status: 409 },
    )
  }

  let providerSucceeded = confirmUnknown
    || claimed.previous_error_code === 'provider_succeeded_local_commit_pending'
  try {
    if (!providerSucceeded && !confirmUnknown) {
      await revokeTikTokBusinessAccessToken(claimed.access_token)
      providerSucceeded = true
    }
    const { data: completed, error: completeError } = await admin.rpc(
      'complete_tiktok_business_token_revocation',
      {
        p_account_id: accountId,
        p_user_id: user.id,
        p_revocation_token: revocationToken,
        p_action_log_id: actionLogId,
      },
    )
    if (completeError || completed !== true) {
      throw new Error('revocation_commit_failed')
    }
    return NextResponse.json({ disconnected: true })
  } catch (error) {
    const providerWriteOutcome = getProviderWriteOutcome(error)
    const stableCode = providerSucceeded
      ? 'provider_succeeded_local_commit_pending'
      : providerWriteOutcome
      ? providerWriteOutcome === 'unknown'
        ? 'provider_revocation_unknown'
        : 'provider_revocation_rejected'
      : 'revocation_commit_failed'
    const { data: deferred, error: deferError } = await admin.rpc(
      'defer_tiktok_business_token_revocation',
      {
        p_account_id: accountId,
        p_user_id: user.id,
        p_revocation_token: revocationToken,
        p_action_log_id: actionLogId,
        p_error_code: stableCode,
        p_error_message: SAFE_REVOCATION_ERROR,
      },
    )
    if (deferError) {
      console.error('[TikTok Business OAuth] Failed to persist disconnect retry state:', deferError.code)
    } else if (deferred !== true) {
      // The complete RPC may have committed even if its HTTP response was
      // lost. Treat a now-missing token as the concurrent completed winner;
      // never recreate or re-revoke it.
      const { data: current, error: currentError } = await admin
        .from('tiktok_business_account_tokens')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!currentError && !current) {
        return NextResponse.json({ disconnected: true })
      }
    }
    return NextResponse.json(
      { error: '评论授权已在本地停用，但 TikTok 撤销结果需要稍后重试' },
      { status: 503, headers: { 'Retry-After': '60' } },
    )
  }
}
