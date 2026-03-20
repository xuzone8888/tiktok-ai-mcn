// TikTok Shop OAuth Callback Handler
// Pattern: follows existing src/app/api/tiktok/auth/callback/route.ts
// Key differences:
//   - code → auth_code parameter mapping (handled by exchangeShopCodeForToken)
//   - No code_verifier (no PKCE)
//   - User info from getCreatorProfile() not getUserInfo()
//   - token_expires_at from Unix timestamp (not duration)
//   - scopes hardcoded (not from token response)
//   - refresh_token_expires_at saved
//   - account_type = 'shop_creator'
//   - Redirect to /shop-publish/accounts

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
    exchangeShopCodeForToken,
    calculateShopTokenExpiration,
} from '@/lib/tiktok/shop-oauth';
import { getCreatorProfile } from '@/lib/tiktok/shop-api';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Base URL for redirects
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!baseUrl) {
        console.error('CRITICAL: NEXT_PUBLIC_APP_URL environment variable is not set');
        throw new Error('NEXT_PUBLIC_APP_URL environment variable is required');
    }

    // Handle OAuth errors from TikTok
    if (error) {
        console.error('TikTok Shop OAuth error:', error, errorDescription);
        return NextResponse.redirect(
            `${baseUrl}/shop-publish/accounts?error=${encodeURIComponent(errorDescription || error)}`
        );
    }

    // Validate required parameters
    if (!code || !state) {
        return NextResponse.redirect(
            `${baseUrl}/shop-publish/accounts?error=${encodeURIComponent('Missing authorization code or state')}`
        );
    }

    try {
        const supabase = await createClient();

        // Retrieve and validate the auth state
        const { data: authState, error: stateError } = await supabase
            .from('tiktok_auth_states')
            .select('*')
            .eq('state', state)
            .single();

        if (stateError || !authState) {
            return NextResponse.redirect(
                `${baseUrl}/shop-publish/accounts?error=${encodeURIComponent('Invalid or expired authorization state')}`
            );
        }

        // Check if state is expired
        if (new Date(authState.expires_at) < new Date()) {
            await supabase.from('tiktok_auth_states').delete().eq('state', state);
            return NextResponse.redirect(
                `${baseUrl}/shop-publish/accounts?error=${encodeURIComponent('Authorization session expired. Please try again.')}`
            );
        }

        // ⚠️ Exchange code for tokens
        // The callback parameter is `code`, but exchangeShopCodeForToken
        // internally maps it to `auth_code` for the API call
        const tokenResponse = await exchangeShopCodeForToken(code);

        // Get creator profile from Shop API (username + avatar)
        // ⚠️ Different from Content API which uses getUserInfo()
        let creatorUsername = '';
        let creatorAvatarUrl = '';
        try {
            const profile = await getCreatorProfile(tokenResponse.access_token);
            creatorUsername = profile.username || '';
            creatorAvatarUrl = profile.avatar?.url || '';
        } catch (profileError) {
            // Profile fetch is non-critical — continue with empty values
            console.warn('Failed to fetch Shop creator profile:', profileError);
        }

        // Fallback: use seller_name from token response if profile was empty/failed
        if (!creatorUsername && tokenResponse.seller_name) {
            creatorUsername = tokenResponse.seller_name;
        }

        // ⚠️ Round-8 Finding #1: expire_in is Unix timestamp, NOT duration
        // Use calculateShopTokenExpiration (not Content API's calculateTokenExpiration)
        const tokenExpiresAt = calculateShopTokenExpiration(
            tokenResponse.access_token_expire_in
        );

        // ⚠️ Round-8 Finding #4: Save refresh_token expiry too
        const refreshTokenExpiresAt = calculateShopTokenExpiration(
            tokenResponse.refresh_token_expire_in
        );

        // Check if this Shop account is already linked (by open_id + user_id)
        const { data: existingAccount } = await supabase
            .from('tiktok_accounts')
            .select('id')
            .eq('user_id', authState.user_id)
            .eq('open_id', tokenResponse.open_id)
            .eq('account_type', 'shop_creator')
            .single();

        if (existingAccount) {
            // Update existing Shop account
            const { error: updateError } = await supabase
                .from('tiktok_accounts')
                .update({
                    display_name: creatorUsername,
                    username: creatorUsername,
                    avatar_url: creatorAvatarUrl,
                    access_token: tokenResponse.access_token,
                    refresh_token: tokenResponse.refresh_token,
                    token_expires_at: tokenExpiresAt.toISOString(),
                    refresh_token_expires_at: refreshTokenExpiresAt.toISOString(),
                    // ⚠️ Round-8 Finding #5: hardcoded scopes (not from token response)
                    scopes: ['creator.video.write', 'creator.affiliate.info'],
                    status: 'active',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', existingAccount.id);

            if (updateError) {
                throw new Error(`Failed to update Shop account: ${updateError.message}`);
            }
        } else {
            // Create new Shop account
            const { error: insertError } = await supabase
                .from('tiktok_accounts')
                .insert({
                    user_id: authState.user_id,
                    open_id: tokenResponse.open_id,
                    display_name: creatorUsername,
                    username: creatorUsername,
                    avatar_url: creatorAvatarUrl,
                    follower_count: 0,
                    following_count: 0,
                    likes_count: 0,
                    video_count: 0,
                    access_token: tokenResponse.access_token,
                    refresh_token: tokenResponse.refresh_token,
                    token_expires_at: tokenExpiresAt.toISOString(),
                    refresh_token_expires_at: refreshTokenExpiresAt.toISOString(),
                    // ⚠️ Round-8 Finding #5: hardcoded scopes
                    scopes: ['creator.video.write', 'creator.affiliate.info'],
                    account_type: 'shop_creator', // ⚠️ Different from Content API's 'normal'
                    status: 'active',
                });

            if (insertError) {
                throw new Error(`Failed to save Shop account: ${insertError.message}`);
            }
        }

        // Clean up the auth state
        await supabase.from('tiktok_auth_states').delete().eq('state', state);

        // Redirect to Shop accounts page with success message
        return NextResponse.redirect(
            `${baseUrl}/shop-publish/accounts?success=true&name=${encodeURIComponent(creatorUsername || 'TikTok Shop Account')}`
        );
    } catch (err) {
        console.error('TikTok Shop callback error:', err);
        return NextResponse.redirect(
            `${baseUrl}/shop-publish/accounts?error=${encodeURIComponent(err instanceof Error ? err.message : 'Shop authorization failed')}`
        );
    }
}
