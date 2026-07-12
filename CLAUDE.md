# StarGaze · 超级画布开发指南(每个窗口开工前必读)

StarGaze 是一个 AI 视频创作平台(Next.js + Supabase + 阿里云 OSS,生产站 toryxai.com)。当前主战场:**超级画布**——对标 liblib.tv LibTV 的无限画布节点编排,一套「分镜→资产装配→逐镜图→图生视频→配音→合成」中台 + 两种起点(**电商带货**=商品节点起 / **剧情创作**=剧本节点起,覆盖漫剧/短剧/推文)。

## 新窗口恢复协议(30 秒弄清现状)

1. 读本文件(你正在读)。
2. 读 [docs/SUPER_CANVAS_P0_BOARD.md](./docs/SUPER_CANVAS_P0_BOARD.md) —— 当前期任务看板:谁在做什么、什么待认领。
3. 按你所在 worktree 的角色(见下表)认领任务:把看板里该任务状态改 `进行中@角色名` 并 commit,然后动工。
4. 每完成一个任务:更新看板状态 → 更新 [docs/EXECUTION_TRACKER.md](./docs/EXECUTION_TRACKER.md)「当前状态」→ commit。
5. 需要背景细节才去翻(按需,不必全读):
   - [docs/SUPER_CANVAS_MASTER_PLAN.md](./docs/SUPER_CANVAS_MASTER_PLAN.md) —— 总纲:范围/ADR/分期/验收(裁决层)
   - [docs/SUPER_CANVAS_CHECKLIST.md](./docs/SUPER_CANVAS_CHECKLIST.md) —— **220 项功能点唯一事实源**(做/裁/延×期次×复用件);任何「这个功能做不做/几期做」的问题答案都在这
   - [docs/SUPER_CANVAS_DATA_MODEL.md](./docs/SUPER_CANVAS_DATA_MODEL.md) —— 表结构 DDL/字段映射/注入链(实现层,断言全经代码实证)
   - [docs/LIBTV_FEATURE_INVENTORY.md](./docs/LIBTV_FEATURE_INVENTORY.md) —— LibTV 五轮实测字典(对标不懂看这里;还不懂就开浏览器去 LibTV 实地看,探索免费、点生成才扣积分)

## 多窗口分工(P0 期)

| worktree | 分支 | 角色 | 管辖目录 |
|---|---|---|---|
| `.claude/worktrees/canvas-p0-shell` | claude/canvas-p0-shell | **写入①壳** | src/app/(canvas)/、src/components/canvas/ |
| `.claude/worktrees/canvas-p0-data` | claude/canvas-p0-data | **写入②数据** | supabase/migrations/、src/lib/canvas/、src/app/api/canvas/ |
| `.claude/worktrees/studio-content-ux-redesign-70bfa0` | claude/studio-content-ux-redesign-70bfa0 | **审核+集成** | 合流/验收/文档/看板 |

**协作规则(违反会互相踩脚,严格执行):**
- **认领即锁**:动工前先在看板把任务标 `进行中`,commit 到自己分支;看板冲突以集成分支为准。
- **接口先行**:`src/lib/canvas/schema.ts`(zod+类型)由 data 窗口最先落地;shell 窗口 rebase 集成分支后消费,**禁止自定义平行类型**。
- **不越界**:只改自己管辖目录;确需跨界(如共享组件),把需求写进看板备注,由审核窗裁决归属。
- **合流只在审核窗**:写入窗做完标 `待审`,审核窗 merge → tsc → build → 对抗审查 → 标 `已合流`。写入窗**不互相 merge**。
- **卡住就停**:发现「必须 fork 现有链路才能做下去」→ 立即停手,写进看板问题区,等上会裁决(ADR2 铁律)。

## 铁律(所有窗口一体遵守,总纲 §四/§十 摘要)

1. **零 fork**:执行留现有链路(BTM/网关/generations),画布只是编排视图;不 fork 任何 API/执行器/store 原语。
2. **generations = 执行状态唯一真相源**;画布文档只存 `nodeId→taskId/generationId` 引用。
3. **画布文档禁存 dataURL/签名 URL,只存 OSS object key**;渲染层换签名 URL。
4. **节点白名单 6 类**(文本/图片/视频/商品/脚本/合成;剧本=文本 story_brief 变体),新增节点须用户裁决。
5. **三库同源**:历史/角色/积分直读现有表,不建平行表。
6. **迁移纪律**:SQL 落盘+本地语法校验,生产执行=用户经 Supabase dashboard(生产无 exec_sql RPC);迁移文件永不删除。
7. **每子任务过 `npx tsc --noEmit`;涉页面过 `npm run build`**;大改动跑对抗审查 workflow 修实锤。
8. **commit 中文、里程碑级、结尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;绝不 push**(push main=生产自动部署,须用户裁决)。
9. **积分框架期零价目变更**;P0 不接任何生成/扣费。
10. **功能取舍不擅改**:做/裁/延与期次以 CHECKLIST 为准;认为需调整→写「建议调整」交用户,不直接改。

## 关键路径速查

- 统一视频网关:`src/app/api/video-batch/models/submit/route.ts`(DTO 含 characterAsset)
- 图片入口:`src/app/api/generate/image/route.ts`(服务端扣费+回滚;VALID_IMAGE_MODES 含 nine_grid)
- 执行引擎 BTM(浏览器内编排器):`src/components/background-task-manager.tsx`
- 蓝图:`blueprints` 表(20260702 迁移)+ `src/components/studio-shell/blueprint-drawer.tsx`(P2 脚本节点复用它,不重写)
- 角色资产:`ai_models` 表(020/20260313/20260314 迁移)+ `src/components/character-picker.tsx`
- 现有验收惯例:`.temp/canvas-p{n}-verify.mjs`;dev 起 3100 端口
- 环境:`.env.local` 各 worktree 一份(git-ignored);node_modules 各 worktree 独立 npm install

## 当前状态(2026-07-12)

- 方案五轮定稿(三路审查+三层复核+两轮 LibTV 补实测+实弹 1 图 2 视频验证),用户已批准 P0 开工。
- P0 = 画布骨架 48 功能点(看板 16 任务),内部不对外;P1 生成接入起才对外灰度。
- LibTV 参照画布:spaceId=2614745(用户已充值,余额约 ⚡1281;上面留有实测成片与视频故事节点)。
