// Get all TikTok accounts for the current user
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
    token_expires_at: string;
    scopes: string[];
    created_at: string;
    updated_at: string;
}

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

        // Fetch user's TikTok accounts
        const { data, error } = await supabase
            .from('tiktok_accounts')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        const accounts = data as TikTokAccountRow[] | null;

        if (error) {
            console.error('Error fetching accounts:', error);
            return NextResponse.json(
                { error: 'Failed to fetch accounts' },
                { status: 500 }
            );
        }

        if (!accounts) {
            return NextResponse.json({ accounts: [] });
        }

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
            scopes: account.scopes,
            created_at: account.created_at,
            updated_at: account.updated_at,
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
