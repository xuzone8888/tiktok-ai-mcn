const TIKTOK_VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';
const TIKTOK_VIDEO_QUERY_URL = 'https://open.tiktokapis.com/v2/video/query/';
const TIKTOK_VIDEO_TIMEOUT_MS = 20_000;
const TIKTOK_VIDEO_ID_MAX_LENGTH = 256;
const TIKTOK_ERROR_CODE_MAX_LENGTH = 96;
const TIKTOK_LOG_ID_MAX_LENGTH = 128;
export const TIKTOK_VIDEO_BATCH_SIZE = 20;
export const TIKTOK_VIDEO_LIST_SCOPE = 'video.list';

const VIDEO_FIELDS = [
    'id',
    'create_time',
    'cover_image_url',
    'share_url',
    'video_description',
    'duration',
    'title',
    'like_count',
    'comment_count',
    'share_count',
    'view_count',
].join(',');

export interface TikTokVideo {
    id: string;
    create_time?: number;
    cover_image_url?: string;
    share_url?: string;
    video_description?: string;
    duration?: number;
    title?: string;
    like_count: number;
    comment_count: number;
    share_count: number;
    view_count: number;
}

interface TikTokVideoApiEnvelope {
    data?: {
        videos?: unknown[];
        cursor?: number;
        has_more?: boolean;
    };
    error?: {
        code?: string;
        message?: string;
        log_id?: string;
    };
}

export interface TikTokVideoPage {
    videos: TikTokVideo[];
    cursor: number | null;
    hasMore: boolean;
}

export class TikTokVideoApiError extends Error {
    readonly code: string;
    readonly httpStatus: number;
    readonly logId: string | null;

    constructor(code: string, message: string, httpStatus = 502, logId?: string | null) {
        super(message);
        this.name = 'TikTokVideoApiError';
        this.code = code;
        this.httpStatus = httpStatus;
        this.logId = logId || null;
    }
}

function countValue(value: unknown) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : null;
}

function boundedIdentifier(value: unknown, maxLength: number) {
    if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) return null;
    return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

function normalizeVideoId(value: unknown) {
    if (typeof value !== 'string') return null;
    const id = value.trim();
    if (!id || id.length > TIKTOK_VIDEO_ID_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(id)) return null;
    return id;
}

function safeHttpsUrl(value: unknown, allowedHost?: (hostname: string) => boolean) {
    if (typeof value !== 'string' || value.length > 4096) return null;
    try {
        const url = new URL(value);
        if (
            url.protocol !== 'https:'
            || url.username
            || url.password
            || (allowedHost && !allowedHost(url.hostname.toLowerCase()))
        ) {
            return null;
        }
        return url.toString();
    } catch {
        return null;
    }
}

function isTikTokShareHost(hostname: string) {
    return hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com');
}

function optionalText(value: unknown) {
    return typeof value === 'string' && value.length <= 10_000 ? value : null;
}

function videosFromEnvelope(payload: TikTokVideoApiEnvelope) {
    if (!payload.data || !Array.isArray(payload.data.videos)) {
        throw new TikTokVideoApiError(
            'tiktok_video_invalid_response',
            'TikTok returned an invalid response'
        );
    }
    return payload.data.videos;
}

function normalizeVideo(value: unknown): TikTokVideo | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    const id = normalizeVideoId(row.id);
    if (!id) return null;
    const likeCount = countValue(row.like_count);
    const commentCount = countValue(row.comment_count);
    const shareCount = countValue(row.share_count);
    const viewCount = countValue(row.view_count);
    if (
        likeCount === null
        || commentCount === null
        || shareCount === null
        || viewCount === null
    ) {
        return null;
    }

    return {
        id,
        ...(countValue(row.create_time) !== null ? { create_time: Number(row.create_time) } : {}),
        ...(safeHttpsUrl(row.cover_image_url) ? { cover_image_url: safeHttpsUrl(row.cover_image_url)! } : {}),
        ...(safeHttpsUrl(row.share_url, isTikTokShareHost) ? { share_url: safeHttpsUrl(row.share_url, isTikTokShareHost)! } : {}),
        ...(optionalText(row.video_description) !== null ? { video_description: optionalText(row.video_description)! } : {}),
        ...(countValue(row.duration) !== null ? { duration: Number(row.duration) } : {}),
        ...(optionalText(row.title) !== null ? { title: optionalText(row.title)! } : {}),
        like_count: likeCount,
        comment_count: commentCount,
        share_count: shareCount,
        view_count: viewCount,
    };
}

async function postTikTokVideoApi(
    endpoint: string,
    accessToken: string,
    body: Record<string, unknown>
): Promise<TikTokVideoApiEnvelope> {
    let response: Response;
    try {
        response = await fetch(`${endpoint}?fields=${VIDEO_FIELDS}`, {
            method: 'POST',
            signal: AbortSignal.timeout(TIKTOK_VIDEO_TIMEOUT_MS),
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    } catch (error) {
        const code = error instanceof DOMException && error.name === 'TimeoutError'
            ? 'tiktok_video_timeout'
            : 'tiktok_video_network_error';
        throw new TikTokVideoApiError(code, 'TikTok video service is temporarily unavailable');
    }

    const payload = await response.json().catch(() => null) as TikTokVideoApiEnvelope | null;
    if (!response.ok) {
        throw new TikTokVideoApiError(
            boundedIdentifier(payload?.error?.code, TIKTOK_ERROR_CODE_MAX_LENGTH)
                || `tiktok_video_http_${response.status}`,
            'TikTok video request failed',
            response.status,
            boundedIdentifier(payload?.error?.log_id, TIKTOK_LOG_ID_MAX_LENGTH)
        );
    }
    if (!payload) {
        throw new TikTokVideoApiError('tiktok_video_invalid_response', 'TikTok returned an invalid response');
    }
    if (payload.error?.code !== 'ok') {
        throw new TikTokVideoApiError(
            boundedIdentifier(payload.error?.code, TIKTOK_ERROR_CODE_MAX_LENGTH)
                || 'tiktok_video_invalid_response',
            'TikTok video request failed',
            502,
            boundedIdentifier(payload.error?.log_id, TIKTOK_LOG_ID_MAX_LENGTH)
        );
    }

    return payload;
}

export function hasTikTokVideoListScope(scopes: unknown) {
    return Array.isArray(scopes) && scopes.some((scope) => scope === TIKTOK_VIDEO_LIST_SCOPE);
}

export function chunkTikTokVideoIds(videoIds: string[]) {
    const uniqueIds = [...new Set(videoIds.map(normalizeVideoId).filter((id): id is string => Boolean(id)))];
    const batches: string[][] = [];
    for (let index = 0; index < uniqueIds.length; index += TIKTOK_VIDEO_BATCH_SIZE) {
        batches.push(uniqueIds.slice(index, index + TIKTOK_VIDEO_BATCH_SIZE));
    }
    return batches;
}

export async function listTikTokVideos(
    accessToken: string,
    options: { cursor?: number | null; maxCount?: number } = {}
): Promise<TikTokVideoPage> {
    const requestedMaxCount = options.maxCount;
    const maxCount = Number.isFinite(requestedMaxCount)
        ? Math.min(
            Math.max(Math.trunc(requestedMaxCount as number), 1),
            TIKTOK_VIDEO_BATCH_SIZE
        )
        : TIKTOK_VIDEO_BATCH_SIZE;
    if (
        options.cursor !== undefined
        && options.cursor !== null
        && (!Number.isSafeInteger(options.cursor) || options.cursor < 0)
    ) {
        throw new TikTokVideoApiError('invalid_video_cursor', 'Invalid TikTok video cursor', 400);
    }
    const payload = await postTikTokVideoApi(TIKTOK_VIDEO_LIST_URL, accessToken, {
        max_count: maxCount,
        ...(typeof options.cursor === 'number' ? { cursor: options.cursor } : {}),
    });

    const cursor = Number.isSafeInteger(payload.data?.cursor)
        && Number(payload.data?.cursor) >= 0
        ? Number(payload.data?.cursor)
        : null;
    const cursorAdvanced = options.cursor === undefined || options.cursor === null
        ? cursor !== null
        : cursor !== null && cursor < options.cursor;
    return {
        videos: videosFromEnvelope(payload).map(normalizeVideo).filter((video): video is TikTokVideo => Boolean(video)),
        cursor,
        hasMore: payload.data?.has_more === true && cursorAdvanced,
    };
}

export async function queryTikTokVideoBatch(
    accessToken: string,
    videoIds: string[]
): Promise<TikTokVideo[]> {
    const batches = chunkTikTokVideoIds(videoIds);
    if (
        !videoIds.every((id) => normalizeVideoId(id) !== null)
        || batches.length !== 1
        || batches[0].length > TIKTOK_VIDEO_BATCH_SIZE
    ) {
        throw new TikTokVideoApiError(
            'invalid_video_batch',
            `TikTok video query accepts between 1 and ${TIKTOK_VIDEO_BATCH_SIZE} unique IDs`,
            400
        );
    }

    const payload = await postTikTokVideoApi(TIKTOK_VIDEO_QUERY_URL, accessToken, {
        filters: { video_ids: batches[0] },
    });
    return videosFromEnvelope(payload)
        .map(normalizeVideo)
        .filter((video): video is TikTokVideo => Boolean(video));
}
