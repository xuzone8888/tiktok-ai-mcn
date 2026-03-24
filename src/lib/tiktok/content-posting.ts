// TikTok Content Posting API Implementation

import {
    TikTokPublishVideoRequest,
    TikTokVideoUploadInitResponse,
    TikTokPublishStatusResponse
} from './types';

// TikTok Content Posting API endpoints
const TIKTOK_PUBLISH_VIDEO_INIT = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const TIKTOK_PUBLISH_STATUS = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
const TIKTOK_CREATOR_INFO = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';

export interface CreatorInfo {
    creator_avatar_url: string;
    creator_username: string;
    creator_nickname: string;
    privacy_level_options: string[];
    comment_disabled: boolean;
    duet_disabled: boolean;
    stitch_disabled: boolean;
    max_video_post_duration_sec: number;
}

// Get creator info (available privacy levels, duet/stitch settings)
export async function getCreatorInfo(accessToken: string): Promise<CreatorInfo> {
    const response = await fetch(TIKTOK_CREATOR_INFO, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get creator info: ${errorText}`);
    }

    const data = await response.json();

    if (data.error && data.error.code !== 'ok') {
        throw new Error(`TikTok API error: ${data.error.message}`);
    }

    return data.data as CreatorInfo;
}

// Helper for fetch with retry
async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            // Only retry on network errors or 5xx server errors
            if (res.ok || (res.status < 500 && res.status !== 429)) {
                return res;
            }
            // Log warning for error status
            console.warn(`Fetch attempt ${i + 1} failed with status ${res.status}`);
        } catch (error) {
            lastError = error;
            console.warn(`Fetch attempt ${i + 1} failed with network error:`, error);
        }

        // Wait before retry (exponential backoff: 1s, 2s, 3s)
        if (i < retries - 1) {
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    throw lastError || new Error('Fetch failed after retries');
}

// Initialize video publish from URL
export async function initVideoPublishFromUrl(
    accessToken: string,
    videoUrl: string,
    postInfo: {
        title: string;
        privacyLevel: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
        disableDuet?: boolean;
        disableComment?: boolean;
        disableStitch?: boolean;
        brandContentToggle?: boolean;
        brandOrganicToggle?: boolean;
        isAigc?: boolean;
        videoCoverTimestampMs?: number;
    }
): Promise<string> {
    const requestBody: TikTokPublishVideoRequest = {
        post_info: {
            title: postInfo.title,
            privacy_level: postInfo.privacyLevel,
            disable_duet: postInfo.disableDuet ?? false,
            disable_comment: postInfo.disableComment ?? false,
            disable_stitch: postInfo.disableStitch ?? false,
            brand_content_toggle: postInfo.brandContentToggle ?? false,
            brand_organic_toggle: postInfo.brandOrganicToggle ?? false,
            is_aigc: postInfo.isAigc ?? false,
            video_cover_timestamp_ms: postInfo.videoCoverTimestampMs ?? 0,
        },
        source_info: {
            source: 'PULL_FROM_URL' as const,
            video_url: videoUrl,
        },
    };

    // 记录请求详情用于调试
    console.log('[TikTok Publish] Initiating publish:', {
        videoUrl: videoUrl.substring(0, 80) + '...',
        title: postInfo.title?.substring(0, 50),
        privacyLevel: postInfo.privacyLevel,
        isAigc: postInfo.isAigc,
    })

    const response = await fetchWithRetry(TIKTOK_PUBLISH_VIDEO_INIT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        // 记录完整错误信息
        console.error('[TikTok Publish] API Error:', {
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText.substring(0, 500),
            videoUrl: videoUrl.substring(0, 80),
        })
        try {
            const errorJson = JSON.parse(errorText);
            const message = errorJson.error?.message || errorJson.message || errorText;
            throw new Error(`TikTok API Error (${response.status}): ${message}`);
        } catch (e) {
            if (e instanceof Error && e.message.startsWith('TikTok API Error')) {
                throw e
            }
            throw new Error(`Failed to init video publish (${response.status}): ${errorText.substring(0, 200)}`);
        }
    }

    const data: TikTokVideoUploadInitResponse = await response.json();

    if (data.error && data.error.code !== 'ok') {
        throw new Error(`TikTok publish error: ${data.error.message} (${data.error.code})`);
    }

    return data.data.publish_id;
}

// Check publish status
export async function checkPublishStatus(
    accessToken: string,
    publishId: string
): Promise<{
    status: 'PROCESSING_DOWNLOAD' | 'PROCESSING_UPLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED';
    failReason?: string;
    postId?: string;
}> {
    const response = await fetch(TIKTOK_PUBLISH_STATUS, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ publish_id: publishId }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to check publish status: ${errorText}`);
    }

    const data: TikTokPublishStatusResponse = await response.json();

    if (data.error && data.error.code !== 'ok') {
        throw new Error(`TikTok status error: ${data.error.message}`);
    }

    return {
        status: data.data.status,
        failReason: data.data.fail_reason,
        postId: data.data.publicaly_available_post_id?.[0],
    };
}

// Poll for publish completion
export async function waitForPublishComplete(
    accessToken: string,
    publishId: string,
    maxWaitTimeMs: number = 120000, // 2 minutes default
    pollIntervalMs: number = 5000 // 5 seconds
): Promise<{
    success: boolean;
    postId?: string;
    error?: string;
}> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTimeMs) {
        const result = await checkPublishStatus(accessToken, publishId);

        switch (result.status) {
            case 'PUBLISH_COMPLETE':
                return { success: true, postId: result.postId };

            case 'SEND_TO_USER_INBOX':
                // Video sent to user's inbox for review (direct post not enabled)
                return { success: true, postId: result.postId };

            case 'FAILED':
                return { success: false, error: result.failReason || 'Unknown error' };

            case 'PROCESSING_DOWNLOAD':
            case 'PROCESSING_UPLOAD':
                // Still processing, wait and poll again
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                break;
        }
    }

    return { success: false, error: 'Publish timeout - still processing' };
}

// Privacy level display names
export const PRIVACY_LEVEL_DISPLAY: Record<string, string> = {
    'PUBLIC_TO_EVERYONE': '公开',
    'MUTUAL_FOLLOW_FRIENDS': '好友可见',
    'FOLLOWER_OF_CREATOR': '粉丝可见',
    'SELF_ONLY': '仅自己可见',
};

// Validate video URL
export function isValidVideoUrl(url: string): boolean {
    try {
        const urlObj = new URL(url);
        // Must use HTTPS
        if (urlObj.protocol !== 'https:') {
            return false;
        }
        // Basic extension check
        const validExtensions = ['.mp4', '.webm', '.mov'];
        const hasValidExtension = validExtensions.some(ext =>
            urlObj.pathname.toLowerCase().includes(ext)
        );
        return hasValidExtension;
    } catch {
        return false;
    }
}
// Delete video (Note: TikTok API access required)
export async function deleteVideo(
    accessToken: string,
    tiktokShareId: string
): Promise<boolean> {
    // Note: As of current TikTok API version, programmatic deletion might be restricted
    // We attempt to call the delete endpoint if available, or throw not supported

    // 假设的 Endpoint，实际可能需要根据官方文档调整
    const TIKTOK_VIDEO_DELETE = 'https://open.tiktokapis.com/v2/video/delete/';

    try {
        const response = await fetch(TIKTOK_VIDEO_DELETE, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                video_id: tiktokShareId  // W6: TikTok API 使用 video_id 而非 share_id
            }),
        });

        if (!response.ok) {
            // Log warning but don't crash flow - API might not exist
            console.warn('TikTok delete API failed or not supported:', await response.text());
            return false;
        }

        const data = await response.json();
        return data.data?.error_code === 0;
    } catch (error) {
        console.warn('Failed to delete TikTok video:', error);
        return false;
    }
}
