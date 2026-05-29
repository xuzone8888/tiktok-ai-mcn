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
