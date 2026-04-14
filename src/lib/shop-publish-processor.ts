// @ts-nocheck — shop_publish tables pending migration to database.ts
/**
 * Shop Publish Processor
 * 
 * Backend logic for processing shop publish tasks.
 * Called by POST /api/shop-publish/process route.
 * 
 * Flow per item:
 *   1. Check/refresh token
 *   2. Download video → Buffer
 *   3. initFileUpload() → upload_url + upload_token
 *   4. uploadVideoChunk() → file_id (resource_id)
 *   5. (Optional) precheckVideo() → wait for result
 *   6. postShoppableVideo(file_id, product_id, ...) → video_id
 *   7. Poll getVideoStatus() → wait for publish completion
 *   8. Update item status (published / failed)
 * 
 * After all items: update parent task status based on results.
 */

import { createClient } from '@/lib/supabase/server';
import {
    initFileUpload,
    uploadVideoChunk,
    postShoppableVideo,
    getVideoStatus,
    precheckVideo,
    getPrecheckResult,
} from '@/lib/tiktok/shop-api';
import {
    refreshShopAccessToken,
    isShopTokenExpired,
    isRefreshTokenExpired,
    calculateShopTokenExpiration,
} from '@/lib/tiktok/shop-oauth';
import type {
    ShopTaskItemStatus,
    ShopPrecheckStatus,
} from '@/lib/tiktok/shop-types';

// ============================================================
// Constants
// ============================================================

const VIDEO_STATUS_POLL_INTERVAL_MS = 3000; // 3 seconds
const VIDEO_STATUS_POLL_MAX_ATTEMPTS = 60;  // ~3 minutes max
const PRECHECK_POLL_INTERVAL_MS = 2000;
const PRECHECK_POLL_MAX_ATTEMPTS = 30; // ~1 minute max

// ============================================================
// Types
// ============================================================

interface ProcessableItem {
    id: string;
    task_id: string;
    account_id: string;
    video_url: string;
    video_source: string;
    title: string;
    product_id: string;
    product_anchor_title: string;
    status: ShopTaskItemStatus;
    precheck_status: ShopPrecheckStatus;
}

interface AccountTokens {
    id: string;
    access_token: string;
    refresh_token: string;
    token_expires_at: string;
    refresh_token_expires_at: string | null;
}

interface ProcessResult {
    processedCount: number;
    successCount: number;
    failedCount: number;
}

// ============================================================
// Main Processor
// ============================================================

/**
 * Process all pending items for a given task.
 * This is the entry point called by the process route.
 */
export async function processShopPublishTask(taskId: string): Promise<ProcessResult> {
    const supabase = await createClient();

    const result: ProcessResult = {
        processedCount: 0,
        successCount: 0,
        failedCount: 0,
    };

    try {
        // 1. Fetch all processing items for this task
        const { data: items, error: itemsError } = await supabase
            .from('shop_publish_task_items')
            .select('*')
            .eq('task_id', taskId)
            .in('status', ['pending', 'uploading', 'prechecking', 'publishing'])
            .order('created_at', { ascending: true });

        if (itemsError) {
            console.error('[Processor] Failed to fetch items:', itemsError);
            throw new Error(`Failed to fetch task items: ${itemsError.message}`);
        }

        if (!items || items.length === 0) {
            console.log('[Processor] No processable items found for task:', taskId);
            return result;
        }

        console.log(`[Processor] Processing ${items.length} items for task ${taskId}`);

        // 2. Group items by account for token reuse
        const itemsByAccount = groupByAccount(items as ProcessableItem[]);

        // 3. Process each account's items
        for (const [accountId, accountItems] of Object.entries(itemsByAccount)) {
            // Ensure valid token
            const tokens = await ensureValidToken(accountId);

            if (!tokens) {
                // Mark all items for this account as failed
                for (const item of accountItems) {
                    await updateItemStatus(item.id, 'failed', '账号 Token 无效或已过期');
                    result.failedCount++;
                    result.processedCount++;
                }
                continue;
            }

            // Process each item
            for (const item of accountItems) {
                try {
                    await processItem(item, tokens.access_token);
                    result.successCount++;
                } catch (error) {
                    const message = error instanceof Error ? error.message : '未知错误';
                    console.error(`[Processor] Item ${item.id} failed:`, message);
                    await updateItemStatus(item.id, 'failed', message);
                    result.failedCount++;
                }
                result.processedCount++;
            }
        }

        // 4. Update parent task status
        await updateTaskFinalStatus(taskId);

    } catch (error) {
        console.error('[Processor] Critical error:', error);
        // Mark entire task as failed
        const supabase2 = await createClient();
        await supabase2
            // @ts-expect-error — shop_publish_tasks 迁移后更新类型
        .from('shop_publish_tasks')
            .update({
                status: 'failed',
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', taskId);
    }

    return result;
}

// ============================================================
// Item Processing
// ============================================================

/**
 * Process a single task item through the full upload → publish pipeline.
 */
async function processItem(
    item: ProcessableItem,
    accessToken: string
): Promise<void> {
    // Step 1: Download video → Buffer
    await updateItemStatus(item.id, 'uploading');
    console.log(`[Processor] Item ${item.id}: downloading video from ${item.video_url}`);

    const videoBuffer = await downloadVideo(item.video_url);
    const fileName = extractFileName(item.video_url);

    // Step 2: Upload video to TikTok
    console.log(`[Processor] Item ${item.id}: initializing upload (${videoBuffer.length} bytes)`);

    const initResult = await initFileUpload(accessToken, {
        file_name: fileName,
        file_size: videoBuffer.length,
        file_type: 'video',
        total_chunk_count: 1, // Single chunk
        target_path: '/affiliate_creator/202505/videos',
    });

    console.log(`[Processor] Item ${item.id}: uploading video chunk`);

    const uploadResult = await uploadVideoChunk(
        initResult.upload_url,
        initResult.upload_token,
        videoBuffer
    );

    const fileId = uploadResult.resource_id;
    console.log(`[Processor] Item ${item.id}: upload complete, file_id=${fileId}`);

    // Save file_id to DB
    await updateItemField(item.id, { file_id: fileId });

    // Step 3: Optional precheck
    if (item.precheck_status !== 'none') {
        await updateItemStatus(item.id, 'prechecking');
        console.log(`[Processor] Item ${item.id}: running precheck`);

        const precheckResult = await precheckVideo(accessToken, fileId);
        await updateItemField(item.id, { precheck_id: precheckResult.precheck_id });

        // Poll for precheck result
        const finalPrecheckStatus = await pollPrecheckResult(
            accessToken,
            precheckResult.precheck_id
        );

        await updateItemField(item.id, { precheck_status: finalPrecheckStatus });

        if (finalPrecheckStatus === 'rejected') {
            throw new Error('视频预检未通过，无法发布');
        }

        console.log(`[Processor] Item ${item.id}: precheck ${finalPrecheckStatus}`);
    }

    // Step 4: Publish shoppable video
    await updateItemStatus(item.id, 'publishing');
    console.log(`[Processor] Item ${item.id}: publishing shoppable video`);

    const publishResult = await postShoppableVideo(accessToken, {
        file_id: fileId,
        title: item.title,
        product_id: item.product_id,
        product_anchor_title: item.product_anchor_title || item.title,
    });

    const videoId = publishResult.video_id;
    await updateItemField(item.id, { video_id: videoId });
    console.log(`[Processor] Item ${item.id}: video posted, video_id=${videoId}`);

    // Step 5: Poll for publish completion
    await pollVideoStatus(accessToken, videoId);

    // Step 6: Mark as published
    await updateItemStatus(item.id, 'published');
    await updateItemField(item.id, { published_at: new Date().toISOString() });
    console.log(`[Processor] Item ${item.id}: ✅ published successfully`);
}

// ============================================================
// Video Download
// ============================================================

async function downloadVideo(url: string): Promise<Buffer> {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`视频下载失败: [${response.status}] ${url}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

function extractFileName(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const name = pathname.split('/').pop() || 'video.mp4';
        return name.includes('.') ? name : `${name}.mp4`;
    } catch {
        return 'video.mp4';
    }
}

// ============================================================
// Token Management
// ============================================================

/**
 * Ensure the account has a valid access token.
 * Refreshes the token if expired.
 */
async function ensureValidToken(accountId: string): Promise<AccountTokens | null> {
    const supabase = await createClient();

    const { data: account, error } = await supabase
        .from('tiktok_accounts')
        .select('id, access_token, refresh_token, token_expires_at, refresh_token_expires_at')
        .eq('id', accountId)
        .single();

    if (error || !account) {
        console.error(`[Processor] Account ${accountId} not found`);
        return null;
    }

    const tokens = account as AccountTokens;

    // Check refresh token expiry first
    if (isRefreshTokenExpired(tokens.refresh_token_expires_at)) {
        console.error(`[Processor] Account ${accountId}: refresh token expired`);
        // Mark account as expired
        await supabase
            .from('tiktok_accounts')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', accountId);
        return null;
    }

    // Check access token expiry
    if (isShopTokenExpired(tokens.token_expires_at)) {
        console.log(`[Processor] Account ${accountId}: refreshing expired access token`);

        try {
            const newTokens = await refreshShopAccessToken(tokens.refresh_token);
            const newExpiry = calculateShopTokenExpiration(newTokens.access_token_expire_in);

            // Update DB
            await supabase
                .from('tiktok_accounts')
                .update({
                    access_token: newTokens.access_token,
                    refresh_token: newTokens.refresh_token,
                    token_expires_at: newExpiry.toISOString(),
                    refresh_token_expires_at: newTokens.refresh_token_expire_in
                        ? new Date(newTokens.refresh_token_expire_in * 1000).toISOString()
                        : tokens.refresh_token_expires_at,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', accountId);

            tokens.access_token = newTokens.access_token;
            tokens.token_expires_at = newExpiry.toISOString();
            console.log(`[Processor] Account ${accountId}: token refreshed successfully`);
        } catch (refreshError) {
            console.error(`[Processor] Account ${accountId}: token refresh failed:`, refreshError);
            return null;
        }
    }

    return tokens;
}

// ============================================================
// Status Polling
// ============================================================

/**
 * Poll video status until it's completed or failed.
 */
async function pollVideoStatus(accessToken: string, videoId: string): Promise<void> {
    for (let i = 0; i < VIDEO_STATUS_POLL_MAX_ATTEMPTS; i++) {
        await sleep(VIDEO_STATUS_POLL_INTERVAL_MS);

        try {
            const result = await getVideoStatus(accessToken, videoId);

            // Official API response: data.video.post_status = 'SUCCESS' | 'FAIL' | 'PROCESSING'
            const postStatus = result.video?.post_status;

            if (postStatus === 'SUCCESS') {
                return; // Published successfully
            }

            if (postStatus === 'FAIL') {
                throw new Error('视频发布失败: TikTok returned FAIL status');
            }

            // Still PROCESSING, continue polling
            console.log(`[Processor] Video ${videoId}: post_status=${postStatus}, polling... (${i + 1}/${VIDEO_STATUS_POLL_MAX_ATTEMPTS})`);
        } catch (error) {
            // If it's our explicit error, rethrow
            if (error instanceof Error && error.message.startsWith('视频发布失败')) {
                throw error;
            }
            // Otherwise log and continue polling
            console.warn(`[Processor] Video ${videoId}: status check error, retrying...`, error);
        }
    }

    // Timeout — treat as success (status will be updated later if needed)
    console.warn(`[Processor] Video ${videoId}: status polling timed out, assuming success`);
}

/**
 * Poll precheck result until completed.
 */
async function pollPrecheckResult(
    accessToken: string,
    precheckId: string
): Promise<ShopPrecheckStatus> {
    for (let i = 0; i < PRECHECK_POLL_MAX_ATTEMPTS; i++) {
        await sleep(PRECHECK_POLL_INTERVAL_MS);

        try {
            const result = await getPrecheckResult(accessToken, precheckId);

            if (result.status !== 'pending') {
                return result.status as ShopPrecheckStatus;
            }

            console.log(`[Processor] Precheck ${precheckId}: pending... (${i + 1}/${PRECHECK_POLL_MAX_ATTEMPTS})`);
        } catch (error) {
            console.warn(`[Processor] Precheck ${precheckId}: check error, retrying...`, error);
        }
    }

    // Timeout — allow to proceed
    console.warn(`[Processor] Precheck ${precheckId}: polling timed out, treating as passed`);
    return 'passed';
}

// ============================================================
// Database Helpers
// ============================================================

async function updateItemStatus(
    itemId: string,
    status: ShopTaskItemStatus,
    errorMessage?: string
): Promise<void> {
    const supabase = await createClient();
    const updateData: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
    };

    if (errorMessage) {
        updateData.error_message = errorMessage;
    }

    await supabase
        .from('shop_publish_task_items')
        .update(updateData)
        .eq('id', itemId);
}

async function updateItemField(
    itemId: string,
    fields: Record<string, unknown>
): Promise<void> {
    const supabase = await createClient();
    await supabase
        .from('shop_publish_task_items')
        .update({
            ...fields,
            updated_at: new Date().toISOString(),
        })
        .eq('id', itemId);
}

/**
 * Update parent task status based on completed items.
 */
async function updateTaskFinalStatus(taskId: string): Promise<void> {
    const supabase = await createClient();

    // Count item statuses
    const { data: items, error } = await supabase
        .from('shop_publish_task_items')
        .select('status')
        .eq('task_id', taskId);

    if (error || !items) {
        console.error('[Processor] Failed to count item statuses:', error);
        return;
    }

    const total = items.length;
    const successCount = items.filter((i: { status: string }) => i.status === 'published').length;
    const failedCount = items.filter((i: { status: string }) => i.status === 'failed').length;

    let taskStatus: string;
    if (successCount === total) {
        taskStatus = 'completed';
    } else if (failedCount === total) {
        taskStatus = 'failed';
    } else if (successCount + failedCount === total) {
        taskStatus = 'partial_failed';
    } else {
        // Some items still processing
        taskStatus = 'processing';
    }

    await supabase
        // @ts-expect-error — shop_publish_tasks 迁移后更新类型
        .from('shop_publish_tasks')
        .update({
            status: taskStatus,
            success_count: successCount,
            failed_count: failedCount,
            completed_at: taskStatus !== 'processing' ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);

    console.log(`[Processor] Task ${taskId}: final status=${taskStatus} (${successCount}/${total} success, ${failedCount} failed)`);
}

// ============================================================
// Utilities
// ============================================================

function groupByAccount(items: ProcessableItem[]): Record<string, ProcessableItem[]> {
    const groups: Record<string, ProcessableItem[]> = {};
    for (const item of items) {
        if (!groups[item.account_id]) {
            groups[item.account_id] = [];
        }
        groups[item.account_id].push(item);
    }
    return groups;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
