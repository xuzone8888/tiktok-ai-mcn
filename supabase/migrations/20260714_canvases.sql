-- ============================================================================
-- 20260714_canvases.sql — 超级画布文档表(P0)
-- ADR:jsonb 只存拓扑+引用;禁 dataURL/签名 URL,只存 OSS object key;
-- 执行状态唯一真相源=generations,本表只存 nodeId→引用。幂等。
-- 注意:本表无 updated_at 触发器,updated_at 由写路由手动更新
--      (沿用 blueprints 惯例,[id]/route.ts:16,212)。
-- 执行:用户经 Supabase dashboard SQL editor(生产无 exec_sql RPC);本机只
--      做语法/结构自校(scripts/verify-canvas-migration.mjs),绝不对生产执行。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.canvases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '未命名画布',

    schema_version INTEGER NOT NULL DEFAULT 1,          -- 文档 schema 版本(zod 迁移注册表 v1→v2→…)
    doc JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[],"groups":[]}'::jsonb,
    deps JSONB NOT NULL DEFAULT '{"models":[],"voices":[],"characters":[],"assets":[],"recipes":[]}'::jsonb,

    rev BIGINT NOT NULL DEFAULT 0,                      -- 保存序号:UPDATE…SET rev=rev+1 WHERE rev=:expected(补丁 rebase 的服务端锚)
    writer_tag TEXT,                                    -- 单写者:当前写者标签 id(navigator.locks 持有者上报)
    writer_heartbeat_at TIMESTAMPTZ,                    -- 写者心跳;超时(如 30s)其他标签可接管
    doc_bytes INTEGER,                                  -- 保存时服务端计算;>2MB 硬拒存;>512KB 软告警

    share_slug TEXT UNIQUE,                             -- P3 只读分享链接(NULL=未分享)
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvases_user_updated
    ON public.canvases(user_id, updated_at DESC);

ALTER TABLE public.canvases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canvases_select_own" ON public.canvases;
CREATE POLICY "canvases_select_own" ON public.canvases
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "canvases_insert_own" ON public.canvases;
CREATE POLICY "canvases_insert_own" ON public.canvases
    FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "canvases_update_own" ON public.canvases;
CREATE POLICY "canvases_update_own" ON public.canvases
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "canvases_delete_own" ON public.canvases;
CREATE POLICY "canvases_delete_own" ON public.canvases
    FOR DELETE USING (auth.uid() = user_id);
-- 注:P3 分享改造时另加 share_slug 匿名只读策略,当前不建。

COMMENT ON TABLE public.canvases IS '超级画布文档:仅存拓扑+引用(nodeId→taskId/generationId/blueprintId/assetId);执行状态唯一真相源=generations;媒体只存 OSS object key;无 updated_at 触发器,写路由手动维护';
COMMENT ON COLUMN public.canvases.rev IS '乐观并发序号,补丁保存 CAS 锚;配合 writer_tag 实现单写者';
COMMENT ON COLUMN public.canvases.deps IS '依赖清单 {models[],voices[],characters[],assets[],recipes[]}:分享复制时逐项校验可用性';

NOTIFY pgrst, 'reload schema';
