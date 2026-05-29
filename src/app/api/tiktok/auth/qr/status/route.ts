import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { saveTikTokAccountFromToken } from '@/lib/tiktok/account-binding';
import { exchangeCodeForToken } from '@/lib/tiktok/oauth';
import {
    checkTikTokQrCode,
    extractAuthorizationCodeFromQrStatus,
    extractRedirectUriFromQrStatus,
} from '@/lib/tiktok/qr-oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const state = request.nextUrl.searchParams.get('state');
    if (!state) {
        return NextResponse.json({ error: 'Missing QR authorization state' }, { status: 400 });
    }

    try {
        const supabase = await createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return NextResponse.json({ error: '请先登录后再绑定 TikTok 账号' }, { status: 401 });
        }

        const adminSupabase = createAdminClient();
        const { data: authState, error: stateError } = await adminSupabase
            .from('tiktok_auth_states')
            .select('*')
            .eq('state', state)
            .eq('user_id', user.id)
            .eq('flow_type', 'qr')
            .single();

        if (stateError || !authState) {
            return NextResponse.json({ error: 'QR authorization session not found' }, { status: 404 });
        }

        if (authState.status === 'completed') {
            return NextResponse.json({ status: 'completed', success: true });
        }

        if (authState.status === 'failed' || authState.status === 'expired') {
            return NextResponse.json({
                status: authState.status,
                error: authState.error_message || 'QR authorization is no longer available.',
            });
        }

        if (!authState.qr_token || !authState.client_ticket) {
            return NextResponse.json({ error: 'QR authorization session is incomplete' }, { status: 500 });
        }

        if (new Date(authState.expires_at) < new Date()) {
            await adminSupabase
                .from('tiktok_auth_states')
                .update({
                    status: 'expired',
                    error_code: 'expired',
                    error_message: 'QR authorization expired.',
                    client_ticket: null,
                    qr_token: null,
                })
                .eq('state', state!);

            return NextResponse.json({ status: 'expired' });
        }

        const status = await checkTikTokQrCode(authState.qr_token);
        await adminSupabase
            .from('tiktok_auth_states')
            .update({ last_checked_at: new Date().toISOString() })
            .eq('state', state);

        if (status.status === 'expired') {
            await adminSupabase
                .from('tiktok_auth_states')
                .update({
                    status: 'expired',
                    error_code: 'expired',
                    error_message: 'QR authorization expired.',
                    client_ticket: null,
                    qr_token: null,
                })
                .eq('state', state!);

            return NextResponse.json({ status: 'expired' });
        }

        if (status.status !== 'confirmed') {
            return NextResponse.json({ status: status.status });
        }

        if (status.client_ticket !== authState.client_ticket) {
            await adminSupabase
                .from('tiktok_auth_states')
                .update({
                    status: 'failed',
                    error_code: 'client_ticket_mismatch',
                    error_message: 'QR authorization integrity check failed.',
                    client_ticket: null,
                    qr_token: null,
                    completed_at: new Date().toISOString(),
                })
                .eq('state', state);

            return NextResponse.json({ error: 'QR authorization integrity check failed' }, { status: 400 });
        }

        const code = extractAuthorizationCodeFromQrStatus(status);
        if (!code) {
            throw new Error('TikTok QR authorization did not return an authorization code.');
        }

        const qrRedirectUri = extractRedirectUriFromQrStatus(status);
        const tokenResponse = await exchangeCodeForToken(code, null, qrRedirectUri);
        const { userInfo } = await saveTikTokAccountFromToken(adminSupabase, user.id, tokenResponse);

        await adminSupabase
            .from('tiktok_auth_states')
            .update({
                status: 'completed',
                client_ticket: null,
                qr_token: null,
                completed_at: new Date().toISOString(),
            })
            .eq('state', state);

        return NextResponse.json({
            status: 'completed',
            success: true,
            name: userInfo.display_name || 'TikTok Account',
        });
    } catch (error) {
        console.error('TikTok QR status error:', error);
        try {
            await createAdminClient()
                .from('tiktok_auth_states')
                .update({
                    status: 'failed',
                    error_code: 'qr_status_failed',
                    error_message: error instanceof Error ? error.message : 'QR authorization failed',
                    client_ticket: null,
                    qr_token: null,
                    completed_at: new Date().toISOString(),
                })
                .eq('state', state);
        } catch (updateError) {
            console.warn('Failed to persist TikTok QR status error:', updateError);
        }

        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'QR authorization failed' },
            { status: 500 }
        );
    }
}
