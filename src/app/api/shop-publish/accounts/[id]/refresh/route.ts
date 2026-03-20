// Refresh TikTok Shop access token
// ⚠️ Round-8 Finding #4: Check refresh_token expiry before attempting refresh
// ⚠️ Round-8 Finding #1: New token expiry is Unix timestamp, not duration

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
    refreshShopAccessToken,
    calculateShopTokenExpiration,
    isRefreshTokenExpired,
} from '@/lib/tiktok/shop-oauth';

export async function POST(
    _request: NextRequest,
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

        // Fetch the account with sensitive fields (need refresh_token)
        // Note: refresh_token_expires_at column added by our migration,
        // not yet in Supabase auto-generated types
        const { data: account, error: fetchError } = await supabase
            .from('tiktok_accounts')
            .select('id, refresh_token, refresh_token_expires_at, account_type')
            .eq('id', id)
            .eq('user_id', user.id)
            .eq('account_type', 'shop_creator')
            .single() as { data: { id: string; refresh_token: string; refresh_token_expires_at: string | null; account_type: string } | null; error: unknown };

        if (fetchError || !account) {
            return NextResponse.json(
                { error: 'Shop account not found' },
                { status: 404 }
            );
        }

        // ⚠️ Round-8 Finding #4: Check if refresh_token itself has expired
        if (isRefreshTokenExpired(account.refresh_token_expires_at)) {
            // Cannot refresh — user must re-authorize
            await supabase
                .from('tiktok_accounts')
                .update({ status: 'expired', updated_at: new Date().toISOString() })
                .eq('id', id);

            return NextResponse.json(
                { error: 'Refresh token expired. Please re-authorize your TikTok Shop account.' },
                { status: 410 } // 410 Gone — token permanently expired
            );
        }

        // Refresh the access token
        const tokenResponse = await refreshShopAccessToken(account.refresh_token);

        // ⚠️ Round-8 Finding #1: expire_in is Unix timestamp
        const tokenExpiresAt = calculateShopTokenExpiration(
            tokenResponse.access_token_expire_in
        );
        const refreshTokenExpiresAt = calculateShopTokenExpiration(
            tokenResponse.refresh_token_expire_in
        );

        // Update the database with new tokens
        const { error: updateError } = await supabase
            .from('tiktok_accounts')
            .update({
                access_token: tokenResponse.access_token,
                refresh_token: tokenResponse.refresh_token,
                token_expires_at: tokenExpiresAt.toISOString(),
                refresh_token_expires_at: refreshTokenExpiresAt.toISOString(),
                status: 'active',
                updated_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (updateError) {
            throw new Error(`Failed to update tokens: ${updateError.message}`);
        }

        return NextResponse.json({
            success: true,
            token_expires_at: tokenExpiresAt.toISOString(),
        });
    } catch (error) {
        console.error('Error refreshing Shop token:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to refresh token' },
            { status: 500 }
        );
    }
}
