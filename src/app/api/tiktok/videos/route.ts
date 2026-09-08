import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getValidTikTokAccessToken } from '@/lib/tiktok/token-manager';
import {
    hasTikTokVideoListScope,
    listTikTokVideos,
    TikTokVideoApiError,
} from '@/lib/tiktok/video-api';
import { isTikTokVideoListScopeEnabled } from '@/lib/tiktok/video-list-rollout';

export const dynamic = 'force-dynamic';

function parseCursor(value: string | null) {
    if (value === null) return null;
    const cursor = Number(value);
    return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : undefined;
}

export async function GET(request: NextRequest) {
    if (!isTikTokVideoListScopeEnabled()) {
        return NextResponse.json({
            error: 'TikTok 视频列表当前环境尚未启用',
            code: 'tiktok_video_list_disabled',
        }, { status: 404 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const accountId = request.nextUrl.searchParams.get('account_id');
    const cursor = parseCursor(request.nextUrl.searchParams.get('cursor'));
    if (!accountId) {
        return NextResponse.json({ error: '请选择 TikTok 账号' }, { status: 400 });
    }
    if (cursor === undefined) {
        return NextResponse.json({ error: '无效的视频分页游标' }, { status: 400 });
    }

    const { data: account, error: accountError } = await supabase
        .from('tiktok_accounts')
        .select('id, user_id, account_type, status, scopes')
        .eq('id', accountId)
        .eq('user_id', user.id)
        .eq('account_type', 'normal')
        .maybeSingle();

    if (accountError) {
        return NextResponse.json({ error: '读取 TikTok 账号失败' }, { status: 500 });
    }
    if (!account || account.status !== 'active') {
        return NextResponse.json({ error: 'TikTok 账号不可用' }, { status: 404 });
    }
    if (!hasTikTokVideoListScope(account.scopes)) {
        return NextResponse.json({
            error: '该账号尚未授权 video.list，请重新授权后查看视频数据',
            code: 'tiktok_video_reauthorization_required',
            requires_reauthorization: true,
        }, { status: 403 });
    }

    try {
        const admin = createAdminClient();
        const accessToken = await getValidTikTokAccessToken(admin, account.id);
        const page = await listTikTokVideos(accessToken, { cursor, maxCount: 20 });
        return NextResponse.json({
            videos: page.videos,
            next_cursor: page.cursor,
            has_more: page.hasMore,
        });
    } catch (error) {
        if (error instanceof TikTokVideoApiError) {
            return NextResponse.json({
                error: error.message,
                code: error.code,
            }, { status: error.httpStatus >= 400 && error.httpStatus < 600 ? error.httpStatus : 502 });
        }
        console.error('TikTok video list failed:', error);
        return NextResponse.json({ error: 'TikTok 视频列表暂时不可用' }, { status: 500 });
    }
}
