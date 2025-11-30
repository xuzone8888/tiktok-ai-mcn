-- ============================================================================
-- TikTok AI MCN - 数据库迁移 002
-- ============================================================================
-- 创建时间: 2024
-- 描述: 添加 Projects (创作会话) 和 Task_Queue (任务队列) 表
--       支持"备料台"和"参数控制"功能
-- ============================================================================

-- ============================================================================
-- 1. 新增枚举类型
-- ============================================================================

-- 视频宽高比枚举
CREATE TYPE aspect_ratio AS ENUM ('9:16', '16:9', '1:1');

-- 任务状态枚举 (更新版本，支持草稿状态)
CREATE TYPE task_status AS ENUM (
    'draft',      -- 在备料台中，未开始
    'queued',     -- 用户点击开始，等待发送 API
    'processing', -- API 处理中
    'completed',  -- 完成
    'failed'      -- 失败
);

-- 视频时长枚举
CREATE TYPE video_duration AS ENUM ('5s', '10s', '15s', '20s');

-- ============================================================================
-- 2. PROJECTS 表 - 创作会话/备料台
-- ============================================================================

CREATE TABLE public.projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    
    -- 基本信息
    name TEXT NOT NULL DEFAULT '未命名项目',
    description TEXT,
    
    -- 全局设置
    global_settings JSONB DEFAULT '{
        "aspect_ratio": "9:16",
        "duration": "10s",
        "auto_download": false
    }'::jsonb NOT NULL,
    
    -- 关联的模特和产品 (可选的默认选择)
    default_model_id UUID REFERENCES public.ai_models(id) ON DELETE SET NULL,
    default_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    
    -- 统计
    total_tasks INTEGER DEFAULT 0,
    completed_tasks INTEGER DEFAULT 0,
    total_credits_used INTEGER DEFAULT 0,
    
    -- 状态
    is_active BOOLEAN DEFAULT true,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Projects 表索引
CREATE INDEX idx_projects_user_id ON public.projects(user_id);
CREATE INDEX idx_projects_is_active ON public.projects(is_active) WHERE is_active = true;
CREATE INDEX idx_projects_created_at ON public.projects(created_at DESC);

-- Projects 表注释
COMMENT ON TABLE public.projects IS '创作会话/备料台，存储用户的创作项目和全局设置';
COMMENT ON COLUMN public.projects.global_settings IS '全局设置，包含宽高比、时长、自动下载等配置';

-- ============================================================================
-- 3. TASK_QUEUE 表 - 生成任务队列
-- ============================================================================

CREATE TABLE public.task_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    
    -- 关联信息
    model_id UUID NOT NULL REFERENCES public.ai_models(id) ON DELETE RESTRICT,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE RESTRICT,
    
    -- 任务类型
    type generation_type NOT NULL DEFAULT 'video',
    
    -- 任务状态
    status task_status DEFAULT 'draft' NOT NULL,
    
    -- 视频参数
    aspect_ratio aspect_ratio DEFAULT '9:16' NOT NULL,
    duration video_duration DEFAULT '10s' NOT NULL,
    
    -- 自动下载设置
    is_auto_download BOOLEAN DEFAULT false NOT NULL,
    
    -- 积分信息
    cost_credits INTEGER NOT NULL DEFAULT 0,
    credits_deducted BOOLEAN DEFAULT false NOT NULL,
    
    -- 输入参数
    input_params JSONB DEFAULT '{}'::jsonb NOT NULL,
    -- 格式示例：
    -- {
    --   "script": "文案内容",
    --   "style": "casual",
    --   "voice_id": "xxx",
    --   "background_music": "xxx",
    --   "template_id": "xxx"
    -- }
    
    -- 输出结果
    output_url TEXT,
    output_urls JSONB DEFAULT '[]'::jsonb,
    thumbnail_url TEXT,
    
    -- 生成信息
    resolution TEXT,
    file_size INTEGER,
    
    -- API 任务信息
    api_task_id TEXT,          -- Sora API 返回的 task_id
    api_provider TEXT,          -- API 提供商: 'sora', 'runway', etc.
    
    -- 进度跟踪
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    
    -- 错误信息
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- 排序和优先级
    priority INTEGER DEFAULT 0,
    queue_position INTEGER,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    queued_at TIMESTAMPTZ,       -- 进入队列时间
    started_at TIMESTAMPTZ,      -- 开始处理时间
    completed_at TIMESTAMPTZ,    -- 完成时间
    timeout_at TIMESTAMPTZ       -- 超时时间 (开始后10分钟)
);

-- Task_Queue 表索引
CREATE INDEX idx_task_queue_user_id ON public.task_queue(user_id);
CREATE INDEX idx_task_queue_project_id ON public.task_queue(project_id);
CREATE INDEX idx_task_queue_status ON public.task_queue(status);
CREATE INDEX idx_task_queue_model_id ON public.task_queue(model_id);
CREATE INDEX idx_task_queue_api_task_id ON public.task_queue(api_task_id) WHERE api_task_id IS NOT NULL;
CREATE INDEX idx_task_queue_created_at ON public.task_queue(created_at DESC);

-- 复合索引：用户的草稿任务
CREATE INDEX idx_task_queue_user_draft ON public.task_queue(user_id, status) 
    WHERE status = 'draft';

-- 复合索引：待处理的队列任务
CREATE INDEX idx_task_queue_queued ON public.task_queue(status, priority DESC, queued_at ASC) 
    WHERE status = 'queued';

-- 复合索引：处理中的任务（用于超时检查）
CREATE INDEX idx_task_queue_processing ON public.task_queue(status, timeout_at) 
    WHERE status = 'processing';

-- Task_Queue 表注释
COMMENT ON TABLE public.task_queue IS '生成任务队列，支持备料台草稿和异步处理';
COMMENT ON COLUMN public.task_queue.status IS '任务状态：draft(草稿), queued(排队中), processing(处理中), completed(完成), failed(失败)';
COMMENT ON COLUMN public.task_queue.cost_credits IS '该任务预计消耗的积分';
COMMENT ON COLUMN public.task_queue.credits_deducted IS '积分是否已扣除（防止重复扣费）';

-- ============================================================================
-- 4. 积分定价配置表
-- ============================================================================

CREATE TABLE public.credit_pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 定价类型
    type TEXT NOT NULL,              -- 'video_duration', 'image', 'feature'
    key TEXT NOT NULL,               -- '5s', '10s', '15s', '20s', 'image', etc.
    
    -- 积分价格
    credits INTEGER NOT NULL CHECK (credits > 0),
    
    -- 描述
    description TEXT,
    
    -- 状态
    is_active BOOLEAN DEFAULT true,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- 唯一约束
    CONSTRAINT unique_pricing_key UNIQUE (type, key)
);

-- 插入默认定价
INSERT INTO public.credit_pricing (type, key, credits, description) VALUES
    ('video_duration', '5s', 30, '5秒视频生成'),
    ('video_duration', '10s', 50, '10秒视频生成'),
    ('video_duration', '15s', 80, '15秒视频生成'),
    ('video_duration', '20s', 120, '20秒视频生成'),
    ('image', 'standard', 10, '标准图片生成'),
    ('image', 'high_quality', 20, '高质量图片生成');

-- Credit_Pricing 表注释
COMMENT ON TABLE public.credit_pricing IS '积分定价配置表';

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) 策略
-- ============================================================================

-- 启用 RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_pricing ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Projects 表 RLS 策略
-- ----------------------------------------------------------------------------

CREATE POLICY "Users can view own projects"
    ON public.projects FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own projects"
    ON public.projects FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
    ON public.projects FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
    ON public.projects FOR DELETE
    USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Task_Queue 表 RLS 策略
-- ----------------------------------------------------------------------------

CREATE POLICY "Users can view own tasks"
    ON public.task_queue FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tasks"
    ON public.task_queue FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks"
    ON public.task_queue FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own draft tasks"
    ON public.task_queue FOR DELETE
    USING (auth.uid() = user_id AND status = 'draft');

-- ----------------------------------------------------------------------------
-- Credit_Pricing 表 RLS 策略 (只读)
-- ----------------------------------------------------------------------------

CREATE POLICY "Anyone can view active pricing"
    ON public.credit_pricing FOR SELECT
    USING (is_active = true);

-- ============================================================================
-- 6. 函数和触发器
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 自动更新 updated_at
-- ----------------------------------------------------------------------------

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_task_queue_updated_at
    BEFORE UPDATE ON public.task_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_credit_pricing_updated_at
    BEFORE UPDATE ON public.credit_pricing
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 获取视频生成积分价格
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_video_credits(p_duration video_duration)
RETURNS INTEGER AS $$
DECLARE
    v_credits INTEGER;
BEGIN
    SELECT credits INTO v_credits
    FROM public.credit_pricing
    WHERE type = 'video_duration' 
      AND key = p_duration::TEXT
      AND is_active = true;
    
    -- 如果找不到价格，返回默认值
    IF v_credits IS NULL THEN
        v_credits := CASE p_duration
            WHEN '5s' THEN 30
            WHEN '10s' THEN 50
            WHEN '15s' THEN 80
            WHEN '20s' THEN 120
            ELSE 50
        END;
    END IF;
    
    RETURN v_credits;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- 创建草稿任务
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_draft_task(
    p_user_id UUID,
    p_project_id UUID,
    p_model_id UUID,
    p_product_id UUID,
    p_type generation_type,
    p_aspect_ratio aspect_ratio,
    p_duration video_duration,
    p_is_auto_download BOOLEAN,
    p_input_params JSONB
)
RETURNS UUID AS $$
DECLARE
    v_task_id UUID;
    v_contract_id UUID;
    v_cost_credits INTEGER;
BEGIN
    -- 检查是否有有效合约
    SELECT id INTO v_contract_id
    FROM public.contracts
    WHERE user_id = p_user_id
      AND model_id = p_model_id
      AND status = 'active'
      AND end_date > NOW()
    ORDER BY end_date DESC
    LIMIT 1;
    
    IF v_contract_id IS NULL THEN
        RAISE EXCEPTION 'No active contract found for this model. Please rent the model first.';
    END IF;
    
    -- 计算积分消耗
    IF p_type = 'video' THEN
        v_cost_credits := get_video_credits(p_duration);
    ELSE
        v_cost_credits := 10; -- 图片默认价格
    END IF;
    
    -- 创建草稿任务
    INSERT INTO public.task_queue (
        user_id, project_id, model_id, product_id, contract_id,
        type, status, aspect_ratio, duration, is_auto_download,
        cost_credits, input_params
    )
    VALUES (
        p_user_id, p_project_id, p_model_id, p_product_id, v_contract_id,
        p_type, 'draft', p_aspect_ratio, p_duration, p_is_auto_download,
        v_cost_credits, p_input_params
    )
    RETURNING id INTO v_task_id;
    
    -- 更新项目任务计数
    IF p_project_id IS NOT NULL THEN
        UPDATE public.projects
        SET total_tasks = total_tasks + 1
        WHERE id = p_project_id;
    END IF;
    
    RETURN v_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 启动任务 (从草稿变为队列)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION start_task(p_task_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_task RECORD;
    v_user_credits INTEGER;
BEGIN
    -- 获取任务信息
    SELECT * INTO v_task
    FROM public.task_queue
    WHERE id = p_task_id AND status = 'draft'
    FOR UPDATE;
    
    IF v_task IS NULL THEN
        RAISE EXCEPTION 'Task not found or not in draft status';
    END IF;
    
    -- 检查用户积分
    SELECT credits INTO v_user_credits
    FROM public.users
    WHERE id = v_task.user_id
    FOR UPDATE;
    
    IF v_user_credits < v_task.cost_credits THEN
        RAISE EXCEPTION 'Insufficient credits. Required: %, Available: %', v_task.cost_credits, v_user_credits;
    END IF;
    
    -- 扣除积分
    UPDATE public.users
    SET credits = credits - v_task.cost_credits
    WHERE id = v_task.user_id;
    
    -- 更新任务状态
    UPDATE public.task_queue
    SET 
        status = 'queued',
        credits_deducted = true,
        queued_at = NOW()
    WHERE id = p_task_id;
    
    -- 记录积分交易
    INSERT INTO public.credit_transactions (
        user_id, type, amount, balance_after, 
        reference_type, reference_id, description
    )
    VALUES (
        v_task.user_id,
        'consume',
        -v_task.cost_credits,
        v_user_credits - v_task.cost_credits,
        'task',
        p_task_id,
        'Video generation: ' || v_task.duration::TEXT
    );
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 批量启动任务
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION start_tasks_batch(p_task_ids UUID[])
RETURNS INTEGER AS $$
DECLARE
    v_task_id UUID;
    v_count INTEGER := 0;
BEGIN
    FOREACH v_task_id IN ARRAY p_task_ids
    LOOP
        BEGIN
            PERFORM start_task(v_task_id);
            v_count := v_count + 1;
        EXCEPTION WHEN OTHERS THEN
            -- 继续处理其他任务
            RAISE NOTICE 'Failed to start task %: %', v_task_id, SQLERRM;
        END;
    END LOOP;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 处理超时任务 (退还积分)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION process_timeout_tasks()
RETURNS INTEGER AS $$
DECLARE
    v_task RECORD;
    v_count INTEGER := 0;
    v_user_credits INTEGER;
BEGIN
    -- 查找超时的任务 (processing 状态且超过10分钟)
    FOR v_task IN
        SELECT * FROM public.task_queue
        WHERE status = 'processing'
          AND timeout_at IS NOT NULL
          AND timeout_at < NOW()
        FOR UPDATE
    LOOP
        -- 标记为失败
        UPDATE public.task_queue
        SET 
            status = 'failed',
            error_message = 'Task timeout after 10 minutes',
            completed_at = NOW()
        WHERE id = v_task.id;
        
        -- 退还积分 (如果已扣除)
        IF v_task.credits_deducted THEN
            -- 获取当前余额
            SELECT credits INTO v_user_credits
            FROM public.users
            WHERE id = v_task.user_id;
            
            -- 退还积分
            UPDATE public.users
            SET credits = credits + v_task.cost_credits
            WHERE id = v_task.user_id;
            
            -- 记录退款交易
            INSERT INTO public.credit_transactions (
                user_id, type, amount, balance_after,
                reference_type, reference_id, description
            )
            VALUES (
                v_task.user_id,
                'refund',
                v_task.cost_credits,
                v_user_credits + v_task.cost_credits,
                'task',
                v_task.id,
                'Refund for timeout task'
            );
        END IF;
        
        v_count := v_count + 1;
    END LOOP;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 更新任务状态为处理中
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_task_processing(
    p_task_id UUID,
    p_api_task_id TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE public.task_queue
    SET 
        status = 'processing',
        api_task_id = p_api_task_id,
        started_at = NOW(),
        timeout_at = NOW() + INTERVAL '10 minutes'
    WHERE id = p_task_id AND status = 'queued';
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 完成任务
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION complete_task(
    p_task_id UUID,
    p_output_url TEXT,
    p_thumbnail_url TEXT DEFAULT NULL,
    p_file_size INTEGER DEFAULT NULL,
    p_resolution TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_task RECORD;
BEGIN
    -- 获取任务信息
    SELECT * INTO v_task
    FROM public.task_queue
    WHERE id = p_task_id;
    
    IF v_task IS NULL THEN
        RETURN false;
    END IF;
    
    -- 更新任务
    UPDATE public.task_queue
    SET 
        status = 'completed',
        output_url = p_output_url,
        thumbnail_url = p_thumbnail_url,
        file_size = p_file_size,
        resolution = p_resolution,
        progress = 100,
        completed_at = NOW()
    WHERE id = p_task_id;
    
    -- 更新项目完成计数
    IF v_task.project_id IS NOT NULL THEN
        UPDATE public.projects
        SET 
            completed_tasks = completed_tasks + 1,
            total_credits_used = total_credits_used + v_task.cost_credits
        WHERE id = v_task.project_id;
    END IF;
    
    -- 更新模特生成次数
    UPDATE public.ai_models
    SET total_generations = total_generations + 1
    WHERE id = v_task.model_id;
    
    -- 更新合约生成次数
    IF v_task.contract_id IS NOT NULL THEN
        UPDATE public.contracts
        SET generations_count = generations_count + 1
        WHERE id = v_task.contract_id;
    END IF;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 任务失败
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fail_task(
    p_task_id UUID,
    p_error_message TEXT,
    p_refund BOOLEAN DEFAULT true
)
RETURNS BOOLEAN AS $$
DECLARE
    v_task RECORD;
    v_user_credits INTEGER;
BEGIN
    -- 获取任务信息
    SELECT * INTO v_task
    FROM public.task_queue
    WHERE id = p_task_id
    FOR UPDATE;
    
    IF v_task IS NULL THEN
        RETURN false;
    END IF;
    
    -- 更新任务状态
    UPDATE public.task_queue
    SET 
        status = 'failed',
        error_message = p_error_message,
        completed_at = NOW()
    WHERE id = p_task_id;
    
    -- 退还积分 (如果需要且已扣除)
    IF p_refund AND v_task.credits_deducted THEN
        SELECT credits INTO v_user_credits
        FROM public.users
        WHERE id = v_task.user_id;
        
        UPDATE public.users
        SET credits = credits + v_task.cost_credits
        WHERE id = v_task.user_id;
        
        INSERT INTO public.credit_transactions (
            user_id, type, amount, balance_after,
            reference_type, reference_id, description
        )
        VALUES (
            v_task.user_id,
            'refund',
            v_task.cost_credits,
            v_user_credits + v_task.cost_credits,
            'task',
            p_task_id,
            'Refund for failed task: ' || COALESCE(p_error_message, 'Unknown error')
        );
    END IF;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. 视图
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 用户备料台视图 (草稿任务)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.user_draft_tasks AS
SELECT 
    t.id,
    t.user_id,
    t.project_id,
    t.model_id,
    t.product_id,
    t.type,
    t.aspect_ratio,
    t.duration,
    t.is_auto_download,
    t.cost_credits,
    t.input_params,
    t.created_at,
    m.name AS model_name,
    m.avatar_url AS model_avatar,
    p.name AS product_name,
    p.original_image_url AS product_image
FROM public.task_queue t
LEFT JOIN public.ai_models m ON t.model_id = m.id
LEFT JOIN public.products p ON t.product_id = p.id
WHERE t.status = 'draft';

-- ----------------------------------------------------------------------------
-- 项目统计视图
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.project_stats AS
SELECT 
    p.id AS project_id,
    p.user_id,
    p.name,
    p.total_tasks,
    p.completed_tasks,
    p.total_credits_used,
    COUNT(CASE WHEN t.status = 'draft' THEN 1 END) AS draft_count,
    COUNT(CASE WHEN t.status = 'queued' THEN 1 END) AS queued_count,
    COUNT(CASE WHEN t.status = 'processing' THEN 1 END) AS processing_count,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) AS completed_count,
    COUNT(CASE WHEN t.status = 'failed' THEN 1 END) AS failed_count
FROM public.projects p
LEFT JOIN public.task_queue t ON p.id = t.project_id
GROUP BY p.id;

-- ============================================================================
-- 完成！
-- ============================================================================

