import type { SupabaseClient } from '@supabase/supabase-js';

import { calculateTokenExpiration, getUserInfo } from '@/lib/tiktok/oauth';
import type { TikTokTokenResponse, TikTokUserInfo } from '@/lib/tiktok/types';
import type { Database } from '@/types/database';

export interface BoundTikTokAccountResult {
    accountId: string | null;
    userInfo: TikTokUserInfo;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
}

function splitScopes(scope: string | null | undefined) {
    return (scope || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

export async function saveTikTokAccountFromToken(
    supabase: SupabaseClient<Database>,
    userId: string,
    tokenResponse: TikTokTokenResponse
): Promise<BoundTikTokAccountResult> {
    const userInfo = await getUserInfo(tokenResponse.access_token);
    const accessTokenExpiresAt = calculateTokenExpiration(tokenResponse.expires_in);
    const refreshTokenExpiresAt = calculateTokenExpiration(tokenResponse.refresh_expires_in);
    const scopes = splitScopes(tokenResponse.scope);

    const { data: existingAccount } = await supabase
        .from('tiktok_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('open_id', userInfo.open_id)
        .maybeSingle();

    const payload = {
        display_name: userInfo.display_name || null,
        username: userInfo.username || null,
        avatar_url: userInfo.avatar_url || null,
        follower_count: userInfo.follower_count || 0,
        following_count: userInfo.following_count || 0,
        likes_count: userInfo.likes_count || 0,
        video_count: userInfo.video_count || 0,
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        access_token_expires_at: accessTokenExpiresAt.toISOString(),
        token_expires_at: refreshTokenExpiresAt.toISOString(),
        scopes,
        status: 'active',
        updated_at: new Date().toISOString(),
    };

    if (existingAccount) {
        const { error } = await supabase
            .from('tiktok_accounts')
            .update(payload)
            .eq('id', existingAccount.id);

        if (error) {
            throw new Error(`Failed to update account: ${error.message}`);
        }

        return {
            accountId: existingAccount.id,
            userInfo,
            accessTokenExpiresAt,
            refreshTokenExpiresAt,
        };
    }

    const { data: inserted, error } = await supabase
        .from('tiktok_accounts')
        .insert({
            ...payload,
            user_id: userId,
            open_id: userInfo.open_id,
            union_id: userInfo.union_id || null,
            account_type: 'normal',
        })
        .select('id')
        .single();

    if (error) {
        throw new Error(`Failed to save account: ${error.message}`);
    }

    return {
        accountId: inserted?.id || null,
        userInfo,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
    };
}
