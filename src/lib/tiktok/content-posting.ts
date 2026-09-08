// TikTok Content Posting API Implementation

import { isTrustedTikTokUploadUrl } from './file-upload-contract';
import { isTikTokMockCredential, isTikTokTestMockEnabled } from './test-mock';
import {
    TikTokPublishVideoRequest,
    TikTokPublishStatusResponse
} from './types';

// TikTok Content Posting API endpoints
const TIKTOK_PUBLISH_VIDEO_INIT = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
// photo post 走 content/init(S0 核验:同 video.publish/video.upload scope + 同 Direct Post 审批)
const TIKTOK_PUBLISH_CONTENT_INIT = 'https://open.tiktokapis.com/v2/post/publish/content/init/';
const TIKTOK_PUBLISH_STATUS = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
const TIKTOK_CREATOR_INFO = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
const TIKTOK_REQUEST_TIMEOUT_MS = 20_000;

export type TikTokPublishingOperation =
    | 'creator_info'
    | 'video_init'
    | 'photo_init'
    | 'status_fetch';

export type TikTokPublishingOutcome = 'rejected' | 'unknown';

const TIKTOK_PUBLISH_STATUSES = new Set([
    'PROCESSING_DOWNLOAD',
    'PROCESSING_UPLOAD',
    'SEND_TO_USER_INBOX',
    'PUBLISH_COMPLETE',
    'FAILED',
] as const);

type TikTokPublishStatus = TikTokPublishStatusResponse['data']['status'];

export type TikTokVideoMimeType = 'video/mp4' | 'video/quicktime' | 'video/webm';

export interface TikTokVideoPostInfo {
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

export interface TikTokFileUploadPlan {
    videoSize: number;
    chunkSize: number;
    totalChunkCount: number;
}

export interface TikTokFileUploadInitResult extends TikTokFileUploadPlan {
    publishId: string;
    uploadUrl: string;
}

const TIKTOK_MAX_VIDEO_SIZE_BYTES = 4 * 1024 * 1024 * 1024;
const TIKTOK_FILE_CHUNK_SIZE_BYTES = 10 * 1024 * 1024;
const TIKTOK_MAX_SINGLE_CHUNK_BYTES = 64 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getSuccessfulResponseData(payload: unknown): Record<string, unknown> | null {
    if (!isRecord(payload) || !isRecord(payload.error) || payload.error.code !== 'ok') {
        return null;
    }
    return isRecord(payload.data) ? payload.data : null;
}

function getResponseProviderCode(payload: unknown): string | null {
    if (!isRecord(payload) || !isRecord(payload.error)) return null;
    if (typeof payload.error.code !== 'string') return null;
    const normalized = normalizeProviderCode(payload.error.code);
    return normalized === 'unknown_error' ? null : normalized;
}

function isPublishStatus(value: unknown): value is TikTokPublishStatus {
    return typeof value === 'string'
        && TIKTOK_PUBLISH_STATUSES.has(value as TikTokPublishStatus);
}

export function buildTikTokFileUploadPlan(videoSize: number): TikTokFileUploadPlan {
    if (
        !Number.isSafeInteger(videoSize)
        || videoSize <= 0
        || videoSize > TIKTOK_MAX_VIDEO_SIZE_BYTES
    ) {
        throw new TypeError('TikTok video size is invalid');
    }

    if (videoSize <= TIKTOK_MAX_SINGLE_CHUNK_BYTES) {
        return { videoSize, chunkSize: videoSize, totalChunkCount: 1 };
    }

    const totalChunkCount = Math.floor(videoSize / TIKTOK_FILE_CHUNK_SIZE_BYTES);
    if (totalChunkCount < 1 || totalChunkCount > 1000) {
        throw new TypeError('TikTok video chunk count is invalid');
    }

    return {
        videoSize,
        chunkSize: TIKTOK_FILE_CHUNK_SIZE_BYTES,
        totalChunkCount,
    };
}

function buildVideoPostInfo(postInfo: TikTokVideoPostInfo) {
    return {
        title: postInfo.title,
        privacy_level: postInfo.privacyLevel,
        disable_duet: postInfo.disableDuet ?? false,
        disable_comment: postInfo.disableComment ?? false,
        disable_stitch: postInfo.disableStitch ?? false,
        brand_content_toggle: postInfo.brandContentToggle ?? false,
        brand_organic_toggle: postInfo.brandOrganicToggle ?? false,
        is_aigc: postInfo.isAigc ?? false,
        video_cover_timestamp_ms: postInfo.videoCoverTimestampMs ?? 0,
    };
}

function parsePublishId(data: Record<string, unknown>, responseStatus: number): string {
    const publishId = typeof data.publish_id === 'string' ? data.publish_id.trim() : '';
    if (!publishId || publishId.length > 64) {
        logInvalidSuccessfulResponse('video_init', responseStatus, 'invalid_publish_id');
        throw new TikTokPublishingError({
            operation: 'video_init',
            providerCode: 'invalid_response',
            httpStatus: responseStatus,
            outcome: 'unknown',
            message: safePublishingMessage('video_init', 'invalid_response', 'unknown'),
        });
    }
    return publishId;
}

function parseTikTokUploadUrl(data: Record<string, unknown>, responseStatus: number): string {
    const uploadUrl = typeof data.upload_url === 'string' ? data.upload_url.trim() : '';
    if (!isTrustedTikTokUploadUrl(uploadUrl)) {
        logInvalidSuccessfulResponse(
            'video_init',
            responseStatus,
            'invalid_upload_url',
            describeUploadUrlForSafeLogging(uploadUrl)
        );
        throw new TikTokPublishingError({
            operation: 'video_init',
            providerCode: 'invalid_response',
            httpStatus: responseStatus,
            outcome: 'unknown',
            message: safePublishingMessage('video_init', 'invalid_response', 'unknown'),
        });
    }

    return uploadUrl;
}

interface TikTokPublishingErrorOptions {
    operation: TikTokPublishingOperation;
    providerCode: string;
    httpStatus: number | null;
    outcome: TikTokPublishingOutcome;
    message: string;
}

export class TikTokPublishingError extends Error {
    readonly operation: TikTokPublishingOperation;
    readonly providerCode: string;
    readonly httpStatus: number | null;
    readonly outcome: TikTokPublishingOutcome;

    constructor(options: TikTokPublishingErrorOptions) {
        super(options.message);
        this.name = 'TikTokPublishingError';
        this.operation = options.operation;
        this.providerCode = options.providerCode;
        this.httpStatus = options.httpStatus;
        this.outcome = options.outcome;
    }
}

export function isTikTokPublishingError(error: unknown): error is TikTokPublishingError {
    return error instanceof TikTokPublishingError;
}

function normalizeProviderCode(value: unknown): string {
    if (typeof value !== 'string') return 'unknown_error';
    const normalized = value.trim();
    return /^[A-Za-z0-9_.-]{1,128}$/.test(normalized) ? normalized : 'unknown_error';
}

function isAmbiguousWriteStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function safePublishingMessage(
    operation: TikTokPublishingOperation,
    providerCode: string,
    outcome: TikTokPublishingOutcome
): string {
    if (providerCode === 'unaudited_client_can_only_post_to_private_accounts') {
        return 'TikTok 未审核应用只能向私密账号发布仅自己可见的内容';
    }
    if (outcome === 'unknown' && (operation === 'video_init' || operation === 'photo_init')) {
        return '无法确认 TikTok 是否接收了发布请求，请先检查账号后再处理';
    }
    if (operation === 'creator_info') return 'TikTok 创作者信息暂时不可用';
    if (operation === 'status_fetch') return 'TikTok 发布状态暂时无法确认';
    return 'TikTok 拒绝了发布请求';
}

function logInvalidSuccessfulResponse(
    operation: TikTokPublishingOperation,
    httpStatus: number,
    reason: 'missing_success_data' | 'invalid_publish_id' | 'invalid_upload_url',
    details: Record<string, string | number | boolean> = {}
): void {
    // Never log the provider body, publish_id, or upload_url. The reason is
    // deliberately structural so a live failure can be diagnosed without
    // exposing credentials embedded in the upload URL.
    console.warn('[TikTok Publishing] Invalid successful response', {
        operation,
        httpStatus,
        reason,
        ...details,
    });
}

function describeUploadUrlForSafeLogging(uploadUrl: string): Record<string, string | number | boolean> {
    const base = {
        uploadUrlPresent: Boolean(uploadUrl),
        uploadUrlLength: uploadUrl.length,
    };

    try {
        const parsed = new URL(uploadUrl);
        // The hostname is safe to retain for trust-boundary diagnosis. Never
        // retain the path, query, fragment, or the raw URL: TikTok embeds the
        // upload credential in the query string.
        const hostname = parsed.hostname.toLowerCase();
        return {
            ...base,
            uploadUrlParseable: true,
            uploadUrlHttps: parsed.protocol === 'https:',
            uploadUrlHost: hostname,
            uploadUrlPort: parsed.port || 'default',
            uploadUrlHasCredentials: Boolean(parsed.username || parsed.password),
            uploadUrlHasQuery: Boolean(parsed.search),
            uploadUrlHasFragment: Boolean(parsed.hash),
        };
    } catch {
        return {
            ...base,
            uploadUrlParseable: false,
        };
    }
}

async function readProviderCode(response: Response): Promise<string> {
    const body = await response.text().catch(() => '');
    if (!body) return `http_${response.status}`;
    try {
        const payload = JSON.parse(body) as {
            error?: { code?: unknown } | unknown;
            code?: unknown;
        };
        const nestedCode = payload.error && typeof payload.error === 'object'
            ? (payload.error as { code?: unknown }).code
            : undefined;
        return normalizeProviderCode(nestedCode ?? payload.code ?? `http_${response.status}`);
    } catch {
        return `http_${response.status}`;
    }
}

async function throwResponseError(
    response: Response,
    operation: TikTokPublishingOperation
): Promise<never> {
    const providerCode = await readProviderCode(response);
    const outcome: TikTokPublishingOutcome = isAmbiguousWriteStatus(response.status)
        ? 'unknown'
        : 'rejected';
    const error = new TikTokPublishingError({
        operation,
        providerCode,
        httpStatus: response.status,
        outcome,
        message: safePublishingMessage(operation, providerCode, outcome),
    });
    console.warn('[TikTok Publishing] Provider request failed', {
        operation: error.operation,
        providerCode: error.providerCode,
        httpStatus: error.httpStatus,
        outcome: error.outcome,
    });
    throw error;
}

async function fetchTikTok(
    url: string,
    options: RequestInit,
    operation: TikTokPublishingOperation
): Promise<Response> {
    try {
        return await fetch(url, {
            ...options,
            signal: options.signal ?? AbortSignal.timeout(TIKTOK_REQUEST_TIMEOUT_MS),
        });
    } catch {
        const error = new TikTokPublishingError({
            operation,
            providerCode: 'transport_error',
            httpStatus: null,
            outcome: 'unknown',
            message: safePublishingMessage(operation, 'transport_error', 'unknown'),
        });
        console.warn('[TikTok Publishing] Provider request did not return a response', {
            operation: error.operation,
            providerCode: error.providerCode,
            httpStatus: error.httpStatus,
            outcome: error.outcome,
        });
        throw error;
    }
}

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

function shouldUseLocalTikTokMock(accessToken: string, publishId?: string) {
    const mockCredential = isTikTokMockCredential(accessToken) || isTikTokMockCredential(publishId)
    return mockCredential && (
        process.env.NODE_ENV !== 'production'
        || isTikTokTestMockEnabled()
    )
}

function getMockCreatorInfo(accessToken: string): CreatorInfo {
    const suffix = accessToken.split('-').slice(-1)[0] || 'test'

    return {
        creator_avatar_url: '',
        creator_username: `local_creator_${suffix}`,
        creator_nickname: `Local Creator ${suffix}`,
        privacy_level_options: [
            'PUBLIC_TO_EVERYONE',
            'MUTUAL_FOLLOW_FRIENDS',
            'FOLLOWER_OF_CREATOR',
            'SELF_ONLY',
        ],
        comment_disabled: false,
        duet_disabled: true,
        stitch_disabled: false,
        max_video_post_duration_sec: 600,
    }
}

// Get creator info (available privacy levels, duet/stitch settings)
export async function getCreatorInfo(accessToken: string): Promise<CreatorInfo> {
    if (shouldUseLocalTikTokMock(accessToken)) {
        return getMockCreatorInfo(accessToken)
    }

    const response = await fetchTikTok(TIKTOK_CREATOR_INFO, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
    }, 'creator_info');

    if (!response.ok) {
        await throwResponseError(response, 'creator_info');
    }

    const payload = await response.json().catch(() => null) as unknown;
    const data = getSuccessfulResponseData(payload);
    const providerCode = getResponseProviderCode(payload);

    if (!data) {
        const outcome: TikTokPublishingOutcome = providerCode && providerCode !== 'ok'
            ? 'rejected'
            : 'unknown';
        throw new TikTokPublishingError({
            operation: 'creator_info',
            providerCode: providerCode && providerCode !== 'ok' ? providerCode : 'invalid_response',
            httpStatus: response.status,
            outcome,
            message: safePublishingMessage('creator_info', providerCode ?? 'invalid_response', outcome),
        });
    }

    const privacyLevels = data.privacy_level_options;
    const maxDuration = data.max_video_post_duration_sec;
    if (
        typeof data.creator_avatar_url !== 'string'
        || typeof data.creator_username !== 'string'
        || typeof data.creator_nickname !== 'string'
        || !Array.isArray(privacyLevels)
        || !privacyLevels.every((level) => typeof level === 'string')
        || typeof data.comment_disabled !== 'boolean'
        || typeof data.duet_disabled !== 'boolean'
        || typeof data.stitch_disabled !== 'boolean'
        || typeof maxDuration !== 'number'
        || !Number.isSafeInteger(maxDuration)
        || maxDuration <= 0
    ) {
        throw new TikTokPublishingError({
            operation: 'creator_info',
            providerCode: 'invalid_response',
            httpStatus: response.status,
            outcome: 'unknown',
            message: safePublishingMessage('creator_info', 'invalid_response', 'unknown'),
        });
    }

    return {
        creator_avatar_url: data.creator_avatar_url,
        creator_username: data.creator_username,
        creator_nickname: data.creator_nickname,
        privacy_level_options: privacyLevels,
        comment_disabled: data.comment_disabled,
        duet_disabled: data.duet_disabled,
        stitch_disabled: data.stitch_disabled,
        max_video_post_duration_sec: maxDuration,
    };
}

// Initialize video publish from URL
export async function initVideoPublishFromUrl(
    accessToken: string,
    videoUrl: string,
    postInfo: TikTokVideoPostInfo
): Promise<string> {
    if (shouldUseLocalTikTokMock(accessToken)) {
        const suffix = Math.random().toString(36).slice(2, 10)
        console.log('[TikTok Publish] Local mock init')
        return `mock-publish-${Date.now()}-${suffix}`
    }

    const requestBody: TikTokPublishVideoRequest = {
        post_info: buildVideoPostInfo(postInfo),
        source_info: {
            source: 'PULL_FROM_URL' as const,
            video_url: videoUrl,
        },
    };

    console.log('[TikTok Publish] Initiating publish:', {
        privacyLevel: postInfo.privacyLevel,
        isAigc: postInfo.isAigc,
    })

    const response = await fetchTikTok(TIKTOK_PUBLISH_VIDEO_INIT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(requestBody),
    }, 'video_init');

    if (!response.ok) {
        await throwResponseError(response, 'video_init');
    }

    const payload = await response.json().catch(() => null) as unknown;
    const data = getSuccessfulResponseData(payload);
    const providerCode = getResponseProviderCode(payload);

    if (!data) {
        const outcome: TikTokPublishingOutcome = providerCode && providerCode !== 'ok'
            ? 'rejected'
            : 'unknown';
        if (outcome === 'unknown') {
            logInvalidSuccessfulResponse('video_init', response.status, 'missing_success_data');
        }
        throw new TikTokPublishingError({
            operation: 'video_init',
            providerCode: providerCode && providerCode !== 'ok' ? providerCode : 'invalid_response',
            httpStatus: response.status,
            outcome,
            message: safePublishingMessage('video_init', providerCode ?? 'invalid_response', outcome),
        });
    }

    return parsePublishId(data, response.status);
}

// Initialize a Direct Post upload for a local file. The upload URL is returned
// only after the caller has durably persisted publishId behind an attempt fence.
export async function initVideoPublishFromFile(
    accessToken: string,
    videoSize: number,
    postInfo: TikTokVideoPostInfo
): Promise<TikTokFileUploadInitResult> {
    const plan = buildTikTokFileUploadPlan(videoSize);

    if (shouldUseLocalTikTokMock(accessToken)) {
        const suffix = Math.random().toString(36).slice(2, 10);
        return {
            ...plan,
            publishId: `mock-publish-${Date.now()}-${suffix}`,
            uploadUrl: 'https://open-upload.tiktokapis.com/video/?upload_id=mock&upload_token=mock',
        };
    }

    const response = await fetchTikTok(TIKTOK_PUBLISH_VIDEO_INIT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
            post_info: buildVideoPostInfo(postInfo),
            source_info: {
                source: 'FILE_UPLOAD',
                video_size: plan.videoSize,
                chunk_size: plan.chunkSize,
                total_chunk_count: plan.totalChunkCount,
            },
        }),
    }, 'video_init');

    if (!response.ok) {
        await throwResponseError(response, 'video_init');
    }

    const payload = await response.json().catch(() => null) as unknown;
    const data = getSuccessfulResponseData(payload);
    const providerCode = getResponseProviderCode(payload);
    if (!data) {
        const outcome: TikTokPublishingOutcome = providerCode && providerCode !== 'ok'
            ? 'rejected'
            : 'unknown';
        if (outcome === 'unknown') {
            logInvalidSuccessfulResponse('video_init', response.status, 'missing_success_data');
        }
        throw new TikTokPublishingError({
            operation: 'video_init',
            providerCode: providerCode && providerCode !== 'ok' ? providerCode : 'invalid_response',
            httpStatus: response.status,
            outcome,
            message: safePublishingMessage('video_init', providerCode ?? 'invalid_response', outcome),
        });
    }

    return {
        ...plan,
        publishId: parsePublishId(data, response.status),
        uploadUrl: parseTikTokUploadUrl(data, response.status),
    };
}

// Initialize photo post publish from URLs (S4.2 图文帖直发)
// 端点=content/init(media_type=PHOTO);图片 URL 经 PULL_FROM_URL 拉取,
// 与视频直发同域名前缀(生产已在用 PULL_FROM_URL 发视频)。
export async function initPhotoPublishFromUrl(
    accessToken: string,
    photos: {
        /** 发布图序(≤10 张,https 直链) */
        imageUrls: string[];
        /** 封面图下标(缺省 0) */
        coverIndex?: number;
    },
    postInfo: {
        /** 帖子标题(TikTok 上限 90 字符) */
        title?: string;
        /** 正文文案(TikTok 上限 4000 字符,支持 #话题) */
        description?: string;
        privacyLevel: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
        disableComment?: boolean;
        /** 自动配乐(photo post 专属,缺省 true) */
        autoAddMusic?: boolean;
        brandContentToggle?: boolean;
        brandOrganicToggle?: boolean;
    }
): Promise<string> {
    if (shouldUseLocalTikTokMock(accessToken)) {
        const suffix = Math.random().toString(36).slice(2, 10)
        console.log('[TikTok PhotoPublish] Local mock init:', {
            imageCount: photos.imageUrls.length,
        })
        return `mock-publish-${Date.now()}-${suffix}`
    }

    const requestBody = {
        post_info: {
            title: (postInfo.title ?? '').slice(0, 90),
            description: (postInfo.description ?? '').slice(0, 4000),
            privacy_level: postInfo.privacyLevel,
            disable_comment: postInfo.disableComment ?? false,
            auto_add_music: postInfo.autoAddMusic ?? true,
            brand_content_toggle: postInfo.brandContentToggle ?? false,
            brand_organic_toggle: postInfo.brandOrganicToggle ?? false,
        },
        source_info: {
            source: 'PULL_FROM_URL' as const,
            photo_cover_index: Math.min(
                Math.max(photos.coverIndex ?? 0, 0),
                photos.imageUrls.length - 1
            ),
            photo_images: photos.imageUrls.slice(0, 10),
        },
        post_mode: 'DIRECT_POST' as const,
        media_type: 'PHOTO' as const,
    };

    console.log('[TikTok PhotoPublish] Initiating publish:', {
        imageCount: photos.imageUrls.length,
        privacyLevel: postInfo.privacyLevel,
    })

    const response = await fetchTikTok(TIKTOK_PUBLISH_CONTENT_INIT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(requestBody),
    }, 'photo_init');

    if (!response.ok) {
        await throwResponseError(response, 'photo_init');
    }

    const payload = await response.json().catch(() => null) as unknown;
    const data = getSuccessfulResponseData(payload);
    const providerCode = getResponseProviderCode(payload);

    if (!data) {
        const outcome: TikTokPublishingOutcome = providerCode && providerCode !== 'ok'
            ? 'rejected'
            : 'unknown';
        throw new TikTokPublishingError({
            operation: 'photo_init',
            providerCode: providerCode && providerCode !== 'ok' ? providerCode : 'invalid_response',
            httpStatus: response.status,
            outcome,
            message: safePublishingMessage('photo_init', providerCode ?? 'invalid_response', outcome),
        });
    }

    const publishId = typeof data.publish_id === 'string' ? data.publish_id.trim() : '';
    if (!publishId || publishId.length > 64) {
        throw new TikTokPublishingError({
            operation: 'photo_init',
            providerCode: 'invalid_response',
            httpStatus: response.status,
            outcome: 'unknown',
            message: safePublishingMessage('photo_init', 'invalid_response', 'unknown'),
        });
    }

    return publishId;
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
    if (shouldUseLocalTikTokMock(accessToken, publishId)) {
        if (publishId.includes('failed')) {
            return {
                status: 'FAILED',
                failReason: 'Local mock failure for verification',
            }
        }

        if (publishId.includes('processing')) {
            return { status: 'PROCESSING_UPLOAD' }
        }

        if (publishId.includes('inbox')) {
            return {
                status: 'SEND_TO_USER_INBOX',
                postId: `mock-post-${publishId.slice(-10)}`,
            }
        }

        return {
            status: 'PUBLISH_COMPLETE',
            postId: `mock-post-${publishId.slice(-10)}`,
        }
    }

    const response = await fetchTikTok(TIKTOK_PUBLISH_STATUS, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ publish_id: publishId }),
    }, 'status_fetch');

    if (!response.ok) {
        await throwResponseError(response, 'status_fetch');
    }

    const payload = await response.json().catch(() => null) as unknown;
    const data = getSuccessfulResponseData(payload);
    const providerCode = getResponseProviderCode(payload);

    if (!data || !isPublishStatus(data.status)) {
        const outcome: TikTokPublishingOutcome = providerCode && providerCode !== 'ok'
            ? 'rejected'
            : 'unknown';
        throw new TikTokPublishingError({
            operation: 'status_fetch',
            providerCode: providerCode && providerCode !== 'ok' ? providerCode : 'invalid_response',
            httpStatus: response.status,
            outcome,
            message: safePublishingMessage('status_fetch', providerCode ?? 'invalid_response', outcome),
        });
    }

    const postIds = data.publicaly_available_post_id;
    const firstPostId = Array.isArray(postIds)
        ? postIds.find((postId) => (
            (typeof postId === 'string' && postId.trim().length > 0)
            || (typeof postId === 'number' && Number.isSafeInteger(postId) && postId > 0)
        ))
        : undefined;
    let normalizedPostId: string | undefined;
    if (typeof firstPostId === 'string') {
        normalizedPostId = firstPostId.trim();
    } else if (typeof firstPostId === 'number') {
        normalizedPostId = String(firstPostId);
    }

    return {
        status: data.status,
        failReason: typeof data.fail_reason === 'string' ? data.fail_reason : undefined,
        postId: normalizedPostId,
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
    timedOut?: boolean;
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
                return { success: false, error: 'TikTok reported that publishing failed', timedOut: false };

            case 'PROCESSING_DOWNLOAD':
            case 'PROCESSING_UPLOAD':
                // Still processing, wait and poll again
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                break;
        }
    }

    return {
        success: false,
        error: 'TikTok is still processing the publish request',
        timedOut: true,
    };
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
            const providerCode = await readProviderCode(response);
            console.warn('[TikTok Publishing] Delete request rejected', {
                operation: 'delete',
                providerCode,
                httpStatus: response.status,
            });
            return false;
        }

        const data = await response.json();
        return data.data?.error_code === 0;
    } catch {
        console.warn('[TikTok Publishing] Delete request did not complete');
        return false;
    }
}
