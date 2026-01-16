// TikTok OAuth Authorization URL Generator
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildAuthorizationUrl } from '@/lib/tiktok/oauth';

export async function POST() {
    try {
        // Get current user
        const supabase = await createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized - Please login first' },
                { status: 401 }
            );
        }

        // Generate OAuth URL with PKCE
        const { authUrl, state, codeVerifier } = buildAuthorizationUrl(user.id);

        // Store the state and code verifier in a temporary session
        // Using Supabase to store the pending auth state
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

        const { error: insertError } = await supabase
            .from('tiktok_auth_states')
            .insert({
                state,
                code_verifier: codeVerifier,
                user_id: user.id,
                expires_at: expiresAt.toISOString(),
            });

        if (insertError) {
            console.error('Failed to store auth state:', insertError);
            return NextResponse.json(
                { error: 'Failed to initialize OAuth flow' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            authUrl,
            message: 'Redirect user to this URL to authorize TikTok access'
        });
    } catch (error) {
        console.error('TikTok auth URL error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to generate auth URL' },
            { status: 500 }
        );
    }
}
