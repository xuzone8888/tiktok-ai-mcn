const TIKTOK_VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';
const TIKTOK_VIDEO_QUERY_URL = 'https://open.tiktokapis.com/v2/video/query/';
const TIKTOK_VIDEO_TIMEOUT_MS = 20_000;
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

function normalizeVideo(value: unknown): TikTokVideo | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id) return null;
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
        id: row.id,
        ...(typeof row.create_time === 'number' ? { create_time: row.create_time } : {}),
        ...(typeof row.cover_image_url === 'string' ? { cover_image_url: row.cover_image_url } : {}),
        ...(typeof row.share_url === 'string' ? { share_url: row.share_url } : {}),
        ...(typeof row.video_description === 'string' ? { video_description: row.video_description } : {}),
        ...(typeof row.duration === 'number' ? { duration: row.duration } : {}),
        ...(typeof row.title === 'string' ? { title: row.title } : {}),
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
            payload?.error?.code || `tiktok_video_http_${response.status}`,
            'TikTok video request failed',
            response.status,
            payload?.error?.log_id
        );
    }
    if (!payload) {
        throw new TikTokVideoApiError('tiktok_video_invalid_response', 'TikTok returned an invalid response');
    }
    if (payload.error?.code !== 'ok') {
        throw new TikTokVideoApiError(
            payload.error?.code || 'tiktok_video_invalid_response',
            payload.error?.message || 'TikTok video request failed',
            502,
            payload.error?.log_id
        );
    }

    return payload;
}

export function hasTikTokVideoListScope(scopes: unknown) {
    return Array.isArray(scopes) && scopes.some((scope) => scope === TIKTOK_VIDEO_LIST_SCOPE);
}

export function chunkTikTokVideoIds(videoIds: string[]) {
    const uniqueIds = [...new Set(videoIds.filter((id) => typeof id === 'string' && id))];
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
        videos: (payload.data?.videos || []).map(normalizeVideo).filter((video): video is TikTokVideo => Boolean(video)),
        cursor,
        hasMore: payload.data?.has_more === true && cursorAdvanced,
    };
}

export async function queryTikTokVideoBatch(
    accessToken: string,
    videoIds: string[]
): Promise<TikTokVideo[]> {
    const batches = chunkTikTokVideoIds(videoIds);
    if (batches.length !== 1 || batches[0].length !== new Set(videoIds.filter(Boolean)).size) {
        throw new TikTokVideoApiError(
            'invalid_video_batch',
            `TikTok video query accepts between 1 and ${TIKTOK_VIDEO_BATCH_SIZE} unique IDs`,
            400
        );
    }

    const payload = await postTikTokVideoApi(TIKTOK_VIDEO_QUERY_URL, accessToken, {
        filters: { video_ids: batches[0] },
    });
    return (payload.data?.videos || [])
        .map(normalizeVideo)
        .filter((video): video is TikTokVideo => Boolean(video));
}
