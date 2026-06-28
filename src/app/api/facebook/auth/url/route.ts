import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { buildFacebookAuthorizationUrl } from '@/lib/facebook/oauth'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录后再绑定 Facebook 账号' }, { status: 401 })
    }

    const { authUrl, state, codeVerifier } = buildFacebookAuthorizationUrl(user.id)
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
      return NextResponse.json({ error: '初始化 Facebook 授权失败' }, { status: 500 })
    }

    return NextResponse.json({ authUrl })
  } catch (error) {
    console.error('Facebook auth URL error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '生成 Facebook 授权链接失败' },
      { status: 500 }
    )
  }
}
