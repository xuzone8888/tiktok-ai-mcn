// Refresh TikTok access token
import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isUuid, mapAccountGroupError } from '@/lib/tiktok/account-groups';
import { isTikTokGroupsDemoMode, refreshDemoAccount } from '@/lib/tiktok/demo-account-groups';
import { getUserInfo, isTikTokRefreshCredentialInvalid } from '@/lib/tiktok/oauth';
import { refreshTikTokAccountToken } from '@/lib/tiktok/token-manager';

export const dynamic = 'force-dynamic';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        if (!isUuid(id)) {
            return NextResponse.json({ error: 'Account not found' }, { status: 404 });
        }

        if (isTikTokGroupsDemoMode()) {
            try {
                return NextResponse.json(refreshDemoAccount(id));
            } catch (error) {
                const mapped = mapAccountGroupError(error);
                return NextResponse.json({ error: mapped.message }, { status: mapped.status });
            }
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

        // Fetch the account
        const { data: account, error: fetchError } = await supabase
            .from('tiktok_accounts')
            .select('id')
            .eq('id', id)
            .eq('user_id', user.id)
            .eq('account_type', 'normal')
            .single();

        if (fetchError || !account) {
            return NextResponse.json(
                { error: 'Account not found' },
                { status: 404 }
            );
        }

        // Refresh the token
        const refreshResult = await refreshTikTokAccountToken(createAdminClient(), account.id);

        // Get updated user info
        const userInfo = await getUserInfo(refreshResult.token.access_token);

        // Update the account
        const accountPatch = {
            creator_info_cache: null,
            creator_info_cached_at: null,
            display_name: userInfo.display_name,
            avatar_url: userInfo.avatar_url,
            follower_count: userInfo.follower_count || 0,
            following_count: userInfo.following_count || 0,
            likes_count: userInfo.likes_count || 0,
            video_count: userInfo.video_count || 0,
            status: 'active',
            updated_at: new Date().toISOString(),
            ...(refreshResult.providerResponse?.scope
                ? { scopes: refreshResult.providerResponse.scope.split(',') }
                : {}),
        };
        const { error: updateError } = await supabase
            .from('tiktok_accounts')
            .update(accountPatch)
            .eq('id', id)
            .eq('user_id', user.id)
            .eq('account_type', 'normal');

        if (updateError) {
            console.error('Error updating account:', updateError);
            return NextResponse.json(
                { error: 'Failed to update account' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            expiresAt: refreshResult.token.refresh_token_expires_at
        });
    } catch (error) {
        console.error('Error refreshing token:', error);

        // Only an explicit provider rejection of the refresh credential changes
        // account lifecycle. Network, profile, lease, RPC, and database failures
        // leave the account active so a committed token is not hidden.
        if (isTikTokRefreshCredentialInvalid(error)) {
            try {
                const { id } = await params;
                const supabase = await createClient();
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) throw new Error('Unauthorized');
                const { error: expireError } = await supabase
                    .from('tiktok_accounts')
                    .update({ status: 'expired' })
                    .eq('id', id)
                    .eq('user_id', user.id)
                    .eq('account_type', 'normal');
                if (expireError) {
                    console.warn('Failed to mark invalid TikTok refresh credential as expired.');
                }
            } catch {
                // The original refresh error remains the response.
            }
        }

        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to refresh token' },
            { status: 500 }
        );
    }
}
