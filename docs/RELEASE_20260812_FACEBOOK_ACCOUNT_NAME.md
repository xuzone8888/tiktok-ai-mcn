# 发版记录 · 2026-08-12 · Facebook 账号卡显示真实 Page 名(`73b0178`)

> **线上现状**:sha `73b0178418b242f5b70aa98872dc7aad102dae29`,PM2 `stargaze-canvas-73b0178`,**端口 3017**,nginx 已切。
> 上一版 `273d083`/3016 **仍在线**作已验证回滚位。

## 一、这次发上去了什么

合并 PR [#40](https://github.com/xuzone8888/tiktok-ai-mcn/pull/40)(`codex/facebook-webhook-production-validation`,1 个业务 commit `c5923f5`)。

**区间 `273d083..73b0178` 的代码改动恰好 3 个文件 / +32−3** —— 因为 main 在本次之前与线上代码完全相同
(只差 PR #39 那个纯文档)。这是一次单一目的、极易验证的发版。

| 文件 | 改动 |
|---|---|
| `src/components/publish/platform/PlatformAccountsPage.tsx` | `getAccountName(account, preferChannelTitle = false)`;卡片标题改传 `config.preferChannelTitle` |
| `src/lib/publish/platform-config.ts` | 两个 config 接口加可选项;仅 `facebook:` 块设 `preferChannelTitle: true` |
| `tests/facebook-account-display.test.cjs` | 新增源码文本回归测试 |

**修复的问题**:Facebook 账号卡把 Meta 返回的**本地化 Page 类别**当成账号名显示 ——
英文界面上出现中文「数字内容创作者」。根因是 `channel_handle` 存的是 Meta 本地化类别,
而通用账号卡原本优先显示 `channel_handle`。

**本批零数据库迁移、零 `.env.local` 变更、零 Supabase edge function、零 broker 改动。**
(diff 内 `NEXT_PUBLIC_` 命中 0 ⇒ 无构建期烘焙开关需要动。)

## 二、发版前的核查证据

- `getAccountName` 全仓**仅 1 处调用点**,已更新;`preferChannelTitle` 在其它文件零引用
- 默认值 `= false` ⇒ **YouTube / Instagram 及其它平台行为完全不变**
- 回退链 `channel_title || channel_handle || channel_id` 保留,title 为空不会崩
- 🔴 **会不会真的生效 —— 用生产库实证过**:`facebook_accounts` 里
  `channel_title` = `Irene's Zone` / `Toryx AI Review Test`,`channel_handle` = `数字内容创作者` / `互联网公司`。
  若 `channel_title` 为空,这次发版等于空转 —— 所以这条必须发版前查。
- 本地 `git merge-tree` 试合算出 tree `7b2ebba5477…`,与服务器 checkout 后回读的 tree **完全一致**(双向印证)

> ⚠️ **别被 `git diff main..分支` 吓到**:它会显示 `docs/RELEASE_20260810_FACEBOOK_V25.md` 被删 193 行。
> 那不是同事删的 —— 分支从 PR #39 之前分出,落后 main 2 个 commit,diff 把 main 后加的文件显示成「缺失」。
> 正常三方合并不会删它,合并后已回读确认文件仍在。

## 三、🔴 一条必须纠正的既有认知:`tiktok-ai-mcn`(3000)不是白占内存

发版前腾内存时差点停掉它。**只查 nginx 会得出错误结论** —— 没有任何启用站点指向 3000,
看起来像死进程。但 **crontab 里三个任务全打它**:

| cron | 频率 | 目标 |
|---|---|---|
| `run-image-worker.sh` | **每分钟** | `:3000/api/cron/process-image-generation` |
| `run-scheduler.sh` | **每分钟** | `:3000/api/publish/process-scheduled` |
| `run-youtube-data-retention.sh` | 每小时 | `:3000/api/youtube/data-retention` |

⇒ **停它会打断图片生成与定时发布。** 2026-08-10 记录里把它列进「未动」是对的,原因现在补上了。
**腾内存只能停两代以前的 `stargaze-canvas-*` release 进程。**

## 四、发版过程

### 前置(硬性)

- **内存**:发版前 available **1705MB** < 门槛 2000MB。`pm2 stop stargaze-canvas-3dee031`(两代前,
  发版后 `273d083` 自动顶上首选回滚位)→ 渐进回收到 **2021MB** 才开构建。用 `stop` 不用 `delete`。
- **未动**:`stargaze-canvas-273d083`(线上兼首选回滚位)、`stargaze-canvas-reconciler`、
  `tiktok-ai-mcn`(见 §三)、`okspeak-proxy`。**没有删任何 release 目录。**

### 传包与身份校验

阿里云 `git fetch` 打不通 GitHub,走 bundle(12K):

```bash
git bundle create rel-73b0178.bundle 273d083d77a83e340f6be668f22930fb2f75ae9f..origin/main
# 服务器:git fetch /root/rel-73b0178.bundle "refs/remotes/origin/main:refs/heads/rel-73b0178" && git checkout -f 73b0178…
```

🔴 bundle 源写死 `origin/main`,不能写 `main`。**checkout 后必须回读** —— 本次回读:
HEAD = `73b0178418b242f5b70aa98872dc7aad102dae29`,tree = `7b2ebba5477…`,并额外核对工作树里
`preferChannelTitle` 真的在(BUILD_ID 门只比目录名与 `.next/BUILD_ID`,不校验工作树内容)。

### release 目录与构建

`rsync -a --exclude .next --exclude node_modules` 从 `273d083` 目录同步 → 292M。
`.env.local` 随 rsync 带过来(`-rw------- root root`),**本次一行未改**。

**没有手工 build**,让蓝绿脚本按 sanctioned 路径自己构建。先 dry-run 审查解析出的计划,再加 `--execute`,
用 `setsid nohup` 脱离终端。

```bash
bash deploy/canvas-blue-green.sh deploy \
  --workdir /var/www/tiktok-ai-mcn-releases/73b0178418b242f5b70aa98872dc7aad102dae29 \
  --candidate-port 3017 --candidate-name stargaze-canvas-73b0178 \
  --reconciler-env-file /etc/stargaze/canvas-reconciler.env \
  --nginx-config /etc/nginx/sites-available/toryxai.com \
  --public-health-url https://www.toryxai.com/canvas --execute
```

## 五、发版后复验(全部通过)

| 项 | 结果 |
|---|---|
| 脚本闸门 | **76 个 `[OK]`**,零 `[FAIL]`、零 abort |
| nginx | → 3017 |
| `.next/BUILD_ID` | `73b0178418b242f5b70aa98872dc7aad102dae29`(= release commit) |
| 候选进程 | `stargaze-canvas-73b0178` online,**重启次数 0** |
| 回滚位 | `stargaze-canvas-273d083` 仍 online,重启数 0 |
| `https://www.toryxai.com/` | 200 |
| `/canvas` 匿名 | 307(硬鉴权门) |
| `/facebook-publish/accounts` 匿名 | 307(**不是 404**) |
| `/api/social-comments/facebook-bootstrap` 匿名 | 401(**不是 404**) |
| **新代码真在公网跑** | 拉 chunk `5417-4d85f35f1dd28766.js`(HTTP 200/23KB),命中压缩后的 `…channel_handle\|\|e.channel_title\|\|e.channel_id}(e,O.preferChannelTitle)`;同名字符串在 `273d083` 的构建产物里**零命中** ⇒ 确属本次新增 |
| 内存 | available 1934MB |

> 日志里 13 条 `[Error]: Dynamic server usage` 是 **Next.js 构建期正常提示**(路由用了 `cookies`/`request.url`
> 被正确标记为动态 `ƒ`),不是发版失败,与本次改动无关。

## 六、回滚

```bash
bash deploy/canvas-blue-green.sh rollback \
  --rollback-bundle /var/backups/stargaze-canvas/canvas-rollback-20260812T075440Z-port-3016-1391495 --execute
```

`273d083`/3016 进程仍在线,回滚是切 nginx 回去。**本批零迁移,纯代码回滚,无 SQL 顺序问题。**

## 七、待办与本次未覆盖的事

1. **UI 实看确认** —— 登录后看 Facebook 账号页是否显示 `Irene's Zone` 而非 `数字内容创作者`。
   传输层与产物层已证实,但真实渲染需真人复验。
2. 🔴 **磁盘从 5.8G 降到 4.1G(90%)** —— 每个 release 约 1.7G,**大约只剩 2 次发版余量**。
   下次发版前需清理最老的 release 目录(注意:删了就没有那一代的秒起回滚位)。
3. **webhook fan-out 仍未上线**(与 2026-08-10 记录一致)。生产库 `webhook_receipts` 里
   `provider='facebook'` 仍 **0 行**。另注:Page `1163745913492790` 有 3 条 active 绑定,
   但**分属三个不同用户**(`2cca16b7` / `859b9c2b` / `6ffadf3a`),不是重复绑定 bug。
4. **国际服 broker 已于 2026-08-11 重建至 main**,Facebook 绑定 `transport status 400` 已修复并经生产数据证实
   (用户 `6ffadf3a` 于 08-12 01:58 与 03:23 UTC 成功绑定两个 Page,均在 broker 重建 08-11 10:09 UTC 之后)。
   **broker 是第二个必须单独重新部署的目标,发版流程碰不到它。**
