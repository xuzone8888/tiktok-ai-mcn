// Delete (disconnect) a TikTok account
import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isUuid, mapAccountGroupError } from '@/lib/tiktok/account-groups';
import { deleteDemoAccount, isTikTokGroupsDemoMode } from '@/lib/tiktok/demo-account-groups';
import { revokeAccessToken } from '@/lib/tiktok/oauth';
import { getTikTokAccountToken } from '@/lib/tiktok/token-manager';

export const dynamic = 'force-dynamic';

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        if (!isUuid(id)) {
            return NextResponse.json({ error: 'Account not found' }, { status: 404 });
        }

        if (isTikTokGroupsDemoMode()) {
            try {
                return NextResponse.json(deleteDemoAccount(id));
            } catch (error) {
                const mapped = mapAccountGroupError(error);
                return NextResponse.json({ error: mapped.message }, { status: mapped.status });
            }
        }

        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Verify ownership before accessing service-role-only token storage.
        const { data: account, error: fetchError } = await supabase
            .from('tiktok_accounts')
            .select('id')
            .eq('id', id)
            .eq('user_id', user.id)
            .eq('account_type', 'normal')
            .single();

        if (fetchError || !account) {
            return NextResponse.json(
                { error: 'Account not found' },
                { status: 404 }
            );
        }

        // Try to revoke the token (don't fail if this fails)
        try {
            const token = await getTikTokAccountToken(createAdminClient(), account.id);
            await revokeAccessToken(token.access_token);
        } catch (revokeError) {
            console.error('Failed to revoke token:', revokeError);
            // Continue with deletion even if revocation fails
        }

        // Delete the account from database
        const { error: deleteError } = await supabase
            .from('tiktok_accounts')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id)
            .eq('account_type', 'normal');

        if (deleteError) {
            console.error('Error deleting account:', deleteError);
            return NextResponse.json(
                { error: 'Failed to delete account' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error in delete account API:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
