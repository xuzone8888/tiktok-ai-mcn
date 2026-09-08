import crypto from 'crypto';

import { isTikTokMockCredential, isTikTokTestMockEnabled } from './test-mock';
import type {
    TikTokRefreshTokenResponse,
    TikTokTokenResponse,
    TikTokUserInfo,
} from './types';
import { getTikTokOAuthScopes } from './video-list-rollout';

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const TIKTOK_OAUTH_TIMEOUT_MS = 20_000;
const TIKTOK_REFRESH_TIMEOUT_MS = 20_000;
const INVALID_REFRESH_CODES = new Set([
    'invalid_grant',
    'invalid_refresh_token',
    'refresh_token_expired',
    'token_revoked',
]);

type ProviderPayload = Record<string, unknown>;

export class TikTokOAuthError extends Error {
    readonly operation: 'exchange' | 'refresh' | 'revoke' | 'user_info';
    readonly providerCode: string | null;
    readonly httpStatus: number | null;
    readonly refreshCredentialInvalid: boolean;

    constructor(input: {
        operation: TikTokOAuthError['operation'];
        message: string;
        providerCode?: string | null;
        httpStatus?: number | null;
        refreshCredentialInvalid?: boolean;
    }) {
        super(input.message);
        this.name = 'TikTokOAuthError';
        this.operation = input.operation;
        this.providerCode = input.providerCode ?? null;
        this.httpStatus = input.httpStatus ?? null;
        this.refreshCredentialInvalid = input.refreshCredentialInvalid === true;
    }
}

export function isTikTokRefreshCredentialInvalid(error: unknown): boolean {
    return error instanceof TikTokOAuthError
        && error.operation === 'refresh'
        && error.refreshCredentialInvalid;
}

function asRecord(value: unknown): ProviderPayload | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as ProviderPayload
        : null;
}

function nonBlankString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveSafeInteger(value: unknown): number | null {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value > 0
        ? value
        : null;
}

async function readJson(
    response: Response,
    operation: TikTokOAuthError['operation']
): Promise<ProviderPayload> {
    try {
        const payload = asRecord(await response.json());
        if (!payload) throw new Error('not an object');
        return payload;
    } catch {
        throw new TikTokOAuthError({
            operation,
            message: `TikTok ${operation} returned an invalid response.`,
            httpStatus: response.status,
        });
    }
}

function providerErrorCode(payload: ProviderPayload): string | null {
    if (typeof payload.error === 'string') return payload.error.trim() || null;
    const error = asRecord(payload.error);
    return nonBlankString(error?.code);
}

function assertNoProviderError(
    payload: ProviderPayload,
    operation: TikTokOAuthError['operation'],
    httpStatus: number
): void {
    const code = providerErrorCode(payload);
    const legacyError = asRecord(payload.error);
    const acceptedLegacy = legacyError && legacyError.code === 'ok';
    if (httpStatus >= 200 && httpStatus < 300 && (!code || acceptedLegacy)) return;

    throw new TikTokOAuthError({
        operation,
        message: `TikTok ${operation} request was rejected${code ? ` (${code})` : ''}.`,
        providerCode: code,
        httpStatus,
        refreshCredentialInvalid: operation === 'refresh'
            && code !== null
            && INVALID_REFRESH_CODES.has(code.toLowerCase()),
    });
}

function assertTokenPayload<T extends TikTokTokenResponse | TikTokRefreshTokenResponse>(
    payload: ProviderPayload,
    operation: 'exchange' | 'refresh'
): T {
    const accessToken = nonBlankString(payload.access_token);
    const refreshToken = nonBlankString(payload.refresh_token);
    const openId = nonBlankString(payload.open_id);
    const tokenType = nonBlankString(payload.token_type);
    const expiresIn = positiveSafeInteger(payload.expires_in);
    const refreshExpiresIn = positiveSafeInteger(payload.refresh_expires_in);
    if (
        !accessToken
        || !refreshToken
        || !openId
        || !tokenType
        || tokenType.toLowerCase() !== 'bearer'
        || !expiresIn
        || !refreshExpiresIn
        || (payload.scope !== undefined && typeof payload.scope !== 'string')
    ) {
        throw new TikTokOAuthError({
            operation,
            message: `TikTok ${operation} returned an invalid token response.`,
        });
    }
    return {
        access_token: accessToken,
        refresh_token: refreshToken,
        open_id: openId,
        token_type: 'Bearer',
        expires_in: expiresIn,
        refresh_expires_in: refreshExpiresIn,
        scope: typeof payload.scope === 'string' ? payload.scope : '',
    } as T;
}

export function getTikTokOAuthConfig() {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI;
    if (!clientKey || !clientSecret || !redirectUri) {
        throw new Error('TikTok OAuth configuration is incomplete. Please check environment variables.');
    }
    return {
        clientKey,
        clientSecret,
        redirectUri,
        scopes: getTikTokOAuthScopes(),
    };
}

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(codeVerifier).digest();
    return { codeVerifier, codeChallenge: hash.toString('base64url') };
}

export function generateState(): string {
    return crypto.randomBytes(16).toString('hex');
}

export function buildAuthorizationUrl(userId: string) {
    const config = getTikTokOAuthConfig();
    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = `${generateState()}_${userId}`;
    const params = new URLSearchParams({
        client_key: config.clientKey,
        scope: config.scopes.join(','),
        response_type: 'code',
        redirect_uri: config.redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        disable_auto_auth: '1',
    });
    return { authUrl: `${TIKTOK_AUTH_URL}?${params.toString()}`, state, codeVerifier };
}

export async function exchangeCodeForToken(
    code: string,
    codeVerifier?: string | null,
    redirectUriOverride?: string | null,
    options?: { omitRedirectUri?: boolean }
): Promise<TikTokTokenResponse> {
    const config = getTikTokOAuthConfig();
    const body = new URLSearchParams({
        client_key: config.clientKey,
        client_secret: config.clientSecret,
        code,
        grant_type: 'authorization_code',
    });
    if (!options?.omitRedirectUri) body.set('redirect_uri', redirectUriOverride || config.redirectUri);
    if (codeVerifier) body.set('code_verifier', codeVerifier);

    const response = await fetch(TIKTOK_TOKEN_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(TIKTOK_OAUTH_TIMEOUT_MS),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cache-Control': 'no-cache',
        },
        body,
    });
    const payload = await readJson(response, 'exchange');
    assertNoProviderError(payload, 'exchange', response.status);
    return assertTokenPayload<TikTokTokenResponse>(payload, 'exchange');
}

export async function refreshAccessToken(
    refreshToken: string
): Promise<TikTokRefreshTokenResponse> {
    if (
        isTikTokMockCredential(refreshToken)
        && (process.env.NODE_ENV !== 'production' || isTikTokTestMockEnabled())
    ) {
        return {
            access_token: refreshToken.replace(/^mock-refresh/, 'mock-access').replace(/^seed-refresh/, 'seed-access'),
            refresh_token: refreshToken,
            expires_in: 86400,
            open_id: `local-${refreshToken.slice(-12)}`,
            refresh_expires_in: 60 * 24 * 60 * 60,
            token_type: 'Bearer',
            scope: getTikTokOAuthScopes().join(','),
        };
    }

    const config = getTikTokOAuthConfig();
    const response = await fetch(TIKTOK_TOKEN_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(TIKTOK_REFRESH_TIMEOUT_MS),
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cache-Control': 'no-cache',
        },
        body: new URLSearchParams({
            client_key: config.clientKey,
            client_secret: config.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });
    const payload = await readJson(response, 'refresh');
    assertNoProviderError(payload, 'refresh', response.status);
    return assertTokenPayload<TikTokRefreshTokenResponse>(payload, 'refresh');
}

export async function revokeAccessToken(accessToken: string): Promise<void> {
    const config = getTikTokOAuthConfig();
    const response = await fetch(TIKTOK_REVOKE_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(TIKTOK_OAUTH_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_key: config.clientKey,
            client_secret: config.clientSecret,
            token: accessToken,
        }),
    });
    if (response.ok) {
        // TikTok deployments have returned both an empty success body and an
        // error-envelope success body. Timeout/status remain strict.
        try {
            const payload = asRecord(await response.json());
            if (payload) assertNoProviderError(payload, 'revoke', response.status);
        } catch (error) {
            if (error instanceof TikTokOAuthError) throw error;
        }
        return;
    }
    const payload = await readJson(response, 'revoke');
    assertNoProviderError(payload, 'revoke', response.status);
}

export async function getUserInfo(accessToken: string): Promise<TikTokUserInfo> {
    const fields = [
        'open_id',
        'union_id',
        'avatar_url',
        'avatar_url_100',
        'display_name',
        'follower_count',
        'following_count',
        'likes_count',
        'video_count',
    ].join(',');
    const response = await fetch(`${TIKTOK_USER_INFO_URL}?fields=${fields}`, {
        method: 'GET',
        signal: AbortSignal.timeout(TIKTOK_OAUTH_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await readJson(response, 'user_info');
    assertNoProviderError(payload, 'user_info', response.status);
    const errorEnvelope = asRecord(payload.error);
    const user = asRecord(asRecord(payload.data)?.user);
    const openId = nonBlankString(user?.open_id);
    if (
        !errorEnvelope
        || errorEnvelope.code !== 'ok'
        || !user
        || !openId
        || (user.display_name !== undefined && typeof user.display_name !== 'string')
    ) {
        throw new TikTokOAuthError({
            operation: 'user_info',
            message: 'TikTok user_info returned an invalid response.',
        });
    }
    return { ...user, open_id: openId } as TikTokUserInfo;
}

export function calculateTokenExpiration(expiresIn: number): Date {
    return new Date(Date.now() + expiresIn * 1000);
}

export function isTokenExpired(expiresAt: Date): boolean {
    return Date.now() >= expiresAt.getTime() - 5 * 60 * 1000;
}
