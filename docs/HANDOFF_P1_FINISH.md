# 交接：P1 收尾 · 批 5 已过离线闸门、**待 UI 复验** · 2026-08-10 晚状态

> **这份是新窗口的实际入口。** 开工顺序：`CLAUDE.md` → **本文件** → `docs/SUPER_CANVAS_P0_BOARD.md` 「批 5」节。
> `docs/HANDOFF_R2_NEXT.md` 是 2026-08-09 那轮的交接，**只当背景读**；与本文件冲突的以本文件为准。
> （§七 画布点击/渲染踩坑 与 §负三 发版前置 仍然有效、必读。）

---

## 零、开工第一条命令

```bash
cd E:/StarGaze/.claude/worktrees/stargaze-canvas-p1-finish-d06ab1 && git log --oneline -3 && node scripts/canvas-checklist-reconcile.mjs && npx tsc --noEmit && echo TSC_OK && node scripts/verify-canvas-p1-batch5.mjs 2>&1 | tail -3
```

工作区 `E:\StarGaze\.claude\worktrees\stargaze-canvas-p1-finish-d06ab1`，分支 `claude/stargaze-canvas-p1-finish-d06ab1`，
**已 push 到 origin 作备份（`f8e7c33`）、未合并、未发版**（用户裁决：未复验不合入）。

🔴 **本分支现在既领先也落后 main**：`git rev-list --count origin/main..HEAD` = 22、
`git rev-list --count HEAD..origin/main` = **5**（Facebook 那批已合进 main，见下）。
**合批 5/批 6 之前必须先把 origin/main 合进来。** 那 5 个 commit 不碰画布，预计无冲突。
⚠️ 领先/落后量一律现查，**别信任何文档里写死的数字，包括这一份**。

---

## 一、当前真实状态

### 🆕 线上已经变了：不再是 `3dee031`/3015

**线上现在是 `273d083d77a83e340f6be668f22930fb2f75ae9f`，端口 3016**
（2026-08-10 发的 **Facebook Graph v25 + App Review 准备**，与画布无关）。
`3dee031`/3015 仍在线作回滚位；`33ba71d`/3014 与 `d16620f`/3013 已 `pm2 stop`（腾内存，`pm2 start` 秒起）。

**那次发版的完整记录在 [`docs/RELEASE_20260810_FACEBOOK_V25.md`](./RELEASE_20260810_FACEBOOK_V25.md)**
（PR #39，纯文档）。**它不是画布工作，但有三条会影响你的判断**：

1. **画布「推为参考」的资金缺陷仍在线**——`generation-controls.tsx` 里 `data: { title: "以图生视频" }`，
   而权威提示词就是 `data.title` ⇒ 建出的视频节点带着用户没写过的提示词，一按生成 450 积分。
   修复在**本分支**上，**要等批 5/批 6 一起发版才生效**。
2. 线上那次发版**没有**带上 Supabase Edge Function（发版流程结构上碰不到它），也**没有**带画布代码。
3. 发版纪律有四处修正（bundle 源必须写死 `origin/main`、BUILD_ID 门不校验工作树内容所以 checkout 后必须回读 sha、
   手工 build 拿不到内存优势、`NEXT_PUBLIC_*` 是构建期烘焙）——**下次发画布版直接照那份记录做，别照
   `SUPER_CANVAS_P1_RELEASE_RUNBOOK.md`**（那是 2026-07-28 的历史档案，连 `canvas-blue-green` 都 0 命中）。
   当前权威：命令看 `deploy/CANVAS_PRODUCTION_CHECKLIST.md`，坑与前置看 `HANDOFF_R2_NEXT.md`。

### 生产库

🆕 **迁移 `20260810_canvas_media_readiness_history_assets.sql` 已于 2026-08-10 在 Supabase dashboard 执行**
（用户授权、AI 操作，返回 `Success. No rows returned`，含末尾 DO 后置断言）。
**这是本轮唯一的生产变更**，且它只改 RPC 函数体，不动数据、不动表结构。
回滚办法：把 `20260801_canvas_upload_registry.sql:684-846` 的原版原样 `CREATE OR REPLACE` 回去，一句话、无顺序陷阱。

### P1 进度

| 批次 | 内容 | 状态 |
|---|---|---|
| 批 0 | 8 项缺口三重交叉重核 | ✅ |
| 批 1 | #82 裁剪 | ✅ 6 条判据全过（判据 1 只验了「可写态下出现」半条，见 §四 E2） |
| 批 2 | #81/#85 深挖 → 改判延 P2 | ✅（裁决 P1-Q3） |
| 批 3 | #43 dirty 角标（#92 改判延 P2） | ⚠️ 判据 8 的 replaced 分支未实测，见 §四 |
| 批 4 | #182 @引用素材 + #72/#94 | ⚠️ #24 未实测，见 §四 |
| **批 5** | **#67 商品节点（方案 A）+ #169 前半** | ✅ **离线闸门全过**（`ae7d16d` / `0566ebc` / `f8e7c33`）· 🔴 **10 条 UI 判据未验 —— 你的第一件事** |
| **批 6** | **#211 教程本体（不做发奖，#237 已延 P2）** | 🔴 未开工。**用户裁决：批 5 验过了再开批 6** |

**P1 = 48 项**（reconcile 权威输出：`220(做 163/裁 31/延 26)`、`P0=48 P1=48 P2=55 P3=11 P4=1`）。
⚠️ 别沿用旧文档里的「P1=52」——那是 #78/#81/#85/#92 改判延 P2 之前的数。**以 `node scripts/canvas-checklist-reconcile.mjs` 现算为准。**
做完批 5、批 6 即 P1 收尾完成。

### 批 5 交付了什么（细节在 P0 看板「批 5」节，含四项裁决全文）

- **四项用户裁决**：①卖点卡走**手动「插入到简报」**才进提示词；②图片上限 **9**；
  ③**商品主图可作下游参考图**（CHECKLIST #169 前半提前到 P1，#169 期次未改、统计数不变）；
  ④卖点卡**只落 `params.product`**，不双写 `blueprints.product`。
- **零迁移、零 schema 版本 bump、`data` 顶层零新增字段**（顶层加字段=回滚炸弹：旧版本读到会把整节点
  判 broken → recoveryRequired → 全画布自动保存停摆）。
- 卖点卡形状**结构上没有 `images` 字段** —— 把「只存 object key」变成机器闸。
  此前这条路上**零守卫**：`unsafeStringReason` 只拦 dataURL 与带签名参数的 URL，而
  `resolveMediaUrl` 产出的是**无 query 的公有 URL**，会被放行。
- **参考图判据收成唯一出口** `src/lib/canvas/generation-image-input.ts`，客户端提交 / 服务端权威重算 /
  引用区编号 / #43 角标四处共用。`incomingImageCount` 由 `collectImageReferences` 派生 ⇒
  限张闸与 lock-hint「参考图过多」**自动跟上**，一处都不用单独改。
- 🔴 **顺带修掉 #43 一个真 bug（未发版，尚未影响生产）**：dirty 重算按连线顺序**交错**排，
  而提交路径是 `[...textInputs, ...imageSnapshots]`（文本全在前）⇒ 上游图片节点连得比文本早时
  判 `reordered`、**角标永久常亮**。#43 落地时因造不出前置（判据 8 只做一半）而没暴露。
- **新增** `scripts/verify-canvas-p1-batch5.mjs`（41 条）+ `npm run verify:canvas-p1-batch5`。

### 🔴 这批里最值钱的一条教训（verifier 差点是张空合格证）

「画布对**计费类**路由引用为 0」这条断言，初版按 SQL 写法扫计费路由
（`credits: newCredits` / `update({ credits` 等），扫到 7 个、看着挺像样 ——
**却漏掉了 `/api/generate/image`**，画布图片生成最主要的计费入口，
因为它是经 `@/lib/credits/atomic-task-credit` 的 `scope:"quick-image"` 扣的，源码里没有那些字面量。

改为主判据「**import 了 `@/lib/credits`**」后扫到 18 个，并加了**扫描器自证**：钉住
`/api/generate/image`、`/api/generate/video`、`/api/video-batch/models/submit` 三个必检路由，
任一掉出扫描面即判红。**光断言「扫到 >0 个」挡不住正则腐烂 —— 以后写这类守卫都要带自证。**

---

## 二、新窗口该做什么

### ① 🔴 第一件事：批 5 的 UI 复验（**用户裁决：验过了才开批 6**）

代码已落地、离线闸门全过，但**一条 UI 判据都没验**。10 条判据在
`docs/SUPER_CANVAS_P0_BOARD.md` 的「批 5 · 待复验」表里，逐条回填结果。

**前置（两条都要）**：

1. **dev 用 3000，别用 3100。** 本工作区 `.claude/launch.json` 只有 `canvas-dev`（`autoPort: true`）。
   3100 是已退役的兄弟工作区 `canvas-p1-acceptance` 的**旧代码**，连上去等于验错东西。
   核对办法（别只看端口）：
   ```bash
   powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine | Format-Table -AutoSize"
   ```
   看 3000 那个进程的 `CommandLine` 里是不是 `stargaze-canvas-p1-finish-d06ab1`。
2. **登录必须用户本人做，AI 不能代输密码。** 2026-08-10 用户已用
   `.temp/test-account-auth.mjs set-password` 重设过测试号密码（**密码只有用户知道，没有记在任何地方**）。
   测试号 `claude-publish-test@stargaze-test.com` / uuid `2cca16b7-2751-4afb-8369-e516b82a3a9c`，
   **余额约 15,095 分**（用户 2026-08-10 充的），视频 450/次也跑得起。
   忘了密码就再跑一次那个脚本重设（它有 uuid+邮箱双向核对的安全闸，改不到真实用户）。

**这 10 条里第 4 条最关键，别跳**：

> 🔴 **服务端日志必须出现 `[Doubao] Image converted to base64`。**
> 不出现 = 9 张图**静默退化成 qwen 单图**。机制：`imageUrlToBase64` 在 fetch 失败 / content-type 非
> `image/*` / 字节 <100 / 任何异常（含 10s abort）时**返回原始 URL**（`src/lib/doubao-api.ts:392-435`），
> 而 `analyzeWithDoubao` 的过滤器只放行 `data:` 或含 `supabase.co` 的串
> （`src/lib/studio/product-vision.ts:164-175`）⇒ `media.toryxai.com` 的图转换失败即被整批丢弃，
> `parts.length===0` 就 `return null`，**豆包一次都没调**，随后 qwen 兜底只喂 `imageUrls[0]`。
> **全程只有 `console.error`，用户侧看不出任何异常** —— 付了时间拿到质量更差的卡还不知道。
> 本机到 `media.toryxai.com` 实测可达（HTTP 403 = OSS 拒绝列桶，正常），
> 且画布在生产能正常渲染图片 ⇒ 对象是公有可读的，**理论上应该成功，但必须看日志坐实**。

⚠️ **数渲染面时的头号误判源**：生成器面板只在「节点 **selected** 且 **zoom ≥ 0.4**」时渲染。

🔴 **但商品节点不是这样,此处原文有误(2026-08-14 实证更正)**：商品节点的门**只有 `lowZoom` 一个**
（`product-node.tsx:472` 是 `{lowZoom ? ... : ...}`），上传/解析控件**和缩略图**都在 `!lowZoom` 分支里，
**与 `selected` 无关**；`selected` 只决定节点**宽度**（`wide={Boolean(selected && !lowZoom)}`，:457）。
照原文去「先选中再数」不会错，但据此断言「没选中所以数不到是正常的」会**把真缺陷放过去**。
唯一要守住的前提是 **zoom ≥ 0.4**。

### ② 批 6：#211 教程本体（🔴 **不要按「批 5 验完就开」执行** —— 2026-08-14 用户裁决「教程放最后」，本轮明确不做）

规格原文（CHECKLIST:211）：「交互式教程双版本（**电商版 P1**／漫剧版 P2，**跟手走完最短链**）+完成奖励小额积分」
⇒ P1 **只做电商版**；**发奖不做**（#237 已延 P2）。

- **开关**：`src/components/canvas/canvas-chrome-policy.ts:49`（**不是** `src/lib/canvas/`），
  当前 `{ id: "tutorial", label: "教程", enabled: false }`。消费点在
  `canvas-bottom-toolbar.tsx:138-210`（`!entry.enabled` 即禁用）。
- **"最短链"就是 CHECKLIST:41 空态快捷位②「商品图→带货视频」**，也就是批 5 刚做出来的起点：
  商品节点（上传图→解析卖点→插入简报）→ 连图片节点 → 生成逐镜图 → 连视频节点 → 图生视频。
- **承载面可复用的现成形状**：`src/components/canvas/shortcut-panel.tsx`（底部工具栏开面板的先例）。
- ⚠️ **教程只引导、绝不代替用户点生成** —— 那两步要花钱（图片 5 分 / 视频 450 分）。
- 📌 上一个窗口对形态的建议（**未经用户确认，开工前先问**）：按「跟手」字面做成**读画布真实状态推进**
  （检测到「商品节点已有主图」就自动过第一步），而不是只能点「下一步」的静态说明。
  用户也可能想要更轻的图文说明或更重的高亮遮罩强引导 —— **这属于形态取舍，先问再做，别做完再改。**

### ③ 全部完成后才合并进 main

用户裁决：未复验不合入。合前跑 `tsc` / `npm run build` / `reconcile` / PGlite 用例至绿，
**再跑一遍 `scripts/verify-canvas-*.mjs` 全家桶** —— 🆕 当前基线是 **33 个脚本、已知红 2 个**
（`blue-green` 需 Node 20、`p1-fixture` 需本机 PG，未改动的树上同样失败）。红第三个就是真回归。
（32→33 是批 5 新增的 `verify-canvas-p1-batch5.mjs`。）

🆕 **合之前还要先把 `origin/main` 合进来**——本分支落后 5 个 commit（Facebook 那批）。
现查：`git rev-list --count HEAD..origin/main`。那批不碰画布，预计无冲突，但别跳过。

🔴 **合并顺手清远端分支时，这两个分支绝对不能删**：

```
origin/codex/facebook-review-readiness-v25   ← 同事在做 Facebook 审核
origin/codex/i18n-zh-en
```

两个都停在 `5f946de`，是**从旧 main 建出、还没提交过内容的空工作分支**，
`git merge-base --is-ancestor` 会把它们误判成「已全合入、可删」。**2026-08-06 已因此误删过两个同类分支。**
（2026-08-10 实测两个都还在 origin 上。）

🔴 **发版另有两个硬前置，不在本文件里，发版前必须去读 `HANDOFF_R2_NEXT.md`**：
1. **§负三之零 · OOM 前置** —— 3.4G 机器 + `vm.swappiness=0`，**发版前必须先 `pm2 stop` 三代以前的 release
   进程、确认 `free -m` available ≥ 2000MB 再开构建**。2026-08-09 没做这步，构建 OOM 打挂整站 15 分钟。
2. **§负三 · 构建与传包** —— 手工 build **必须带 `CANVAS_RELEASE_COMMIT=<40 位 sha>`**，
   否则 `generateBuildId` 落回随机值、蓝绿脚本的 BUILD_ID 门会 FAIL；
   服务器 `git fetch` 打不通 GitHub，要走 `git bundle` 增量传包。

⚠️ `docs/SUPER_CANVAS_P1_RELEASE_RUNBOOK.md` 里**没有**上面任何一条（`CANVAS_RELEASE_COMMIT`/`bundle`/`OOM`/`pm2 stop` 四个词全 0 命中），别按标题去信它。

---

## 三、环境：已经给你铺好的（别重新踩坑）

### 怎么起、怎么进（复验的两个前置）

- **起 dev**：本工作区 `.claude/launch.json` 只有一条 `canvas-dev`（`npm run dev`，`autoPort: true`，本轮实际落在 **3000**）。
  ⚠️ **别连 3100** —— 那是兄弟工作区 `canvas-p1-acceptance` 的旧代码。
- 🔴 **登录必须用户本人做，AI 不能代输密码**。`/canvas` 在 `src/middleware.ts` 里有硬鉴权，匿名一律弹回登录页。
  登录态按 origin 存在浏览器里，**dev 重启不会掉**，但换端口（origin 变了）会掉。
- 🔴 **批 0-4 的代码没有部署**。线上 `3dee031` 是旧代码，**对 toryxai.com 验只会验到旧的** ——
  本分支的东西一律在本地验。

### ✅ 本地 dev 现在能真正出图了

**2026-08-09 之前所有窗口都以为「厂商凭证过期」，那是误判。** 真因是本地 `.env.local`
**整块缺失 `VIDEO_PLATFORM_*`（12 个键）**，三级回退全落空才 401。
已从生产 release 取回并写入本工作区 `.env.local`（git-ignored）：
`ssh root@123.56.75.68`，文件在 `/var/www/tiktok-ai-mcn-releases/3dee031…/.env.local`。

- **取的键**：`VIDEO_PLATFORM_*` 12 项 + `IMAGE_REFERENCE_ALLOWED_HOSTS` + `OPENAI_IMAGE_OSS_PREFIX`（共 14 行）
- **刻意没取**：`NODE_EXTRA_CA_CERTS` 等服务器专有项（路径在本机不存在）、社媒 OAuth、`MAC_WORKER_*`、各类 secret
  ⚠️ 那两个非 `VIDEO_PLATFORM_*` 的键都有代码默认值，漏了不会 401；但 `OPENAI_IMAGE_OSS_PREFIX` 默认是 `openai-gen` 而生产值是 `phase2-smoke/openai-gen`，**漏取会让产物 OSS key 前缀与本轮对不上账**
- 验证：`{VIDEO_PLATFORM_IMAGE_BASE_URL}/v1/models` 本机返 **200**
- 备份：`.env.local.bak-before-creds-44006ce`（取回前的原样）
- 顺带把 `CANVAS_VIDEO_MODELS` / `NEXT_PUBLIC_CANVAS_VIDEO_MODELS` 由 `grok` 改成 **`happyhorse`** 对齐生产

⚠️ **换工作区/重装依赖后要重新做一遍**（`.env.local` 每 worktree 一份、git-ignored）。

### ✅ 迁移可以先在本地真跑，不用拿生产当试验田

新增 `scripts/verify-canvas-readiness-migration.mjs` —— PGlite 起真 Postgres，按生产列结构建最小 schema、
执行迁移原文、灌真实形状的行跑 **16 条正反用例**，**不连生产、不需凭证**。

```bash
npm i --no-save @electric-sql/pglite && node scripts/verify-canvas-readiness-migration.mjs
```

🔴 **PGlite 是 `--no-save` 装的**（没写进 `package.json`，避免给生产构建加依赖）。
**跑过 `npm ci` 或重装依赖后它会消失，需要重新 `npm i --no-save`。**

> **这条打破了一个长期前提**：此前所有窗口都写「本地 dev 与生产共用同一个 Supabase，所以没法预演迁移」。
> 那句话对**数据**成立，对**SQL 本身**不成立。以后画布这类迁移都该先过 PGlite。

### 测试账号

`2cca16b7-2751-4afb-8369-e516b82a3a9c`，余额约 **95 分**（用 `/api/user/credits` 现查）。
- 图片 5 分/次，**视频 5 秒 450 分 —— 这个账号跑不起视频**
- 图片历史 6 条（5 蓝图 + 1 生成）、**视频历史 0**、音频 0
- 测试画布 `d154b6ed-a812-45ad-9f26-c1a93b828842` 上留着约 10 个验证用节点，可以直接删或另建

### 🔴 浏览器复验的八个坑（都真踩过，别省）

1. **开工第一条命令永远是 visibility+rAF 自检**，返回 `NO-FRAME` 就停下要求置前：
   ```js
   const raf = await new Promise(r => { let d=false; requestAnimationFrame(()=>{d=true;r("ok")}); setTimeout(()=>{ if(!d) r("NO-FRAME") }, 1500); });
   ({ visibilityState: document.visibilityState, raf })
   ```
   后台标签页 Chrome 停发 `rAF` → 动画永不结束 → Radix 弹层不卸载 → `body{pointer-events:none}` 常驻，
   **与真实的阻断缺陷现象完全一致**，2026-08-09 差点据此回滚一个正常功能。
2. 🆕 **Supabase dashboard 的 SPA 在 hidden 标签页里根本不渲染**（`readyState: complete` 但 `body` 为空、Monaco 不加载）。必须前台。
3. 🆕 **注意用户可能有多个 Chrome 窗口**。2026-08-10 撞到 SQL Editor 在另一个被压扁成 `1254×58` 的窗口里，
   Run 按钮在视口外，而 `resize_window` 对那个窗口**返回成功却不生效**。
   排查手法：对每个 tab 查 `innerWidth/innerHeight`，不一致就是分属不同窗口；
   解法＝用正常窗口那个 tab `navigate` 到目标 URL，再关掉坏窗口的 tab（Supabase 的 query 按 URL 里的 id 存服务端，内容会跟着回来）。
4. 🆕 **别用 `document.body.innerText` 判断 Monaco 里是什么** —— 它虚拟化，读到的常是未重绘的旧文本。
   用 `window.monaco.editor.getModels()[0].getValue()`。同理**别把整个 `window.monaco` 对象序列化返回**（55KB 垃圾）。

**上面 2-4 是 SQL Editor 场景的。画布场景另有 4 条仍然有效，来自 `HANDOFF_R2_NEXT.md` §七，必须一并读：**

5. 🔴 **生成器面板只在「节点 selected 且 zoom ≥ 0.4」时才渲染。** 节点没选中或画布缩太小时，
   查不到任何 `select`/`textarea`，**这不是缺陷**。
   ⚠️ 批 5 的复验恰恰是数商品节点渲染面里有没有 `input[type=file]`/`img`（§二① 那个「真功能缺失」结论就是这么下的），
   不知道这条会直接误判。
6. 🔴 **扣费按钮必须用 `computer` 真实点击，不能用 JS `btn.click()`** —— 权限分类器会拦程序化触发扣费，
   静默失败，容易误判成功能缺陷。
7. 🔴 **不要用 `zoom` 动作** —— 会留下改不回来的 CDP 视口覆盖（实测把 innerWidth 打到 540×183，
   `resize_window` 也救不回来，只能换标签页）。
8. **点击坐标换算**：`computer` 用截图像素坐标，`getBoundingClientRect()` 是 CSS 坐标，
   `scale = 1568 / window.innerWidth`，**每次现算**（窗口一变就失效）。
   另：节点重叠时选中的会渲染在上层挡住别的，先点空白取消选中；浏览器工具不支持 `ctrl+0`，用画布自己的「适应视图」。

---

## 四、遗留问题（都还开着，勿当已完成）

### 🔴 A. 「推为参考」把标签写进提示词 —— **这条已经在生产上了**

图片/视频节点**没有「显示标题」这回事**，`data.title` 就是逐字送厂商的提示词
（`generation-controls.tsx` 的 textarea `value={data.title}`，另一处注释白纸黑字写着「提示词就是 node.data.title，逐字送厂商」）。

三处把给人看的标签写进了这个字段，**其中「推为参考」那处（#64/`5b53a95`）已随 `3dee031` 上了生产** ——
用户点「推为参考」建出来的新视频节点，**提示词框里预填着「以图生视频」，一按生成就是 450 积分**。

三处均已在本分支修好（改为只给 `media`、提示词留空走 placeholder），**但修复生效需要发版**。
⚠️ 在批 5/批 6 发版之前，这条一直在线上。

### 🔴 A2. 缺陷乙（快图 worker 认领画布生成）**没有**在生产关闭

2026-08-10 真正在生产关掉的只有**缺陷甲**（保存闸），因为它靠一条已执行的迁移。
**乙的修复是纯代码**（`src/lib/image-generation-worker.ts` 两处查询加 `.or(source.is.null,source.neq.canvas)`，
commit `5f0429a`），在这条未 push 的分支上 ⇒ **线上跑的仍是旧逻辑**。

🔴🔴 **而且「合 main + 发一次版」修不好它 —— 这条最要命，2026-08-10 生产实测确认**：

```
crontab:  * * * * * /var/www/tiktok-ai-mcn/run-image-worker.sh
脚本里:   WORKER_URL=http://127.0.0.1:3000/api/cron/process-image-generation?...
端口 3000 = pm2 `tiktok-ai-mcn`，跑的是 /var/www/tiktok-ai-mcn/server.js（老应用目录，已连续在线 10 天）
```

而画布的发版是**蓝绿**：新建 `/var/www/tiktok-ai-mcn-releases/<sha>` + 新端口 + 切 nginx，
**老应用目录一行都不动**（nginx 现在代理到 3015，但这个 worker 根本不走 nginx，它直连 127.0.0.1:3000）。
⇒ 新窗口按 §二③ 走完「全绿 → 合 main → 发版」，**缺陷乙在生产依然是原样**。

**两条可选的收口办法（须用户裁决，别自己选）**：
1. 更新老应用目录 `/var/www/tiktok-ai-mcn` 的代码并重启 pm2 `tiktok-ai-mcn`；或
2. 把 `run-image-worker.sh` 的 `WORKER_URL` 指到当前 release 端口。

⚠️ 我第一次查这条时用 `grep -i "image-generation\|cron"` 搜 crontab，**漏掉了**这行
（条目名叫 `run-image-worker.sh`，两个关键词都不含）。查这类东西请直接 `crontab -l` 全文看。

**另有两个裁决点没做**（看板给乙提了三个，`5f0429a` 只覆盖了①加 source 过滤）：
- ② 快图退款是否一并回写 `generations.credits_refunded`（worker 里该字段至今只在注释中出现）
- ③ cron 指向 3000 老应用目录是不是发布流程遗留

🔴 **存量污染行**：已被快图车道判死并退款的那些 canvas 行仍在生产 —— **余额退了，但
`generations.credits_refunded=0`**，画布对账口径少记这笔退款。两条车道退款锚点不同
（quick-image 账本 vs `canvas-refund:<id>`），存在被画布对账二次退款的风险面。
识别口径：`credit_transactions` 描述为「图片生成失败自动退款 - GPT Image 2」且 `generations.source='canvas'`。
⚠️ **动这些行之前必须先取得用户裁决，不要自动补退。**

### 🔴 B. #43 判据 8 的 `replaced`/`regenerated` 分支仍未实测

要求下游节点的持久化快照里**已含一个图片输入**，即需要一次成功的、带图片上游的生成。
2026-08-09 深夜厂商 `gpt-image-2` 连续 3 次失败（2 次 `No available channel`、1 次超 300s），无法构造该前置。
**目前只有离线穷举覆盖。** 厂商恢复后补一次即可（成本 5 分）。
判据 7/9/10 与角标本体已全过，详见 P0 看板。

### 🔴 C. #24「历史面板切视频页签选一个必须被拒」仍未 UI 实测

该账号视频历史为 0，「切到视频页签再选一个」没有可选项。
需要一个有视频产物的账号，或先跑一次视频生成（450 分，本账号余额 95 跑不起）。**不要当作已过。**

### 🆕 D. 保存闸的信任模型有一次实质变更（已接受，收窄留后续）

`20260810` 迁移放行「蓝图引用过的 key」，而**蓝图 JSON 是用户可写的** ——
`PATCH /api/studio/blueprints/{id}` 对 `scenes[].slot.asset_ref` 只做 `slice(0,2000)`
（`src/app/api/studio/blueprints/[id]/route.ts:95`），不校验 host、不校验 key 形状、不过 `isOwnedObjectKey`。

⇒ 用户可以往自己的蓝图里写一个从未上传过的 key 来「自证 ready」。
**边界仍钉死在本人命名空间**（`canvas_owned_media_key_v1` 排在四条分支最前）、OSS 写入仍需签出 policy，
**不构成提权**；代价是 `canvas_upload_reservations` 那句「only server-verified ready rows are accepted」对这条路不再成立。

**已在迁移抬头明确认下这次变更。** 收窄办法（给该路由加 `isOwnedObjectKey` 校验）留作后续，不阻断。
⚠️ 注意堵接口不等于堵路：`blueprints` 表无 REVOKE，保留 public schema 默认 ACL，直连 PostgREST 写 `source_ref` 同样可行。

### 🆕 E. 生成输入闸被一并放宽（有意为之，已写进代码注释）

`assert_canvas_media_keys_ready_v1` 有两个调用方：保存（传 canvasId/baseRev）与生成输入（传 null/null）。
原分支②因 `v_existing_keys` 恒空而对生成输入不可达，是刻意设计；**新分支没有这个限制**。
这是需要的 —— #23 建出来的就是上游节点，能进文档却不能当生成输入会撞第二种错。
代价：这类 key 未经服务端 HEAD 证实对象存在，**可能走到扣费后才由厂商侧失败退款**。
`upload-registry.ts` 那段注释已随之改写。

### 🔴 E2. 复验清单里有 5 条判据**从未执行过**，而合并闸是「未复验不合入」

看板的 25 条复验判据里，下面这些既没有结果、也没被标成未执行 —— 别把「批 1 六条全过」当成清单已完备：

| 判据 | 内容 | 为什么没跑 |
|---|---|---|
| 批 1 · 1（半条） | 裁剪键**只读态下不出现** | 只验了「可写态下出现」那半 |
| 批 3 · 11 | 低 zoom（<0.4）下角标仍在 | 未执行 |
| 批 3 · 12 | **只读态下角标照常显示** | 未执行。⚠️ 这条最该验 —— #43 实现注释自己点名过「只读态下自动写文档会静默失败，角标永远不亮」 |
| 批 4 · 21 | 浮层开着按 Ctrl+Enter 仍走生成 | 会真扣一次费 |
| 批 4 · 25 | 低 zoom / 面板停靠底部时开浮层不丢 | 未执行 |

判据 12 与 21 需要造特殊态（第二标签页占写者锁 / 接受一次扣费），其余三条零成本，随手可补。

### 🆕 F. 新 helper 未进健康检查契约表（已用内联规避，记录备查）

初版抽过一个 `canvas_blueprint_media_key_ref_v1`，对抗审查指出它是 `assert_` 的硬依赖却没进
`canvas_production_healthcheck_v1` 的 VALUES 契约表（同构的 `canvas_owned_media_key_v1` 是登记在案的）。
**终版改为内联，不新增任何 schema 对象，这条自然消解。**
但如果将来有人再想抽 helper，记得同时更新 `20260731_canvas_runtime_health.sql` 那张表。

### 已记过、不重复展开的

- 1352×642 下视频面板溢出停靠位 66px（非阻断，已裁决不再调）
- #185 阈值对 450 分视频不触发：**鼠标点「开始生成」时**，只有「单次 >1000 分」或「余额 <预估×1.2」才弹确认，
  happyhorse 5 秒=450 分在余额充足时**一次点击直接扣、无二次确认**（12 秒=1080 分才弹）。待用户定夺是否下调阈值。
  ⚠️ **更正**：旧记载说「文本框里误触 Ctrl+Enter 零确认扣费」——**在 3dee031 上不成立**，
  出处闸 `generation-consent.ts` 让 Ctrl+Enter **恒弹**确认，且已在生产实测过。
- 发版前必须先 `pm2 stop` 三代以前的 release、确认 `free -m` available ≥ 2000MB（内存问题，不是磁盘）

---

## 五、本轮（2026-08-10）做完了什么

1. **解除环境障碍**：查清 401 真因（本地缺整块 `VIDEO_PLATFORM_*`），从生产取回凭证，本地 dev 首次真正出图。
2. **补完四条被卡死的复验**：#82（6/6 全过）、#16（通过）、#43（判据 7/9/10 过，判据 8 半条）、#23（通过）/#24（无素材）。
3. **揪出并修掉「把标签写进提示词」三处** —— 其中一处已在生产（见 §四 A）。
4. **查实并修掉两个影响生产的既有缺陷**：保存闸不放行历史面板素材（甲，**已在生产关闭**）、快图 worker 认领画布生成（乙，**代码已修但生产仍是原样，且发版也修不好 —— 见 §四 A2**）。
5. **执行生产 DDL 前跑了一轮 5 镜头对抗审查**（17 条发现 / 反驳杀掉 16 条 / 存活 1 条 major），
   **该 major 经生产数据坐实，推翻了初版的承重前提** —— 初版只放行蓝图，而闸门分支③只比 `output_oss_key`，
   该列只有画布行会写；面板却从 URL 列换算 key ⇒ 幻灯片/拼装/quick-gen 那批**加了照样 422**。
   **按初版执行并只走蓝图复验会得到假绿。** 终版扩到「面板给得出的素材」、改内联、右端锚死、补 DO 后置断言。
6. **新增 PGlite 本地迁移验收**（16/16 绿），打破「没法预演迁移」的长期前提。
7. **在生产执行迁移并复验关闭缺陷**：RPC 功能探针 5 条全对；UI 端到端 `rev 32→33`、状态「已保存」。

**三处「对抗审查判错、由生产实测纠正」的事实**（防下个窗口重蹈）：
- `to_regclass('public.products')` = **NULL** ⇒ 该表在生产确实不存在，不放行也**不能引用**；
- `generations` **无 `output_urls` 列** ⇒ 审查建议把它算进来，照做会运行时炸；
- 画布行**会**同时写 URL 列 ⇒ 反驳里「画布行不出现在面板」那条不成立。

---

## 六、铁律提醒（本轮验证过仍然有效）

- **零 fork**：执行留现有链路，画布只是编排视图。批 5 调 `/api/studio/analyze-product` 是唯一例外，因为它不计费、不写 generations。
- **画布文档禁存 dataURL/签名 URL，只存 OSS object key。**
- **迁移纪律**：SQL 落盘 + 本地校验（**现在多了 PGlite 这一道**），生产执行由用户授权。迁移文件永不删除。
- **每子任务过 `npx tsc --noEmit`；涉页面过 `npm run build`；改 CHECKLIST 或看板后跑 `reconcile` 至绿。**
- **禁 `git push --force`；删远端分支前逐个人工确认；发布到生产是独立决策，合 main ≠ 发版。**
