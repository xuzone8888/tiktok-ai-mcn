# Star Gaze「Studio」内容板块合并升级方案(2026-07)

> 产出方式:前沿创作平台界面范式联网调研(20+ 产品)+ 创作模块代码可行性摸底 + 交互设计 + 工程迁移计划 + 红队对抗审查后的裁决版。
> 上位文档:[PRODUCT_STRATEGY_2026H2.md](./PRODUCT_STRATEGY_2026H2.md)(五板块 IA、对象模型、0-3 月路线图)。

---

## 一、前沿创作平台界面范式全景(2025-2026)

### 五类范式

| 范式 | 代表产品 | 交互特征 | 适合场景 |
|---|---|---|---|
| ① 对话流/Omnibox 优先(全屏结果区+底部命令框) | Sora(feed+creation bar)、Midjourney Web、Luma Dream Machine(旧图拖进 prompt bar 加一句话即改)、海螺 Video Agent、即梦 Agent 模式 | 图/视频拖入引用、参数 chips 普遍;@主体引用少数支持;**链接解析基本不存在** | 单条内容快速探索 |
| ② 无限画布/节点白板 | Flora、Krea Realtime、Firefly Boards、Recraft、可灵 3.0 画布 | 节点连线、多模型工作流、团队协作 | 发散探索、评审;学习曲线陡 |
| ③ 表单+任务队列 | **即创**(行业+商品链接+卖点表单)、通义万相、Vidu、Higgsfield(70+ 运镜 preset) | 参数确定、可批量、任务中心 | **量产** |
| ④ 向导/时间线 | Pippit、Topview、Google Flow(Scenebuilder+Ingredients) | 分步向导、场景组装 | 电影化叙事/带货成片 |
| ⑤ Agent 托管式 | Lovart ChatCanvas("画布即 prompt")、Genspark/Manus | 对话+画布双通道、任务全托管 | 设计委托 |

### 三个关键结论

1. **创意向头部一致收敛为"结果区(feed/瀑布流)+ 一个统一多模态输入框"**:Sora、Midjourney、Luma、Krea、即梦、海螺全是。第二趋势是对话框与画布融合、走向 Delegative UI(管理任务队列而非闲聊)。
2. **电商量产产品根本没用对话式。** 即创是表单流:粘贴商品链接→自动抓卖点→一键成片→一次 5 条→右上角任务中心;Pippit 是左侧导航+顶部贴链接/传素材→出多条方案→Quick edit。量产界面的核心是**资产库+任务中心+批量导出**,"链接输入"只是把表单第一步自动化,不是自由对话。账号/商品绑定在独立后台,不进输入框。
3. **输入框能力矩阵**:链接直贴=仅电商产品(即创/Pippit/Topview);素材插入=几乎全部;主体一致性引用=Runway Gen-4 References(最多 3 参考图,prompt 里 "Image 1" 指代)、即梦智能参考、Flow Ingredients;多模态混排=Lovart/Sora storyboard。

**给 Star Gaze 的定位启示**:面向矩阵量产客群,真提效的是——链接→卖点→批量出片、@角色一致性引用、任务中心+失败重试、prompt/配方复用;演示好看但量产用户不用的是——无限画布/节点图、实时画布、纯 Agent 托管。

---

## 二、代码摸底:难度比预想低的三个原因

1. **9 个 zustand store 全是纯状态容器(0 个 fetch)。真正的执行引擎是 `background-task-manager.tsx`(1255 行,挂在 (main)/layout)**:上传→契约校验→提交→轮询→写回 store→通知,页面切换不中断。任何新界面只要把任务写进现有 store,执行/轮询/通知全部免费获得。
2. **生成双轨其实已收编**:统一网关 `/api/video-batch/models/submit|status` 经 registry 覆盖全部 7 个视频模型,服务端 check→deduct→submit→失败自动退款;`/api/generate/image` 同理。旧直连端点前端已无人调用(死代码,不用清)。**积分扣退在服务端,新界面不可能绕过。**
3. **关键积木全部零耦合可复用**:上传(dropzone→OSS)、链接解析(`/api/link-video/parse`)、爆款克隆一条龙(`/api/viral-clone/ingest/link`)、character-picker(605 行,自带 inline variant,@角色直接用)、use-task-polling。

大页面(video-batch 4246 行、quick-gen 2919 行)约 70% 是可丢弃的表单/卡片 JSX。**新代码全在交互壳:约 1600–2400 行。**

需要注意的坑:(main)/layout 硬包 container+底部渐变,需做 per-route 全屏豁免(opt-out,禁改共享 container);quick-gen store 是单任务槽,连发会互顶,需扩数组(带 persist 版本迁移);全站桌面 only,移动端后排。

---

## 三、形态定案:Omnibox 壳 + 任务队列芯(混合范式)

**铁律:omnibox 是"提交器",不是"聊天窗"。** 输入侧借对话式的低门槛(链接/素材/@角色/文字混排一个框),输出侧回到任务队列——每次提交生成一个 **Batch 批次卡**,内部是可筛选网格,不是聊天气泡流。

### 界面结构

- **左栏 240px(可收成 48px 图标 rail)**:Project 列表 + Session 历史。映射:一次提交 = 1 个 Batch = N 个 Job;Job 完成产出 Content。
- **主区:垂直批次流**。Batch 卡头 = 提交回显(prompt 摘要+chips 快照)+ **可编辑参数面板(点开即表单,改一处重跑)**+ 进度环 `32/50 · 失败3`;卡体 = Job 网格(≤8 条直接展开,>8 条折叠预览,展开虚拟化 6 列);卡底 = 全选/状态筛选/批量重试失败/批量入库/导出(复用 video-batch 导出)。
- **右栏 360px 抽屉**:点 Job 打开——大预览、参数、积分消耗、单条重试/入库、「以此为参考」(推回 omnibox 成 chip)。
- **底部 omnibox**:居中悬浮 760px;上沿参数 chips(模型/比例/时长/**数量 stepper 1–100**),左端模式切换器,右端积分余额+发送键(显示预估消耗「50 条 ≈ 2500 积分」)。

### Omnibox 能力矩阵(所有输入编译为统一 JobSpec → 写 store → BTM 执行)

| 输入 | 交互流 |
|---|---|
| 纯文字 | 自动判意图只**预填**模式 chip,永不代提交;模式切换器是唯一真值 |
| 贴商品链接 | paste 侦测→"解析中"chip→`/api/link-video/parse`→商品卡 chip(主图+标题+卖点勾选) |
| 贴视频链接/传视频 | 视频 chip(首帧+时长)→`/api/viral-clone/ingest/link` 一条龙,阶段式进度 |
| 拖入图片 | 全屏投放蒙层→上传→chip 带进度环;chip 标注用途:参考图/首帧/商品图 |
| @角色 | inline character-picker→mention chip 携带 CharacterAssetSnapshot,提交前走契约校验 |
| /命令或模式切换器 | /单图 /批量图 /视频 /克隆 /商图;选中后参数区换字段 |
| 模板=配方 chip | 模板中心「用此配方」→金色 chip 含 prompt 骨架+参数预设;任何 Batch 卡可「存为配方」 |

**防误判护栏(红队裁决)**:自动意图判定仅预填、不代提交;>N 条或 >X 积分强制二次确认;歧义时发送键旁二选一。

### 三个关键场景

- **商品链接→10 条带货视频**:贴链接→商品卡 chip→勾 3 卖点→数量 10→Batch 卡先出"脚本确认"态→确认→10 Job 走统一网关→筛选→批量入库(顺手打通 link-video 死胡同)。
- **@角色+提示词→50 条→筛→入库**:@角色→提示词+优化魔棒→数量 50→发送显预估积分→折叠卡看进度→失败 3 条一键重试(服务端自动退款已有)→空格快速预览逐条标记→勾 38 条批量入库→toast 引导去发布。
- **爆款视频→5 变体**:拖入视频→/克隆自动激活→ingest 一条龙(分析/分段/重生成/拼接/超分)→5 成片入网格→入库(**把无入口的 viral-clone 零成本救活**)。

### 旧页面处置

| 模块 | 归宿 |
|---|---|
| video-batch / image-batch | 第一批并入 Studio,灰度期保留 |
| quick-gen | 并入(数量=1 即单图);store 单槽扩多任务 |
| image-factory | **保留独立工具页**(精修是编辑非生成),右栏加「送精修」入口 |
| link-video | **旧代码推倒重做**为蓝图管线门A(商品成片),详见 [BLUEPRINT_PIPELINE_PLAN.md](./BLUEPRINT_PIPELINE_PLAN.md) |
| viral-clone | **旧代码推倒重做**为蓝图管线门B(爆款拆解),同上 |
| image-slideshow | 独立功能砍掉,资产三向转生:商品图输入腿+幻灯片渲染腿+TikTok 图文帖(1 万行渲染栈全保留),同上 |
| 角色体系 | 保留独立(资产域),@mention 打通 |
| templates | 重做为配方库,唯一动作=送入 omnibox;爆款拆解的蓝图脱敏后即配方(内容供给闭环) |

> 2026-07 修订:三个参考物驱动模块的重构方案与合并排期以 [BLUEPRINT_PIPELINE_PLAN.md](./BLUEPRINT_PIPELINE_PLAN.md) 为准(总排期 S0-S4,11-14.5 人·周,收钱前锁死 S0-S2)。

双轨共存:导航置顶「Studio ✦ 新」;旧三页顶部横幅"已并入 Studio,点此携参跳转";旧入口收进"经典工具"折叠组,两个版本周期后按用量下线(预计 T+3~4 个月旧路由 302)。

### 全站视觉方向(五条原则)

默认深色工作台(浅色保留),沿用钛空银 token,新增电光青强调色仅用于"生成中"与发送键。

1. **内容 90%**:chrome ≤10% 像素;导航从 sidebar 变 48px 图标 rail + Cmd+K 命令面板。
2. **状态即颜色,全站唯一语义**:排队灰/进行蓝脉冲/成功绿/失败红/入库金,做成共享角标组件,Batch 卡、任务中心、发布日历共用。
3. **chip 是通用引用货币**:商品/素材/角色/配方四类 chip 造型统一,可在 omnibox、Job 卡、发布器间流转。
4. **数字优先排版**:进度/条数/积分用 tabular-nums 大字号。
5. **动效只服务状态变化**:framer-motion 限 chip 插入、进度脉冲、卡片展开,禁装饰动画。

**范围裁决(红队修正)**:内容库/发布板块不立项重排版,只通过共享组件(状态角标、chip)随做随换;增长/账号后台仅换导航壳。

---

## 四、红队修正后的关键裁决

1. **omnibox 不是聊天窗**:Batch 卡头做成可编辑参数面板(改参重跑是矩阵团队高频动作);验收加"改参重跑 50 条的点击数 ≤ 旧页"。
2. **意图判定永不代提交**:模式切换器唯一真值;大批量/高积分强制二次确认——误判 50 条积分错扣会摧毁信任。
3. **「入库」必须先行定义,不能等 Stage 3**:generations 表加 `status`(draft/ready/published)+ `batch_id` + `spec` 三列(不算新表,符合"冻结旧表、新功能写新表"的精神),Stage 1 起 Batch/入库即持久化,避免灰度期数据割裂(store+localStorage 刷新即丢、孤儿任务)。旧页产出归入"经典工具产出"虚拟批次。
4. **发布板块跟改砍掉**:不与 Studio 捆绑立项,守住 0-3 月发布/风控/数据回流的资源线。Studio 不能吃掉收钱路线的工程预算。
5. **打底周先行**:2 人·周的便宜活(viral-clone 入口、link-video 入库/去发布、入库字段、quick-gen 多任务)先上线兑现价值,同时就是 Studio 的地基——无论 Studio 做不做都必须做。

---

## 五、执行路线图

### 第 0–1 周|打底(约 1–2 人·周)——立刻兑现价值,同时是 Studio 地基
1. generations 加 `status/batch_id/spec` 三列,「入库」动作最小实现;
2. viral-clone 补导航入口(后端完整,加入口前先过版权红线:限定自有素材+公域参考);
3. link-video 成片页加「入库/去发布」,打通死胡同;
4. quick-gen store 单槽扩多任务(persist 版本迁移)+ 数量 stepper;
5. (main)/layout per-route 全屏豁免(opt-out);定义 JobSpec 类型 + toVideoBatchTask/toImageTask 适配器。

### 第 2–5 周|Studio MVP(约 2.5–3.5 人·周)
- /studio 全屏页 = 批次流 + 底部 omnibox;
- 四条输入路径:文字→单图/单视频、拖图+文字→图生视频、@角色、贴链接→商品卡 chip(动作=带参跳 link-video 向导,一键成片不在 MVP);
- 参数 chips、结果卡(进度/预览/重试/入库);
- 验收:四条路径出片成功率与旧页一致(同 API 抽样对比);积分扣退对账一致;全路由截图回归无损;改参重跑点击数 ≤ 旧页。

### 第 6–8 周|批量与矩阵(约 2–3 人·周)
- 数量 stepper→一次 N 个 Job 写 video-batch store,BTM 原样并发(BTM 是唯一执行宿主,Studio 不建第二执行层);
- 任务中心侧栏:跨会话历史(只读 generations)+ 失败批量重试 + 批量下载/IDM(导出逻辑抽成 lib 函数);
- 配方 chips + prompt 历史复用;
- 验收:一次提交 10 条视频全程可用;**≥2 个矩阵种子团队日常出片迁到 Studio**(这是继续 Stage 3 的门票,不达标就停)。

### 第 9 周后|收编与下线(约 3–4 人·周,凭 Stage 2 数据决定)
按接入成本升序:image-factory→"图片编辑意图"(独立页下线)→ viral-clone 全并入 → link-video 拆成卡内确认流(成片直接入库接发布)→ image-slideshow 砍 → 旧路由 302、删旧 JSX、store 9 个收敛到 ~4 个。

### 总账与护栏
- 全量 8–11.5 人·周(红队警告:含 QA/联调/灰度对账,实际按 ×1.5 预留缓冲);1–2 人团队日历 2.5–4 个月。
- **只有 4 周的版本**:打底 + MVP + 数量批量与失败重试;砍掉配方 chips、任务中心持久化、全部收编、移动端、LLM 意图解析。此版本已覆盖矩阵团队 80% 日常动作,且旧页全程在线,商业风险为零。
- **技术要点**:不建大一统 store(新增 1 个 studio-ui store,任务数据留在现有 store,跨 store selector 聚合);omnibox 解析层是纯前端规则流水线(附件层/mention 层/URL 层/文本层),不上 LLM(Stage 2 可选加,失败降级回规则);useChat 不适用(多任务并行+长轮询与单 assistant 消息流协议不匹配);乐观 UI:提交即插 pending 卡(clientTaskId 幂等),BTM 写回 store 驱动状态机,Studio 自己不发任何轮询。

### 风险清单 Top5

| 风险 | 对冲 |
|---|---|
| video-batch 4246 行藏隐性逻辑(内联 submit 路径、契约校验、模板注入) | Stage 1 前花 0.5 天 diff 内联路径 vs BTM 路径参数差异,并入 JobSpec 适配器;灰度期双界面出片对比 |
| BTM 1255 行质量一般,扩图片多任务回归旧功能 | 只做加法不重构;4 个执行器补最小烟测;回滚成本=一个组件 |
| layout 全屏豁免牵连 20+ 页 | opt-out 实现,禁改共享 container;上线前全路由截图回归 |
| "贴链接一键成片"预期超出 MVP | 对齐口径:一键成片是 Stage 3;MVP 演示主打拖图+@角色+批量 |
| 桌面 only,omnibox 引发移动端期待 | 组件按响应式书写但不验收移动端,移动版后排 |
