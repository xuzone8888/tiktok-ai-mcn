import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { calculateTokenExpiration, refreshAccessToken } from '@/lib/tiktok/oauth';
import type { TikTokRefreshTokenResponse } from '@/lib/tiktok/types';
import type { Database } from '@/types/database';

export interface TikTokTokenRecord {
    account_id: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string | null;
    refresh_token_expires_at: string | null;
    updated_at: string | null;
    compatibility_write_key: string | null;
}

export interface TikTokTokenRefreshResult {
    token: TikTokTokenRecord;
    providerResponse: TikTokRefreshTokenResponse | null;
    refreshed: boolean;
}

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const REFRESH_LEASE_SECONDS = 30;
const REFRESH_WAIT_ATTEMPTS = 60;
const REFRESH_WAIT_INTERVAL_MS = 250;

const validatedTokenRecords = new WeakSet<TikTokTokenRecord>();
const inFlightRefreshes = new Map<string, Promise<TikTokTokenRefreshResult>>();

function isMissingTokenTableError(error: { code?: string; message?: string } | null) {
    if (!error) return false;
    const message = error.message?.toLowerCase() || '';
    return (
        (error.code === '42P01' || error.code === 'PGRST205')
        && message.includes('tiktok_account_tokens')
    );
}

function isMissingTokenRpcError(
    error: { code?: string; message?: string } | null,
    functionName: 'claim_tiktok_token_refresh' | 'commit_tiktok_token_refresh' | 'release_tiktok_token_refresh'
) {
    if (!error) return false;
    const message = error.message?.toLowerCase() || '';
    return (error.code === '42883' || error.code === 'PGRST202')
        && message.includes(functionName);
}

function markValidated(token: TikTokTokenRecord) {
    validatedTokenRecords.add(token);
    return token;
}

function toLegacyToken(row: {
    id: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string | null;
    token_expires_at: string | null;
    refresh_token_expires_at: string | null;
    updated_at: string | null;
}): TikTokTokenRecord {
    return markValidated({
        account_id: row.id,
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        access_token_expires_at: row.access_token_expires_at,
        refresh_token_expires_at: row.token_expires_at || row.refresh_token_expires_at,
        updated_at: row.updated_at,
        compatibility_write_key: null,
    });
}

function delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function isTikTokAccessTokenFresh(expiresAt?: string | null) {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() > Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS;
}

/**
 * Resolve the normal-account parent rows first so callers cannot use this
 * service-role manager as a bridge into the Shop credential path.
 */
export async function getTikTokAccountTokens(
    supabase: SupabaseClient<Database>,
    accountIds: string[]
): Promise<Map<string, TikTokTokenRecord>> {
    const uniqueIds = [...new Set(accountIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();

    const { data: normalAccounts, error: accountError } = await supabase
        .from('tiktok_accounts')
        .select('id, account_type')
        .in('id', uniqueIds)
        .eq('account_type', 'normal')
        .eq('status', 'active');

    if (accountError) {
        throw new Error(`Failed to validate normal TikTok accounts: ${accountError.message}`);
    }

    const normalIds = (normalAccounts || []).map((row) => row.id);
    const tokens = new Map<string, TikTokTokenRecord>();
    if (normalIds.length === 0) return tokens;

    const { data: tokenRows, error: tokenError } = await supabase
        .from('tiktok_account_tokens')
        .select('account_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, updated_at, compatibility_write_key')
        .in('account_id', normalIds);

    if (tokenError && !isMissingTokenTableError(tokenError)) {
        throw new Error(`Failed to load TikTok token storage: ${tokenError.message}`);
    }

    for (const row of tokenRows || []) {
        tokens.set(row.account_id, markValidated(row));
    }

    const fallbackIds = normalIds.filter((accountId) => !tokens.has(accountId));
    if (fallbackIds.length === 0) return tokens;

    const { data: legacyRows, error: legacyError } = await supabase
        .from('tiktok_accounts')
        .select('id, access_token, refresh_token, access_token_expires_at, token_expires_at, refresh_token_expires_at, updated_at')
        .in('id', fallbackIds)
        .eq('account_type', 'normal')
        .eq('status', 'active');

    if (legacyError) {
        throw new Error(`Failed to load legacy TikTok tokens: ${legacyError.message}`);
    }

    for (const row of legacyRows || []) {
        tokens.set(row.id, toLegacyToken(row));
    }

    return tokens;
}

export async function getTikTokAccountToken(
    supabase: SupabaseClient<Database>,
    accountId: string
): Promise<TikTokTokenRecord> {
    const tokens = await getTikTokAccountTokens(supabase, [accountId]);
    const token = tokens.get(accountId);
    if (!token) {
        throw new Error('Normal TikTok account token not found');
    }
    return token;
}

/**
 * The commit RPC locks and fences the secure token row, then updates the legacy
 * compatibility row. Its trigger mirrors the result in the same transaction.
 * Only a definitely missing migration/RPC falls back to a legacy CAS update.
 */
export async function persistTikTokAccountToken(
    supabase: SupabaseClient<Database>,
    accountId: string,
    tokenResponse: TikTokRefreshTokenResponse,
    guard: {
        expectedAccessToken: string;
        expectedRefreshToken: string;
        compatibilityWriteKey: string | null;
        leaseToken: string;
    }
): Promise<TikTokTokenRecord> {
    const now = new Date().toISOString();
    const accessTokenExpiresAt = calculateTokenExpiration(tokenResponse.expires_in).toISOString();
    const refreshTokenExpiresAt = calculateTokenExpiration(tokenResponse.refresh_expires_in).toISOString();

    const { data: committed, error: legacyError } = await supabase.rpc(
        'commit_tiktok_token_refresh',
        {
            p_account_id: accountId,
            p_expected_refresh_token: guard.expectedRefreshToken,
            p_lease_token: guard.leaseToken,
            p_access_token: tokenResponse.access_token,
            p_refresh_token: tokenResponse.refresh_token,
            p_access_token_expires_at: accessTokenExpiresAt,
            p_refresh_token_expires_at: refreshTokenExpiresAt,
            p_updated_at: now,
        }
    );

    if (
        legacyError
        && (
            isMissingTokenRpcError(legacyError, 'commit_tiktok_token_refresh')
            || isMissingTokenTableError(legacyError)
        )
    ) {
        return persistLegacyTikTokAccountToken(
            supabase,
            accountId,
            tokenResponse,
            guard.expectedAccessToken,
            guard.expectedRefreshToken,
            guard.compatibilityWriteKey,
            {
                accessTokenExpiresAt,
                refreshTokenExpiresAt,
                updatedAt: now,
            }
        );
    }
    if (legacyError) {
        throw new Error(`Failed to persist TikTok token: ${legacyError.message}`);
    }
    if (!committed) {
        throw new Error('TikTok token refresh lost its database lease');
    }

    return markValidated({
        account_id: accountId,
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        access_token_expires_at: accessTokenExpiresAt,
        refresh_token_expires_at: refreshTokenExpiresAt,
        updated_at: now,
        compatibility_write_key: guard.compatibilityWriteKey,
    });
}

async function persistLegacyTikTokAccountToken(
    supabase: SupabaseClient<Database>,
    accountId: string,
    tokenResponse: TikTokRefreshTokenResponse,
    expectedAccessToken: string,
    expectedRefreshToken: string,
    compatibilityWriteKey: string | null,
    timestamps?: {
        accessTokenExpiresAt: string;
        refreshTokenExpiresAt: string;
        updatedAt: string;
    }
): Promise<TikTokTokenRecord> {
    const accessTokenExpiresAt = timestamps?.accessTokenExpiresAt
        || calculateTokenExpiration(tokenResponse.expires_in).toISOString();
    const refreshTokenExpiresAt = timestamps?.refreshTokenExpiresAt
        || calculateTokenExpiration(tokenResponse.refresh_expires_in).toISOString();
    const updatedAt = timestamps?.updatedAt || new Date().toISOString();

    // Read credentials in the response body, never in a PostgREST filter URL.
    // The non-sensitive updated_at value becomes the actual UPDATE CAS.
    const { data: currentAccount, error: currentError } = await supabase
        .from('tiktok_accounts')
        .select('access_token, refresh_token, updated_at')
        .eq('id', accountId)
        .eq('account_type', 'normal')
        .maybeSingle();

    if (currentError) {
        throw new Error(`Failed to validate legacy TikTok token fallback: ${currentError.message}`);
    }
    if (
        !currentAccount
        || currentAccount.access_token !== expectedAccessToken
        || currentAccount.refresh_token !== expectedRefreshToken
    ) {
        throw new Error('TikTok legacy token refresh lost its CAS');
    }

    let updateQuery = supabase
        .from('tiktok_accounts')
        .update({
            access_token: tokenResponse.access_token,
            refresh_token: tokenResponse.refresh_token,
            access_token_expires_at: accessTokenExpiresAt,
            token_expires_at: refreshTokenExpiresAt,
            refresh_token_expires_at: refreshTokenExpiresAt,
            ...(compatibilityWriteKey
                ? { token_write_fence: compatibilityWriteKey }
                : {}),
            updated_at: updatedAt,
        })
        .eq('id', accountId)
        .eq('account_type', 'normal')
    updateQuery = currentAccount.updated_at
        ? updateQuery.eq('updated_at', currentAccount.updated_at)
        : updateQuery.is('updated_at', null);

    const { data: updatedAccount, error } = await updateQuery
        .select('id')
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to persist legacy TikTok token fallback: ${error.message}`);
    }
    if (!updatedAccount) {
        throw new Error('TikTok legacy token refresh lost its CAS');
    }

    return markValidated({
        account_id: accountId,
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        access_token_expires_at: accessTokenExpiresAt,
        refresh_token_expires_at: refreshTokenExpiresAt,
        updated_at: updatedAt,
        compatibility_write_key: compatibilityWriteKey,
    });
}

type RefreshLeaseClaim = 'claimed' | 'busy' | 'unavailable';

async function claimRefreshLease(
    supabase: SupabaseClient<Database>,
    accountId: string,
    expectedRefreshToken: string,
    leaseToken: string
): Promise<RefreshLeaseClaim> {
    const { data, error } = await supabase.rpc('claim_tiktok_token_refresh', {
        p_account_id: accountId,
        p_expected_refresh_token: expectedRefreshToken,
        p_lease_token: leaseToken,
        p_lease_seconds: REFRESH_LEASE_SECONDS,
    });

    if (
        error
        && (
            isMissingTokenRpcError(error, 'claim_tiktok_token_refresh')
            || isMissingTokenTableError(error)
        )
    ) {
        return 'unavailable';
    }
    if (error) {
        throw new Error(`Failed to coordinate TikTok token refresh: ${error.message}`);
    }
    return data === true ? 'claimed' : 'busy';
}

async function releaseRefreshLease(
    supabase: SupabaseClient<Database>,
    accountId: string,
    leaseToken: string
) {
    const { error } = await supabase.rpc('release_tiktok_token_refresh', {
        p_account_id: accountId,
        p_lease_token: leaseToken,
    });
    if (
        error
        && !isMissingTokenRpcError(error, 'release_tiktok_token_refresh')
        && !isMissingTokenTableError(error)
    ) {
        console.error(`[TikTokTokenManager] Failed to release refresh lease for ${accountId}:`, error);
    }
}

async function waitForRefreshWinner(
    supabase: SupabaseClient<Database>,
    accountId: string,
    expectedToken: TikTokTokenRecord
) {
    for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt += 1) {
        await delay(REFRESH_WAIT_INTERVAL_MS);
        const latest = await getTikTokAccountToken(supabase, accountId);
        if (
            latest.refresh_token !== expectedToken.refresh_token
            || latest.access_token !== expectedToken.access_token
        ) {
            return latest;
        }
    }
    return null;
}

async function performRefresh(
    supabase: SupabaseClient<Database>,
    accountId: string,
    currentToken?: TikTokTokenRecord
): Promise<TikTokTokenRefreshResult> {
    let account = currentToken && validatedTokenRecords.has(currentToken)
        ? currentToken
        : await getTikTokAccountToken(supabase, accountId);

    for (let coordinationAttempt = 0; coordinationAttempt < 2; coordinationAttempt += 1) {
        const leaseToken = randomUUID();
        const claim = await claimRefreshLease(
            supabase,
            accountId,
            account.refresh_token,
            leaseToken
        );

        if (claim === 'unavailable') {
            try {
                const providerResponse = await refreshAccessToken(account.refresh_token);
                const token = await persistLegacyTikTokAccountToken(
                    supabase,
                    accountId,
                    providerResponse,
                    account.access_token,
                    account.refresh_token,
                    account.compatibility_write_key
                );
                return { token, providerResponse, refreshed: true };
            } catch (error) {
                const latest = await getTikTokAccountToken(supabase, accountId);
                if (
                    latest.refresh_token !== account.refresh_token
                    || latest.access_token !== account.access_token
                ) {
                    return { token: latest, providerResponse: null, refreshed: false };
                }
                throw error;
            }
        }

        if (claim === 'busy') {
            const winner = await waitForRefreshWinner(supabase, accountId, account);
            if (winner) {
                return { token: winner, providerResponse: null, refreshed: false };
            }
            account = await getTikTokAccountToken(supabase, accountId);
            continue;
        }

        try {
            const providerResponse = await refreshAccessToken(account.refresh_token);
            const token = await persistTikTokAccountToken(
                supabase,
                accountId,
                providerResponse,
                {
                    expectedAccessToken: account.access_token,
                    expectedRefreshToken: account.refresh_token,
                    compatibilityWriteKey: account.compatibility_write_key,
                    leaseToken,
                }
            );
            return { token, providerResponse, refreshed: true };
        } catch (error) {
            await releaseRefreshLease(supabase, accountId, leaseToken);

            // A winner may have committed after this worker started but before
            // its provider call failed. Prefer that committed token.
            const latest = await getTikTokAccountToken(supabase, accountId);
            if (
                latest.refresh_token !== account.refresh_token
                || latest.access_token !== account.access_token
            ) {
                return { token: latest, providerResponse: null, refreshed: false };
            }
            throw error;
        }
    }

    throw new Error('Timed out waiting for another TikTok token refresh');
}

export function refreshTikTokAccountToken(
    supabase: SupabaseClient<Database>,
    accountId: string,
    currentToken?: TikTokTokenRecord
): Promise<TikTokTokenRefreshResult> {
    const existing = inFlightRefreshes.get(accountId);
    if (existing) return existing;

    const refreshPromise = performRefresh(supabase, accountId, currentToken)
        .finally(() => {
            if (inFlightRefreshes.get(accountId) === refreshPromise) {
                inFlightRefreshes.delete(accountId);
            }
        });
    inFlightRefreshes.set(accountId, refreshPromise);
    return refreshPromise;
}

export async function getValidTikTokAccessToken(
    supabase: SupabaseClient<Database>,
    accountId: string,
    currentToken?: TikTokTokenRecord
) {
    const account = currentToken && validatedTokenRecords.has(currentToken)
        ? currentToken
        : await getTikTokAccountToken(supabase, accountId);
    if (isTikTokAccessTokenFresh(account.access_token_expires_at)) {
        return account.access_token;
    }

    const result = await refreshTikTokAccountToken(supabase, accountId, account);
    return result.token.access_token;
}
