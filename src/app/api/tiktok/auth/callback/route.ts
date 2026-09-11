import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { commitTikTokAccountFromAuthState } from '@/lib/tiktok/account-binding';
import {
    claimTikTokAuthState,
    expireTikTokAuthState,
    failTikTokAuthState,
    newTikTokAuthProcessingToken,
} from '@/lib/tiktok/auth-state';
import { exchangeCodeForToken } from '@/lib/tiktok/oauth';
import { buildTikTokAccountsUrl } from '@/lib/tiktok/routes';

const SAFE_CALLBACK_FAILURE = 'TikTok authorization failed. Please try again.';

function normalizeProviderErrorCode(value: string): string {
    const normalized = value.trim().toLowerCase();
    return /^[a-z0-9_.-]{1,80}$/.test(normalized)
        ? normalized
        : 'authorization_denied';
}

function safeProviderErrorMessage(code: string): string {
    return code === 'access_denied'
        ? 'TikTok authorization was cancelled.'
        : SAFE_CALLBACK_FAILURE;
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const oauthError = searchParams.get('error');
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

    if ((!code && !oauthError) || !state) {
        return NextResponse.redirect(
            buildTikTokAccountsUrl(baseUrl, { error: 'Missing authorization code or state' })
        );
    }

    const supabase = createAdminClient();
    const processingToken = newTikTokAuthProcessingToken();
    let claimed = false;

    try {
        const authState = await claimTikTokAuthState(supabase, {
            state,
            flowType: 'web',
            userId: null,
            processingToken,
        });
        if (!authState) {
            await expireTikTokAuthState(supabase, {
                state,
                flowType: 'web',
                userId: null,
            });
            return NextResponse.redirect(
                buildTikTokAccountsUrl(baseUrl, {
                    error: 'Invalid, expired, or already used authorization state',
                })
            );
        }
        claimed = true;

        if (oauthError) {
            const safeErrorCode = normalizeProviderErrorCode(oauthError);
            const safeErrorMessage = safeProviderErrorMessage(safeErrorCode);
            const failed = await failTikTokAuthState(supabase, {
                state,
                flowType: 'web',
                userId: null,
                processingToken,
                errorCode: safeErrorCode,
                errorMessage: safeErrorMessage,
            });
            return NextResponse.redirect(
                buildTikTokAccountsUrl(baseUrl, {
                    error: failed
                        ? safeErrorMessage
                        : 'Authorization state was already finalized',
                })
            );
        }

        if (!code) {
            throw new Error('Missing authorization code.');
        }

        const tokenResponse = await exchangeCodeForToken(code, authState.code_verifier);
        const { userInfo } = await commitTikTokAccountFromAuthState(
            supabase,
            {
                state,
                flowType: 'web',
                userId: authState.user_id,
                processingToken,
                tokenResponse,
            }
        );

        return NextResponse.redirect(
            buildTikTokAccountsUrl(baseUrl, {
                success: 'true',
                name: userInfo.display_name || 'TikTok Account',
            })
        );
    } catch (error) {
        console.error(
            'TikTok callback failed:',
            error instanceof Error ? error.name : 'UnknownError'
        );
        if (claimed) {
            try {
                await failTikTokAuthState(supabase, {
                    state,
                    flowType: 'web',
                    userId: null,
                    processingToken,
                    errorCode: 'callback_failed',
                    errorMessage: SAFE_CALLBACK_FAILURE,
                });
            } catch (updateError) {
                console.warn('Failed to persist TikTok callback error:', updateError);
            }
        }

        return NextResponse.redirect(
            buildTikTokAccountsUrl(baseUrl, {
                error: SAFE_CALLBACK_FAILURE,
            })
        );
    }
}
