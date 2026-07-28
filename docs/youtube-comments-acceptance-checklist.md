# YouTube Comments Acceptance Checklist

Use this checklist before running a real YouTube comments acceptance test. Do not use production creator accounts for the first validation run.

## 1. Environment Configuration

- Supabase migration `supabase/migrations/20260708_social_comments.sql` has been executed.
- The migration created these tables:
  - `social_comments`
  - `social_comment_sync_runs`
  - `social_comment_action_logs`
- Row Level Security is enabled on all three tables.
- User clients can only `SELECT` their own rows; writes are performed by server-side service role code.
- YouTube OAuth client credentials are configured:
  - `YOUTUBE_CLIENT_ID`
  - `YOUTUBE_CLIENT_SECRET`
  - `YOUTUBE_REDIRECT_URI`
- YouTube comments rollout flags are set:
  - `SOCIAL_COMMENTS_API_ENABLED=true`
  - `SOCIAL_COMMENTS_ENABLED_PLATFORMS=youtube`
  - `NEXT_PUBLIC_YOUTUBE_COMMENTS_ENABLED=true`
  - `NEXT_PUBLIC_SOCIAL_COMMENTS_CENTER_ENABLED=false`
- The unified comments center remains disabled during YouTube-only acceptance.

## 2. Test Account Requirements

- The test user can sign in to the app.
- The test user has connected a YouTube channel through `/youtube-publish/accounts`.
- The stored YouTube account scopes include:
  - `https://www.googleapis.com/auth/youtube.force-ssl`
- The test user has at least one YouTube publish task item with:
  - `status = 'published'`
  - `youtube_video_id` not empty
  - a valid `youtube_watch_url` when available
- The YouTube video allows comments.
- The video has at least one inbound comment for the sync and reply test.

## 3. Acceptance Steps

1. Sign in with the test user.
2. Open `/youtube-publish/comments`.
3. Confirm the page title is `YouTube Comments`.
4. Select the connected YouTube channel.
5. Select a published YouTube video.
6. Click `Open on YouTube` and confirm the original YouTube video opens.
7. Return to the app and click `Sync selected`.
8. Confirm the comment list appears after sync.
9. Select an inbound comment with an enabled reply box.
10. Type a human-written reply.
11. Click `Reply`.
12. Confirm the reply appears in the comment thread after refresh.
13. Click `Open comment` when available and verify the comment context on YouTube.

## 4. Expected Failure Behavior

### Missing Scope

- Setup: Use an older connected account missing `youtube.force-ssl`.
- UI: The YouTube comments page shows a reconnect warning and a CTA to `/youtube-publish/accounts`.
- API: Sync or reply returns `missing_comment_scope` if attempted server-side.
- Action log: A `permission_error` action is recorded with `error_code = 'missing_comment_scope'`.

### Comments Disabled On Video

- Setup: Select a published video where comments are disabled.
- UI: Sync shows the platform error message from YouTube.
- API: Sync fails with the YouTube error code and HTTP status returned by the platform.
- Action log: The sync action is marked `failed` with the platform error code, message, `httpStatus`, and `retryable` metadata.

### YouTube Quota Or Rate Limit

- Setup: YouTube returns quota or rate-limit failure.
- UI: Sync or reply shows the platform error message.
- API: The response uses the mapped YouTube error code and status.
- Action log: Metadata records `retryable`, `httpStatus`, and `retryAfter` when YouTube returns a `Retry-After` header.
- Retry: The app does not automatically retry. The user must retry manually later.

### Expired Or Revoked Token

- Setup: Revoke or expire the connected YouTube token.
- UI: The operation shows an authorization/token error and the account can be reconnected from `/youtube-publish/accounts`.
- API: Sync or reply fails before a successful platform operation.
- Action log: A `token_error` action is recorded when the service detects a missing token. Other token failures are recorded on the failed sync or reply action with the platform error.

### Repeated Sync Within 60 Seconds

- Setup: Click sync for the same user, platform, account, and video within 60 seconds.
- UI: The second attempt shows the throttling message.
- API: The second request returns `sync_throttled` or `sync_already_running`.
- Action log: The second request does not call YouTube again. The existing sync action log is used as the throttle boundary.

### Duplicate Reply Idempotency

- Setup: Submit the same reply request with the same idempotency key.
- UI: The user should not see duplicate sent replies.
- API: A completed duplicate returns the existing saved reply when available, or a duplicate request status.
- Action log: The original reply action keeps the idempotency key. Conflicting reuse on another comment returns `idempotency_key_conflict`.

## 5. Post-Test Checks

- `social_comments` contains synced inbound comments and the sent outbound reply for the test user.
- `social_comment_sync_runs` contains the sync attempt with final status and synced count.
- `social_comment_action_logs` contains sync and reply actions with terminal statuses.
- No unified comments center route was enabled for the test.

## Auto Refresh Acceptance

Keep automatic comment refresh disabled by default:

- `YOUTUBE_COMMENTS_AUTO_SYNC_ENABLED=false`

Only enable it temporarily in a test environment when validating the automatic refresh path:

- `YOUTUBE_COMMENTS_AUTO_SYNC_ENABLED=true`

### Preconditions

- `SOCIAL_COMMENTS_API_ENABLED=true`
- `SOCIAL_COMMENTS_ENABLED_PLATFORMS=youtube`
- `NEXT_PUBLIC_YOUTUBE_COMMENTS_ENABLED=true`
- A YouTube account is connected and includes the required scope:
  - `https://www.googleapis.com/auth/youtube.force-ssl`
- At least one video was published successfully through this platform.
- The selected YouTube video has real comments.

### Steps

1. Sign in with the test user.
2. Open YouTube Video Management.
3. Switch to the Comment Management tab.
4. Select the YouTube channel.
5. Select a published YouTube video.
6. Confirm the automatic refresh notice appears.
7. Do not click manual sync.
8. Wait for the automatic refresh to run.
9. Confirm the comment list updates.
10. Refresh the page or open a second browser tab with the same selected channel and video.
11. Confirm the same target is not synced again within 5 minutes.

### Action Log Checks

- `social_comment_action_logs.action_type = 'sync'`
- Automatic refresh logs have `metadata.sync_source = 'auto'`.
- Automatic refresh logs have `metadata.throttle_ms = 300000`.
- Automatic refresh `idempotency_key` starts with `sync:auto`.

### Manual Sync Comparison

- Manual sync logs have `metadata.sync_source = 'manual'`.
- Manual sync logs have `metadata.throttle_ms = 60000`.
- Manual sync should not be blocked by the 5-minute automatic refresh window.
- Manual sync is still protected by the existing 60-second server throttle.

### Quota And Reply Boundaries

- Automatic refresh makes a real YouTube Data API `commentThreads.list` request and consumes YouTube read quota.
- Automatic refresh only reads comments for the selected YouTube video.
- Replies are never automatic. Every reply must be typed and submitted manually by the user.

### Rollback

- To stop automatic refresh immediately, set `YOUTUBE_COMMENTS_AUTO_SYNC_ENABLED=false`.
- To hide comment management entirely, set `NEXT_PUBLIC_YOUTUBE_COMMENTS_ENABLED=false`.
- To shut down all social comments APIs, set `SOCIAL_COMMENTS_API_ENABLED=false`.
