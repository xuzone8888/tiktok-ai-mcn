-- ============================================================================
-- 006 - Generations Table
-- 任务日志表，记录用户的视频和图片生成任务
-- ============================================================================

-- 创建 generations 表
CREATE TABLE IF NOT EXISTS public.generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    
    -- 任务信息
    task_id TEXT,                           -- 外部 API 任务 ID
    type TEXT NOT NULL DEFAULT 'video',     -- 'video' | 'image'
    source TEXT NOT NULL DEFAULT 'quick_gen', -- 'quick_gen' | 'batch_video' | 'batch_image'
    
    -- 输入参数
    prompt TEXT,                            -- 用户提示词
    model TEXT,                             -- 使用的模型
    duration INTEGER,                       -- 视频时长（秒）
    aspect_ratio TEXT,                      -- 宽高比
    quality TEXT,                           -- 质量设置
    source_image_url TEXT,                  -- 源图片 URL
    
    -- 输出结果
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'failed'
    result_url TEXT,                        -- 结果文件 URL (统一字段)
    video_url TEXT,                         -- 视频 URL (兼容)
    image_url TEXT,                         -- 图片 URL (兼容)
    thumbnail_url TEXT,                     -- 缩略图 URL
    error_message TEXT,                     -- 错误信息
    
    -- 积分和配置
    credit_cost INTEGER DEFAULT 0,          -- 消耗的积分
    use_pro BOOLEAN DEFAULT false,          -- 是否使用 Pro 模式
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    completed_at TIMESTAMPTZ,
    
    -- 约束
    CONSTRAINT valid_type CHECK (type IN ('video', 'image')),
    CONSTRAINT valid_source CHECK (source IN ('quick_gen', 'batch_video', 'batch_image')),
    CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_generations_user_id ON public.generations(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_type ON public.generations(type);
CREATE INDEX IF NOT EXISTS idx_generations_status ON public.generations(status);
CREATE INDEX IF NOT EXISTS idx_generations_source ON public.generations(source);
CREATE INDEX IF NOT EXISTS idx_generations_created_at ON public.generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_user_created ON public.generations(user_id, created_at DESC);

-- 注释
COMMENT ON TABLE public.generations IS '用户生成任务记录表';
COMMENT ON COLUMN public.generations.type IS '任务类型: video=视频, image=图片';
COMMENT ON COLUMN public.generations.source IS '任务来源: quick_gen=快速生成, batch_video=批量视频, batch_image=批量图片';
COMMENT ON COLUMN public.generations.status IS '任务状态: pending=待处理, processing=处理中, completed=已完成, failed=失败';

-- RLS 策略
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

-- 用户只能查看自己的任务
CREATE POLICY "Users can view own generations" ON public.generations
    FOR SELECT
    USING (auth.uid() = user_id);

-- 用户可以插入自己的任务
CREATE POLICY "Users can insert own generations" ON public.generations
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 用户可以更新自己的任务
CREATE POLICY "Users can update own generations" ON public.generations
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Admin 可以查看所有任务
CREATE POLICY "Admin can view all generations" ON public.generations
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('admin', 'super_admin')
        )
    );

-- 服务端可以操作所有任务（使用 service role key）
CREATE POLICY "Service can manage all generations" ON public.generations
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 授权
GRANT SELECT, INSERT, UPDATE ON public.generations TO authenticated;
GRANT ALL ON public.generations TO service_role;

