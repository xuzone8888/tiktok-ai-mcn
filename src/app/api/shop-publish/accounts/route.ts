// Get all TikTok Shop accounts for the current user
// Pattern: follows existing src/app/api/publish/accounts/route.ts
// Key difference: filters by account_type = 'shop_creator'

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
    try {
        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Fetch user's Shop accounts only (account_type = 'shop_creator')
        const { data: accounts, error } = await supabase
            .from('tiktok_accounts')
            .select('id, open_id, username, display_name, avatar_url, follower_count, following_count, likes_count, video_count, account_type, status, token_expires_at, refresh_token_expires_at, scopes, created_at, updated_at')
            .eq('user_id', user.id)
            .eq('account_type', 'shop_creator') // ⚠️ Only Shop accounts
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching Shop accounts:', error);
            return NextResponse.json(
                { error: 'Failed to fetch Shop accounts' },
                { status: 500 }
            );
        }

        return NextResponse.json({ accounts: accounts || [] });
    } catch (error) {
        console.error('Error in Shop accounts API:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
