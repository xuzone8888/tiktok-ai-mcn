# 交接：R2 收尾 · 2026-08-08 状态与后续清单

> **本文件纳入 git 跟踪**（前几份 `HANDOFF_*.md` 在仓库根、未跟踪、已过期，可删）。
> 新窗口开工顺序：`CLAUDE.md` → `docs/EXECUTION_TRACKER.md`「当前状态」→ **本文件** → `docs/SUPER_CANVAS_P0_BOARD.md`（R2 走查表 + R2-Q1/Q2/Q3 问题区）。
> 所有断言均为 2026-08-08 生产实测。**动手前先跑第零步重新核对。**

---

## 零、一句话现状

**P0+P1 工程与迁移全部上线；安全缺口全部堵完并已发版实测生效；R2 走查过了资金硬门与并发/租约类的项，但主线旅程 A 有 5 步没跑完（商品节点整条链路完全没碰），并查出 3 个真实缺陷（其中 1 个是 P1 功能缺失）。扩灰度的前置条件尚未满足。**

---

## 一、第零步 · 前置核对（只读，动手前必做）

```bash
cd /e/StarGaze && git fetch origin --prune --no-tags && git rev-parse --short origin/main && git log --oneline origin/main..codex/canvas-p1-acceptance
```

```bash
ssh root@123.56.75.68 'R=/var/www/tiktok-ai-mcn-releases/abc29ac3d807fe9bb1e95b204da436f066bdd9f4; curl -s -o /dev/null -w "site HTTP %{http_code}\n" https://toryxai.com/; grep -oE "proxy_pass http://127.0.0.1:[0-9]+" /etc/nginx/sites-available/toryxai.com | tail -1; grep -E "^VIDEO_PLATFORM_IMAGE_BASE_URL=|^CANVAS_VIDEO_MODELS=|^NEXT_PUBLIC_CANVAS_VIDEO_MODELS=" $R/.env.local; pm2 list | grep -E "abc29ac|reconciler"'
```

**预期**：站点 200；nginx→**3012**；`VIDEO_PLATFORM_IMAGE_BASE_URL=https://api.hellobabygo.com`（**若不是，图片生成又坏了，先修**）；两个 `CANVAS_VIDEO_MODELS=happyhorse`；`stargaze-canvas-abc29ac` 与 reconciler 均 online。

**与预期不符 → 停下核对，不要按本文档继续。**

---

## 二、已完成（不用重做）

| 事项 | 证据 |
|---|---|
| P0（48 功能点）/ P1（61 功能点）工程 + 11 个迁移 + 上线 | 见 EXECUTION_TRACKER |
| R1 验收 | 31 verifier 30 绿、tsc/build 绿、性能四预算全过。详见 P0 看板 R1 明细 |
| **13 个零鉴权接口全部修完并发版** | 生产未登录实测 **15 个路由全部 401**（11 video-batch + 4 admin）；同管理员登录态下用户详情页四板块 200 且渲染真实数据 → 读得到、匿名读不到，零回归 |
| **happyhorse 启用** | 模型下拉只剩 HappyHorse；时长随模型从 10/15 秒变 5/12 秒；价目 450 与 catalog 一致 |
| 发版 `abc29ac`（端口 3012） | 回滚包 `canvas-rollback-20260808T115215Z-port-3011-915446`；旧版 3011 仍在线；脚本存档 `/var/backups/stargaze-canvas/deploy-abc29ac-20260808T115215Z.sh` |
| R2 已过项 | 见 P0 看板「R2 生产走查进展」表（资金①②⑤、双标签只读横幅、关标签自愈+租约接管、价目表、伪造请求拦截、非白名单模型拦截、图片端到端） |

### 发版必看的两条坑

1. **手工 build 必须带 `CANVAS_RELEASE_COMMIT=<40位sha>`**，否则 `generateBuildId` 落回随机值，蓝绿脚本「BUILD_ID 必须等于 release commit」的门会 FAIL。正确写法：
   `CANVAS_RELEASE_COMMIT=<sha> NODE_OPTIONS=--max-old-space-size=2048 npm run build`
   （`NODE_OPTIONS` 限内存是因为机器只 3.4G；而蓝绿脚本自己 `unset NODE_OPTIONS`，所以不能让它代跑构建，只能手工 build + `--skip-build`。）
2. 新 release 的 `.env.local` **从当前线上那份复制**（现为 `abc29ac…`）。预检对「名单不含 grok」会报 2 条 WARN，是预期的，不阻断。

---

## 三、待办清单（建议顺序）

### 3.1 🔴 用户手工：执行图片 unknown 恢复迁移

迁移已落盘：`supabase/migrations/20260808_canvas_image_unknown_resolution.sql`（见 R2-Q2）。**照铁律 4，生产执行 = 用户经 Supabase dashboard。合 PR ≠ 功能生效。**

执行后，那笔卡住的图片行才有出口。

### 3.2 🔴 待用户裁决：R2-Q3「删除 running 节点三选一」

CHECKLIST #251 明列为 **做/P1**，但**根本没实现**（只有禁用按钮 + title）。二选一：
- ① 按规格补齐三选一（至少补「仅移除」——这一项与网关能力无关，没有不做的技术理由）
- ② 改判为「裁/延」并同步 CHECKLIST（铁律 10 须用户裁决；改后必须跑 `canvas-checklist-reconcile.mjs` 至绿）

**这项没定，资金③退款就永远没有用户侧触发入口**，CHECKLIST #260 也跟着无法验收。

### 3.3 补跑 R2 剩余走查（**需先要预算**）

按走查卡逐项对照后仍缺的（完整表见 P0 看板）：

| 项 | 做法 | 预算 |
|---|---|---|
| 主线④ 图生视频状态流转 | 改用 **happyhorse** 重跑 queued→running→done | 5 秒 **450 积分**，须用户先批 |
| 主线⑤ 成片预览/下载 | 依赖④。**「去发布」禁止 AI 点** | — |
| 主线⑥「输入已更新」dirty 角标 | 图片节点重新生成 → 看下游视频节点角标 | 5（图片 1K） |
| 主线⑦ 商品节点全链路 | 传图 → 卖点卡 → 接视频节点 | 视链路而定 |
| 主线③ 引用区缩略图 | 目视确认（连线本身已验证） | 0 |
| 资金③ 退款恰好一条 | **依赖 3.2**：有取消入口才能触发 | 0（退款） |

> ⚠️ 上一轮授权是「≤100 积分」，happyhorse 单次 450 已超，**必须重新要授权**。

### 3.4 扩灰度（前置未满足，别抢跑）

阶梯：白名单 2 → 3-5 真实用户观察 3-7 天 → `CANVAS_PUBLIC_ENABLED=true`。
**前置**：3.1/3.2 落地 + 3.3 主线跑通。当前视频链路刚换模型且未实跑过一次成功生成，不宜扩人。

### 3.5 P2（55 功能点）

五批方案已获用户认可（底座→脚本节点→资产一致性→批量闭环→收尾）。开工前置：建 P2 看板 + 扩机器守卫；场景/道具落表方案与音频开关价目两项裁决届时提请。**未经用户裁决不要自行启动。**

---

## 四、三个缺陷速查（详情在 P0 看板问题区）

| 编号 | 一句话 | 状态 |
|---|---|---|
| **R2-Q1** | 画布视频生成自上线起 100% 不可用：厂商 hellobabygo 对 `grok-imagine-1.0-video` 返 503「无可用通道」；每次扣 5 分后落 unknown，不出片也不退款 | ✅ 已裁决处置：名单只留 happyhorse，**grok 接口代码全部保留**，等换 API 供应商后放回 |
| **R2-Q2** | 图片侧 unknown 没有出口：图片车道跑满 20 次会停放等人工裁决，但人工裁决 RPC 只认 `type='video'` | ✅ 迁移已落盘，⏳ 待用户执行 |
| **R2-Q3** | 「删除 running 节点三选一」是 P1 承诺功能但根本没实现 | ⏳ 待裁决 |

**为什么 unknown 的钱回不来（三个机制叠加）**：
`claim_canvas_generation_reconciliation_v1` 写死 `provider_submission_state <> 'unknown'`（注释亦言明"Excludes every unknown row"）→ 没有车道认领；`fail_canvas_generation_v1` 显式禁止对 unknown 失败/退款（"Uncertainty is never resolved by failing/refunding"）→ 不能自动退；唯一出口是双人复核的 `resolve_canvas_video_unknown_v1`，且它原先只认 video。

---

## 五、残留物与账目

- **卡住的积分 3 笔共 15 分**：视频 `329a5399`、`02e20c34`，图片 `9848fcb4`。**用户裁决一律先不动。**
- **别删这两个测试画布**：`a67e9e55-37cc-4d57-84c4-f3e62f2d097c`（3 节点，含两笔卡住的视频）、`047fb5dd-215e-4a56-8b0b-e9f553608859`（发版后回归用，含 1 张成品图）。卡住的生成用 `canvas_id`/`canvas_node_id` 指向它们，将来做恢复裁决要用。
- **余额 18914**。
- 探测 DashScope 可用性时用空 prompt 建了一个真实 happyhorse 任务 `2d12b877-d223-496b-b93f-011364346898`（厂商侧计费，不涉用户积分）。
- 服务器上有只读探针 `/root/r2probe.sh`（root 700，运行时才读密钥、不落盘），用法 `r2probe.sh balance|gens N|ledger N`，不再需要可删。

---

## 六、铁律（沿用）

1. **AI 绝不 push**；**合并进 main、删远端分支一律用户人工点**。**PR 由 AI 开**（2026-08-08 用户长期授权）。
2. 不得 `git push --force`。
3. 生产操作顺序不可颠倒，每步验证站点 200，非 200 立即停止报告。
4. **迁移全手工**：SQL 落盘 + 本地校验，生产执行 = 用户经 Supabase dashboard。**合 PR ≠ 功能生效。**
5. 自动部署被开关关着（`LEGACY_WEBHOOK_DEPLOY_ENABLED=false`），webhook 仍活跃，**别打开**。
6. 零 fork：执行留现有链路（BTM/网关/generations），画布只是编排视图。
7. commit 中文、里程碑级、结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
8. 改 CHECKLIST 或 P0 看板后必须跑 `node scripts/canvas-checklist-reconcile.mjs` 至绿。
9. **不要点「去发布」/直发 TikTok**——对外发布不可逆，必须用户本人操作。
10. 功能取舍不擅改：做/裁/延与期次以 CHECKLIST 为准；认为需调整→写「建议调整」交用户。

---

## 七、浏览器走查的执行技巧（踩过的坑，务必照做）

- **坐标换算**：`computer` 点击用**截图像素坐标**，`getBoundingClientRect()` 是 **CSS 坐标**。换算 `scale = 1568 / window.innerWidth`（视口 2048 时为 0.7656，1254 时为 1.25）。**每次都现算，别记死数。**
- **不要用 `zoom` 动作**：它会留下 CDP 设备视口覆盖（实测把 innerWidth 打到 540×183），`resize_window` 也改不回来，只能换新标签页。要看细节就用 `read_page` / `javascript_tool` 读 DOM。
- **截图与点击之间不要隔着窗口尺寸变化**：本轮就因为按一张「尺寸变化中途」的截图算坐标而点空，白等了一轮。点完关键按钮**立刻用数据库探针确认**是否真产生了副作用，别靠截图判断。
- **生成器面板只在节点 selected 且 zoom≥0.4 时渲染**；节点未选中时查不到任何 select/textarea，这不是缺陷。
- **节点重叠**：选中的节点会渲染在上层并挡住其它节点。先点空白处取消选中，再点目标节点。
- **扣费按钮必须用 `computer` 真实点击**，不要用 JS `btn.click()`（权限分类器会拦程序化触发扣费）。
- 浏览器工具不支持 `ctrl+0`（被当作浏览器缩放拦截），用画布自己的「适应视图」按钮。
- 后台（hidden）标签页会暂停渲染与尺寸测量，测帧率/连线前必须让标签**前台可见**。
- `Page.captureScreenshot` 偶发 30s 超时，**重试一次即可**，不是页面挂了。

---

## 八、从上一份继承的未完事项（勿丢）

### 8.1 严禁误删的两个远端分支

`origin/codex/facebook-review-readiness-v25`（丹丹在做 Facebook 审核 + Graph API v20→v25）与 `origin/codex/i18n-zh-en`（待开工，全站中英文）都停在 `5f946de`。用 `git merge-base --is-ancestor` 判会显示「已全部合入 main → 可删」，**这是误判**——它们是从旧 main 建出、还没提交过内容的空工作分支。2026-08-06 已因这个误判误删过两个同类分支，靠远端副本才恢复。**批量清理必须排除。**

### 8.2 三项未完成的清理（均不影响运行）

| 项 | 做法 |
|---|---|
| C 盘 worktree 约 5.3G | **需管理员 PowerShell**：`Remove-Item -LiteralPath 'C:\CodexData\worktrees\780f' -Recurse -Force`；之后 `git -C E:/StarGaze worktree prune && git -C E:/StarGaze branch -d codex/canvas-r4-deterministic-build-id`。卡住原因：`.tmp` 下 6 个目录 Permission denied |
| 远端分支 `codex/youtube-compliance-remediation` | PR #26 已合并。**删远端分支一律用户人工做** |
| 备份目录 `E:\StarGaze-lf-validation-backup-20260808`(129K) | 确认 C 盘清理无误后可删 |

### 8.3 其余本地分支（有真实未合内容，别乱删）

`codex/next15-production-security`、`feat/social-publish-teammate-synced`、`feat/social-engagement`、`feat/social-comments-data-review`，以及 3 个文档策略分支（`claude/studio-content-strategy-777716`、`claude/objective-snyder-fcf2f7`、`claude/stargaze-strategy-evaluation-c1694e`，后者含手机 App 美区方案任务书等 main 里没有的决策记录，建议保留）。

### 8.4 生产回滚资产（不得删除）

线上 release 目录 4 个都别删：`abc29ac…`(3012，当前线上)、`a24a4e30…`(3011，上一版)、`e77d4df5…`(3010)、`fea0bcbe…`(3007)。回滚包 `/var/backups/stargaze-canvas/` **整个目录不得删除**。磁盘剩 13G，每个 release 约 1.7G，再发 2-3 次需要先清理最老的。

---

## 九、已知遗留（不影响当前主线）

1. **Mac ffmpeg worker 离线**：`127.0.0.1:9091` 无监听，幻灯片渲染/字幕预览/视频拼接三功能不通。复活时 Mac 端 `WORKER_AUTH_TOKEN` 必须与服务器 `MAC_WORKER_TOKEN` 完全相同（新版 fail-closed，非 64 位 hex 拒绝启动）。
2. `sms/send`、`sms/verify` 用 service-role 且无登录态鉴权——属登录前流程，是另一类风险（枚举/限流），建议单独评估。
3. 服务器 crontab 有条健康检查把 cron secret 明文写在命令行（`ps` 可见），建议改从文件读。
4. `E:\StarGaze` 主仓库 `node_modules` 为空，要在主仓库跑 dev/build 得先 `npm install`。
5. 生产 `generations` 存在「`status=completed` 但 `error_message` 残留中途重试错误」的现象（如 `75806825`、`bebca173` 都带 "No available channel"，但产物真实存在）。不影响功能，属数据卫生问题。
6. `docs/SUPER_CANVAS_P1_ACCELERATED_EXECUTION_PLAN.md` 顶部状态标记仍是过期的 `PHASE_4_COMPLETE_OFFLINE_GREEN`、Phase 5/6 checkbox 全空——**与生产事实不符**，已在文件顶部加过期声明。判断进度一律以 EXECUTION_TRACKER + 生产实测为准，不要信文档 checkbox。
