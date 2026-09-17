import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { previewStorage } from '@/lib/publish/private-preview-storage'

export const dynamic = 'force-dynamic'
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const { data: { user }, error } = await (await createClient()).auth.getUser()
    if (error || !user) return NextResponse.json({ error: '请先登录' }, { status: 401, headers })
    await previewStorage().assertPrivate()
    const { error: schemaError } = await createAdminClient().from('tiktok_task_previews').select('item_id').limit(0)
    if (schemaError) throw new Error('schema_unavailable')
    return NextResponse.json({ ready: true }, { headers })
  } catch {
    return NextResponse.json({ error: '私有预览存储尚未配置完成，请先完成配置；尚未创建发布任务' }, { status: 503, headers })
  }
}
