-- ============================================================================
-- 008 - Add model_id and final_prompt to generations
-- 添加 AI 模特 ID 和最终提示词字段，用于追踪触发词注入
-- ============================================================================

-- 添加 AI 模特 ID 字段
ALTER TABLE public.generations 
ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES public.ai_models(id);

-- 添加最终提示词字段（包含注入的触发词）
ALTER TABLE public.generations 
ADD COLUMN IF NOT EXISTS final_prompt TEXT;

-- 添加新的来源类型支持
ALTER TABLE public.generations 
DROP CONSTRAINT IF EXISTS valid_source;

ALTER TABLE public.generations 
ADD CONSTRAINT valid_source CHECK (source IN ('quick_gen', 'batch_video', 'batch_image', 'batch_video_prompt', 'image_factory', 'pro_studio'));

-- 索引
CREATE INDEX IF NOT EXISTS idx_generations_model_id ON public.generations(model_id);

-- 注释
COMMENT ON COLUMN public.generations.model_id IS 'AI 模特 ID（如果使用了模特）';
COMMENT ON COLUMN public.generations.final_prompt IS '最终发送给 API 的提示词（包含触发词）';
