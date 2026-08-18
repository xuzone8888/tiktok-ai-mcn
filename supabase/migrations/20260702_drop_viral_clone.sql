-- ============================================================================
-- 20260702 - 拆除 viral-clone(S0.3)
-- 决策:旧代码推倒重做(见 docs/BLUEPRINT_PIPELINE_PLAN.md 门B),表数据近零直接弃。
-- 代码器官已摘至 src/lib/blueprint/salvage/(qwen-client/segmenter/prompt-compiler/providers)。
-- 历史迁移文件(20260415/20260416×2)保留不删,本文件表达删表动作。
-- 幂等:可重复执行。
-- ============================================================================

DROP TABLE IF EXISTS public.viral_clone_events CASCADE;
DROP TABLE IF EXISTS public.viral_clone_attempts CASCADE;
DROP TABLE IF EXISTS public.viral_clone_segments CASCADE;
DROP TABLE IF EXISTS public.viral_clone_jobs CASCADE;
DROP TABLE IF EXISTS public.viral_clone_assets CASCADE;

NOTIFY pgrst, 'reload schema';
