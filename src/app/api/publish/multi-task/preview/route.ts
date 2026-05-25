import { NextRequest, NextResponse } from 'next/server'

import {
    assertMultiTaskCapabilityPolicy,
    resolveMultiTaskCapabilities,
    type MultiTaskCapabilityAccountInput,
} from '@/lib/publish/multi-task-capabilities'
import { parseMultiTaskPrivacyLevel } from '@/lib/publish/multi-task-policy'
import { signMultiTaskPreviewToken } from '@/lib/publish/multi-task-preview-token'
import {
    buildMultiTaskPlan,
    MULTI_TASK_DEFAULT_INTERVAL_MINUTES,
    type MultiTaskAccountInput,
    type MultiTaskVideoInput,
} from '@/lib/publish/multi-task-scheduler'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface GroupAccountRow {
    id: string
    display_name: string | null
    username: string | null
    avatar_url: string | null
    status: string
    token_expires_at: string | null
    access_token: string
    refresh_token: string
}

function normalizeVideoInputs(value: unknown): MultiTaskVideoInput[] {
    if (!Array.isArray(value)) return []

    return value.map((item) => {
        const video = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
        const source = video.source === 'asset' || video.source === 'url' ? video.source : 'upload'
        const durationMs = Number(video.duration_ms ?? video.durationMs ?? 0)

        return {
            id: typeof video.id === 'string' ? video.id : '',
            name: typeof video.name === 'string' ? video.name : '',
            url: typeof video.url === 'string' ? video.url : '',
            source,
            title: typeof video.title === 'string' ? video.title : '',
            durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
        }
    })
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 })
        }

        const body = await request.json().catch(() => ({}))
        const groupId = typeof body.account_group_id === 'string' ? body.account_group_id : ''
        const privacyLevel = parseMultiTaskPrivacyLevel(body.privacy_level)
        const videos = normalizeVideoInputs(body.videos)
        const seed = typeof body.seed === 'string' && body.seed.trim()
            ? body.seed.trim()
            : `${groupId}:${user.id}`

        if (!groupId) {
            return NextResponse.json({ success: false, error: '请选择账号分组' }, { status: 400 })
        }

        if (!privacyLevel) {
            return NextResponse.json({ success: false, error: '请选择可见范围' }, { status: 400 })
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
            .select('id, display_name, username, avatar_url, status, token_expires_at, access_token, refresh_token')
            .eq('user_id', user.id)
            .eq('group_id', groupId)
            .eq('account_type', 'normal')
            .order('created_at', { ascending: true })

        if (accountsError) {
            console.error('[MultiTaskPreview] Account fetch failed:', accountsError)
            return NextResponse.json({ success: false, error: '获取账号分组失败' }, { status: 500 })
        }

        const allAccounts = (accountRows || []) as GroupAccountRow[]
        const plan = buildMultiTaskPlan({
            videos,
            accounts: allAccounts.map<MultiTaskAccountInput>((account) => ({
                id: account.id,
                displayName: account.display_name,
                username: account.username,
            })),
            assignmentStrategy: body.assignment_strategy === 'random_balanced' ? 'random_balanced' : 'round_robin',
            timing: {
                mode: body.timing?.mode === 'scheduled' ? 'scheduled' : 'now',
                startAt: body.timing?.start_at || null,
                intervalMinutes: Number(body.timing?.interval_minutes || MULTI_TASK_DEFAULT_INTERVAL_MINUTES),
                jitterEnabled: body.timing?.jitter_enabled === true,
                jitterMinSeconds: Number(body.timing?.jitter_min_seconds || 60),
                jitterMaxSeconds: Number(body.timing?.jitter_max_seconds || 300),
            },
            seed,
        })

        const capabilities = await resolveMultiTaskCapabilities(allAccounts as MultiTaskCapabilityAccountInput[], {
            onTokenRefresh: async (accountId, token) => {
                await supabase
                    .from('tiktok_accounts')
                    .update({
                        access_token: token.access_token,
                        refresh_token: token.refresh_token,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', accountId)
            },
        })
        const defaults = assertMultiTaskCapabilityPolicy(capabilities, privacyLevel, videos)

        const previewToken = signMultiTaskPreviewToken(user.id, { ...body, seed })

        return NextResponse.json({
            success: true,
            group,
            accounts: allAccounts.map((account) => ({
                id: account.id,
                display_name: account.display_name,
                username: account.username,
                avatar_url: account.avatar_url,
            })),
            capabilities,
            defaults,
            seed,
            previewToken,
            plan: {
                ...plan,
                previewToken,
            },
        })
    } catch (error) {
        console.error('[MultiTaskPreview] Error:', error)
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : '生成预览失败' },
            { status: 400 }
        )
    }
}
