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

export function safeTikTokCount(value: number | undefined): number {
    return validTikTokCount(value) ?? 0;
}

export function validTikTokCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;
}

export function buildTikTokCountPatch(userInfo: TikTokUserInfo) {
    const followerCount = validTikTokCount(userInfo.follower_count);
    const followingCount = validTikTokCount(userInfo.following_count);
    const likesCount = validTikTokCount(userInfo.likes_count);
    const videoCount = validTikTokCount(userInfo.video_count);
    return {
        ...(followerCount !== undefined ? { follower_count: followerCount } : {}),
        ...(followingCount !== undefined ? { following_count: followingCount } : {}),
        ...(likesCount !== undefined ? { likes_count: likesCount } : {}),
        ...(videoCount !== undefined ? { video_count: videoCount } : {}),
    };
}

function splitScopes(scope: string | null | undefined) {
    return (scope || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function isMissingTokenTableError(error: { code?: string; message?: string } | null) {
    const message = error?.message?.toLowerCase() || '';
    return Boolean(
        error
        && (error.code === '42P01' || error.code === 'PGRST205')
        && message.includes('tiktok_account_tokens')
    );
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
        .eq('account_type', 'normal')
        .maybeSingle();

    let tokenWriteFence: string | null = null;
    if (existingAccount) {
        const { data: tokenStorage, error: tokenStorageError } = await supabase
            .from('tiktok_account_tokens')
            .select('compatibility_write_key')
            .eq('account_id', existingAccount.id)
            .maybeSingle();

        if (tokenStorageError && !isMissingTokenTableError(tokenStorageError)) {
            throw new Error(`Failed to prepare secure account binding: ${tokenStorageError.message}`);
        }
        tokenWriteFence = tokenStorage?.compatibility_write_key || null;
    }

    const payload = {
        display_name: userInfo.display_name || null,
        username: userInfo.username || null,
        avatar_url: userInfo.avatar_url || null,
        follower_count: safeTikTokCount(userInfo.follower_count),
        following_count: safeTikTokCount(userInfo.following_count),
        likes_count: safeTikTokCount(userInfo.likes_count),
        video_count: safeTikTokCount(userInfo.video_count),
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        access_token_expires_at: accessTokenExpiresAt.toISOString(),
        token_expires_at: refreshTokenExpiresAt.toISOString(),
        ...(tokenWriteFence ? { token_write_fence: tokenWriteFence } : {}),
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

    if (!inserted?.id) {
        throw new Error('Failed to resolve saved TikTok account');
    }

    return {
        accountId: inserted.id,
        userInfo,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
    };
}

export async function commitTikTokAccountFromAuthState(
    supabase: SupabaseClient<Database>,
    input: {
        state: string;
        flowType: 'web' | 'qr';
        userId: string;
        processingToken: string;
        tokenResponse: TikTokTokenResponse;
    }
): Promise<BoundTikTokAccountResult> {
    const userInfo = await getUserInfo(input.tokenResponse.access_token);
    const accessTokenExpiresAt = calculateTokenExpiration(input.tokenResponse.expires_in);
    const refreshTokenExpiresAt = calculateTokenExpiration(input.tokenResponse.refresh_expires_in);
    const scopes = splitScopes(input.tokenResponse.scope);

    const { data: accountId, error } = await supabase.rpc('commit_tiktok_auth_account', {
        p_state: input.state,
        p_flow_type: input.flowType,
        p_user_id: input.userId,
        p_processing_token: input.processingToken,
        p_open_id: userInfo.open_id,
        p_union_id: userInfo.union_id || '',
        p_display_name: userInfo.display_name || '',
        p_username: userInfo.username || '',
        p_avatar_url: userInfo.avatar_url || '',
        p_follower_count: safeTikTokCount(userInfo.follower_count),
        p_following_count: safeTikTokCount(userInfo.following_count),
        p_likes_count: safeTikTokCount(userInfo.likes_count),
        p_video_count: safeTikTokCount(userInfo.video_count),
        p_access_token: input.tokenResponse.access_token,
        p_refresh_token: input.tokenResponse.refresh_token,
        p_access_token_expires_at: accessTokenExpiresAt.toISOString(),
        p_refresh_token_expires_at: refreshTokenExpiresAt.toISOString(),
        p_scopes: scopes,
    });

    if (error) {
        throw new Error('Failed to atomically save TikTok authorization.');
    }
    if (!accountId) {
        throw new Error('TikTok authorization state lease was lost before account commit.');
    }

    return {
        accountId,
        userInfo,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
    };
}
