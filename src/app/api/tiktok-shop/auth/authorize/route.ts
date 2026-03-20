// TikTok Shop OAuth Authorization URL Generator
// Pattern: follows existing src/app/api/tiktok/auth/url/route.ts
// Key difference: No PKCE (code_verifier = NULL), uses service_id not client_key

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildShopAuthorizationUrl } from '@/lib/tiktok/shop-oauth';

export async function POST() {
    try {
        const supabase = await createClient();

        // Verify user is authenticated
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized - Please login first' },
                { status: 401 }
            );
        }

        // Generate Shop OAuth URL (no PKCE — no codeVerifier returned)
        const { authUrl, state } = buildShopAuthorizationUrl(user.id);

        // Store the auth state for callback verification
        // ⚠️ code_verifier = NULL because Shop OAuth does NOT use PKCE
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

        const { error: insertError } = await supabase
            .from('tiktok_auth_states')
            .insert({
                state,
                code_verifier: '', // Shop OAuth: no PKCE, use empty string
                user_id: user.id,
                expires_at: expiresAt.toISOString(),
            });

        if (insertError) {
            console.error('Failed to store Shop auth state:', insertError);
            return NextResponse.json(
                { error: 'Failed to initialize Shop OAuth flow' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            authUrl,
            message: 'Redirect user to this URL to authorize TikTok Shop access',
        });
    } catch (error) {
        console.error('TikTok Shop auth URL error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to generate Shop auth URL' },
            { status: 500 }
        );
    }
}
