import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getCreatorInfo, type CreatorInfo } from '@/lib/tiktok/content-posting'
import { getValidTikTokAccessToken } from '@/lib/tiktok/token-manager'
import type { Json } from '@/types/database'

const CREATOR_INFO_CACHE_MS = 10 * 60 * 1000

/**
 * GET /api/publish/creator-info?account_id=xxx
 * 
 * 获取指定 TikTok 账号的创作者信息（creator_info）
 * 返回：头像、昵称、可用隐私级别、互动设置、最大视频时长
 * 
 * 这是 TikTok Content Posting API 审核要求的关键数据源：
 * - 1.1 隐私选项必须从此 API 动态获取
 * - 1.2 互动禁用状态从此 API 获取
 * - 1.6 创作者头像+昵称展示
 * - 1.7 发布上限检查
 * - 1.8 视频时长校验
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()

        // 验证用户登录
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 })
        }

        // 获取 account_id 参数
        const accountId = request.nextUrl.searchParams.get('account_id')
        if (!accountId) {
            return NextResponse.json({ error: '缺少 account_id 参数' }, { status: 400 })
        }

        // 查询账号信息（验证归属并获取 token）
        const { data: account, error: accountError } = await supabase
            .from('tiktok_accounts')
            .select('id, access_token, refresh_token, access_token_expires_at, display_name, avatar_url, creator_info_cache, creator_info_cached_at')
            .eq('id', accountId)
            .eq('user_id', user.id)
            .single()

        if (accountError || !account) {
            return NextResponse.json({ error: '账号不存在或无权访问' }, { status: 404 })
        }

        const cachedAt = account.creator_info_cached_at ? new Date(account.creator_info_cached_at).getTime() : 0
        if (
            account.creator_info_cache
            && cachedAt > Date.now() - CREATOR_INFO_CACHE_MS
        ) {
            return NextResponse.json({
                success: true,
                data: toCreatorInfoPayload(account.creator_info_cache as unknown as CreatorInfo),
                cached: true,
            })
        }

        let accessToken = account.access_token
        try {
            accessToken = await getValidTikTokAccessToken(supabase, account)
        } catch (refreshError) {
            console.error('[CreatorInfo] Token refresh failed:', refreshError)
            return NextResponse.json({ error: '账号授权已过期，请重新授权', error_type: 'auth_expired' }, { status: 401 })
        }

        // 调用 TikTok creator_info API
        const creatorInfo = await getCreatorInfo(accessToken)
        await supabase
            .from('tiktok_accounts')
            .update({
                creator_info_cache: creatorInfo as unknown as Json,
                creator_info_cached_at: new Date().toISOString(),
            })
            .eq('id', accountId)

        return NextResponse.json({
            success: true,
            data: toCreatorInfoPayload(creatorInfo),
        })

    } catch (error) {
        console.error('[CreatorInfo] Error:', error)
        const message = error instanceof Error ? error.message : '获取创作者信息失败'
        return NextResponse.json({ error: message, error_type: 'api_error' }, { status: 500 })
    }
}

function toCreatorInfoPayload(creatorInfo: CreatorInfo) {
    return {
        avatar_url: creatorInfo.creator_avatar_url,
        username: creatorInfo.creator_username,
        nickname: creatorInfo.creator_nickname,
        privacy_level_options: creatorInfo.privacy_level_options,
        comment_disabled: creatorInfo.comment_disabled,
        duet_disabled: creatorInfo.duet_disabled,
        stitch_disabled: creatorInfo.stitch_disabled,
        max_video_post_duration_sec: creatorInfo.max_video_post_duration_sec,
    }
}
