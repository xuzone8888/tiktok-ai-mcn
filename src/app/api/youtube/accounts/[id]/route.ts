import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { processYouTubeRevocationJobs } from '@/lib/youtube/data-governance'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: account, error: fetchError } = await (supabase as any)
      .from('youtube_accounts')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !account) {
      return NextResponse.json({ error: '账号不存在或无权访问' }, { status: 404 })
    }

    const adminSupabase = createAdminClient() as any
    // The RPC atomically queues Google revocation and removes local data.
    // Remote revocation is retried separately, so a network failure cannot
    // leave the local account/token in a half-deleted state.
    const { data: deletion, error } = await adminSupabase.rpc('queue_youtube_account_deletion', {
      p_user_id: user.id,
      p_account_id: account.id,
    })

    if (error) {
      return NextResponse.json({ error: '移除 YouTube 账号失败' }, { status: 500 })
    }

    const revocationJobId = deletion?.revocation_job_id
    const revocation = revocationJobId
      ? await processYouTubeRevocationJobs(adminSupabase, { jobId: revocationJobId, limit: 1 })
      : { attempted: 0, completed: 0, deferred: 0 }

    return NextResponse.json({ success: true, deletion, revocation })
  } catch (error) {
    console.error('Delete YouTube account error:', error)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
