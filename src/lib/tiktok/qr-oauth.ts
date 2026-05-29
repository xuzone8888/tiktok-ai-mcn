import crypto from 'crypto';

import QRCode from 'qrcode';

import { getTikTokOAuthConfig } from '@/lib/tiktok/oauth';

const TIKTOK_QR_GET_URL = 'https://open.tiktokapis.com/v2/oauth/get_qrcode/';
const TIKTOK_QR_CHECK_URL = 'https://open.tiktokapis.com/v2/oauth/check_qrcode/';

export type TikTokQrStatus = 'new' | 'scanned' | 'confirmed' | 'expired' | 'utilised';

export interface TikTokQrCodeStart {
    scanUrl: string;
    qrImageDataUrl: string;
    token: string;
    clientTicket: string;
}

export interface TikTokQrCodeStatus {
    status: TikTokQrStatus;
    client_ticket?: string;
    redirect_uri?: string;
    code?: string;
    error?: string;
    error_description?: string;
    log_id?: string;
}

function generateClientTicket() {
    return crypto.randomBytes(18).toString('base64url');
}

function withClientTicket(scanUrl: string, clientTicket: string) {
    const url = new URL(scanUrl);
    url.searchParams.set('client_ticket', clientTicket);
    return url.toString();
}

export async function requestTikTokQrCode(state: string): Promise<TikTokQrCodeStart> {
    const config = getTikTokOAuthConfig();

    const response = await fetch(TIKTOK_QR_GET_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_key: config.clientKey,
            scope: config.scopes.join(','),
            state,
        }),
    });

    const data = await response.json();
    if (!response.ok || data.error) {
        throw new Error(data.error_description || data.error || `Failed to get TikTok QR code: ${response.status}`);
    }

    if (!data.scan_qrcode_url || !data.token) {
        throw new Error('TikTok QR code response is missing scan URL or token.');
    }

    const clientTicket = generateClientTicket();
    const scanUrl = withClientTicket(data.scan_qrcode_url, clientTicket);
    const qrImageDataUrl = await QRCode.toDataURL(scanUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 280,
    });

    return {
        scanUrl,
        qrImageDataUrl,
        token: data.token,
        clientTicket,
    };
}

export async function checkTikTokQrCode(token: string): Promise<TikTokQrCodeStatus> {
    const config = getTikTokOAuthConfig();

    const response = await fetch(TIKTOK_QR_CHECK_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_key: config.clientKey,
            client_secret: config.clientSecret,
            token,
        }),
    });

    const data = await response.json();
    if (!response.ok || data.error) {
        throw new Error(data.error_description || data.error || `Failed to check TikTok QR status: ${response.status}`);
    }

    return data as TikTokQrCodeStatus;
}

export function extractAuthorizationCodeFromQrStatus(status: TikTokQrCodeStatus) {
    if (status.code) {
        try {
            const url = new URL(status.code);
            const code = url.searchParams.get('code');
            if (code) {
                return code;
            }
        } catch {
            // TikTok may return either a raw code or a callback URL in this field.
        }

        return status.code;
    }

    if (!status.redirect_uri) {
        return null;
    }

    try {
        const url = new URL(status.redirect_uri);
        return url.searchParams.get('code');
    } catch {
        return null;
    }
}

export function extractRedirectUriFromQrStatus(status: TikTokQrCodeStatus) {
    const rawRedirectUri = status.redirect_uri || status.code;
    if (!rawRedirectUri) {
        return null;
    }

    if (!/^https?:\/\//i.test(rawRedirectUri)) {
        return null;
    }

    // Preserve TikTok's exact redirect URI string. URL.toString() can normalize
    // https://example.com?code=... into https://example.com/, and TikTok checks
    // redirect_uri by exact match during token exchange.
    const queryIndex = rawRedirectUri.indexOf('?');
    const hashIndex = rawRedirectUri.indexOf('#');
    const endIndex = [queryIndex, hashIndex].filter(index => index >= 0).sort((a, b) => a - b)[0];
    return (endIndex === undefined ? rawRedirectUri : rawRedirectUri.slice(0, endIndex)) || null;
}

export function summarizeQrAuthorizationStatus(status: TikTokQrCodeStatus) {
    const rawRedirectUri = status.redirect_uri || status.code || '';
    const redirectUri = extractRedirectUriFromQrStatus(status);
    let redirectHost: string | null = null;
    let redirectPath: string | null = null;

    if (redirectUri) {
        try {
            const url = new URL(redirectUri);
            redirectHost = url.host;
            redirectPath = url.pathname;
        } catch {
            redirectHost = null;
            redirectPath = null;
        }
    }

    return {
        status: status.status,
        hasCode: !!extractAuthorizationCodeFromQrStatus(status),
        codeLooksLikeUrl: /^https?:\/\//i.test(status.code || ''),
        hasRedirectUri: !!status.redirect_uri,
        rawRedirectLooksLikeUrl: /^https?:\/\//i.test(rawRedirectUri),
        redirectHost,
        redirectPath,
        redirectUriLength: redirectUri?.length || 0,
        rawRedirectLength: rawRedirectUri.length,
        logId: status.log_id || null,
    };
}
