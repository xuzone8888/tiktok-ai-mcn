import crypto from 'crypto'

import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  calculateTikTokBusinessExpiration,
  exchangeTikTokBusinessCodeForToken,
  parseTikTokBusinessScopes,
} from '@/lib/tiktok/business-oauth'
import { buildTikTokAccountsUrl } from '@/lib/tiktok/routes'

function cleanProviderError(value: string | null) {
  return (value || 'TikTok Business authorization was not completed')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .slice(0, 200)
}

class TikTokBusinessCallbackError extends Error {
  constructor(
    readonly stableCode: string,
    message: string,
  ) {
    super(message)
    this.name = 'TikTokBusinessCallbackError'
  }
}

function callbackFailure(error: unknown) {
  if (error instanceof TikTokBusinessCallbackError) {
    return { code: error.stableCode, message: error.message }
  }
  return {
    code: 'callback_failed',
    message: cleanProviderError(error instanceof Error ? error.message : null),
  }
}

function completionFailure(code: string | undefined) {
  if (code === '57014' || code === '40001') {
    return new TikTokBusinessCallbackError(
      'authorization_conflict_retry',
      'TikTok 评论授权发生并发冲突，请返回账号管理页面后稍后重试',
    )
  }
  return new TikTokBusinessCallbackError(
    'authorization_commit_failed',
    'TikTok 评论授权暂时无法保存，请稍后重试',
  )
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const authCode = params.get('auth_code') || params.get('code')
  const state = params.get('state')
  const providerError = params.get('error') || params.get('error_description')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  if (!state) {
    return NextResponse.redirect(buildTikTokAccountsUrl(baseUrl, {
      business_error: 'TikTok 评论授权状态缺失',
    }))
  }

  const admin = createAdminClient()
  let claimed: { user_id: string; account_id: string } | null = null
  const processingToken = crypto.randomUUID()

  try {
    const { data, error } = await admin.rpc('claim_tiktok_business_auth_state', {
      p_state: state,
      p_processing_token: processingToken,
      p_lease_seconds: 60,
    })
    if (error) {
      throw new TikTokBusinessCallbackError(
        'authorization_state_unavailable',
        'TikTok 评论授权状态暂时不可用，请稍后重试',
      )
    }
    claimed = Array.isArray(data) ? data[0] || null : null
    if (!claimed) {
      return NextResponse.redirect(buildTikTokAccountsUrl(baseUrl, {
        business_error: 'TikTok 评论授权已过期或已使用',
      }))
    }

    if (providerError) {
      throw new Error(cleanProviderError(providerError))
    }
    if (!authCode) {
      throw new Error('TikTok 评论授权码缺失')
    }

    const token = await exchangeTikTokBusinessCodeForToken(authCode)
    const { data: completed, error: completeError } = await admin.rpc(
      'complete_tiktok_business_auth_state',
      {
        p_state: state,
        p_processing_token: processingToken,
        p_business_open_id: token.open_id,
        p_access_token: token.access_token,
        p_refresh_token: token.refresh_token,
        p_access_token_expires_at: calculateTikTokBusinessExpiration(token.expires_in),
        p_refresh_token_expires_at: calculateTikTokBusinessExpiration(
          token.refresh_token_expires_in,
        ),
        p_scopes: parseTikTokBusinessScopes(token.scope),
      },
    )
    if (completeError) {
      throw completionFailure(completeError.code)
    }
    if (completed !== true) {
      throw completionFailure('40001')
    }

    return NextResponse.redirect(buildTikTokAccountsUrl(baseUrl, {
      business_success: 'true',
      account_id: claimed.account_id,
    }))
  } catch (error) {
    const failure = callbackFailure(error)
    console.error('[TikTok Business OAuth] Callback failed:', failure.code)

    if (claimed) {
      const { data: failed, error: failError } = await admin.rpc(
        'fail_tiktok_business_auth_state',
        {
          p_state: state,
          p_processing_token: processingToken,
          p_error_code: failure.code,
          p_error_message: failure.message,
        },
      )
      if (failError || failed !== true) {
        console.error('[TikTok Business OAuth] Failed to persist callback failure')
      }
    }

    return NextResponse.redirect(buildTikTokAccountsUrl(baseUrl, {
      business_error: failure.message,
      business_error_code: failure.code,
    }))
  }
}
