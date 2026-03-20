// Get showcase products for the current user's Shop account
// Proxies to TikTok Shop API: GET /affiliate_creator/202405/showcases/products

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getShowcaseProducts } from '@/lib/tiktok/shop-api';
import { isShopTokenExpired } from '@/lib/tiktok/shop-oauth';

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

        // Parse pagination parameters
        const pageSize = parseInt(searchParams.get('page_size') || '20', 10);
        const pageToken = searchParams.get('page_token') || undefined;
        const accountId = searchParams.get('account_id');

        if (!accountId) {
            return NextResponse.json(
                { error: 'account_id is required' },
                { status: 400 }
            );
        }

        // Fetch the Shop account (need access_token)
        const { data: account, error: fetchError } = await supabase
            .from('tiktok_accounts')
            .select('id, access_token, token_expires_at, account_type')
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

        // Check if token is expired
        if (!account.token_expires_at || isShopTokenExpired(account.token_expires_at)) {
            return NextResponse.json(
                { error: 'Access token expired. Please refresh the token first.' },
                { status: 401 }
            );
        }

        // Call TikTok Shop API
        const result = await getShowcaseProducts(
            account.access_token,
            pageSize,
            pageToken
        );

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error fetching showcase products:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch products' },
            { status: 500 }
        );
    }
}
