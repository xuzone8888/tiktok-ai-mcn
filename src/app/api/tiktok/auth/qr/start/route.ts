import crypto from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
    buildTikTokAuthCooldownResponse,
    enforceTikTokAuthCooldown,
} from '@/lib/tiktok/auth-diagnostics';
import { isTikTokGroupsDemoMode } from '@/lib/tiktok/demo-account-groups';
import { requestTikTokQrCode } from '@/lib/tiktok/qr-oauth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        if (isTikTokGroupsDemoMode()) {
            return NextResponse.json({
                demo: true,
                message: '本地预览模式已内置测试账号，真实 TikTok 二维码授权需在测试或生产环境验证。',
            });
        }

        const supabase = await createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return NextResponse.json({ error: '请先登录后再绑定 TikTok 账号' }, { status: 401 });
        }

        const adminSupabase = createAdminClient();
        const cooldown = await enforceTikTokAuthCooldown(adminSupabase, user.id, request, 'qr');
        if (!cooldown.allowed) {
            const payload = buildTikTokAuthCooldownResponse(cooldown);
            return NextResponse.json(payload.body, {
                status: 429,
                headers: payload.headers,
            });
        }

        const state = `${crypto.randomBytes(16).toString('hex')}_${user.id}`;
        const expiresAt = new Date(Date.now() + 2 * 60 * 1000);

        const { error: insertError } = await adminSupabase
            .from('tiktok_auth_states')
            .insert({
                state,
                user_id: user.id,
                code_verifier: null,
                expires_at: expiresAt.toISOString(),
                flow_type: 'qr',
                status: 'pending',
                ip_hash: cooldown.diagnostics.ipHash,
                user_agent_hash: cooldown.diagnostics.userAgentHash,
            });

        if (insertError) {
            console.error('Failed to store TikTok QR auth state:', insertError);
            return NextResponse.json({ error: 'Failed to initialize QR authorization' }, { status: 500 });
        }

        let qr: Awaited<ReturnType<typeof requestTikTokQrCode>>;
        try {
            qr = await requestTikTokQrCode(state);
        } catch (qrError) {
            await adminSupabase
                .from('tiktok_auth_states')
                .update({
                    status: 'failed',
                    error_code: 'qr_start_failed',
                    error_message: qrError instanceof Error ? qrError.message : 'Failed to get TikTok QR code.',
                    client_ticket: null,
                    qr_token: null,
                    completed_at: new Date().toISOString(),
                })
                .eq('state', state);

            throw qrError;
        }

        const { error: updateError } = await adminSupabase
            .from('tiktok_auth_states')
            .update({
                client_ticket: qr.clientTicket,
                qr_token: qr.token,
            })
            .eq('state', state);

        if (updateError) {
            console.error('Failed to update TikTok QR auth state:', updateError);
            await adminSupabase
                .from('tiktok_auth_states')
                .update({
                    status: 'failed',
                    error_code: 'qr_state_update_failed',
                    error_message: updateError.message,
                    client_ticket: null,
                    qr_token: null,
                    completed_at: new Date().toISOString(),
                })
                .eq('state', state);

            return NextResponse.json({ error: 'Failed to initialize QR authorization' }, { status: 500 });
        }

        return NextResponse.json({
            state,
            qrImageDataUrl: qr.qrImageDataUrl,
            expiresAt: expiresAt.toISOString(),
            pollIntervalMs: 3000,
        });
    } catch (error) {
        console.error('TikTok QR start error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to start QR authorization' },
            { status: 500 }
        );
    }
}
