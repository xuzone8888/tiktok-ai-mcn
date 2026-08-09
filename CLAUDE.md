# StarGaze · 超级画布开发指南(每个窗口开工前必读)

StarGaze 是一个 AI 视频创作平台(Next.js + Supabase + 阿里云 OSS,生产站 toryxai.com)。当前主战场:**超级画布的 P1 验收收尾**——对标 liblib.tv LibTV 的无限画布节点编排,一套「分镜→资产装配→逐镜图→图生视频→配音→合成」中台 + 两种起点(**电商带货**=商品节点起 / **剧情创作**=剧本节点起,覆盖漫剧/短剧/推文)。

> **P0 / R2 / R2-Q4 补齐 / #185 误扣费收口 均已完成并上线**(线上 `3dee031`/端口 **3015**),**2026-08-09 起画布已对所有登录用户开放**(用户裁决:网站用户少,跳过灰度阶梯)。安全面——计费、对账、状态机、并发、鉴权、误扣费——已全部收口并生产验证。
>
> 🔴 **但 P1 没做完**:52 项里 **#67 商品节点(双轨起点之一,整条链缺失)、#81/#82/#83 图片工具条、#85 nine_grid、#43 dirty 角标、#92 图片空态快捷、#182 @引用素材、#211 交互式教程、#78 图片比例 13 种** 既没改判也没补齐 —— **而且现在人人可见**。详见 HANDOFF §负二③-b。**P2 尚未开工,未经用户裁决不要自行启动。**

## 新窗口恢复协议(30 秒弄清现状)

1. 读本文件(你正在读)。
2. 读 [docs/EXECUTION_TRACKER.md](./docs/EXECUTION_TRACKER.md) 的「当前状态」—— 执行状态唯一事实源。
3. 读 **[docs/HANDOFF_R2_NEXT.md](./docs/HANDOFF_R2_NEXT.md)** —— **待办清单 + 四个缺陷速查 + 浏览器走查踩坑技巧。新窗口的实际入口就是这份,先读它再动手。**
4. 读 [docs/SUPER_CANVAS_P0_BOARD.md](./docs/SUPER_CANVAS_P0_BOARD.md) —— D1-D6/S1-S8 已全部合流;R1 完成明细、R2 走查逐项结果、R2-Q1~Q4 四个缺陷都在这里。
5. 每完成一个任务:更新看板状态 → 更新 EXECUTION_TRACKER「当前状态」→ commit。
6. 需要背景细节才去翻(按需,不必全读):
   - [docs/SUPER_CANVAS_MASTER_PLAN.md](./docs/SUPER_CANVAS_MASTER_PLAN.md) —— 总纲:范围/ADR/分期/验收(裁决层)
   - [docs/SUPER_CANVAS_CHECKLIST.md](./docs/SUPER_CANVAS_CHECKLIST.md) —— **220 项功能点唯一事实源**(做/裁/延×期次×复用件);任何「这个功能做不做/几期做」的问题答案都在这
   - [docs/SUPER_CANVAS_DATA_MODEL.md](./docs/SUPER_CANVAS_DATA_MODEL.md) —— 表结构 DDL/字段映射/注入链(实现层,断言全经代码实证)
   - [docs/LIBTV_FEATURE_INVENTORY.md](./docs/LIBTV_FEATURE_INVENTORY.md) —— LibTV 五轮实测字典(对标不懂看这里;还不懂就开浏览器去 LibTV 实地看,探索免费、点生成才扣积分)

## 工作区安排(2026-08-08 起:单 worktree)

| worktree | 分支 | 说明 |
|---|---|---|
| `.claude/worktrees/canvas-p1-acceptance` | codex/canvas-p1-acceptance | 画布当前唯一开发工作区,从 `main` 开、回 `main` 合 |

**P0 期那套三窗分工(shell 写入 / data 写入 / 审核合流)已退役,那三个 worktree 与对应分支都已删除。** 退役原因:①三窗靠「管辖目录不重叠」防踩脚,而画布现在是耦合整体(42 个组件 + 30 多个 `src/lib/canvas/` 文件互相调用,组件消费 lib、lib 消费 API),按目录切必然天天跨界;②三窗的实际代价是 7 个孤儿分支和一堆 worktree 垃圾,全靠人工合流收尾。**除非用户明确要求并行,不要再开多写入窗。**

> **仍然有效的架构裁决(勿违反)**:`src/stores/canvas-store.ts` **严禁 persist 画布文档**,持久化域节点 vs RF 视图节点由 rf-adapter 严格分层;`src/lib/canvas/schema.ts` 是**类型唯一契约**,禁止自定义平行类型;`/canvas` 硬鉴权在 `src/middleware.ts`。

**工作规则:**
- **认领即锁**:动工前先在看板把任务标 `进行中`,commit;做完标 `待审`。
- **卡住就停**:发现「必须 fork 现有链路才能做下去」→ 立即停手,写进看板问题区,等用户裁决(ADR2 铁律)。
- **结论必须落成文字**:接口/架构结论落到 `src/lib/canvas/schema.ts`(代码即契约,首选)、看板对应任务备注、或总纲 §四 ADR(新增条目);口头结论不算数,下个窗口看不到就会返工。
- **git 全流程由 AI 自主执行(2026-08-08 用户裁决放宽)**:push、开 PR、合并进 main、删远端分支,AI 都可以自己做,不必等用户点。**放宽的依据**:自动部署被 `LEGACY_WEBHOOK_DEPLOY_ENABLED=false` 关着,**合 main 不会上线**,上线只发生在手工蓝绿发布那一步——所以合并本身是可回退的普通动作。
  - 仍然守住的三条:①**禁 `git push --force`**(仓库无 CI、无必需审查,分支保护是唯一结构性防线,强推会毁掉它);②**删远端分支前必须逐个人工确认**——`git merge-base --is-ancestor` 对「从旧 main 建出、还没提交过内容的空工作分支」会误判成「已全合入、可删」,2026-08-06 已因此误删过两个分支,详见交接文档「严禁误删的两个远端分支」;③**发布到生产仍是独立决策**,合 main ≠ 发版。

## 铁律(所有窗口一体遵守,总纲 §四/§十 摘要)

1. **零 fork**:执行留现有链路(BTM/网关/generations),画布只是编排视图;不 fork 任何 API/执行器/store 原语。
2. **generations = 执行状态唯一真相源**;画布文档只存 `nodeId→taskId/generationId` 引用。
3. **画布文档禁存 dataURL/签名 URL,只存 OSS object key**;渲染层换签名 URL。
4. **节点白名单 6 类**(文本/图片/视频/商品/脚本/合成;剧本=文本 story_brief 变体),新增节点须用户裁决。
5. **三库同源**:历史/角色/积分直读现有表,不建平行表。
6. **迁移纪律**:SQL 落盘+本地语法校验,生产执行=用户经 Supabase dashboard(生产无 exec_sql RPC);迁移文件永不删除。
7. **每子任务过 `npx tsc --noEmit`;涉页面过 `npm run build`**;大改动跑对抗审查 workflow 修实锤。
8. **commit 中文、里程碑级、结尾中性署名 `Co-Authored-By: Claude <noreply@anthropic.com>`**(不写死具体模型名——切模型/换窗口会使记录失真)。**push / 开 PR / 合 main / 删远端分支由 AI 自主执行**(2026-08-08 用户裁决放宽;此前「绝不 push」的理由是「push main=生产自动部署」,**该前提已不成立**——自动部署被 `LEGACY_WEBHOOK_DEPLOY_ENABLED=false` 关着,合 main 不会上线)。**禁 `git push --force`;删远端分支前逐个人工确认(merge-base 会误判空工作分支);发布到生产仍是独立决策。**
9. **零价目变更**:调价须用户裁决。(P0 骨架不接生成/扣费的约束已随 P0 完成而失效——**P1 的生成接入与扣费已在生产运行**,改动计价链路要格外小心。)
10. **功能取舍不擅改**:做/裁/延与期次以 CHECKLIST 为准;认为需调整→写「建议调整」交用户,不直接改。改动 CHECKLIST 或 P0 看板后**必须跑 `node scripts/canvas-checklist-reconcile.mjs` 至绿**(统计表自洽 + P0 功能点与看板一一对应的机器守卫)。期次填写规则见 CHECKLIST 顶部「机器守卫」:复合/跨期期次(P1/P2、P2 批量/P3 合成 等)合法,脚本按首个 Pn 归一起始期;仅 **P0 首落行须以裸 `P0` 开头**(勿写「P0 起」),勿据此误改其它期次。

## 关键路径速查

- 统一视频网关:`src/app/api/video-batch/models/submit/route.ts`(DTO 含 characterAsset)
- 图片入口:`src/app/api/generate/image/route.ts`(服务端扣费+回滚;VALID_IMAGE_MODES 含 nine_grid)
- 执行引擎 BTM(浏览器内编排器):`src/components/background-task-manager.tsx`
- 蓝图:`blueprints` 表(20260702 迁移)+ `src/components/studio-shell/blueprint-drawer.tsx`(P2 脚本节点复用它,不重写)
- 角色资产:`ai_models` 表(020/20260313/20260314 迁移)+ `src/components/character-picker.tsx`
- 现有验收惯例:`.temp/canvas-p{n}-verify.mjs`;dev 起 3100 端口
- 环境:`.env.local` 各 worktree 一份(git-ignored);node_modules 各 worktree 独立 npm install

## 当前状态(2026-08-08,经生产库与生产机实测核对)

**期次进度**(功能点数来自 CHECKLIST 机器统计):

| 期 | 功能点 | 状态 |
|---|---|---|
| P0 画布骨架 | 48 | ✅ D1-D6/S1-S8 全部合流并上线 |
| P1 生成接入 | 51 | ⚠️ R1/R2 均已收口并上线;**2026-08-09 用户裁决把 9 项改判「延 P2」后从 61 降为 52**(R2-Q4),**同日 #78 图片比例再改判延 P2 后为 51**(P1-Q2b);剩余缺口=P1 收尾批次,见 P0 看板「批 0」 |
| P2 | 55 | 未开工,无看板 |
| P3 / P4 | 11 / 1 | 未开工 |

> P0 = 画布骨架 48 功能点,与 P0 看板一一对应,由 `scripts/canvas-checklist-reconcile.mjs` 机器守卫(改动 CHECKLIST 或看板后必须跑至绿;它也会校验本行的数字与 CHECKLIST 统计一致)。

**生产实测证据(2026-08-08)**:

- **11 个画布迁移在生产库 100% 已执行**(逐个探针核对:5 张 canvas 表、40 个 canvas 函数、`generations` 上 4 个 canvas 列、1 条 service_role 策略)
- **`canvases` 表有 7 行真实数据**——画布不只是部署了,是被真正用过的
- `/canvas` 公网返回 307(硬鉴权门正常);`stargaze-canvas-reconciler` 常驻在线
- 开放开关(2026-08-09 起):`NEXT_PUBLIC_CANVAS_ENABLED=true`(前端入口开)、**`CANVAS_PUBLIC_ENABLED=true`(已对所有登录用户开放)**、`CANVAS_ACCESS_USER_IDS` 那两个 uuid 保留未动(回退时的白名单)、`CANVAS_VIDEO_MODELS=happyhorse`(grok 因厂商无通道被摘出,代码保留,见 R2-Q1)。**该开关是运行时读,改了重启即可,不用重新构建**;回退=改回 `false` + 重启,改前备份在 release 目录的 `.env.local.bak-prepublic-20260809T154137Z`
- 线上版本 **`3dee031f00d1…`(2026-08-09 二次蓝绿发布,端口 **3015**,`DEPLOY_RC=0`,BUILD_ID 门通过)**;回滚包 `canvas-rollback-20260809T071016Z-port-3014-1002117`,`33ba71d`/3014 与 `d16620f`/3013 两个回滚位仍在线,**别把它们当成当前线上**(`abc29ac`/3012 已 `pm2 stop` 腾内存,release 目录还在,要用 `pm2 start` 即可)。12 个画布迁移已在生产执行;**本批零迁移**
- 发版后核对全绿:站点 200、`/canvas` 匿名 307、nginx→3015、`BUILD_ID` = release commit、`VIDEO_PLATFORM_IMAGE_BASE_URL=https://api.hellobabygo.com`、`CANVAS_VIDEO_MODELS=happyhorse`、`CANVAS_PUBLIC_ENABLED=true`(2026-08-09 用户裁决跳过灰度阶梯,直接全量开放)、磁盘余 7.7G
- **生产验证(零扣费)**:阈值 5000→1000 生效——图片 5 分/视频 5 秒 450 分不拦、**视频 12 秒 1080 分 `reason:"high_cost"` 拦**;Ctrl+Enter 弹「用快捷键发送，确认花费？」且**余额与生成数不变**;IME 组字期 Ctrl+Enter 无反应。客户端 bundle 里 `5000` 出现 **0 次**(阈值只在服务端)
- **新代码已在公网证实真在跑**:拉画布 chunk(HTTP 200/317KB),本批六个新字符串全部命中——不是只看进程起没起
- 🔴 **2026-08-09 发版打挂过整站约 15 分钟(构建 OOM)**。根因=release pm2 进程只加不减(9 个共 1263MB)+ `vm.swappiness=0` 使 2G swap 形同虚设。**下次发版必须先 `pm2 stop` 3 代以前的 release 进程、确认 `free -m` available ≥ 2000MB 再开构建**(用 `stop` 不用 `delete`,回滚仍可秒起)。发版脚本「构建失败则在任何流量变更前 abort」这条设计救了场,别动它。详见 HANDOFF「负三之零」

> ⚠️ **文档陷阱(已知,勿被误导)**:`docs/SUPER_CANVAS_P1_ACCELERATED_EXECUTION_PLAN.md` 顶部状态仍写 `PHASE_4_COMPLETE_OFFLINE_GREEN`、Phase 5/6 的 checkbox 全空,**那是过期的**——Phase 6「生产迁移+上线」实际早已发生。以本节和生产实测为准。

**下一步**(详见 [docs/HANDOFF_R2_NEXT.md](./docs/HANDOFF_R2_NEXT.md) §负二):

1. ✅ **四项裁决已于 2026-08-09 取得**(#185 按规格改代码 / #253 已 bound 行不做自动判死改判延 P2 / #237 随教程延 P2 / 资金③④ 等价验收结案)
2. ✅ **CHECKLIST 8+1 项改判已落笔**,后又加 #78(P1-Q2b),reconcile 绿(做 166/裁 31/延 23;P1=51)
3. ✅ **R2-Q4 补齐批次 6/6 已过闸**(#51②③ / #187 / #186 / #84 / #44+#72+#94 / #64),另 #185 阈值改造与停靠位 max-h 常量
4. ✅ **已发版两轮**(`33ba71d`/3014 → `3dee031`/3015);✅ **生产 UI 复验已完成**(补齐批次 8 项 + #185 收口批次的阈值/Ctrl+Enter/IME 三项,详见 P0 看板)。**唯一未实测:「放弃这次提交」**(需未绑定 intent,造真歧义有扣费风险);⚠️ 已知非阻断摩擦:1352×642 下面板溢出停靠位 66px
5. ✅ **已全量开放**(2026-08-09 用户裁决:网站用户少,跳过灰度阶梯。运行时开关,无需重构建;回退=改回 false + 重启)。🔴 **但 P1 没做完**——52 项里 #67 商品节点/#81-83 图片工具条/#85 nine_grid/#43 dirty 角标/#92 空态快捷/#182 @引用/#211 教程/#78 图片比例 既没改判也没补齐,详见 HANDOFF §负二③-b
6. **P2 待用户裁决后才开**,不要自行启动

**参照物**:LibTV 参照画布 spaceId=2614745(用户已充值;上面留有实测成片与视频故事节点)。
