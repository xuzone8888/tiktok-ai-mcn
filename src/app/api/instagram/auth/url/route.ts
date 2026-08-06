import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  buildInstagramAuthorizationUrl,
  buildInstagramAuthorizationUrlFromState,
} from '@/lib/instagram/oauth'
import {
  selectReusableInstagramAuthState,
  shouldReadBackInstagramAuthStateAfterInsertError,
  type StoredInstagramAuthState,
} from '@/lib/instagram/oauth-state'

export const dynamic = 'force-dynamic'

const AUTH_STATE_TTL_MS = 10 * 60 * 1000

async function findReusableAuthState(
  adminSupabase: any,
  userId: string,
  nowIso: string,
  nowMs: number
): Promise<{ authState: StoredInstagramAuthState | null; error: any }> {
  const { data, error } = await adminSupabase
    .from('instagram_auth_states')
    .select('state,code_verifier,status,expires_at,created_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: true })
    .limit(10)

  if (error) return { authState: null, error }

  return {
    authState: selectReusableInstagramAuthState((data || []) as StoredInstagramAuthState[], nowMs),
    error: null,
  }
}

function buildStoredAuthUrl(authState: StoredInstagramAuthState): string {
  return buildInstagramAuthorizationUrlFromState({
    state: authState.state,
    codeVerifier: authState.code_verifier,
  })
}

function logDatabaseError(message: string, error: any) {
  console.error(message, { code: error?.code || 'unknown' })
}

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录后再绑定 Instagram 账号' }, { status: 401 })
    }

    const adminSupabase = createAdminClient() as any
    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()

    const { error: expireError } = await adminSupabase
      .from('instagram_auth_states')
      .update({
        status: 'expired',
        error_code: 'expired',
        error_message: 'Authorization session expired.',
        code_verifier: null,
      })
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .lte('expires_at', nowIso)

    if (expireError) {
      logDatabaseError('Failed to expire Instagram auth states:', expireError)
      return NextResponse.json({ error: '初始化 Instagram 授权失败' }, { status: 500 })
    }

    const existingResult = await findReusableAuthState(adminSupabase, user.id, nowIso, nowMs)
    if (existingResult.error) {
      logDatabaseError('Failed to read Instagram auth state:', existingResult.error)
      return NextResponse.json({ error: '初始化 Instagram 授权失败' }, { status: 500 })
    }

    if (existingResult.authState) {
      return NextResponse.json({
        authUrl: buildStoredAuthUrl(existingResult.authState),
        reused: true,
      })
    }

    const { authUrl, state, codeVerifier } = buildInstagramAuthorizationUrl(user.id)
    const expiresAt = new Date(nowMs + AUTH_STATE_TTL_MS).toISOString()

    const { error: insertError } = await adminSupabase
      .from('instagram_auth_states')
      .insert({
        state,
        code_verifier: codeVerifier,
        user_id: user.id,
        expires_at: expiresAt,
        status: 'pending',
      })

    if (!insertError) {
      return NextResponse.json({ authUrl, reused: false })
    }

    if (shouldReadBackInstagramAuthStateAfterInsertError(insertError)) {
      const winnerResult = await findReusableAuthState(adminSupabase, user.id, nowIso, nowMs)
      if (!winnerResult.error && winnerResult.authState) {
        return NextResponse.json({
          authUrl: buildStoredAuthUrl(winnerResult.authState),
          reused: true,
        })
      }

      if (winnerResult.error) {
        logDatabaseError('Failed to read winning Instagram auth state:', winnerResult.error)
      } else {
        console.error('Instagram auth state uniqueness conflict had no reusable winner.')
      }
      return NextResponse.json({ error: '初始化 Instagram 授权失败' }, { status: 500 })
    }

    logDatabaseError('Failed to store Instagram auth state:', insertError)
    return NextResponse.json({ error: '初始化 Instagram 授权失败' }, { status: 500 })
  } catch (error) {
    console.error('Instagram auth URL error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '生成 Instagram 授权链接失败' },
      { status: 500 }
    )
  }
}
