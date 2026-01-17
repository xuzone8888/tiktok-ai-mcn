// TikTok OAuth Callback Handler
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
    exchangeCodeForToken,
    getUserInfo,
    calculateTokenExpiration
} from '@/lib/tiktok/oauth';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Base URL for redirects
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.tokfactoryai.com';

    // Handle OAuth errors
    if (error) {
        console.error('TikTok OAuth error:', error, errorDescription);
        return NextResponse.redirect(
            `${baseUrl}/publish/accounts?error=${encodeURIComponent(errorDescription || error)}`
        );
    }

    // Validate required parameters
    if (!code || !state) {
        return NextResponse.redirect(
            `${baseUrl}/publish/accounts?error=${encodeURIComponent('Missing authorization code or state')}`
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
                `${baseUrl}/publish/accounts?error=${encodeURIComponent('Invalid or expired authorization state')}`
            );
        }

        // Check if state is expired
        if (new Date(authState.expires_at) < new Date()) {
            // Delete expired state
            await supabase.from('tiktok_auth_states').delete().eq('state', state);
            return NextResponse.redirect(
                `${baseUrl}/publish/accounts?error=${encodeURIComponent('Authorization session expired. Please try again.')}`
            );
        }

        // Exchange code for tokens
        const tokenResponse = await exchangeCodeForToken(code, authState.code_verifier);

        // Get user info from TikTok
        const userInfo = await getUserInfo(tokenResponse.access_token);

        // Calculate token expiration
        const tokenExpiresAt = calculateTokenExpiration(tokenResponse.expires_in);

        // Check if this TikTok account is already linked
        const { data: existingAccount } = await supabase
            .from('tiktok_accounts')
            .select('id')
            .eq('user_id', authState.user_id)
            .eq('open_id', userInfo.open_id)
            .single();

        if (existingAccount) {
            // Update existing account
            const { error: updateError } = await supabase
                .from('tiktok_accounts')
                .update({
                    display_name: userInfo.display_name,
                    username: userInfo.username,  // Store actual @handle
                    avatar_url: userInfo.avatar_url,
                    follower_count: userInfo.follower_count || 0,
                    following_count: userInfo.following_count || 0,
                    likes_count: userInfo.likes_count || 0,
                    video_count: userInfo.video_count || 0,
                    access_token: tokenResponse.access_token,
                    refresh_token: tokenResponse.refresh_token,
                    token_expires_at: tokenExpiresAt.toISOString(),
                    scopes: tokenResponse.scope.split(','),
                    status: 'active',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', existingAccount.id);

            if (updateError) {
                throw new Error(`Failed to update account: ${updateError.message}`);
            }
        } else {
            // Create new account
            const { error: insertError } = await supabase
                .from('tiktok_accounts')
                .insert({
                    user_id: authState.user_id,
                    open_id: userInfo.open_id,
                    union_id: userInfo.union_id,
                    display_name: userInfo.display_name,
                    username: userInfo.username,  // Store actual @handle
                    avatar_url: userInfo.avatar_url,
                    follower_count: userInfo.follower_count || 0,
                    following_count: userInfo.following_count || 0,
                    likes_count: userInfo.likes_count || 0,
                    video_count: userInfo.video_count || 0,
                    access_token: tokenResponse.access_token,
                    refresh_token: tokenResponse.refresh_token,
                    token_expires_at: tokenExpiresAt.toISOString(),
                    scopes: tokenResponse.scope.split(','),
                    account_type: 'normal',
                    status: 'active',
                });

            if (insertError) {
                throw new Error(`Failed to save account: ${insertError.message}`);
            }
        }

        // Clean up the auth state
        await supabase.from('tiktok_auth_states').delete().eq('state', state);

        // Redirect to accounts page with success message
        return NextResponse.redirect(
            `${baseUrl}/publish/accounts?success=true&name=${encodeURIComponent(userInfo.display_name || 'TikTok Account')}`
        );
    } catch (err) {
        console.error('TikTok callback error:', err);
        return NextResponse.redirect(
            `${baseUrl}/publish/accounts?error=${encodeURIComponent(err instanceof Error ? err.message : 'Authorization failed')}`
        );
    }
}
