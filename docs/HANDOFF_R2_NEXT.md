# 交接：R2 已收口 · 2026-08-09 状态与后续清单

> **本文件纳入 git 跟踪**（前几份 `HANDOFF_*.md` 在仓库根、未跟踪、已过期，可删）。
> 新窗口开工顺序：`CLAUDE.md` → `docs/EXECUTION_TRACKER.md`「当前状态」→ **本文件** → `docs/SUPER_CANVAS_P0_BOARD.md`（R2 走查表 + R2-Q1~Q4 问题区）。
> **动手前先跑第零步重新核对**（第零步里的 sha 与端口已按本轮发版更新）。
>
> ⚠️ **下面「§零～§九」是 2026-08-08 白天写的,其中若干条已被当晚的收口推翻。以本节(§负一)为准,正文只当背景读。**

---

## 负一、当前真实状态（2026-08-09，R2 已全部收口）

**线上版本 `d16620f34f09d2418cdb805b068aae61d2a55e3d`，端口 3013**（2026-08-08 二次发版，`DEPLOY_RC=0`）。
回滚包 `canvas-rollback-20260808T152332Z-port-3012-934510`；上一版 `abc29ac`/3012 仍在线待回滚。
main = `74fbee3`（PR #29/#30/#31/#32 全部已合；代码面等于线上跑的 `d16620f`，#32 是纯文档）。

### 已经做完、别再重做的

| 事项 | 证据 |
|---|---|
| **画布视频链路已在生产跑通** | happyhorse `a40b3114`：`pending→processing→completed` 约 2 分钟，`bound`+真 task_id，450 积分实扣零退款。**「视频从未成功过」这条已翻篇** |
| **R2-Q3 完整收口** | running 期间删除按钮 `disabled=false`（旧版恒 true）→ 三选一（「取消并退款」按 `supportsCancel=false` 禁用并明示 /「仅移除节点」/「返回」）→ 点仅移除后节点从视图与文档双双移除，**任务照常跑到 completed、零退款，历史资产 3 张变 4 张** |
| **#188 / #180 / #181 / #189 已上线并实测** | Ctrl+Enter 真实按键触发拦截式确认；参数胶囊 5→4+「更多参数（1）」；面板在 ≤1366 时 dock 底部且不压工具条 |
| **1366×768 全流程走查通过，卡点 0** | 实测视口 CSS 1352×586。侧栏图标态、小地图收起、dock 底部、留 14px 间隙、胶囊折叠全过 |
| **资金①②⑤ 全过** | ⑤ 已含 450 视频档重跑：7 笔 consume↔7 笔 generation 1:1、链式无断点、Σcost=485=B0−终余额、零 refund |
| **R2-Q1 / R2-Q2** | 均已裁决并落地（happyhorse 名单 / 图片 unknown 恢复迁移已在生产执行） |

### 三条必须记住的更正（前一版本文写错了）

1. **旅程 B 不是 R2 的欠账**。总纲 §二写明它「**P2 可走通**」，整条链依赖脚本节点/资产装配/批量/合成；代码侧 `CREATABLE_NODE_TYPES` **刻意排除 script 与 compose**。CHECKLIST #262 的「P1 **起**」是走查纪律的起始期。
2. **商品节点是功能缺失，不是没测**。生产渲染面只有删除按钮 + 商品简报 textarea，`input[type=file]`=0、`img`=0 —— 没有上传图、没有卖点卡。**别再当测试任务派。**
3. **#184 费用汇总条、#185 拦截式确认此前被误记为「已做到」，其实是 partial**；而且 **#185 的实现方向与规格相反**（代码是 `cost>0` 每次付费都弹，规格是「仅限余额<预估×1.2 或单次>5000⚡」）。

### R2-Q4 的准确口径（取代「约 23 项没实现」）

60 项（#262 是零代码流程项，不计入）= **implemented 15 / partial 30 / missing 15**。
3 项翻案为已实现：#71 整图编辑、#224 billing_mode、#260 失败退款。

> ⚠️ **本段原写「完整分档清单、每项工作量档位/依赖/风险、便宜活排序，全在 P0 看板 R2-Q4 复核第二轮小节」
> —— 2026-08-09 核实为失准**：看板当时全文对 `#44`/`#72`/`#84`/`#94`/`#186`/`#187`/`#64` 零命中，
> 只有汇总数与 8+1 提案，那张分档表**从未落盘**。现已按 §负二③ 幸存的 6 行摘要重建、逐项重新代码实证，
> 并首次写进 P0 看板「**R2-Q4 补齐批次:便宜活排序**」小节（重建时把 #44+#72+#94 从第 1 位调到第 5 位，
> 理由写在该表下方）。**教训与 §零 那条同源：本项目文档会说「某处有某物」，先验后信。**

---

## 负二、新窗口该做什么（按顺序）

### ① ✅ 已完成（2026-08-09 取得四项裁决）

- **#185**：按原规格改代码（双阈值），不改规格 → 已落地 `70d2ded`
- **#253 / #51①**：已 bound 行不做自动判死退款，该半延 P2，P1 内改运维告警口径 → 已落笔
- **#237**：随 #211 教程一起延 P2 → 已落笔
- **资金③④**：等价验收结案 → 已落笔

<details><summary>原文（提问时的四个议题，保留备查）</summary>

- **#185 拦截式确认**：实现方向与规格相反，改的是资金确认边界。
- **#253 / #51①**：已 bound 到厂商 task 的行要不要加超时判死自动退款（有误退真实成功任务的风险；DB 明文 RAISE 禁止对 unknown 自动退款）。
- **#237 grant 首个用例**：涉发放金额，且前置教程 #211 入口硬关。
- **资金③（退款恰好一条）与资金④（并发双扣直击）的结案口径**：两者结构性无法在生产直击（③ 已裁决不做取消入口 + 画布零失败；④ 与「不得程序化触发扣费」冲突）。**建议以库级唯一锚点 + 实弹脚本 R44/R42 作为等价验收结案**，请用户拍板。

</details>

### ② ✅ 已完成：CHECKLIST 8+1 项改判落笔（`a4ab093`）

8 项延 P2：#93 / #101 / #102 / #105 / #112 / #79 / #80 / #76。
#103 只改措辞：「时长滑杆」→「时长选择（按模型能力渲染离散档位）」，改完即算已实现。
另按裁决追加：#237 延 P2、#253 行文收窄为「未 bound 行」、#185 备注裁决。

连带两张统计表 + CLAUDE.md 期次表；`canvas-checklist-reconcile.mjs` 绿：
`220（做 167 / 裁 31 / 延 22）`、`P0=48 P1=52 P2=55 P3=11 P4=1`。**P1 由 61 降为 52。**

### ③ R2-Q4 补齐批次（进行中）

**排序表已首次落进 P0 看板「R2-Q4 补齐批次:便宜活排序」小节**（含每项现状实证 / 档位 / 依赖风险）。
现行顺序：**① #51②③ 回前台触发+常态手动刷新（XS，修真实故障）→ ② #187 参数人话文案 →
③ #186 灰置控件解锁指引 → ④ #84 全屏预览 → ⑤ #44+#72+#94 引用区缩略图带序号（M）→
⑥ #64 入库+推为参考（M，唯一有服务端面）**。

⚠️ 本批**原计划「一行不碰资金链路」，但 #185 裁决为改代码后已不成立**——#185 动的正是资金确认边界，
故单独 commit、单独验（`70d2ded`）。

**顺手项已完成（`1f9d887`）**：停靠位高度上限另立 `GENERATION_DOCK_MAX_HEIGHT_RATIO=0.75`。
⚠️ 成因描述更正：`canvas-board.tsx:1415` 原是**硬编码 `max-h-[55%]`**，并未引用
`GENERATION_PANEL_MAX_HEIGHT_RATIO`——是重复魔数，不是「误用常量」。

### ④ 之后才谈扩灰度

白名单 2 → 3-5 真实用户观察 3-7 天 → `CANVAS_PUBLIC_ENABLED=true`。

---

## 负三、发版流程新增的两条（务必照做）

1. **蓝绿切流会打断写者租约心跳**，正在编辑的标签页立刻掉进「写者心跳异常→只读」保护态。这是单写者锁 fail-closed 的**正确行为**，约 30 秒后新会话自动接管；但**发版公告必须提示用户刷新页面**。
2. **服务器 `git fetch` 打不通 GitHub**（阿里云→GitHub 常年 GnuTLS 断流，本轮实测失败）。可靠做法：本地 `git bundle create rel.bundle <老sha>..origin/main`（增量，本轮只有 64KB）→ `ssh 'cat > /root/rel.bundle'` 传上去 → 服务器 `git fetch /root/rel.bundle 'refs/remotes/origin/main:refs/heads/<tmp>'` → `git checkout -f <sha>`。
   另：release 目录**别从零 `cp -a`**（1.7G，本轮一次被 ssh 断连掐死），用 `rsync -a --exclude .next` 从上一个 release 目录同步（`.next` 占 689M，不该带），且必须 `setsid nohup` 脱离终端跑。

## 负四、浏览器走查环境的坑（本轮新踩）

- **Chrome 窗口最大化时 `resize_window` / `chrome.windows.update` 完全无效**（`outerWidth/outerHeight` 报 0），必须**人工先把窗口从最大化还原**。
- **页面 reload 会把窗口重新最大化** → 顺序必须是「先导航 → 再 resize → 之后不 reload」。
- 窗口压小后**截图与 CSS 是 1:1**，不用再做坐标换算；反之最大化时要换算，且**视口尺寸一变，之前算的坐标立刻作废**（本轮因此连续点空数次）。
- **禁用 `zoom` 动作**代替缩放：会留下改不回来的 CDP 视口覆盖。

## 负五、残留物

- 测试画布 `047fb5dd` 里还有 **2 个空商品节点**（`node_v3hNjrCWBTz3` / `node_KSK8Zcdoj9f2`），走查误建、无产物未扣费，随手删即可。
- 卡住的积分仍是 3 笔共 15 分（2 视频 + 1 图片），**用户裁决一律先不动**。
- **余额 18459**；本轮走查共花 455（视频 450 + 图片 5），用户授权额度 4000。
- 生产 release 目录已有 5 个，磁盘余 **11G**，每个约 1.1-1.7G ——**再发 2 次前必须先清最老的**（`fea0bcbe` / `e77d4df5`），清理前确认对应 pm2 进程已下线。

## 零、一句话现状（2026-08-08 白天写，已被上面推翻，保留备查）

**安全缺口全部堵完并已发版实测生效；计费/对账/状态机/并发那一整层是真做到了。但 2026-08-08 全量复核推翻了「P1 已 100% 完成」——生成器面板比 CHECKLIST 承诺的薄一大截，61 项里约 23 项「标了做但没实现」（R2-Q4）。R2 走查主线旅程 A 还有 5 步没跑完，商品节点整条链路完全没碰，旅程 B 一步没走。扩灰度的前置条件远未满足。**

> **最重要的一条认知**：这个项目的文档会说「已完成」，但**实现面可能比文档窄**。R2-Q3 是这么发现的（CHECKLIST 标做/P1、代码里连字样都没有），R2-Q4 是顺着这条线索把 61 项全核了一遍的结果。**下个窗口对任何「已完成」的断言都要先验后信**，验法见 R2-Q4 的三重交叉（面板渲染面枚举 + 特征串全仓 grep + 生产 UI 实测）。

---

## 一、第零步 · 前置核对（只读，动手前必做）

```bash
cd /e/StarGaze && git fetch origin --prune --no-tags && git rev-parse --short origin/main && git log --oneline origin/main..codex/canvas-p1-acceptance
```

```bash
ssh root@123.56.75.68 'R=/var/www/tiktok-ai-mcn-releases/d16620f34f09d2418cdb805b068aae61d2a55e3d; curl -s -o /dev/null -w "site HTTP %{http_code}\n" https://toryxai.com/; curl -s -o /dev/null -w "/canvas(anon) %{http_code}\n" https://toryxai.com/canvas; grep -oE "proxy_pass http://127.0.0.1:[0-9]+" /etc/nginx/sites-available/toryxai.com | tail -1; grep -E "^VIDEO_PLATFORM_IMAGE_BASE_URL=|^CANVAS_VIDEO_MODELS=|^NEXT_PUBLIC_CANVAS_VIDEO_MODELS=" $R/.env.local; pm2 list | grep -E "d16620f|reconciler"; df -h /var/www | tail -1'
```

**预期**（2026-08-08 二次发版后）：站点 200；`/canvas` 未登录 **307**；nginx→**3013**；`VIDEO_PLATFORM_IMAGE_BASE_URL=https://api.hellobabygo.com`（**若不是，图片生成又坏了，先修**）；两个 `CANVAS_VIDEO_MODELS=happyhorse`；`stargaze-canvas-d16620f` 与 reconciler 均 online；磁盘余约 11G。

> 旧值备查：上一版是 `abc29ac…`/3012，仍在线待回滚，**别把它当成当前线上**。

**与预期不符 → 停下核对，不要按本文档继续。**

---

## 二、已完成（不用重做）

| 事项 | 证据 |
|---|---|
| P0（48 功能点）工程 + 上线 | 见 EXECUTION_TRACKER。**P1 的功能面只做到一部分，见 R2-Q4** |
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

### 3.1 ✅ 已完成：图片 unknown 恢复迁移已在生产执行

2026-08-08 用户授权后由 AI 控制浏览器在 Supabase dashboard 执行（项目 `hfabrifuvujpdzarlbky` / Tiktok Ai / main / PRODUCTION）。

- **字节保真**：编辑器内容取自 GitHub raw（commit `ee00997d…`），在页面内算出 git blob SHA-1 与本地文件比对**完全一致**（`e1e81d0f…`）后才执行 —— 不是手打、不是复述。
- 执行结果 `Success. No rows returned`
- **改动后核对**：`fn_accepts_image=true`、`fn_still_video_only=false`、`service_role_can_exec=true`（`CREATE OR REPLACE` 未丢 GRANT）、**卡住那笔图片行 `stuck_row_now_eligible=true`**、`credit_cost=5 / credits_refunded=0`（按用户裁决未动它）
- 迁移文件仍在 PR #29 里等合并 —— **代码库记录与生产已经一致，但 PR 未合时 main 里没有这份迁移，别忘了合**

### 3.2 🔴 待裁决：R2-Q4「P1 约 23 项标了做但没实现」

这是本轮最大的发现，也是**下个窗口的头号议题**。完整清单与判据在 P0 看板 R2-Q4。两条路：

- ① **按 CHECKLIST 补齐**——工作量不小，建议拆批。有两项是「机制落了但没接线」的便宜活：`planCapsuleCollapse` 与 `resolveGenerationPanelDock` 已在 `canvas-responsive.ts` 写好且有常量，只是**在定义文件之外零引用**，接上就能兑现「参数胶囊≥5 折叠」和「面板超视口 dock 底部」两项。
- ② **逐项改判「裁/延」并同步 CHECKLIST**——铁律 10 须用户裁决，改后必须跑 `canvas-checklist-reconcile.mjs` 至绿。

**无论走哪条，「P1 已 100% 完成」的说法都必须先纠正**（tracker 已改）。也要先定这个，再谈扩灰度和 P2。

### 3.3 🔴 待用户裁决：R2-Q3「删除 running 节点三选一」

CHECKLIST #251 明列为 **做/P1**，但**根本没实现**（只有禁用按钮 + title）。二选一：
- ① 按规格补齐三选一（至少补「仅移除」——这一项与网关能力无关，没有不做的技术理由）
- ② 改判为「裁/延」并同步 CHECKLIST（铁律 10 须用户裁决；改后必须跑 `canvas-checklist-reconcile.mjs` 至绿）

**这项没定，资金③退款就永远没有用户侧触发入口**，CHECKLIST #260 也跟着无法验收。

### 3.4 补跑 R2 剩余走查（**需先要预算**）

按走查卡逐项对照后仍缺的（完整表见 P0 看板）。⚠️ 其中两项已被 R2-Q4 判定为**功能本身不存在，不是没测到**，别再当测试任务派：

| 项 | 做法 | 预算 |
|---|---|---|
| 主线④ 图生视频状态流转 | 改用 **happyhorse** 重跑 queued→running→done | 5 秒 **450 积分**，须用户先批 |
| 主线⑤ 成片预览/下载 | 依赖④。**「去发布」禁止 AI 点** | — |
| 主线⑥「输入已更新」dirty 角标 | ❌ **功能不存在**（R2-Q4，全仓 0 命中）→ 归入 R2-Q4 裁决，不是测试项 | — |
| 主线⑦ 商品节点全链路 | 传图 → 卖点卡 → 接视频节点。**本轮完全未碰，最大未覆盖面** | 视链路而定 |
| 主线③ 引用区缩略图 | 计数已验证；缩略图与序号按 R2-Q4 判为缺失 → 同上归入裁决 | 0 |
| **旅程 B（剧情创作起点）** | ❌ **一步没走**。CHECKLIST #61 要求 A≤7 步 / B≤9 步双旅程 | 待估 |
| 资金③ 退款恰好一条 | **依赖 3.2**：有取消入口才能触发 | 0（退款） |

> ⚠️ 上一轮授权是「≤100 积分」，happyhorse 单次 450 已超，**必须重新要授权**。

### 3.5 扩灰度（前置未满足，别抢跑）

阶梯：白名单 2 → 3-5 真实用户观察 3-7 天 → `CANVAS_PUBLIC_ENABLED=true`。
**前置**：3.1/3.2 落地 + 3.3 主线跑通。当前视频链路刚换模型且未实跑过一次成功生成，不宜扩人。

### 3.6 P2（55 功能点）

五批方案已获用户认可（底座→脚本节点→资产一致性→批量闭环→收尾）。开工前置：建 P2 看板 + 扩机器守卫；场景/道具落表方案与音频开关价目两项裁决届时提请。**未经用户裁决不要自行启动。**

---

## 四、四个缺陷速查（详情在 P0 看板问题区）

| 编号 | 一句话 | 状态 |
|---|---|---|
| **R2-Q1** | 画布视频生成自上线起 100% 不可用：厂商 hellobabygo 对 `grok-imagine-1.0-video` 返 503「无可用通道」；每次扣 5 分后落 unknown，不出片也不退款 | ✅ 已裁决处置：名单只留 happyhorse，**grok 接口代码全部保留**，等换 API 供应商后放回 |
| **R2-Q2** | 图片侧 unknown 没有出口：图片车道跑满 20 次会停放等人工裁决，但人工裁决 RPC 只认 `type='video'` | ✅ **已修**：迁移已写好并**已在生产执行**（见 §3.1），卡住那笔图片行现已满足裁决前置 |
| **R2-Q3** | 「删除 running 节点三选一」是 P1 承诺功能但根本没实现 | ⏳ 待裁决 |
| **R2-Q4** | **P1 的 61 项里约 23 项「标了做但没实现」**：生成器面板只有 6 个参数，图片没有模型选择器、没有生成数量、比例 6 种而非 13 种；视频只有 2 模式而非 5、比例缺 21:9、无清晰度档位、时长是 select 不是滑杆；参数胶囊与 dock 底部两个机制已写好但**零引用没接线**；@引用素材/Ctrl+Enter/如何解锁指引/dirty 角标/交互式教程全缺 | ⏳ 待裁决（**下个窗口头号议题**） |

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

1. **git 全流程由 AI 自主执行**（2026-08-08 用户裁决放宽）：push、开 PR、合并进 main、删远端分支都不必等用户点。依据是**自动部署被 `LEGACY_WEBHOOK_DEPLOY_ENABLED=false` 关着，合 main 不会上线**，上线只发生在手工蓝绿那一步。
   - 仍守住三条：**禁 `git push --force`**（仓库无 CI、无必需审查，分支保护是唯一结构性防线）；**删远端分支前逐个人工确认**（`merge-base --is-ancestor` 会把「从旧 main 建出、没提交过内容的空工作分支」误判成可删，2026-08-06 已误删过两个，见 §8.1）；**发布到生产仍是独立决策**，合 main ≠ 发版。
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
