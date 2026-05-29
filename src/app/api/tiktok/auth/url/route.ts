// TikTok OAuth Authorization URL Generator
import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
    buildTikTokAuthCooldownResponse,
    enforceTikTokAuthCooldown,
} from '@/lib/tiktok/auth-diagnostics';
import { isTikTokGroupsDemoMode } from '@/lib/tiktok/demo-account-groups';
import { buildAuthorizationUrl } from '@/lib/tiktok/oauth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        if (isTikTokGroupsDemoMode()) {
            return NextResponse.json({
                demo: true,
                authUrl: '/publish/accounts?demo=1',
                message: '本地预览模式已内置测试账号，真实 TikTok OAuth 绑定需在测试或生产环境验证。',
            });
        }

        // Get current user
        const supabase = await createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: '请先登录后再绑定 TikTok 账号' },
                { status: 401 }
            );
        }

        // Generate OAuth URL with PKCE
        const { authUrl, state, codeVerifier } = buildAuthorizationUrl(user.id);
        const adminSupabase = createAdminClient();
        const cooldown = await enforceTikTokAuthCooldown(adminSupabase, user.id, request, 'web');
        if (!cooldown.allowed) {
            const payload = buildTikTokAuthCooldownResponse(cooldown);
            return NextResponse.json(payload.body, {
                status: 429,
                headers: payload.headers,
            });
        }

        // Store the state and code verifier in a temporary session
        // Using Supabase to store the pending auth state
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

        const { error: insertError } = await adminSupabase
            .from('tiktok_auth_states')
            .insert({
                state,
                code_verifier: codeVerifier,
                user_id: user.id,
                expires_at: expiresAt.toISOString(),
                flow_type: 'web',
                status: 'pending',
                ip_hash: cooldown.diagnostics.ipHash,
                user_agent_hash: cooldown.diagnostics.userAgentHash,
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
