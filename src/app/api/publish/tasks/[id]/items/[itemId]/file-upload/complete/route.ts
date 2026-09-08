import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { confirmTikTokFileUpload } from '@/lib/publish-processor'

export const runtime = 'nodejs'

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string; itemId: string }> }
) {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => null) as {
        attempt?: unknown
        uploadOutcome?: unknown
    } | null
    if (
        !Number.isSafeInteger(body?.attempt)
        || Number(body?.attempt) <= 0
        || !['accepted', 'unknown', 'rejected'].includes(String(body?.uploadOutcome))
    ) {
        return NextResponse.json({ error: '上传确认参数无效' }, { status: 400 })
    }

    const { id: taskId, itemId } = await params
    try {
        const outcome = await confirmTikTokFileUpload(
            createAdminClient(),
            user.id,
            taskId,
            itemId,
            Number(body?.attempt),
            String(body?.uploadOutcome) as 'accepted' | 'unknown' | 'rejected'
        )
        return NextResponse.json({ success: true, outcome }, {
            headers: { 'Cache-Control': 'no-store' },
        })
    } catch {
        console.warn('[TikTok FILE_UPLOAD] Completion check stopped')
        return NextResponse.json({
            error: '无法确认 TikTok 文件上传，请在任务列表查看状态',
        }, { status: 409 })
    }
}
