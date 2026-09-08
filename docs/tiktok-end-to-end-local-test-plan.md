# TikTok 绑定、发布、视频数据与评论全链路测试计划

> 状态：待用户审核的本地执行方案。
> 范围：优先完成本地与 TikTok Sandbox 验证；所有本地 Gate 通过后，才分别申请
> Git commit、push/merge、Production migration、服务器部署和 Portal 提交授权。
> 安全边界：本文档不授权提交、推送、部署、执行 Production migration、提交审核或开启
> Production 功能开关。

## 1. 目标

使用一个专用网站测试用户和一个 TikTok Sandbox target user，按以下顺序验证：

1. 绑定普通 TikTok 发布账号；
2. 发布一条专用测试视频；
3. 读取账号视频列表与视频级聚合统计；
4. 独立绑定 TikTok API for Business 评论授权；
5. 读取评论正文、作者与回复线程；
6. 发送一条由用户明确触发的评论回复；
7. 独立断开评论授权，同时保持发布授权可用。

## 2. 必须区分的两套后台与三层能力

| 能力 | 开发者后台 | API / 权限 | 说明 |
| --- | --- | --- | --- |
| 账号绑定、视频发布 | TikTok for Developers | Login Kit + Content Posting | 使用普通 TikTok OAuth Token |
| 视频列表与四项统计 | TikTok for Developers | Display API `video.list` | 不包含评论正文 |
| 评论正文与回复线程 | Business Developers | Get Business Comment | 独立 account-holder Token |
| 创建评论回复 | TikTok API for Business Developers | Manage Account Comment | 仅允许用户明确触发 |

两套 OAuth 的 Token、scope、`open_id`、刷新、撤权和审计记录必须始终分离。不得将 Display API
Token 传给 Business endpoint，也不得通过直接比较两套 `open_id` 证明两次授权属于同一账号。

## 3. 参与人员与职责

### 3.1 实施方（Codex）

- 读取当前代码、数据库状态和测试证据；
- 准备本地构建、HTTPS 临时会话、脱敏环境配置和测试数据；
- 在每个 Gate 前确认开关、回调、账号和数据库前置条件；
- 运行自动测试、readiness、类型检查、lint 和 Production build；
- 核对非敏感日志、state 终态、账号状态、scope 与数据不变量；
- 发现失败后立即停止连续重试，先完成原因分类和审核；
- 不代替用户输入验证码、密码或向聊天中输出 Secret/Token/code。

### 3.2 用户需要配合的事项

1. 确认并登录正确的粉色 `I` 浏览器 Profile，不使用“少伯”或其他浏览器 Profile。
2. 需要 Portal 操作时，由用户确认当前登录身份和页面：
   - TikTok for Developers；
   - TikTok API for Business Developers。
3. OAuth 授权时，在 TikTok 页面亲自确认授权账号，首选专用 Sandbox target user
   `<SANDBOX_TARGET_USER>`。
4. 扫描二维码、输入邮箱/手机验证码、确认 TikTok 授权等高信任动作由用户完成。
5. 发布测试视频前，确认测试素材允许上传，且不包含隐私、版权或敏感内容。
6. 在 TikTok App 或网页中人工确认：
   - 测试视频是否真实发布；
   - 用于读取的测试评论是否真实存在；
   - 测试回复是否只出现一次。
7. 每次修改 Portal callback、scope、提交表单、发起 OAuth、Git 操作或部署前，
   单独确认授权。
8. 若 Portal 要求证明材料，用户确认企业主体、官网、邮箱、
   预计接入账号数量等真实信息，
   不由实施方猜测或虚构。
9. 服务器部署由用户同事负责；本地验收完成前，不要求同事部署。

### 3.3 服务器同事（仅后续稳定 staging/Production 阶段）

- 按单独审批的 exact commit/tree 构建；
- 执行已审批的 DNS、TLS、Nginx、PM2 和环境配置变更；
- 提供脱敏的 listener、证书、构建、进程、日志与回滚证据；
- 不接收或输出 TikTok Secret、access token、refresh token 或 OAuth code。

## 4. 测试账号与数据边界

- 网站测试用户：`<DEDICATED_SITE_TEST_USER>`。
- TikTok Sandbox target user：`<SANDBOX_TARGET_USER>`。
- 两个占位符的精确映射只保存在受控运行记录中，不写入版本库、录屏或审核材料。
- 账号类型：仅普通 `normal` 发布账号，不使用 Shop 账号。
- 测试视频：使用可公开、无个人信息、可删除的专用素材。
- 测试评论：使用明确标记为测试的短文本，不使用真实客户内容。
- 屏幕截图和日志不得包含 client secret、OAuth code、access/refresh token、密码或验证码。

## 5. Gate 0：本地基线与测试会话准备

### 5.1 目标

确保后续失败可定位、可恢复，且不会混用旧 callback、旧 state 或旧构建产物。

### 5.2 实施动作

1. 确认分支为 `codex/tiktok-review-latest-main`，基线 `main` 为当前复审记录中的精确 SHA。
2. 确认改动仍未提交/未推送，暂存备份仍存在。
3. 记录测试前数据库数量和状态：
   - TikTok OAuth state 的 `pending/processing/completed/expired`；
   - 网站用户的 `normal` TikTok 账号数；
   - secure token row 数量和 Shop secure row 数；
   - Business token/state/action log 数量和状态。
4. 在任何 Sandbox callback 变更前，对普通和 Business OAuth state 全表执行脱敏聚合：
   - `pending` 总数与尚未过期数量；
   - `processing` 总数与有效 processing lease 数量；
   - 任一非零都视为全局 drain 未完成，禁止修改共享 callback。
5. 确认当前本地 Production build 的全量测试、type-check、lint 和 build 证据。
6. 为本次 Sandbox OAuth 建立一条同一测试会话内不变的 HTTPS tunnel。
7. 建立 listener 前枚举所有现存 `cloudflared` 进程及其 upstream；目标端口必须没有
   其他 listener 或 tunnel。运行期间再次核对该端口只被本轮批准的单一 tunnel 暴露。
8. tunnel 域名一旦变化、进程退出或发现第二个公网入口，立即停止 OAuth，
   不复用旧 state/授权页。

### 5.3 用户配合

- 确认此轮只使用 Sandbox，不改 Production callback。
- 允许在明确列出新旧 callback 后，只修改精确的 Sandbox callback。
- 确认测试期间电脑不休眠、tunnel 不中断。

### 5.4 验收/停止条件

- 基线数据已记录，普通和 Business OAuth 的全局 `pending/processing` 与有效 lease 聚合均为 0。
- 开关的 build-time/runtime 值一致。
- 本地端口只有本轮批准的单一 HTTPS tunnel 入口，不与其他平台 review 会话复用。
- 任一未知 state、旧 tunnel 或账号归属不清晰时停止。

## 6. Gate 1：普通 TikTok 账号绑定

### 6.1 环境边界

- `NEXT_PUBLIC_APP_URL`、`TIKTOK_REDIRECT_URI` 和 Developers Sandbox redirect 使用同一 HTTPS origin。
- Login Kit callback 精确路径：`/api/tiktok/auth/callback`（无尾斜杠）。
- `TIKTOK_VIDEO_LIST_SCOPE_ENABLED=false`。
- `NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED=false`。
- 全部 Business 评论/回复开关保持 `false`。

### 6.2 Web OAuth

1. 在账号管理页仅点击一次“网页登录绑定”。
2. 用户确认 TikTok 授权主体为 `<SANDBOX_TARGET_USER>`。
3. 回调后验证：
   - 最新 state=`completed`；
   - 无遗留 `pending/processing`；
   - 账号=`normal + active`；
   - parent/secure token 镜像一致且 secure row 唯一；
   - Shop secure row 仍为 0；
   - 本次 OAuth 授权请求 URL 精确只请求 `user.info.basic`、`user.info.stats`、
     `video.upload`、`video.publish` 四项发布基线 scope，且不请求 `video.list`；
   - 视频列表 server/UI 双 gate 保持关闭；
   - 若 TikTok 的 token 响应或历史授权仍报告既有 `video.list` grant，仅记录并送审，
     不将其直接判定为凭据污染或授权请求越界。
4. 对同一 callback/state 做一次重放测试，必须在 provider 前拒绝。

### 6.3 QR OAuth

1. 仅在 Web OAuth 通过后测试 QR。
2. 用户用 TikTok App 扫码并亲自确认。
3. 验证前端轮询不重叠，两个并发 poll 只能有一个 provider exchange。
4. 过期 QR、过期 lease 或重放不得写入账号凭据。

### 6.4 用户配合

- 在 TikTok 授权页核对昵称/头像，确认是专用 target user。
- 如出现 `non_sandbox_target`、state 失效或其他错误，不要连续点击。
  先将页面保留给实施方检查。

### 6.5 通过标准

Web 和 QR 都不会因并发、过期或重放产生第二条账号、覆盖胜者凭据或降级已完成 state。

## 7. Gate 2：Content Posting 发布

### 7.1 执行顺序

1. 使用 Gate 1 的同一个 Sandbox 账号。
2. 读取 creator info 与发布限制。
3. 本地文件使用普通 Content Posting API 的 `FILE_UPLOAD`：文件先保留在浏览器，
   创建任务后由服务端初始化一次发布并持久化 `publish_id`，浏览器再把文件直接 PUT 到
   TikTok 返回的短期 `upload_url`。本路径不经过 OSS，也不需要修改 OSS CORS。
4. 验证分片按顺序上传，中间分片只接受 HTTP 206，最后一片只接受 HTTP 201；
   不在日志、数据库或页面 URL 中持久化 `upload_url`。
5. 验证任务 `pending -> processing -> uploading -> published`。
6. 验证 TikTok video ID、观看 URL 和任务项关联。
7. 在 TikTok 端人工确认视频仅发布一次。
8. 对浏览器响应丢失进行自动化测试：只对同一个 `publish_id` 查询状态，
   不再次调用发布初始化，也不创建第二条任务。
9. 通过自动化 mock/fault-injection 验证 access token 刷新、临时 profile 失败、
   数据库失败与重试边界；不得在真实 provider 发布路径上人为制造这些失败。
10. 对可删除的专用测试任务验证本地/远端删除语义。

### 7.2 用户配合

- 选择和确认可公开发布的测试素材。
- 在 TikTok App 中确认发布结果、可见性和数量。
- 只有当用户明确允许时才测试远端删除。

### 7.3 停止条件

- 任务显示失败但 TikTok 端已出现视频；
- 同一任务产生两个 TikTok video ID；
- `publish_id` 尚未可靠落库却把 TikTok `upload_url` 返回给浏览器；
- 浏览器上传结果不明确后再次执行发布初始化或创建新任务；
- profile/DB 临时错误将账号错误标记为 expired；
- 普通发布操作写入 Shop secure token 表。

## 8. Gate 3：Display API 视频列表与聚合统计

### 8.1 构建开关

```env
TIKTOK_VIDEO_LIST_SCOPE_ENABLED=true
NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED=true
```

`NEXT_PUBLIC_*` 是构建期变量。必须使用新 effective env 做 fresh Production build，不能只 restart。

### 8.2 执行顺序

1. 在独立 Sandbox build 中开启上述两个开关。
2. 重新授权同一 TikTok 账号，确认 consent 包含 `video.list`。
3. 验证首屏视频列表、封面、时长、发布时间。
4. 验证 cursor 严格向更早时间递减、加载更多和 ID 去重。
5. 验证 `view_count`、`like_count`、`comment_count`、`share_count`。
6. 验证任务统计原子汇总，部分 provider 结果不会用旧快照覆盖新值。
7. 验证缺 scope 时的门禁和引导，以及同页 TaskManager 不受影响。

### 8.3 用户配合

- 在重新授权页确认 `video.list` 权限可见。
- 对照 TikTok App 中的视频数量和基本统计；允许 TikTok 平台统计存在更新延迟。

### 8.4 通过标准

列表和聚合统计可读；`comment_count` 仅展示视频评论总数，不声称已读取评论正文。

## 9. Gate 4：Business Developer App 与独立评论授权

### 9.1 外部前置

此 Gate 不能在没有审批 App 和真实凭据时伪造通过。前置包括：

1. TikTok API for Business Developer Profile 保持 approved。
2. Portal 权限目录恢复，不再显示 `No data`。
3. 在正确 Developer 身份下创建 App 草稿，不立即 Submit。
4. 只选择 Portal 当前精确命名的两项权限：
   - Get Business Comment；
   - Manage Account Comment。
5. 不申请 Ads Management、Ad Account Management、campaign、reporting 或其他未实现权限。
6. 先确定唯一 App Name，再用完全一致的 App Name 提交一次 Accounts API Access Application Form。
7. 表单中的注册邮箱从 Business Account Settings 核对，不用 Profile 邮箱猜测。
8. 企业主体、Technology Company 类型和预计接入账号数量由用户据实确认。
9. App 通过并下发 App ID/Secret 后，才配置隔离 Sandbox/staging。

### 9.2 两类 redirect 分离

- Advertiser redirect URL：Portal 建 App 表单中的独立安全落地页，不承担 `tt_user` code exchange。
- TikTok account-holder redirect URL：用于 Business OAuth code exchange。
- account-holder callback 精确路径：`/api/tiktok/business-auth/callback/`（有尾斜杠）。
- `TIKTOK_BUSINESS_REDIRECT_URI` 必须与 Portal 保存值逐字符相同。

### 9.3 真实授权前检查

1. 核对 App Detail 生成的 account-holder authorization URL。
2. 将官方 URL 作为受信模板，严格 allowlist scheme/host/path，只注入每次随机 state。
3. 显式 scope 只包含已批准的两项 comment scope，不省略 scope 参数。
4. Business OAuth 不能在所有评论 gate 都关闭时发起。仅为 Gate 4 的独立 Business OAuth 临时使用：

   ```env
   SOCIAL_COMMENTS_API_ENABLED=true
   SOCIAL_COMMENTS_ENABLED_PLATFORMS=<EXISTING_APPROVED_PLATFORMS>,tiktok
   NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=true
   NEXT_PUBLIC_SOCIAL_COMMENTS_CENTER_ENABLED=false

   TIKTOK_COMMENTS_REPLY_ENABLED=false
   NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=false
   ```

   `NEXT_PUBLIC_*` 属于构建期变量，必须用新 effective env fresh build、重启隔离实例并重跑
   readiness。执行时保留现有已批准平台，不机械复制示例占位符。通用评论中心到 Gate 5
   确需验收时才开启，Gate 4 不扩大 UI 暴露面。
5. 在 Business OAuth 完成前，评论读取因缺少 Business token 自然 fail closed；
   不得把该门控误判为故障。
6. 用户在 OAuth 页选择与已绑定发布账号相同的 TikTok 账号。

### 9.4 验收

- Business state=`completed`，无遗留 processing；
- Business token row 唯一、active，scope 只包含两项 comment scope；
- 发布授权与评论授权状态在账号卡上分开显示；
- 不得把两套 `open_id` 直接相等作为身份证明；
- 误授权另一个自有账号时，产品给出明确风险提示且可独立 Disconnect。

## 10. Gate 5：只读评论

### 10.1 开关组合

```env
SOCIAL_COMMENTS_API_ENABLED=true
SOCIAL_COMMENTS_ENABLED_PLATFORMS=youtube,tiktok
NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=true
NEXT_PUBLIC_SOCIAL_COMMENTS_CENTER_ENABLED=true

TIKTOK_COMMENTS_REPLY_ENABLED=false
NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=false
```

`SOCIAL_COMMENTS_ENABLED_PLATFORMS` 必须保留当前已批准平台。
上述值是方案示例，执行时以真实基线为准。
`NEXT_PUBLIC_*` 变更必须 fresh build。

### 10.2 执行顺序

1. 先从已发布任务进入对应 video ID，不允许前端任意提交 video ID。
2. 读取顶层评论、作者、时间、状态和回复数。
3. 读取 reply list，验证父子关系和去重。
4. 验证 comment cursor 和 reply cursor 分别恢复。
5. 人为构造超出单次 reply budget 的多父评论，证明多次 sync 最终覆盖全部 parent。
6. 验证旧恢复队列执行期间出现的新 parent 不会丢失。
7. 验证 account+endpoint 共享 QPM 限流、`Retry-After` 与有上限的 GET 重试。
8. 验证 foreign user、Shop account、其他发布账号的 video ID 都在 token/provider 前拒绝。
9. 验证 UI 尊重 `truncated/replies_fetched/thread_completeness`，不将部分同步显示为完整快照。

### 10.3 用户配合

- 在 TikTok 测试视频下发布几条不含隐私的测试评论，必要时建立一层回复。
- 对照 TikTok 实际页面与 Star Gaze 页面，确认文本、作者和父子线程。
- 理解 `comment_count` 可能因平台更新和分页时点与当前已同步行数不完全一致。

### 10.4 通过标准

评论只读完整性是“分预算、可恢复、最终一致”。
本 Gate 中 provider reply-create 调用数必须为 0。

## 11. Gate 6：评论回复与独立 Disconnect

### 11.1 回复开关

```env
TIKTOK_COMMENTS_REPLY_ENABLED=true
NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=true
```

仅在 Gate 5 通过后开启，并再做一次 fresh build、readiness 和浏览器无缓存验收。

### 11.2 回复测试

1. 先使用短文本完成一次用户主动回复。
2. 在 TikTok 端确认只出现一条远端回复。
3. 真实 TikTok 账号只验证**同一 idempotency key**重放，provider 不得再次调用。
   首条真实回复完成后，禁止换客户端或使用新 key 来验证“调用数仍为 1”；
   completed 后的新 key 可能代表新的用户意图，并可能创建第二条真实回复。
4. 验证 1200 字符边界，包含中文、emoji 和 variation selector；超限必须在 action/provider 前拒绝。
5. 通过自动化 mock/fault-injection 验证不同 key 并发、ABA、跨客户端竞争和超时边界，
   不在已完成的真实回复后发送新 key。
6. 通过自动化 mock/fault-injection 模拟 provider 成功但 receipt/finalize 失败，
   同 key 重试不得再调 provider。
7. 通过自动化 mock/fault-injection 模拟 timeout、408/425/429/5xx、无效 JSON 和畸形成功响应。
   结果必须进入 `unknown`，不盲目重发。
8. 同步对账只在有限时间窗内且唯一候选时完成 unknown；0 或多候选保持 unknown。
9. 验证评论回复行、root parent count 和 action completed 的原子提交。

### 11.3 独立 Business Disconnect

1. 从账号卡只断开“评论授权”。
2. 本地立即阻止 Business token 继续使用。
3. 验证 revoke 成功 -> 本地凭据删除。
4. 验证 revoke 响应丢失 -> 保持受保护的 pending/unknown，不反复盲调 provider。
5. 人工确认仅能处理本人已进入 ambiguous/rejected 状态的账号，并保留审计。
6. Disconnect 后普通发布账号和 TikTok 发布能力仍正常。
7. 测试旧 OAuth callback 不能在 generation 已推进后复活 Business 凭据。

### 11.4 用户配合

- 明确确认本次将向测试评论发出真实远端回复。
- 在 TikTok 端检查回复内容与数量。
- 仅在真的已撤权但返回结果不明的情况下，亲自点击人工确认。

## 12. Gate 7：全链路回归、清理与发布包冻结准备

### 12.1 最终端到端顺序

1. 网站用户登录；
2. 普通 TikTok Web OAuth 绑定；
3. 发布一条专用测试视频；
4. 视频列表与四项聚合统计；
5. 独立 Business OAuth；
6. 评论正文和回复线程同步；
7. 用户主动发送一条回复；
8. 断开 Business 评论授权；
9. 验证普通发布授权仍正常；
10. 将尚未终态化的测试 state 按受审计流程终态化，并保留 OAuth/action 审计记录；
    禁止笼统删除审计记录。
11. 移除临时 callback、停止 tunnel；任何 TikTok 远端视频、评论或回复删除
    都必须逐项取得用户授权。

### 12.2 自动验证

- 全量 `node --test tests/*.test.cjs`；
- TypeScript type-check；
- 全量 `src` ESLint `--quiet`；
- Production build；
- TikTok production readiness（区分脱敏模板与真实环境）；
- secret scan；
- `git diff --check`；
- 从未来获批的 exact commit/tree 执行隔离 clean-checkout 复验。

### 12.3 发布边界

本地验收全部通过后，仍要分开授权：

1. 本地 Git commit；
2. push feature branch；
3. PR/merge `main`；
4. Production database migration；
5. Production application deployment；
6. TikTok Portal Revision/App/Form 提交；
7. 每一个 Production feature gate 开启。

任一项授权不自动包含下一项。

## 13. 录屏与审核材料时机

### 13.1 TikTok for Developers / `video.list`

- 现在先写录屏脚本和镜头清单，不录最终片。
- Gate 1、2、3 都通过、UI 文案冻结、Sandbox callback 稳定后，再录真实 Sandbox 视频。
- 录屏只展示 `video.list` 新增能力，不将 Business comment 权限混入 Developers Revision。

### 13.2 TikTok API for Business / Accounts API

- 在 App/Access Form 前可先准备显著标注 `Prototype` 的原型录屏，不伪造 TikTok API 成功响应。
- 真实 App 获批、凭据下发且 Gate 4、5通过后，再录真实评论读取流程。
- 回复写入录屏必须等 Gate 6 单独通过。

所有录屏必须遮挡邮箱、手机号、code、Secret、Token、验证码和与审核无关的真实用户数据。

## 14. 故障分类和统一停止规则

### 14.1 可在查清后重试

- 明确的本地配置缺失，且 provider 调用数为 0；
- 明确的 TikTok Sandbox target user 配置错误，且 callback 前已拒绝；
- 回调域名变化后，已删除旧 callback/state，并完成 fresh build/readiness。

### 14.2 必须立即停止并审核

- provider 可能已执行写操作，但响应丢失或畸形；
- 账号/secure token/state/action log 出现部分成功；
- 发布或回复在 TikTok 端已存在，但 Star Gaze 报错；
- 同一测试产生多个远端对象；
- Shop/foreign account 进入普通 Token 或 Business comment 链路；
- 日志、URL、错误页或截图出现凭据；
- 任一代码、callback、scope、App Name 或 Portal 配置与已审核证据不一致。

## 15. 每个 Gate 的证据模板

每次执行都记录以下内容，不记录敏感值：

- 执行时间和执行人；
- Git branch、base SHA、工作树是否未提交；
- Node/npm 版本和 build ID；
- 开关名称与脱敏布尔值；
- callback 的 origin/path（不记 query）；
- TikTok Developer 身份和 Sandbox/Production 模式；
- provider 调用次数；
- state/account/token/action 的状态和行数；
- 页面与 TikTok 端的脱敏截图；
- 自动测试结果；
- 结论：PASS / FAIL / BLOCKED；
- 若失败，记录稳定 error code 和停止条件，不记 provider 原始凭据形文本。

## 16. 当前下一步

1. 用户审阅本文档，确认测试范围、账号、真实发布/回复边界和配合事项。
2. 通过后只开始 Gate 0 的本地/数据库只读基线核对，不立即修改 Portal。
3. Gate 0 证据通过审核后，再单独申请建立临时 HTTPS 会话与修改 Developers Sandbox callback。
4. Business App 尚未获批时，Gate 4-6 保持 BLOCKED，不通过 mock 宣称真实评论 API 已打通。
