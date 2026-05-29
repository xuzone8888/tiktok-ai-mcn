import crypto from 'crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

import type { Database } from '@/types/database';

export type TikTokAuthFlowType = 'web' | 'qr';

export interface TikTokAuthRequestDiagnostics {
    ipHash: string | null;
    userAgentHash: string | null;
}

export interface TikTokAuthCooldownResult {
    allowed: boolean;
    diagnostics: TikTokAuthRequestDiagnostics;
    retryAfterSeconds?: number;
    message?: string;
    reason?: 'user_recent' | 'user_window' | 'client_window';
}

const USER_MIN_INTERVAL_SECONDS = 60;
const USER_WINDOW_SECONDS = 10 * 60;
const USER_WINDOW_MAX_ATTEMPTS = 5;
const CLIENT_WINDOW_SECONDS = 10 * 60;
const CLIENT_WINDOW_MAX_ATTEMPTS = 8;

function getDiagnosticSalt() {
    return (
        process.env.TIKTOK_AUTH_DIAGNOSTIC_SALT
        || process.env.NEXTAUTH_SECRET
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.TIKTOK_CLIENT_SECRET
        || 'tokfactory-tiktok-auth-diagnostics'
    );
}

function hashDiagnosticValue(value: string | null) {
    if (!value) return null;
    return crypto
        .createHmac('sha256', getDiagnosticSalt())
        .update(value)
        .digest('hex');
}

function getClientIp(request: NextRequest) {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
        return forwarded.split(',')[0]?.trim() || null;
    }

    return (
        request.headers.get('x-real-ip')
        || request.headers.get('cf-connecting-ip')
        || null
    );
}

export function getTikTokAuthRequestDiagnostics(request: NextRequest): TikTokAuthRequestDiagnostics {
    const userAgent = request.headers.get('user-agent');

    return {
        ipHash: hashDiagnosticValue(getClientIp(request)),
        userAgentHash: hashDiagnosticValue(userAgent),
    };
}

function retryAfterFromOldest(createdAt: string, windowSeconds: number) {
    const elapsedSeconds = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
    return Math.max(1, windowSeconds - elapsedSeconds);
}

function userFacingCooldownMessage(seconds: number) {
    if (seconds < 90) {
        return `授权请求过于频繁，请等待 ${seconds} 秒后再试。`;
    }

    return `授权请求过于频繁，请等待约 ${Math.ceil(seconds / 60)} 分钟后再试。`;
}

export async function cleanupTikTokAuthDiagnostics(
    supabase: SupabaseClient<Database>
) {
    await supabase
        .from('tiktok_auth_states')
        .update({
            status: 'expired',
            error_code: 'expired',
            error_message: 'Authorization session expired.',
            code_verifier: null,
            client_ticket: null,
            qr_token: null,
        })
        .eq('status', 'pending')
        .lt('expires_at', new Date().toISOString());

    await supabase
        .from('tiktok_auth_states')
        .delete()
        .in('status', ['completed', 'failed', 'expired'])
        .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
}

export async function enforceTikTokAuthCooldown(
    supabase: SupabaseClient<Database>,
    userId: string,
    request: NextRequest,
    _flowType: TikTokAuthFlowType
): Promise<TikTokAuthCooldownResult> {
    const diagnostics = getTikTokAuthRequestDiagnostics(request);
    await cleanupTikTokAuthDiagnostics(supabase);

    const tenMinutesAgo = new Date(Date.now() - USER_WINDOW_SECONDS * 1000).toISOString();
    const { data: userAttempts, error: userError } = await supabase
        .from('tiktok_auth_states')
        .select('created_at')
        .eq('user_id', userId)
        .in('flow_type', ['web', 'qr'])
        .gte('created_at', tenMinutesAgo)
        .order('created_at', { ascending: false })
        .limit(USER_WINDOW_MAX_ATTEMPTS + 1);

    if (userError) {
        console.warn('[TikTok Auth] Cooldown user lookup failed:', userError.message);
    }

    const newestUserAttempt = userAttempts?.[0];
    if (newestUserAttempt) {
        const elapsedSeconds = Math.floor((Date.now() - new Date(newestUserAttempt.created_at).getTime()) / 1000);
        if (elapsedSeconds < USER_MIN_INTERVAL_SECONDS) {
            const retryAfterSeconds = USER_MIN_INTERVAL_SECONDS - elapsedSeconds;
            return {
                allowed: false,
                diagnostics,
                retryAfterSeconds,
                message: userFacingCooldownMessage(retryAfterSeconds),
                reason: 'user_recent',
            };
        }
    }

    if ((userAttempts?.length || 0) >= USER_WINDOW_MAX_ATTEMPTS) {
        const oldest = userAttempts![userAttempts!.length - 1];
        const retryAfterSeconds = retryAfterFromOldest(oldest.created_at, USER_WINDOW_SECONDS);
        return {
            allowed: false,
            diagnostics,
            retryAfterSeconds,
            message: userFacingCooldownMessage(retryAfterSeconds),
            reason: 'user_window',
        };
    }

    if (diagnostics.ipHash && diagnostics.userAgentHash) {
        const clientWindowAgo = new Date(Date.now() - CLIENT_WINDOW_SECONDS * 1000).toISOString();
        const { data: clientAttempts, error: clientError } = await supabase
            .from('tiktok_auth_states')
            .select('created_at')
            .eq('ip_hash', diagnostics.ipHash)
            .eq('user_agent_hash', diagnostics.userAgentHash)
            .in('flow_type', ['web', 'qr'])
            .gte('created_at', clientWindowAgo)
            .order('created_at', { ascending: false })
            .limit(CLIENT_WINDOW_MAX_ATTEMPTS + 1);

        if (clientError) {
            console.warn('[TikTok Auth] Cooldown client lookup failed:', clientError.message);
        }

        if ((clientAttempts?.length || 0) >= CLIENT_WINDOW_MAX_ATTEMPTS) {
            const oldest = clientAttempts![clientAttempts!.length - 1];
            const retryAfterSeconds = retryAfterFromOldest(oldest.created_at, CLIENT_WINDOW_SECONDS);
            return {
                allowed: false,
                diagnostics,
                retryAfterSeconds,
                message: userFacingCooldownMessage(retryAfterSeconds),
                reason: 'client_window',
            };
        }
    }

    return {
        allowed: true,
        diagnostics,
    };
}

export function buildTikTokAuthCooldownResponse(result: TikTokAuthCooldownResult) {
    const retryAfterSeconds = Math.max(1, result.retryAfterSeconds || USER_MIN_INTERVAL_SECONDS);

    return {
        body: {
            error: result.message || userFacingCooldownMessage(retryAfterSeconds),
            error_type: 'auth_cooldown',
            retry_after_seconds: retryAfterSeconds,
            reason: result.reason,
        },
        headers: {
            'Retry-After': String(retryAfterSeconds),
        },
    };
}
