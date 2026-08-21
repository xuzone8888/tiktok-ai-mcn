import { NextRequest, NextResponse } from 'next/server'

import { buildFacebookAuthorizationUrl } from '@/lib/facebook/oauth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { locale?: unknown } | null
  const locale = body?.locale === 'en_US' ? 'en_US' : 'zh_CN'
  const isEnglish = locale === 'en_US'

  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({
        error: isEnglish ? 'Sign in before connecting a Facebook account.' : '请先登录后再绑定 Facebook 账号',
      }, { status: 401 })
    }

    const { authUrl, state, codeVerifier } = buildFacebookAuthorizationUrl(user.id, locale)
    const adminSupabase = createAdminClient() as any
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const { error } = await adminSupabase
      .from('facebook_auth_states')
      .insert({
        state,
        code_verifier: codeVerifier,
        user_id: user.id,
        expires_at: expiresAt,
        status: 'pending',
      })

    if (error) {
      console.error('Failed to store Facebook auth state:', error)
      return NextResponse.json({
        error: isEnglish ? 'Failed to initialize Facebook authorization.' : '初始化 Facebook 授权失败',
      }, { status: 500 })
    }

    return NextResponse.json({ authUrl })
  } catch (error) {
    console.error('Facebook auth URL error:', error)
    const fallback = isEnglish
      ? 'Failed to create the Facebook authorization link.'
      : '生成 Facebook 授权链接失败'
    const message = error instanceof Error ? error.message : ''
    return NextResponse.json(
      {
        error: isEnglish && /[\u3400-\u9fff]/.test(message)
          ? fallback
          : message || fallback,
      },
      { status: 500 }
    )
  }
}
