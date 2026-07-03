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
- **S2 代码侧完成(2026-07-02,四个里程碑 commit,每个过 tsc,S2.3/S2.4 过 next build;对抗审查修复见下)**:
  - **S2.1 链接腿(d2a555f)**:lib/studio/reference-parser.ts(自包含:Shopify /products/{handle}.json 优先→OG meta;safeFetch 手动跟跳逐跳过 isPrivateOrLoopbackHostname,修旧 redirect:follow 逐跳不校验缺口)+ reference-cache.ts(service role,成功 7 天 TTL+hit_count)+ /api/studio/parse-reference(缓存→抓取→商品图转存自有 OSS→商品卡三级降级:豆包视觉+meta 上下文→buildCardFromMeta 纯文本→规则切分;无第三方抓取 key 全直抓可用)。omnibox:商品模式贴链接→链接 chip(解析中/失败重试/完成);非商品模式贴链接出「切换并解析」建议 chip(不代切换);cardSource 守卫防视觉分析覆盖链接卡。blueprints 路由 sourceType 白名单 +product_link(source_ref.url 溯源)
  - **S2.2 蓝图编辑器(a5d8df1)**:GET/PATCH /api/studio/blueprints/[id](cookie client+RLS 兜属主 0 行→404;PATCH 白名单 product 重消毒/scenes 逐元素校验/status;updated_at 手动写);blueprint-drawer.tsx 右栏 420px(标题+卖点勾选与行内改写+分镜台词行内编辑);rerunBlueprint=按编辑后蓝图再出 N 条(同 blueprintId 新 batchId,验收「改卖点→3 变体」);batch-card「蓝图」入口 chip;activeBlueprintBatchId 与 activeJob 右栏互斥。**偏差:hook 选择缺生成源(hooks 恒空)留 S3**
  - **S2.3 AI 生成腿(571b5dc)**:ai-gen-prompts.ts(蓝图 scenes beat/line→salvage prompt-compiler SegmentPlan/StyleBible→逐镜英文 prompt);ai-gen-store(job 内嵌 scenes 子任务;scene.upstreamTaskId 恢复锚点;终态不可降级;复水归一化 setTimeout(0));BTM 第 6 执行器(scene 全量提交拿锚点→统一轮询→stitch;navigator.locks 单飞;积分不足止损;失败任务放行去重集合);/api/studio/ai-gen/stitch(videoUrls 强制自有 OSS 域;worker /api/stitch 503 重试一次;单镜跳拼接;task_id=jobId 幂等;**generations.spec 首个写入端**;拼接零新增扣费);omnibox 商品模式渲染腿切换(幻灯片|AI 生成,逐镜计价);retryJob ai_gen=原地只补失败镜;rerunBlueprint 支持 ai_gen(台词编辑经重编译生效)
  - **S2.4 拆 link-video(5dfe822)**:先摘器官——salvage/seed-recipes.ts(SYSTEM_PROMPT/SHOT_COUNTS/风格与平台描述/beat 结构/buildEcomScriptPrompt 槽位模板/SEED_RECIPES 3 条,纯数据零依赖);后拆楼——删约 6605 行(页面 8 文件+API 6 路由+store+script+parser+types)+sidebar 入口+database.ts 两表类型;保留 suchuang-api 全文件、source='link_video' 读取端、valid_source 枚举;新迁移 20260702_drop_link_video.sql(**生产执行待用户经 dashboard,连同 drop 表+清 link_video_pricing**)
- **S2.5 对抗审查修复完成(2026-07-02,5 维度找 bug+反驳式核实;tsc+build 过)**:
  - 3 实锤修复:①parse-reference 加每用户频控(5/分+100/天+并发 2,进程内滑动窗口;缓存键是全 URL hash 可被随机 query 强制 miss,频控是唯一硬闸)②readBodyWithCap 流式读取上限(OG 页 3MB/Shopify JSON 2MB/图片 15MB,Content-Length 预检+超限 cancel;修先 arrayBuffer 全量入内存的 OOM 面)③drop 迁移加在途扣款退款清扫(credits_used>已退 且 final_video_url 空 → 回补 profiles+credit_transactions 'refund' 流水)+ 整表归档(*_archive,必做非可选)
  - 6 自证修复(核实 agent 因订阅额度触顶未跑完,主循环逐项推演确认):④执行器锚点恢复断链——复水后带锚点的 pending scene 置回 generating 才进轮询(否则缺片直进 stitch);⑤retryTask 保留锚点(超时镜重试只续轮询防双扣费;上游明确失败的镜执行器已清锚点自然重提交);⑥scene 提交独立 try/catch(网络错误只失败该镜,不再被外层 catch 误标「拼接超时」);⑦stitch 前防缺片守卫(任何非 completed/无 URL 的镜都拦);⑧蓝图抽屉加估价显示+大批量/高积分二次确认(与 omnibox 同阈值,重跑路径不豁免);⑨蓝图落库 product.images 以 draft.attachmentUrls 为准(链接卡转存全败 images=[] 不再 400 堵死;估价镜数=附件数对齐);⑩连贴第二个链接先收走上一链接注入的附件(防两商品混料,onRemoveAttachmentsByUrl)
  - 自反驳不修(记录在案):多标签 rehydrate 整表覆盖(与 S1.2 幻灯片执行器既有模式同构);stitch 不校验视频归属(OSS 公读桶,持 URL 即可下载,拼接不构成新增访问面);reference_cache 跨用户共享命中(B 命中 A 的缓存用 A 的 OSS 图——公读桶下可接受,无删除流)
- **S2.6 复审收官(2026-07-02,用户要求复审上轮中断的对抗审查;8 agent 全跑完,tsc+build 过)**:
  - 复审背书:9 项 S2.5 修复全部确认闭合原缺陷;3 项自我反驳全部被独立复核维持;迁移 SQL 对照生产 schema dump 逐列核对通过(退款口径既不漏退也不误退、dashboard 一次贴入可执行、重跑幂等);数据一致性 happy path 账目闭环(task_id 三方对账/rerun 一致性/duration 语义安全)
  - 3 新实锤已修:①stitch 落库失败不再静默吞——降级链(完整行→去 spec→去 batch_id/group_name)+仍失败返 500(客户端标失败,重试经 task_id 幂等,不重复扣费);②执行器 phase1 任务消失(MAX_TASKS 裁剪/删除)立即中止,不再为幽灵任务提交扣费;ai-gen store 裁剪只裁终态;③两执行器(ai-gen/slideshow)锁内 rehydrate 后按 id 差集补回本页内存独有任务(修 last-writer-wins 丢新提交)
  - 4 低危顺手修:积分不足止损不误标带锚镜(置回 generating 续轮询)、PATCH scenes idx 去重校验、stitch 行补 group_name(任务中心分组对齐)、迁移头强制「代码先下线再执行 SQL」顺序
  - 3 低危记录不修:任务中心 ai_gen 一 job 记 N+1 条 completed(scene 行+成片行并存,钱账无恙,S3 任务中心改版时统一处理);提交请求在途时刷新有秒级双扣窗口(服务端 clientTaskId 无幂等去重,与既有 BTM 视频执行器同构,S3 网关加幂等键时一并修);上游永久 processing 时每次重试烧满轮询预算(UX,S3 加跨重试退避)
- **S2.7 脚本化验收(2026-07-02,dev server:3100 + 临时测试账号 300 积分 + 真实生产库;三轮共 34 项,代码路径全绿)**:
  - 免费层全 PASS:未登录 401 闸(5 路由)、/link-video 与 /api/link-video/* 死链 404、/studio 登录态 200、SSRF 闸(127.0.0.1/云元数据/非法 URL 400)、频控 429(>5/分)、缓存 fromCache
  - 链接腿真实解析 PASS:allbirds.com(Shopify)→ og_meta 通道出商品卡(标题「世界上最舒适的鞋子」+5 卖点;注:该站 og:image 被 filterValidImages 滤空→图 0,豆包视觉跳过走 meta 文本通道,属预期降级)
  - 蓝图 CRUD 全 PASS:POST(slideshow/ai_gen 双 renderMode)、GET、PATCH(卖点勾选+台词行内编辑回读一致)、三重校验(idx 重复/status 非法/零勾选 400)、不存在 404、assembly 拒绝
  - 幻灯片端到端 PASS:本地 ffmpeg 渲染(kenburns)→ OSS → generations 落库(source/batch_id)→ 入库 library_status=ready
  - **stitch 全链 PASS(第三轮用真实幻灯片 OSS 视频喂,绕开视频上游)**:单镜直通+10 项落库字段全对(source=studio/spec.render_mode=ai_gen/spec.blueprint_id/batch/group/三 url 一致/credit_cost=0)+零新增扣费+幂等 fromCache 无重复行+入库
  - **顺带发现并修复真实老 bug(丢钱,S1.2 埋):幻灯片扣费走 `rpc('deduct_credits')` 但该 RPC 在生产库不存在(401 hellobabygo... 不,是 supabase rpc 404),幻灯片自上线从未扣过费**。改直连扣费(adjustProfileCredits+insertCreditTransaction,与视频网关同原语,扣费失败响亮记录不再静默);复验 PASS:余额 295→294 + usage-1 流水
  - **视频上游 401(环境,非代码)**:grok/sora2 提交都因上游 `api.hellobabygo.com/v1/videos` 返回 401「无效的令牌」失败——dev 本机出口 IP 或该环境 key 未授权;视频网关是既有代码,生产环境有效(S1 视频腿已生产验收)。图片生成上游超时→退款链路正常(余额 294→299 验证退款回补)
  - 结论:S2 代码路径脚本可达部分全绿;人工验收只需覆盖 UI 手感层(拖拽/chip 交互/抽屉动效/@角色浮层)与需真实视频上游的 AI 生成腿多镜拼接(生产环境)。测试账号 s2-acceptance-bot@test.dev 数据已清、账号空壳残留可手删
- **S2.8 补 key 后复验(2026-07-02→07-03,用户授权 SSH 生产服务器取 key)**:
  - 从生产 `/var/www/tiktok-ai-mcn/.env.local` 拉 14 个本机缺失 key 到本机 .env.local(git-ignored,验收后可删):`VIDEO_PLATFORM_API_KEY`/`VIDEO_PLATFORM_BASE_URL`(视频统一网关,本机原缺→fallback 到无效 SORA2_API_KEY 导致 hellobabygo 401)、`MAC_WORKER_URL`/`MAC_WORKER_TOKEN`、`VIDEO_PLATFORM_IMAGE_*` 一整套(图片上游,本机原缺致图片超时)
  - **图片生成 PASS**:补 VIDEO_PLATFORM_IMAGE_* 后 gpt-image-2 正常出图(扣 5),原超时是缺 image key
  - **grok 单镜 AI 生成腿真实全链 PASS(关键)**:submit→轮询→真实 OSS 成片→stitch 直通→落库(source=studio/spec.render_mode=ai_gen/batch_id/credit_cost=0);积分对账 grok=5、stitch=0;双镜里失败镜自动退款验证正常(300→285 净扣 15=图片5+单镜5+双镜成功镜5)
  - **worker 多镜拼接未端到端验**:Mac worker 离线(探测 /api/probe 与根路径均 curl 000)+ 双镜里一镜遇上游偶发 HTTP/2 错误(curl 92,非代码)。但两端各自已验:src 侧 callWorkerStitch+落库/幂等/入库(S2.7 第三轮用真实 OSS 视频验)、worker 端 /api/stitch(S0.4 本机 ffmpeg 8.0 实测混合分辨率+无音轨补齐);契约层对齐(videos/aspectRatio/loudnorm/transition/503 重试),仅缺"在线 worker"这一外部依赖的接缝,留生产或 worker 上线后补
  - **结论:S2 全部代码路径脚本可达部分已全绿**(链接腿/蓝图 CRUD/幻灯片/图片/视频单镜 AI 生成腿/stitch 落库/频控/SSRF/死链);唯一未覆盖=在线 worker 多镜拼接(外部机器状态)+ UI 手感层(人工)
- **S2.9 人工验收通过 + UI 打磨(2026-07-03,1432f40)**:用户本地(dev:3100)人工走查**整体满意**;两点意见已落地——omnibox 操作台放大(760→980px,输入框 2→3 行)、链接解析取消按钮放大为文字按钮+Esc 取消、批次流版面放宽(max-w-5xl→7xl,全屏方向)。**S1+S2 人工验收完成**;方向备忘:后续布局往全屏排布走(S3 任务中心/rail 时统一设计)
- **S2.10 生产部署完成(2026-07-03,经用户授权)**:
  - **发现自动部署链早已失效**:服务器停在 81d60f4、落后 origin/main 20+ commit(不止 S2,含更早的 worker cron/publish 改动)。双重根因:①GitHub↔服务器 webhook secret 不齐,签名间歇 401(投递记录时好时坏);②唯一一次真触发的部署 `npm run build` 被 OOM SIGKILL(3.4G 小机未限 heap)
  - **手动部署上线**:ff-only 快进 81d60f4→a761c88(+8635/-13914)→ `NODE_OPTIONS=--max-old-space-size=2048` 限内存 build 成功(证明 OOM 修法有效)→ pm2 restart。线上验证:/ 200、/studio 200、/link-video 404、/api/link-video/* 404
  - **自动链修复(10a0804 + secret 轮换)**:webhook 部署命令加固(ff-only 拉取+npm install+限内存 build,进 git);经用户授权轮换 webhook secret——openssl 随机值同步写 GitHub hook 与服务器 pm2 env(stdin 传输不落终端,pm2 save 持久化,两端 sha256 前缀比对一致 ecc165f9);ping 事件验签通过(200,Skip deploy)
  - 插曲:推 10a0804 时旧 webhook 碰巧验签通过用旧命令拉起过一次部署,已自行了结(应用被多重启一次,无害,无残留进程)
- **自动部署链实弹验证通过(2026-07-03,a7706a8)**:push→投递 200(新 secret 验签过)→webhook 新加固命令自动完成 ff 拉取+npm install+限内存 build+pm2 restart→服务器 HEAD=a7706a8、/studio 200、Deploy success 落日志。**此后 push main 即自动上线**
- **S2.11 已知问题(用户线上验收发现,根因已坐实)**:多镜 AI 生成(3 图→3 镜 grok)逐镜生成全部成功(扣 15 分,scene 成片已在 generations),**stitch 拼接失败,任务显示裸 "fetch failed"**。根因双实锤:①生产日志 `[Studio AiGen Stitch] error: TypeError: fetch failed`(01:47);②生产 env 的 MAC_WORKER_URL 探测 000——**Mac worker 离线**,stitch 路由唯一通道断了。**验证路径:线上重试该失败 job——scenes 已 completed 零新扣费,直接重进 stitch**(retryTask→pending→执行器跳过已完成镜→stitch)
- **S2.11 修复完成(2026-07-03,本地 ffmpeg 拼接回退 + 对抗审查 4 实锤闭环;tsc+build 过)**:
  - 双通道:stitch 路由 worker `/health` 5s 预检定通道(该端点在 worker 鉴权中间件之外,免 token)——可达走 worker(单次预算 270s→120s,给回退留窗口;失败且已耗时<150s 才回退,防叠加超客户端 330s)、不可达直接服务器本地 ffmpeg;双败返回友好中文文案,最外层 catch 对 fetch failed/ECONN 类底层错误不再裸透传;BTM ai-gen 执行器 stitch fetch 包 try/catch,网络层错误转友好文案(超时走既有分支)
  - 新 `src/lib/studio/local-stitch.ts`:逐段下载(200MB/段上限)→ffprobe→scale+pad 统一分辨率+fps30+setsar+yuv420p、无音轨段 anullsrc 补静音→concat 硬切→loudnorm→uploadBuffer 上 OSS(generateVideoPath),滤镜/编码参数逐项对齐 mac-ffmpeg-worker/stitch.js(ffmpeg 6.1.1 兼容,审查核过);进程内并发闸 2(3.4G 小机防 OOM,超限 fail-fast 因重试免费幂等)
  - 对抗审查(5 维度找 + 每条 3 反驳者,10 原始发现 4 实锤)修复:①**同 jobId 在途单飞**(进程内 inflightStitches Map,拼接+落库整体一个航班,客户端超时重试/刷新复水合流不双跑双插——task_id 无唯一约束且 check-then-insert 对在途零防护)②**幂等查询 maybeSingle→limit(1)** 只认 completed+result_url 非空(历史重复行自愈,不再因吞 PGRST116 使 fromCache 永久失效)③**本地拼接 budgetMs 总预算**(路由按 320s-已耗时传入,下载/probe/ffmpeg 逐阶段查 remaining 并 clamp,耗尽友好失败——原先 30 段×90s 串行下载最坏 2700s 与客户端预算错配)④本地「拼接繁忙/超时」文案原样放行不被兜底吞掉
  - 复核 workflow(3 视角×2 反驳者)背书:singleflight/budget-math/regression 全部闭合,0 新实锤
- **S2.11 生产部署 + 生产验证 PASS(2026-07-03,d5bd609)**:push→webhook 自动部署成功(Deploy success 8e253b2..d5bd609,pm2 重启,/studio 200,ffmpeg 6.1.1+ffprobe 在位)。**测试账号脚本实弹验证全绿**(脚本 .temp/s211-verify.mjs,测试行已清):对生产 POST 2 段真实 OSS 成片 → **33s 出片**(20.08s/6MB 成片上 OSS)→ 幂等复测 fromCache 命中 → 落库 1 行(completed/source=studio/credit_cost=0/spec.render_mode=ai_gen/segment_count=2)。生产日志实锤对照:`01:47:11 TypeError: fetch failed`(原故障)→ `02:43:39 worker 不可达,直接走本地 ffmpeg 回退`(新通道)。用户对原失败批次点「重试失败 1 条」即可直接出片(零新扣费)
- **S3 开工:侦查+切分完成(2026-07-03,新工作树 zealous-leavitt-65253a)**:四路并行侦查(salvage/studio-UI/渲染基建/数据层)结论——数据层几乎零 DDL(blueprints 表 S0.1 已建齐 reference_video/origin/rights_ack/assembly/recipe_id,缺口全在 API 白名单层;配方需新建 recipes 表,content_templates 公开无属主不可复用);拼装腿基建全就位(单镜=generateSlideshow 单图分支+配音自动延时,stitch 双通道原样复用,只新写逐镜 orchestrator);拆解器官现成(analyzeVideoDeep→AnalysisArtifactV2,segmentByTimeline 零 ASR 依赖;缺 hook 识别/JSON 校验层/产物→蓝图映射桥);mp4 上传走已上线 OSS 预签名直传(oss-credentials+VideoUploader xhr 先例)。已知坑:豆包 TTS 无词级时间戳(中文字幕降级分句)、qwen 限流是进程内存变量、DashScope 对大视频限制未实测。**S3 切分**:
  - S3.1 拼装口播腿:新 /api/studio/assembly/scene(scene 素材图+台词 TTS+字幕→单镜段,复用 generateSlideshow)→复用 ai-gen stitch;BTM 第 7 执行器照抄 ai-gen 范式(锚点/单飞/幂等);blueprints POST 放行 assembly;omnibox 商品模式第三腿
  - S3.2 门B 拆解管线(服务端,UI 不开):qwen JSON 校验层+hook 识别(扩 analyzeVideoDeep schema)+产物→蓝图映射桥;POST /api/studio/deconstruct(rightsAck 强制显式+origin 溯源+结构报告落 origin);基准 harness(20 条爆款跑分评分卡)——**需用户备 20 条真实爆款 mp4(本地或已传 OSS)**
  - S3.3 门B UI(feature flag 后置,基准达标才开):omnibox 拆解模式(mp4 预签名直传+强制权利勾选)+结构报告视图+换商品重生成(商品卡+LLM 逐镜重写保结构→三腿任选出片)
  - S3.4 hooks 生成源+批量矩阵:hook 候选生成(修 S2.2 遗留 hooks 恒空)+drawer 多选+PATCH 白名单;矩阵展开层(use-studio-submit 层:hooks×音色×比例,变体参数落 generations.spec.variant)
  - S3.5 存为配方:recipes 表迁移(RLS 照抄 blueprints 四条 own)+脱敏 diff 确认(红队:LLM 脱敏必经人工 diff)+配方库+实例化(配方+商品卡→新蓝图);种子=salvage/seed-recipes 3 条内置
- **S3.1 拼装口播腿完成(2026-07-03,tsc+build 过,对抗审查 12 实锤闭环,本地实弹验证 PASS)**:
  - 链路:omnibox 商品模式第三腿「拼装口播」→ 蓝图 renderMode='assembly' → assembly-store(asm-*)→ BTM 第 7 执行器逐镜 POST /api/studio/assembly/scene(TTS 豆包/11labs 按音色前缀分流 → 无声单镜渲染:worker 优先/本地 python 回退,transition=none+kenburns+ASS 字幕 → **配音统一服务端 ffmpeg adelay=1000 合入**(与 python 字幕 VOICE_DELAY=1s 对齐)→ 上传内容寻址 OSS 路径)→ 复用 ai-gen stitch(asm- 前缀→spec.render_mode='assembly'/model='assembly',拼接零扣费)
  - 计费:1 积分/镜,**先渲后扣**(审查裁决,镜像幻灯片腿:失败/超时/进程崩溃一律零扣费,无退款路径;扣费失败响亮记录不拒付)。幂等=内容寻址 OSS head(新 oss.fileExistsStrict:非 404 异常上抛,绝不把存储抖动当 miss 重跑收费活)+在途单飞 Map+并发闸 3(一切收费动作前 fail-fast 429)+航班 280s 总预算(低于客户端 310s,僵尸不占闸)
  - 变体:音色=唯一差异轴,按台词语言池洗牌**无放回**轮转(修有放回撞声线出重复成片);空 CTA 行补默认口播;纯 emoji 台词适配器消毒兜底(商品标题→默认 CTA,修服务端 400 永败)
  - 对抗审查(5 维度找+每条 3 反驳者,44 agent,12 实锤全闭环):2 high(先扣后渲+进程重启=积分丢且重试双扣→改先渲后扣;worker 通道配音无 adelay 音画字幕错位 1s 且被幂等缓存固化→配音收敛服务端)+4 medium(退款子路径账实分离→退款路径整体删除;fileExists 裸 catch 瞬时故障双扣→strict 变体;无端到端超时僵尸占闸全端点 429→280s 预算;音色有放回碰撞→无放回)+6 low(止损正则误杀积分冲突文案→先渲后扣消解;跨标签重试被锁后 rehydrate 吞→按 updatedAt 取新合并;durationSec 30s 上限被 python 推翻元数据失真→去上限回真值;失败路径 output 产物泄漏→orphanFiles finally 回收+merge clearTimeout;纯 emoji 台词;抽屉卖点/台词说明对逐镜腿误导→文案按腿修正)
  - **本地实弹验证 PASS**(.temp/s31-verify.mjs,dev:3100+真实生产库,测试行已清):单镜 13.1s/7.2s 出段(本地 python 通道,含 aac 音轨,5.93s=TTS4.3s+1.6s 缓冲精确对上)→ 幂等重放 0.9s fromCache 零扣费 → 余额恰 -2+usage 流水 task_id 对齐 → stitch 7.0s 出 11.87s 成片(含音轨)→ 落库 1 行全字段对(completed/source=studio/model=assembly/spec.render_mode=assembly/segment_count=2/credit_cost=0)
  - 记录在案:ai-gen/slideshow 执行器存在同款「跨标签重试被 rehydrate 吞」窗口(S3 收官统一清扫);卖点勾选变更不重建逐镜台词(与 ai_gen 既有语义一致,S3.4 时统一);字幕烧录视觉效果待人工验收目检;worker merge-audio 无音轨 fallback 缺 adelay 的缺陷因配音不再交 worker 而不可达(worker 代码未动)
- **S3.2 门B 拆解管线(服务端)+基准 harness 完成(2026-07-03,tsc+build 过,对抗审查 8 实锤闭环,实弹冒烟 PASS×2)**:
  - 管线:新 src/lib/studio/deconstruct.ts——扩展 prompt(在 analyzeVideoDeep 骨架上加 hook 识别{type:痛点|悬念|对比|场景,text,rationale}/cta/why_viral)→ salvage analyzeVideo(qwen omni-plus,timeoutMs 135s×2 次=最坏 273s<300s 墙)→ parseDeconstructReport(JSON 首{末}截取(不做全局 ``` 替换防改写字符串内容)+逐字段消毒/兜底/排序+**quality 质量信号**{missing_time_count,reordered,utterance_coverage,distinct_start_count})→ buildDeconstructBlueprint(segmentByTimeline 切段→**空台词段剔除+beat 按新段数重排**(修空组时间回退 0/cta 挂开头画面)→蓝图 scenes+hooks)
  - 路由:POST /api/studio/deconstruct——rightsAck 必须显式 true(与商品腿缺省 true 相反)+isOSSUrl 闸(只收上传)+频控(3/分+30/天+同用户并发 1+Map>5000 剪枝)+**幂等锚**(同用户同 URL 24h 内 ready 蓝图直接返 fromCache,force=true 绕过;修响应丢失重试双跑 qwen+重复插行)→ blueprints 落库(source_type='reference_video',product=null,render_mode=null,origin={viral_ref,why_viral,license:'structure_only',report},status='ready')。**计费:MVP 免费**(频控兜滥用,付费化留数据说话)
  - 基准 harness:scripts/deconstruct-benchmark.mjs(mp4 目录上传 OSS(重试 1 次,单条失败跳过不作废整跑)或 urls.txt→逐条打路由(420s 超时≥服务端最坏,修级联 429 冤杀)→打分:解析 30/转录 10/**时间线 15(看 quality 原始信号,消毒后单调恒真是死代码——审查 high 实锤)**/分镜 15/hook 15/why_viral 10/**cta 5(只认模型识别,末镜 beat 恒 cta 属模板)**→report.md;门槛=解析率≥90%+均分≥80+hook 完整率≥80%+人工抽查 5 条,样本<20 标注不作开 UI 依据;--cleanup 按 title 前缀兜底删行+删 OSS 对象)
  - 对抗审查(3 维度×3 反驳者,33 agent,8 实锤全闭环;2 条 0/3 驳回:PASS 无样本量校验(已顺手加标注)、成本放大面);**实弹冒烟 PASS×2**(用 S3.1 成片喂 qwen:40s 出报告,逐字转录准确、6 分镜节拍、hook/cta/why_viral 有洞察;幂等重放 0.7s fromCache;负例闸 rightsAck/外部 URL 均 400;落库溯源字段全对,测试行已清)
  - **待用户:20 条真实爆款 mp4 到位后跑 `node scripts/deconstruct-benchmark.mjs <目录>`(dev server 3100 需在跑),达标(自动三线+人工抽查)才开 S3.3 UI**
- **S3.3 门B UI 完成(2026-07-03,tsc+build 过,对抗审查 5 实锤闭环,数据链实弹验证 PASS;feature flag 后置)**:
  - 链路:omnibox「爆款拆解」模式(**NEXT_PUBLIC_ENABLE_DECONSTRUCT=1 才显示**,基准达标前生产不开;本机 .env.local 已加)——mp4 预签名直传(oss-credentials+xhr PUT,≤200MB 预检,上传代际 nonce)+视频 chip+**强制权利勾选**(仅复用结构与创意)→ 发送即插「拆解中…」乐观卡**立刻返回**(fetch 页面后台续跑 420s)→ 成功更新卡为「结构报告」+右栏空闲才自动开抽屉;失败判死可移除重试
  - **对账恢复(审查 high 实锤修复)**:新 GET /api/studio/deconstruct?videoUrl(按 URL 查 24h 内 ready 拆解蓝图,零 qwen)+useDeconstructReconciler(挂 studio 页:20s 首查/30s 轮询/15min 判死)——刷新/关页丢请求不再产生不可见孤儿蓝图,也不再重烧 qwen(原同步等待设计:刷新即孤儿+重传新 URL 必幂等 miss 双倍成本)
  - 报告抽屉(blueprint-drawer isDeconstruct 分支):hook 卡(类型徽章+文案+为什么留得住人)/「这条为什么火」列表/节奏条(beat 配色按时长比例)/CTA 卡/完整转录折叠/逐镜台词编辑(共用,引导「出片前替换为自己的商品」);save 只 PATCH scenes;「用此结构出 N 条」走既有 ai_gen rerun 链(spec 存 grok/9:16/10s 骨架,合成最小卡,**出片一律弹 structure_only 确认**);GET 蓝图路由 select 加 origin
  - 其余审查修复:成功回调不再无条件清全局草稿(乐观返回后 reset=点击即清,与其他模式一致);确认弹窗阈值/文案改用 draft.count(修其他模式遗留 stepper 值在拆解模式弹「N 个图片任务」);拆解出片批次标「结构复刻」(修 rerun 硬编码 mode='product' 丢溯源);报告入口 chip 文案「报告」;cta 占位不再假承诺(按腿说明留空行为)
  - 实弹验证 PASS(.temp/s33-verify.mjs):拆解→GET 蓝图带 origin.report→PATCH 纯 scenes 回读一致→GET 对账正反例(found/blueprintId/report 完整;不存在 URL found=false),测试行已清。**UI 手感层(模式切换/上传进度/报告排版/确认弹窗)留人工验收**(flag 开着,dev:3100 即可走查)
  - 偏差记录:「换商品重生成」的 LLM 自动逐镜重写不在本期(红队裁决:门B MVP 只出结构报告;当前替换=用户在抽屉手动改写台词+确认,自动重写留首批付费后);移除「拆解中」卡后服务端仍完成的蓝图成孤儿(用户显式操作,可接受);hooks 候选仍未在抽屉展示(S3.4)
- **S3.4 hooks 生成源+批量矩阵完成(2026-07-03,tsc+build 过,对抗审查 6 实锤闭环,实弹验证 PASS)**:
  - hooks 生成源(修 S2.2 遗留「hooks 恒空」):新 POST /api/studio/blueprints/[id]/hooks——qwen flash 按商品卡出 4 个候选(痛点/悬念/对比/场景各一,≤40 字口语化)覆盖写 blueprints.hooks(旧勾选按 text 保留;抽屉本地未保存勾选也按 text 合并回);拆解蓝图 400(其 hook=原片逐字台词,属报告信息项);PATCH 白名单 +hooks(sanitizeHooks:四枚举/≤300 字/id 循环唯一化/≤8 条)
  - 批量矩阵(蓝图抽屉「再出 N 条」):hooks 多选 UI+「生成候选」按钮+比例多选 chips(空=沿用)→ rerunBlueprint 矩阵展开(buildMatrixPlan:hook 逐格轮转×aspect 按 hook 整轮**步进**(修同相位轮转 2×2 只走对角线的覆盖缺陷)→ 三腿 WithMatrix 适配器:hook 注入 hook 镜台词(幻灯片=关键词前缀;assembly 保音色无放回轮转);组合数>条数时抽屉如实提示部分组合不参赛
  - variant 溯源全链:JobSpecBase.variant{hook_id,hook_text,voice_id,aspect} → 任务(ai-gen/assembly store)/renderRequest(slideshow) → stitch 路由键白名单落 spec.variant + generate-slideshow 落 spec{render_mode:'slideshow',blueprint_id,variant}(**幻灯片腿首次写 spec/blueprint_id,补 S2 侦查记录的「再跑一批溯源断链」缺口**;insert 失败去 spec 降级重试)
  - 审查修复(2 high):①**拆解蓝图 hook 恒不进矩阵**(原 selected:true 会被自动注入,原片逐字文本进成片违 structure_only 且覆盖用户已替换台词——deconstruct.ts selected:false+抽屉不展示候选区+handleRerun 强制空)②**幻灯片单条重试克隆失败任务 renderRequest**(保 hook 前缀/比例/variant;原按基础 spec 重建=重试变回基础组合还照常扣费);+M 覆盖步进/L id 唯一化/L 本地勾选合并/L 覆盖提示
  - 实弹验证 PASS(.temp/s34-verify.mjs):hooks 真实生成(4 型文案质量在线)→PATCH 勾选回读→负例 400→拆解蓝图 400→stitch spec.variant(evil 键被滤+blueprint_id 对)→幻灯片真实渲染 spec 全对(render_mode/blueprint_id/variant),测试行已清
  - 偏差记录:「脚本角度(LLM 重写 2-3 版)」维度未做(幻灯片 diverse 文案已覆盖;ai_gen/assembly 逐镜台词重写留 S3.5 配方/付费后);矩阵入口只在蓝图抽屉(omnibox 首次提交时蓝图尚无 hooks);卡头 aspectRatio 显示基础值(多比例变体明细在 spec.variant)
- **S3.5 存为配方完成(2026-07-03,tsc+build 过,对抗审查 11 实锤闭环,实弹验证 PASS)——S3 代码侧收官**:
  - 数据层:新迁移 **20260703_recipes.sql**(recipes 表+四条 own RLS,照抄 blueprints 模板;**待用户经 dashboard 执行**,与 20260702_drop_link_video.sql 一起)。**内置种子配方不依赖新表**(纯常量):迁移未执行时种子链路照常可用,GET dbReady=false+POST 503 友好降级(已实弹验证)
  - 配方核心:src/lib/studio/recipes.ts——fillSlots({商品名}/{卖点N}/{价格},卖点轮转)+instantiateRecipe(填槽+**素材槽为空一律按商品图轮转补齐**,不限 slot.kind——修门B配方 ai_gen 槽不补图致拼装腿全滤空死链)+requiredPointCount(槽位号门槛)+BUILTIN_RECIPES 3 条种子(三镜带货/口播种草 5 镜/清单体)
  - 实例化:blueprints POST 接 recipeId(seed-*=常量/UUID=用户配方 RLS own)→**卖点门槛 400**(槽位号>勾选数=复读机成片,审查实锤;已实弹验证)→instantiateRecipe 替代默认骨架→recipe_id 落库+use_count best-effort;omnibox 商品模式配方 Select(📐内置+📕用户,**选中即应用配方的腿/比例/每镜秒数**——修 render_mode/globals 写而不读)
  - 脱敏:POST /api/studio/recipes/deidentify(qwen flash 槽位化建议稿+visual 结构描述保留)→抽屉「存为配方」→**diff 确认弹窗(Portal 到 body**——修 aside backdrop-blur 截获 fixed 定位)逐行原文 vs 可编辑槽位稿+空行预检指认+structure_only 提示→POST /recipes(消毒:空行拒/asset_ref 恒清/origin 白名单/sourceBlueprintId UUID 校验)→成功广播 recipes-updated 刷新 omnibox 列表
  - 审查修复(2 high):①**估价/门控按配方镜数**(原按图数:5 镜配方×2 图时 assembly 估 2 实扣 5,余额不足者半途烧分——draft.recipeSceneCount 全链)②门B配方素材槽补齐(见上);+M 空串 imageUrl 击穿 visual 兜底(||归一)、**配方对幻灯片腿零效果→scriptText 通道**(配方台词拼整片脚本经 aiCaption.generatedTexts 直达渲染端,rerun 时台词编辑重建)、卖点门槛、弹窗 Portal;+L 配方预设应用/visual 保留/空行指认/列表刷新(loaded 成功才置位+事件)/UUID 校验+isTableMissing 收窄(42P01/PGRST205)
  - 实弹验证 PASS(.temp/s35-verify.mjs):种子实例化(5 镜槽位全填/素材轮转/hooks 实例化)→负例 400×2→脱敏建议稿(LLM 起名「痛点反转带货模板」,槽位化干净)→表未就绪守卫→卖点门槛 400。**用户配方全链(存→列表→实例化)在迁移执行后由同脚本自动覆盖**(dbReady 分支已写好)
  - 偏差记录:配方矩阵 hook 注入对 scriptText(幻灯片)只作用于关键词层(重新生成时生效);配方库无独立管理页(删除/改名走 S4 模板中心收编);拆解蓝图「存为配方」的 visual 保留但 hook 不进配方候选(structure_only 纪律)
- **S3 代码侧全部完成(S3.1 拼装腿/S3.2 拆解管线+基准 harness/S3.3 门B UI(flag)/S3.4 hooks+矩阵/S3.5 配方)。四轮对抗审查共 42 实锤闭环,五轮实弹验证全绿。**
- **S4 开工:侦查+裁决完成(2026-07-03,新工作树 great-cohen-d479a7,自 df6fbef 快进续)**:四路并行侦查(模板中心/TikTok 发布基建/video-batch 依赖图/图文帖基建)结论——模板中心是零交叉依赖孤岛(938 行纯浏览,content_templates 公开表);**发布基建完整生产在线**(tiktok_accounts+token 刷新/publish_tasks 队列/cron/content-posting.ts 视频直发已用 PULL_FROM_URL→域名通道已可用,photo 只缺 content/init 实现);generations.valid_source 已含 photo_post(S0.1 远见),blueprints.render_mode 的 DB CHECK 不含→**裁决:图文帖蓝图 render_mode 落 null+globals.render_intent='photo_post'(拆解蓝图 null 先例,免第三个待执行迁移,本地当天可端到端验)**;「三旧模块」以 BLUEPRINT 口径=viral-clone(S0)+link-video(S2)+video-batch(S4);image-batch/quick-gen/image-slideshow 壳留用量数据裁决(quick-gen store 与 Studio 共用,现动风险大)
- **S4.1+S4.2 图文帖腿+TikTok 直发完成(2026-07-03,a3c2467,tsc+build 过)**:omnibox 商品模式第四腿「图文帖」(免费:图=素材图序每变体独立洗牌首条保原序,文案=deepseek 一次 diverse 出 N 条——新 generatePhotoPostCaptions,TikTok 图文语域 emoji+hashtag,与 TTS 口播文案分开);/api/studio/photo-post 同步落库(source=photo_post/task_id=pp-* 幂等/频控 10 分+100 天/LLM 失败规则模板兜底 spec.caption_source 留审计);photo-post-store(无 BTM 执行器——同步链路提交层后台 fetch 写回;复水 generating→failed,重试幂等恢复);矩阵 hook→文案开头轮转,比例维度隐藏;抽屉图组网格+文案复制。**直发**:content-posting.ts 加 initPhotoPublishFromUrl(content/init,media_type=PHOTO,PULL_FROM_URL 与生产视频直发同域,mock 镜像齐);/api/studio/photo-post/publish POST 起飞+GET 轮询(creator_info 前置校验/token 刷新复用/完成落 library_status=published+spec.publish 溯源)。**降级**:抽屉「导出图包」jszip 图序+文案.txt(经既有 download-proxy)
- **S4.3 配方库收编模板中心完成(2026-07-03,330943e,tsc+build 过)**:/templates 重写为「配方库」双 tab(我的配方=内置种子+用户配方卡片,去使用=携参跳 /studio?recipe=、重命名/软删走新 /api/studio/recipes/[id] PATCH/DELETE(archived);灵感模板=原 content_templates 浏览/收藏/复制原样保留,旧链接不断);omnibox ?recipe= 携参预选(seed 立即应用/用户配方等列表载入后补应用,应用即清 query);**未执行的 20260703_recipes.sql 就地补 photo_post 枚举+幂等约束重建段(已执行过旧版的话重贴一次即升级)**;deidentify 按 globals.render_intent 还原 photo_post 配方腿;侧边栏「模板中心」→「配方库」
- **S4.4 video-batch 大页消解完成(2026-07-03,d4eff88,tsc+build 过)**:4246 行旧页替换为服务端 redirect('/studio')(外部书签不断);侧边栏「素材生成视频」下线,dashboard 快捷入口/models 页「去生成视频」/BTM 运行态胶囊/landing 页脚双语全部改向 /studio;video-batch store 与 /api/video-batch/* 网关原样保留(Studio 视频腿宿主);旧页无 batchId 草稿失去执行入口(已提交任务结果仍在 generations/任务中心);旧页「任务模板」UI 随页下线由配方库替代(image-batch 模板 UI 不受影响)。**三旧模块界面全下线达成(BLUEPRINT §七 S4 验收线)**
- **S4.5 对抗审查+实弹验证完成(2026-07-03,f56298f,tsc+build 过)**:5 维度找+每条 3 反驳者(92 agent;**后 24 条的反驳者全部撞会话额度墙,按 S2.5 先例主循环逐项推演裁决,不当已驳回**)。3 票制实锤 4 条全修:①[high] photo-post POST 无在途单飞,同 taskId 并发 check-then-insert 双插行→逐任务在途认领 Set(finally 释放)+被占任务返 inFlight(客户端保持生成中不判死);②publish 选行 limit(1) 无排序,双行下 processing/published 写散→恒按 created_at asc 取最早行;③published 被「入库」降回 ready→客户端三处候选过滤+服务端守卫——**守卫初版连环炸出两个真 bug 均修:裸 .neq 在 SQL 三值逻辑下把 NULL 行滤掉(入库全 miss);本项目 PostgREST 对百分号编码的 or= 参数报 42703(supabase-js 恒编码,实测复现)→拆两次互斥更新绕开,此坑记档**;④频控口径不对称(首发整批 1 戳/逐条重试每条 1 戳,批量重试>10 必撞闸)→服务端只对真实生成计戳(fromCache/在途合流免费)+客户端同批次重试 250ms 合流单 POST。主循环裁决补修 8 条:发布锚(accountId/publishId)持久化进 store——卸载/刷新后重开抽屉自动恢复轮询,不再诱导重复发帖(原状态只活在一次性轮询里);PhotoPostActions 按 taskId key 防切任务串台;photo_post 专属校验(1-9 图,不再被轮播 2 图文案截胡);?recipe= 携参加固(死配方不预选+pending 首载即清,迟到 load 不覆盖用户设置);落库降级链对齐 stitch 四档(spec=图序/文案本体尽量保住);旧版 recipes 表 23514→400 指路重贴;publish POST 频控 6/分;重命名弹窗 autoFocus+Enter。记录不修(与既有裁决同构):多标签复水互踩(S3.1 同款窗口)/进程内频控多实例失效(deconstruct 同款,生产 pm2 单实例)/models 页角色携参(跳裸 /studio,@ 重选)/fallback 文案静默降级(3 票维持=契约内设计)。**实弹验证 14 项全绿**(.temp/s4-verify.mjs,dev:3100+真实生产库:蓝图 render_intent/真实 LLM 文案×2 变体 hook 开头/落库全字段/幂等重放零新增/**并发单飞双请求→1 行**/负例 5 连/零扣费余额不动/入库/**published 对 ready 入库免疫**/发布闸 4 连/配方 503 守卫/307 redirect;测试行已清)
- **S4 代码侧全部完成(S4.1 图文帖腿/S4.2 直发+导出/S4.3 配方库收编/S4.4 大页消解/S4.5 审查 12 项修复+验证)。BLUEPRINT §七 总排期 S0-S4 代码侧收官。**
- **下一步(收尾,均待用户)**:①Supabase dashboard 执行 **20260702_drop_link_video.sql + 20260703_recipes.sql**(后者含 S4 photo_post 枚举幂等升级段,**若之前已执行过旧版需重贴一次**;执行后用户配方全链+photo_post 配方自动激活);②**备 20 条真实爆款 mp4** 跑 `node scripts/deconstruct-benchmark.mjs <目录>`(dev:3100 需在跑)——达标后生产 env 加 NEXT_PUBLIC_ENABLE_DECONSTRUCT=1 开门B UI;③dev:3100 人工走查 S3+S4 UI:S3(拼装腿出片/配方选择与存为配方 diff/门B 上传→报告)+ S4(图文帖出片→抽屉图组+文案→**直发 TikTok 用已授权账号实测一条**(脚本只能验到参数闸;PULL_FROM_URL 域名与视频直发同通道,理论通)→导出图包;/templates 配方库页;/pro-studio/video-batch 跳转);④裁决 push main 上生产(自动部署链在,push 即上线;**S3+S4 共 10 个 commit 一起上**)。S5 候选(未裁决):数字人腿(可选)/publish_tasks 队列收编 photo(定时+多账号矩阵发图文)/image-batch·quick-gen·slideshow 壳页按用量下线
- ~~**下一步:S1+S2 人工验收 → S3**~~(已完成,见上):①dev server 真实登录态走查:S1 四路径 + 贴海外链接(Shopify 站最稳)→蓝图→改卖点→3 变体 + AI 生成腿一条(需 MAC_WORKER_URL 隧道通,留意 worker /api/stitch 无生产先例)+ /link-video 死链确认;②用户经 dashboard 执行 20260702_drop_link_video.sql(含退款清扫+归档,先看 NOTICE 输出);③S3 = 拼装腿+爆款拆解(20 条基准门槛)+批量矩阵+存为配方(BLUEPRINT §七,收钱线在 S2 后)
- **分支**:`claude/great-cohen-d479a7`(worktree:E:\StarGaze\.claude\worktrees\great-cohen-d479a7,S4 所在,自 df6fbef 快进续含全部 S3;S3 在 zealous-leavitt-65253a,S2 及以前在 practical-curie-42f4b1)。只本地 commit,push main=自动生产部署,须等人工验收后由用户裁决。**dev:3100 现由本工作树起(S4 验证时把旧工作树的 dev server 换掉了)**
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
