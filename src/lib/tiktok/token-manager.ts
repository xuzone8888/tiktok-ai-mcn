import type { SupabaseClient } from '@supabase/supabase-js';

import { calculateTokenExpiration, refreshAccessToken } from '@/lib/tiktok/oauth';
import type { TikTokRefreshTokenResponse } from '@/lib/tiktok/types';
import type { Database } from '@/types/database';

export interface TikTokTokenRecord {
    id: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at?: string | null;
}

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function isTikTokAccessTokenFresh(expiresAt?: string | null) {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() > Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS;
}

export async function refreshTikTokAccountToken(
    supabase: SupabaseClient<Database>,
    account: TikTokTokenRecord
): Promise<TikTokRefreshTokenResponse> {
    const tokenResponse = await refreshAccessToken(account.refresh_token);
    const accessTokenExpiresAt = calculateTokenExpiration(tokenResponse.expires_in);
    const refreshTokenExpiresAt = calculateTokenExpiration(tokenResponse.refresh_expires_in);

    const { error } = await supabase
        .from('tiktok_accounts')
        .update({
            access_token: tokenResponse.access_token,
            refresh_token: tokenResponse.refresh_token,
            access_token_expires_at: accessTokenExpiresAt.toISOString(),
            token_expires_at: refreshTokenExpiresAt.toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', account.id);

    if (error) {
        throw new Error(`Failed to persist refreshed TikTok token: ${error.message}`);
    }

    return tokenResponse;
}

export async function getValidTikTokAccessToken(
    supabase: SupabaseClient<Database>,
    account: TikTokTokenRecord
) {
    if (isTikTokAccessTokenFresh(account.access_token_expires_at)) {
        return account.access_token;
    }

    const tokenResponse = await refreshTikTokAccountToken(supabase, account);
    account.access_token = tokenResponse.access_token;
    account.refresh_token = tokenResponse.refresh_token;
    account.access_token_expires_at = calculateTokenExpiration(tokenResponse.expires_in).toISOString();

    return tokenResponse.access_token;
}
