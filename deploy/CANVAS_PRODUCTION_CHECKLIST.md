# 超级画布生产发布检查清单

这份清单用于阿里云 Linux 主机上的超级画布蓝绿发布。仓库中的脚本默认只输出计划；只有显式传入 `--execute` 才会构建候选进程、修改 Nginx 或执行回滚。脚本不接收密钥参数，也不会打印环境变量值、长度、哈希或掩码。

## 1. 发布输入冻结

- [ ] 使用独立、不可变的 release 目录，例如 `/var/www/tiktok-ai-mcn-releases/<commit>`，不要在当前在线目录内执行 `git reset`。
- [ ] 记录 commit、tree hash、操作者、发布时间窗和当前 Nginx 配置 SHA-256。
- [ ] 确认候选端口与当前在线端口不同，候选 PM2 名称与当前在线进程名称不同。
- [ ] 保留当前在线 PM2 进程；新版本通过验收前不停止旧进程。
- [ ] 确认基础迁移 `20260715` 至 `20260719` 已存在，并用 `canvas-additive-production-operation.mjs` 将 `20260729`、`20260730`、`20260731`、`20260801` 作为一个受锁事务应用；其中 health RPC 只读检查 create/delete、生成生命周期、recovery 与 upload RPC 的精确签名和执行权限。
- [ ] 首次 legacy bootstrap 期间，`20260729` 会暂时保留 `authenticated` 直写 `canvases`，但三道 trigger 以同一 advisory lock 强制 owner 与每用户 100 项目上限；只有当所有保留的 rollback release 都已改用 `create_canvas_project_v1` 后，才能用单独审查迁移撤销该兼容桥。

### 1.1 隔离旧 Webhook

旧 `deploy/webhook.js` 调用的是会更新 `/var/www/tiktok-ai-mcn` 当前目录的 `deploy/deploy.sh`，不具备本清单的独立 release、候选健康闸和 Nginx 原子切流语义。

- [ ] 在超级画布 release 尚未进入远端 `main` 前，生产必须删除或保持 `LEGACY_WEBHOOK_DEPLOY_ENABLED` 非 `true`，并重启 Webhook 进程使环境生效。
- [ ] `GET /health` 应显示 `legacyDeployEnabled: false`。
- [ ] 禁用状态下，签名正确的 `main` push 会收到 HTTP 503 和 `LEGACY_DEPLOY_DISABLED`，不会启动 `deploy.sh`。
- [ ] 不要把旧 Webhook 改为自动调用蓝绿脚本；蓝绿发布需要人工审查解析后的端口、workdir、Nginx 文件与 rollback 路径。
- [ ] 即使本 release 已合入 `main`，正常生产发布仍建议保持旧 Webhook 禁用；只有明确接受原地部署风险的受控维护窗口才可设置精确值 `LEGACY_WEBHOOK_DEPLOY_ENABLED=true`。

## 2. Node 与环境预检

项目约束 Node `>=20.12 <21`，`.nvmrc` 固定 Node 20 主版本。
变量名基线见 `deploy/canvas.production.env.template`；模板中的值故意留空，只能合并到 release 目录内权限为 `0600` 的 `.env.local`，不得填写后提交。

```bash
cd /var/www/tiktok-ai-mcn-releases/<commit>
nvm use
NODE_ENV=production npm run canvas:prod-check -- \
  --root "$PWD" \
  --env-file "$PWD/.env.local"
npm run verify:canvas-blue-green
```

预检至少覆盖以下能力，且只报告变量名和通过/失败：

- [ ] Supabase URL、anon key、`SUPABASE_SERVICE_ROLE_KEY` 均存在，service role 不等于 anon key。
- [ ] OSS region、access key ID/secret、bucket、HTTPS endpoint、自定义域名均存在。
- [ ] 图片生成 key 来自 Canvas 实际读取链：`VIDEO_PLATFORM_IMAGE_API_KEY` → `IMAGE_PLATFORM_API_KEY` → `VIDEO_PLATFORM_API_KEY` → `SORA2_API_KEY` → `WUYINKEJI_API_KEY`；`OPENAI_API_KEY` 不算 Canvas 图片能力。
- [ ] 图片 endpoint 来自 `VIDEO_PLATFORM_IMAGE_BASE_URL` → `IMAGE_PLATFORM_BASE_URL` →视频平台 endpoint 链→内置 HTTPS 默认值；使用默认值会告警，生产建议显式配置。
- [ ] 视频生成 key 来自 `VIDEO_PLATFORM_API_KEY` → `SORA2_API_KEY` → `WUYINKEJI_API_KEY`。
- [ ] 视频 endpoint 来自 `VIDEO_PLATFORM_BASE_URL` → `VIDEO_PLATFORM_API_BASE` → `VIDEO_PLATFORM_API_ENDPOINT` →内置 HTTPS 默认值；使用默认值会告警，生产建议显式配置。
- [ ] `CANVAS_RECONCILE_SECRET`、`CANVAS_RECOVERY_ADMIN_SECRET`、`CANVAS_RECOVERY_APPROVER_SECRET` 均不少于 32 个字符且三者互不相同。
- [ ] `CANVAS_RECOVERY_OPERATOR_LABEL` 与 `CANVAS_RECOVERY_APPROVER_LABEL` 是不同人员的稳定标签；人工 unknown 恢复严格遵循 `CANVAS_UNKNOWN_RECOVERY_RUNBOOK.md`。
- [ ] `CANVAS_VIDEO_MODELS` 与构建期 `NEXT_PUBLIC_CANVAS_VIDEO_MODELS` 完全一致，避免前端展示服务端未开放的供应商。
- [ ] 所有显式外部 endpoint 使用 HTTPS。
- [ ] release 根目录内只有一份非符号链接 `.env.local`，路径精确为 `<workdir>/.env.local`，owner 为 root，group/other 无任何权限；蓝绿脚本拒绝共享 env、release 外 env 和符号链接。
- [ ] `CANVAS_RECONCILE_SECRET` 在 Web `.env.local` 与稳定 worker env 文件中完全一致；内部 health 和 reconcile 都通过该 Bearer 鉴权，但密钥不进入命令行、PM2 metadata 或回滚包。

## 3. 先审查 dry-run

下列命令不会修改服务器：

```bash
bash deploy/canvas-blue-green.sh deploy \
  --workdir /var/www/tiktok-ai-mcn-releases/<commit> \
  --candidate-port <unused-port> \
  --candidate-name stargaze-canvas-<short-commit> \
  --reconciler-env-file /etc/stargaze/canvas-reconciler.env \
  --nginx-config /etc/nginx/sites-available/toryxai.com \
  --public-health-url https://www.toryxai.com/canvas
```

- [ ] 审查解析后的 workdir、端口、PM2 名称、Nginx 文件和公网健康地址。
- [ ] 确认活动 Nginx 文件只含一个 `proxy_pass http://127.0.0.1:<port>;` 目标；脚本遇到零个或多个目标会失败关闭。
- [ ] 确认活动 Nginx 文件含精确的 `location ^~ /api/internal/canvas/ { return 404; }`；health、reconcile 和人工 recovery API 只能直连 loopback，公网不得代理。
- [ ] 确认服务器上 `node`、`npm`、`pm2`、`curl`、`nginx` 可用，运行脚本的用户是当前 PM2/Nginx 所有者（现有生产拓扑为 root）。
- [ ] 确认 release 的 `.env.local` 包含绝对路径 `NODE_EXTRA_CA_CERTS`；发布器会在切流前用独立 Node 子进程验证 Broker TLS，并确认 PM2 在 Node 启动前注入该 CA。

### 3.1 仅首发旧版 bootstrap

如果当前线上 release 尚无 `/api/internal/canvas/health`，正常发布会失败关闭。只有首次引入该契约、且已人工确认旧版没有 reconciler 时，才可在 dry-run 和最终执行命令中显式加入 `--allow-legacy-active`。脚本仍会严格校验旧 PM2 name/port/root、磁盘 `.next/BUILD_ID`、root-only `.env.local`、当前 Nginx 和直连 `/canvas`，并要求 worker 完全不存在；bundle 会永久记录 `legacy-bootstrap`，不能自动沿用到后续发布。

- [ ] 已记录这是一次性 bootstrap、审批人和旧 build id；若旧 worker 存在，禁止使用该参数。
- [ ] 候选仍完整通过 exact HTTP 200 JSON、候选 build id、共享 DB 和 27 RPC 契约；该参数不放宽候选健康门。

## 4. 执行蓝绿发布

只有完成 dry-run 审查后，才在同一命令末尾加入 `--execute`：

```bash
bash deploy/canvas-blue-green.sh deploy \
  --workdir /var/www/tiktok-ai-mcn-releases/<commit> \
  --candidate-port <unused-port> \
  --candidate-name stargaze-canvas-<short-commit> \
  --reconciler-env-file /etc/stargaze/canvas-reconciler.env \
  --nginx-config /etc/nginx/sites-available/toryxai.com \
  --public-health-url https://www.toryxai.com/canvas \
  --execute
```

脚本按以下顺序执行：

1. 校验 Node 20、生产环境变量与候选目录。
2. 执行 `npm ci --include=dev`，再由 `scripts/run-canvas-build.mjs` 清除继承的应用变量、仅以受限 OS allowlist + release 内精确 `.env.local` 构建；禁止直接用带有 root/PM2 陈旧变量的 `npm run build`。
3. 再次预检，并要求 `.next/BUILD_ID` 存在。
4. 以唯一 PM2 名称通过 `scripts/start-canvas-web.mjs` 启动候选实例；bootstrap 清除继承的 provider/Supabase/OSS/Canvas/`NODE_OPTIONS` 变量，仅以受限 OS allowlist + release 内精确 `.env.local` 重建环境，并校验名称、端口、workdir、单实例 fork 和 `online` 状态。
5. 带 Bearer 直连 `GET /api/internal/canvas/health`，只接受 HTTP 200、精确 JSON、候选 `.next/BUILD_ID`、应用版本、DB 只读探针和 27 个必需 lifecycle/recovery/upload RPC 的签名、ACL、`SECURITY DEFINER` 与受审 `search_path` 契约；再附加检查 `/canvas`。
6. 对当前旧 Web 执行同一 exact-health 检查；常规发布中旧 release 不具备新健康契约时失败关闭。只有第 3.1 节显式首发流程可登记一个无 worker 的 `legacy-bootstrap` 目标。
7. 创建权限 `0700` 的完整 rollback bundle：旧 Nginx、旧 Web PM2 身份/端口/root/env/build、worker 是否存在、脚本/配置/settings/loopback URL 和逐文件 SHA-256；任何不一致都不切流。
8. 原子切换 Nginx，执行 `nginx -t`、reload 和公网 `/canvas` 复检，再原子安装/reload 唯一 worker。
9. worker 与内部 health 再次通过后才 `pm2 save` 并提交。Nginx 或 worker 任一步失败都会从同一个 bundle 一体恢复；不是只恢复 Nginx。

- [ ] 保存脚本输出的完整 rollback bundle 绝对路径；确认目录及其文件均为 root-only，`node scripts/canvas-rollback-bundle.mjs verify ...` 校验通过。
- [ ] 再次记录活动 Nginx SHA-256、候选 PID/重启次数、端口和 `.next/BUILD_ID`（不要记录密钥）。

## 5. 超级画布上线验收

使用专门的低余额测试账号，按真实用户路径执行；禁止直接修改数据库伪造成功。

- [ ] 新建画布、添加节点、连接节点、拖动/缩放、保存、关闭并重新打开后内容一致。
- [ ] writer lock/heartbeat 正常；第二标签页进入只读，不抢写、不覆盖新 revision。
- [ ] 文生图成功，生成记录、画布节点、OSS object key 和媒体预览一致。
- [ ] 图生视频成功，刷新页面/关闭重开后仍能恢复进度与终态。
- [ ] 同一 action 重试或双击不会重复提交、重复扣费或产生同用户重复 operation anchor。
- [ ] 成功任务只扣一次；失败任务退款一次；profile 不出现负余额。
- [ ] provider 提交不确定时真实状态为 `unknown`，进入 reconciliation，不盲目重提。
- [ ] 下载图片/视频成功，返回的是用户有权访问的 OSS 对象。
- [ ] 供应商超时、503、浏览器断网、刷新、两标签页并发均有可理解的用户提示和可恢复路径。
- [ ] 公网静态资源、登录跳转、Canvas API、图片 provider、视频 provider 和 OSS 均无新增 5xx。

只读巡检可由以下生成器产出 SQL，再由有权限的受控数据库通道执行：

```bash
node scripts/canvas-additive-production-operation.mjs postflight
```

巡检口径必须满足：

- `provider_submission_state = 'unknown'` 的积压量符合预期；
- 负余额为 0；
- 重复锚按 `(user_id, operation_anchor)` 统计，同一文本锚出现在不同用户不算冲突；
- 超出租约的 submitting/unknown/reconciling 任务为 0 或正在受控收敛。

### 5.1 验收通过后启用上传配额与孤儿清理

直接上传在签发凭证前占用配额；未完成的 reservation 和不再引用的对象必须由定时任务收敛，否则用户最终会耗尽累计配额。该 timer 不属于 Web/worker rollback bundle，因此禁止在黄金路径和烘焙验收通过前安装。验收通过后再安装同一不可变 release 的 systemd timer：

```bash
bash deploy/install-canvas-upload-sweeper.sh validate \
  --release-dir "$PWD" \
  --env-file "$PWD/.env.local"

bash deploy/install-canvas-upload-sweeper.sh install \
  --release-dir "$PWD" \
  --env-file "$PWD/.env.local" \
  --execute
```

- [ ] `stargaze-canvas-upload-sweeper.timer` 为 active，初次 oneshot 的 `Result=success`。
- [ ] worker 只在 OSS 删除成功或确认对象不存在后释放累计配额；每日上传尝试额度不会因删除而返还。
- [ ] 日志仅包含聚合计数，不包含 object key、密钥或请求头。
- [ ] 记录 timer 当前 release 路径；删除旧 release 前确认任何 unit 都未引用它。

## 6. 回滚

触发条件包括：公网健康检查失败、持续 5xx、writer lock 大面积异常、重复扣费、负余额、unknown/reconciliation 积压连续增长、OSS 归属错误或核心黄金路径失败。

timer 不在 Web/worker rollback bundle 中。若已安装，必须先验证停用，避免它继续执行失败 release 中具有 OSS 删除权限的代码：

```bash
systemctl disable --now stargaze-canvas-upload-sweeper.timer
systemctl stop stargaze-canvas-upload-sweeper.service
! systemctl is-active --quiet stargaze-canvas-upload-sweeper.timer
! systemctl is-enabled --quiet stargaze-canvas-upload-sweeper.timer
! systemctl is-active --quiet stargaze-canvas-upload-sweeper.service
```

蓝绿脚本会在 timer 仍 active 或 enabled 时拒绝回滚。随后先 dry-run：

```bash
bash deploy/canvas-blue-green.sh rollback \
  --workdir /var/www/tiktok-ai-mcn-releases/<current-tooling-release> \
  --rollback-bundle /var/backups/stargaze-canvas/<exact-bundle> \
  --nginx-config /etc/nginx/sites-available/toryxai.com \
  --public-health-url https://www.toryxai.com/canvas
```

确认 bundle 的目标 Web 进程仍以精确 PM2 身份在线、内部 health 的 build/DB/RPC 契约和 `/canvas` 均通过后，再加入 `--execute`。脚本先为当前 Web+worker 创建一个新的 forward-recovery bundle，再一体恢复目标 worker 与 Nginx。目标记录为首次部署“无 worker”时，会删除新 worker 并恢复原有文件缺席状态。回滚中任一步失败，脚本从 forward bundle 恢复回滚前 Web+worker；不要使用旧版单个 `.conf` 备份。

- [ ] 回滚应用流量不等于回滚数据库。Canvas P1 迁移为前向兼容时保留数据库结构，除非另有已审查的数据回退方案。
- [ ] 回滚目标仍是 legacy release 时保持 upload timer 禁用；回滚到已验证的新式 release 后，重新用该 release 的 installer 执行 validate/install，不能直接启用旧 unit。
- [ ] 回滚后保留失败 release、PM2 日志和 Nginx 备份用于复盘，不在现场删除。
