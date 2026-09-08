# TikTok API 申请与上线执行流程

> 状态：执行中。功能已迁移到最新 `main` 基线，Gate 1 正在重新冻结；
> Gate 2 仅保留历史本地预检记录，必须等新的精确 commit/tree 通过验收后重新执行。
> Production 公开证据和稳定 review staging 均尚未部署。本文档不授权 Git 推送、DNS、TLS、
> 服务器部署、Production migration、TikTok Portal 创建/提交、OAuth 或 Production 功能开关。

## 1. 目标与能力分轨

Star Gaze 的 TikTok 能力分为两套独立审批链：

- A／TikTok for Developers：Display API `video.list`，用于视频列表和聚合统计；
  不包括评论正文、回复线程或创建回复。
- B／TikTok API for Business Developers：Accounts API，用于评论/回复列表和
  用户主动回复；不包括 Login Kit、Content Posting 或 Display API。

`video.list` 返回的 `comment_count` 只是视频总评论数，不能代替
Business Accounts API 的评论正文、作者和回复线程。

## 2. 当前进度基线



### 已完成

- TikTok for Developers 的 Production App 已有 Login Kit 和 Content Posting 能力。
- 普通 Web OAuth 已在 Sandbox target user 上真实验证成功，账号、state 和
  secure token 数据不变量已核对。
- `video.list` 功能、scope rollout gate、列表/分页/统计和审核材料已实现。
- TikTok API for Business Developer Profile 已审核通过。
- Business 评论 OAuth、Token 安全、读取、回复幂等、独立撤权、限流和
  恢复游标代码已实现。
- `20260808_tiktok_business_comment_controls.sql` 已在 staging PostgreSQL 验证，
  包括 RPC/ACL、generation fence、双连接竞态和限流并发；未在 Production 执行。
- 公开联系邮箱已在代码中统一为 `developer@toryxai.com`，数据保留文案已与
  真实实现对齐。
- 稳定 HTTPS staging 方案已通过只读审核，但未实际创建 DNS/证书/服务。
- 历史保留点为未推送的旧分支 commit
  `965af806ab20a38f17359bfc84d8e0324da39d70`（tree
  `255942eb271b0332a53ff1564984cda84f9d1099`）。它仅用于追溯，不是当前候选或部署身份。
- 当前迁移基线为 `main` commit
  `30848db5462ac6345bc38c4b98f792ab373699f7`；TikTok 改动仍在未提交工作树中。
- 当前工作树的阶段性验证为 Node 20.19.5、380 total / 379 pass /
  1 skipped，type-check、全量 `src` ESLint、Production build 和
  `git diff --check` 通过。这些结果不代表已冻结 artifact。

### 未完成

- 最新 `main` 迁移尚未完成 Gate 1 复审；新的精确 commit/tree 仍为 TBD。
- 当前改动尚未创建新本地 commit，也未 push、创建 PR 或合并 `main`。
- 公开政策/联系证据的新版代码尚未部署到 Production。
- `tiktok-review.toryxai.com` 尚未创建。
- TikTok for Developers 的 `video.list` Production Revision 尚未创建/提交。
- Business Developer App 尚未创建；权限目录需重新确认不再显示 `No data`。
- Accounts API Access Application Form 尚未提交。
- Business App ID/Secret 尚未下发，不具备真实 Business OAuth 条件。
- 评论读取/回复的 Production flags 仍应保持关闭。
- 2026-09-01 的 `npm audit --omit=dev` 报告 0 critical、10 high、1 moderate；
  本次 TikTok 发布包未改依赖或 lockfile。该既有安全债不阻断隔离 Sandbox，
  但在 Production 部署批准前必须形成升级/缓解或风险接受结论。

## 3. Gate 0：冻结与证据更新

### 动作

1. 保持两个 Portal 的 Submit、Business OAuth 和所有评论 flags 关闭。
2. 归档两个开发者身份、Profile approved、Production Live/Sandbox 状态和时间戳截图。
3. 在 Business Portal 只读确认 `My Apps` 和权限目录；如仍为 `No data`，
   停止并开工单。

### 验收

- 没有未知 App、未知身份或正在进行的 OAuth state。
- 未改动 Portal，未调用 provider。

## 4. Gate 1：代码发布包冻结

### 动作

1. 审阅完整 tracked/untracked diff，确认只包含本次 TikTok 共同基础和公开证据改动。
2. 执行全量 Node tests、type-check、变更文件 lint、`git diff --check`、secret scan 和
   Production build。
3. 复核已知 Production 依赖安全债务的可达性/缓解/风险接受；不在本发布包中
   夹带 `npm audit fix` 或无关依赖升级。
4. 统一清洁验证与实际部署的依赖安装命令；不得用 `npm ci --ignore-scripts`
   验证后又未经验证地在服务器执行不同的 `npm ci`。
5. 在隔离 clean checkout 上对相同 tree 重复验证。
6. 用户单独批准后才创建本地 commit；不 push。
7. 审核 commit tree、未跟踪残留和最终 SHA。

### 验收/停止

- 所有验证通过，工作树干净，只有一个被批准的部署候选 SHA。
- 任何测试失败、凭据命中或不明改动立即停止。

## 5. Gate 2：共同公开证据与稳定 review staging

Gate 2 分成两个独立授权，不能混为一次“全部部署”。

### Gate 2A：Production 公开页面

1. 审核 Production database migration 是否为运行必需，并对数据库和应用部署分别获得批准。
2. 从精确 commit 构建和部署，所有 `video.list`/Business comment/reply flags 保持 `false`。
3. 匿名英文环境验证 Website、Contact、Privacy、Terms 和 Legal，显示：
   - `Wuhan Guanxing Cultural Media Co., Ltd.`、Star Gaze 和 `toryxai.com` 关系；
   - `developer@toryxai.com`；
   - 独立 Business 授权、评论读取、用户主动回复、租户/Token 隔离、
     撤权/删除/真实保留和不出售数据。
4. 回归现有登录、发布、四 scope OAuth 和旧路由。

### Gate 2B：稳定 HTTPS review staging

1. 根据 `docs/tiktok-stable-staging-plan.md` 完成服务器只读核查和 exact change sheet。
2. 分别批准 DNS/TLS 与 staging 应用部署。
3. 建立 `tiktok-review.toryxai.com`、独立 3010/PM2/.next/env/logs 和 staging Supabase。
4. 首次构建所有新功能 flags=false，通过 readiness、cookie 隔离、鉴权负向、
   回调和回滚验收。
5. 任何 `NEXT_PUBLIC_*` 改变都必须 fresh build，不得只 restart PM2。

### Gate 2 验收

- Production 公开证据可匿名访问；review staging 稳定可用，不与 Production 共享数据、
  cookie、进程、日志或构建产物。
- 仍未开始真实 Business OAuth，仍未提交任何 App/Form。

### Gate 2 本地预检边界

在服务器由其他同事负责、且 Gate 2A/2B 尚未获得外部变更授权时，可以先完成本地预检：

1. 等 Gate 1 重新冻结并复审通过后，从当时记录的新精确
   commit/tree fresh build，不复用旧 `.next`，也不使用历史 `965af806`。
2. 使用临时 HTTPS tunnel 仅覆盖同一次 Sandbox 测试会话；不写入 Production callback，
   不作为审核等待期间的稳定地址，也不计入 Gate 2B 验收。
3. `video.list` 两个开关可在独立 Sandbox build 中同时为 `true`；所有 Business 评论和
   reply 开关继续为 `false`。
4. 先验证公网页面、构建期 UI 值和 API 前置门禁，再申请修改 TikTok for Developers
   Sandbox callback。修改 Portal 仍需单独批准。
5. tunnel 终止或域名变化即停止 OAuth；重新 fresh build、readiness 并同步 Sandbox callback，
   不复用旧 state 或旧授权页面。

本地预检通过只能证明代码和一次测试会话可用，不能替代 Production 公开证据、稳定域名、
cookie/进程/数据库隔离或同事执行的服务器部署验收。

## 6. Track A：TikTok for Developers / `video.list`

### A1. Sandbox 证据冻结

1. 在独立 staging 中将
   `TIKTOK_VIDEO_LIST_SCOPE_ENABLED=true` 和
   `NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED=true` 同时设置，fresh build 后重跑 readiness。
2. 只修改 TikTok for Developers Sandbox callback，不动 Production callback。
3. 使用专用 Sandbox target user 验证授权、首页、cursor 分页、四项统计、
   缺 scope 门控和 TaskManager 不受影响。
4. 保存无敏感数据截图，然后按冻结 UI 制作最终录屏。

### A2. Production Revision

1. 用户单独批准后才点击 `Create Revision`。
2. 保留现有 Login Kit/Content Posting 和四个既有 scope，唯一新增 `video.list`。
3. 上传完整端到端录屏，说明只读视频列表与既有 TaskManager 边界。
4. 最终只读对比 Revision、scope、callback、网站和材料。
5. 用户再次单独批准后才 `Submit for review`。
6. 审核 Live 前 Production 两个 video-list flags 保持 `false`。

### A3. 获批后上线

1. 确认 Revision 已为 Live，然后单独批准 Production 开关变更。
2. 两个 video-list flags 同时设为 `true`，fresh Production build、readiness 和回归。
3. 引导既有账号一次重新授权，不影响未重授权账号的原发布能力。

## 7. Track B：TikTok API for Business / Organic Comments

### B1. App 草稿与最小权限

1. 只有 Developer Profile approved、当前身份正确、`My Apps` 状态符合记录且权限目录
   正常加载时才进入。
2. 获得用户单独批准后创建一个 App 草稿，不 Submit。
3. 冻结唯一 App Name，logo、description、两类 redirect 和 Portal 实时字段说明。
4. 只选择：
   - TikTok Accounts > Account Comment > **Get Business Comment**；
   - TikTok Accounts > Account Comment > **Manage Account Comment**。
5. 不选 Account User、Get Account Media、Ad Account/Ads Management、campaign、
   reporting 或 Research API。

### B2. Accounts API Access Application Form

1. 使用草稿精确 App Name 且仅提交一次 Form。
2. 使用 Business Account Settings 中核实的注册邮箱，不把 Profile 联系邮箱当成
   注册邮箱猜测。
3. 如实填写 Technology Company、法定主体、pre-launch multi-tenant
   Organic Comment SaaS、用户授权自有账号、读取评论/回复/必要指标、
   仅用户主动回复、无自动群发。
4. 接入账号数量由用户确认，不猜测、不虚构客户/收入/广告代投。
5. 附公开政策 URL、同主体验证材料和明确标注 Prototype 的演示材料，保存回执。

### B3. App Submit

1. 对比 App Name/Form 回执、两个权限、两类 redirect、政策、logo、描述和录屏。
2. 确认未夹带广告/媒体/账号管理等未实现权限。
3. 用户单独批准后才 Submit App。
4. 审核期间冻结 App Name、permissions 和 redirects；补件仅按官方反馈处理。

### B4. App 获批后的真实 staging 测试

1. 获得真实 App ID/Secret 后才配置 staging secret store。
2. 从 App Detail 获取并审核 TikTok account-holder 官方生成授权 URL；不猜测域名/路径。
3. 校验 trusted URL template，仅注入随机 state 和已批准的
   `comment.list,comment.list.manage`。
4. fresh staging build，先单独放行 OAuth，然后单独放行
   comment list/reply-list 只读；回复 flags 仍关闭。
5. 验证 10 分钟单次 `auth_code`、1 天 access token、1 年 refresh token、refresh token 旋转、
   scope、错账号/跨租户/Shop/任意 video ID 负向路径和日志脱敏。
6. 只读评论验收通过后，再单独批准 reply/create；不对结果不确定的 POST 盲目重试。
7. 最后单独验证 **Disconnect Comments**，不删除发布授权/任务。

### B5. Production 分级上线

1. 审核 Production migration 备份、hash、维护窗口、RPC/ACL/schema cache 和
   回滚方案，单独批准后执行。
2. 从精确 commit 构建/部署，先保持所有 Business comments/reply flags=false。
3. 依次独立批准并验收：
   - Business OAuth/connection visibility；
   - comment list/reply-list 只读；
   - 用户主动 reply/create；
   - independent disconnect/recovery。
4. 每个含 `NEXT_PUBLIC_*` 变更的 gate 必须 fresh Production build、readiness 和浏览器验收。

## 8. 录屏制作时点

现在只准备两套录屏提纲与无敏感测试数据：

1. TikTok for Developers：Login Kit + `video.list` + 分页/四项统计/缺 scope。
2. Business Developers：独立 account-holder consent + comments/reply-list + 用户主动 reply + disconnect。

最终逐点录屏脚本与正式录屏必须等到稳定 HTTPS staging、最终 UI/build、
Portal 精确字段/权限和审核账号全部冻结。

## 9. 用户审批点

执行时下列每项都必须分别批准，不得用一句“按流程做”扩大权限：

1. 本地 Git commit。
2. push feature branch / PR / merge。
3. Production database migration。
4. Production application deployment。
5. DNS/TLS 变更。
6. review staging deployment。
7. TikTok for Developers `Create Revision`。
8. TikTok for Developers `Submit for review`。
9. Business Developer App draft creation。
10. Accounts API Access Application Form submission。
11. Business App submission。
12. 首次真实 Business OAuth、评论只读、回复和 disconnect 测试。
13. 每个 Production feature gate 开启。

## 10. 立即下一步

Gate 1 尚未在最新 `main` 上重新冻结。当前只执行
**迁移修复、本地验证和 Gate 1 重新冻结准备**：

- 修正最新 `main` 合并带回的公开证据与执行文档回归；
- 重跑全量 Node tests、type-check、lint、Production build 和一致性守卫；
- 通过只读复审后，再向用户单独申请本地 commit 授权；
- 提交后以新 commit/tree 作为唯一候选身份，重新执行隔离 clean-checkout 验证。

在新 Gate 1 冻结完成前，不执行 Gate 2 正式验收、Sandbox OAuth 或录屏；
也不执行 push、PR/merge、Production migration/部署、DNS、Business App/Form、
Production Revision 或任何 Portal 修改。
