import { NextRequest, NextResponse } from 'next/server'

import {
    assertMultiTaskCapabilityPolicy,
    resolveMultiTaskCapabilities,
    type MultiTaskCapabilityAccountInput,
} from '@/lib/publish/multi-task-capabilities'
import { findActiveMultiTaskGroupTask } from '@/lib/publish/multi-task-group-lock'
import { parseMultiTaskPrivacyLevel } from '@/lib/publish/multi-task-policy'
import { verifyMultiTaskPreviewToken } from '@/lib/publish/multi-task-preview-token'
import {
    buildMultiTaskPlan,
    MULTI_TASK_DEFAULT_INTERVAL_MINUTES,
    MULTI_TASK_MAX_HASHTAGS,
    type MultiTaskAccountInput,
    type MultiTaskVideoInput,
} from '@/lib/publish/multi-task-scheduler'
import { processPublishQueue } from '@/lib/publish-processor'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

function countHashtags(text: string) {
    return (text.match(/#[^\s#]+/g) || []).length
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
        const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : ''
        const taskName = typeof body.name === 'string' ? body.name.trim() : ''
        const previewToken = typeof body.preview_token === 'string' ? body.preview_token.trim() : ''
        const seed = typeof body.seed === 'string' && body.seed.trim()
            ? body.seed.trim()
            : `${groupId}:${user.id}`

        if (!groupId) {
            return NextResponse.json({ success: false, error: '请选择账号分组' }, { status: 400 })
        }

        if (!taskName) {
            return NextResponse.json({ success: false, error: '请输入任务名称' }, { status: 400 })
        }

        if (taskName.length > 100) {
            return NextResponse.json({ success: false, error: '任务名称不能超过 100 个字符' }, { status: 400 })
        }

        if (!privacyLevel) {
            return NextResponse.json({ success: false, error: '请选择可见范围' }, { status: 400 })
        }

        if (!verifyMultiTaskPreviewToken(user.id, { ...body, seed }, previewToken)) {
            return NextResponse.json({ success: false, error: '请先生成预览，再创建任务' }, { status: 409 })
        }

        if (idempotencyKey) {
            const { data: existingTask, error: existingError } = await supabase
                .from('publish_tasks')
                .select('id, task_name, status, total_items, created_at')
                .eq('user_id', user.id)
                .eq('idempotency_key', idempotencyKey)
                .maybeSingle()

            if (existingError) {
                console.error('[MultiTaskCreate] Idempotency check failed:', existingError)
                return NextResponse.json({ success: false, error: '检查任务状态失败' }, { status: 500 })
            }

            if (existingTask) {
                return NextResponse.json({ success: true, task: existingTask, reused: true })
            }
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

        const activeTask = await findActiveMultiTaskGroupTask(supabase, user.id, groupId)
        if (activeTask) {
            return NextResponse.json({
                success: false,
                error: '该账号组已有未完成任务，请等待完成或先停止待发后再创建。',
                active_task: {
                    id: activeTask.id,
                    task_name: activeTask.task_name,
                    status: activeTask.status,
                    total_items: activeTask.total_items,
                    published_count: activeTask.published_count,
                    pending_count: activeTask.pending_count,
                    failed_count: activeTask.failed_count,
                    created_at: activeTask.created_at,
                },
            }, { status: 409 })
        }

        const { data: accountRows, error: accountsError } = await supabase
            .from('tiktok_accounts')
            .select('id, display_name, username, avatar_url, status, token_expires_at, access_token, refresh_token')
            .eq('user_id', user.id)
            .eq('group_id', groupId)
            .eq('account_type', 'normal')
            .order('created_at', { ascending: true })

        if (accountsError) {
            console.error('[MultiTaskCreate] Account fetch failed:', accountsError)
            return NextResponse.json({ success: false, error: '获取账号分组失败' }, { status: 500 })
        }

        const allAccounts = (accountRows || []) as GroupAccountRow[]
        const videos = normalizeVideoInputs(body.videos)
        for (const video of videos) {
            if (countHashtags(video.title || '') > MULTI_TASK_MAX_HASHTAGS) {
                return NextResponse.json({ success: false, error: `"${video.name}" 的话题数量不能超过 ${MULTI_TASK_MAX_HASHTAGS} 个` }, { status: 400 })
            }
        }

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

        const nowIso = new Date().toISOString()
        const planConfig = {
            version: 1,
            source: 'multi_task',
            group: {
                id: group.id,
                name: group.name,
            },
            seed,
            assignment_strategy: plan.summary.assignmentStrategy,
            timing: {
                mode: body.timing?.mode === 'scheduled' ? 'scheduled' : 'now',
                start_at: body.timing?.start_at || null,
                interval_minutes: plan.summary.intervalMinutes,
                account_spacing_minutes: plan.summary.accountSpacingMinutes,
                jitter_enabled: plan.summary.jitterEnabled,
                jitter_min_seconds: Number(body.timing?.jitter_min_seconds || 60),
                jitter_max_seconds: Number(body.timing?.jitter_max_seconds || 300),
            },
            defaults: {
                allow_comment: defaults.allow_comment,
                allow_duet: defaults.allow_duet,
                allow_stitch: defaults.allow_stitch,
                brand_content_toggle: defaults.brand_content_toggle,
                brand_organic_toggle: defaults.brand_organic_toggle,
                is_ai_generated: defaults.is_ai_generated,
                cover_timestamp_ms: defaults.cover_timestamp_ms,
            },
            summary: plan.summary,
            capabilities: {
                summary: capabilities.summary,
                accounts: capabilities.accounts.map((account) => ({
                    id: account.id,
                    status: account.status,
                    error: account.error || null,
                    privacy_level_options: account.privacy_level_options,
                    comment_disabled: account.comment_disabled,
                    duet_disabled: account.duet_disabled,
                    stitch_disabled: account.stitch_disabled,
                    max_video_post_duration_sec: account.max_video_post_duration_sec,
                })),
            },
            videos: videos.map((video) => ({ id: video.id, name: video.name, source: video.source || 'upload', duration_ms: video.durationMs || null })),
            accounts: allAccounts.map((account) => ({ id: account.id, display_name: account.display_name, username: account.username })),
            created_at: nowIso,
        } as unknown as Json

        const { data: task, error: taskError } = await supabase
            .from('publish_tasks')
            .insert({
                user_id: user.id,
                task_name: taskName,
                workflow: 'multi_task',
                source_account_group_id: groupId,
                plan_config: planConfig,
                idempotency_key: idempotencyKey || null,
                status: 'scheduled',
                scheduled_at: plan.summary.firstScheduledAt,
                title_template: null,
                privacy_level: privacyLevel,
                allow_comment: defaults.allow_comment,
                allow_duet: defaults.allow_duet,
                allow_stitch: defaults.allow_stitch,
                brand_content_toggle: defaults.brand_content_toggle,
                brand_organic_toggle: defaults.brand_organic_toggle,
                is_aigc: defaults.is_ai_generated,
                batch_interval_seconds: plan.summary.intervalMinutes * 60,
                total_items: plan.items.length,
                success_count: 0,
                failed_count: 0,
                published_count: 0,
                pending_count: plan.items.length,
            })
            .select()
            .single()

        if (taskError || !task) {
            console.error('[MultiTaskCreate] Task insert failed:', taskError)
            return NextResponse.json({ success: false, error: taskError?.message || '创建任务失败' }, { status: 500 })
        }

        const taskItems = plan.items.map((item) => ({
            task_id: task.id,
            account_id: item.accountId,
            video_url: item.videoUrl,
            video_source: item.videoSource === 'asset' ? 'assets' : item.videoSource,
            title: item.title,
            status: 'scheduled',
            scheduled_at: item.scheduledAt,
            cover_timestamp_ms: defaults.cover_timestamp_ms,
            plan_sequence: item.sequence,
            plan_round: item.planRound,
            plan_account_position: item.accountPosition,
            source_video_id: item.videoId,
            source_video_name: item.videoName,
            dedupe_key: item.dedupeKey,
        }))

        const { error: itemsError } = await supabase
            .from('publish_task_items')
            .insert(taskItems)

        if (itemsError) {
            console.error('[MultiTaskCreate] Item insert failed:', itemsError)
            await supabase.from('publish_tasks').delete().eq('id', task.id)
            return NextResponse.json({ success: false, error: itemsError.message || '创建任务项失败' }, { status: 500 })
        }

        if (body.timing?.mode !== 'scheduled') {
            processPublishQueue({ mode: 'scheduled', maxItems: Math.min(plan.items.length, 50) })
                .catch((error) => console.error('[MultiTaskCreate] Due processor failed:', error))
        }

        return NextResponse.json({
            success: true,
            task: {
                ...task,
                total_items: plan.items.length,
            },
            plan,
        }, { status: 201 })
    } catch (error) {
        console.error('[MultiTaskCreate] Error:', error)
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : '创建任务失败' },
            { status: 400 }
        )
    }
}
