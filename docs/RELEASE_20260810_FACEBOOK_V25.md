# 发版记录 · 2026-08-10 · Facebook Graph v25 与 App Review 准备(`273d083`)

> **线上现状**:sha `273d083d77a83e340f6be668f22930fb2f75ae9f`,PM2 `stargaze-canvas-273d083`,**端口 3016**,nginx 已切。
> 上一版 `3dee031`/3015 **仍在线**作已验证回滚位。

## 一、这次发上去了什么

合并 PR [#38](https://github.com/xuzone8888/tiktok-ai-mcn/pull/38)(`codex/facebook-app-review-v25-20260808`,2 个业务 commit)。
区间 `3dee031..273d083` 共 10 个 commit / 24 文件 / +936−207,其中 5 个业务 commit 是纯文档。
**`src/components/canvas/`、`src/lib/canvas/`、`src/stores/` 三个目录 diff 全空 —— 本次不含任何画布代码改动。**

**本批零数据库迁移。** FB 依赖的 `20260728_facebook_review_compliance.sql` 早已在生产执行(探针:`facebook_data_deletion_requests` 表存在)。

## 二、🔴 三件「以为上了、其实没上」的事(下个窗口重点)

### 1. webhook fan-out **没有上线**,而且发版流程根本碰不到它

改动在 `supabase/functions/facebook-comments-webhook/`(`core.ts` 把 `findActiveAccount(): …|null` 改成
`findActiveAccounts(): …[]` 并对每个 active 绑定逐个落库;`index.ts` 配套删掉 `.limit(2)`)。

但**蓝绿发版只建 Next release 目录 + 起 pm2 + 切 nginx**:
- `deploy/canvas-blue-green.sh` 全文 1134 行,`grep -ci supabase` = **0**
- 全仓对 `functions deploy` / `supabase functions` / `--project-ref` / `SUPABASE_ACCESS_TOKEN` **零命中**
- 生产机上 **没有 `supabase` CLI**

⇒ Supabase 网关上跑的 handler **仍是旧版**。所有发版门(构建门、BUILD_ID 门、内部 health、公网 `/canvas`)都不看 edge function,**全会绿**。

**而且「顺手 deploy 一下」也解决不了** —— 存在库归属错配:
- `docs/facebook-review/README.md:163` 记的 Meta Page 回调是 `https://wjfgusdwudsynbsyveoe.supabase.co/functions/v1/facebook-comments-webhook`
- 生产库 ref 是 **`hfabrifuvujpdzarlbky`**;`wjfgusdwudsynbsyveoe` 在代码里的身份是**测试库**(`src/lib/tiktok/test-mock.ts:1` 的 `DEFAULT_ALLOWED_SUPABASE_PROJECT`)
- **实测**:生产库 `webhook_receipts` 里 `provider='facebook'` **0 行** ⇒ 印证该函数不往生产库写

⇒ 要让 fan-out 在生产生效,必须**同时**裁决 webhook 归哪个 Supabase 项目 + 改 Meta 后台回调地址与 verify token。
**这是一件独立任务,2026-08-10 用户裁决本次不做。**

**当前可观察后果**:同一 Facebook Page 在本地有 ≥2 条 active 绑定时,评论事件仍被整条丢弃
(`ignoredCount+1`,返回 200 而非报错)。**实测生产正好是这个状态**:`facebook_accounts` 2 行 active,
**两行指向同一个 Page `1163745913492790`** ⇒ 该 Page 的评论 webhook 事件目前全部被丢。
🔴 **这不是本次发版造成的退化,是修复没上。别当 Next 侧 bug 查。**

### 2. Graph v25 是**运行时环境变量**决定的,不是代码默认值

代码改的只是兜底(`process.env.FACEBOOK_API_VERSION || 'v25.0'`,三处:`facebook/oauth.ts:5`、
`facebook/publish.ts:19`、`social-comments/platform-api.ts:11`),而生产 `.env.local` **显式写着 v20.0**。
若不改环境变量,本次 PR 的核心目的在生产完全空转,且所有发版门全绿。

**本次已在新 release 的 `.env.local` 改成 `FACEBOOK_API_VERSION=v25.0`。**

🔴 **同时必须钉住 Instagram** —— `instagram/oauth.ts:7` 与 `instagram/publish.ts:40` 是
`INSTAGRAM_API_VERSION || FACEBOOK_API_VERSION || 'v20.0'`,而生产原本**没有** `INSTAGRAM_API_VERSION`。
只改 FACEBOOK 会把 Instagram 的 OAuth 与发布一起抬到 v25 —— 这正是本批新加注释
(`platform-api.ts:17`「FACEBOOK_API_VERSION must never silently move Instagram Graph API traffic」)明令禁止的。
**本次已显式写入 `INSTAGRAM_API_VERSION=v20.0`。**

另注:`OAUTH_BROKER_URL` 在生产是**开着**的,而 `facebook/publish.ts` 的 broker 分支数为 **0**
(`oauth.ts` 12 处、`platform-api.ts` 7 处)⇒ 本次版本改动**实际只影响本机直连的 Page 视频发布路径**,
OAuth/权限/评论走 broker、用 broker 自己的版本。**发版后待验:视频发布路径在 v25 下是否正常(尚未实测)。**

### 3. 画布「推为参考」的资金缺陷**依然在线**

`generation-controls.tsx:1294` 仍是 `data: { title: "以图生视频" }`,而 `generation-service.ts:409-418`
的权威提示词就是 `[目标节点.title, ...上游文本节点.title]` ⇒ 「推为参考」建出的视频节点带着一句
用户没写过的提示词,**一按生成就以这五个字跑一次 450 积分的视频**。

修复只在**未合入**的 `claude/stargaze-canvas-p1-finish-d06ab1` 上(领先 main 20 个 commit)。
**本次不含任何画布代码,该缺陷继续在线。** 规避:先改提示词框再点生成。

## 三、会打到现有用户的一条(已裁决接受)

`social-comments/platform-api.ts` 把 Facebook 评论权限判定从「任一满足」改成「**全部满足**」,
并把 read 要求由 `['pages_read_engagement']` 扩到 `['pages_read_engagement','pages_read_user_content']`
(`:148-150` 数组扩容 + `:198` 分支由 `platform === 'instagram'` 改为 `instagram || facebook`)。

这条**纯读数据库 `facebook_accounts.scopes`,不打任何 Graph 请求** ⇒ 打开评论页立刻
`needs_reconnect`、同步按钮置灰、回复入口关闭。

**实测受影响面 = 2 个绑定(全部)**,两者都缺 `pages_read_user_content` 与 `pages_manage_engagement`。
2026-08-10 用户裁决:**不通知、直接上,坏了让用户重新绑定即可**(测试期网站,用户很少)。

> ⚠️ 别把这条和 `assertFacebookRequiredPageScopes` 搞混。后者**基本是休眠的**:它在
> `service.ts:360` 的 `if (shouldRefreshToken(...))` 块**内部**,而 `shouldRefreshToken` 第一行
> `if (!expiresAt) return false`(`:156-160`),Facebook 长期 Page token 在 Graph 不返回 `expires_in`
> 时落库为 NULL(`oauth.ts:571-574`)⇒ 分支进不去。**估算受影响面只能按 platform-api 那条算。**

## 四、另一条口径变化(发版后头号复验项)

`service.ts` 的 `PLATFORM_CONTENT_CONFIG.facebook` 删掉了 `commentContentIdKey: 'facebook_post_id'`,
而 `:762-763` / `:1457-1458` 是 `(config.commentContentIdKey ? row[...] : null) || row[config.externalIdKey]`
⇒ `provider_comment_content_id` 整体回落到 `facebook_video_id`,`:1310` 的 `listFacebookComments`
就按新对象打 `/comments`。

**好处**:与已部署旧版 webhook 的写入口径对齐(`core.ts:255` 写的就是 `facebook_video_id`)。
**风险**:若 Page 视频帖的评论实际挂在 post id 上,存量已发布内容的评论会「突然少了」,且**不报错**。
测试只做了源码文本断言(`tests/social-comments-workspace.test.cjs` 断言 `commentContentIdKey` 字样不存在),
**无任何 Graph 层实测**。

**回退面很小**:把 `commentContentIdKey: 'facebook_post_id'` 加回 facebook 块即可。

## 五、发版过程与复验记录

### 前置(硬性)

- **内存**:发版前 available 仅 **1594MB** < 门槛 2000MB。`pm2 stop stargaze-canvas-d16620f stargaze-canvas-33ba71d`
  放出 530MB → **2075MB** 才开构建。构建期最低 1646MB,**全程无 OOM**。
  用 `stop` 不用 `delete`(目录还在,`pm2 start` 秒起)。
- **未动**:`stargaze-canvas-3dee031`(线上兼首选回滚位)、`stargaze-canvas-reconciler`、
  `tiktok-ai-mcn`(3000,**非画布主应用**)、`okspeak-proxy`(8788)。
- **磁盘不是闸**(文档自相矛盾,已改判为内存问题)。**没有删任何 release 目录** —— 删了就没有秒起回滚位。

### 传包与身份校验

服务器 `git fetch` 打不通 GitHub(remote 是 SSH 的 github)。走 bundle:

```bash
git bundle create rel-273d083.bundle 3dee031f00d1c7c5931c3911f845337140b54cf0..origin/main   # 52K
# 服务器:git fetch /root/rel-273d083.bundle "refs/remotes/origin/main:refs/heads/rel-273d083" && git checkout -f 273d083…
```

🔴 **bundle 源必须写死 `origin/main`,不能写 `main`** —— 本地 `main` 当时落后 origin 3 个 commit
(缺整个 PR #38)。而 **BUILD_ID 门只比「目录名」与「`.next/BUILD_ID`」,不校验工作树内容**
(`canvas-blue-green.sh:966-968`、`check-canvas-production-env.mjs:564-587`)⇒ checkout 错版本
但目录名对,所有门全绿、发版后核对清单也查不出来。**所以 checkout 后必须回读 `git rev-parse HEAD`。**
本次已回读并核对一致(tree = `1f9c2c3f97ab5d46146d5ab3f8362013ccd0e90c`)。

### release 目录

`rsync -a --exclude .next --exclude node_modules` 从 `3dee031` 目录同步(292M)。
排除 `node_modules` 是因为脚本会 `npm ci --include=dev` 重装,拷过去纯浪费磁盘。
`.env.local` 随 rsync 带过来(`-rw------- root root`,非符号链接),再改两行版本键,改前备份
`.env.local.bak-before-v25-*`。

### 构建与发布

**没有手工 build。** 直接让脚本按 sanctioned 路径自己构建 —— 理由:`scripts/canvas-exact-env.mjs:15-32`
的 `SYSTEM_ENV_ALLOWLIST` 本来就**不含 `NODE_OPTIONS`**,且脚本第 11 行 `unset NODE_OPTIONS`,
⇒ **手工 build 拿不到任何内存优势**,反而多一条自创流程。

> 📌 **修正一处长期文档冲突**:`docs/HANDOFF_R2_NEXT.md:249-251` 要求带 `NODE_OPTIONS` 跑
> `npm run build`,而 `deploy/CANVAS_PRODUCTION_CHECKLIST.md:98` **明令禁止**裸 `npm run build`;
> 另一条 `npm run canvas:build-exact` 又不带 `--release-commit`,直接跑会让 BUILD_ID 落回随机值、
> 在切流前 FAIL。**两条路各缺一半。** 结论:让蓝绿脚本自己 build 最省事且合规。

```bash
bash deploy/canvas-blue-green.sh deploy \
  --workdir /var/www/tiktok-ai-mcn-releases/273d083d77a83e340f6be668f22930fb2f75ae9f \
  --candidate-port 3016 --candidate-name stargaze-canvas-273d083 \
  --reconciler-env-file /etc/stargaze/canvas-reconciler.env \
  --nginx-config /etc/nginx/sites-available/toryxai.com \
  --public-health-url https://www.toryxai.com/canvas --execute
```

先跑不带 `--execute` 的 dry-run 审查,再加 `--execute`,并用 `setsid nohup` 脱离终端
(构建几分钟,ssh 一断会把脚本连带杀掉)。

### 发版后复验(全部通过)

| 项 | 结果 |
|---|---|
| nginx | → 3016 |
| `.next/BUILD_ID` | `273d083d77a83e340f6be668f22930fb2f75ae9f`(= release commit) |
| 候选进程 | `stargaze-canvas-273d083` online,**重启次数 0** |
| `https://www.toryxai.com/` | 200 |
| `/canvas` 匿名 | 307(硬鉴权门) |
| `/facebook-publish/comments` 匿名 | 307(**不是 404** ⇒ 构建期开关 `NEXT_PUBLIC_FACEBOOK_COMMENTS_ENABLED=true` 烘焙正确) |
| `/api/social-comments/facebook-bootstrap` 匿名 | **401**(**不是 404** ⇒ 新代码真在跑 + 双开关都开 + 鉴权生效) |
| `FACEBOOK_API_VERSION` / `INSTAGRAM_API_VERSION` | `v25.0` / `v20.0` |
| `CANVAS_PUBLIC_ENABLED` | `true` |
| 内存 | available 2032MB |

🔴 **`NEXT_PUBLIC_FACEBOOK_COMMENTS_ENABLED` 是构建期烘焙的**(`NEXT_PUBLIC_` 前缀内联),
漏了它页面上线即 `notFound()`,**改 `.env.local` + 重启无效,必须整包重建**。本次在构建前已确认在位。

### 回滚

```bash
bash deploy/canvas-blue-green.sh rollback \
  --rollback-bundle /var/backups/stargaze-canvas/canvas-rollback-20260810T085051Z-port-3015-1139822 --execute
```

前置:upload sweeper 的 systemd timer/service 必须 inactive+disabled,否则脚本拒绝回滚。
`3dee031`/3015 进程仍在线,回滚是切 nginx 回去。**本次零迁移,回滚是纯代码回滚,无 SQL 顺序问题。**

## 六、待办(从本次发版派生)

1. **webhook 归属裁决 + Meta 回调改配 + edge function 部署** —— 独立任务,见 §二.1。
2. **v25 下的视频发布路径实测** —— broker 不覆盖 `publish.ts`,这是版本改动唯一真实影响面。
3. **评论条数对照** —— 拿一条有 `facebook_post_id` 的旧内容,比对口径切换前后拉到的评论数,见 §四。
4. **两个 Facebook 绑定需重新授权**(缺 `pages_read_user_content` / `pages_manage_engagement`)。
5. 更正 `docs/HANDOFF_R2_NEXT.md:226` 的过期期望值 `CANVAS_PUBLIC_ENABLED=false` → `true`
   (同文件 :232 有「与预期不符就停下」的硬条款,照它核对会在一个完全正常的状态上白查一轮)。
6. `docs/SUPER_CANVAS_P1_RELEASE_RUNBOOK.md` **不是当前发版程序**(2026-07-28 的历史档案,
   连 `canvas-blue-green` 这个名字都 0 命中)。当前权威:命令与九步语义看
   `deploy/CANVAS_PRODUCTION_CHECKLIST.md`,坑与前置看 `docs/HANDOFF_R2_NEXT.md`。
