// TikTok Shop API Client
// All Shop API requests require HMAC-SHA256 signature
// Base Domain: open-api.tiktokglobalshop.com (same for all regions)

import crypto from 'crypto';
import { getShopOAuthConfig } from './shop-oauth';
import type {
    ShopApiResponse,
    ShopFileInitResponse,
    ShopFileUploadResponse,
    ShopVideoPostRequest,
    ShopVideoStatus,
    ShopPrecheckResult,
    ShopProduct,
    ShopShowcaseResponse,
    ShopCreatorProfile,
} from './shop-types';

// ============================================================
// Constants
// ============================================================

const SHOP_API_BASE = 'https://open-api.tiktokglobalshop.com';

// ⚠️ Endpoint paths as constants — some may need runtime verification
// Post Shoppable Video path (Round-8 Finding #2: may differ, keep as constant for easy switching)
const SHOPPABLE_VIDEO_PATH = '/affiliate_creator/202505/videos';
const SHOWCASE_PRODUCTS_PATH = '/affiliate_creator/202405/showcases/products'; // ⚠️ Version 202405!
const CREATOR_PROFILE_PATH = '/affiliate_creator/202405/profiles';            // ⚠️ Version 202405 confirmed!
const VIDEO_STATUS_PATH_PREFIX = '/affiliate_creator/202509/videos';           // ⚠️ Version 202509 for status!
const FILE_INIT_PATH = '/open/202512/file/init';
const VIDEO_PRECHECK_PATH = '/affiliate_creator/202505/videos/precheck';       // ⚠️ Needs runtime verification

// ============================================================
// Signature Algorithm (HMAC-SHA256, 6 Steps)
// ============================================================

/**
 * Generate the HMAC-SHA256 signature for a Shop API request.
 *
 * Algorithm (6 steps):
 * 1. Sort all query params by key alphabetically (EXCLUDE `sign` and `access_token`)
 * 2. Concatenate sorted params as key1+value1+key2+value2...
 * 3. Prepend the API path: path + concatenated_params (path FIRST!)
 * 4. Append request body if present (JSON string)
 * 5. Wrap with app_secret: app_secret + string + app_secret
 * 6. HMAC-SHA256 with app_secret as key, output hex-encoded
 *
 * @param path - API path, e.g. "/affiliate_creator/202505/videos"
 * @param queryParams - All query parameters (sign and access_token will be excluded)
 * @param body - Optional request body as JSON string
 * @returns Hex-encoded signature string
 */
export function generateShopSign(
    path: string,
    queryParams: Record<string, string>,
    body?: string
): string {
    const config = getShopOAuthConfig();

    // Step 1: Sort query params by key, excluding `sign` and `access_token`
    const filteredKeys = Object.keys(queryParams)
        .filter(key => key !== 'sign' && key !== 'access_token')
        .sort();

    // Step 2: Concatenate as key+value pairs
    const paramString = filteredKeys
        .map(key => `${key}${queryParams[key]}`)
        .join('');

    // Step 3: path + param string (path FIRST!)
    let signString = path + paramString;

    // Step 4: Append request body if present
    if (body) {
        signString += body;
    }

    // Step 5: Wrap with app_secret on both sides
    const wrappedString = config.appSecret + signString + config.appSecret;

    // Step 6: HMAC-SHA256 with app_secret as key, hex-encoded
    const hmac = crypto.createHmac('sha256', config.appSecret);
    hmac.update(wrappedString);
    return hmac.digest('hex');
}

// ============================================================
// Generic API Request Wrapper
// ============================================================

/**
 * Make an authenticated request to the TikTok Shop API.
 * Automatically handles:
 * - Adding app_key, timestamp (10-digit), sign to query params
 * - Setting x-tts-access-token header (⚠️ NOT Bearer token!)
 * - Parsing response and checking for errors
 *
 * @param method - HTTP method
 * @param path - API path (without base URL)
 * @param accessToken - The creator's access token
 * @param options - Optional body and additional query params
 */
async function shopApiRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    accessToken: string,
    options?: {
        body?: Record<string, unknown>;
        queryParams?: Record<string, string>;
    }
): Promise<T> {
    const config = getShopOAuthConfig();

    // Build query parameters
    const timestamp = Math.floor(Date.now() / 1000).toString(); // 10-digit Unix timestamp
    const queryParams: Record<string, string> = {
        app_key: config.appKey,
        timestamp,
        ...options?.queryParams,
    };

    // Generate request body JSON string (for signing)
    const bodyString = options?.body ? JSON.stringify(options.body) : undefined;

    // Generate signature
    const sign = generateShopSign(path, queryParams, bodyString);
    queryParams.sign = sign;

    // Build full URL
    const urlParams = new URLSearchParams(queryParams);
    const url = `${SHOP_API_BASE}${path}?${urlParams.toString()}`;

    // Make request
    const fetchOptions: RequestInit = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'x-tts-access-token': accessToken, // ⚠️ NOT "Bearer {token}"!
        },
    };

    if (bodyString && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = bodyString;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `TikTok Shop API error [${response.status}] ${method} ${path}: ${errorText}`
        );
    }

    const data: ShopApiResponse<T> = await response.json();

    if (data.code !== 0) {
        throw new Error(
            `TikTok Shop API error [${data.code}]: ${data.message} (request_id: ${data.request_id || 'N/A'})`
        );
    }

    return data.data;
}

// ============================================================
// File Upload (3-Step Process)
// ============================================================

/**
 * Step 1: Initialize file upload session.
 * POST /open/202512/file/init
 *
 * @returns upload_url and upload_token for Step 2
 */
export async function initFileUpload(
    accessToken: string,
    params: {
        file_name: string;
        file_size: number;
        file_type: 'video';
        total_chunk_count: number;
        target_path: string;
    }
): Promise<ShopFileInitResponse> {
    return shopApiRequest<ShopFileInitResponse>(
        'POST',
        FILE_INIT_PATH,
        accessToken,
        {
            body: {
                file_name: params.file_name,
                file_type: params.file_type,
                file_size: params.file_size,
                total_chunk_count: params.total_chunk_count,
                target_path: params.target_path,
            },
        }
    );
}

/**
 * Step 2: Upload video file to the upload_url.
 *
 * ⚠️ Round-8 Finding #3: HTTP method may be PUT or POST.
 * Trying PUT first (as documented), falling back to POST if 405.
 * Files < 5MB can be uploaded in one chunk.
 *
 * @param uploadUrl - From initFileUpload response
 * @param uploadToken - From initFileUpload response
 * @param videoBuffer - Raw video file bytes
 * @returns resource_id (= file_id for Step 3)
 */
export async function uploadVideoChunk(
    uploadUrl: string,
    uploadToken: string,
    videoBuffer: Buffer
): Promise<ShopFileUploadResponse> {
    // Convert Buffer to Uint8Array for fetch body compatibility
    const bodyData = new Uint8Array(videoBuffer);

    // Try PUT first
    let response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/octet-stream',
            'upload-token': uploadToken,
        },
        body: bodyData,
    });

    // Fallback to POST if PUT returns 405 Method Not Allowed
    if (response.status === 405) {
        console.warn('[Shop API] PUT upload failed with 405, retrying with POST');
        response = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'upload-token': uploadToken,
            },
            body: bodyData,
        });
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload video chunk: [${response.status}] ${errorText}`);
    }

    const data = await response.json();

    // The response may be wrapped in Shop API envelope or direct
    if (data.data?.resource_id) {
        return { resource_id: data.data.resource_id };
    }
    if (data.resource_id) {
        return { resource_id: data.resource_id };
    }

    throw new Error(`Unexpected upload response: ${JSON.stringify(data)}`);
}

// ============================================================
// Shoppable Video Publishing
// ============================================================

/**
 * Step 3: Post a shoppable video (bind uploaded file to product).
 * POST /affiliate_creator/202505/videos
 *
 * ⚠️ Round-8 Finding #2: Path may differ at runtime. Using constant for easy switching.
 * ⚠️ product_id is a SINGLE string, NOT an array!
 * ⚠️ Request body uses NESTED structure
 *
 * @returns video_id
 */
export async function postShoppableVideo(
    accessToken: string,
    params: {
        file_id: string;
        title: string;
        product_id: string;
        product_anchor_title: string;
    }
): Promise<{ video_id: string }> {
    const body: ShopVideoPostRequest = {
        video_info: {
            file_id: params.file_id,
            title: params.title,
        },
        product_link_info: {
            product_id: params.product_id,       // ⚠️ Single product, not array
            title: params.product_anchor_title,   // Anchor text on the product link
        },
    };

    return shopApiRequest<{ video_id: string }>(
        'POST',
        SHOPPABLE_VIDEO_PATH,
        accessToken,
        { body: body as unknown as Record<string, unknown> }
    );
}

/**
 * Get the status of a published shoppable video.
 * GET /affiliate_creator/202509/videos/{video_id}/status
 *
 * ⚠️ Confirmed via official docs:
 *   - Version is 202509 (not 202505)
 *   - video_id is a PATH parameter appended to the URL
 *   - post_status enum: SUCCESS, FAIL, PROCESSING
 */
export async function getVideoStatus(
    accessToken: string,
    videoId: string
): Promise<ShopVideoStatus> {
    const path = `${VIDEO_STATUS_PATH_PREFIX}/${videoId}/status`;
    return shopApiRequest<ShopVideoStatus>(
        'GET',
        path,
        accessToken
    );
}

// ============================================================
// Video Precheck
// ============================================================

/**
 * Submit a video for content precheck before publishing.
 * POST /affiliate_creator/202505/videos/precheck
 *
 * ⚠️ Exact endpoint path mentioned in official overview but not publicly confirmed.
 * Needs runtime verification.
 */
export async function precheckVideo(
    accessToken: string,
    fileId: string
): Promise<{ precheck_id: string }> {
    return shopApiRequest<{ precheck_id: string }>(
        'POST',
        VIDEO_PRECHECK_PATH,
        accessToken,
        {
            body: { file_id: fileId },
        }
    );
}

/**
 * Get the precheck result for a previously submitted video.
 * GET /affiliate_creator/202505/videos/precheck
 */
export async function getPrecheckResult(
    accessToken: string,
    precheckId: string
): Promise<ShopPrecheckResult> {
    return shopApiRequest<ShopPrecheckResult>(
        'GET',
        VIDEO_PRECHECK_PATH,
        accessToken,
        {
            queryParams: { precheck_id: precheckId },
        }
    );
}

// ============================================================
// Showcase Products
// ============================================================

/**
 * Get products from the creator's showcase (橱窗商品).
 * GET /affiliate_creator/202405/showcases/products
 *
 * ⚠️ Version is 202405, NOT 202505!
 * ⚠️ Pagination uses page_token (from previous response's next_page_token)
 *
 * @param pageSize - Number of products per page (default 20)
 * @param pageToken - Token for next page (from previous response)
 * @param origin - Product origin filter, default 'SHOWCASE'
 */
export async function getShowcaseProducts(
    accessToken: string,
    pageSize: number = 20,
    pageToken?: string,
    origin: 'SHOWCASE' | 'LIVE' = 'SHOWCASE'
): Promise<ShopShowcaseResponse> {
    const queryParams: Record<string, string> = {
        page_size: pageSize.toString(),
        origin,
    };

    if (pageToken) {
        queryParams.page_token = pageToken;
    }

    return shopApiRequest<ShopShowcaseResponse>(
        'GET',
        SHOWCASE_PRODUCTS_PATH,
        accessToken,
        { queryParams }
    );
}

// ============================================================
// Creator Profile
// ============================================================

/**
 * Get the creator's profile information.
 * GET /affiliate_creator/202508/profiles
 *
 * ⚠️ Version is 202508!
 * Required scope: creator.affiliate.info or creator.video.write
 *
 * Used after OAuth callback to get display name and avatar for the account card.
 */
export async function getCreatorProfile(
    accessToken: string
): Promise<ShopCreatorProfile> {
    return shopApiRequest<ShopCreatorProfile>(
        'GET',
        CREATOR_PROFILE_PATH,
        accessToken
    );
}

// ============================================================
// Convenience: Full Video Upload + Publish Flow
// ============================================================

/**
 * Complete 3-step upload and publish flow.
 * Convenience wrapper for: initFileUpload → uploadVideoChunk → postShoppableVideo
 *
 * @returns video_id of the published shoppable video
 */
export async function uploadAndPublishShoppableVideo(
    accessToken: string,
    params: {
        videoBuffer: Buffer;
        fileName: string;
        title: string;
        productId: string;
        productAnchorTitle: string;
    }
): Promise<string> {
    // Step 1: Initialize upload
    const initResult = await initFileUpload(accessToken, {
        file_name: params.fileName,
        file_size: params.videoBuffer.length,
        file_type: 'video',
        total_chunk_count: 1, // Single chunk for files < 5MB
        target_path: SHOPPABLE_VIDEO_PATH,
    });

    // Step 2: Upload video binary
    const uploadResult = await uploadVideoChunk(
        initResult.upload_url,
        initResult.upload_token,
        params.videoBuffer
    );

    // Step 3: Publish shoppable video
    const publishResult = await postShoppableVideo(accessToken, {
        file_id: uploadResult.resource_id,
        title: params.title,
        product_id: params.productId,
        product_anchor_title: params.productAnchorTitle,
    });

    return publishResult.video_id;
}
