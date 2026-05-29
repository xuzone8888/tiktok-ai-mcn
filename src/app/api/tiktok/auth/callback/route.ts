// TikTok OAuth Callback Handler
import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { saveTikTokAccountFromToken } from '@/lib/tiktok/account-binding';
import { exchangeCodeForToken } from '@/lib/tiktok/oauth';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Base URL for redirects
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

    // Validate required parameters
    if ((!code && !error) || !state) {
        return NextResponse.redirect(
            `${baseUrl}/publish/accounts?error=${encodeURIComponent('Missing authorization code or state')}`
        );
    }

    try {
        const supabase = createAdminClient();

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

        // Handle OAuth errors after state is known so diagnostics are retained.
        if (error) {
            await supabase
                .from('tiktok_auth_states')
                .update({
                    status: 'failed',
                    error_code: error,
                    error_message: errorDescription || error,
                    code_verifier: null,
                    completed_at: new Date().toISOString(),
                })
                .eq('state', state);

            return NextResponse.redirect(
                `${baseUrl}/publish/accounts?error=${encodeURIComponent(errorDescription || error)}`
            );
        }

        // Check if state is expired
        if (new Date(authState.expires_at) < new Date()) {
            await supabase
                .from('tiktok_auth_states')
                .update({
                    status: 'expired',
                    error_code: 'expired',
                    error_message: 'Authorization session expired.',
                    code_verifier: null,
                })
                .eq('state', state);

            return NextResponse.redirect(
                `${baseUrl}/publish/accounts?error=${encodeURIComponent('Authorization session expired. Please try again.')}`
            );
        }

        if (!code) {
            throw new Error('Missing authorization code.');
        }

        // Exchange code for tokens
        const tokenResponse = await exchangeCodeForToken(code, authState.code_verifier);

        const { userInfo } = await saveTikTokAccountFromToken(supabase, authState.user_id, tokenResponse);

        await supabase
            .from('tiktok_auth_states')
            .update({
                status: 'completed',
                code_verifier: null,
                completed_at: new Date().toISOString(),
            })
            .eq('state', state);

        // Redirect to accounts page with success message
        return NextResponse.redirect(
            `${baseUrl}/publish/accounts?success=true&name=${encodeURIComponent(userInfo.display_name || 'TikTok Account')}`
        );
    } catch (err) {
        console.error('TikTok callback error:', err);
        if (state) {
            try {
                await createAdminClient()
                    .from('tiktok_auth_states')
                    .update({
                        status: 'failed',
                        error_code: 'callback_failed',
                        error_message: err instanceof Error ? err.message : 'Authorization failed',
                        code_verifier: null,
                        completed_at: new Date().toISOString(),
                    })
                    .eq('state', state);
            } catch (updateError) {
                console.warn('Failed to persist TikTok callback error:', updateError);
            }
        }

        return NextResponse.redirect(
            `${baseUrl}/publish/accounts?error=${encodeURIComponent(err instanceof Error ? err.message : 'Authorization failed')}`
        );
    }
}
