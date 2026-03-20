// Video precheck — submit and query precheck results
// POST: submit a video for precheck
// GET: get precheck result by precheck_id

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { precheckVideo, getPrecheckResult } from '@/lib/tiktok/shop-api';
import { isShopTokenExpired } from '@/lib/tiktok/shop-oauth';

// POST: Submit a video for precheck
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const body = await request.json();
        const { account_id, file_id } = body as {
            account_id: string;
            file_id: string;
        };

        if (!account_id || !file_id) {
            return NextResponse.json(
                { error: 'account_id and file_id are required' },
                { status: 400 }
            );
        }

        // Fetch account for access_token
        const { data: account, error: fetchError } = await supabase
            .from('tiktok_accounts')
            .select('id, access_token, token_expires_at')
            .eq('id', account_id)
            .eq('user_id', user.id)
            .eq('account_type', 'shop_creator')
            .single();

        if (fetchError || !account) {
            return NextResponse.json(
                { error: 'Shop account not found' },
                { status: 404 }
            );
        }

        if (!account.token_expires_at || isShopTokenExpired(account.token_expires_at)) {
            return NextResponse.json(
                { error: 'Access token expired. Please refresh first.' },
                { status: 401 }
            );
        }

        // ⚠️ precheckVideo takes file_id (already uploaded), not video buffer
        const result = await precheckVideo(account.access_token, file_id);

        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        console.error('Error submitting precheck:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to submit precheck' },
            { status: 500 }
        );
    }
}

// GET: Get precheck result
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const searchParams = request.nextUrl.searchParams;

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const precheckId = searchParams.get('precheck_id');
        const accountId = searchParams.get('account_id');

        if (!precheckId || !accountId) {
            return NextResponse.json(
                { error: 'precheck_id and account_id are required' },
                { status: 400 }
            );
        }

        // Fetch account for access_token
        const { data: account, error: fetchError } = await supabase
            .from('tiktok_accounts')
            .select('id, access_token, token_expires_at')
            .eq('id', accountId)
            .eq('user_id', user.id)
            .eq('account_type', 'shop_creator')
            .single();

        if (fetchError || !account) {
            return NextResponse.json(
                { error: 'Shop account not found' },
                { status: 404 }
            );
        }

        if (!account.token_expires_at || isShopTokenExpired(account.token_expires_at)) {
            return NextResponse.json(
                { error: 'Access token expired. Please refresh first.' },
                { status: 401 }
            );
        }

        const result = await getPrecheckResult(account.access_token, precheckId);

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error getting precheck result:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to get precheck result' },
            { status: 500 }
        );
    }
}
