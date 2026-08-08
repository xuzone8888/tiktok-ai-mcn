# StarGaze · 超级画布开发指南(每个窗口开工前必读)

StarGaze 是一个 AI 视频创作平台(Next.js + Supabase + 阿里云 OSS,生产站 toryxai.com)。当前主战场:**超级画布的 P1 验收收尾**——对标 liblib.tv LibTV 的无限画布节点编排,一套「分镜→资产装配→逐镜图→图生视频→配音→合成」中台 + 两种起点(**电商带货**=商品节点起 / **剧情创作**=剧本节点起,覆盖漫剧/短剧/推文)。

> **P0 与 P1 的工程、迁移、上线都已完成**,画布正在生产以 canary 灰度运行(白名单 2 人,视频模型 `happyhorse`)。当前唯一在做的事:**R2 收口**——R1 已全过,R2 走查过了资金硬门与并发/租约类的项,但主线旅程 A 还有 5 步没跑完(商品节点整条链路完全没碰),并查出 3 个真实缺陷(R2-Q1/Q2/Q3)。**扩灰度的前置条件尚未满足。P2 尚未开工,未经用户裁决不要自行启动。**

## 新窗口恢复协议(30 秒弄清现状)

1. 读本文件(你正在读)。
2. 读 [docs/EXECUTION_TRACKER.md](./docs/EXECUTION_TRACKER.md) 的「当前状态」—— 执行状态唯一事实源。
3. 读 **[docs/HANDOFF_R2_NEXT.md](./docs/HANDOFF_R2_NEXT.md)** —— **待办清单 + 三个缺陷速查 + 浏览器走查踩坑技巧。新窗口的实际入口就是这份,先读它再动手。**
4. 读 [docs/SUPER_CANVAS_P0_BOARD.md](./docs/SUPER_CANVAS_P0_BOARD.md) —— D1-D6/S1-S8 已全部合流;R1 完成明细、R2 走查逐项结果、R2-Q1/Q2/Q3 三个缺陷都在这里。
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
- **合 main 一律人工点**:仓库无 CI、无必需审查,分支保护是唯一结构性防线,且禁强推——合错了只能补 revert。

## 铁律(所有窗口一体遵守,总纲 §四/§十 摘要)

1. **零 fork**:执行留现有链路(BTM/网关/generations),画布只是编排视图;不 fork 任何 API/执行器/store 原语。
2. **generations = 执行状态唯一真相源**;画布文档只存 `nodeId→taskId/generationId` 引用。
3. **画布文档禁存 dataURL/签名 URL,只存 OSS object key**;渲染层换签名 URL。
4. **节点白名单 6 类**(文本/图片/视频/商品/脚本/合成;剧本=文本 story_brief 变体),新增节点须用户裁决。
5. **三库同源**:历史/角色/积分直读现有表,不建平行表。
6. **迁移纪律**:SQL 落盘+本地语法校验,生产执行=用户经 Supabase dashboard(生产无 exec_sql RPC);迁移文件永不删除。
7. **每子任务过 `npx tsc --noEmit`;涉页面过 `npm run build`**;大改动跑对抗审查 workflow 修实锤。
8. **commit 中文、里程碑级、结尾中性署名 `Co-Authored-By: Claude <noreply@anthropic.com>`(不写死具体模型名——切模型/换窗口会使记录失真);绝不 push**(push main=生产自动部署,须用户裁决)。
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
| P1 生成接入 | 61 | ✅ 工程 + 数据库迁移 + 生产上线**全部完成**;⚠️ 只剩 R1/R2 真人验收未做 |
| P2 | 55 | 未开工,无看板 |
| P3 / P4 | 11 / 1 | 未开工 |

> P0 = 画布骨架 48 功能点,与 P0 看板一一对应,由 `scripts/canvas-checklist-reconcile.mjs` 机器守卫(改动 CHECKLIST 或看板后必须跑至绿;它也会校验本行的数字与 CHECKLIST 统计一致)。

**生产实测证据(2026-08-08)**:

- **11 个画布迁移在生产库 100% 已执行**(逐个探针核对:5 张 canvas 表、40 个 canvas 函数、`generations` 上 4 个 canvas 列、1 条 service_role 策略)
- **`canvases` 表有 7 行真实数据**——画布不只是部署了,是被真正用过的
- `/canvas` 公网返回 307(硬鉴权门正常);`stargaze-canvas-reconciler` 常驻在线
- 灰度开关:`NEXT_PUBLIC_CANVAS_ENABLED=true`(前端入口开)、`CANVAS_PUBLIC_ENABLED=false`、`CANVAS_ACCESS_USER_IDS` **白名单仅 1 人**、`CANVAS_VIDEO_MODELS=grok`

> ⚠️ **文档陷阱(已知,勿被误导)**:`docs/SUPER_CANVAS_P1_ACCELERATED_EXECUTION_PLAN.md` 顶部状态仍写 `PHASE_4_COMPLETE_OFFLINE_GREEN`、Phase 5/6 的 checkbox 全空,**那是过期的**——Phase 6「生产迁移+上线」实际早已发生。以本节和生产实测为准。

**下一步**(2026-08-08 用户裁决:先验收 P1 再扩灰度):

1. 做 P0 看板的 **R1**(验收脚本 + 性能实测)与 **R2**(真人走查),用白名单账号实走一遍生成链路
2. 验收通过后再决定把 `CANVAS_ACCESS_USER_IDS` 扩到更多人 / 是否翻 `CANVAS_PUBLIC_ENABLED`
3. **P2 待用户裁决后才开**,不要自行启动

**参照物**:LibTV 参照画布 spaceId=2614745(用户已充值;上面留有实测成片与视频故事节点)。
