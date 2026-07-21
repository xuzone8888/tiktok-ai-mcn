-- ============================================================================
-- 20260702 - Studio 地基(S0.1)
-- 1) generations 增加内容库字段(library_status/batch_id/spec)
-- 2) valid_source 约束防御式重建(生产库与迁移文件已漂移,用 NOT VALID 只约束新行)
-- 3) blueprints 表(参考物→蓝图→量产 管线的一等对象)
-- 4) reference_cache 表(链接解析缓存,沿用 007 product_link_cache 设计)
-- 幂等:可重复执行。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. generations 内容库字段
--    注意:generations.status 已被任务执行状态占用(pending/processing/...),
--    内容库状态用 library_status,NULL = 未入库。
-- ----------------------------------------------------------------------------
ALTER TABLE public.generations
    ADD COLUMN IF NOT EXISTS library_status TEXT,
    ADD COLUMN IF NOT EXISTS batch_id UUID,
    ADD COLUMN IF NOT EXISTS spec JSONB;

ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS valid_library_status;
ALTER TABLE public.generations
    ADD CONSTRAINT valid_library_status
    CHECK (library_status IS NULL OR library_status IN ('draft', 'ready', 'published'));

CREATE INDEX IF NOT EXISTS idx_generations_batch_id
    ON public.generations(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_generations_library_status
    ON public.generations(user_id, library_status) WHERE library_status IS NOT NULL;

COMMENT ON COLUMN public.generations.library_status IS '内容库状态: NULL=未入库, draft=草稿, ready=就绪待发, published=已发布';
COMMENT ON COLUMN public.generations.batch_id IS 'Studio 批次 ID(一次提交=一个 Batch=N 个 Job)';
COMMENT ON COLUMN public.generations.spec IS 'JobSpec 快照(含 blueprint_id/scene 映射),用于再跑一批/改参重跑';

-- ----------------------------------------------------------------------------
-- 2. valid_source 防御式重建
--    008 的枚举与生产实际写入已漂移(生产已有 batch_video_prompt_grok 等模型后缀变体,
--    写入端按模型半动态拼接 batch_video_[prompt_]<model>)。
--    因此:基础枚举 + batch_video_% 前缀通配;NOT VALID 只校验新行。
-- ----------------------------------------------------------------------------
ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS valid_source;
ALTER TABLE public.generations
    ADD CONSTRAINT valid_source
    CHECK (
        source IN (
            'quick_gen', 'batch_image',
            'image_factory', 'pro_studio',
            'link_video', 'viral_clone', 'ecom_factory',
            'studio', 'slideshow', 'photo_post'
        )
        OR source LIKE 'batch_video%'
    ) NOT VALID;

-- ----------------------------------------------------------------------------
-- 3. blueprints 表
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blueprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    workspace_id UUID,                          -- 预留:Workspace 对象未建
    project_id UUID,                            -- 预留:Project 对象未建

    -- 参考物
    source_type TEXT NOT NULL CHECK (source_type IN ('product_link', 'product_images', 'reference_video', 'manual')),
    source_ref JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {url} | {asset_urls:[]} | {upload_url} 等
    rights_ack BOOLEAN NOT NULL DEFAULT false,       -- 权利确认(门B上传必填)

    -- 蓝图主体
    product JSONB,                              -- 商品卡 {title,price,category,images[],selling_points[{id,text,evidence,selected}],audience[]}
    hooks JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{type,text,selected}] type: 痛点|悬念|对比|场景
    scenes JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{idx,line,visual,slot:{kind,asset_ref},duration_ms,beat}]
    globals JSONB NOT NULL DEFAULT '{}'::jsonb, -- {pacing,bgm_style,voice_id,cta_text,aspect,total_sec}
    render_mode TEXT CHECK (render_mode IS NULL OR render_mode IN ('slideshow', 'assembly', 'ai_gen')),
    origin JSONB,                               -- 门B溯源 {viral_ref,why_viral,license:'structure_only'}

    -- 生命周期
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived')),
    version INTEGER NOT NULL DEFAULT 1,
    recipe_id UUID,                             -- 由配方实例化时回指 content_templates

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blueprints_user_created
    ON public.blueprints(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blueprints_source_type
    ON public.blueprints(source_type);

ALTER TABLE public.blueprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blueprints_select_own" ON public.blueprints;
CREATE POLICY "blueprints_select_own" ON public.blueprints
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "blueprints_insert_own" ON public.blueprints;
CREATE POLICY "blueprints_insert_own" ON public.blueprints
    FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "blueprints_update_own" ON public.blueprints;
CREATE POLICY "blueprints_update_own" ON public.blueprints
    FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "blueprints_delete_own" ON public.blueprints;
CREATE POLICY "blueprints_delete_own" ON public.blueprints
    FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE public.blueprints IS '蓝图:参考物(商品链接/商品图/爆款视频)解析出的可编辑结构化中间产物,批量生成的输入';

-- ----------------------------------------------------------------------------
-- 4. reference_cache 表(沿用 007 product_link_cache 的 url_hash/双层/状态设计)
--    共享缓存,无用户归属;启用 RLS 且不建公开策略 => 仅 service role 可访问。
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reference_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url_hash TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'product_link'
        CHECK (source_type IN ('product_link', 'reference_video')),
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,     -- 抓取原始数据
    parsed JSONB,                               -- 清洗后的结构化数据(商品卡雏形)
    parse_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (parse_status IN ('pending', 'parsing', 'success', 'failed')),
    error_message TEXT,
    hit_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(url_hash)
);

CREATE INDEX IF NOT EXISTS idx_reference_cache_url_hash ON public.reference_cache(url_hash);
CREATE INDEX IF NOT EXISTS idx_reference_cache_parse_status ON public.reference_cache(parse_status);

ALTER TABLE public.reference_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.reference_cache IS '参考物解析缓存(链接/视频),url_hash 去重;仅服务端(service role)访问';

NOTIFY pgrst, 'reload schema';
