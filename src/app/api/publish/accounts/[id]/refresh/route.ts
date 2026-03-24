// Refresh TikTok access token
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { refreshAccessToken, getUserInfo, calculateTokenExpiration } from '@/lib/tiktok/oauth';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Fetch the account
        const { data: account, error: fetchError } = await supabase
            .from('tiktok_accounts')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (fetchError || !account) {
            return NextResponse.json(
                { error: 'Account not found' },
                { status: 404 }
            );
        }

        // Refresh the token
        const tokenResponse = await refreshAccessToken(account.refresh_token);

        // Get updated user info
        const userInfo = await getUserInfo(tokenResponse.access_token);

        // Use refresh_expires_in (≈90 days) — the real auth lifespan users see
        const tokenExpiresAt = calculateTokenExpiration(tokenResponse.refresh_expires_in);

        // Update the account
        const { error: updateError } = await supabase
            .from('tiktok_accounts')
            .update({
                access_token: tokenResponse.access_token,
                refresh_token: tokenResponse.refresh_token,
                token_expires_at: tokenExpiresAt.toISOString(),
                scopes: tokenResponse.scope.split(','),
                display_name: userInfo.display_name,
                avatar_url: userInfo.avatar_url,
                follower_count: userInfo.follower_count || 0,
                following_count: userInfo.following_count || 0,
                likes_count: userInfo.likes_count || 0,
                video_count: userInfo.video_count || 0,
                status: 'active',
                updated_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (updateError) {
            console.error('Error updating account:', updateError);
            return NextResponse.json(
                { error: 'Failed to update account' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            expiresAt: tokenExpiresAt.toISOString()
        });
    } catch (error) {
        console.error('Error refreshing token:', error);

        // If refresh fails, mark account as expired
        try {
            const { id } = await params;
            const supabase = await createClient();
            await supabase
                .from('tiktok_accounts')
                .update({ status: 'expired' })
                .eq('id', id);
        } catch {
            // Ignore update error
        }

        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to refresh token' },
            { status: 500 }
        );
    }
}
