// Delete (disconnect) a TikTok account
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { revokeAccessToken } from '@/lib/tiktok/oauth';

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const supabase = await createClient();

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Fetch the account to get access token for revocation
        const { data: account, error: fetchError } = await supabase
            .from('tiktok_accounts')
            .select('access_token')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (fetchError || !account) {
            return NextResponse.json(
                { error: 'Account not found' },
                { status: 404 }
            );
        }

        // Try to revoke the token (don't fail if this fails)
        try {
            await revokeAccessToken(account.access_token);
        } catch (revokeError) {
            console.error('Failed to revoke token:', revokeError);
            // Continue with deletion even if revocation fails
        }

        // Delete the account from database
        const { error: deleteError } = await supabase
            .from('tiktok_accounts')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);

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
