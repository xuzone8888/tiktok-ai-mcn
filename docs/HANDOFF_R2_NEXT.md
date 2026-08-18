# 交接：R2 + R2-Q4 + #185 收口全部完成 · 2026-08-09 状态

> **新窗口开工顺序**：`CLAUDE.md` → `docs/EXECUTION_TRACKER.md`「当前状态」→ **本文件 §负一/§负二** → `docs/SUPER_CANVAS_P0_BOARD.md`。
> **动手前先跑 §一 第零步核对**（sha 与端口已按本轮发版更新）。
>
> ⚠️ **§零～§九 是 2026-08-08 写的，多条已被后续推翻，只当背景读。以 §负一/§负二 为准。**

---

## 负一、当前真实状态（2026-08-09 晚）

**线上 `3dee031f00d1c7c5931c3911f845337140b54cf0`，端口 3015**（`DEPLOY_RC=0`，BUILD_ID 门通过）。
回滚包 `canvas-rollback-20260809T071016Z-port-3014-1002117`；`33ba71d`/3014 与 `d16620f`/3013 两个回滚位在线。
`abc29ac`/3012 已 `pm2 stop`（腾内存用，release 目录还在，`pm2 start` 即可复活）。
main = `3dee031`（PR #34/#35 已合），代码面等于线上。**这两批都零迁移**，没有待你在 Supabase 手工执行的 SQL。

### 今天做完的三件大事

1. **四项裁决落笔 + CHECKLIST 改判**：9 项延 P2、#103 改措辞。`220(做 167/裁 31/延 22)`、`P0=48 P1=52 P2=55 P3=11 P4=1`。**P1 由 61 降为 52。**
2. **R2-Q4 补齐批次 6/6**：#51②③ 回前台触发+手动刷新、#187 参数人话文案、#186 灰置控件解锁指引、#84 全屏预览、#44+#72+#94 引用区缩略图带序号、#64 入库+推为参考。另修停靠位 `max-h` 常量。
3. **#185 误扣费全量审计与收口**（存活 18 条，见 P0 看板「#185 收口」小节）。用户两项裁决：
   - **`high_cost` 阈值 5000 → 1000** —— 原值物理不可达（画布单次天花板 1080），双阈值曾塌缩成单条低余额规则；
   - **自动恢复只重放服务端确有其行的 intent**，未绑定的改弹窗询问 + 配「放弃这次提交」出口；
   - 另**裁决：恒显费用条不做**，「不可取消不退款」改挂生成按钮 `title`。
   - 新增正交纯模块 `src/lib/canvas/generation-consent.ts`（出处闸），verifier 穷举证明它**永不削弱 #185**。

### 闸门与生产验证

`generation-backend` 46→**88**、`generation-frontend` 49→**136**、`s6` 138→**141**；`runtime` 544 / `intent` 122 / `s3` / `s4` / `schema` 无回归；`tsc` / `build` / `reconcile` 全绿。

生产实测（**全部零扣费**）：#84 全屏预览（开/Close/真实 Escape/卸载/视频 `readyState 4` 真播放）、#44 引用区（缩略图真加载，推为参考建的新节点立刻显示图1）、#187、#186、#51③、#64 入库（服务端确实更新，走新增的 `generationIds` 匹配键）、#64 推为参考（持久化 rev+1）、#250 删除二次确认；阈值 1000 生效（**1080 拦 / 450 不拦 / 图片 5 分不拦**）；Ctrl+Enter 弹确认**且不提交**；IME 组字期无反应。

### 三条别再重做 / 别再判错的

1. **#84 全屏预览没有缺陷。** 曾被判成「点一次就把画布点死」的阻断级问题，**那是在 hidden 标签页里验证造成的假象**（详见 §七 第一条）。前台标签下开关都正常。
2. **商品节点是功能缺失，不是没测**：渲染面只有删除按钮 + 商品简报 textarea，`input[type=file]`=0、`img`=0。属 P2。
3. **旅程 B 不是 R2 欠账**，总纲写明它 P2 才走通；`CREATABLE_NODE_TYPES` 刻意排除 script 与 compose。

---

## 负二、新窗口该做什么

### ① ✅ 三笔卡住的积分已结清（2026-08-09）

| id | 类型 | 结果 |
|---|---|---|
| `9848fcb4-4bad-46e3-bf47-3acc8fe7ce34` | image | `pending/unknown → failed`，退 5 |
| `329a5399-f50f-420d-9ce1-b95f3e8c82fa` | video | 同上 |
| `02e20c34-8fc6-45b4-8bee-f4b50deb73dd` | video | 同上 |

余额 18459 → **18474**（+15）。**生产已无 `pending` 行。**
`provider_submission_state` 仍留 `unknown` 是设计如此——它记录「当时确实不知道」，裁决只改状态与退款，不篡改历史。

> **最大收获不是那 15 积分**：`9848fcb4` 是唯一一笔图片 unknown，**R2-Q2 那个「让人工裁决 RPC 支持图片行」的迁移至此才第一次在真实图片行上跑通**（此前只是在生产执行了 DDL，从没被调用过）。

**操作方式（下次照做）**：`scripts/resolve-canvas-unknown.mjs`
```
node scripts/resolve-canvas-unknown.mjs \
  --url http://127.0.0.1:<线上端口>/api/internal/canvas/resolve-unknown \
  --env-file ./.env.local --request-file /root/<req>.json [--execute]
```
- **`--url` 必须是完整端点路径**（只给 `http://127.0.0.1:<port>` 会被拒：「must be the exact numeric-loopback HTTP recovery endpoint」）；
- 请求文件须 root 独占 `0600`，字段＝`resolutionId`(uuid) / `generationId` / `resolution`（`verified_no_task_refund` 时 `taskId` 必须为 `null`）/ `approvalTicket` / `providerEvidence`(8-1700 字，写清「为什么断定厂商没接单」)；
- 不带 `--execute` 是干跑校验，先跑它；
- 端点要 `CANVAS_RECOVERY_ADMIN_SECRET` 与 `CANVAS_RECOVERY_APPROVER_SECRET` **两个不同**的密钥（代码显式校验不相等＝双人复核）。生产已配好（各 64 位）。
- ⚠️ **但这两个密钥同在服务器一个 `.env.local` 里**，有 root 就两个都拿得到 —— **双人复核在当前部署下是名义上的**。真要这道控制生效，得把 approver 密钥挪到另一个人/另一处保管。

只读探针：`/root/r2probe.sh`（`balance|gens N|ledger N`）。

### ② ✅ 测试画布 `047fb5dd` 的 2 个空商品节点已删（rev 59 → 61）

现只剩 `node_Fdwjog578y-E`（图片，有成品图）→ `node_vgRTVmF9kJi-`（视频，有成片）一条链，是干净的回归夹具。

### ③ ✅ 已对所有人开放（2026-08-09 用户裁决：跳过灰度阶梯）

用户判断「网站用户很少，不用扩灰度」，直接 `CANVAS_PUBLIC_ENABLED=false → true` 并 `pm2 restart --update-env`。
该开关是**运行时读**（`process.env.CANVAS_PUBLIC_ENABLED`，无 `NEXT_PUBLIC_` 前缀），**不需要重新构建**。
`CANVAS_ACCESS_USER_IDS` 那两个 uuid 保留未动，作为回退时的白名单。
回退＝改回 `false` + 重启；改前备份 `.env.local.bak-prepublic-20260809T154137Z`（在 release 目录内）。

⚠️ **已对所有登录用户开放，意味着下面「P1 未做完的部分」现在人人可见**。画布**每点一次生成就真扣钱且退不了**（七模型 `supportsCancel` 全 false）：happyhorse 5 秒 450 分 / 12 秒 1080 分（1080 会弹确认，450 不会）。

> 未实测项：无法用非白名单账号验证放行效果（手头只有白名单账号）。已核对的是：`.env.local` 值正确、进程带 `--update-env` 重启、站点 200。

### ③-b 🔴 P1 还没做完——52 项里这些既没改判也没补齐

安全面（计费/对账/状态机/并发/鉴权/误扣费）已全部收口并生产验证；下面全是「功能比规格薄」，不是「会出事」。

| # | 项 | 现状 |
|---|---|---|
| **67** | **商品节点轻量版（上传图+文本→卖点卡）** | 只有删除按钮 + 一个 textarea。**双轨起点之一，整条链缺失**；不会崩，退化成带商品标签的文本节点 |
| 81/82/83 | 图片工具条：高清 / 裁剪 / 整图重生成 | `NodeToolbar` 全仓 0 —— **三项共缺一个承载面，必须打包做** |
| 85 | 商品多角度 nine_grid 透传 | 画布对 `/api/generate/image` 引用数 0，够不着现成分支 |
| 43 | 「输入已更新」dirty 角标 | 全仓 0 |
| 92 | 图片空态快捷（图生图/图片高清） | 空态只有 4 个建节点按钮 |
| 182 | @引用素材（@节点/@历史） | 全仓 0 |
| 211 | 交互式教程 | `canvas-chrome-policy.ts` 里 `enabled:false`，本体不存在 |
| 78 | 图片比例 13 种 | 面板 6 种。**曾扩到 11 项又撤回**——上游 `sizeMap` 每档只有 6 个 key，多出的会静默回落 auto 却按全价扣费。要补必须先给 sizeMap 补像素尺寸，那是 quick-gen/image-factory 共用链路 |

> ⚠️ 这张表是「R2-Q4 逐项复核结论」与「今天补齐清单」交叉得出的，**不是今天重新逐项核过**。
> 动手前**第一件事就是按 R2-Q4 的三重交叉重核一遍**（面板渲染面枚举 + 特征串全仓 grep + 生产 UI 实测），别直接照抄——今天已经有过「文档说某处有某物、实际没有」的先例。

### ③-c P1 收尾的建议批次（按依赖与承载面分组，不是按工时）

**批 0 · 先重核（半天，必须先做）**
用三重交叉把上面 8 项逐个再验一遍，产出「确实缺 / 其实有 / 判据变了」三分。**其中至少两项我预判会有变化**：#78 图片比例受上游 sizeMap 限制、#85 受「画布够不着 `/api/generate/image`」限制，这两条的性质更接近「外部条件不具备」而非「没做」。

**批 1 · 节点级工具条承载面 + 两件工具（#82 裁剪 / #83 整图重生成）**
`NodeToolbar` 全仓 0 命中 —— #81/#82/#83/#85 四项都以它为前提，**必须先建承载面**，这也是 R2-Q4 判定的两个「跨切片结构性问题」之一。
先做能自足的两件：**#83 整图重生成**＝复用画布已有的生图链路（最省）；**#82 裁剪**＝纯前端。

**批 2 · 🔴 需用户裁决后才能做(#81 高清 / #85 nine_grid)**
两者都要用 `/api/generate/image` 里现成的 `upscale` / `nine_grid` 分支，**但画布对该路由引用数为 0**（画布只调 6 组 `/api/canvas/*`）。要接通只有两条路，都触及 ADR：
- ① 在画布的 `generation-intent` 里扩 mode 枚举并让 `/api/canvas/generations` 转发 —— 属「参数扩展」还是「fork 执行链路」需裁决；
- ② 让画布直调 `/api/generate/image` —— 与「零 fork、执行留现有链路」的铁律 1 冲突更小，但会绕开画布自己的计费/对账链路，**这条我倾向否决**。
⚠️ CHECKLIST #85 的备注写着「复用现成 nine_grid 分支，纯 UI 露出 S」——**那个工作量估计是错的**，R2-Q4 已指出。

**批 3 · 轻量前端（#43 dirty 角标 / #92 图片空态快捷）**
#43 ＝节点存上游 `generationId` 快照、与当前值比对即知（CHECKLIST 自己写的做法）；#92 ＝空态多两个按钮。两项都不碰资金链路。

**批 4 · #182 @引用素材（@节点 / @历史）**
要一个提及选择器（M）。**引用区（#44）已经做好了「已引用」这一半**，#182 是「怎么加引用」那一半，两者应共用同一份数据源与序号语义，别各写一套。

**批 5 · #67 商品节点轻量版（最大一块，双轨起点之一）**
现状只有删除按钮 + 一个 textarea。要补「上传图 + 卖点卡」。复用件：`src/lib/studio/product-vision.ts` + `blueprints.product` jsonb（CHECKLIST 已指明）。**建议单独一批做，别和别的混**——它是电商轨的入口，做砸了用户第一步就卡住。

**批 6 · #211 交互式教程**
`canvas-chrome-policy.ts` 里 `enabled:false`，本体不存在。注意 **#237「教程完成奖励积分」已改判延 P2**，所以这一批只做教程本体，不做发奖。

**🔴 单独提请裁决：#78 图片比例 13 种**
面板 6 种。曾扩到 11 项**又撤回**——上游 `getVideoPlatformImageSize` 的 `sizeMap` 每档只有 6 个 key，末行 `sizeMap[r]?.[ratio] || sizeMap[r]?.auto || null` 会让多出来的档位**静默回落 auto 却按全价扣费**。要真补必须先给 sizeMap 补像素尺寸并确认 gpt-image-2 接受，而那是 **quick-gen / image-factory 共用链路，不属画布单方改动**。
**建议：要么排期改上游，要么按「外部条件不具备」改判延 P2**（与今天那 8 项同一判据）。这条须用户拍板，AI 不擅改。

### ④ 已知但**不修**的一项

1352×642 下视频面板 `scrollHeight 485 > clientHeight 419`，**溢出 66px 需在停靠位内滚一次**，「下载/全屏/去发布」整行落在切掉的部分。比改造前（389 vs 294，溢出 95px）有改善。继续抬 `GENERATION_DOCK_MAX_HEIGHT_RATIO` 会让停靠位吃掉大半画布，**已决定不再调**，记为已知摩擦。

### ⑤ 唯一没在生产实测的功能：「放弃这次提交」

需要一个**未绑定** intent，而那要求提交处于**歧义**态（可能已送达）。「模拟断网」造不出来——代码把「确定没发出去」正确判为 definitive 并直接清掉 intent（这是对的行为）。造真歧义有真扣费风险，故未做。现有保障＝前后端 verifier 断言 + 代码复核。**下次真出现未绑定 intent 时优先目视这一项。**

### ⑥ P2（55 功能点）

五批方案已获用户认可（底座→脚本节点→资产一致性→批量闭环→收尾）。开工前置＝建 P2 看板 + 扩机器守卫；场景/道具落表方案与音频开关价目两项裁决届时提请。**未经用户裁决不要自行启动。**

---

## 负三之零、🔴 2026-08-09 发版事故：构建 OOM 把整站打挂约 15 分钟（发版前必读）

**发生了什么**：按既有流程在生产机跑 `npm run build`（`NODE_OPTIONS=--max-old-space-size=2048`，
与前两次成功发版**完全相同**的参数），约 10 分钟后**整站 `toryxai.com` 无响应、SSH 连不进**
（banner exchange 超时），load average 冲到 110。构建最终被 OOM killer `SIGKILL`。

**为什么这次挂、前两次没挂**——两个原因叠加：

1. **release pm2 进程只加不减**。每发一版就多一个常驻 web 进程（110-260MB）。事故时机器上 9 个
   pm2 进程共约 **1263MB**，而上次成功构建时只有约 1007MB。**3.4G 的机器，2GB 堆的构建
   + 1.26GB 常驻 = 必爆。**
2. **`vm.swappiness = 0`**。机器有 2GB swap 且**全程 0 使用**——这个设置下内核宁可 OOM-kill
   也不换页，swap 等于不存在。

**不幸中的万幸**：发版脚本的构建失败分支在**任何流量变更之前** `exit 1`。**没有发生蓝绿切换，
nginx 全程指着旧版**，内存一放出来站点自己就回来了，不需要回滚。**这条设计救了场，别去动它。**

**下次发版必须先做（前置，不是可选）**：

```bash
pm2 stop <3 代以前的 stargaze-canvas-* 进程>
free -m   # 确认 available ≥ 2000MB 再开构建
```

- **用 `pm2 stop` 不要 `pm2 delete`**——release 目录还在，真要回滚 `pm2 start <name>` 几秒拉起来，
  停着不占内存。
- 本轮停了 `stargaze-runtime-guard-fea0bcb`(3007)、`stargaze-canvas-e77d4df`(3010)、
  `stargaze-canvas-a24a4e3`(3011)，释放 **423MB**，available 1664 → 2036MB，重跑一次过。
- ⚠️ **`stargaze-runtime-guard-fea0bcb` 名字有误导**：它不是监控守卫，就是第 4 代画布 release 的
  web 进程（`start-canvas-web.mjs --port 3007`）。nginx 对 3007/3010/3011 零引用。
- ⚠️ **别动**：`stargaze-canvas-<线上sha>`、`stargaze-canvas-reconciler`、`tiktok-ai-mcn`(3000，
  非画布主应用)、`okspeak-proxy`(8788)。
- **前一版交接把「清理老 release」写成磁盘问题——那是错的**。磁盘从来不紧张（事故时余 10G），
  **真正的紧箍咒是内存**；按磁盘算余量会得出「还能再发两次」的错误结论。
- 想更稳可另行提请用户裁决临时调高 `vm.swappiness`（属系统设置，AI 不擅自改）。

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
ssh root@123.56.75.68 'R=/var/www/tiktok-ai-mcn-releases/3dee031f00d1c7c5931c3911f845337140b54cf0; curl -s -o /dev/null -w "site HTTP %{http_code}\n" https://toryxai.com/; curl -s -o /dev/null -w "/canvas(anon) %{http_code}\n" https://toryxai.com/canvas; grep -oE "proxy_pass http://127.0.0.1:[0-9]+" /etc/nginx/sites-available/toryxai.com | tail -1; grep -E "^VIDEO_PLATFORM_IMAGE_BASE_URL=|^CANVAS_VIDEO_MODELS=|^CANVAS_PUBLIC_ENABLED=|^CANVAS_ACCESS_USER_IDS=" $R/.env.local; pm2 list | grep -E "3dee031|reconciler"; free -m | head -2; df -h /var/www | tail -1'
```

**预期**（2026-08-09 二次发版后）：站点 200；`/canvas` 未登录 **307**；nginx→**3015**；
`VIDEO_PLATFORM_IMAGE_BASE_URL=https://api.hellobabygo.com`（**若不是，图片生成又坏了，先修**）；
`CANVAS_VIDEO_MODELS=happyhorse`；`CANVAS_PUBLIC_ENABLED=false` 且 `CANVAS_ACCESS_USER_IDS` 为 **2 个 uuid**；
`stargaze-canvas-3dee031` 与 reconciler 均 online；内存 available ≈1.8-2.0G；磁盘余约 7.7G。

> 回滚位备查：`33ba71d`/3014、`d16620f`/3013 仍 online；`abc29ac`/3012 已 `pm2 stop`（腾内存，目录还在，`pm2 start` 可复活）。**这三个都不是当前线上。**
> ⚠️ **磁盘只剩 7.7G、每个 release 约 1.7G：下次发版前先清最老的 release 目录**（清前确认对应 pm2 进程已 stop）。

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
- 🔴 **开工第一件事:先查 `document.visibilityState` 与 `requestAnimationFrame` 是否真的在跑。**
  后台/被遮挡的标签页里 Chrome 会停掉渲染,`rAF` 一帧都不发,于是 **CSS 动画被创建、
  `getAnimations()` 报 `playState:"running"`,却永远不推进、永不派发 `animationend`**。
  2026-08-09 因此误判过一次:Radix Dialog 关闭时 `data-state` 已变 `closed`,但元素等不到
  `animationend` 就不卸载,`body{pointer-events:none}` 一直挂着 —— 现象与「点一次全屏预览
  就把画布点死」一模一样,我据此差点建议回滚一个**完全正常**的功能。
  一句话自检:
  ```js
  ({v:document.visibilityState, f:document.hasFocus(),
    raf: await new Promise(r=>{const t=setTimeout(()=>r('NO-FRAME'),1200);requestAnimationFrame(()=>{clearTimeout(t);r('ok')})})})
  ```
  `NO-FRAME` = **任何动画/媒体相关的结论一律作废**(媒体加载同样被节流,`<video>` 会卡在
  `readyState 0`)。DOM/布局层的断言不受影响(`getBoundingClientRect`、文本、图片 `naturalWidth` 都正常)。
  `tabs_create_mcp` 并不能让它变可见——**整个 Chrome 窗口必须在前台**,这一步得请用户配合。
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
