# 发版记录 · 2026-08-21 · 超级画布 P1 + i18n 三批(`022819b`)

- **线上版本**:`022819b6e4e17fdace4f34c61e2959c48beeddf5`,PM2 `stargaze-canvas-022819b`,**端口 3018**
- **上一版**:`73b0178`(端口 3017)—— **仍 online,是首选回滚位**
- **回滚包**:`/var/backups/stargaze-canvas/canvas-rollback-20260821T150457Z-port-3017-2698049`
- **本批零迁移、零 .env 改动**

## 一、这次发上去了什么(44 个提交)

| 批次 | 内容 |
|---|---|
| 超级画布 P1 批 0-5 | #82 裁剪、#43「输入已更新」角标、#182 @引用素材、#67 商品节点(上传 9 图 / 解析卖点卡 / 主图作下游参考图),外加两个拦路缺陷修复(移除商品图全线不可用、「重新解析」是死路) |
| PR #43 | i18n 架构 ADR(`docs/ADR_I18N_SINGLE_STACK.md`) |
| PR #44 | 角色中心/角色创建/模板中心中英文一致性(引入 next-intl) |
| PR #45 | 空态判据同源 + 恢复后端错误原文(4 处) |
| PR #46 | Facebook 绑定流程中英文化 + 统一品牌图标 |

**画布 P1 那部分此前从未在生产运行过**,本次是首次上线。

## 二、🔴 本次新增的两道保护(为同机运行的中转站)

服务器上另跑着 **`newapi-cn`(docker,`acctoken.com` → `127.0.0.1:8096`)**,是独立的 API 中转站产品。
2026-08-09 那次发版的内核日志证明当时是 **global OOM**:

```
[Sun Aug  9 12:59:08 2026] hbrclient invoked oom-killer ... global_oom, constraint=CONSTRAINT_NONE
Out of memory: Killed process 990111 (node) anon-rss:1667820kB
```

**内核在全机范围挑 victim**,当时恰好挑中构建进程。当时中转站容器尚不存在,现在它在,且发版前 OOM 排名**第 5**(score 678,第一名 706)。因此本次加了两道此前没有的保护:

1. **给中转站主进程设 `oom_score_adj = -500`**(与 dockerd 自身一致)→ score **678 → 346**,移出刀口。
2. **临时把 `vm.swappiness` 从 0 调到 10** → 让本就存在的 2G swap 变成真正的安全网。
   `swappiness=0` 时 swap 形同虚设,内存一紧直接 OOM-kill,这正是 8-09 致命的原因。

**实测证明这两道保护是必要的**:构建高峰采样到

```
[01] 可用内存=871MB  swap用=673MB  中转站=healthy 重启=0
```

**673MB 真的被换进了 swap**。若 `swappiness` 仍为 0,这 673MB 无处可去,必然触发 global OOM。

全程 9 个采样点中转站均为 `healthy / 重启=0`;发版后 `StartedAt` 与发版前基线**逐字符相同**,证明它自始至终未被扰动。

## 三、发版前置

| 项 | 发版前 | 处理 | 处理后 |
|---|---|---|---|
| 磁盘 | 早先 92%(16G / 9 个 release) | **本次无需清理** —— 发版前已有人清到只剩 2 个目录 | 55% → 发版后 60%(剩 15G) |
| 内存 available | 1612 MB(门槛 2000) | `pm2 stop stargaze-canvas-273d083`(二级回滚位,目录保留) | 1914 → 调 swappiness 后 1957 MB |

## 四、传包与身份校验

阿里云连不上 GitHub,走 bundle(273K):

```bash
git bundle create rel-022819b.bundle 73b0178418b242f5b70aa98872dc7aad102dae29..origin/main
# 服务器:git fetch /root/rel-022819b.bundle "refs/remotes/origin/main:refs/heads/rel-022819b" && git checkout -f 022819b…
```

**回读校验**:HEAD = `022819b6e4e17fdace4f34c61e2959c48beeddf5`,
tree = `2e12c7355226e7d086bae08b6fb642468afea792` —— **与本地 `origin/main` 的 tree 逐字节一致**。

BUILD_ID 门只比目录名与 `.next/BUILD_ID`、不校验工作树内容,故额外抽查工作树:
`next-intl` 依赖在、i18n 字典目录在、FB 授权 URL 已无 `locale` 参数、页头 `ml-[44px]` 在、
画布 `unset.push` 与 `force: alreadyAnalyzed`(两个缺陷修复)均在。

## 五、部署

先 dry-run 审阅解析出的计划(确认 nginx 只会改 `toryxai.com`、不碰中转站的 `acctoken.com`),再加 `--execute`,
`setsid nohup` 脱离终端:

```bash
bash deploy/canvas-blue-green.sh deploy \
  --workdir /var/www/tiktok-ai-mcn-releases/022819b6e4e17fdace4f34c61e2959c48beeddf5 \
  --candidate-port 3018 --candidate-name stargaze-canvas-022819b \
  --reconciler-env-file /etc/stargaze/canvas-reconciler.env \
  --nginx-config /etc/nginx/sites-available/toryxai.com \
  --public-health-url https://www.toryxai.com/canvas --execute
```

## 六、发版后复验(全部通过)

| 项 | 结果 |
|---|---|
| BUILD_ID 门 | `.next/BUILD_ID` = `022819b6e4e17f…` = 期望值 ✅ |
| nginx | → `127.0.0.1:3018`;3017 仍监听作回滚 ✅ |
| 站点 | toryxai.com 200 · **acctoken.com 200(中转站)** · okspeakai.com 200 ✅ |
| `/canvas` 匿名 | 307(硬鉴权门正常)✅ |
| **新代码真在跑** | 公网 `/facebook-data-deletion` 返回 `mt-4 flex items-center gap-3 text-3xl font-bold` —— PR#46 新加的 class 串;旧版该处是 `mt-4 text-3xl font-bold`。**不是只看进程起没起** ✅ |
| 其它服务 | okspeak ×2、tiktok-ai-mcn、webhook、reconciler 全部 online,未受影响 ✅ |

## 七、待办与遗留

1. **`vm.swappiness` 目前是 10,仅运行时值,未写入 `/etc/sysctl.conf` —— 重启即回到 0。**
   考虑到中转站与 StarGaze 同机、且 OOM 已发生过一次,**建议保留 10 并写入持久化配置**,由用户裁决。
2. **中转站的 `oom_score_adj = -500` 同样是运行时值**,容器重启即失效。若要长期保留,应在容器启动参数里加 `--oom-score-adj`。
3. **画布 P1 首次上线,尚未做生产链路复验** —— 建议尽快在生产上走一遍商品节点→图片节点链路。
4. **`stargaze-canvas-273d083` 处于 stopped**(为腾内存),目录保留,`pm2 start` 可秒级恢复为二级回滚位。
5. PR #46 遗留的两条(不拦路):`callback/route.ts:174/:304` 把本地化文案写进了 `facebook_auth_states.error_message`
   销毁 Meta 原始诊断;`PlatformAccountsPage.tsx:131` 的 `localizeError` 判据过粗。

## 八、回滚

```bash
pm2 start stargaze-canvas-73b0178   # 已 online,无需此步
# nginx 回切 3017,或用回滚包:
# /var/backups/stargaze-canvas/canvas-rollback-20260821T150457Z-port-3017-2698049
```
