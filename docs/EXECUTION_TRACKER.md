# 执行追踪(长程任务续接锚点)

> **切窗口/新会话必读**:本文件是执行状态的唯一事实源(SSOT)。恢复工作时:①读本文件;②读三份规划文档(见下);③从「当前状态」继续。每完成一个子任务立即更新本文件并提交。

## 规划文档(只读,不要重新讨论已裁决的事)
- [PRODUCT_STRATEGY_2026H2.md](./PRODUCT_STRATEGY_2026H2.md) — 总战略/定位/路线图
- [STUDIO_REDESIGN_PLAN.md](./STUDIO_REDESIGN_PLAN.md) — Studio 统一创作界面(omnibox+批次流)
- [BLUEPRINT_PIPELINE_PLAN.md](./BLUEPRINT_PIPELINE_PLAN.md) — 蓝图管线重构(裁决版,含 S0-S4 总排期)

## 当前状态
- **阶段**:S0 打底(总排期见 BLUEPRINT 文档 §七)
- **进行中**:无(准备完成,待用户确认开工)
- **已完成**:前期准备(见下方「预检结论」)
- **分支**:`claude/practical-curie-42f4b1`(worktree:E:\StarGaze\.claude\worktrees\practical-curie-42f4b1)
- **下一步**:S0.0(提交文档+打 tag)→ S0.1 → S0.2 → S0.3 → S0.4-S0.7(顺序灵活)

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

## 关键路径速查
- 统一视频网关:`src/app/api/video-batch/models/submit/route.ts`(DTO: modelType/prompt/aspectRatio/imageUrls/characterAsset/clientTaskId/durationSeconds/quality/mode)
- 图片入口:`src/app/api/generate/image/route.ts`(844 行,服务端扣费+回滚)
- 执行引擎:`src/components/background-task-manager.tsx`(1255 行,4 个执行器 hook,挂在 (main)/layout)
- 布局:`src/app/(main)/layout.tsx`(container 硬包 + fixed 底部渐变,S0.5 目标)
- 角色选择器:`src/components/character-picker.tsx`(605 行,dialog/inline/cards 三 variant)
- 上传:`/api/upload/image`(FormData→OSS)
- TTS:`src/lib/elevenlabs-api.ts`(词级时间戳)+ `src/lib/doubao-tts-api.ts`
- Slideshow 渲染:`scripts/ffmpeg-slideshow.py`(1593 行)+ worker `/api/render` + `src/app/api/video-batch/generate-slideshow/route.ts`(1019 行)
