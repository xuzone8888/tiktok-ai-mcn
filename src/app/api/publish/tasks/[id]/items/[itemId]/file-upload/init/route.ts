import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { prepareTikTokFileUpload } from '@/lib/publish-processor'

export const runtime = 'nodejs'

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string; itemId: string }> }
) {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 })
    }

    const { id: taskId, itemId } = await params
    try {
        const admin = createAdminClient()
        // The browser cannot bypass persistent-preview preparation. Old clients
        // fail before dispatch; this check never resets an existing attempt.
        const { data: preview, error: previewError } = await admin
            .from('tiktok_task_previews')
            .select('item_id')
            .eq('item_id', itemId)
            .eq('owner_id', user.id)
            .eq('ready', true)
            .maybeSingle()
        if (previewError || !preview) {
            return NextResponse.json({ error: '请先保存视频预览，再开始 TikTok 上传' }, {
                status: 409, headers: { 'Cache-Control': 'no-store' },
            })
        }
        const prepared = await prepareTikTokFileUpload(
            admin,
            user.id,
            taskId,
            itemId
        )
        return NextResponse.json({ success: true, data: prepared }, {
            headers: {
                'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer',
            },
        })
    } catch {
        console.warn('[TikTok FILE_UPLOAD] Initialization stopped')
        return NextResponse.json({
            error: '无法准备 TikTok 文件上传，请检查任务状态后重试',
        }, { status: 409 })
    }
}
