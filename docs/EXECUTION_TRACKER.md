# 执行追踪(长程任务续接锚点)

> **切窗口/新会话必读**:本文件是执行状态的唯一事实源(SSOT)。恢复工作时:①读本文件;②读三份规划文档(见下);③从「当前状态」继续。每完成一个子任务立即更新本文件并提交。

## 规划文档(只读,不要重新讨论已裁决的事)
- [PRODUCT_STRATEGY_2026H2.md](./PRODUCT_STRATEGY_2026H2.md) — 总战略/定位/路线图
- [STUDIO_REDESIGN_PLAN.md](./STUDIO_REDESIGN_PLAN.md) — Studio 统一创作界面(omnibox+批次流)
- [BLUEPRINT_PIPELINE_PLAN.md](./BLUEPRINT_PIPELINE_PLAN.md) — 蓝图管线重构(裁决版,含 S0-S4 总排期)

## 当前状态
- **阶段**:S0 打底(总排期见 BLUEPRINT 文档 §七)
- **已完成**:
  - S0.0 commit 0169ccc + tag pre-demolition
  - S0.1 代码侧:20260702_studio_foundation.sql + runner(生产预检通过:8 种 source 全部被「基础枚举+batch_video% 通配」覆盖;valid_source 用 NOT VALID)
  - S0.2 摘器官:src/lib/blueprint/salvage/(qwen-client/segmenter/prompt-compiler/providers/types/schema-notes)
  - S0.3 拆楼:viral-clone 全删 + 20260702_drop_viral_clone.sql;tsc 0 错误 + next build 通过
  - S0.4 worker 补口:stitch.js(/api/stitch + /api/probe)+ ffmpeg-slideshow.py ken-burns(--kenburns 四种运镜)。**本机 ffmpeg 8.0 实测通过**:ken-burns 3图→3.53s 竖版视频;stitch 混合分辨率+无音轨段→1080x1920 音轨补齐
  - S0.5 layout 全屏豁免:MainContentFrame 客户端组件(FULLSCREEN_ROUTES=['/studio']),普通路由 DOM 与原实现一致;/studio 占位页已建;tsc 通过(页面级目测回归留待 S1 起 dev server 时抽查)
  - S0.6 quick-gen store 多任务化:videoTasks/imageTasks 数组为事实源 + activeXxxTask 兼容镜像(页面零改动);BTM 两个 quick-gen 执行器改数组遍历+Set 去重;persist v1 迁移。残留:多任务下页面画布可能"回跳"(S1 消解)、建议 updateXxxTaskStatus 加"终态不可降级"守卫(S1)
  - S0.7 JobSpec:src/lib/studio/job-spec.ts(VideoJobSpec/ImageJobSpec + toVideoBatchTask/toQuickGenImageTask + count 展开);适配器补全 BTM 路径缺失的四个角色字段
- **S0 全部完成(2026-07-02,含生产环境)**:
  - 生产库迁移已执行并校验(经 Supabase dashboard SQL editor):blueprints/reference_cache 建表 ✅、generations 三新列 ✅(gen_new_cols=3)、viral_clone 五表已 DROP ✅(残留=0)、valid_source 通配约束已重建 ✅
  - TikTok 开发者后台核验(app 7629290381422856212「Star Gaze」):**Live in production(2026-05-12 起),Content Posting API Direct Post = Approved**,scopes = user.info.basic/user.info.stats/video.publish/video.upload。**photo post 结论:无需新申请**——photo 走 content/init 端点,用同一 video.publish/video.upload scope + 同一 Direct Post 审批,S4 只需补实现代码。备忘:pull_by_url 需要域名验证(门户有 Verify 入口未完成),push_by_file 不受影响;后续加新 scope 走「Create Revision」
- **S1 前置修复已完成(2026-07-02)**:
  - BTM video-batch 执行器提交路径(background-task-manager.tsx)补传 characterId/characterName/characterReferenceImages/characterAsset 四字段,角色推导逻辑与页面内联路径对齐(task → globalSettings → asset 快照按模型上限推导),参考图并入 mergeCharacterReferenceImages
  - BTM quick-gen 视频执行器提交路径顺手补传 characterId/characterName/characterAsset(网关侧自会推导参考图并合并 imageUrls,见 models/submit/route.ts:222-242)
  - quick-gen store 终态不可降级守卫:updateTaskStatus/updateImageTaskStatus 中,任务已 completed/failed 后到达的异状态更新一律忽略(轮询迟到写入防卡回);重复终态写入只合并字段不重复追加 recentTasks
- **S1.1 /studio 骨架已完成(2026-07-02,tsc+build 过,经 17 项对抗审查修复)**:
  - /studio 实装:omnibox(图片/视频模式切换器唯一真值+参数 chips+数量 stepper 1-100+积分预估+大批量>10条/高积分>1000 二次确认)、垂直批次流(Batch 卡:参数快照 chips+进度统计+重试失败/批量入库;Job 网格 ≤8 展开 >8 折叠)、Job 抽屉(重试/入库/下载/以此为参考推回输入框)、整页拖拽上传蒙层
  - 新文件:stores/studio-store.ts(唯一新增 store:批次元数据+jobRefs,persist 上限 50 批)、lib/studio/batch-view.ts(useHostTaskMaps 页面级单次订阅 + buildBatchJobViews 纯函数聚合)、components/studio-shell/*(omnibox/batch-card/job-cell/job-drawer/status-badge/use-studio-submit;**注意 components/studio/ 被旧工作台组件占用,故用 studio-shell**)、api/studio/library(入库:按 generations.task_id 批量 update library_status,限 status=completed)
  - store 加法:video-batch `addTasks`、quick-gen `addImageTasks`(接收适配器构造的完整任务);JobSpec/VideoBatchTask/QuickGenImageTask 加 batchId;网关 models/submit + generate/image 接 batchId 落 generations.batch_id(UUID 校验,非法忽略)
  - **BTM 视频执行器改造(审查修复核心)**:①只执行带 batchId 的 Studio 任务——旧 video-batch 页 pending 草稿绝不拉起(startBatch 是全局开关,旧页任务无 batchId 天然隔离);②jobStatus=paused 且有 Studio pending 时自动置 running(persist 落盘 paused 无人恢复的死锁);③上游任务号拿到即持久化 soraTaskId+刷新后 pending 且带 soraTaskId 的任务直接续轮询(防双扣费);④执行循环 while 重扫 getState()+finally 复位+forceRescan 自唤醒(修执行中新批次永久卡排队);⑤customPrompt 短路:图生视频带用户文字时跳过豆包管线(适配器 spec.prompt 非空即写 customPrompt)
  - quick-gen store 修复:复水孤儿归一化(uploading/generating/无 taskId 的 polling→failed「页面刷新中断」,防双扣;带 taskId 的 polling 由 BTM 续轮询)、prune 分池(旧页任务 20/Studio 任务 500,防上一批结果被清成 missing)
  - 图片 task_id 对账:BTM 图片提交传 requestId=本地任务 id(qg-*),服务端兜底 id 加随机后缀(防同毫秒撞车);generations.task_id 与本地任务一一对应,入库匹配可靠
  - 偏差记录(有意为之):左栏 Project/Session rail 不做(S2 任务中心);URL 解析层/配方 chip 不做(S2);generations.spec 列落库留 S2(重跑快照已在 studio-store 客户端持久化);>8 折叠展开未虚拟化(S1 规模够用);@角色按钮占位禁用(S1.4 开放)
- **S1.2 幻灯片渲染腿已完成(2026-07-02,tsc+build 过,经 2 路对抗审查 4 项修复)**:
  - omnibox 新增「幻灯片」模式:拖 2-15 张图 + 可选文案主题 → N 条轮播成片;参数 chips = 比例/每图秒数/转场(fade/slideleft/wipeleft/circleopen/none)+ 运镜/配音/BGM 三个 ToggleChip;预估积分镜像服务端 calculateCredits(≤5图1分/≤10图2分/否则3分)
  - SlideshowJobSpec + toSlideshowTasks(job-spec.ts):renderRequest = generate-slideshow 完整请求体快照;**每个变体独立 Fisher-Yates 洗牌图序(素材级去同质化,BLUEPRINT §四)**;文案→aiCaption(diverse/lively/中英自动)+voice(random 智能选声);id 前缀 ss-*
  - BTM 第 5 执行器 useSlideshowTaskExecutor:只执行带 renderRequest 的 pending 任务(旧 image-slideshow 页任务无此字段,零影响);串行+每轮重扫+finally+forceRescan 自唤醒;fetch 带 AbortSignal.timeout(330s) 防挂起饿死队列;**navigator.locks 跨标签单飞+拿锁后 rehydrate**(防多标签双重渲染双扣费);去重集合放行 failed(显式重试可被重新拉起)
  - generate-slideshow 路由:接 kenburns/clientTaskIds/batchId + maxDuration=300;成功后按 successIndices 对齐写 generations(source='slideshow',task_id=客户端任务 id,batch_id 透传,prompt=生成文案)——幻灯片首次可入库/进任务中心;insert 失败不阻断响应(已渲染已扣费)
  - kenburns 三层接线完成:route→SlideshowOptions→callMacWorker body + 本地 spawn --kenburns(S0.4 的 worker/python 能力至此全通)
  - **重要修复(审查发现,波及 S1.1)**:zustand 同步 storage 的水合在 create() 内同步执行,onRehydrateStorage 里引用 store 常量会 TDZ ReferenceError——slideshow 与 quick-gen 两个 store 的复水归一化均已包 setTimeout(0) 延迟
- **S1.3 商品图腿 + S1.4 @角色已完成(2026-07-02,tsc+build 过,经 2 路对抗审查 7 项修复)——S1 Studio MVP 代码侧收官**:
  - S1.3 链路:omnibox「商品成片」模式,拖 2-9 张图→附件传完自动调 /api/studio/analyze-product(仅预填,永不代提交)→商品卡 chip(解析中/失败可重试/完成态点开勾卖点+受众)→发送=POST /api/studio/blueprints 建蓝图(scenes 骨架 beat: hook→point→cta,render_mode='slideshow',status='ready')→标题+勾选卖点作文案关键词,复用 S1.2 幻灯片腿出 N 条(变体=脚本层 diverse 文案×素材层图序洗牌)。batch.blueprintId 已挂
  - 新文件:src/lib/studio/product-vision.ts(豆包视觉主通道+qwen 兜底;normalizeCard 消毒器导出供落库路由复用;70s/35s 双通道时间预算)、/api/studio/analyze-product(maxDuration=120)、/api/studio/blueprints(cookie client+untyped 绕 database.ts;renderMode 白名单只放 slideshow;product/globals 元素级消毒;卖点勾选服务端复核)
  - doubao-api.ts:导出 callDoubaoAPI/imageUrlToBase64(+可选 AbortSignal),callDoubaoAPI fetch 加 60s 单次超时;salvage qwen-client fetch 同加 60s(挂起连接不再吃光预算)
  - S1.4:CharacterPicker inline 包浮层挂 omnibox 上方(@ 键/AtSign 按钮唤起,Esc 关),仅 image/video 模式可用;选中出紫色 @chip,characterAsset 进 draft.character→既有 JobSpec 角色链路(S1 前置修复已保证 BTM 透传四字段);character-picker.tsx inline 分支 title="" 不再渲染孤标题行(其他调用点不受影响)
  - 审查修复:分析竞态(指纹仅成功后写入+cleanup 复位 spinner)、失败重试按钮(analyzeNonce)、product 图数上限 9(与分析管线对齐)、blueprints 消毒/白名单(TypeError→500 消除)
  - **备忘**:rights_ack 商品图腿默认 true(自传自有素材;门B 上传爆款才强制勾选——审查确认符合裁决);analyze-product 无频控(与 link-video/parse 同水位,S2 若滥用加限流);blueprints 表未进 database.ts 生成类型,后续重新生成 types 时可去掉 untyped client
- **S1 验收状态**:四条路径(文字→图/视频、拖图+文字→图生视频、幻灯片、商品成片)+@角色全部代码就绪;「传图 5 分钟出轮播成片」「提交→Batch→入库全链路」待 dev server 人工走查(需真实登录态+豆包 vision 接入点/DASHSCOPE key 环境);积分对账一致依赖服务端既有扣退,Studio 未新增扣费路径
- **下一步:S1 人工验收 + S2**(BLUEPRINT §七):dev server 起 /studio 走查四路径与入库;之后 S2 = 链接腿(parse_reference job,海外站)+ 蓝图编辑器首版(卖点勾选+台词行内编辑)+ AI 生成腿(逐镜合成,回收 salvage prompt-compiler)+ 删 link-video(prompt 骨架转种子配方)
- **分支**:`claude/practical-curie-42f4b1`(worktree:E:\StarGaze\.claude\worktrees\practical-curie-42f4b1)
- **待用户/环境**:S0.1 生产执行——**exec_sql RPC 在生产库不存在**(老 runner 从没跑成过),执行通道=用户登录 Supabase dashboard SQL editor,我经浏览器贴 SQL 执行(源 IP 预检已通过:生产 source 取值 8 种全部被「基础枚举+batch_video% 通配」覆盖)。届时连同 20260702_drop_viral_clone.sql 一起执行。
- **提交节奏(用户指示)**:大步伐——里程碑级 commit(①文档+tag 已交;②S0.1-S0.3 数据层+拆除;③S0.4-S0.7)
- **TikTok photo post 结论(代码侧)**:已申请 scope=user.info.basic/video.publish/video.upload/user.info.stats;photo post 用同一 video.publish scope,大概率无需新申请,待用户登录开发者后台经浏览器最终核验(不阻塞)
- **link-video-script.ts 处置修订**:S0.2 不动它(link-video 旧页仍在线引用),S2 拆 link-video 时再摘进 salvage

## S0 任务清单(与会话内 Task #1-#9 对应)
| # | 任务 | 状态 | 验收 |
|---|---|---|---|
| S0.0 | 提交规划文档 + git tag `pre-demolition` | 待开工 | tag 存在 |
| S0.1 | 迁移:generations 加 library_status/batch_id/spec;valid_source 整改;blueprints+reference_cache 建表;runner 脚本 | 待开工 | SQL 落盘,本地校验语法 |
| S0.2 | 摘器官 → src/lib/blueprint/salvage/(qwen-client/segmenter/providers/prompt-compiler/link-video-script/schema-notes) | 待开工 | tsc 0 错误 |
| S0.3 | 删 viral-clone 全部代码 + DROP 迁移(历史迁移文件保留) | 待开工 | git grep 零残留;tsc+build 过 |
| S0.4 | worker 补 /api/stitch /api/probe + slideshow 补 zoompan | 待开工 | 代码审查;端到端留待 Mac worker 部署验证 |
| S0.5 | (main)/layout 按路由全屏豁免(opt-out) | 待开工 | /studio 占位全屏;抽查 5 页无 diff |
| S0.6 | quick-gen store 单槽扩多任务 + persist 版本迁移 | 待开工 | 连发 3 图不互顶;旧页回归 |
| S0.7 | JobSpec 类型 + toVideoBatchTask/toImageTask 适配器(先 diff 内联 vs BTM 参数差异) | 待开工 | tsc 过;差异清单记录在案 |
| S0.8 | (用户)TikTok photo post 权限确认;生产库跑迁移前先比对 valid_source 实际约束 | 待用户 | — |

## 预检结论(2026-07-02,开工前确认的事实)
1. **tsc 基线干净**:`npx tsc --noEmit` 0 错误——之后任何报错都是新改动引入。验证命令:`npm run type-check`;构建:`npm run build`。
2. **generations 已有 `status` 列**(任务执行状态,CHECK: pending/processing/completed/failed)→ 入库状态列必须叫 **`library_status`**,不能用 status。
3. **schema 漂移风险**:migration 008 的 `valid_source` 枚举 = (quick_gen, batch_video, batch_image, batch_video_prompt, image_factory, pro_studio),**不含 link_video**,但 `api/link-video/jobs/[id]/video/route.ts:341,425` 在写 `source:'link_video'` → 生产库约束必与迁移文件不一致(可能 dashboard 手改过)。S0.1 迁移写成防御式(DROP IF EXISTS + 重建全量枚举),生产执行前人工比对。
4. **迁移应用方式**:无 supabase CLI 链路;惯例 = 迁移 SQL 文件 + `scripts/run-*-migration.js`(dotenv 读 .env.local 的 SUPABASE_SERVICE_ROLE_KEY,拆分语句执行)。`.env.local` 已从主仓库复制进本 worktree(git-ignored,已验证)。
5. **迁移命名惯例**:`YYYYMMDD_描述.sql`,`ADD COLUMN IF NOT EXISTS`,结尾 `NOTIFY pgrst, 'reload schema';`。
6. **摘器官源文件已确认存在**:src/lib/viral-clone/{qwen-client.ts, segmenter.ts, providers/, prompt-compiler.ts, analyzer.ts, orchestrator.ts, planner.ts, stitcher.ts, vc-supabase.ts, qc/, enhance/, link-adapter.ts};src/lib/link-video-script.ts;scripts/ffmpeg-slideshow.py;mac-ffmpeg-worker/server.js。
7. **交叉依赖安全**:suchuang-api 被 12 处共用(删 link-video 不影响);deepseek/TTS 被 slideshow 共用(不可随拆)。viral-clone 无侧边栏入口、无 store、零外部依赖,最安全先删。
8. **node_modules 已安装**(worktree 内,npm install 完成)。

## 工作纪律
- **提交节奏**:每完成一个 S0.x 子任务即 commit(中文 commit message,惯例见 git log;结尾加 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>)。不 push,除非用户要求。
- **验收门**:每个子任务完成必须过 `npm run type-check`;涉及页面的过 `npm run build`。
- **删除纪律**:先摘器官(S0.2)后拆楼(S0.3);历史迁移文件永不删除,用新 DROP 迁移表达删表。
- **生产红线**:本机不直接对生产库执行迁移——runner 脚本写好后交用户执行(或用户明确授权后执行),执行前必做漂移比对(预检结论 #3)。
- **上下文纪律**:每完成一个子任务更新本文件「当前状态」;切窗口后从本文件恢复,不重读全部规划文档正文,按需查阅。

## S0.7 侦查结论(2026-07-02,JobSpec 依据)
- **提交路径差异(风险清单第 1 条证实)**:video-batch 页面内联路径(pro-studio/video-batch/page.tsx:2300-2314)传 characterId/characterName/characterReferenceImages/characterAsset 四个角色字段;**BTM 路径(background-task-manager.tsx:343-357)不传这四个字段**,只把角色参考图混进 unifiedImageUrls——角色元数据在 BTM 提交的任务里丢失。其余字段(prompt/imageUrls/aspectRatio/duration/quality/modelType/clientTaskId/mode/groupName)两路径一致。**处置:JobSpec 适配器补全角色字段;BTM 的缺失在 S1 收编时修**。
- 网关 DTO 字段与 VideoBatchTask store 形状的字段级清单:见本次侦查 agent 报告(要点已并入 src/lib/studio/job-spec.ts 注释)。
- clientTaskId 惯例:`vbt-${Date.now()}-${随机}`(video-batch-store.ts:169);图片 taskId:requestId 或 `openai-{mode}-${Date.now()}`。
- 两个 characterAsset 清洗实现并存:video 走 sanitizeCharacterAsset(models/submit),image 走 createCharacterAssetSnapshotFromSelection——结构应一致但实现不同,S1 统一。

## 关键路径速查
- 统一视频网关:`src/app/api/video-batch/models/submit/route.ts`(DTO: modelType/prompt/aspectRatio/imageUrls/characterAsset/clientTaskId/durationSeconds/quality/mode)
- 图片入口:`src/app/api/generate/image/route.ts`(844 行,服务端扣费+回滚)
- 执行引擎:`src/components/background-task-manager.tsx`(1255 行,4 个执行器 hook,挂在 (main)/layout)
- 布局:`src/app/(main)/layout.tsx`(container 硬包 + fixed 底部渐变,S0.5 目标)
- 角色选择器:`src/components/character-picker.tsx`(605 行,dialog/inline/cards 三 variant)
- 上传:`/api/upload/image`(FormData→OSS)
- TTS:`src/lib/elevenlabs-api.ts`(词级时间戳)+ `src/lib/doubao-tts-api.ts`
- Slideshow 渲染:`scripts/ffmpeg-slideshow.py`(1593 行)+ worker `/api/render` + `src/app/api/video-batch/generate-slideshow/route.ts`(1019 行)
