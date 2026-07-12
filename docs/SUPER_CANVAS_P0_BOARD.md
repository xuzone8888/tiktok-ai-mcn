# P0 画布骨架 · 任务看板(多窗口协作事实源)

> **用法**:每个开发窗口开工前读 [CLAUDE.md](../CLAUDE.md) → 读本看板 → 把要做的任务「状态」改成 `进行中@窗口名` 并 commit(=认领,防双跑)→ 做完改 `待审` → 审核窗合流后改 `已合流`。
> **功能点零遗漏保证**:本看板把 CHECKLIST 全部 48 个 P0 行(+2 个 P0 起纪律行)逐行映射进任务;每行文字与 [SUPER_CANVAS_CHECKLIST.md](./SUPER_CANVAS_CHECKLIST.md) 一致,冲突以 CHECKLIST 为准。
> **P0 目标**:内部可走查的画布骨架——能建 6 类空壳节点、连线、成组、保存不丢、坏档不白屏、双标签不打架。**不接生成**(生成是 P1)。

## 状态总览

| 任务 | 窗口 | 状态 | 依赖 |
|---|---|---|---|
| D1 canvases 表迁移+文档体积闸 | data | 待认领 | 无(第一个做) |
| D2 zod schema+迁移注册表+坏档降级 | data | 待认领 | D1 |
| D3 文档存取 API+补丁保存协议 | data | 待认领 | D1、D2 |
| D4 IndexedDB 影子副本 | data | 待认领 | D3 |
| D5 单写者锁 | data | 待认领 | D1 |
| D6 历史资产直读查询 | data | 待认领 | 无 |
| S1 /canvas 路由+React Flow 底盘 | shell | 待认领 | 无(第一个做) |
| S2 建节点五入口+连线 | shell | 待认领 | S1、D2(schema) |
| S3 6 类节点空壳 | shell | 待认领 | S1、D2(schema) |
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
  - ✅ canvases 文档 schema(jsonb 拓扑+引用+schemaVersion+deps 依赖清单字段)
  - ✅ 文档 >512KB 拒存并提示(服务端 doc_bytes 计算+API 拒存)
  - ✅ jsonb>2MB 告警建议拆画布(阈值检测,UI 提示由 S 侧消费)
- **D2 zod schema + 迁移注册表 + 坏档降级(数据面)**(`src/lib/canvas/schema.ts`:doc/node/edge/group 的 zod v1 + refs 引用约定 + deps 结构;此文件是 shell/data 共享合约)
  - ✅ zod 加载校验+非法节点降级「损坏节点」占位卡(可删),永不整画布白屏(数据面:校验失败节点标记 broken,占位卡 UI 归 S3)
  - ✅ schema 迁移注册表(v1→v2→…;上一版本文档能打开进 DoD)
  - ✅ 禁存 dataURL/签名 URL,只存 OSS object key(schema 校验层拒绝 data:/签名 URL 入库;渲染层换签名 URL 归 shell)
  - ✅ 节点白名单纪律(6 类 v1)——schema 的 node.type 枚举即白名单载体
- **D3 文档存取 API + 补丁保存协议**(`src/app/api/canvas/[id]/route.ts`:GET 整包 / PATCH 节点级补丁 + rev CAS + updated_at 手动写[仓库惯例,表无触发器])
  - ✅ 自动保存=节点级补丁(op log),非重叠自动 rebase(协议+服务端;客户端定时器归 S 侧接入)
  - ✅ 断网 30s 恢复自动补存(补丁队列重放机制)
- **D4 IndexedDB 影子副本**(`src/lib/canvas/shadow.ts`)
  - ✅ IndexedDB 影子副本 + shadow>server 一键恢复(不占 localStorage 5MB 配额)
- **D5 单写者锁**(`src/lib/canvas/writer-lock.ts` + API 侧 writer_tag/heartbeat)
  - ✅ 单写者锁(navigator.locks)+ 双标签第二个只读+横幅(横幅 UI 归 S7 消费其状态)
- **D6 历史资产直读查询**(`src/app/api/canvas/history/route.ts` 或复用现有查询;**三库同源:直读 generations/assets/blueprints,不建平行表**)
  - ✅ 历史资产库(数据面:跨画布图/视频/音频生成历史查询,按类型三 tab+日期分组+计数)

### shell 窗口(worktree: canvas-p0-shell,分支 claude/canvas-p0-shell)
**负责**:`src/app/(canvas)/canvas/`(新路由,不动 /studio)、`src/components/canvas/`。**消费 data 的 schema.ts,不得自定义平行类型。**

- **S1 /canvas 路由 + React Flow 底盘**
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
- **S6 1366×768 + 媒体降级**
  - ✅ 1366×768 最小适配(侧栏默认图标态/生成器超视口 dock 底部/胶囊≥5 折叠——P0 先落侧栏与布局骨架)
  - ✅ 媒体降级策略(节点默认 poster 缩略图/选中才挂 `<video>` 且 DOM 断言进 DoD/同屏活跃视频≤6/低 zoom 语义缩放降级色块——P0 落机制,P1 有真媒体后实测)
- **S7 错误边界 + store 防护**
  - ✅ 组件级错误边界+「尝试恢复/重新加载画布」按钮
  - ✅ store 层防护+错误边界触发进监控(单画布>1 次/日报警)
  - ✅ 单写者只读横幅 UI(消费 D5 状态)
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

## 合流顺序建议
D1→D2(schema.ts 落地)→ S1/S3 与 D3-D6 并行 → S2/S4/S5 → S6/S7/S8 → R1 全量跑 → R2 收口。
