// TikTok Shop API Type Definitions
// Used by: shop-oauth.ts, shop-api.ts, shop-publish-processor.ts, and all Shop API routes

// ============================================================
// OAuth Types
// ============================================================

export interface ShopOAuthConfig {
    appKey: string;
    appSecret: string;
    redirectUri: string;
    serviceId: string; // ≠ appKey! Used in authorization URL, equals App ID in Partner Center
}

/**
 * Token response from TikTok Shop OAuth
 * GET https://auth.tiktok-shops.com/api/v2/token/get
 *
 * ⚠️ CRITICAL: access_token_expire_in and refresh_token_expire_in are UNIX timestamps (epoch seconds),
 * NOT duration in seconds. Use `new Date(value * 1000)` directly, do NOT add to Date.now().
 */
export interface ShopTokenResponse {
    access_token: string;
    refresh_token: string;
    access_token_expire_in: number;   // Unix timestamp (seconds) — 约 7 天后过期
    refresh_token_expire_in: number;  // Unix timestamp (seconds) — 由授权方决定
    open_id: string;                  // 用于识别授权的达人
    seller_name?: string;
}

/**
 * Refresh token response — same structure as initial token response
 * GET https://auth.tiktok-shops.com/api/v2/token/refresh
 */
export type ShopRefreshTokenResponse = ShopTokenResponse;

// ============================================================
// Creator Profile Types
// ============================================================

export interface ShopCreatorAvatar {
    url: string;
    width: number;
    height: number;
}

/**
 * Creator profile from GET /affiliate_creator/202508/profiles
 * Required scope: creator.affiliate.info or creator.video.write
 */
export interface ShopCreatorProfile {
    username: string;
    avatar: ShopCreatorAvatar;
}

// ============================================================
// Showcase Product Types
// ============================================================

export interface ShopProductImage {
    url: string;
    width: number;
    height: number;
}

/**
 * Product from GET /affiliate_creator/202405/showcases/products
 * ⚠️ Version is 202405, NOT 202505
 */
export interface ShopProduct {
    id: string;  // product_id
    shop: {
        name: string;
    };
    addition: {
        customized_main_images: ShopProductImage[];
    };
    price: {
        original_price: {
            minimum_amount: string;
            maximum_amount: string;
        };
    };
    commission_rate?: number;
    status: string;
}

export interface ShopShowcaseResponse {
    products: ShopProduct[];
    total: number;
    next_page_token: string;
}

// ============================================================
// Video Upload & Publishing Types
// ============================================================

/**
 * File upload init response from POST /open/202512/file/init
 */
export interface ShopFileInitResponse {
    upload_url: string;
    upload_token: string;
}

/**
 * File upload chunk response — returns resource_id which is the file_id
 */
export interface ShopFileUploadResponse {
    resource_id: string;  // This is the file_id used in postShoppableVideo
}

/**
 * Shoppable video post request body
 * POST /affiliate_creator/202505/videos
 * ⚠️ Nested structure! product_id is a single string, NOT an array
 */
export interface ShopVideoPostRequest {
    video_info: {
        file_id: string;
        title: string;
    };
    product_link_info: {
        product_id: string;  // ⚠️ Single product ID, API does not support multiple
        title: string;       // 商品锚点文案 (anchor text)
    };
}

/**
 * Video status response from GET /affiliate_creator/202505/videos
 * ⚠️ Status values not precisely documented. Verify at runtime.
 */
export interface ShopVideoStatus {
    video_id: string;
    status: number | string; // 可能是 1-4 或字符串枚举，以实际 API 返回为准
    reason?: string;
}

// ============================================================
// Video Precheck Types
// ============================================================

/**
 * Precheck result from GET /affiliate_creator/202505/videos/precheck
 * ⚠️ Exact endpoint path not confirmed in public docs, verify at runtime
 */
export interface ShopPrecheckResult {
    precheck_id: string;
    status: 'pending' | 'passed' | 'warning' | 'rejected';
    warnings: ShopPrecheckWarning[];
}

export interface ShopPrecheckWarning {
    code: string;
    message: string;
}

// ============================================================
// Database / Task Management Types
// ============================================================

export type ShopTaskStatus =
    | 'pending'
    | 'processing'
    | 'completed'
    | 'partial_failed'
    | 'failed'
    | 'cancelled';

export type ShopTaskItemStatus =
    | 'pending'
    | 'uploading'
    | 'prechecking'
    | 'publishing'
    | 'published'
    | 'failed';

export type ShopPrecheckStatus =
    | 'none'
    | 'pending'
    | 'passed'
    | 'warning'
    | 'rejected';

export type ShopVideoSource = 'assets' | 'upload' | 'url';

export interface ShopPublishTask {
    id: string;
    user_id: string;
    task_name?: string;
    title_template?: string;
    total_items: number;
    success_count: number;
    failed_count: number;
    status: ShopTaskStatus;
    created_at: string;
    updated_at: string;
    started_at?: string;
    completed_at?: string;
}

export interface ShopPublishTaskItem {
    id: string;
    task_id: string;
    account_id: string;
    video_url: string;
    video_source: ShopVideoSource;
    title: string;
    product_id: string;
    product_anchor_title?: string;
    // Shop API returned IDs
    file_id?: string;
    video_id?: string;
    precheck_id?: string;
    precheck_status: ShopPrecheckStatus;
    // Status tracking
    status: ShopTaskItemStatus;
    error_message?: string;
    published_at?: string;
    created_at: string;
    updated_at: string;
}

// ============================================================
// API Response Wrapper
// ============================================================

/**
 * Standard TikTok Shop API response envelope
 * All Shop API v2 responses follow this structure
 */
export interface ShopApiResponse<T = unknown> {
    code: number;    // 0 = success
    message: string; // "Success" or error description
    data: T;
    request_id?: string;
}
