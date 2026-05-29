// TikTok OAuth 2.0 Implementation

import crypto from 'crypto';

import { isTikTokMockCredential, isTikTokTestMockEnabled } from './test-mock';
import { TikTokTokenResponse, TikTokRefreshTokenResponse, TikTokUserInfo, TikTokUserInfoResponse } from './types';

// TikTok API endpoints
const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

// OAuth configuration
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
        scopes: [
            'user.info.basic',   // 获取头像、昵称（Login Kit 自带）
            'video.publish',     // 直接发布视频到用户主页
            'video.upload',      // 媒体传输（PULL_FROM_URL 也需要此 scope）
            'user.info.stats',   // 粉丝数、获赞数等统计数据
        ],
    };
}

// Generate PKCE code verifier and challenge
export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    // Generate a random 32-byte string for code verifier
    const codeVerifier = crypto.randomBytes(32).toString('base64url');

    // Generate SHA256 hash of verifier for code challenge
    const hash = crypto.createHash('sha256').update(codeVerifier).digest();
    const codeChallenge = hash.toString('base64url');

    return { codeVerifier, codeChallenge };
}

// Generate state parameter for CSRF protection
export function generateState(): string {
    return crypto.randomBytes(16).toString('hex');
}

// Build authorization URL
export function buildAuthorizationUrl(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
} {
    const config = getTikTokOAuthConfig();
    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = `${generateState()}_${userId}`;

    const params = new URLSearchParams({
        client_key: config.clientKey,
        scope: config.scopes.join(','),
        response_type: 'code',
        redirect_uri: config.redirectUri,
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        disable_auto_auth: '1',
    });

    const authUrl = `${TIKTOK_AUTH_URL}?${params.toString()}`;

    return { authUrl, state, codeVerifier };
}

// Exchange authorization code for access token
export async function exchangeCodeForToken(
    code: string,
    codeVerifier?: string | null,
    redirectUriOverride?: string | null
): Promise<TikTokTokenResponse> {
    const config = getTikTokOAuthConfig();
    const redirectUri = redirectUriOverride || config.redirectUri;
    const body = new URLSearchParams({
        client_key: config.clientKey,
        client_secret: config.clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
    });

    if (codeVerifier) {
        body.set('code_verifier', codeVerifier);
    }

    const response = await fetch(TIKTOK_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cache-Control': 'no-cache',
        },
        body,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to exchange code for token: ${errorText}`);
    }

    const data = await response.json();

    // Handle v2 API error format: { error: "error_code", error_description: "..." }
    if (typeof data.error === 'string') {
        throw new Error(`TikTok OAuth error: ${data.error} - ${data.error_description || 'no description'}`);
    }

    // Handle legacy error format: { error: { code: "...", message: "..." } }
    if (data.error && data.error.code !== 'ok') {
        throw new Error(`TikTok OAuth error: ${data.error.code} - ${data.error.message}`);
    }

    return data as TikTokTokenResponse;
}

// Refresh access token
export async function refreshAccessToken(
    refreshToken: string
): Promise<TikTokRefreshTokenResponse> {
    if (
        isTikTokMockCredential(refreshToken)
        && (
            process.env.NODE_ENV !== 'production'
            || isTikTokTestMockEnabled()
        )
    ) {
        return {
            access_token: refreshToken.replace(/^mock-refresh/, 'mock-access').replace(/^seed-refresh/, 'seed-access'),
            refresh_token: refreshToken,
            expires_in: 86400,
            open_id: `local-${refreshToken.slice(-12)}`,
            refresh_expires_in: 60 * 24 * 60 * 60,
            token_type: 'Bearer',
            scope: 'user.info.basic,video.upload,video.publish,user.info.stats',
        }
    }

    const config = getTikTokOAuthConfig();

    const response = await fetch(TIKTOK_TOKEN_URL, {
        method: 'POST',
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

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to refresh token: ${errorText}`);
    }

    const data = await response.json();

    if (data.error && data.error.code !== 'ok') {
        throw new Error(`TikTok refresh error: ${data.error.message}`);
    }

    return data as TikTokRefreshTokenResponse;
}

// Revoke access token
export async function revokeAccessToken(accessToken: string): Promise<void> {
    const config = getTikTokOAuthConfig();

    const response = await fetch(TIKTOK_REVOKE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_key: config.clientKey,
            client_secret: config.clientSecret,
            token: accessToken,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to revoke token: ${errorText}`);
    }
}

// Get user info
export async function getUserInfo(accessToken: string): Promise<TikTokUserInfo> {
    const fields = [
        'open_id',
        'union_id',
        'avatar_url',
        'avatar_url_100',
        'display_name',
        // 以下字段需要 user.info.profile 权限（未申请，不影响核心功能）：
        // 'bio_description',
        // 'profile_deep_link',
        // 'is_verified',
        // 'username',
        // 以下字段需要 user.info.stats 权限（已授权）：
        'follower_count',
        'following_count',
        'likes_count',
        'video_count',
    ].join(',');

    const response = await fetch(`${TIKTOK_USER_INFO_URL}?fields=${fields}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get user info: ${errorText}`);
    }

    const data: TikTokUserInfoResponse = await response.json();

    if (data.error && data.error.code !== 'ok') {
        throw new Error(`TikTok API error: ${data.error.message}`);
    }

    return data.data.user;
}

// Calculate token expiration time
export function calculateTokenExpiration(expiresIn: number): Date {
    return new Date(Date.now() + expiresIn * 1000);
}

// Check if token is expired (with 5 minute buffer)
export function isTokenExpired(expiresAt: Date): boolean {
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    return new Date().getTime() >= expiresAt.getTime() - bufferMs;
}
