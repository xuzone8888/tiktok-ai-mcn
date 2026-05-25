import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { isTikTokGroupsDemoMode } from '@/lib/tiktok/demo-account-groups'

export const dynamic = 'force-dynamic'

interface GenerationVideoRow {
    id: string
    type: string | null
    status: string | null
    result_url: string | null
    video_url: string | null
    thumbnail_url: string | null
    prompt: string | null
    model: string | null
    created_at: string
}

function demoAssets() {
    return Array.from({ length: 5 }, (_, index) => {
        const number = index + 1
        return {
            id: `demo-multi-task-asset-${number}`,
            name: `制作区视频 ${number}`,
            source_url: `https://media.toryxai.com/demo/multi-task-asset-${number}.mp4`,
            thumbnail_url: null,
            prompt: `制作区视频 ${number}`,
            model: 'demo',
            created_at: new Date(Date.UTC(2026, 4, 16, 8, index)).toISOString(),
        }
    })
}

function toAsset(row: GenerationVideoRow) {
    const sourceUrl = row.result_url || row.video_url || null
    const prompt = row.prompt?.trim() || ''

    return {
        id: row.id,
        name: prompt.slice(0, 40) || `制作区视频 ${new Date(row.created_at).toLocaleDateString('zh-CN')}`,
        source_url: sourceUrl,
        thumbnail_url: row.thumbnail_url,
        prompt: row.prompt,
        model: row.model,
        created_at: row.created_at,
    }
}

export async function GET() {
    try {
        if (isTikTokGroupsDemoMode()) {
            return NextResponse.json({ success: true, assets: demoAssets() })
        }

        const supabase = await createClient()
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 })
        }

        const { data, error } = await supabase
            .from('generations')
            .select('id, type, status, result_url, video_url, thumbnail_url, prompt, model, created_at')
            .eq('user_id', user.id)
            .eq('type', 'video')
            .eq('status', 'completed')
            .order('created_at', { ascending: false })
            .limit(60)

        if (error) {
            console.error('[MultiTaskAssets] Fetch failed:', error)
            return NextResponse.json({ success: false, error: '获取制作区视频失败' }, { status: 500 })
        }

        const assets = ((data || []) as GenerationVideoRow[])
            .map(toAsset)
            .filter((asset) => Boolean(asset.source_url))

        return NextResponse.json({ success: true, assets })
    } catch (error) {
        console.error('[MultiTaskAssets] Error:', error)
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : '获取制作区视频失败' },
            { status: 500 }
        )
    }
}
