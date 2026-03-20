// Delete (unbind) a TikTok Shop account
// Verifies account_type = 'shop_creator' and user ownership before deletion

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(
    _request: NextRequest,
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

        // Verify ownership AND account type before deletion
        const { data: account, error: fetchError } = await supabase
            .from('tiktok_accounts')
            .select('id, account_type')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (fetchError || !account) {
            return NextResponse.json(
                { error: 'Account not found' },
                { status: 404 }
            );
        }

        if (account.account_type !== 'shop_creator') {
            return NextResponse.json(
                { error: 'This is not a Shop account' },
                { status: 400 }
            );
        }

        // Delete the account (CASCADE will remove related shop_publish_task_items)
        const { error: deleteError } = await supabase
            .from('tiktok_accounts')
            .delete()
            .eq('id', id);

        if (deleteError) {
            console.error('Error deleting Shop account:', deleteError);
            return NextResponse.json(
                { error: 'Failed to unbind Shop account' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error in Shop account delete:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
