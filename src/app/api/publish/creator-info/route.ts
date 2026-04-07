import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCreatorInfo } from '@/lib/tiktok/content-posting'
import { refreshAccessToken } from '@/lib/tiktok/oauth'

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
            .select('id, access_token, refresh_token, display_name, avatar_url')
            .eq('id', accountId)
            .eq('user_id', user.id)
            .single()

        if (accountError || !account) {
            return NextResponse.json({ error: '账号不存在或无权访问' }, { status: 404 })
        }

        // 刷新 access_token（token_expires_at 存的是 refresh_token 90天寿命，无法判断 access_token 是否有效）
        let accessToken = account.access_token
        if (account.refresh_token) {
            try {
                const tokenResponse = await refreshAccessToken(account.refresh_token)
                accessToken = tokenResponse.access_token
                // 写回数据库
                await supabase
                    .from('tiktok_accounts')
                    .update({
                        access_token: tokenResponse.access_token,
                        refresh_token: tokenResponse.refresh_token,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', accountId)
            } catch (refreshError) {
                console.error('[CreatorInfo] Token refresh failed:', refreshError)
                return NextResponse.json({ error: '账号授权已过期，请重新授权', error_type: 'auth_expired' }, { status: 401 })
            }
        }

        // 调用 TikTok creator_info API
        const creatorInfo = await getCreatorInfo(accessToken)

        return NextResponse.json({
            success: true,
            data: {
                // 创作者信息
                avatar_url: creatorInfo.creator_avatar_url,
                username: creatorInfo.creator_username,
                nickname: creatorInfo.creator_nickname,
                // 可用隐私级别（动态，不同账号可能不同）
                privacy_level_options: creatorInfo.privacy_level_options,
                // 互动设置（创作者账号级别的禁用状态）
                comment_disabled: creatorInfo.comment_disabled,
                duet_disabled: creatorInfo.duet_disabled,
                stitch_disabled: creatorInfo.stitch_disabled,
                // 视频限制
                max_video_post_duration_sec: creatorInfo.max_video_post_duration_sec,
            }
        })

    } catch (error) {
        console.error('[CreatorInfo] Error:', error)
        const message = error instanceof Error ? error.message : '获取创作者信息失败'
        return NextResponse.json({ error: message, error_type: 'api_error' }, { status: 500 })
    }
}
