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
| D3 文档存取 API+补丁保存协议 | data | ✅ 代码/构建审核通过(合流 2026-07-13) | D1、D2 |
| D4 IndexedDB 影子副本 | data | ✅ 代码/构建审核通过(合流 2026-07-13) | D3 |
| D5 单写者锁 | data | ✅ 代码/安全/全量构建审核通过(合流 2026-07-13;只读横幅 UI 归 S7) | D1 |
| D6 历史资产直读查询 | data | ✅ 代码/安全/全量构建/独立终审通过(合流 2026-07-13;生产迁移待 dashboard 执行;登录态 UI 归 R1/R2) | 无 |
| S1 /canvas 路由+React Flow 底盘 | shell | ✅ 代码/构建审核通过(合流 2026-07-13;登录态 UI 走查归 R1/R2) | 无(第一个做) |
| S2 建节点五入口+连线 | shell | ✅ 代码/构建审核通过(合流 2026-07-13;登录态 UI 走查归 R1/R2) | S1、D2(schema) |
| S3 6 类节点空壳 | shell | ✅ 代码/构建审核通过(合流 2026-07-13;登录态 UI 走查归 R1/R2) | S1、D2(schema) |
| S4 成组+快捷键全套+undo/redo | shell | ✅ 代码/全量构建/独立终审通过(合流 2026-07-13;登录态 UI 走查归 R1/R2) | S1;undo 依赖 D3 op log |
| S5 空态+底部工具栏+整理画布 | shell | ✅ 代码/构建审核通过(合流 2026-07-13;登录态 UI 走查归 R1/R2) | S1 |
| S6 1366×768+媒体降级 | shell | ✅ 代码/安全/全量构建审核通过(合流 2026-07-13;登录态真媒体 UI/性能实测归 R1/R2) | S3 |
| S7 错误边界+store 防护 | shell | ✅ 代码/安全/全量构建/独立终审通过(合流 2026-07-13;登录态 UI 归 R1/R2) | S1 |
| S8 历史资产面板+omnibox 确认 | shell | ✅ 代码/安全/全量构建/独立终审通过(合流 2026-07-13;登录态 UI 归 R1/R2) | D6 |
| R1 验收脚本+性能实测 | review | ✅ 完成(2026-08-08,P0+P1 全量;详见 R1 明细) | 随各任务滚动 |
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
  - **审核收口(2026-07-13)**:D5 verifier 208/208、D3 153/153、D1-D4/S1-S6 全回归、`tsc`、生产构建全绿；生产 PATCH 强制合法 writerTag，并将活跃 heartbeat、writer_tag、rev CAS 置于同一原子 UPDATE。控制器补双标签低频自动接管、挂起心跳超租约本地判死、迟到 claim/heartbeat 补偿释放与 release 重入屏障，所有异常/stop/abort/迟到回调 fail-closed。只读横幅 UI 仍由 S7 接线。
- **D6 历史资产直读查询**(`src/app/api/canvas/history/route.ts` 或复用现有查询;**三库同源:直读 generations/assets/blueprints,不建平行表**)
  - ✅ 历史资产库(数据面:跨画布图/视频/音频生成历史查询,按类型三 tab+日期分组+计数)
  - **审核收口(2026-07-13)**:D6 verifier 162/162、D1-D5 81/119/153/96/208、S1-S7 53/72/54/401/52/138/220、48 项 P0 精确对账、`tsc`、生产构建 140/140 全绿。查询按 owner/status 与复合 keyset 有界扫描 generations/products/blueprints，兼容当前线上 `type+result_url` 与历史 `generation_type+output_url` schema；products 仅在明确 relation-missing 时降级并回传稳定 health，其余权限/网络/数据库错误 fail-closed。媒体只返回 owner-bound object key。`20260715_generations_service_role_policy.sql` 修复旧 PUBLIC service policy，仍须经 Supabase dashboard 人工执行；跨批读取不声称 MVCC snapshot，限制与运维步骤见 `SUPER_CANVAS_D6_OPERATIONS.md`。

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
  - **备注·实现决策(shell 落文字,审核窗可再裁)**:
    - **纯变换落 `src/lib/canvas/`**(`history.ts`=diffDocs/op-log 历史;`group-ops.ts`=成组/解组/复制纯 planner),沿用 rf-adapter.ts 先例(shell 在 lib/canvas 落纯域变换、离线可测、保持 store→lib 单向依赖);消费 D3 `patch.ts` 的 `CanvasOp`/`applyPatch`/`deepEqual` 与 schema 的 `validateCanvasDoc`,不改 data 文件。
    - **undo/redo 只存 forward/inverse 实体 op log**(不存整份 doc snapshot、不 persist);用户文档变更入栈、新变更清 redo、readOnly 拦截、容量上限 100、apply 后 `validateCanvasDoc` 失败原子不动;一段拖动合并成一个 entry;load/reset/recovery/视图开关不进历史。
    - **文本编辑=用户文档变更,进 canvas history(合并会话)**:textarea 聚焦时原生 Ctrl+Z 优先(快捷键守卫不劫持);blur/明确提交后,最近一次「同 node 连续编辑会话」合并为**一个** forward/inverse op entry(非每键入栈),画布 Ctrl+Z 可撤销、Ctrl+Shift+Z 可重做;非法内容原子拒绝且不入栈;任一结构性动作/undo/redo/换 node 编辑前先 flush 当前待提交文本会话,保证顺序正确。
    - **成组数据面权威**:`group.node_ids`↔`node.group_id` 严格双向一致;≥2 个未成组的合法领域节点方可成组(跨组策略=已成组节点被排除,不隐式改动旧组);broken 不入组;RF 组框=纯视图投影 `__group`(不可选/拖/连/删,永不写回 doc)。
    - **快捷键**:S1 `matchCanvasShortcut`(Ctrl+0/?)保持不变(S1 验证器锁定其对 S4 键返 null),S4 键走新增权威匹配器 `canvas-command-shortcuts.ts`;仅画布上下文、非 input/textarea/contenteditable/button/menu/dialog、非 IME 时处理;视图键(缩放)只读可用,文档键只读不动;文档键仅在真正执行时 preventDefault。删除键**只登记 Delete**(不含 Backspace,避免画布上误拦浏览器/系统退格)。
    - **早审硬化(多轮早审后落定,S4 verifier 全覆盖)**:①**锚点最小化**——撤销/重做绝不存 doc 快照;文本会话只锚该 node 原始深拷实体、拖动只锚本次可能移动节点原始深拷实体(`beginPositionDrag(nodeIds)`),commit/end 才生成 node update op;anchor 形状经断言无 CanvasDoc。②**历史载荷深拷稳定**——所有 op 的 value/base/next 建 entry 时 `cloneCanvasEntity`,后续源突变不改旧 history。③**复制彻底解耦**——`planDuplicate` 用 `structuredClone` 深拷 data(改副本嵌套 params 不污染原节点),不可克隆则原子返回 null。④**结构键无控制字**——边去重键 `JSON.stringify([...])`,并加源码卫生断言(新增源无 NUL/控制字)。⑤`pushHistory` limit 负/非有限时 clamp,防 while 死循环。⑥**组框硬化**——RF id 使用 `__group:<groupId>` 并对真实 node id/同批 frame id 做确定性避碰;groups 先按 id 规范排序,保证 remove→undo 后 frame id 不漂移;`projectGroupFrames` 接纯视图 `dimensionsById`(RF measured,优先真实尺寸,缺失回退,防高节点截断)、显式 `zIndex<0` 画在成员背面 + `pointer-events:none`。
    - **早审硬化·续(独立审查第 2 轮)**:⑦**op 类型安全构造**——history 按 entity 字面量具体构造 CanvasOp(每类一函数),不做泛型 `as CanvasOp` 双重盲断言(消 TS2352)。⑧**RF 拖动事件类型**——`OnNodeDrag` 是原生 `MouseEvent|TouchEvent`、`SelectionDragHandler` 是 `ReactMouseEvent`;共享 `beginDrag` 只接纯 modifiers,onNodeDragStart 对 TouchEvent 传 alt/ctrl/meta=false、对原生 MouseEvent 传实际修饰键(消 TS2322)。⑨**键盘可达性移动**——方向键只发 position、不触发 begin/end drag:无 active drag(dragAnchor=null)的位置批次作为**原子历史项**入栈(可撤销、清 redo);拖动逐帧仍不入栈。⑩**拖动中途转只读**——`setReadOnly(true)` 前(readOnly 尚 false)原子 finalize 进行中的拖动(已写位置合并成一个历史项,不丢不悬)+ 提交待提交文本会话。⑪**新 ID 有界碰撞重试**——group/duplicate 的 node/edge 新 id 对当前 doc 同类 id 集合重试(≤8 次),耗尽原子返回 null。
    - **终审硬化(独立审查多轮,401 项 S4 聚焦断言)**:⑫**结构事务屏障**——结构动作在拖动/文本会话后基于 fresh doc 构造;拖动与文本不可重叠,无效补丁零副作用;clone 失败原子回滚。⑬**严格历史数据边界**——仅接受可稳定持久化的 JSON 形状(Date/Map/Set/RegExp/循环/访问器/稀疏数组/非有限数等 fail-closed),合法 CanvasNode 根级 `variant:undefined` 为唯一窄例外;所有比较先安全克隆,重放结果与 history payload 再解耦。⑭**RF 生命周期收口**——领域屏障后的残余 position 帧从领域重同步并清 `dragging`;只读仍接收 `select/dimensions` 视图态;触摸取消仅发 `dragging:false` 也能结束事务。P0 明确 `autoPanOnNodeDrag={false}`,消除 React Flow 触摸取消后不可取消 auto-pan RAF 尾帧,画布 Space/pan 与缩放不受影响。
- **S5 空态 + 底部工具栏 + 整理画布**
  - ✅ 空态四快捷位(P0 =壳:仅建节点引导,真快捷位 P1/P2 按首渲期次点亮,未上线不渲染)
  - ✅ 底部工具栏(添加节点/工作流/素材库/角色库/历史记录/快捷键/教程;壳 P0,入口随所属期点亮)
  - ✅ 整理画布自动布局(Alt+Shift+F,dagre/elk)
- **S6 1366×768 + 媒体降级 + 渲染层 URL 解析**
  - ✅ 1366×768 最小适配(侧栏默认图标态/生成器超视口 dock 底部/胶囊≥5 折叠——P0 先落侧栏与布局骨架)
  - ✅ 媒体降级策略(节点默认 poster 缩略图/选中才挂 `<video>` 且 DOM 断言进 DoD/同屏活跃视频≤6/低 zoom 语义缩放降级色块——P0 落机制,P1 有真媒体后实测)
  - ✅ 渲染层 OSS object key→签名 URL + 内存缓存(#28 渲染半:上传缩略图/媒体展示统一经此;schema 层拒绝非法 URL 入库在 D2)
  - **审核收口(2026-07-13)**:S6 verifier 130/130、S1-S5 回归 53/72/54/401/52、`tsc`、生产构建全绿；URL 解析补 authenticated user object-key 归属闸、可信 OSS host+exact key 绑定、请求去重/TTL/陈旧 inflight 防回写，跨用户 key fail-closed。1366×768 登录态真媒体与性能预算仍由 R1/R2 走查，不以离线断言替代。
- **S7 错误边界 + store 防护 + 文档健康反馈 UI**
  - ✅ 组件级错误边界+「尝试恢复/重新加载画布」按钮
  - ✅ store 层防护+错误边界触发进监控(单画布>1 次/日报警)
  - ✅ 单写者只读横幅 UI(消费 D5 状态)
  - ✅ 文档健康反馈 UI(P0-Q1 已裁):>512KB 软告警横幅「画布偏大建议拆分」(#29 UI 半;不拒存,阈值 D1)、>2MB 硬拒 toast(#47 UI 半;拒存在 D3 返 400,阈值 D1)
  - **审核收口(2026-07-13)**:S7 verifier 220/220、D1-D6/S1-S6 全回归、48 项 P0 精确对账、`tsc`、生产构建 140/140 全绿。运行时以 requested/session/hydrated/writer 身份一致性开放交互；写者生命周期、迟到回调、上传异步任务与错误恢复全部 fail-closed。store hydration 使用 descriptor-safe 原子替换，broken edge 必须显式恢复；错误监控只发结构化匿名字段且队列/LRU 有界；512KB 告警、2MB 本地/服务端拒存、D5 只读横幅和根级错误边界已统一接线。
- **S8 历史资产面板 + omnibox 确认**
  - ✅ 历史资产面板 UI(三 tab 图/视频/音频+计数+日期分组+从中选素材建节点;消费 D6)
  - ✅ omnibox 长期保留轻量快捷入口(零改动,验证不受画布影响即可)
  - **审核收口(2026-07-13)**:S8 verifier 255/255、D1-D6 81/119/153/96/208/162、S1-S7 53/72/54/401/52/138/220、48 项 P0 精确对账、`tsc`、生产构建 140/140 全绿。面板以 D6 严格响应解析、游标/请求代次/300 项与 10 页上限、关闭与身份切换清理、S6 owner-bound URL 缓存和最新只读态复检收口；图片/视频可建节点且只持久化 object key，音频按总纲已裁的独立音频节点决策只浏览。omnibox 不改且保持与 S8 解耦；登录态真媒体、1366×768 截图与性能实测归 R1/R2。

### review 窗口(worktree: studio-content-ux-redesign-70bfa0,分支 claude/studio-content-ux-redesign-70bfa0 = 集成分支)
**负责**:合流两个写入分支、跑验收、对抗审查、维护本看板与 tracker。**合流只发生在本窗口。**

- **R1 验收脚本 + 性能实测**(`.temp/canvas-p0-verify.mjs` 惯例)
  - ✅ P0 验收模板 7 项:空态快捷位可点(壳态=建节点引导可点)/建节点编辑 5s 后刷新零丢失/断网 30s 恢复自动补存/双标签第二个只读+横幅/塞坏 node json 画布照开+占位卡/100 节点保存<1s/Ctrl+Z
  - ✅ 性能预算数值验收:200 节点 pan/zoom≥50fps(中端机)/冷加载<3s/100 节点+30 视频 poster 内存<800MB(P0 用 poster 占位图压测)/100 节点保存<1s
  - ✅ 每期验收脚本惯例(工程纪律,P0 起)
  - **认领与范围扩展(2026-08-08@canvas-p1-acceptance)**:P0 之后 P1 工程已全部上线(见 EXECUTION_TRACKER 当前状态),故本轮 R1 一次覆盖 P0+P1——①`scripts/verify-canvas-*.mjs` 全部 31 个离线 verifier 全量跑;②`npx tsc --noEmit` + `npm run build`;③1366×768 本地生产构建性能实测(上列四预算);结果回填本节,资金/登录态实测归 R2 真人走查。
  - **✅ R1 完成(2026-08-08)**:
    - **脚本 30/31 绿 + tsc 绿 + 生产构建绿,零代码回归**。blue-green 强制 Node 20(与生产版本对齐的防漂移闸),已用便携 Node 20.20.2 复跑 202 断言全绿;p1-fixture 需本机 127.0.0.1:54329 的 PostgreSQL 17.10 fixture 集群(本机无 PG,fail-closed 属预期),裁决缓到 P2 开工前随新迁移一并搭。
    - **换行根因修复**:`core.autocrlf=true` 的全新 Windows 检出把仓库 LF 平铺成 CRLF,曾致 5 脚本假红(冻结 SHA-256 拒绝/含 `\n` needle 断言失配/预检 env 模板变形);已实证仓库 blob 全程正确(哈希与冻结值逐字符一致),`4aaeec4` 补全 `.gitattributes`(5 个冻结迁移入 `-text` 字节锁 + scripts 顶层 mjs 与两处 `\n` 敏感源文件强制 LF)根治,后续任何检出不再复发。
    - **性能四预算全过**(方法:本地生产构建 `next start`,Chrome 实测视口 2048×983 CSS px——大于 1366×768 规格,同屏内容更多故更严苛;本地服务器直连远程 Supabase,writer 心跳实测 481-907ms 即纯 RTT 基线,以下绝对值均背着该基线,偏保守):① 200 节点+100 边连续缩放 pan/zoom **229fps**(预算≥50,4×+ 余量,缩放变换经 viewport transform 实证生效)② 冷加载 **FCP 2168ms**、doc 数据 1990ms 就绪(预算<3s)③ JS 堆 **18-24MB**(预算<800MB;真 poster 因上传归属闸不可伪造,以空壳节点实测,真媒体内存随 R2 生产走查复核)④ **100 节点自动保存 PATCH 650ms**(预算<1s;200 节点档 1044ms 含更重 RTT;100/200 节点整档 POST 929/1129ms)。
    - **实弹安全副产物**:doc 写入的媒体治理双闸 fail-closed 实证——伪造 object key 422「不属于当前账号的媒体对象」、账号名下但未经画布上传 finalize 登记的 key 422「尚未完成服务端确认的上传对象」。另录:后台(hidden)标签页下节点尺寸测量与边渲染按浏览器标准行为暂停、置前台即自愈,非缺陷。
    - **零残留**:测试用 2 画布已经 `DELETE /api/canvas/[id]/metadata` 删除,测试账号画布列表归零。
    - **待办移交**:R2 真人走查(生产 toryxai.com,白名单账号,资金五项+旅程 A)待用户执行。
- **R2 合流 + 对抗审查 + 真人走查**
  - 写入分支转「待审」→ 本窗口 merge → `npx tsc --noEmit` + `npm run build` → 大改动跑对抗审查 workflow 修实锤 → 更新看板状态与 tracker「当前状态」
  - P0 收口:真人 1366×768 全流程走查,卡点(停留>60s 无操作)>2 不算完成
  - **R2 生产走查进展(2026-08-08,生产 toryxai.com,白名单账号,真实扣费)**:

    | 项 | 结果 | 证据 |
    |---|---|---|
    | 灰度白名单 / 价目表 / 非白名单模型拦截 / 伪造金额 / 查询参数白名单 | ✅ | 上一轮已过 |
    | 资金① 狂点防重复 | ✅ | 上一轮:点「开始生成」×5→0 请求;「确认生成」×5→1 请求扣 1 次 |
    | **资金② 预估=实扣** | ✅ | 图片切 2K:面板「预计 10 积分」= `generations.credit_cost=10` = 账本 `-10` = 余额 18939→18929,三者相等 |
    | **资金⑤ 当日对账差异 0** | ✅ | 4 笔生成 ↔ 4 条账本 1:1;链式连续 18949→18924 无断点;每条 `balance_before+amount=balance_after`;`operation_anchor` 全唯一;B0−终余额=25=Σcost−Σrefunded |
    | **双标签只读横幅** | ✅ | tab B 出现「此画布已在另一个标签页编辑,当前标签页保持只读。」逐字符匹配 |
    | **关标签对账恢复 + 写者租约接管** | ✅ | 提交后硬关写者标签页,任务在无前端期间自行收敛 `completed` 且产出真实 `result_url`;tab B 只读横幅消失、工具栏恢复,接管写者租约 |
    | **删除 running 节点** | ✅ | 未决节点删除按钮 `disabled=true`、title「上游状态待核对,为防丢失潜在产物暂不可删除」;同画布空闲视频节点删除按钮 `disabled=false`,形成对照 |
    | **视频生成** | ❌ **厂商无通道,见 R2-Q1** | grok 两次独立提交(图生/文生)全部落 unknown |
    | 资金③ 退款恰好一条 | ⚠️ 未能触发 | 画布生产至今**零失败**(全部 4 笔:2 completed + 2 unknown);unknown 按设计不算失败、不退款,故退款路径在生产从未被走过 |
    | 资金④ 双标签不双扣 | ⚠️ 间接证据充分,未做并发直击 | 三重结构性证据:①每笔生成恰好一条 consume 且 `operation_anchor` 唯一(唯一索引即防双扣栅栏)②第二标签页强制只读,结构上无法并发提交 ③UI 实测幂等栅栏文案「系统将复用任务 …,不会创建新的计费任务」。并发 POST 直击需程序化触发扣费端点,与「不得程序化触发扣费」的执行约束冲突,未做 |

    - **模型能力矩阵实测(定性总纲 §2.4 待定三项)**:仅开 grok 时下拉为——模型[Grok]、模式[文生视频/图生视频]、时长[**10/15 秒**]、质量[标准]、画幅[9:16/16:9];**换成 happyhorse 后时长自动变为 [5/12 秒]**(2026-08-08 发版后实测)。同一 UI 随模型换出不同时长 = 能力矩阵在正确工作,**模式 2 项/画幅 2 项/质量 1 项是能力边界的正确投影,非功能缺失**,§2.4 三个「待定」项就此定性关闭。

    - **⚠️ 按走查卡逐项对照后仍缺的项(2026-08-08,勿再当成"已过")**:走查卡「主线旅程 A 七步 + 资金五项」与上表对照,以下**尚未通过**:

      | 走查卡项 | 状态 | 说明 |
      |---|---|---|
      | 主线③ 图片连线视频 → 上游产物自动进下游引用区(带缩略图) | 🟡 部分 | 连线成立且模式变为「图生视频 **(1)**」证明上游产物已被计入引用;但**未目视确认引用区缩略图**,需补看 |
      | 主线④ 图生视频 grok → queued→running→done | ❌ 不可测 | 见 R2-Q1,厂商无通道。**发版后名单已换 happyhorse,须用 happyhorse 重跑本步**(5 秒 450 积分,需用户先批预算) |
      | 主线⑤ 成片节点内预览/下载可用 | ❌ 未做 | 依赖④。「去发布」按铁律禁止 AI 点 |
      | 主线⑥ 回图片节点重新生成 → 下游视频节点出「输入已更新」角标 | ❌ 未做 | 与总纲 §2.4 记的「dirty 角标缺失」同一项,本轮未验 |
      | 主线⑦ 商品节点传图 → 卖点卡 → 接视频节点出带货视频 | ❌ 未做 | **商品节点整条链路本轮完全未碰**,是最大的未覆盖面 |
      | 资金 生成中删节点 → **三选一弹窗** → 选「取消并退款」→ 恰好一条退款 | ❌ **功能缺失(见 R2-Q3)** | 上表「删除 running 节点 ✅」测的是**禁用态+title**,不是走查卡要求的三选一弹窗;二者不是一回事,勿混记 |
      | 资金 提交**视频**后关标签页 | 🟡 等价替代 | 实测是提交**图片**后硬关标签页并自愈收敛;机制同源(对账车道与租约与类型无关),但严格意义未用视频复现 |

    - **✅ R2 第二轮补跑(2026-08-08 晚,生产 toryxai.com,用户批预算 4000 积分,实扣 450)**:

      画布 `047fb5dd-215e-4a56-8b0b-e9f553608859`,复用其中已完成的图片 `bebca173`(柴犬/樱花)作上游。

      | 走查卡项 | 结果 | 证据 |
      |---|---|---|
      | 主线③ 连线 → 上游进引用(计数) | ✅ | 从图片节点右 handle 拖到视频节点左 handle,`edge_of8jqsSv1nnG` 落库(rev 5→6);模式下拉逐字符读出「图生视频 **(1)**」 |
      | **主线④ 图生视频 happyhorse → queued→running→done** | ✅ **首次成功** | `a40b3114-9f2e-478c-854a-faa4d4db7a96`:`pending → processing → completed`(约 2 分钟);`provider_submission_state=bound`、`task_id=7c869209-346e-42aa-bbf7-c46adfdc0342`、`credit_cost=450`、`credits_refunded=0`。**这是画布视频链路自上线以来第一次真正接单并出片**——R2-Q1 的 happyhorse 裁决就此闭环验证 |
      | 资金② 预估=实扣(视频档) | ✅ | 面板「预计 450 积分 · 余额 18914」→ 确认弹窗逐字符复述 450/18914 → 实扣后余额 **18464**(−450),与 `credit_cost` 及 catalog 标价三者相等 |
      | 拦截式确认 | ✅ | 点「开始生成」弹出「确认本次积分消耗 / 本次预计消耗 450 积分,当前余额 18914。任务提交后只有明确失败才会自动退款。」 |
      | **主线⑤ 成片节点内预览/下载** | ✅ | 终态后节点内挂真实 `<video data-media-state="video" controls>` 且 `src` 已解析;出现「下载」按钮;`/api/canvas/generations/<id>/download` 以重定向响应(fetch `redirect:'manual'` 得 `type=opaqueredirect`,与 verifier 断言的 307 一致)。**「去发布」按钮存在但按铁律未点** |
      | AIGC 标注提示 | ✅ | 终态后节点内出现「AI 生成内容 · 对外发布时请遵循平台的 AIGC 标注规则。」 |
      | 状态机删除闸的完整对照 | ✅ | running 期间 `删除视频节点 disabled=true` + title「任务生成中,完成或明确失败后才能删除节点」;**终态后同一按钮 `disabled=false`**;同期图片节点恒 `disabled=false`。三态对照成立(这也正是 R2-Q3 的缺口现场:只有禁用+title,没有三选一) |
      | **#189 面板超视口** | ❌ **生产实锤复现** | 2048×983 视口下选中视频节点,生成面板底部的「开始生成」按钮**落在视口外**,`scroll_to` 无效(React Flow 画布不滚动),只能靠缩放+手动平移画布才够得着。与 R2-Q4 判定的「`resolveGenerationPanelDock` 零引用」完全吻合 |
      | **主线⑦ 商品节点** | ❌ **确证为功能缺失,不是测试缺口** | 生产新建商品节点后枚举其渲染面:整个节点只有 `button[aria-label=删除商品节点]` + `textarea[aria-label=商品简报]` 两个控件,`input[type=file]` **0 个**、`img` **0 个**。即**没有上传图入口、没有卖点卡产物**,走查卡要求的「传图 → 卖点卡」两段在生产上不存在。可走通的只有「商品文本简报 → 作为上下文注入下游生成」 |
      | 主线⑥ dirty 角标 / 旅程 B | ❌ 仍未做 | ⑥ 已由 R2-Q4 判为功能不存在(不是测试项);**旅程 B(剧情创作起点)本轮仍一步未走**,「上游简报注入下游提示词」的端到端实测亦未完成 |

    - **🚀 2026-08-08 二次发版 `d16620f`(端口 3013)与发版后实测**:

      | 项 | 结果 |
      |---|---|
      | 蓝绿发布 | ✅ `DEPLOY_RC=0`;**`BUILD_ID` 与 release commit 严格相等**(上次踩的坑这次躲开);两条 grok WARN 为预期;回滚包 `canvas-rollback-20260808T152332Z-port-3012-934510`;旧版 abc29ac/3012 仍在线待回滚 |
      | 发版后回归 | ✅ nginx→3013、站点 200、`/canvas` 未登录 307(apex 与 www)、候选端口直连 200、进程 0 重启、磁盘余 11G |
      | **#189 dock 宿主上线** | ✅ 生产 DOM 有 `[data-canvas-generation-dock]`,空态高度 0、底边 y=919=983−64,**正好是 `bottom-16` 的让位高度** |
      | **#180/#181 参数胶囊折叠** | ✅ 视频节点 5 个参数**折成 4 个可见 + 「更多参数（1）」**(`aria-expanded=false`);触发切换后变 5 个 select + 「收起参数」+ `aria-expanded=true` 且稳定不回弹。画幅是被收进「更多」的那一项 |
      | 视频成片 | ✅ 节点内 `<video>` 可播(0:00/0:05),下载 / 去发布 / AIGC 标注文案齐(**去发布未点**) |
      | **发版副作用(新发现,需写进发版流程)** | ⚠️ 蓝绿切流(3012→3013)会打断写者租约心跳,正在编辑的标签页**立刻掉进「写者心跳异常,为保护画布已切换为只读」**。这是单写者锁 fail-closed 的正确行为,但意味着**发版后灰度用户必须刷新页面才能继续编辑**——发版公告里应写明 |

      ⏳ **发版后仍未验的两项(非功能问题,是环境限制)**:①**三选一弹窗目视** —— 需要一个 running 节点,而走查标签页当时被另一个会话持有写者租约(`writer_HnFAicb3Sd3XymGt` 心跳活跃)锁成只读,无法发起生成;②**1366×768 全流程** —— Chrome 窗口处于最大化态,`resize_window`/`chrome.windows.update` 改不动(`outerWidth/outerHeight` 报 0),需人工还原窗口后再跑。**注意别用 `zoom` 动作代替**,它会留下改不回来的 CDP 视口覆盖。

    - **✅ 资金⑤ 当日对账重跑(含本轮 450 视频档)——差异 0**:7 笔 consume ↔ 7 笔 generation 严格 1:1;链式 `18949→18944→18939→18929→18924→18919→18914→18464` 每一笔 `balance_before` 等于上一笔 `balance_after`,**无断点**;每条 `balance_before+amount=balance_after` 逐条成立;`operation_anchor` 全唯一且格式统一为 `canvas-consume:<generation_id>`;`pricing_version` 全为 `canvas-generation-2026-07-29-v1`(单一价源);Σcost=485 = B0−终余额=18949−18464=485;**零 refund 条目**(与「画布至今零失败」互证)。

    - **🔴 更正:旅程 B 不是 R2 的欠账,此前 HANDOFF 记错了**。总纲 §二原文是「**旅程 B·剧情创作(P2 可走通,≤9 步)**:一句话/剧本节点 → 脚本节点(9 维度分镜表)→ 资产装配 → 批量生分镜图 → 批量生视频 → 合成 → 下载」——整条链依赖脚本节点、资产装配、批量、合成,**全是 P2/P3 功能**。代码侧亦印证:`node-type-meta.tsx` 的 `CREATABLE_NODE_TYPES` **刻意排除 script 与 compose**,注释写明「intentionally not offered as new-node actions until their real execution paths exist」;生产节点内文案是「脚本/合成工作流暂未开放,旧节点仅供查看」。CHECKLIST #262 的期次「P1 **起**」是指这条**走查纪律**从 P1 开始沿用,不是要求 P1 走通旅程 B。**故 R2 不欠旅程 B,它是 P2 的验收项。**

    - **✅ 1366×768 全流程走查已完成(2026-08-09,`d16620f`/3013)——R2 最后一项实测收口**

      实测视口 CSS **1352×586**(DPR 1.25;窗口 1366×768 减去浏览器 chrome,**比满屏 1366×768 更严苛**,垂直只有 586)。

      | 检查项 | 结果 | 数据 |
      |---|---|---|
      | 侧栏图标态 | ✅ | 四个建节点按钮均为 32px 图标,无文字 |
      | 小地图默认收起 | ✅ | `shouldExpandMinimap(1352)=false`,小地图面板不渲染 |
      | **生成面板 dock 底部** | ✅ | `data-generation-panel-dock="bottom"`,面板确实 portal 进宿主(`host.contains(panel)=true`),表头显示「图片节点 · 生成参数（窗口较窄，面板已停靠底部）」 |
      | **停靠位不压底部工具条** | ✅ | 宿主 `bottom:64px`,可见区 **227–522**;工具条 top **536** → **留 14px 间隙**。截图实景确认工具条七个按钮完整可见 |
      | 图片节点:生成按钮可达 | ✅ | 面板内容 310px,按钮 top 438 落在可见区内,**无需滚动** |
      | 视频节点:生成按钮可达 | 🟡 **需在停靠位内滚动一次** | 面板内容 389px > 停靠位可见高 294px;未滚动时按钮 top 517 只露 5px,`host.scrollTop=95`(最大值)后按钮 top 422 完全可见 |
      | 参数胶囊折叠 | ✅ | 视频 4 个 select + 「更多参数（1）」;图片 2 个参数正确不折叠 |
      | 卡点计数 | **0** | 无「停留>60s 无操作」的卡点;上面那条是一次滚动的摩擦,不是阻断。按 P0 收口条款(卡点>2 不算完成)**判定通过** |

      **⚠️ 遗留的一处设计粗糙(建议下一批修,非阻断)**:停靠位的 `max-h-[55%]` 复用了 `GENERATION_PANEL_MAX_HEIGHT_RATIO`。但那个常量的本意是**「inline 判定阈值」**——面板高过视口 55% 就该 dock;把它同时当作**停靠位自身的最大高度**是语义误用:停靠位恰恰是为「装不下的面板」准备的,不该用同一个更紧的比例去限制它。在 586px 视口下它算出 294px,比视频面板的 389px 还矮,于是逼出一次滚动。建议改为更宽松的独立常量(例如 `calc(100% - 8rem)`,即只让开顶栏与底部工具条),并给 `canvas-responsive.ts` 新增 `GENERATION_DOCK_MAX_HEIGHT_RATIO` 与配套单测,别继续复用 inline 阈值。

    - **(历史)R2 曾唯一未做的实测项:1366×768 全流程走查**。P0 收口条款是「真人 1366×768 全流程走查,卡点(停留>60s 无操作)>2 不算完成」,但 **R1 性能实测与 R2 两轮走查全部跑在 2048×983**,该分辨率一次都没跑过。已用浏览器把窗口压到 CSS `1352×586` 确认落在 `isCompactViewport`(≤1366)区间;但**这一遍应放到本次改动发版之后再跑** —— 因为 `resolveGenerationPanelDock` 恰好只在 ≤1366 时才判 dock 底部,在 `abc29ac` 上跑等于测一个即将被替换的 UI,发版后必须重跑。(注:窗口一经 reload 会被重新最大化,`resize_window` 之后不再生效,需在 reload 后立即改尺寸;**不要用 `zoom` 动作**,它会留下改不回来的 CDP 视口覆盖。)

    - **R2 里结构性做不完、需用户拍板如何结案的两项**:①**资金③ 退款恰好一条** —— 用户已裁决不做「取消并退款」,生产又至今零失败,故**没有任何触发路径**;建议以库级 `canvas-refund:<id>` 唯一锚点 + 实弹脚本 R44/R42 作为等价验收并结案。②**资金④ 并发双扣直击** —— 需程序化触发扣费端点,与执行约束冲突;已有三重结构性证据(唯一锚点索引、第二标签强制只读、幂等栅栏 UI 文案),建议同样以等价验收结案。

      > 走查副产物(残留物,见 §五):在 `047fb5dd` 里误建了 **2 个空商品节点 + 1 个空图片节点**(均在 x=992,y=688 处堆叠,`node_v3hNjrCWBTz3` / `node_KSK8Zcdoj9f2` / `node_QoEyEO20T-Mn`)。成因是侧栏「拉线建节点」与底部「添加节点」菜单的重复触发;无产物、未扣费,可随手清理。

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

- **R2-Q1 · 🔴 生产缺陷:画布视频生成自上线起 100% 不可用,且每次尝试永久吞掉积分**(2026-08-08 实测,待修)
  - **现象**:grok 两次独立提交(图生视频 + 文生视频)全部 `status=pending / provider_submission_state=unknown / task_id=null`,`last_reconcile_error_code=video_submission_outcome_unknown`,各扣 5 积分,不出片、不退款。
  - **根因(直接打厂商接口复现两次)**:画布 grok 走 `platform-client` → `VIDEO_PLATFORM_BASE_URL`,生产值为 `https://api.hellobabygo.com`;该站对 `grok-imagine-1.0-video` 返回 `503 model_not_found: No available channel for model grok-imagine-1.0-video under group grok1.6`。**不是画布代码缺陷,是厂商侧没有该模型通道**。
  - **不是上轮图片修复引入的**:`.env.local.bak-imgfix-20260808` 证明 `VIDEO_PLATFORM_BASE_URL` 改动前**已经是** hellobabygo(那次只改了 `VIDEO_PLATFORM_IMAGE_BASE_URL`)。与「生产总共 4 笔画布生成、全是图片、零视频成功」互证:视频链路从未通过。
  - **为什么钱回不来**:`claim_canvas_generation_reconciliation_v1` 写死 `AND g.provider_submission_state <> 'unknown'`(注释亦言明"Excludes every unknown row"),unknown 视频行**不被任何对账车道认领**;`fail_canvas_generation_v1` 亦显式禁止对 unknown 行失败/退款("Uncertainty is never resolved by failing/refunding")。唯一出口是双人复核的 `resolve_canvas_video_unknown_v1`,须人工执行。
  - **✅ 已裁决(2026-08-08,用户)**:画布视频名单**只留 happyhorse**(经 DashScope 探测确认可用);**grok 的适配器/目录/路由/价目一律原样保留不删**,等更换 API 供应商后再放回名单。落地方式=生产 `.env.local` 的 `CANVAS_VIDEO_MODELS` 与 `NEXT_PUBLIC_CANVAS_VIDEO_MODELS` 改为 `happyhorse`(后者构建期烘焙,须随发版一起改),**零代码改动**。
  - ⚠️ happyhorse 5 秒 450 积分 / 12 秒 1080 积分,是 grok 标价的 90 倍;确认弹窗会如实显示,但灰度扩人前需留意。

- **R2-Q2 · 🔴 P1 缺口:图片侧 unknown 行会被停放等人工裁决,可图片侧根本没有人工裁决工具**(2026-08-08 实测,待裁决)
  - **现象**:生产存在一笔 `9848fcb4-…` 图片生成,`pending/unknown/task_id=null`、`last_reconcile_error_code=direct_image_object_not_found`、`next_reconcile_at=NULL`、扣 5 未退,任何机制都动不了它。
  - **机制**:`release_canvas_gpt_image_direct_media_recovery_v1` 在 `attempt_count>=20` 时以 `p_manual_audit=true` 调用,把 `next_reconcile_at` 置 NULL —— 设计上就是**停放等人工裁决**。但唯一的人工裁决 RPC `resolve_canvas_video_unknown_v1` 硬性要求 `v_gen.type = 'video'`,图片行必然 `check_violation`,端点返回 409 `RESOLUTION_REJECTED`。
  - **即:图片 unknown 是一条没有出口的路**。这不是配置问题,是恢复面缺一块。
  - **✅ 已裁决并已落盘(2026-08-08 用户批准"我认为需要")**:迁移 `supabase/migrations/20260808_canvas_image_unknown_resolution.sql` 已写好——只把类型谓词 `v_gen.type <> 'video'` 改成 `NOT IN ('video','image')` 并同步异常文案,其余每一道栅栏原样不动。保留 `..._video_...` 函数名是刻意的(端点以字面量调用该名,就地 `CREATE OR REPLACE` 同签名=零应用改动、零 GRANT 变更、最小爆炸半径),命名债写在迁移头部。
  - **本地校验方式**:本机无 PG,改用**等价性证明**——把新文件函数体反向还原本次三处改动后与生产在跑的原函数**逐字节一致**(净改动 2 行代码 + 8 行注释);另过美元引用配对、括号平衡、尾部四段齐备。原函数正在生产运行,故新文件语法由构造保证。
  - ⏳ **待用户经 Supabase dashboard 执行**(铁律 4:合 PR ≠ 功能生效)。执行后那笔图片行即可用 `scripts/resolve-canvas-unknown.mjs` 走 `verified_no_task_refund` 解开。
  - **当前处置(2026-08-08 用户裁决)**:**三笔卡住的积分(2 笔视频 + 1 笔图片,共 15 分)一律先不动**,只留书面结论与证据,待用户另行处置。

- **R2-Q4 · 🔴 P1 生成器面板比 CHECKLIST 承诺的薄一大截:61 项里约 23 项「标了做但没实现」**(2026-08-08 全量复核,待裁决)
  - **触发**:R2-Q3 暴露出「CHECKLIST 标做 ≠ 已实现」,用户要求回头把 P1 的 61 项核一遍。方法=①`generation-controls.tsx`(775 行,画布唯一生成面板)渲染的 label/选项全量枚举 ②对每个功能点的特征串全仓 grep ③与生产 UI 实测互证。
  - **面板实际参数面(权威)**:只有 `模型 / 模式 / 时长 / 质量 / 清晰度 / 画幅` 六项;画幅选项最多 6 种(自动、16:9、4:3、1:1、3:4、9:16);清晰度 1k/2k/4k;质量 标准/高清。
  - **确认缺失(约 23 项,按 CHECKLIST 行序)**:

    | 功能点 | 判据 |
    |---|---|
    | ①「输入已更新」dirty 角标 | 全仓 0 命中 |
    | ② 连线后上游产物进引用区(缩略图带序号) | 计数在(模式显示「图生视频 (1)」),但**缩略图与序号**未见,"引用区"全仓 0 |
    | ⑩ 图片 chip:+参考 | 全仓 0 |
    | ⑪ 图片画质(低/标准/高) | 面板无独立「画质」,只有清晰度与视频侧「质量」 |
    | ⑬ 图片比例 **13 种** | 面板最多 **6 种** |
    | ⑭ 图片生成数量 1/2/4 | 面板无此控件 |
    | ⑮ 图片模型清单(LibTV 14 个对照) | **图片节点根本没有模型选择器**(只有视频有) |
    | ⑯⑰⑱ 图片工具条 高清/裁剪/整图重生成 | 无工具条;「高清」只是质量值;裁剪/整图重生成全仓 0 |
    | ⑲ 图片产物全屏预览 | 下载有,全屏 0 |
    | ㉑ 图片空态快捷(图生图/图片高清) | 空态只有 4 个建节点按钮 |
    | ㉒ 视频**五模式** | 只有文生/图生 2 个;「全能参考」「图片参考」全仓 0 命中,「首尾帧」只在 veo 旧路由、画布面板没有 |
    | ㉔ 视频比例 **7 种** | 最多 6 种,**缺 21:9** |
    | ㉕ 视频清晰度 480P/720P/1080P/4K | 面板无此项 |
    | ㉖ 时长**滑杆** | 实现为下拉 select,"滑杆"全仓 0 |
    | ㉗ 视频生成数量 1/2 | 面板无此控件 |
    | ㉙ 视频空态快捷(首帧/首尾帧生成视频) | 全仓 0 |
    | ㉝ 参数胶囊 + ㉞ ≥5 折叠「更多」 | **机制落了但没接线**:`canvas-responsive.ts` 有 `planCapsuleCollapse` 与常量,但**该函数在定义文件之外零引用**;面板渲染的是普通 label+select |
    | ㉟ @引用素材(@节点/@历史) | 全仓 0 |
    | ㊴ 灰置控件「如何解锁」指引 | 全仓 0 |
    | ㊵ Ctrl+Enter 发送 | 全仓 0(同一行的「防重复提交」已过 ✅,该行是半通过) |
    | ㊷ 面板超视口自动 dock 底部 | **机制落了但没接线**:`resolveGenerationPanelDock` 同样零引用。与实测吻合——面板超出视口只能手动平移画布 |
    | ㊺ 交互式教程 | `canvas-chrome-policy.ts:49` 是 `{ id:"tutorial", enabled:false }`,按钮位在、本体无 |
    | ㊶(#251) 删除 running 三选一 | 见 R2-Q3 |

  - **连带无法验收的项**:#260「注入上游失败→恰好一条 refund」(依赖取消入口,见 R2-Q3)、#55「grant 首个用例=教程完成奖励」(依赖教程)、#61「真人双旅程走查」(旅程 B 完全未做)。
  - **已确认做到的**(不在上表):文生图、清晰度 1K/2K/4K、文生/图生两模式、面板挂节点下方、视频模型选择器、**能力矩阵驱动参数渲染**(换 happyhorse 时长自动从 10/15 变 5/12 秒,实证有效)、积分预估、费用汇总条、拦截式确认、防重复提交、直发 TikTok 按钮、AIGC 标注提示、计费五件套与零价目铁律(R1 verifier 覆盖)、预估=实扣与当日对账、节点状态机、对账恢复、双标签不双跑。
  - ⚠️ **判据强度说明**:上表基于「面板渲染面全量枚举 + 特征串全仓 grep + 生产 UI 实测」三重交叉。grep=0 理论上可能因换词实现而误判,但面板只渲染六个参数这一条是**直接观测**,与 grep 结论一致。个别项(⑧垫图/图生图、⑨指令式整图编辑、⑳nine_grid 透传、③统一对账合约、④节点四件套、⑤产物动作、⑥商品节点轻量版)**本轮未直接核**,标为未核而非通过。

  ### R2-Q4 复核第二轮(2026-08-08 晚):把 61 项全部重核一遍,含上一轮未核的 7 项

  方法与上一轮同(渲染面枚举 + 至少 4 个措辞的全仓 grep + 生产 UI 实测),但**加了一道对抗反驳**:每个被判缺失/部分的项另派一名复核者,任务是**尽力推翻**(换词/换位置/数据驱动/条件渲染四条路径),推不翻才算数。

  **口径变化(重要)**:改用四档 `implemented / partial / missing`,不再只分「做到/没做到」。**60 项**(第 61 项 #262「真人双旅程走查」是流程项,零代码,不参与实现面统计):

  | 分组 | 数量 |
  |---|---|
  | implemented | **15** |
  | partial | **30** |
  | missing | **15** |

  **被推翻、应记为已实现的 3 项**(上一轮判错):
  - **#71 图片指令式整图编辑** —— 总纲 §29/§56 本就把它与垫图写成同一件事,复用件列写「同上」;`image→image 连边 → /v1/images/edits` multipart 链路全通。遗留问题是与 #70 重复记账 + 零可发现性,不是没实现。
  - **#224 billing_mode 双模式声明** —— 规格的 `free` ≡ 代码里的 `free_quota`(amount=0 流水 + 每日配额闸 + 429 fail-fast 三特征齐备);只剩文档-代码命名漂移。
  - **#260 注入上游失败→failed+恰好一条 refund** —— `fail_canvas_generation_v1` 同事务写 `status='failed'` + `canvas-refund:<id>` 唯一锚点退款,有实弹脚本盯着。上一轮把「扣费前拒单(本就应退 0 条)」与「unknown 不明态(ADR 明令禁止自动退款)」误算进了本行。

  **⚠️ 反过来,上一轮列在「已确认做到」里的两项其实是 partial,须更正**:
  - **#184 费用汇总条** —— 有总额+余额,但**无明细、且无明细数据源**(定价模块只算单一 cost),也不是规格要求的「发送钮上方独立条」。
  - **#185 拦截式确认** —— **实现方向与规格相反**:代码是 `needsConfirmation: cost > 0`(**每次付费都弹**),规格是「仅限余额<预估×1.2 或单次>5000⚡」;`1.2`/`5000` 全仓无算式。且与 #184「替代弹窗」的设计意图冲突。这是设计取舍问题,不是漏做。
  - 另:#253 对账恢复的后半「超时判死→幂等退款」只覆盖**从未提交给厂商**的行(10 分钟 sweep);已 bound 到厂商 task 的行**没有任何时长判死**。

  **两个跨切片的结构性问题**(影响排期,不是单项):
  1. **节点级工具条整体缺席** —— #81/#82/#83/#85 四项都以「图片工具条」为前提,而全仓 `NodeToolbar` 0 命中,节点头部只有一个删除按钮。这四项必须先建承载面,应打包做。
  2. **CHECKLIST 三处复用件备注指错对象,会持续误导后续窗口**:
     - #69/#70/#71/#85 写「复用 `/api/generate/image`」——**画布对该路由引用数 0**(画布只调 6 组 `/api/canvas/*`),route.ts 里现成的 `nine_grid`/`upscale` 分支画布**根本够不着**,故 #85「纯 UI 露出 S」的工作量估计是错的;
     - #72/#94 写「复用 `reference-cache.ts`」——那是**商品链接 URL 抓取缓存**,与参考图无关;
     - #183/#225 写「新建 `src/lib/credits/pricing.ts`」——实际角色物是 `src/lib/canvas/generation-pricing.ts`,路径不同但实质满足。

  - **✅ 路线裁决(2026-08-08,用户把选择权交给 AI:「你自己评估一下哪种方案更好,你来决定」)**:走**混合路线** —— 便宜活按 CHECKLIST 补齐;工作量大且**外部条件不具备**的逐项改判「延 P2」;涉及资金/设计取舍的**不自作主张**,留给用户裁决。理由:全量补齐会把 P1 验收无限期拖住,全量改判则把已承诺的功能悄悄抹掉,两者都不可接受。

  - **本轮已补齐(代码已落,闸门全绿)**:
    | 项 | 落点 |
    |---|---|
    | #181 胶囊≥5 折叠「更多」 | 新增 `ParamCapsules`,消费既有纯函数 `planCapsuleCollapse`;视频侧恰 5 个参数踩阈值,现折叠为 4 + 「更多参数(1)」 |
    | #180 参数胶囊 | 同上(#181 的承载面) |
    | #188 Ctrl+Enter 发送 | textarea `onKeyDown`,走与按钮同一个 `onGenerate`,防重复/报价未就绪/超阈值确认三道闸一并复用 |
    | #189 面板超视口 dock 底部 | 新增 `canvas-dock-context.tsx` + 画布壳底部停靠位,面板按 `resolveGenerationPanelDock` 判定 portal 过去。**用 portal 而非 `position:fixed`,因为 React Flow 的 transform 祖先会成为 fixed 的包含块**;高度只在 inline 形态下测量,避免 inline↔bottom 抖动环 |
    | #251 删除 running 三选一 | 见 R2-Q3 |

  - **本轮撤回的一个错误改动(记下来防复发)**:曾把图片画幅从 6 项扩到 11 项(服务端 zod 与客户端类型确实都接受 11 项)。**这是错的**——上游 `getVideoPlatformImageSize` 的 `sizeMap` 每档只有 6 个 key,而其末行是 `sizeMap[r]?.[ratio] || sizeMap[r]?.auto || null`,多出来的 5 项(3:2/2:3/5:4/4:5/21:9)**不报错,而是静默回落成 auto 尺寸**:用户选了 21:9、按全价扣分、拿回自动画幅的图。已撤回并把这段约束写进 `IMAGE_ASPECTS` 的注释。要真补 #78,必须先给 sizeMap 补像素尺寸并确认 gpt-image-2 接受,而那是 quick-gen/image-factory 共用链路,不属画布单方改动。

  - **建议改判「延 P2」的 8 项(外部条件不具备,非工时问题)**:#93 视频五模式(catalog 七模型与 zod 三层都只有 2 个模式,`referenceRoles` 的 first/last_frame 是零引用死字段)、#101 视频比例 7 种(七模型只声明 `[9:16,16:9]`)、#102 视频清晰度 P 档(该维度不存在,面板的「质量」是 standard/hd)、#105 视频生成数量(画布一节点一 generation,不经批量网关)、#112 视频空态快捷首帧/首尾帧(前置 #93)、#79 图片生成数量(上游请求体无 `n`)、#80 图片模型清单(全产品在售图片模型只有 1 个且服务端硬钉 gpt-image-2)、#76 图片画质低/标准/高(上游 quality 被 env 门控,且与我方按 resolution 计价脱钩)。
  - **建议改措辞不改裁决的 1 项**:#103「时长滑杆」→ 矩阵里多数模型只有 1-2 档离散时长,物理上做不成连续滑杆;建议改为「时长选择(按模型能力渲染离散档位)」,改完即算已实现。
  - **🔴 必须由用户裁决、AI 不动的 3 项**:#185 拦截式确认阈值(改的是资金确认边界)、#253/#51① 已 bound 行的超时判死自动退款(有误退真实成功任务的风险,且 DB 明文 RAISE 禁止对 unknown 自动退款)、#237 grant 首个用例=教程完成奖励(涉发放金额,且前置教程 #211 入口硬关)。

  ### ✅ 四项裁决已取得(2026-08-09,用户)

  | 议题 | 裁决 | 落地方式 |
  |---|---|---|
  | **#185 拦截式确认** | **按原规格改代码,不改规格** —— 实现双阈值「余额<预估×1.2 或单次>5000⚡」 | ✅ **已落地(`70d2ded`)**:阈值常量 `CANVAS_CONFIRMATION_LOW_BALANCE_MULTIPLIER=1.2` / `CANVAS_CONFIRMATION_HIGH_COST_THRESHOLD=5000` 与纯函数 `resolveCanvasConfirmationTrigger` 落 `generation-pricing.ts`,`getCanvasGenerationEstimate` 消费;新增 `confirmationReason`(low_balance/high_cost/indeterminate)贯穿 DTO→context→弹窗。边界刻意不含等号(余额恰等 cost×1.2 不拦、cost 恰 5000 不拦),与规格逐字一致;两条同时命中按 low_balance 提示。非有限报价/余额 → indeterminate 兜底拦下。**闸门**:backend verifier 61/61(新增 15 条,含阈值钉死与边界±1)、frontend 49/49、intent 122/122、runtime 544/544、tsc 绿、build 绿 |
  | **#253 / #51①** | **已 bound 行不做自动判死退款,该半延 P2**;P1 内改为运维告警口径 | CHECKLIST #253 行文改为「**未 bound 行**超时判死触发幂等退款」+ 备注记裁决。判据:厂商慢任务与真失败在我方不可区分,自动退款会「退了钱又出了片」;且 `fail_canvas_generation_v1` 已明文 RAISE 禁止对 unknown 自动退款,绕过它=绕过该设计 |
  | **#237 grant 首用例** | **随 #211 交互式教程一起延 P2** | CHECKLIST #237 改判延 P2。grant 类型与件套④ 流水列**保持不动**,教程落地即可直接接 |
  | **资金③④ 结案口径** | **接受等价验收结案** | ③ = 库级 `canvas-refund:<id>` 唯一锚点(4 个迁移里一致)+ 实弹脚本 R44;④ = 唯一锚点索引 + 第二标签强制只读 + 幂等栅栏 UI 三重结构性证据。两者在生产**结构性无直击路径**(③ 已裁决不做取消入口且生产零失败;④ 需程序化触发扣费,与执行约束正面冲突) |

  - **✅ CHECKLIST 改判已落笔(2026-08-09)**:8 项改判延 P2(#76/#79/#80/#93/#101/#102/#105/#112)+ #237 延 P2 + #103 改措辞 + #253 行文收窄 + #185 备注裁决。连带更新两张统计表与 CLAUDE.md 期次表。
    - 机器守卫绿:`功能行总数 220(做 167 / 裁 31 / 延 22)`、`做·期次分布 P0=48 P1=52 P2=55 P3=11 P4=1`、P0 键 48 与看板一一对应。
    - **P1 由 61 降为 52**(8 项 B 组 + 1 项 F 组离开「做」)。CLAUDE.md 期次表、EXECUTION_TRACKER 已同步。
    - 落笔前逐项代码实证(不是照抄提案):`VideoGenerationMode` 仅 2 值 / 七模型 `supportedModes` 全 2 个 / `first_frame`+`last_frame` 零引用;`VideoAspectRatio` 仅 `9:16`+`16:9`;`VideoQuality` 仅 `standard`+`hd`(无 P 档维度);`generation-intent.ts:140` 硬钉 `z.literal("gpt-image-2")`;`canvas-chrome-policy.ts:49` 教程 `enabled:false`;全仓仅 3 个 sweep 且都只管未 bound 行、`maxPollMs` 在画布侧零消费。

  ### R2-Q4 补齐批次:便宜活排序(2026-08-09 重建并首次落盘)

  > ⚠️ **这张表此前从未落盘,不是「本轮才写」而是「本轮才发现它不存在」**。交接文档
  > `HANDOFF_R2_NEXT.md` §负一/§负二③ 称「完整分档清单、每项工作量档位/依赖/风险、便宜活排序
  > 全在本小节」——**实为失准**:本看板全文对 `#44`/`#72`/`#84`/`#94`/`#186`/`#187`/`#64`
  > 零命中,只有汇总数(15/30/15)与 8+1 提案。唯一幸存记录是 HANDOFF 里那 6 行摘要。
  > 下表按它重建,**每项均已重新代码实证**,HANDOFF 的失准表述已一并更正。

  **进度(2026-08-09)**:✅ **6/6 全部落地过闸,尚未发版。**

  | 序 | 项 | 状态 | commit |
  |---|---|---|---|
  | 1 | #51②③ 回前台触发 + 常态手动刷新 | ✅ | `258ab2e` |
  | 2 | #187 参数人话文案 + 悬停示例 | ✅ | `17e87c5` |
  | 3 | #186 灰置控件解锁指引 | ✅ | `e6bfe41` |
  | 4 | #84 产物全屏预览 | ✅ | `fab0ebf` |
  | 5 | #44+#72+#94 引用区缩略图带序号 | ✅ | `f4bd9a2` |
  | 6 | #64 入库 + 推为参考 | ✅ | `5b53a95` |

  闸门累计:`verify-canvas-generation-frontend` 由 49 → **122**(新增 73 条);
  `verify-canvas-generation-backend` 46 → **61**;`verify-canvas-s6` 138 → **141**;
  `runtime` 544 / `intent` 122 / `s3` / `s4` / `schema` 无回归;
  每项均过 `tsc --noEmit` 与 `npm run build`(exit 0)。

  **补齐过程中查出并修掉的两个真缺陷**(不在原清单里,是做的时候撞见的):

  1. **面板与提交路径的上游排序本来就不一致**。提交 `generationInputNodes` 按**连线顺序**,
     面板 `incoming` 是 `nodes.filter(idSet.has)` 即**节点数组顺序**。此前只用来算数量(与序无关)
     所以没暴露;引用区一按序号渲染,UI 的「图2」就可能是请求里的第 1 张参考图——用户照错编号
     写提示词、按全价扣分、拿回不对的图,**静默且要花钱才发现**。已抽成唯一真相源
     `generation-input-order.ts`,两条路径共用,verifier 钉住「两边同源」。
  2. **`/api/studio/library` 的 `updated` 数的是 `task_id` 而不是行**。画布同步完成的图片
     `task_id` 恒为 null,入库明明成功却回 `updated: 0`,客户端据此报失败。已改为数行。

  **#64 的服务端选型**:`/api/studio/library` 原按 `task_id` 匹配,而画布直连图片
  `task_id` 恒为 null(`bindProviderTask` 只在 `status==="processing" && platformTaskId` 时才调),
  故该端点原样对画布不可用。按铁律 1(零 fork、允许参数扩展)**扩现有端点**新增 `generationIds`
  二选一匹配键,而非新建画布专用路由——属主校验 / completed 闸 / published 守卫那几道闸
  只该有一份,复制一份迟早漂移。四道闸原样不动并由 verifier 逐条钉住。

  | 序 | 项 | 现状(2026-08-09 代码实证) | 档位 | 依赖 / 风险 |
  |---|---|---|---|---|
  | 1 | **#51②③ 回前台触发 + 常态手动刷新** | `visibilitychange` 全仓只出现在 `writer-lock.ts`(单写者锁,与对账无关),对账侧零监听;`refresh` 在 `canvas-generation-context.tsx` **已存在**,但只在 syncState 陈旧时被动调用一次,**既没接可见性、也没有按钮** | **XS** | 无依赖,纯前端接线,不碰资金链路。**功能价值最高**——标签页切后台会让节点空转,是真实可见的用户侧故障 |
  | 2 | **#187 参数人话文案 + 悬停示例** | 全仓 0 命中 | **S** | 无依赖。纯文案 + `title`;要逐个参数写,面广但每处极浅 |
  | 3 | **#186 灰置控件「如何解锁」指引** | 全仓 0 命中(「如何解锁」/「创建图片节点」/「从历史选择」皆无) | **S** | 需一个 tooltip/popover 承载面;灰置原因代码里已有(按上游图灰置),接出来即可 |
  | 4 | **#84 图片产物全屏预览** | 下载有(`generation-controls.tsx:893` `downloadMedia`),**全屏 0 命中** | **S** | 复用既有 dialog + `media-url-cache.ts` 签名 URL 解析,零后端新增 |
  | 5 | **#44 + #72 + #94 引用区缩略图带序号** | 「引用区」全仓 0,只有连线数量校验的报错文案;计数已在(模式显示「图生视频 (1)」) | **M** | 三项共用一块 UI,一次改动关三个缺口。需在面板内解析上游产物 object key→签名 URL 并按连线序编号 |
  | 6 | **#64 入库 + 推为参考** | 下载有;**入库 / 推为参考 0 命中** | **M** | 「入库」要写 `generations.library_status`,**是本批唯一有服务端面的项**,故排最后 |

  **与 HANDOFF 摘要的一处排序差异(有意为之)**:HANDOFF 把 #44+#72+#94 排第一,理由是「一次关三个缺口」。
  重建时改排第 5——它是本批唯一需要在面板内做媒体解析的项(M 档),而 #51②③ 只是把**已经存在的**
  `refresh` 接上可见性事件(XS 档)且修的是真实故障。按「改动量/收益」排,**先做 XS 且修故障的,
  再做 M 且补展示的**;三项共用 UI 的收益不变,只是次序靠后。

  **停靠位 `max-h`(顺手项)已完成(`1f9d887`)**:新增 `GENERATION_DOCK_MAX_HEIGHT_RATIO=0.75`
  与 `generationDockMaxHeight()`,样式由常量驱动。**成因更正**:`canvas-board.tsx:1415` 原是硬编码
  `max-h-[55%]`,**并未引用** `GENERATION_PANEL_MAX_HEIGHT_RATIO`——是重复魔数而非「误用常量」,
  但同数即同病(因高过 55% 才 dock 的面板,落进同样卡 55% 的停靠位后必然仍超出)。
  S6 verifier 补三条断言,141 通过 0 失败。

- **R2-Q3 · 🔴 P1 功能缺失:「删除 running 节点三选一」根本没实现**(2026-08-08 实测,待裁决)
  - **CHECKLIST 第 251 行**明列为**做 / P1**:「删除 running 节点三选一(取消并退款 / 仅移除[任务继续产物进历史] / 返回);网关不支持取消则明示」。
  - **实际实现**只有「未终态就把删除按钮 `disabled`,配 4 种解释性 title」(`src/components/canvas/nodes/generation-controls.tsx:762,765,769,772`)。全仓 grep **无** `取消并退款` / `仅移除` / `保留任务` / `cancelAndRefund` 任何字样——三选一弹窗与两个动作都不存在。
  - **连带后果**:用户侧**没有任何取消入口**,于是 `refund` 路径在生产从未被触发过(与「画布至今零失败、零退款」互证)。CHECKLIST 第 260 行「注入上游失败→节点 failed+恰好一条 refund」同样因此无法验收。
  - **可辩解的部分**:规格自带逃逸口「网关不支持取消则明示」。现实现算是"明示了不能删",但仍缺 **「仅移除(任务继续、产物进历史)」**——这一项与网关能力无关,是纯前端+文档态的动作,没有不做的技术理由。
  - **✅ 已裁决(2026-08-08,用户)**:走「补『仅移除』+『返回』,取消并退款明示不支持」。
  - **✅ 已实现(2026-08-08,本轮)**:
    - `generation-controls.tsx` 新增 `generationDeleteDisposition`,把未终态删除拆成两类:
      **`blocked`**(同步未就绪 / 本地幂等核对中 / 上游 `unknown`)—— 这三种状态下节点是恢复动作的**唯一入口**(「核对并恢复」按钮、unknown 行人工裁决的现场线索),移除它会让用户失去追回产物与积分的抓手,故维持禁用;
      **`detach`**(`pending`/`processing`,即规格所说的 running)—— 允许「仅移除」。
    - **「仅移除」安全性的代码实证**:全仓核对确认服务端对账车道**从不回写 `canvases.doc`**(11 个画布迁移里 `canvas_node_id` 只出现在 `generations` 相关语句,无一条 `UPDATE canvases`),故移除节点不影响任务收敛;产物落 `generations` 后由历史资产面板照常可见(`history-assets.ts` 的 `HISTORY_ASSET_SOURCES` 首项即 `generations`)。客户端 `patchNodeGeneration` 找不到节点时静默 no-op,不会崩。
    - **「取消并退款」按逃逸口明示不可用**,依据写进代码而非口头:`generationCancelUnsupportedReason()` 读 `VIDEO_MODEL_CATALOG` 的 `supportsCancel`(七个模型当前全为 `false`),图片直连链路无撤单接口。函数注释明写「将来某模型支持撤单时不能只放开文案,必须先实现真正的取消动作与幂等退款」。
    - 新组件 `nodes/generation-delete-choices.tsx` 承载三选一,**节点级删除按钮与批量/Delete 键删除两个入口共用**(批量路径新增 `generationDetachPlan`,整批含 blocked 节点时仍按原样拒绝并给原文案)。
    - 复制/撤销/重做的守卫**未放宽**:`generationDeleteBlockReason` 语义原样保留(running 仍算阻断),那些动作没有「仅移除」语义。
    - **闸门**:`npx tsc --noEmit` 绿、`npm run build` 绿、31 个 verifier 29 绿(未过的 2 个 = blue-green 需 Node 20、p1-fixture 需本机 PG,**在未改动的树上同样失败**,与本改动无关)。
  - **✅ 发版后生产 UI 验收通过(2026-08-08 晚,`d16620f`/3013,实扣 5 积分)**:
    - 触发方式本身就是 **#188 的验收**:在图片节点提示词框按 **Ctrl+Enter**(真实按键,非 JS 触发)→ 弹出拦截式确认「本次预计消耗 5 积分,当前余额 18464」→ 确认生成。生产 DOM 上 `aria-keyshortcuts="Control+Enter Meta+Enter"` 与 `title="Ctrl+Enter（Mac 为 ⌘+Enter）发送"` 均在。
    - 任务进入 `生成中` 后,**删除按钮 `disabled=false`**(旧版此处恒为 `true`),title 为「任务生成中,完成或明确失败后才能删除节点」。
    - 点击后弹出三选一,逐字符核对:
      标题「**任务生成中，如何处理该节点？**」;
      ①「**取消并退款**」`disabled=true` + `aria-disabled=true`,title 与 `role="note"` 明示区同为「上游网关不支持撤单：任务一经提交即由服务端对账车道接管，无法中途取消，因此也不会退款。」;
      ②「**仅移除节点**」可用;③「**返回**」可用;
      说明文「仅把节点从画布移除。任务会继续跑完，产物照常进入「历史资产」，本次积分按已提交的任务照常结算。」
    - 点「仅移除节点」后:节点从视图与**持久化文档双双移除**(doc rev 57,`node_QoEyEO20T-Mn` 不再在 `doc.nodes`),无报错;
      **而任务在节点消失后仍 `processing` 并继续收敛**(`ea6f9014-604d-454d-8c73-2fc81b7f046d`,扣 5 分、余额 18464→18459、`operation_anchor` 唯一)——「任务继续」这半在生产得证。
    - **「产物进历史」这半同样得证**:该笔在节点已不存在的情况下于约 7 分钟后跑到 `status=completed`、`credits_refunded=0`;`GET /api/canvas/history?type=image` 从**基线 3 张变为 4 张**,新增项正是 `generations:ea6f9014-…:0001-output-url`(`source=generations`,带真实 objectKey)。`generations.canvas_node_id` 仍指向已移除的 `node_QoEyEO20T-Mn` —— 正是 detach 语义:**行保留引用,文档不再有该节点**,将来要追溯也找得到。
    - ⇒ **CHECKLIST #251 在生产完整收口**(交付形态为用户裁决的「仅移除 + 返回 + 网关不支持取消则明示」)。
  - **资金③ 退款仍无用户侧触发入口**:本轮交付的是「仅移除」,不产生退款。CHECKLIST #260 的验收仍要靠一次真实失败,或等「取消并退款」具备条件。

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
