# YouTube Comments Review Script

## Purpose

This video demonstrates manual YouTube comment management for videos published through this platform. The feature reads comments on published YouTube videos and lets the connected channel owner write manual replies.

中文说明：本脚本用于 YouTube 审核演示，只覆盖本平台发布的 YouTube 视频评论读取和人工回复。

## Demo Preconditions

- The reviewer can sign in to the app with a test account.
- The test account has a connected YouTube channel.
- The connected channel granted `youtube.readonly` and `youtube.force-ssl`.
- At least one YouTube video was published through the app and has a stored YouTube video ID.
- The demo environment enables only the YouTube comments path:
  - `SOCIAL_COMMENTS_API_ENABLED=true`
  - `SOCIAL_COMMENTS_ENABLED_PLATFORMS=youtube`
  - `NEXT_PUBLIC_YOUTUBE_COMMENTS_ENABLED=true`
  - `YOUTUBE_COMMENTS_AUTO_SYNC_ENABLED=false`
  - `NEXT_PUBLIC_SOCIAL_COMMENTS_CENTER_ENABLED=false`
- The YouTube Comment Management tab only appears when `NEXT_PUBLIC_YOUTUBE_COMMENTS_ENABLED=true`; `/youtube-publish/comments` uses the same flag.
- Automatic refresh is disabled by default. If reviewers need to test it, temporarily set `YOUTUBE_COMMENTS_AUTO_SYNC_ENABLED=true` in the test environment.

## Review Video Flow

1. Sign in to the app with the reviewer or test creator account.
2. Open the sidebar and go to Social Publishing, then select YouTube Video Management.
3. In YouTube Video Management, switch to the Comment Management tab.
4. Confirm the embedded comments area shows YouTube channel and YouTube video filters.
5. Note for troubleshooting: the temporary compatibility route `/youtube-publish/comments` can still be opened directly, but the primary review path is YouTube Video Management > Comment Management. The standalone sidebar entry is not shown.
6. Select the connected YouTube channel.
7. Select a published YouTube video from the video selector.
8. Click Open on YouTube to verify the selected item opens the original YouTube video.
9. Click Sync selected to read the latest comments for that video.
10. Wait for the comment list to refresh.
11. Choose an inbound comment that is replyable.
12. Type a human-written reply in the reply box.
13. Click Reply.
14. After the reply is sent, refresh the list or observe the reply in the thread.
15. Click Open comment, when available, to verify the comment or reply context on YouTube.

中文说明：当前侧边栏只展示 YouTube 视频管理。主审核路径是在 YouTube 视频管理内切换到评论管理；临时路由 `/youtube-publish/comments` 仍保留用于排障，不作为主审核路径。

## Optional Auto Refresh Test

Only include this section when the test environment explicitly sets `YOUTUBE_COMMENTS_AUTO_SYNC_ENABLED=true`.

1. Open YouTube Video Management.
2. Switch to the Comment Management tab.
3. Select a connected YouTube channel.
4. Select a published YouTube video with comments.
5. Confirm the automatic refresh notice appears.
6. Do not click Sync selected.
7. Wait for the automatic refresh to update the comments list.
8. Confirm replies still require manual typing and clicking Reply.

Do not describe automatic replies in the review flow. The system does not provide automatic replies and should not send replies without a user action.

## Permission Explanation

- `youtube.readonly` is required to read YouTube video comments and related comment metadata.
- `youtube.force-ssl` is required by the YouTube Data API for write operations such as posting a comment reply.

## Product Boundaries

- The app does not generate automatic replies.
- The app does not send batch replies.
- The user must manually type and submit each reply.
- The comments page only manages comments for YouTube videos that were published through this platform.
- Automatic refresh, when enabled for testing, only reads comments and consumes YouTube comment read quota.
- The unified comments center remains disabled during the YouTube-only review path.
