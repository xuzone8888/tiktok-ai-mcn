import crypto from 'crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export type TikTokAuthFlow = 'web' | 'qr';

export interface ClaimedTikTokAuthState {
    user_id: string;
    code_verifier: string | null;
    client_ticket: string | null;
    qr_token: string | null;
    expires_at: string;
}

const AUTH_PROCESSING_LEASE_SECONDS = 120;

export function newTikTokAuthProcessingToken(): string {
    return crypto.randomUUID();
}

export async function claimTikTokAuthState(
    supabase: SupabaseClient<Database>,
    input: {
        state: string;
        flowType: TikTokAuthFlow;
        userId: string | null;
        processingToken: string;
    }
): Promise<ClaimedTikTokAuthState | null> {
    const { data, error } = await supabase.rpc('claim_tiktok_auth_state', {
        p_state: input.state,
        p_flow_type: input.flowType,
        p_user_id: input.userId,
        p_processing_token: input.processingToken,
        p_lease_seconds: AUTH_PROCESSING_LEASE_SECONDS,
    });
    if (error) {
        throw new Error('TikTok authorization state claim failed.');
    }
    return data?.[0] ?? null;
}

export async function completeTikTokAuthState(
    supabase: SupabaseClient<Database>,
    input: {
        state: string;
        flowType: TikTokAuthFlow;
        userId: string | null;
        processingToken: string;
    }
): Promise<boolean> {
    const { data, error } = await supabase.rpc('complete_tiktok_auth_state', {
        p_state: input.state,
        p_flow_type: input.flowType,
        p_user_id: input.userId,
        p_processing_token: input.processingToken,
    });
    if (error) {
        throw new Error('TikTok authorization completion failed.');
    }
    return data === true;
}

export async function failTikTokAuthState(
    supabase: SupabaseClient<Database>,
    input: {
        state: string;
        flowType: TikTokAuthFlow;
        userId: string | null;
        processingToken: string;
        errorCode: string;
        errorMessage: string;
    }
): Promise<boolean> {
    const { data, error } = await supabase.rpc('fail_tiktok_auth_state', {
        p_state: input.state,
        p_flow_type: input.flowType,
        p_user_id: input.userId,
        p_processing_token: input.processingToken,
        p_error_code: input.errorCode,
        p_error_message: input.errorMessage,
    });
    if (error) {
        throw new Error('TikTok authorization failure persistence failed.');
    }
    return data === true;
}

export async function expireTikTokAuthState(
    supabase: SupabaseClient<Database>,
    input: {
        state: string;
        flowType: TikTokAuthFlow;
        userId: string | null;
    }
): Promise<boolean> {
    const { data, error } = await supabase.rpc('expire_tiktok_auth_state', {
        p_state: input.state,
        p_flow_type: input.flowType,
        p_user_id: input.userId,
    });
    if (error) {
        throw new Error('TikTok authorization expiry persistence failed.');
    }
    return data === true;
}
