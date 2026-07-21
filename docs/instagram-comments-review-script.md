# Instagram Comments Review Script

## Scope

This review path is limited to Native Instagram Login in the test environment. The deployment must use `INSTAGRAM_AUTH_MODE=instagram`. Facebook Login accounts are not eligible for this phase.

The Instagram comments page is a temporary, independently gated review route. It is not linked from the sidebar and does not enable the unified comments center.

## Preconditions

- Keep `NEXT_PUBLIC_INSTAGRAM_COMMENTS_ENABLED=false` outside an explicitly scheduled Instagram review session.
- For the review session, enable `NEXT_PUBLIC_INSTAGRAM_COMMENTS_ENABLED=true` and explicitly include `instagram` in `SOCIAL_COMMENTS_ENABLED_PLATFORMS`.
- Keep `NEXT_PUBLIC_SOCIAL_COMMENTS_CENTER_ENABLED=false`.
- Reconnect the Instagram professional test account after the scope-truth fix.
- Confirm the account is a Business or Creator account.
- Confirm `instagram_accounts.scopes` actually contains both `instagram_business_basic` and `instagram_business_manage_comments`. Requested scopes are not proof of consent.
- Confirm the stored token and `graph.instagram.com` host match Native Instagram Login.
- Use content published through this platform whose task item has `status='published'`.
- Confirm `instagram_video_id` is the final media ID, not a creation/container ID.
- Confirm `instagram_watch_url` is present and opens the published Instagram content.

## Test Entry

Open `/instagram-publish/comments` directly. The route returns 404 unless `NEXT_PUBLIC_INSTAGRAM_COMMENTS_ENABLED=true` and `INSTAGRAM_AUTH_MODE=instagram`.

Even with the page flag enabled, Facebook Login mode is intentionally rejected. The route does not load the complete OAuth configuration and does not infer auth mode from stored account scopes.

The page must show only Instagram account and published-content filters. It must not show All, YouTube, Facebook, or TikTok platform controls.

## Current Limitations

- No automatic comment synchronization.
- No automatic replies.
- No webhook-driven comment persistence.
- Comment reads currently cover only the first page.
- Embedded replies can also be truncated.
- Replies are always entered and submitted manually.
- The temporary locked page requires a specific published content selection before Sync is enabled; it cannot trigger recent/batch synchronization.

## Phase 3B.1 Live Test Order

Do not execute these live API steps during Phase 3B.0. For the explicitly authorized Phase 3B.1 session:

1. Reconnect the dedicated Native Instagram Login test account.
2. Publish new test content through this platform or select an eligible published record.
3. From a separate external Instagram account, add a real comment to the test media.
4. Open `/instagram-publish/comments` and select the connected Instagram account.
5. Select the published Instagram content.
6. Trigger one manual comment sync.
7. Confirm the external comment appears and review any first-page truncation metadata.
8. Enter and submit one manual reply.
9. Use **Open on Instagram** to verify the reply on the original content.
10. Record HTTP status, Meta error code/subcode, action-log metadata, and quota/rate-limit evidence without recording tokens.

## Rollback

1. Set `NEXT_PUBLIC_INSTAGRAM_COMMENTS_ENABLED=false` to hide the temporary route.
2. Remove `instagram` from `SOCIAL_COMMENTS_ENABLED_PLATFORMS` to block Instagram comment API operations.
3. If a full comments shutdown is required, set `SOCIAL_COMMENTS_API_ENABLED=false`.

Disabling the page flag does not disable APIs by itself; the API master switch and platform allowlist remain the server-side controls.
