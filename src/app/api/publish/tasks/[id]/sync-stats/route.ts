import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
    getTikTokAccountTokens,
    getValidTikTokAccessToken,
} from '@/lib/tiktok/token-manager';
import {
    chunkTikTokVideoIds,
    hasTikTokVideoListScope,
    queryTikTokVideoBatch,
    TikTokVideoApiError,
} from '@/lib/tiktok/video-api';

interface RouteParams {
    params: Promise<{ id: string }>;
}

interface PublishedItem {
    id: string;
    status: string;
    tiktok_video_id: string;
    account: {
        id: string;
        open_id: string;
        user_id: string;
        account_type: string;
        status: string;
        scopes: unknown;
    } | null;
}

interface TikTokStatsUpdate extends Record<string, string | number> {
    item_id: string;
    account_id: string;
    tiktok_video_id: string;
    view_count: number;
    like_count: number;
    comment_count: number;
    share_count: number;
}

function accountLabel(account: PublishedItem['account']) {
    return account?.open_id ? account.open_id.slice(0, 8) : '未知账号';
}

// POST - Safely refresh statistics for the task's published TikTok videos.
export async function POST(_request: NextRequest, { params }: RouteParams) {
    if (process.env.ENABLE_VIDEO_STATS_SYNC !== 'true') {
        return NextResponse.json(
            { error: '视频数据同步功能当前已禁用（审核模式）', disabled: true },
            { status: 503 }
        );
    }

    try {
        const { id: taskId } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: '请先登录' }, { status: 401 });
        }

        const { data: task, error: fetchError } = await supabase
            .from('publish_tasks')
            .select(`
                id, user_id,
                items:publish_task_items(
                    id,
                    status,
                    tiktok_video_id,
                    account:tiktok_accounts(
                        id,
                        open_id,
                        user_id,
                        account_type,
                        status,
                        scopes
                    )
                )
            `)
            .eq('id', taskId)
            .eq('user_id', user.id)
            .single();

        if (fetchError || !task) {
            return NextResponse.json({ error: '任务不存在' }, { status: 404 });
        }

        const publishedItems = (((task as unknown as { items?: PublishedItem[] }).items) || [])
            .filter((item) => item.tiktok_video_id && item.status === 'published');
        if (publishedItems.length === 0) {
            return NextResponse.json({
                success: true,
                message: '没有已发布的视频需要同步',
                synced: 0,
            });
        }

        const itemsByAccount = new Map<string, { account: NonNullable<PublishedItem['account']>; items: PublishedItem[] }>();
        const errors: string[] = [];
        for (const item of publishedItems) {
            const account = item.account;
            if (
                !account?.id
                || account.user_id !== user.id
                || account.user_id !== task.user_id
                || account.account_type !== 'normal'
                || account.status !== 'active'
            ) {
                errors.push(`视频 ${item.tiktok_video_id} 的账号归属无效`);
                continue;
            }
            if (!hasTikTokVideoListScope(account.scopes)) {
                errors.push(`账号 ${accountLabel(account)} 缺少 video.list，请重新授权`);
                continue;
            }
            const entry = itemsByAccount.get(account.id) || { account, items: [] };
            entry.items.push(item);
            itemsByAccount.set(account.id, entry);
        }

        const admin = createAdminClient();
        const tokenMap = await getTikTokAccountTokens(admin, [...itemsByAccount.keys()]);
        const successfulUpdates = new Map<string, TikTokStatsUpdate>();

        for (const { account, items } of itemsByAccount.values()) {
            const token = tokenMap.get(account.id);
            if (!token) {
                errors.push(`账号 ${accountLabel(account)} 授权凭证不存在`);
                continue;
            }

            let accessToken: string;
            try {
                accessToken = await getValidTikTokAccessToken(admin, account.id, token);
            } catch {
                errors.push(`账号 ${accountLabel(account)} 的授权刷新失败`);
                continue;
            }

            const itemsByVideoId = new Map<string, PublishedItem[]>();
            for (const item of items) {
                const matchingItems = itemsByVideoId.get(item.tiktok_video_id) || [];
                matchingItems.push(item);
                itemsByVideoId.set(item.tiktok_video_id, matchingItems);
            }
            for (const batchIds of chunkTikTokVideoIds([...itemsByVideoId.keys()])) {
                try {
                    const videos = await queryTikTokVideoBatch(accessToken, batchIds);
                    const returnedIds = new Set(videos.map((video) => video.id));
                    for (const missingId of batchIds.filter((id) => !returnedIds.has(id))) {
                        errors.push(`TikTok 未返回视频 ${missingId}，已保留原统计`);
                    }

                    for (const video of videos) {
                        const matchingItems = itemsByVideoId.get(video.id) || [];
                        for (const item of matchingItems) {
                            successfulUpdates.set(item.id, {
                                item_id: item.id,
                                account_id: account.id,
                                tiktok_video_id: item.tiktok_video_id,
                                view_count: video.view_count,
                                like_count: video.like_count,
                                comment_count: video.comment_count,
                                share_count: video.share_count,
                            });
                        }
                    }
                } catch (error) {
                    const code = error instanceof TikTokVideoApiError ? error.code : 'unknown_error';
                    errors.push(`账号 ${accountLabel(account)} 的一批视频同步失败（${code}），已保留原统计`);
                }
            }
        }

        const { data: aggregateResult, error: aggregateError } = await admin.rpc(
            'apply_tiktok_task_video_stats',
            {
                p_task_id: taskId,
                p_user_id: user.id,
                p_updates: [...successfulUpdates.values()],
            }
        );
        if (aggregateError || !aggregateResult || typeof aggregateResult !== 'object') {
            return NextResponse.json({
                error: '视频统计保存失败，现有统计未被本次同步修改',
                synced: 0,
                errors,
            }, { status: 500 });
        }
        const aggregate = aggregateResult as {
            updated_count?: unknown;
            total_views?: unknown;
            total_likes?: unknown;
        };
        const totalSynced = Number(aggregate.updated_count);
        const totalViews = Number(aggregate.total_views);
        const totalLikes = Number(aggregate.total_likes);
        if (
            !Number.isSafeInteger(totalSynced)
            || !Number.isSafeInteger(totalViews)
            || !Number.isSafeInteger(totalLikes)
        ) {
            return NextResponse.json({
                error: '视频统计已保存，但任务聚合响应无效',
                synced: 0,
                errors,
            }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            synced: totalSynced,
            total_views: totalViews,
            total_likes: totalLikes,
            errors: errors.length > 0 ? errors : undefined,
        });
    } catch {
        console.error('TikTok video stats sync failed unexpectedly');
        return NextResponse.json({ error: '服务器错误' }, { status: 500 });
    }
}
