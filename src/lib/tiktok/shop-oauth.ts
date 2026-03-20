// TikTok Shop OAuth 2.0 Implementation
// ⚠️ Shop OAuth is FUNDAMENTALLY different from Content API OAuth:
//   - No PKCE (no code_verifier / code_challenge)
//   - Authorization URL uses service_id, not client_key
//   - Token exchange is GET (not POST)
//   - No scope parameter in authorization URL (configured in Partner Center)
//   - access_token_expire_in is Unix timestamp, not duration

import crypto from 'crypto';
import type { ShopOAuthConfig, ShopTokenResponse } from './shop-types';

// ============================================================
// TikTok Shop API Endpoints
// ============================================================

// ⚠️ US market: tiktokshops.us (note the extra "s")
// Other regions: tiktokshop.com (no "s")
const SHOP_AUTH_URL_US = 'https://services.tiktokshops.us/open/authorize';
const SHOP_AUTH_URL_GLOBAL = 'https://services.tiktokshop.com/open/authorize';

// Token endpoints — same for all regions
const SHOP_TOKEN_URL = 'https://auth.tiktok-shops.com/api/v2/token/get';
const SHOP_REFRESH_URL = 'https://auth.tiktok-shops.com/api/v2/token/refresh';

// ============================================================
// Configuration
// ============================================================

/**
 * Read Shop OAuth configuration from environment variables.
 * ⚠️ These are DIFFERENT from Content API env vars (TIKTOK_CLIENT_KEY etc.)
 */
export function getShopOAuthConfig(): ShopOAuthConfig {
    const appKey = process.env.TIKTOK_SHOP_APP_KEY;
    const appSecret = process.env.TIKTOK_SHOP_APP_SECRET;
    const redirectUri = process.env.TIKTOK_SHOP_REDIRECT_URI;
    const serviceId = process.env.TIKTOK_SHOP_SERVICE_ID;

    if (!appKey || !appSecret || !redirectUri || !serviceId) {
        throw new Error(
            'TikTok Shop OAuth configuration is incomplete. ' +
            'Required: TIKTOK_SHOP_APP_KEY, TIKTOK_SHOP_APP_SECRET, ' +
            'TIKTOK_SHOP_REDIRECT_URI, TIKTOK_SHOP_SERVICE_ID'
        );
    }

    return { appKey, appSecret, redirectUri, serviceId };
}

// ============================================================
// State Generation (CSRF Protection)
// ============================================================

/**
 * Generate a cryptographically secure state parameter.
 * Embeds userId for post-callback association.
 */
function generateState(userId: string): string {
    const randomHex = crypto.randomBytes(16).toString('hex');
    return `${randomHex}_${userId}`;
}

/**
 * Extract userId from a state parameter.
 */
export function extractUserIdFromState(state: string): string | null {
    const parts = state.split('_');
    // State format: {32-char hex}_{userId}
    if (parts.length < 2) return null;
    return parts.slice(1).join('_'); // userId may contain underscores
}

// ============================================================
// Authorization URL
// ============================================================

/**
 * Build the Shop OAuth authorization URL for US market.
 *
 * Key differences from Content API:
 * - Uses service_id (≠ app_key!) — this is the App ID from Partner Center
 * - No scope parameter — scopes are configured in Partner Center
 * - No PKCE — returns { authUrl, state } only (no codeVerifier)
 *
 * @returns { authUrl, state } — state must be saved to tiktok_auth_states
 */
export function buildShopAuthorizationUrl(userId: string): {
    authUrl: string;
    state: string;
} {
    const config = getShopOAuthConfig();
    const state = generateState(userId);

    const params = new URLSearchParams({
        service_id: config.serviceId,
        state: state,
        redirect_uri: config.redirectUri,
    });

    // US market — our app is registered for US
    const authUrl = `${SHOP_AUTH_URL_US}?${params.toString()}`;

    return { authUrl, state };
}

// ============================================================
// Token Exchange
// ============================================================

/**
 * Exchange an authorization code for access + refresh tokens.
 *
 * ⚠️ CRITICAL DIFFERENCES from Content API:
 * 1. This is a GET request (not POST!)
 * 2. Parameters go in query string (not form body)
 * 3. The callback URL parameter is named `code`,
 *    but the API parameter is named `auth_code` — we handle the mapping here
 * 4. auth_code is valid for 30 minutes and can only be used ONCE
 *
 * @param authCode - The `code` parameter from the OAuth callback URL
 */
export async function exchangeShopCodeForToken(
    authCode: string
): Promise<ShopTokenResponse> {
    const config = getShopOAuthConfig();

    const params = new URLSearchParams({
        app_key: config.appKey,
        app_secret: config.appSecret,
        auth_code: authCode, // ⚠️ Mapped from callback's `code` to API's `auth_code`
        grant_type: 'authorized_code',
    });

    const url = `${SHOP_TOKEN_URL}?${params.toString()}`;

    const response = await fetch(url, {
        method: 'GET', // ⚠️ GET, not POST!
        headers: {
            'Cache-Control': 'no-cache',
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to exchange Shop auth code for token: ${errorText}`);
    }

    const data = await response.json();

    if (data.code !== 0) {
        throw new Error(
            `TikTok Shop token exchange error [${data.code}]: ${data.message}`
        );
    }

    return data.data as ShopTokenResponse;
}

// ============================================================
// Token Refresh
// ============================================================

/**
 * Refresh an expired access token using the refresh token.
 *
 * ⚠️ Same pattern as token exchange: GET request with query params
 * ⚠️ The refresh_token itself has an expiry (not infinite!) —
 *    check isRefreshTokenExpired() before calling this
 *
 * @param refreshToken - The refresh_token from previous token response
 */
export async function refreshShopAccessToken(
    refreshToken: string
): Promise<ShopTokenResponse> {
    const config = getShopOAuthConfig();

    const params = new URLSearchParams({
        app_key: config.appKey,
        app_secret: config.appSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    });

    const url = `${SHOP_REFRESH_URL}?${params.toString()}`;

    const response = await fetch(url, {
        method: 'GET', // ⚠️ GET, not POST!
        headers: {
            'Cache-Control': 'no-cache',
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to refresh Shop access token: ${errorText}`);
    }

    const data = await response.json();

    if (data.code !== 0) {
        throw new Error(
            `TikTok Shop token refresh error [${data.code}]: ${data.message}`
        );
    }

    return data.data as ShopTokenResponse;
}

// ============================================================
// Token Expiration Utilities
// ============================================================

/**
 * Convert Shop API's expire_in (Unix timestamp) to a Date.
 *
 * ⚠️ CRITICAL: Shop API returns Unix timestamps, NOT duration in seconds!
 * Content API returns `expires_in` as duration (seconds from now).
 * Shop API returns `access_token_expire_in` as an absolute Unix timestamp.
 *
 * DO NOT use the Content API pattern: `new Date(Date.now() + expiresIn * 1000)`
 * Instead: `new Date(expireIn * 1000)`
 */
export function calculateShopTokenExpiration(expireIn: number): Date {
    return new Date(expireIn * 1000);
}

/**
 * Check if an access token is expired (with 5-minute safety buffer).
 * Returns true if the token should be refreshed.
 */
export function isShopTokenExpired(expiresAt: Date | string): boolean {
    const expiresAtDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    return Date.now() >= expiresAtDate.getTime() - bufferMs;
}

/**
 * Check if a refresh token is expired.
 * When expired, the user must re-authorize (full OAuth flow again).
 *
 * ⚠️ Refresh tokens are NOT infinite — they expire based on the
 * authorization duration set by the seller/creator.
 */
export function isRefreshTokenExpired(refreshExpiresAt: Date | string | null): boolean {
    if (!refreshExpiresAt) return false; // If not set, assume valid
    const expiresAtDate = typeof refreshExpiresAt === 'string'
        ? new Date(refreshExpiresAt)
        : refreshExpiresAt;
    return Date.now() >= expiresAtDate.getTime();
}
