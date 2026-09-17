# 私有预览代码交付范围

日期：2026-09-17。用户已明确授权验证后创建 commit 并推送独立分支。交付分支为 `codex/tiktok-private-preview-release-20260917`，基线为 `4e3033ad`。本文不代表推送成功回执，实际 commit 由开发完成后回传；不包含生产部署、迁移或云资源授权。

## 核心文件

- `src/app/api/publish/previews/route.ts`：存储 readiness。
- `src/app/api/publish/previews/[itemId]/route.ts`：owner 鉴权、预留、finalize、封面/视频读取代理。
- `src/lib/publish/private-preview-contract.ts`：对象键、上传策略和 Range 契约。
- `src/lib/publish/private-preview-storage.ts`：专用 OSS 凭证与私有存储检查。
- `src/lib/publish/save-task-preview.ts`、`preview-poster.ts`：客户端上传和封面提取。
- `src/components/publish/TaskVideoPreview.tsx`：展示与旧任务补存。
- `scripts/sweep-tiktok-previews.mjs`：待清理队列处理，可能真实删除对象。
- `supabase/migrations/20260916_tiktok_private_previews.sql`：测试库已经执行，交付文件不代表再次执行授权。
- `env.example`、`src/types/database.ts`：配置模板与类型。
- `tests/tiktok-private-previews.test.cjs` 及相关任务展示测试、交接/迁移/自检文档。

## 隔离结果与必要依赖

已在独立工作树按下列边界隔离，原开发工作区不改动：

- 发布入口 `src/app/(main)/publish/page.tsx` 仅接入有界封面提取、创建前 readiness、init 前保存预览及新错误的语言选择；没有纳入整页语言/导航重构。
- FILE_UPLOAD init route 需要 ready 预览门槛，任务 API 和数据库类型需要配套字段。
- `TaskVideoPreview` 引用 `use-tiktok-language`、`task-presentation`、`local-task-preview`；任务卡片/详情负责传入关联 ID。
- 任务管理纳入筛选、总览、请求隔离和任务卡片语言依赖，保留紧凑布局与预览关联；header 仅纳入退出时清除预览事件；隐私页仅纳入私有副本的保留/删除披露。
- 排除账号页、YouTube/Facebook/Instagram 界面重构、sidebar、loading、多任务发布页及全局语言批处理脚本，不修改其原有测试。
- 定向展示测试为 `tests/tiktok-preview-presentation.test.cjs`，选取原待交付展示测试中与本次有关的场景；不纳入跨平台导航/删除重构的测试。原有已提交的测试保留并全量执行。

## 提交前步骤

1. 按 diff/hunk 和 import 依赖核对实际纳入文件，保留原工作区无关改动。
2. 在独立目录验证拟交付版本的完整依赖，执行定向/全量测试、type-check、lint 和 build。此前整个工作树测试通过不等于拆分后的 commit 自动通过。
3. 检查不包含 `.env.local`、凭证、构建目录、日志或视频文件。
4. 用户已确认提交/推送。目标为原仓库 origin 的独立分支；禁止 force push，完成后核对远端 commit 与本地一致。
5. 同事按实际 commit 核对 `tiktok-previews/` 前缀和 OSS 调用，明确宿主/预算后推进测试基础设施。

生产部署、测试迁移重放、存储清理、真实 TikTok 发布均不随代码交付自动授权。
