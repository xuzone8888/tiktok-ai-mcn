import { NextResponse } from 'next/server'

import { isLinkedInPublishEnabledServer } from '@/lib/feature-flags'
import { buildLinkedInAuthorizationUrl } from '@/lib/linkedin/oauth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    if (!isLinkedInPublishEnabledServer()) {
      return NextResponse.json({ error: 'LinkedIn 发布功能已暂停', disabled: true }, { status: 403 })
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: '请先登录后再绑定 LinkedIn 账号' }, { status: 401 })
    }

    const { authUrl, state } = buildLinkedInAuthorizationUrl(user.id)
    const adminSupabase = createAdminClient() as any
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const { error } = await adminSupabase
      .from('linkedin_auth_states')
      .insert({
        state,
        user_id: user.id,
        expires_at: expiresAt,
        status: 'pending',
      })

    if (error) {
      console.error('Failed to store LinkedIn auth state:', error)
      return NextResponse.json({ error: '初始化 LinkedIn 授权失败' }, { status: 500 })
    }

    return NextResponse.json({ authUrl })
  } catch (error) {
    console.error('LinkedIn auth URL error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '生成 LinkedIn 授权链接失败' },
      { status: 500 }
    )
  }
}
