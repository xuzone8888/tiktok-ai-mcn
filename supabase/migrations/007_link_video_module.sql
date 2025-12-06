-- ============================================================================
-- TikTok AI MCN - 链接秒变视频模块
-- Migration: 007_link_video_module.sql
-- 创建时间: 2024-12
-- ============================================================================

-- ============================================================================
-- 1. 商品链接缓存表 (product_link_cache)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.product_link_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 链接信息
    url TEXT NOT NULL,
    url_hash TEXT NOT NULL,  -- MD5 哈希，用于快速查询
    platform TEXT NOT NULL DEFAULT 'other' CHECK (platform IN (
        'douyin', 'taobao', 'tmall', 'jd', 'tiktok', 'amazon', 'pinduoduo', 'other'
    )),
    
    -- 原始解析数据
    raw_title TEXT,
    raw_description TEXT,
    raw_price TEXT,
    raw_promo_info TEXT,
    raw_images JSONB DEFAULT '[]'::jsonb,  -- 抓取的图片 URLs
    
    -- 清洗后的结构化数据
    parsed_data JSONB,
    /*
    parsed_data 结构:
    {
      "title": "商品标题",
      "selling_points": ["卖点1", "卖点2"],
      "price": {
        "current": "99.00",
        "original": "199.00",
        "discount": "5折"
      },
      "brand": "品牌名",
      "store_name": "店铺名",
      "category": "分类",
      "images": [
        {
          "url": "https://...",
          "type": "main|detail|scene",
          "selected": true,
          "is_primary": true
        }
      ]
    }
    */
    
    -- 解析状态
    parse_status TEXT DEFAULT 'pending' CHECK (parse_status IN ('pending', 'parsing', 'success', 'failed')),
    parse_error TEXT,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_fetched_at TIMESTAMPTZ,
    
    -- 唯一约束
    UNIQUE(url_hash)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_product_link_cache_url_hash ON public.product_link_cache(url_hash);
CREATE INDEX IF NOT EXISTS idx_product_link_cache_platform ON public.product_link_cache(platform);
CREATE INDEX IF NOT EXISTS idx_product_link_cache_parse_status ON public.product_link_cache(parse_status);
CREATE INDEX IF NOT EXISTS idx_product_link_cache_created_at ON public.product_link_cache(created_at DESC);

-- 注释
COMMENT ON TABLE public.product_link_cache IS '商品链接解析缓存表，存储已解析过的商品链接信息';
COMMENT ON COLUMN public.product_link_cache.url_hash IS '链接的 MD5 哈希，用于快速查询和去重';
COMMENT ON COLUMN public.product_link_cache.parsed_data IS '清洗后的结构化商品数据，JSONB 格式';

-- ============================================================================
-- 2. 链接转视频任务表 (link_video_jobs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.link_video_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 用户关联
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- 商品链接关联
    product_link_id UUID REFERENCES public.product_link_cache(id) ON DELETE SET NULL,
    
    -- AI 模特关联 (可选)
    ai_model_id UUID REFERENCES public.ai_models(id) ON DELETE SET NULL,
    
    -- 手动输入的商品信息 (链接解析失败时使用)
    manual_product_info JSONB,
    /*
    manual_product_info 结构:
    {
      "title": "商品标题",
      "selling_points": "卖点描述",
      "price": "价格",
      "images": ["url1", "url2"]
    }
    */
    
    -- 视频配置
    video_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    /*
    video_config 结构:
    {
      "duration": 10 | 15 | 25,
      "aspect_ratio": "9:16" | "16:9",
      "video_style": "selfie_talking" | "scene_plus_talking" | "product_only",
      "platform_style": "tiktok_us" | "douyin_cn" | "generic",
      "language": "en" | "zh"
    }
    */
    
    -- 选中的图片
    selected_main_image_url TEXT,          -- 主图 (用于九宫格)
    selected_image_urls JSONB DEFAULT '[]'::jsonb,  -- 选中的图片列表
    
    -- 生成的脚本
    script_text TEXT,                       -- 当前使用的脚本
    script_versions JSONB DEFAULT '[]'::jsonb,  -- 历史版本
    /*
    script_versions 结构:
    [
      { "version": 1, "content": "...", "created_at": "..." },
      { "version": 2, "content": "...", "created_at": "..." }
    ]
    */
    
    -- 生成的资源
    grid_image_url TEXT,                    -- 九宫格图片 URL
    final_video_url TEXT,                   -- 最终视频 URL
    thumbnail_url TEXT,                     -- 视频缩略图
    
    -- 外部任务 ID
    grid_task_id TEXT,                      -- NanoBanana 任务 ID
    video_task_id TEXT,                     -- Sora2 任务 ID
    
    -- 状态管理
    status TEXT DEFAULT 'created' CHECK (status IN (
        'created',              -- 刚创建
        'parsing_link',         -- 正在解析链接
        'link_parsed',          -- 链接解析完成
        'configuring',          -- 配置中 (用户编辑参数)
        'generating_script',    -- 正在生成脚本
        'script_generated',     -- 脚本生成完成
        'generating_grid',      -- 正在生成九宫格
        'grid_generated',       -- 九宫格生成完成
        'generating_video',     -- 正在生成视频
        'success',              -- 全部完成
        'failed',               -- 失败
        'cancelled'             -- 已取消
    )),
    current_step INTEGER DEFAULT 1 CHECK (current_step >= 1 AND current_step <= 5),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    error_message TEXT,
    
    -- 积分
    credits_estimated INTEGER DEFAULT 0,    -- 预估积分
    credits_used INTEGER DEFAULT 0,         -- 实际消耗
    credits_refunded INTEGER DEFAULT 0,     -- 退还积分
    
    -- 重试计数
    script_rewrite_count INTEGER DEFAULT 0, -- 脚本重写次数
    grid_retry_count INTEGER DEFAULT 0,     -- 九宫格重试次数
    video_retry_count INTEGER DEFAULT 0,    -- 视频重试次数
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,                 -- 开始生成时间
    completed_at TIMESTAMPTZ                -- 完成时间
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_link_video_jobs_user_id ON public.link_video_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_link_video_jobs_status ON public.link_video_jobs(status);
CREATE INDEX IF NOT EXISTS idx_link_video_jobs_created_at ON public.link_video_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_link_video_jobs_product_link_id ON public.link_video_jobs(product_link_id);

-- 注释
COMMENT ON TABLE public.link_video_jobs IS '链接秒变视频任务表，记录每个用户的链接转视频任务';
COMMENT ON COLUMN public.link_video_jobs.status IS '任务状态：created/parsing_link/link_parsed/configuring/generating_script/script_generated/generating_grid/grid_generated/generating_video/success/failed/cancelled';
COMMENT ON COLUMN public.link_video_jobs.current_step IS '当前步骤：1=链接解析, 2=参数配置, 3=脚本生成, 4=九宫格, 5=视频生成';

-- ============================================================================
-- 3. RLS (Row Level Security) 策略
-- ============================================================================

-- 启用 RLS
ALTER TABLE public.product_link_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_video_jobs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- product_link_cache 策略
-- ----------------------------------------------------------------------------

-- 所有登录用户可以查看 (缓存共享)
CREATE POLICY "Authenticated users can view product links"
    ON public.product_link_cache FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- 所有登录用户可以创建 (触发解析)
CREATE POLICY "Authenticated users can create product links"
    ON public.product_link_cache FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- 只有 service_role 可以更新 (后端解析完成后更新)
-- 普通用户通过 API 触发更新

-- ----------------------------------------------------------------------------
-- link_video_jobs 策略
-- ----------------------------------------------------------------------------

-- 用户只能查看自己的任务
CREATE POLICY "Users can view own link video jobs"
    ON public.link_video_jobs FOR SELECT
    USING (auth.uid() = user_id);

-- 用户只能创建自己的任务
CREATE POLICY "Users can create own link video jobs"
    ON public.link_video_jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 用户只能更新自己的任务
CREATE POLICY "Users can update own link video jobs"
    ON public.link_video_jobs FOR UPDATE
    USING (auth.uid() = user_id);

-- 用户只能删除自己的任务
CREATE POLICY "Users can delete own link video jobs"
    ON public.link_video_jobs FOR DELETE
    USING (auth.uid() = user_id);

-- Admin 可以查看所有任务
CREATE POLICY "Admins can view all link video jobs"
    ON public.link_video_jobs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- ============================================================================
-- 4. 触发器：自动更新 updated_at
-- ============================================================================

-- product_link_cache
DROP TRIGGER IF EXISTS update_product_link_cache_updated_at ON public.product_link_cache;
CREATE TRIGGER update_product_link_cache_updated_at
    BEFORE UPDATE ON public.product_link_cache
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- link_video_jobs
DROP TRIGGER IF EXISTS update_link_video_jobs_updated_at ON public.link_video_jobs;
CREATE TRIGGER update_link_video_jobs_updated_at
    BEFORE UPDATE ON public.link_video_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 5. 系统配置：链接转视频积分定价
-- ============================================================================

INSERT INTO public.system_settings (key, value, description) VALUES
    ('link_video_pricing', '{
        "10s": 50,
        "15s": 100,
        "25s": 380,
        "script_rewrite": 5,
        "script_free_rewrites": 3
    }', '链接秒变视频积分定价：10秒=50积分，15秒=100积分，25秒=380积分')
ON CONFLICT (key) DO UPDATE SET 
    value = EXCLUDED.value,
    updated_at = NOW();

-- ============================================================================
-- 完成提示
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ 链接秒变视频模块数据库迁移完成！';
    RAISE NOTICE '';
    RAISE NOTICE '新增表：';
    RAISE NOTICE '  - product_link_cache (商品链接缓存)';
    RAISE NOTICE '  - link_video_jobs (链接转视频任务)';
    RAISE NOTICE '';
    RAISE NOTICE '新增配置：';
    RAISE NOTICE '  - link_video_pricing (积分定价)';
END $$;

