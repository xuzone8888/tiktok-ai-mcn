import { NextRequest, NextResponse } from 'next/server'

import {
    resolveMultiTaskCapabilities,
    type MultiTaskCapabilityAccountInput,
} from '@/lib/publish/multi-task-capabilities'
import {
    MULTI_TASK_DEFAULT_PUBLISH_OPTIONS,
    MULTI_TASK_PRIVACY_LEVELS,
} from '@/lib/publish/multi-task-policy'
import { createClient } from '@/lib/supabase/server'
import {
    getDemoGroupsResponse,
    isTikTokGroupsDemoMode,
} from '@/lib/tiktok/demo-account-groups'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface DemoAccountInput {
    id: string
    display_name: string | null
    username: string | null
    avatar_url: string | null
    status: string
    token_expires_at: string | null
}

function isDemoAccountAuthorized(account: DemoAccountInput) {
    return account.status === 'active'
        && !!account.token_expires_at
        && new Date(account.token_expires_at) > new Date()
}

function buildDemoCapabilities(groupId: string) {
    const { groups } = getDemoGroupsResponse() as {
        groups: Array<{
            id: string
            name: string
            accounts?: DemoAccountInput[]
        }>
    }
    const group = groups.find((item) => item.id === groupId)
    if (!group) {
        return NextResponse.json({ success: false, error: '账号分组不存在' }, { status: 404 })
    }

    const accounts = group.accounts || []
    const readyAccounts = accounts.filter(isDemoAccountAuthorized)
    const blockedCount = accounts.length - readyAccounts.length
    const warnings = blockedCount > 0
        ? [`${blockedCount} 个账号暂不可用，请先处理授权或账号状态。`]
        : []

    return NextResponse.json({
        success: true,
        group: {
            id: group.id,
            name: group.name,
        },
        accounts: [
            ...readyAccounts.map((account) => ({
                id: account.id,
                display_name: account.display_name,
                username: account.username,
                avatar_url: account.avatar_url,
                status: 'ready',
                privacy_level_options: MULTI_TASK_PRIVACY_LEVELS,
                comment_disabled: false,
                duet_disabled: false,
                stitch_disabled: false,
                max_video_post_duration_sec: 600,
            })),
            ...accounts
                .filter((account) => !isDemoAccountAuthorized(account))
                .map((account) => ({
                    id: account.id,
                    display_name: account.display_name,
                    username: account.username,
                    avatar_url: account.avatar_url,
                    status: 'blocked',
                    error: '账号未授权或授权已过期',
                    privacy_level_options: [],
                    comment_disabled: true,
                    duet_disabled: true,
                    stitch_disabled: true,
                    max_video_post_duration_sec: 0,
                })),
        ],
        summary: {
            ready_count: readyAccounts.length,
            blocked_count: blockedCount,
            privacy_level_options: MULTI_TASK_PRIVACY_LEVELS,
            comment_disabled: false,
            duet_disabled: false,
            stitch_disabled: false,
            max_video_post_duration_sec: 600,
            defaults: {
                allow_comment: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.allowComment,
                allow_duet: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.allowDuet,
                allow_stitch: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.allowStitch,
                brand_content_toggle: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.brandContentToggle,
                brand_organic_toggle: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.brandOrganicToggle,
                is_ai_generated: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.isAiGenerated,
                cover_timestamp_ms: MULTI_TASK_DEFAULT_PUBLISH_OPTIONS.coverTimestampMs,
            },
            warnings,
        },
    })
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}))
        const groupId = typeof body.account_group_id === 'string' ? body.account_group_id : ''

        if (!groupId) {
            return NextResponse.json({ success: false, error: '请选择账号分组' }, { status: 400 })
        }

        if (isTikTokGroupsDemoMode()) {
            return buildDemoCapabilities(groupId)
        }

        const supabase = await createClient()
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 })
        }

        const { data: group, error: groupError } = await supabase
            .from('tiktok_account_groups')
            .select('id, name')
            .eq('id', groupId)
            .eq('user_id', user.id)
            .single()

        if (groupError || !group) {
            return NextResponse.json({ success: false, error: '账号分组不存在' }, { status: 404 })
        }

        const { data: accountRows, error: accountsError } = await supabase
            .from('tiktok_accounts')
            .select('id, display_name, username, avatar_url, status, token_expires_at, access_token_expires_at, access_token, refresh_token')
            .eq('user_id', user.id)
            .eq('group_id', groupId)
            .eq('account_type', 'normal')
            .order('created_at', { ascending: true })

        if (accountsError) {
            console.error('[MultiTaskCapabilities] Account fetch failed:', accountsError)
            return NextResponse.json({ success: false, error: '获取账号分组失败' }, { status: 500 })
        }

        const accounts = (accountRows || []) as MultiTaskCapabilityAccountInput[]
        if (accounts.length === 0) {
            return NextResponse.json({ success: false, error: '分组内没有可用账号' }, { status: 400 })
        }

        const capabilities = await resolveMultiTaskCapabilities(accounts, {
            onTokenRefresh: async (accountId, token) => {
                await supabase
                    .from('tiktok_accounts')
                    .update({
                        access_token: token.access_token,
                        refresh_token: token.refresh_token,
                        access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
                        token_expires_at: new Date(Date.now() + token.refresh_expires_in * 1000).toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', accountId)
            },
        })

        return NextResponse.json({
            success: true,
            group,
            ...capabilities,
        })
    } catch (error) {
        console.error('[MultiTaskCapabilities] Error:', error)
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : '获取账号能力失败' },
            { status: 500 }
        )
    }
}
