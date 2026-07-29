# 超级画布 Reconciler 生产运行清单

这个进程负责在用户关闭标签页后继续收敛图片/视频任务。它不直接访问数据库，
只通过带 Bearer 鉴权的本机接口
`POST /api/internal/canvas/reconcile` 驱动服务端租约流程。

## 不变量

- PM2 中固定只有一个 `stargaze-canvas-reconciler`，始终为 fork 单实例。
- worker 只接受 `http://127.0.0.1:<port>/api/internal/canvas/reconcile`
  或 IPv6 loopback 的精确地址；拒绝公网地址、重定向、查询串和 URL 凭据。
- `CANVAS_RECONCILE_SECRET` 只从指定的非符号链接 env 文件读取。它不进入命令行、
  PM2 env、安装目录或日志。
- 进程文件锁是主单例边界；数据库 `SKIP LOCKED`/lease 是崩溃和人工误操作下的第二道
  防线。
- 蓝绿发布保留旧 Web 进程，但会用固定 PM2 名称原地 reload worker，所以不会留下
  “旧 release worker + 新 release worker”两套常驻进程。

## 1. 准备稳定 secret 文件

在 release 目录之外创建稳定文件，例如
`/etc/stargaze/canvas-reconciler.env`：

```dotenv
CANVAS_RECONCILE_SECRET=<与 Web release 完全相同、至少 32 字符的随机值>
```

检查：

```bash
chown root:root /etc/stargaze/canvas-reconciler.env
chmod 0600 /etc/stargaze/canvas-reconciler.env
```

不要将文件内容复制到终端、工单或发布日志。worker 允许专用服务组使用 `0640`，
但拒绝 group-write 以及任何 other 权限。

## 2. 只读验证

```bash
cd /var/www/tiktok-ai-mcn-releases/<commit>

node scripts/verify-canvas-reconciler-worker.mjs
node scripts/verify-canvas-blue-green.mjs

/bin/bash -p deploy/install-canvas-reconciler.sh validate \
  --env-file /etc/stargaze/canvas-reconciler.env \
  --url http://127.0.0.1:<candidate-port>/api/internal/canvas/reconcile
```

`validate` 不写文件、不访问接口、不改变 PM2。它会校验精确 Node `24.18.0` 与
PM2 `6.0.14`，并要求 Node、PM2 CLI、PM2 package tree、source release tree 的
canonical 文件及从 `/` 开始的完整路径链均为 root 所有、无可逃逸符号链接且
group/other 不可写；同时校验 env 文件权限、secret 形状、loopback URL 和 PM2 配置。
真正安装前还必须独占部署锁，并用 existing-only RPC 探针证明 PM2 daemon 的 PID、
Node/Daemon argv、启动环境和 RPC/PUB socket 身份；daemon 缺失时不会自动启动。
所有 PM2 写命令都预加载受信 no-auto-start guard；daemon 在命令前瞬时退出也只会
失败关闭，不会由 CLI 自动拉起替代进程。
安装后从同一 RPC 连接验证 `node_version=24.18.0`、`exec_interpreter` 精确等于该
受信 Node 绝对路径，并且 `node_args` 精确为 `["--"]`。

一次性 cron 兼容模式：

```bash
NODE_ENV=production node -- scripts/canvas-reconciler-worker.mjs \
  --once \
  --env-file /etc/stargaze/canvas-reconciler.env \
  --url http://127.0.0.1:<active-reconcile-port>/api/internal/canvas/reconcile \
  --lock-file /run/stargaze-canvas-reconciler.lock
```

如果常驻 worker 正在运行，`--once` 会安全记录 `singleton_busy/skipped` 并以 0
退出，不会并发提交第二轮。

## 3. 蓝绿发布

生产发布必须显式提供稳定 secret 文件：

```bash
/bin/bash -p deploy/canvas-blue-green.sh deploy \
  --workdir /var/www/tiktok-ai-mcn-releases/<commit> \
  --candidate-port <unused-port> \
  --candidate-name stargaze-canvas-<short-commit> \
  --reconciler-env-file /etc/stargaze/canvas-reconciler.env \
  --nginx-config /etc/nginx/sites-available/toryxai.com \
  --public-health-url https://www.toryxai.com/canvas
```

审查 dry-run 后，原命令末尾加入 `--execute`。切换顺序固定为：

1. 构建并启动候选 Web，校验候选进程身份；内部健康门只接受精确 HTTP 200 JSON，
   且响应中的 `.next/BUILD_ID`、应用版本、DB 只读探针和必需 lifecycle/recovery RPC
   契约必须匹配候选 release。随后再检查直连 `/canvas`。
2. 对旧 Web 执行相同内部健康门，并将旧 Nginx、Web 身份和完整 worker
   presence/script/config/settings/URL 写入 root-only、逐文件 SHA-256 校验的 rollback
   bundle。
3. 原子切换 Nginx，并通过公网 `/canvas` 健康门。
4. 将 worker 脚本/PM2 配置原子复制到稳定的
   `/opt/stargaze-canvas-reconciler`。
5. 用固定 PM2 名称 `startOrReload`，让唯一 worker 直连候选 localhost 端口。
6. worker 只有在接口鉴权成功并收到合法聚合响应后才向 PM2 发送 `ready`。
7. 校验 PM2 中恰好一个 online/fork worker并再次通过内部健康门，再 `pm2 save`，
   发布才提交。

若 Nginx 或 worker 任一步失败，外层脚本从同一个 rollback bundle 恢复旧 worker
文件、PM2 presence/settings/URL 和旧 Nginx，再停止候选进程。首次发布前不存在
worker 时，恢复动作会删除新 worker 和新安装文件。因此不会出现流量已回滚但 worker
仍指向失败 release 的状态。

首次从尚无内部 health/reconciler 的旧线上版本引入该发布体系时，可在受审命令中显式
加入 `--allow-legacy-active`。这是一次性 bootstrap，不是健康检查降级：候选仍须通过
exact build + DB + 27 RPC；旧版必须由脚本证明 PM2/root/BUILD_ID/`/canvas` 基线且
worker 不存在。bundle 会持久化 `legacy-bootstrap`，回滚它时恢复旧 Web 并删除新
worker。后续发布不得再次携带此参数。

## 4. 回滚语义

回滚输入不再是单个 Nginx `.conf`，而是发布脚本输出的完整 bundle：

```bash
/bin/bash -p deploy/canvas-blue-green.sh rollback \
  --workdir /var/www/tiktok-ai-mcn-releases/<current-tooling-release> \
  --rollback-bundle /var/backups/stargaze-canvas/<exact-bundle> \
  --nginx-config /etc/nginx/sites-available/toryxai.com \
  --public-health-url https://www.toryxai.com/canvas
```

执行前脚本会验证 bundle 的 root-only ownership、逐文件 SHA-256、Web PM2
name/port/root/BUILD_ID、内部 DB/RPC 契约以及保存的 worker URL。然后先把当前状态
保存成 forward-recovery bundle，才一体恢复目标 worker 和 Nginx。目标 bundle 记录
worker 不存在时，回滚必须停止/删除当前 worker；记录存在时则恢复脚本、配置、settings
和当时的 loopback URL。任何失败都会用 forward bundle 恢复回滚前状态。

公网 Nginx 必须包含：

```nginx
location ^~ /api/internal/canvas/ {
    return 404;
}
```

health、reconcile 和人工 recovery 接口只允许 Node loopback 直连，不得通过公网域名
代理。不要停止 rollback 或 forward bundle 引用的 Web 进程和 release 目录。

## 5. 日常观察与告警

```bash
pm2 status
pm2 logs stargaze-canvas-reconciler --lines 100
```

日志只包含事件、HTTP 状态、耗时和以下聚合计数：
`claimed/completed/failed/markedUnknown/released/sweptText/sweptNotStarted/errors`。
不会输出 secret、请求头、URL、env 内容或响应原文。

应告警：

- worker 不为唯一 `online` fork 进程；
- 连续 `timeout`、`http_error` 或 `network_or_protocol_error`；
- `consecutiveFailures` 持续增长；
- `degraded`/`errors` 持续非零；
- `markedUnknown` 持续增长且无人工审计；
- worker 当前直连的 Web 端口即将被停止。

收到 SIGTERM/SIGINT 时，worker 会 abort 在途 HTTP、释放自身文件锁并干净退出；
服务端已领取的 DB lease 仍保证任务后续可回收。
