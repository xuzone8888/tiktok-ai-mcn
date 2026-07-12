# P0 画布骨架 · 任务看板(多窗口协作事实源)

> **用法**:每个开发窗口开工前读 [CLAUDE.md](../CLAUDE.md) → 读本看板 → 把要做的任务「状态」改成 `进行中@窗口名` 并 commit(=认领,防双跑)→ 做完改 `待审` → 审核窗合流后改 `已合流`。
> **功能点零遗漏保证(机器强制)**:本看板文末《P0 功能点覆盖清单(机器核对区)》以 [SUPER_CANVAS_CHECKLIST.md](./SUPER_CANVAS_CHECKLIST.md) 功能点列**原文键**,把全部 48 个 P0『做』功能点逐条映射到负责任务;由 `scripts/canvas-checklist-reconcile.mjs` 机器核对**一一对应**(缺 1 项/多 1 项/键改字/任务不存在即报错退出 1)。下方各任务明细为**人类可读的实现分解**(措辞可精简、可拆分、可跨任务),**不作为机器映射依据**;任何文字冲突一律以 CHECKLIST 原文为准。
> **P0 目标**:内部可走查的画布骨架——能建 6 类空壳节点、连线、成组、保存不丢、坏档不白屏、双标签不打架。**不接生成**(生成是 P1)。
> **接口分歧裁决**:data 与 shell 可就接口自由讨论,但结论必须落成文字——`src/lib/canvas/schema.ts`(代码契约,首选)/ 本看板对应任务备注 / 总纲 §四 ADR 三选一;口头结论不算数。自决不了由审核窗+技术负责人裁决,裁决同落上述三处之一。

## 状态总览

| 任务 | 窗口 | 状态 | 依赖 |
|---|---|---|---|
| D1 canvases 表迁移+文档体积闸 | data | ✅ 审核通过(合流 2026-07-12) | 无(第一个做) |
| D2 zod schema+迁移注册表+坏档降级 | data | ✅ 审核通过(合流 2026-07-12) | D1 |
| D3 文档存取 API+补丁保存协议 | data | 待认领 | D1、D2 |
| D4 IndexedDB 影子副本 | data | 待认领 | D3 |
| D5 单写者锁 | data | 待认领 | D1 |
| D6 历史资产直读查询 | data | 待认领 | 无 |
| S1 /canvas 路由+React Flow 底盘 | shell | ✅ 代码/构建审核通过(合流 2026-07-13;登录态 UI 走查归 R1/R2) | 无(第一个做) |
| S2 建节点五入口+连线 | shell | ✅ 代码/构建审核通过(合流 2026-07-13;登录态 UI 走查归 R1/R2) | S1、D2(schema) |
| S3 6 类节点空壳 | shell | ✅ 代码/构建审核通过(合流 2026-07-13;登录态 UI 走查归 R1/R2) | S1、D2(schema) |
| S4 成组+快捷键全套+undo/redo | shell | 待认领 | S1;undo 依赖 D3 op log |
| S5 空态+底部工具栏+整理画布 | shell | 待认领 | S1 |
| S6 1366×768+媒体降级 | shell | 待认领 | S3 |
| S7 错误边界+store 防护 | shell | 待认领 | S1 |
| S8 历史资产面板+omnibox 确认 | shell | 待认领 | D6 |
| R1 验收脚本+性能实测 | review | 待认领 | 随各任务滚动 |
| R2 合流+对抗审查+真人走查 | review | 持续 | 各任务转「待审」时 |

## 任务明细(含 CHECKLIST 行级映射)

### data 窗口(worktree: canvas-p0-data,分支 claude/canvas-p0-data)
**负责**:`supabase/migrations/`、`src/lib/canvas/`(新建目录,含 schema.ts=双窗口共享合约)、`src/app/api/canvas/`。**接口先行纪律:D2 的 schema.ts 最先落地并 commit,shell 窗口 rebase 消费。**

- **D1 canvases 表迁移 + 文档体积闸**(DDL 全文照抄 [SUPER_CANVAS_DATA_MODEL.md](./SUPER_CANVAS_DATA_MODEL.md) §六,迁移文件 `20260714_canvases.sql`;SQL 落盘由用户经 dashboard 执行,本地先写 runner 脚本+语法自校)
  - ✅ canvases 文档 schema(#27:本任务建表——`doc` jsonb 只存拓扑+引用[nodes/edges/groups],`schema_version`/`deps` 是独立 DB 列非 doc 内嵌;doc 结构 zod 定义归 D2,二者合成同一功能点)
  - ✅ 文档 >512KB 软告警(#29 数据半:doc_bytes 列 + 512KB 阈值;不拒存,横幅 UI 在 S7)
  - ✅ 文档 >2MB 硬拒存(#47 数据半:2MB 阈值;硬拒逻辑在 D3 API 返 400,拒存 toast 在 S7)
- **D2 zod schema + 迁移注册表 + 坏档降级(数据面)**(`src/lib/canvas/schema.ts`:doc/node/edge/group 的 zod v1 + refs 引用约定 + deps 结构;此文件是 shell/data 共享合约)
  - ✅ canvases 文档 schema 的结构定义(#27 结构半:doc/node/edge/group zod;与 D1 表迁移合成同一功能点)
  - ✅ zod 加载校验+非法节点降级「损坏节点」占位卡(可删),永不整画布白屏(数据面:校验失败节点标记 broken,占位卡 UI 归 S3)
  - ✅ schema 迁移注册表(v1→v2→…;上一版本文档能打开进 DoD)
  - ✅ 禁存 dataURL/签名 URL,只存 OSS object key(#28 数据半:schema 校验层拒绝 data:/签名 URL 入库;渲染层换签名 URL+内存缓存归 S6)
  - ✅ 节点白名单纪律(6 类 v1)——schema 的 node.type 枚举即白名单载体
- **D3 文档存取 API + 补丁保存协议**(`src/app/api/canvas/[id]/route.ts`:GET 整包 / PATCH 节点级补丁 + rev CAS + updated_at 手动写[仓库惯例,表无触发器])
  - ✅ 自动保存=节点级补丁(op log),非重叠自动 rebase(协议+服务端;客户端定时器归 S 侧接入)
  - ✅ 断网 30s 恢复自动补存(补丁队列重放机制)
  - ✅ 文档 >2MB 硬拒存(#47 服务半,P0-Q1 已裁):POST/PATCH 计算 doc_bytes,>2MB 返 400 拒存;≤2MB 正常入库并写 doc_bytes(512KB 软告警不在此拒,由 S7 横幅提示)
- **D4 IndexedDB 影子副本**(`src/lib/canvas/shadow.ts`)
  - ✅ IndexedDB 影子副本 + shadow>server 一键恢复(不占 localStorage 5MB 配额)
- **D5 单写者锁**(`src/lib/canvas/writer-lock.ts` + API 侧 writer_tag/heartbeat)
  - ✅ 单写者锁(navigator.locks)+ 双标签第二个只读+横幅(横幅 UI 归 S7 消费其状态)
- **D6 历史资产直读查询**(`src/app/api/canvas/history/route.ts` 或复用现有查询;**三库同源:直读 generations/assets/blueprints,不建平行表**)
  - ✅ 历史资产库(数据面:跨画布图/视频/音频生成历史查询,按类型三 tab+日期分组+计数)

### shell 窗口(worktree: canvas-p0-shell,分支 claude/canvas-p0-shell)
**负责**:`src/app/(canvas)/canvas/`(新路由,不动 /studio)、`src/components/canvas/`、`src/stores/canvas-store.ts`(裁决 2 管辖例外)。**消费 data 的 schema.ts,不得自定义平行类型。**

- **S1 /canvas 路由 + React Flow 底盘**(依《接口评审裁决》:含 `src/stores/canvas-store.ts` 管辖[devtools+immer,禁 persist 文档,rf-adapter 分层];**只装 `@xyflow/react`,dagre 延 S5**;**P0 不挂 BTM**;`/canvas` 硬鉴权由审核窗合流加 middleware)
  - ✅ 无限画布 pan/zoom(React Flow MIT 底盘 + zustand)
  - ✅ 新路由 /canvas,不动 /studio
  - ✅ 小地图(1366×768 下默认收起)
  - ✅ 网格吸附
  - ✅ 缩放控件 + Ctrl+0 适应视图
  - ✅ 隐藏连线开关
  - ✅ 快捷键:Space 拖画布
- **S2 建节点五入口 + 连线**
  - ✅ 双击空白建节点
  - ✅ Tab 建节点
  - ✅ 拖入文件建节点(上传;复用现有 OSS 上传链路,只存 object key)
  - ✅ 侧边栏+拉线建节点
  - ✅ 节点连线(edge)
- **S3 6 类节点空壳**
  - ✅ 6 类节点空壳(可创建/连线/占位渲染,不接生成)
  - ✅ 文本节点(提示词/文案载体,可被 @ 引用——P0 先做可编辑文本体)
  - ✅ 内容节点删除二次确认
  - ✅ 损坏节点占位卡 UI(可删;消费 D2 的 broken 标记)
- **S4 成组 + 快捷键全套 + undo/redo**(快捷键权威表=CHECKLIST A 组,面板只列已生效键)
  - ✅ 成组(Ctrl/Alt+G) ✅ 解组 Ctrl/Alt+Shift+G
  - ✅ Ctrl+L 连线 ✅ Ctrl+D 复制节点带连线 ✅ Delete 删除(联动删除确认)
  - ✅ 节点复制(Alt+拖动) ✅ 创建副本(Ctrl+Alt+拖动,带连线)
  - ✅ Ctrl+Z 撤销(只覆盖画布文档,不撤生成任务;op log 逆操作) ✅ 重做 Ctrl+Shift+Z(正向重放)
  - ✅ 缩放 Ctrl+加减号
  - ✅ 常驻「?」快捷键面板
- **S5 空态 + 底部工具栏 + 整理画布**
  - ✅ 空态四快捷位(P0 =壳:仅建节点引导,真快捷位 P1/P2 按首渲期次点亮,未上线不渲染)
  - ✅ 底部工具栏(添加节点/工作流/素材库/角色库/历史记录/快捷键/教程;壳 P0,入口随所属期点亮)
  - ✅ 整理画布自动布局(Alt+Shift+F,dagre/elk)
- **S6 1366×768 + 媒体降级 + 渲染层 URL 解析**
  - ✅ 1366×768 最小适配(侧栏默认图标态/生成器超视口 dock 底部/胶囊≥5 折叠——P0 先落侧栏与布局骨架)
  - ✅ 媒体降级策略(节点默认 poster 缩略图/选中才挂 `<video>` 且 DOM 断言进 DoD/同屏活跃视频≤6/低 zoom 语义缩放降级色块——P0 落机制,P1 有真媒体后实测)
  - ✅ 渲染层 OSS object key→签名 URL + 内存缓存(#28 渲染半:上传缩略图/媒体展示统一经此;schema 层拒绝非法 URL 入库在 D2)
- **S7 错误边界 + store 防护 + 文档健康反馈 UI**
  - ✅ 组件级错误边界+「尝试恢复/重新加载画布」按钮
  - ✅ store 层防护+错误边界触发进监控(单画布>1 次/日报警)
  - ✅ 单写者只读横幅 UI(消费 D5 状态)
  - ✅ 文档健康反馈 UI(P0-Q1 已裁):>512KB 软告警横幅「画布偏大建议拆分」(#29 UI 半;不拒存,阈值 D1)、>2MB 硬拒 toast(#47 UI 半;拒存在 D3 返 400,阈值 D1)
- **S8 历史资产面板 + omnibox 确认**
  - ✅ 历史资产面板 UI(三 tab 图/视频/音频+计数+日期分组+从中选素材建节点;消费 D6)
  - ✅ omnibox 长期保留轻量快捷入口(零改动,验证不受画布影响即可)

### review 窗口(worktree: studio-content-ux-redesign-70bfa0,分支 claude/studio-content-ux-redesign-70bfa0 = 集成分支)
**负责**:合流两个写入分支、跑验收、对抗审查、维护本看板与 tracker。**合流只发生在本窗口。**

- **R1 验收脚本 + 性能实测**(`.temp/canvas-p0-verify.mjs` 惯例)
  - ✅ P0 验收模板 7 项:空态快捷位可点(壳态=建节点引导可点)/建节点编辑 5s 后刷新零丢失/断网 30s 恢复自动补存/双标签第二个只读+横幅/塞坏 node json 画布照开+占位卡/100 节点保存<1s/Ctrl+Z
  - ✅ 性能预算数值验收:200 节点 pan/zoom≥50fps(中端机)/冷加载<3s/100 节点+30 视频 poster 内存<800MB(P0 用 poster 占位图压测)/100 节点保存<1s
  - ✅ 每期验收脚本惯例(工程纪律,P0 起)
- **R2 合流 + 对抗审查 + 真人走查**
  - 写入分支转「待审」→ 本窗口 merge → `npx tsc --noEmit` + `npm run build` → 大改动跑对抗审查 workflow 修实锤 → 更新看板状态与 tracker「当前状态」
  - P0 收口:真人 1366×768 全流程走查,卡点(停留>60s 无操作)>2 不算完成

## P0 明确不做(防scope蔓延,开发时别顺手加)
生成器面板/积分预估/费用条(P1)、任何生成提交(P1)、脚本节点向导(P2)、资产装配(P2)、分享(P3)、合成(P3)。空态只渲染建节点引导。

## data-shell 接口评审裁决(2026-07-12 固化,审核窗+技术负责人裁决,写入窗遵照)

以下为 data 与 shell 接口评审的已裁决结论,固化于此作为跨窗口权威依据;技术决策同步为架构约定(等价 ADR),写入窗遵照执行、勿再各自另定。

- **裁决 1·跨切面文件由审核窗合流实施**(不属任一写入窗管辖目录,写入窗勿在自己分支单独改以免冲突/越权):
  - **`/canvas` 硬鉴权**:审核窗在 R2 合流阶段给 `src/middleware.ts` 的 `PROTECTED_ROUTES` 加 `/canvas`(全站鉴权切面)。**验收**:未登录访问 `/canvas` 被拦到登录页。(关联 #31 新路由)
  - **canvases 类型同步**:审核窗合流时同步 `src/types/database.ts` 的 canvases 行类型(共享类型文件,D1 出迁移但不单独改此文件)。**验收**:`npx tsc --noEmit` 过、引用 canvases 处有类型。(关联 #27 canvases schema)
- **裁决 2·shell 管辖例外 + store 架构约定**:批准 shell 窗口**唯一**跨界管辖 `src/stores/canvas-store.ts`(其余仍限 `src/app/(canvas)/`+`src/components/canvas/`)。约定(强制):store = **devtools + immer**;**严禁 `persist` 画布文档**(文档持久化归 D3 API + D4 IndexedDB 影子,store 只持运行态);**持久化域节点(schema/canvases.doc)与 React Flow 视图节点由 `rf-adapter` 严格分层**,两者禁止直接互相赋值/透传。
- **裁决 3·P0/P1 执行上下文边界**:**P0 `/canvas` 不挂 BTM**(background-task-manager),P0 不接任何生成;**P1 接生成前置验收**:BTM/执行上下文接入(节点状态机经 generations 对账、乐观 UI)必须先过验收再开 P1 生成链——列为 P0→P1 交接硬门。
- **裁决 4·S1 依赖范围**:**S1 只加 `@xyflow/react`**(React Flow 底盘);`dagre`(自动布局依赖)**延到 S5**(#8「整理画布自动布局」本就属 S5),S1 不引入,避免 P0 早期依赖膨胀。
- **裁决 5·D2 schema 消费合约(shell 接线,D1/D2 已合流固化,S1/S3/S7 遵照)**:`src/lib/canvas/schema.ts` 已落地(强 strict + 容错 `loadCanvasDoc`),shell 接线三条硬约束:
  1. **`loadCanvasDoc(...).recoveryRequired === true` 时必须阻止 autosave**(迁移未完成 / 存在 broken 节点或连线 / 危险 params);未清理前保存会把坏档写回,禁止。
  2. **broken 实体(`brokenNodes`/`brokenEdges`)由 S3 显式处理**(占位卡 + 用户删除/修复)**后才能解除保存阻断**;S3 消费 D2 的 broken 标记渲染占位卡,不得静默丢弃。
  3. **不得持久化 React Flow 视图字段**(selected/dragging/measured/width/…):写库前经 `rf-adapter` 把 RF 节点降回域节点;`CanvasNodeSchema` 用 `strictObject` 会**直接拒绝**任何 RF view 字段入库(裁决 2 的 rf-adapter 分层由此强制)。
  - 补充:节点级补丁 / op-log 保存协议归 **D3**(schema.ts 仅提供 `CanvasRevisionSchema` 的 rev CAS 原语,未臆造 op-log);envelope(`schemaVersion`+`doc`+`deps`)仅用于 API/导出组合,**禁止写回 `doc` jsonb 列**。

## 待裁决问题区(P0 开工前/相应任务前必须裁决,勿擅改 CHECKLIST)

> 规则:写入窗遇「必须裁决才能做下去」的问题,写此处,等审核窗+技术负责人(必要时用户)裁决;裁决前**不擅改 CHECKLIST 功能取舍**(铁律#10)。

- **P0-Q1 · ✅ 已裁决(2026-07-12,技术负责人)**:体积双闸统一为 **>512KB 软告警(建议拆画布,不拒存)/ >2MB 硬拒存并提示**。理由:告警必须早于硬闸,且不妨碍 200 节点 P0 目标。**已落地**:CHECKLIST #29(A 组,改「>512KB 软告警建议拆画布」)/#47(G 组,改「>2MB 硬拒存并提示」)文字与备注、本看板覆盖表(#29→D1+S7、#47→D1+D3+S7)、D1/D3/S7 任务明细、总纲 §五/§七、DATA_MODEL §六 均已同步。**分工**:D3 实施 2MB 硬拒(POST/PATCH >2MB 返 400);S7 实施 512KB 软告警横幅 + 2MB 拒存 toast;D1 只提供两个阈值契约。**待 data 后续 commit 同步(非审核窗改)**:`src/lib/canvas/doc-limits.ts` 常量按裁决翻转(`HARD_LIMIT=2MB`、`WARN_LIMIT=512KB`;f838476 原实现是 hard=512KB/warn=2MB 反的,导致告警分支死代码)+ 迁移文件 `doc_bytes` 注释同步;供 D2 复审时一并核。

## 合流顺序建议
D1→D2(schema.ts 落地)→ S1/S3 与 D3-D6 并行 → S2/S4/S5 → S6/S7/S8 → R1 全量跑 → R2 收口(含上「跨目录归属项」两条)。

## P0 功能点覆盖清单(机器核对区,勿手改「原文键」列的字)

> 本表是 P0 零遗漏的**唯一机器依据**:左列=CHECKLIST 功能点列**逐字原文**,由 `node scripts/canvas-checklist-reconcile.mjs` 与 CHECKLIST 现算 P0『做』集合逐键比对,必须完全一一对应。
> 维护规则:CHECKLIST 的 P0『做』行有增删/改字时,先跑 `node scripts/canvas-checklist-reconcile.mjs --list-p0` 取最新键,同步更新本表(键必须逐字一致);任务列可写 `S4` 或 `D2+S3`(跨任务由脚本取首个任务 ID 校验其存在于状态总览)。

| # | P0 功能点(CHECKLIST 原文键,勿改字) | 负责任务 |
|---|---|---|
| 1 | 无限画布 pan/zoom(React Flow MIT 底盘 + zustand) | S1 |
| 2 | 双击空白建节点 | S2 |
| 3 | Tab 建节点 | S2 |
| 4 | 拖入文件建节点(上传) | S2 |
| 5 | 侧边栏+拉线建节点 | S2 |
| 6 | 节点连线(edge) | S2 |
| 7 | 成组(Ctrl/Alt+G) | S4 |
| 8 | 整理画布自动布局(Alt+Shift+F) | S5 |
| 9 | 小地图 | S1 |
| 10 | 网格吸附 | S1 |
| 11 | 缩放控件 + Ctrl+0 适应视图 | S1 |
| 12 | 隐藏连线开关 | S1 |
| 13 | 快捷键:Ctrl+L 连线 | S4 |
| 14 | 快捷键:Ctrl+D 复制节点带连线 | S4 |
| 15 | 快捷键:Space 拖画布 | S1 |
| 16 | 快捷键:Delete 删除 | S4 |
| 17 | 快捷键:Ctrl+Z 撤销(undo 只覆盖画布文档,不撤生成任务) | S4 |
| 18 | 快捷键:解组 Ctrl/Alt+Shift+G | S4 |
| 19 | 快捷键:节点复制(Alt+拖动节点) | S4 |
| 20 | 快捷键:创建副本(Ctrl+Alt+拖动,带连线) | S4 |
| 21 | 快捷键:重做 Ctrl+Shift+Z | S4 |
| 22 | 快捷键:缩放 Ctrl+加减号 | S4 |
| 23 | 空态四快捷位=点击生成已连好线+示例内容+首输入框聚焦的完整节点链(①图生视频 P1 ②商品图→带货视频 P1 ③一句话→剧本节点→分镜脚本 P2 ④文案→配音视频 P2·载体=脚本节点配音路径) | S5 |
| 24 | 自动保存=节点级补丁(op log),非重叠自动 rebase | D3 |
| 25 | IndexedDB 影子副本 + shadow>server 一键恢复 | D4 |
| 26 | 单写者锁(navigator.locks)+ 双标签第二个只读+横幅 | D5+S7 |
| 27 | canvases 文档 schema(doc jsonb=拓扑+引用;schema_version/deps 独立列) | D1+D2 |
| 28 | 禁存 dataURL/签名 URL,只存 OSS object key(渲染层换签名 URL+内存缓存) | D2+S6 |
| 29 | 文档 >512KB 软告警建议拆画布 | D1+S7 |
| 30 | 断网 30s 恢复自动补存 | D3 |
| 31 | 新路由 /canvas,不动 /studio | S1 |
| 32 | omnibox 长期保留轻量快捷入口 | S8 |
| 33 | 1366×768 最小适配(侧栏默认图标态/生成器超视口 dock 底部/胶囊≥5 折叠) | S6 |
| 34 | 底部工具栏(添加节点/工作流/素材库/角色库/历史记录/快捷键/教程) | S5 |
| 35 | 常驻「?」快捷键面板 | S4 |
| 36 | 6 类节点空壳(可创建/连线/占位渲染,不接生成) | S3 |
| 37 | 文本节点(提示词/文案载体,可被 @ 引用) | S3 |
| 38 | 节点白名单纪律(6 类 v1;新增节点须对标复核+用户裁决) | D2 |
| 39 | 历史资产库(跨画布图/视频/音频生成历史,从中选素材建节点) | D6+S8 |
| 40 | 组件级错误边界+「尝试恢复/重新加载画布」按钮 | S7 |
| 41 | store 层防护+错误边界触发进监控(单画布>1 次/日报警) | S7 |
| 42 | zod 加载校验+非法节点降级「损坏节点」占位卡(可删),永不整画布白屏 | D2+S3 |
| 43 | schema 迁移注册表(v1→v2→…;上一版本文档能打开进 DoD) | D2 |
| 44 | 内容节点删除二次确认 | S3 |
| 45 | 媒体降级策略(节点默认 poster 缩略图/选中才挂 `<video>` 且 DOM 断言进 DoD/同屏活跃视频≤6/低 zoom 语义缩放降级色块) | S6 |
| 46 | 性能预算数值验收(200 节点 pan/zoom≥50fps 中端机/冷加载<3s/100 节点+30 视频 poster 内存<800MB/100 节点保存<1s) | R1 |
| 47 | 文档 >2MB 硬拒存并提示 | D1+D3+S7 |
| 48 | 每期验收脚本惯例 .temp/canvas-p{n}-verify.mjs + tsc/build/实弹/大改动对抗审查 workflow | R1 |
