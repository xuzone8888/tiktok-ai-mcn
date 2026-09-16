# 发版记录 · 2026-09-16 · Facebook 评论作者头像/姓名 + broker 版本追平(`31d4356`)

- **合并 PR**:[#49](https://github.com/xuzone8888/tiktok-ai-mcn/pull/49)(同事分支 `codex/facebook-comment-profile-20260916`,单提交 `89a9886`)
- **本批零迁移、零价目变更**
- **两个生产目标都动了**:国际服 broker(功能真正生效处)+ 阿里云主站(版本对齐)

## 一、这次发了什么

补齐 Facebook 评论作者的姓名与头像读取(此前 `author_avatar_url` 恒为 `null`)。
向 Graph 请求 `from{id,name,picture{url,is_silhouette}}`;若因权限未获批报错(Graph code 10/100/200),
**在本次同步内降级回原字段集重试一次**,后续评论页与回复页复用该降级,新同步重新尝试。
降级状态不跨账号、不跨并发同步;过期 token / 限流 / 5xx 不会被误判为权限失败。

> ⚠️ **用户可见效果为零**。Meta 的 Business Asset User Profile Access **尚未获批**,
> 当前 `from` 字段根本不返回。本次上线是为审核录屏做的前置铺垫。

## 二、🔴 最关键的一点:生效处是 broker,不是主站

`listFacebookComments` 开头即 `if (isBrokerEnabled()) return callCommentBroker(...)`,
阿里云 `.env.local` 配了 `OAUTH_BROKER_URL`(已线上实证)→ **这段新代码在阿里云上一行都不执行**。
执行它的是国际服 `stargaze-broker`。**只发主站 = 功能不生效。**

主站本次仍然发了,理由是用户裁决「两边版本对齐」,避免以后排查时被版本歪斜误导。

## 三、顺带收掉的一个定时炸弹:broker 还压在 Graph v20.0

查 Meta 官方版本表:**v20.0 到期日 2026-09-24**,距本次发版仅 8 天。
而 broker 的 `broker.env` 正是 `FACEBOOK_API_VERSION=v20.0`,且**没有 `INSTAGRAM_API_VERSION` 键**
(22 个键逐个核过)。代码为 `INSTAGRAM_API_VERSION || FACEBOOK_API_VERSION || 'v20.0'`
→ **Facebook 和 Instagram 流量当时都压在 v20.0 上**。

到期不是硬报错:Meta 文档明确「对其执行的任何调用将默认指向下一个最早的可用版本」,
即 9-24 后会**静默漂到 v21**,不受控。

**处置**:把 broker 追平到阿里云主站已稳跑一个多月的配置 ——
`FACEBOOK_API_VERSION=v25.0` + **新增 `INSTAGRAM_API_VERSION=v20.0`**。

> 🔴 **顺序铁律**:两个键必须同时改。只改 `FACEBOOK_API_VERSION` 会让 Instagram 静默从 v20 跳到 v25。
> 附注:`broker.env.example` 模板里这两个值**本来就是对的**,是线上那份运行文件漂移了。

## 四、离线闸门(本地实跑)

| 闸门 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| 全量测试 `node --test "tests/*.test.cjs"` | **243 项:242 通过 / 1 跳过 / 0 失败** |
| 新增 `tests/facebook-comment-profile.test.cjs` | **22 项全通过** |
| Facebook + social-comments 子集 | **94 项全通过** |

## 五、国际服 broker 重建

1. **先给现役镜像打回滚别名** `stargaze-oauth-broker:rollback-30848db`
   —— `:latest` 原本没有任何 commit 别名,直接 build 会让它变 dangling,一次 prune 就永久没了回滚位
2. 备份 `broker.env` → `broker.env.bak-prev25-20260916`,改版本两键(diff 精确只有这两行,键数 22→23)
3. `git fetch && git merge --ff-only origin/main`(30848db → 31d4356);
   ⚠️ broker 检出是 **detached HEAD**,快进前先 `merge-base --is-ancestor` 验证
4. `docker compose -p stargaze-broker -f docker-compose.broker.yml build broker` → `up -d broker`
   **只指定 broker 服务**,不碰 Caddy

**复验(零凭据探针,不需真 token)**:

| 探针 | 结果 |
|---|---|
| 对照组:不存在的 op | HTTP **400** `unknown_platform_or_op` ✅ |
| `facebook:listFacebookComments` | HTTP **200** + Meta 自己的 `code:"190"` / `httpStatus:401` ✅ |
| `instagram:listInstagramComments` | HTTP 200 + Meta 自己的错误 ✅ |
| `youtube:listYouTubeComments` | HTTP 200 + Google 自己的认证错误 ✅ |
| 容器内生效版本 | `FACEBOOK_API_VERSION=v25.0` / `INSTAGRAM_API_VERSION=v20.0` ✅ |
| 其它 7 个容器 `StartedAt` | 与基线**逐字符相同**,零扰动 ✅ |

> `listFacebookComments` 回 `code:190` 是**决定性证据**:证明 op 认识、真打到了 Meta,
> 且新降级逻辑正确地**没把 190(token 失效)误判成权限失败** —— 190 不在 [10,100,200] 里。
>
> 阿里云侧也跑了同一组探针(过 Caddy TLS + ufw 源 IP 闸),三家全绿 —— 完整生产路径已验证。

## 六、阿里云主站发版

- release 目录由上一版 `cp -a` 而来(依赖未变,复用 node_modules,省掉一次装包的内存峰值),
  再 `git checkout` 到 `31d4356`;**tree 与本地 `origin/main` 逐字节一致**(`691e100b…`)
- ⚠️ **踩坑记录两条**:
  1. release 目录的 origin 是 **HTTPS**,阿里云走 HTTPS 连 GitHub 报 `GnuTLS recv error (-110)`;
     基础检出 `/var/www/tiktok-ai-mcn` 用的是 **SSH**,那条路通
  2. 从基础检出 `git fetch <path> main` 取到的是它**过时的本地 main**(`6fac3f0`),
     必须取 `refs/remotes/origin/main`

### 发版参数

```bash
bash deploy/canvas-blue-green.sh deploy \
  --workdir /var/www/tiktok-ai-mcn-releases/31d4356c007383a1c0587d3cc7540b2d31ee77ea \
  --candidate-port 3020 --candidate-name stargaze-canvas-31d4356 \
  --reconciler-env-file /etc/stargaze/canvas-reconciler.env \
  --nginx-config /etc/nginx/sites-available/toryxai.com \
  --public-health-url https://www.toryxai.com/canvas --execute
```

先跑 `plan` dry-run 审阅,确认 nginx 作用域**只有 `toryxai.com`**、不碰中转站的 `acctoken.com`,再加 `--execute`。

### 发版后复验(全部通过)

| 项 | 结果 |
|---|---|
| BUILD_ID 门 | `.next/BUILD_ID` = `31d4356c…` = 期望值 ✅ |
| nginx | → `127.0.0.1:3020`;**3019 仍 online 作首选回滚位** ✅ |
| 站点 | toryxai.com 200 · **acctoken.com 200(中转站)** · okspeakai.com 200 ✅ |
| `/canvas` 匿名 | 307(硬鉴权门正常)✅ |
| 其它服务 | tiktok-ai-mcn / okspeak ×2 / webhook / reconciler 全 online,未受影响 ✅ |
| 回滚包 | `/var/backups/stargaze-canvas/canvas-rollback-20260916T083535Z-port-3019-531854` |

## 七、🔴 中转站(acctoken.com)保护 —— 用户点名要求

同机跑着独立产品 `newapi-cn`(docker → `127.0.0.1:8096`)。2026-08-09 那次发版打挂整站的根因是
**global OOM**(内核全机挑 victim),因此本次全程对它做基线比对:

| | 发版前基线 | 发版后 |
|---|---|---|
| `StartedAt` | `2026-09-16T06:26:57.986317709Z` | **逐字符相同** ✅ |
| `RestartCount` | 0 | 0 ✅ |
| `Health` | healthy | healthy ✅ |
| `oom_score_adj` | -500 | -500 ✅ |
| `acctoken.com` | 200 | 200(全程 18 个采样点无一次非 200)✅ |

**发现**:中转站当天 06:26 刚重启过(镜像 tag `acctoken-cn-2026.09.16-v41volc1`),
但 `oom_score_adj=-500` 仍在,说明该保护已不再是 2026-08-21 那种运行时临时值。

**构建期实测**:峰值时可用内存一度降到 **934MB**,swap 用量 495→602MB —— 
`vm.swappiness=10`(已持久化进 `/etc/sysctl.conf`)再次证明是必要的。若仍为阿里云默认的 0,
这几百 MB 无处可去,就是 global OOM 触发条件。**全程中转站与线上站点均未中断。**

## 八、内存与磁盘

| 项 | 发版前 | 处理 | 发版后 |
|---|---|---|---|
| 内存 available | 2416 MB(门槛 2000) | `pm2 stop stargaze-canvas-022819b`(两代前,目录保留) | 2422 MB |
| 磁盘 | 14G 可用 | 新增一个 1.1G release | 12G 可用(70%) |

> 依赖未变(diff 只有 3 个文件,未动 `package.json`),release 目录由上一版 `cp -a` 复用
> `node_modules`(747M/526 包),省掉一次装包的内存峰值。

## 九、回滚

**主站**:3019(`30848db`)仍 online,nginx 回切即可;或用回滚包
`/var/backups/stargaze-canvas/canvas-rollback-20260916T083535Z-port-3019-531854`。

**broker**(两层,按需选):
```bash
# 只回退版本配置(不需重新构建)
cp /opt/stargaze-broker/broker.env.bak-prev25-20260916 /opt/stargaze-broker/broker.env
docker compose -p stargaze-broker -f docker-compose.broker.yml up -d broker

# 连代码一起回退
docker tag stargaze-oauth-broker:rollback-30848db stargaze-oauth-broker:latest
docker compose -p stargaze-broker -f docker-compose.broker.yml up -d broker
```

## 十、待办与遗留

1. **Meta 审核尚未提交**。Business Asset User Profile Access 只是「加入了审核申请草稿」,
   其允许用途描述、录屏、合规确认均未完成。本次上线**不会让头像立刻出现**。
   录屏必须在功能可见后才录(同事文档 §Before release 第 6 条)。
2. **`/var/www/tiktok-ai-mcn` 基础检出的本地 `main` 分支停在 `6fac3f0`(极旧)**,
   而它的 `origin/main` 是最新。下次造 release 目录时务必取 `refs/remotes/origin/main`,
   别取它的本地 `main`,否则会静默检出一年前的代码。
3. **release 目录的 origin 是 HTTPS,阿里云走不通**(GnuTLS -110);基础检出是 SSH,可通。
   建议下次直接把 release 目录的 remote 改成 SSH,或固定走「基础检出 → 本地 fetch」两段式。
4. **`stargaze-canvas-022819b` 已 stopped**(为腾内存),目录保留,`pm2 start` 可秒级恢复。
   三代回滚位:3019(`30848db`,online)→ 3018(`022819b`,stopped)→ 3017/3016(stopped)。
5. **分支清理未做**(用户裁决「先上线,清理稍后」)。远端 20 个分支中:
   12 个已完全合入可删、2 个是空壳分支(`codex/facebook-review-readiness-v25`、`codex/i18n-zh-en`,
   tip 都是旧 main 合并提交 `5f946de`,正是铁律点名的误删陷阱)、
   6 个有独有工作不可删(含 `feat/us-publish-worker` —— 国际服 `/opt/stargaze-worker` 的**活检出**)。
