// Disconnect a normal TikTok account without deleting publishing history.
import crypto from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isUuid, mapAccountGroupError } from '@/lib/tiktok/account-groups';
import { deleteDemoAccount, isTikTokGroupsDemoMode } from '@/lib/tiktok/demo-account-groups';
import { getTikTokRevocationWriteOutcome, revokeAccessToken } from '@/lib/tiktok/oauth';

export const dynamic = 'force-dynamic';

const REVOCATION_LEASE_SECONDS = 60;
const SAFE_REVOCATION_ERROR = 'TikTok publishing authorization revocation requires review.';
const AMBIGUOUS_REVOCATION_CODES = new Set([
    'provider_revocation_unknown',
    'provider_revocation_rejected',
]);

function firstRpcRow(value: unknown): {
    access_token: string;
    previous_error_code: string | null;
} | null {
    if (!Array.isArray(value) || value.length !== 1) return null;
    const row = value[0] as Record<string, unknown>;
    if (typeof row.access_token !== 'string' || !row.access_token.trim()) return null;
    return {
        access_token: row.access_token,
        previous_error_code: typeof row.previous_error_code === 'string'
            ? row.previous_error_code
            : null,
    };
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
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
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Establish tenant and normal-vs-Shop ownership before service-role token
    // access or any provider call.
    const { data: account, error: fetchError } = await supabase
        .from('tiktok_accounts')
        .select('id, status')
        .eq('id', id)
        .eq('user_id', user.id)
        .eq('account_type', 'normal')
        .maybeSingle();
    if (fetchError) {
        return NextResponse.json({ error: 'Failed to read account' }, { status: 500 });
    }
    if (!account) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const confirmUnknown = request.nextUrl.searchParams.get('confirmUnknown') === 'true';
    const admin = createAdminClient();
    const revocationToken = crypto.randomUUID();
    const { data: claimData, error: claimError } = await admin.rpc(
        'begin_tiktok_account_revocation',
        {
            p_account_id: id,
            p_user_id: user.id,
            p_revocation_token: revocationToken,
            p_lease_seconds: REVOCATION_LEASE_SECONDS,
            p_manual_confirmation: confirmUnknown,
        }
    );

    if (claimError) {
        if (claimError.message?.includes('business_authorization_present')) {
            return NextResponse.json(
                {
                    code: 'comment_authorization_must_disconnect_first',
                    error: '请先断开该账号的 TikTok 评论授权，再解绑发布授权。',
                },
                { status: 409 }
            );
        }
        if (claimError.message?.includes('active_publish_task')) {
            return NextResponse.json(
                {
                    code: 'active_publish_task',
                    error: '该账号仍有未完成或结果待确认的发布任务，请先完成处理后再解绑。',
                },
                { status: 409 }
            );
        }
        console.error('[TikTok OAuth] Account disconnect claim failed:', claimError.code);
        return NextResponse.json({ error: '无法安全启动账号解绑流程' }, { status: 503 });
    }

    const claimed = firstRpcRow(claimData);
    if (!claimed) {
        const { data: currentToken, error: currentError } = await admin
            .from('tiktok_account_tokens')
            .select('revocation_status')
            .eq('account_id', id)
            .maybeSingle();
        if (currentError) {
            return NextResponse.json({ error: '无法确认账号解绑状态' }, { status: 503 });
        }
        if (!currentToken && account.status === 'revoked') {
            return NextResponse.json({ disconnected: true });
        }
        return NextResponse.json(
            { error: '账号正在解绑，请稍后刷新状态' },
            { status: 409, headers: { 'Retry-After': '60' } }
        );
    }

    if (AMBIGUOUS_REVOCATION_CODES.has(claimed.previous_error_code || '') && !confirmUnknown) {
        const previousErrorCode = claimed.previous_error_code || 'provider_revocation_unknown';
        const { data: deferred, error: deferError } = await admin.rpc(
            'defer_tiktok_account_revocation',
            {
                p_account_id: id,
                p_user_id: user.id,
                p_revocation_token: revocationToken,
                p_error_code: previousErrorCode,
                p_error_message: SAFE_REVOCATION_ERROR,
            }
        );
        if (deferError || deferred !== true) {
            return NextResponse.json({ error: '无法确认账号授权撤销状态' }, { status: 503 });
        }
        return NextResponse.json(
            {
                code: 'revocation_confirmation_required',
                error: 'TikTok 撤销结果无法自动确认。请先在 TikTok 授权设置中确认已撤销，再选择本地完成解绑。',
            },
            { status: 409 }
        );
    }

    let providerSucceeded = confirmUnknown
        || claimed.previous_error_code === 'provider_succeeded_local_commit_pending';
    try {
        if (!providerSucceeded) {
            await revokeAccessToken(claimed.access_token);
            providerSucceeded = true;
        }
        const { data: completed, error: completeError } = await admin.rpc(
            'complete_tiktok_account_revocation',
            {
                p_account_id: id,
                p_user_id: user.id,
                p_revocation_token: revocationToken,
            }
        );
        if (completeError || completed !== true) {
            throw new Error('revocation_commit_failed');
        }
        return NextResponse.json({ disconnected: true });
    } catch (error) {
        const providerOutcome = getTikTokRevocationWriteOutcome(error);
        let stableCode = 'provider_revocation_unknown';
        if (providerSucceeded) {
            stableCode = 'provider_succeeded_local_commit_pending';
        } else if (providerOutcome === 'rejected') {
            stableCode = 'provider_revocation_rejected';
        }
        const { data: deferred, error: deferError } = await admin.rpc(
            'defer_tiktok_account_revocation',
            {
                p_account_id: id,
                p_user_id: user.id,
                p_revocation_token: revocationToken,
                p_error_code: stableCode,
                p_error_message: SAFE_REVOCATION_ERROR,
            }
        );
        if (deferError) {
            console.error('[TikTok OAuth] Failed to persist disconnect state:', deferError.code);
        } else if (deferred !== true) {
            // A successful completion response may have been lost. A missing
            // secure token is the committed winner; never revoke a second time.
            const { data: current, error: currentError } = await admin
                .from('tiktok_account_tokens')
                .select('account_id')
                .eq('account_id', id)
                .maybeSingle();
            if (!currentError && !current) {
                return NextResponse.json({ disconnected: true });
            }
        }
        return NextResponse.json(
            { error: '账号已在本地停用，但 TikTok 撤销结果需要确认' },
            { status: 503, headers: { 'Retry-After': '60' } }
        );
    }
}
