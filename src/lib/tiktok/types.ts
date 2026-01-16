// TikTok API Type Definitions

// OAuth Types
export interface TikTokOAuthConfig {
    clientKey: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
}

export interface TikTokAuthState {
    state: string;
    codeVerifier: string;
    userId: string;
    createdAt: number;
}

export interface TikTokTokenResponse {
    access_token: string;
    expires_in: number;
    open_id: string;
    refresh_expires_in: number;
    refresh_token: string;
    scope: string;
    token_type: string;
}

export interface TikTokRefreshTokenResponse {
    access_token: string;
    expires_in: number;
    open_id: string;
    refresh_expires_in: number;
    refresh_token: string;
    scope: string;
    token_type: string;
}

// User Info Types
export interface TikTokUserInfo {
    open_id: string;
    union_id?: string;
    avatar_url?: string;
    avatar_url_100?: string;
    avatar_url_200?: string;
    avatar_large_url?: string;
    display_name?: string;
    bio_description?: string;
    profile_deep_link?: string;
    is_verified?: boolean;
    follower_count?: number;
    following_count?: number;
    likes_count?: number;
    video_count?: number;
}

export interface TikTokUserInfoResponse {
    data: {
        user: TikTokUserInfo;
    };
    error: {
        code: string;
        message: string;
        log_id: string;
    };
}

// Content Posting Types
export interface TikTokVideoUploadInit {
    source_info: {
        source: 'FILE_UPLOAD' | 'PULL_FROM_URL';
        video_size?: number;
        chunk_size?: number;
        total_chunk_count?: number;
        video_url?: string;
    };
}

export interface TikTokVideoUploadInitResponse {
    data: {
        publish_id: string;
        upload_url?: string;
    };
    error: {
        code: string;
        message: string;
        log_id: string;
    };
}

export interface TikTokPublishVideoRequest {
    post_info: {
        title: string;
        privacy_level: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
        disable_duet?: boolean;
        disable_comment?: boolean;
        disable_stitch?: boolean;
        video_cover_timestamp_ms?: number;
        brand_content_toggle?: boolean;
        brand_organic_toggle?: boolean;
        is_aigc?: boolean;
    };
    source_info: {
        source: 'FILE_UPLOAD' | 'PULL_FROM_URL';
        video_url?: string;
    };
}

export interface TikTokPublishStatusResponse {
    data: {
        status: 'PROCESSING_DOWNLOAD' | 'PROCESSING_UPLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED';
        fail_reason?: string;
        publicaly_available_post_id?: string[];
        uploaded_bytes?: number;
    };
    error: {
        code: string;
        message: string;
        log_id: string;
    };
}

// Database Types
export interface TikTokAccount {
    id: string;
    user_id: string;
    open_id: string;
    union_id?: string;
    display_name?: string;
    avatar_url?: string;
    follower_count: number;
    following_count: number;
    likes_count: number;
    video_count: number;
    access_token: string;
    refresh_token: string;
    token_expires_at: Date;
    scopes: string[];
    account_type: 'normal' | 'shop_creator' | 'business';
    status: 'active' | 'expired' | 'revoked';
    created_at: Date;
    updated_at: Date;
}

export interface PublishTask {
    id: string;
    user_id: string;
    task_name?: string;
    publish_type: 'normal' | 'shop_product';
    title_template?: string;
    privacy_level: string;
    allow_comment: boolean;
    allow_duet: boolean;
    allow_stitch: boolean;
    brand_content_toggle: boolean;
    brand_organic_toggle: boolean;
    is_aigc: boolean;
    scheduled_at?: Date;
    batch_interval_seconds: number;
    status: 'pending' | 'scheduled' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'cancelled';
    total_items: number;
    success_count: number;
    failed_count: number;
    product_info?: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
    started_at?: Date;
    completed_at?: Date;
}

export interface PublishTaskItem {
    id: string;
    task_id: string;
    account_id: string;
    video_url: string;
    video_source: 'assets' | 'upload' | 'url';
    source_asset_id?: string;
    title: string;
    tiktok_publish_id?: string;
    tiktok_share_id?: string;
    status: 'pending' | 'uploading' | 'processing' | 'published' | 'failed';
    error_code?: string;
    error_message?: string;
    scheduled_at?: Date;
    published_at?: Date;
    created_at: Date;
    updated_at: Date;
}

// API Error Types
export interface TikTokAPIError {
    code: string;
    message: string;
    log_id?: string;
}

export function isTikTokAPIError(error: unknown): error is { error: TikTokAPIError } {
    return (
        typeof error === 'object' &&
        error !== null &&
        'error' in error &&
        typeof (error as { error: unknown }).error === 'object'
    );
}
