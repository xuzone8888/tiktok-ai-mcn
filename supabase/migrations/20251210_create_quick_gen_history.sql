-- ============================================================================
-- 即时造片台操作历史表
-- 用于保存用户在 Quick Generator 中的操作历史，支持 7 天内回溯
-- ============================================================================

-- 创建表
CREATE TABLE IF NOT EXISTS public.quick_gen_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- 基本信息
    mode TEXT NOT NULL CHECK (mode IN ('video', 'image')),
    
    -- 输入参数（完整保存）
    input_images JSONB DEFAULT '[]'::jsonb,  -- 上传的图片 URLs 数组
    prompt TEXT,
    
    -- 图片模式参数
    image_model TEXT,              -- nano-banana / nano-banana-pro
    image_quality_tier TEXT,       -- fast / pro
    image_aspect_ratio TEXT,       -- auto / 1:1 / 16:9 / 9:16 / 4:3 / 3:4
    image_resolution TEXT,         -- 1k / 2k / 4k
    
    -- 视频模式参数
    video_model TEXT,              -- sora2-10s / sora2-15s / sora2-pro-15s-hd / sora2-pro-25s
    video_aspect_ratio TEXT,       -- 9:16 / 16:9
    video_use_ai_model BOOLEAN DEFAULT false,
    video_ai_model_id TEXT,        -- AI 模特 ID
    
    -- 输出结果（可选，用于预览）
    output_url TEXT,
    thumbnail_url TEXT,
    status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
    
    -- 费用
    credits_cost INTEGER DEFAULT 0,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days') NOT NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_quick_gen_history_user_id ON public.quick_gen_history(user_id);
CREATE INDEX IF NOT EXISTS idx_quick_gen_history_created_at ON public.quick_gen_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quick_gen_history_expires_at ON public.quick_gen_history(expires_at);
CREATE INDEX IF NOT EXISTS idx_quick_gen_history_mode ON public.quick_gen_history(mode);

-- 启用 RLS
ALTER TABLE public.quick_gen_history ENABLE ROW LEVEL SECURITY;

-- RLS 策略：用户只能访问自己的历史记录
CREATE POLICY "Users can view own history" ON public.quick_gen_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own history" ON public.quick_gen_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own history" ON public.quick_gen_history
    FOR DELETE USING (auth.uid() = user_id);

-- 表注释
COMMENT ON TABLE public.quick_gen_history IS '即时造片台操作历史表，保存用户的完整操作参数，7天后自动过期';
COMMENT ON COLUMN public.quick_gen_history.input_images IS '上传的参考图片 URLs，JSON 数组格式';
COMMENT ON COLUMN public.quick_gen_history.expires_at IS '历史记录过期时间，默认创建后 7 天';

-- ============================================================================
-- 可选：自动清理过期记录的函数（可通过 Supabase Edge Function 定时调用）
-- ============================================================================

-- 清理过期历史记录
CREATE OR REPLACE FUNCTION cleanup_expired_quick_gen_history()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.quick_gen_history
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 函数注释
COMMENT ON FUNCTION cleanup_expired_quick_gen_history() IS '清理过期的即时造片台历史记录，返回删除的记录数';


