// Get all TikTok accounts for the current user
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getDemoAccountsResponse, isTikTokGroupsDemoMode } from '@/lib/tiktok/demo-account-groups';
import type { Json } from '@/types/database';

export const dynamic = 'force-dynamic';

interface TikTokAccountRow {
    id: string;
    open_id: string;
    username: string | null;  // Actual TikTok @handle
    display_name: string | null;
    avatar_url: string | null;
    follower_count: number;
    following_count: number;
    likes_count: number;
    video_count: number;
    account_type: string;
    status: string;
    token_expires_at: string | null;
    scopes: Json;
    created_at: string;
    updated_at: string;
    group_id: string | null;
}

export async function GET() {
    try {
        if (isTikTokGroupsDemoMode()) {
            return NextResponse.json(getDemoAccountsResponse());
        }

        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Fetch only normal TikTok content-publishing accounts.
        // Shop / creator-commerce accounts are managed by the Shop binding page.
        const [{ data: accountsData, error }, { data: groupsData, error: groupsError }] = await Promise.all([
            supabase
                .from('tiktok_accounts')
                .select('id, open_id, username, display_name, avatar_url, follower_count, following_count, likes_count, video_count, account_type, status, token_expires_at, scopes, created_at, updated_at, group_id')
                .eq('user_id', user.id)
                .eq('account_type', 'normal')
                .order('created_at', { ascending: false }),
            supabase
                .from('tiktok_account_groups')
                .select('id, name')
                .eq('user_id', user.id),
        ]);

        const accounts = accountsData as TikTokAccountRow[] | null;

        if (error) {
            console.error('Error fetching accounts:', error);
            return NextResponse.json(
                { error: 'Failed to fetch accounts' },
                { status: 500 }
            );
        }

        if (groupsError) {
            console.error('Error fetching account groups:', groupsError);
            return NextResponse.json(
                { error: 'Failed to fetch account groups' },
                { status: 500 }
            );
        }

        if (!accounts) {
            return NextResponse.json({ accounts: [] });
        }

        const groupNameById = new Map((groupsData || []).map((group) => [group.id, group.name]));

        // Remove sensitive data before returning
        const safeAccounts = accounts.map(account => ({
            id: account.id,
            open_id: account.open_id,
            username: account.username,  // Include the TikTok @handle
            display_name: account.display_name,
            avatar_url: account.avatar_url,
            follower_count: account.follower_count,
            following_count: account.following_count,
            likes_count: account.likes_count,
            video_count: account.video_count,
            account_type: account.account_type,
            status: account.status,
            token_expires_at: account.token_expires_at,
            scopes: Array.isArray(account.scopes) ? account.scopes : [],
            created_at: account.created_at,
            updated_at: account.updated_at,
            group_id: account.group_id,
            group_name: account.group_id ? groupNameById.get(account.group_id) || null : null,
        }));

        return NextResponse.json({ accounts: safeAccounts });
    } catch (error) {
        console.error('Error in accounts API:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
