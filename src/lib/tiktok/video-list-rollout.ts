const BASE_TIKTOK_OAUTH_SCOPES = [
    'user.info.basic',
    'video.publish',
    'video.upload',
    'user.info.stats',
] as const;

export function isTikTokVideoListScopeEnabled(): boolean {
    return process.env.TIKTOK_VIDEO_LIST_SCOPE_ENABLED === 'true';
}

export function isTikTokVideoListUiEnabled(): boolean {
    return process.env.NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED === 'true';
}

export function shouldPromptTikTokVideoListReauthorization(
    scopes: readonly string[]
): boolean {
    return isTikTokVideoListUiEnabled() && !scopes.includes('video.list');
}

export function getTikTokOAuthScopes(): string[] {
    const scopes: string[] = [...BASE_TIKTOK_OAUTH_SCOPES];
    if (isTikTokVideoListScopeEnabled()) scopes.push('video.list');
    return scopes;
}
