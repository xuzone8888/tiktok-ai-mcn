# Social Comments Phase 0 Audit

## 0. Git 状态

开始审计前执行的 `git status --short --branch` 输出：

```text
## feat/social-engagement...origin/feat/social-engagement
 M env.example
 M env.template
 M src/components/layout/sidebar.tsx
 M src/lib/facebook/oauth.ts
 M src/lib/instagram/oauth.ts
 M src/lib/youtube/oauth.ts
?? src/app/(main)/social-comments/
?? src/app/api/social-comments/
?? src/lib/social-comments/
?? supabase/migrations/20260708_social_comments.sql
```

说明：工作区开始审计前已经存在未提交的评论相关功能改动和 OAuth scope 改动。本审计未回退这些改动，也未继续修改功能代码。为避免结论被未提交改动污染，OAuth scope 同时标注了 `HEAD` 基线和当前工作区差异。

参考官方文档：
- YouTube `commentThreads.list` 可按 `videoId` 读取视频评论，quota cost 1；`comments.insert` 用于回复既有评论，要求 `youtube.force-ssl` scope，quota cost 50。
- Meta Graph API `/{object-id}/comments` 文档显示读取 Page 内容评论涉及 Page Public Content Access/相关 Page 权限，发布评论需要 `pages_manage_engagement`。
- Instagram Graph API media comments/replies 文档显示评论读取/回复涉及 `instagram_manage_comments` 或 Instagram Login 的 `instagram_business_manage_comments`。
- TikTok 官方文档目录把普通 Login Kit / Content Posting API 与 Research API 分开；视频评论查询在 Research API 下，端点为 `/v2/research/video/comment/list/`，scope 为 `research.data.basic`，不是普通用户评论管理能力。

## 1. 总体结论

- YouTube 是第一优先级：账号、token、task、task item、`youtube_video_id`、`youtube_watch_url` 都已落库；`youtube_video_id` 可直接作为 `commentThreads.list(videoId=...)` 的稳定内容 ID。
- YouTube 的 clean `HEAD` OAuth scope 缺 `youtube.force-ssl`；当前脏工作区已加上。阶段 1 若从干净分支开发，需要先补 scope，并通过 `youtube_accounts.scopes` 判断旧账号必须重绑。
- Instagram 在 `status='published'` 时，`instagram_video_id` 来自最终 `media_id`，理论上可用于 `/{media_id}/comments`；但 `processing/container_created` 路径可能存的是 container id，评论模块必须只读 published item，并建议先实测一个已发布 media id。
- Facebook 当前只明确保存 `facebook_video_id` 和 `facebook_watch_url`，没有保存 Page post id。不要假设 `facebook_video_id` 一定等价于可读评论对象；阶段 1 前需要用官方 Graph Explorer/真实 Page token 验证 `/{facebook_video_id}/comments`，否则最小补丁是补 `facebook_post_id`/真实 permalink。
- TikTok 普通 Login Kit / Content Posting API scopes 只有用户信息、发布、上传、统计，没有评论读取/回复 scope；第一版必须是占位，不做评论读取/回复。
- Facebook、Instagram 的 clean `HEAD` scope 均缺评论管理 scope；当前脏工作区已加上。所有旧 Meta 账号都需要通过 `scopes` 判断是否重绑。
- YouTube/Facebook/Instagram token 分表是 service-role-only 设计；TikTok token 在 `tiktok_accounts` 表中且该表有用户 SELECT RLS，属于既有安全风险，评论后端必须只经服务端读取，不下发 token。
- 阻塞项：Facebook post/comment object ID 不确定；Instagram media id/token 类型需实测；TikTok 评论管理官方能力不存在。

## 2. 平台数据矩阵

| 平台 | 账号表 | token 表 | task item 表 | 内容 ID 字段 | URL 字段 | 是否足够读取评论 | 是否足够回复 | 备注 |
|---|---|---|---|---|---|---|---|---|
| YouTube | `youtube_accounts` | `youtube_account_tokens` | `youtube_publish_task_items` | `youtube_video_id` | `youtube_watch_url` | 是 | 补/确认 `youtube.force-ssl` 后是 | `youtube_video_id` 是 YouTube video id，可用于 `commentThreads.list(videoId)`。 |
| Facebook | `facebook_accounts` | `facebook_account_tokens` | `facebook_publish_task_items` | `facebook_video_id` | `facebook_watch_url` | 有风险 | 有风险 | 没有 `facebook_post_id`。必须验证 `/{video-id}/comments` 是否满足 Page 视频评论读取/回复；否则需补 post id。 |
| Instagram | `instagram_accounts` | `instagram_account_tokens` | `instagram_publish_task_items` | `instagram_video_id` | `instagram_watch_url` | published 状态下基本足够 | 补/确认 comment scope 后基本足够 | published 时是最终 media id；processing/container 路径可能是 container id，必须过滤状态。 |
| TikTok | `tiktok_accounts` | 无独立 token 表，token 在账号表 | `publish_task_items` | `tiktok_video_id` / `tiktok_share_id` / `tiktok_publish_id` | 无可靠 URL 字段 | 否，普通 API 不足 | 否 | Research API 是只读研究能力，不应当当作普通创作者评论管理。 |

## 3. OAuth Scope 矩阵

| 平台 | 当前 scope | 评论读取所需 | 评论回复所需 | 老账号是否需重绑 | 风险 |
|---|---|---|---|---|---|
| YouTube | `HEAD`: `youtube.upload`, `youtube.readonly`；当前脏工作区另有 `youtube.force-ssl` | `youtube.readonly` 可读公开/授权可见评论 | `youtube.force-ssl` | 是，缺 `youtube.force-ssl` 的账号需重绑 | `comments.insert` quota 50；视频评论关闭会返回 403。 |
| Facebook | `HEAD`: `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_posts`；当前脏工作区另有 `pages_manage_engagement` | `pages_read_engagement`，部分对象/公开内容可能涉及 Page Public Content Access | `pages_manage_engagement` | 是，缺 `pages_manage_engagement` 的 Page 需重绑 | App Review、Page task、New Page Experience 权限和 object id 都可能影响。 |
| Instagram | `HEAD` Facebook Login: `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`；`HEAD` Native: `instagram_business_basic`, `instagram_business_content_publish`；当前脏工作区另有 comment scopes | Facebook Login: `instagram_basic` + `instagram_manage_comments`；Native: `instagram_business_basic` + `instagram_business_manage_comments` | 同读取评论管理 scope | 是，缺 comment scope 的账号需重绑 | 如果使用 embedded/native URL 覆盖 scopes，需要确认配置里包含 comment scope。 |
| TikTok | `user.info.basic`, `video.publish`, `video.upload`, `user.info.stats` | 普通 Login Kit / Content Posting API 无评论读取 scope | 无公开回复 scope | 重绑也无效 | 只能展示已发布视频和跳转/提示；Research API 不适合作为创作者评论管理。 |

## 4. 发布链路 ID 写入审计

### YouTube

- 表结构：`youtube_accounts.channel_id` 保存频道 ID；`youtube_publish_task_items.youtube_video_id` 和 `youtube_watch_url` 保存发布结果。
- 发布处理器：`src/lib/youtube/processor.ts` 调用 `uploadYouTubeVideoFromUrl`，成功后写入 `youtube_video_id: upload.videoId`、`youtube_watch_url: upload.watchUrl`、`status: 'published'`、`published_at`。
- 幂等保护：如果 item 已有 `youtube_video_id`，处理器会补记为 `published`，避免重复上传。
- 字段风险：仅 published item 可靠。`youtube_video_id` 为空的 pending/failed/cancelled item 不应进入评论同步。
- 结论：不需要数据库补丁；需要补/确认 OAuth scope 和旧账号重绑判断。

### Facebook

- 表结构：`facebook_accounts.channel_id` 实际是 Page ID；`facebook_publish_task_items.facebook_video_id` 和 `facebook_watch_url` 保存发布结果。
- 发布处理器：`src/lib/facebook/processor.ts` 调用 `uploadFacebookVideoFromUrl`，成功后写入 `facebook_video_id: upload.videoId`、`facebook_watch_url: upload.watchUrl`、`status: upload.published ? 'published' : 'draft_created'`、`published_at`。
- 当前发布实现只支持公开发布，`uploadFacebookVideoFromUrl` 对非公开直接报错；但表和状态语义仍保留 `draft_created`。
- 关键风险：当前链路没有保存 Page post id。`facebook_watch_url` 是 `https://www.facebook.com/watch/?v=${videoId}` 形式，不等于 Graph API post id，也不是可审计的 permalink。
- 评论读取对象选择：不能凭空确定应使用 Page post id 还是 video id。阶段 1 前必须用真实 Page token 验证 `/{facebook_video_id}/comments` 是否能读取/回复目标 Page 视频评论；若不能，最小补丁是发布后补查并保存 `facebook_post_id` 和真实 `permalink_url`。
- 结论：第一版不能直接宣称端到端可用；需要先验证或补字段。

### Instagram

- 表结构：`instagram_accounts.channel_id` 是 IG user id；`instagram_publish_task_items.instagram_video_id` 和 `instagram_watch_url` 保存发布结果。
- 发布实现：`src/lib/instagram/publish.ts` 中成功发布后 `publishInstagramMediaContainer` 返回最终 `mediaId`，随后 `getInstagramMediaPermalink(mediaId)` 获取 permalink，返回 `videoId: mediaId`、`containerId: creationId`、`watchUrl: permalink`。
- 发布处理器：`src/lib/instagram/processor.ts` 写入 `status: upload.published ? 'published' : 'container_created'`、`instagram_video_id: upload.videoId`、`instagram_watch_url: upload.watchUrl`、`published_at`。
- container 风险：`markItemContainerProcessing` 会在容器仍处理时把 `instagram_video_id` 写成 `containerId`，状态仍为 `processing`；表也允许 `container_created`。评论模块必须只同步 `status='published'` 且有 `published_at`/`instagram_watch_url` 的 item。
- token 类型：Facebook Login 模式下 token 表 `access_token` 存 Page access token；Native Instagram Login 模式下 `pageAccessToken` 实际是长效 IG/user token。该 token 应先实测 `/{media_id}/comments` 和 `/{comment_id}/replies`。
- 结论：可以作为第二优先级候选，但最大不确定点是 token 类型与 media id 实测。

### TikTok

- 表结构：`tiktok_accounts` 存账号和 token；`publish_task_items` 初始有 `tiktok_publish_id`、`tiktok_share_id`，后续迁移补 `tiktok_video_id`、统计字段。
- 发布处理器：`src/lib/publish-processor.ts` 在 init 后写 `tiktok_publish_id`；状态查询返回 `PUBLISH_COMPLETE` 或 `SEND_TO_USER_INBOX` 时写 `status: 'published'`、`tiktok_share_id: status.postId`、`tiktok_video_id: status.postId`。
- TikTok API：`src/lib/tiktok/content-posting.ts` 从 `publicaly_available_post_id?.[0]` 取 `postId`。字段名来自 TikTok 返回结构，代码里拼写为 `publicaly_available_post_id`。
- URL 风险：没有可靠 URL 字段。若账号表有 `username` 且 `tiktok_video_id` 是公开视频 ID，可 best-effort 拼 `https://www.tiktok.com/@{username}/video/{id}`，但不应作为强保证；缺 username 时只能展示 ID 和原平台处理提示。
- 结论：第一版必须是占位，不做评论读取/回复；只展示已发布视频、评论数统计和“去 TikTok 处理”提示。

## 5. 安全与 RLS 审计

已有保护：
- 四个平台账号表均有 `user_id`。
- 四个平台 task 表均有 `user_id`。
- YouTube/Facebook/Instagram task item 的 RLS 通过 parent task 回查 `user_id`，插入/更新还校验 account 属于当前用户。
- TikTok `publish_task_items` 的 RLS 通过 `publish_tasks.user_id` 回查。
- YouTube/Facebook/Instagram token 表启用 RLS，但没有用户 SELECT policy，注释明确为 service-role-only token storage。
- 账号列表 API 不下发 YouTube/Facebook/Instagram token；TikTok 账号 API 也手动筛掉 token 字段。

必须注意的 service role 查询：
- 读取 token 前，必须先用平台账号表 `id + user_id` 校验账号归属，再按 `account_id` 读 token 表。
- 查询已发布内容时，service role 会绕过 RLS，必须通过 task 表显式加 `user_id`，不能只按 item id/account id 查。
- 回复评论时，必须先按本地评论记录的 `user_id` 校验，再使用该记录的 platform/account/content/comment id。
- 写入任何评论缓存/回复记录时，`user_id` 必须来自服务端 auth user，不允许来自请求体。
- TikTok 因 token 在 `tiktok_accounts` 中，service role 查询必须加 `user_id` 和 `account_type='normal'`；此外直接用 Supabase anon 访问时，现有 RLS SELECT 可能允许用户读到自己行内 token，这是既有设计风险。

token 不下发前端确认：
- YouTube/Facebook/Instagram token 在单独 token 表，普通账号 API 只返回 account metadata 和 scopes。
- TikTok token 当前不通过账号 API 下发，但数据库层没有列级隔离；阶段 1 不应新增任何客户端直接查询 `tiktok_accounts` token 字段的路径。

## 6. 阶段 1 前置改动清单

### 必须先修

- Facebook：验证 `/{facebook_video_id}/comments` 是否对当前 Page 视频可读写；若不成立，补 `facebook_post_id` 和真实 `permalink_url` 写入。
- OAuth：从干净 `HEAD` 开发时先补 YouTube `youtube.force-ssl`、Facebook `pages_manage_engagement`、Instagram `instagram_manage_comments` / `instagram_business_manage_comments`。
- 账号重绑判定：所有平台账号页或评论后端必须基于 `accounts.scopes` 判断缺失评论 scope 并提示重绑。
- Instagram：用一个已发布 `instagram_video_id` 实测 `/{media_id}/comments` 和 `/{comment_id}/replies`，确认 token 类型可用。

### 可以阶段 1 同时修

- 评论后端内容查询：只允许读取 `status='published'` 且外部内容 ID 非空的 task item。
- TikTok：做占位 UI，只展示 published item、`tiktok_video_id`/`tiktok_share_id`、统计 comment_count 和原平台处理提示。
- TikTok 标准发布缺 `source_video_id/source_video_name`：展示时 fallback 到 `title`/`video_url`，多任务才使用 source fields。
- 后端 service role 查询补全显式 `user_id` 校验。

### 可延期

- 统一评论中心入口；阶段 1 可先放平台页内或受控入口，避免过早开放统一 `/social-comments`。
- 评论缓存统一表、增量同步、webhook 落库和后台定时同步。
- Facebook draft/comment moderation、Instagram hidden comment 管理、YouTube moderationStatus 等管理能力。
- TikTok Research API 只读评论同步；不作为普通创作者评论管理主线。

## 7. 推荐实施顺序

1. YouTube：数据最完整，`youtube_video_id` 直接可用；先补/确认 `youtube.force-ssl` 和旧账号重绑提示，再做端到端读取/回复。
2. Instagram：优先于 Facebook，前提是先实测一个 `status='published'` 的 `instagram_video_id` 确实是 media id，且 token 可调用 comments/replies。
3. Facebook：在验证 `facebook_video_id` comments edge 或补齐 `facebook_post_id` 后再做；否则只做受限读取实验，不承诺端到端。
4. TikTok 占位：仅展示已发布视频和跳转/手动处理提示，不做读取/回复。
5. 统一中心延期：四个平台能力差异较大，先把 YouTube/Instagram 平台内闭环做稳，再抽统一中心。
