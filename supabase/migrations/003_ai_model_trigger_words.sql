-- ============================================================================
-- TikTok AI MCN - AI 模特唤醒词系统
-- ============================================================================
-- 创建时间: 2024
-- 描述: 为 AI 模特添加 trigger_word 字段，用于 Sora 2 API 的 Prompt 注入
-- ============================================================================

-- ============================================================================
-- 1. 添加 trigger_word 字段到 ai_models 表
-- ============================================================================

ALTER TABLE public.ai_models 
ADD COLUMN IF NOT EXISTS trigger_word TEXT;

-- 添加字段注释
COMMENT ON COLUMN public.ai_models.trigger_word IS 
'AI 模特的唤醒词/触发词，用于 Sora 2 API 的 Prompt 注入。此字段对前端用户不可见，仅在后端使用。例如: @loradream, sks_woman';

-- ============================================================================
-- 2. 更新现有示例模特数据 (添加唤醒词)
-- ============================================================================

UPDATE public.ai_models SET trigger_word = '@luna_fashion_v1' WHERE name = 'Luna AI';
UPDATE public.ai_models SET trigger_word = '@alex_fitness_v1' WHERE name = 'Alex Virtual';
UPDATE public.ai_models SET trigger_word = '@mia_beauty_v1' WHERE name = 'Mia Digital';
UPDATE public.ai_models SET trigger_word = '@max_tech_v1' WHERE name = 'Max AI';
UPDATE public.ai_models SET trigger_word = '@sophia_lifestyle_v2' WHERE name = 'Sophia Virtual';
UPDATE public.ai_models SET trigger_word = '@leo_food_v1' WHERE name = 'Leo Digital';

-- ============================================================================
-- 3. 更新 RLS 策略 - 排除 trigger_word 字段
-- ============================================================================

-- 删除旧的 RLS 策略
DROP POLICY IF EXISTS "Anyone can view active models" ON public.ai_models;

-- 创建新的 RLS 策略 - 限制普通用户只能看到安全字段
-- 注意: Supabase RLS 基于行级别，列级别安全通过视图实现
CREATE POLICY "Users can view active models basic info"
    ON public.ai_models FOR SELECT
    USING (is_active = true);

-- ============================================================================
-- 4. 创建安全视图 - 供前端使用 (不包含 trigger_word)
-- ============================================================================

CREATE OR REPLACE VIEW public.ai_models_public AS
SELECT 
    id,
    name,
    description,
    avatar_url,
    sample_images,
    sample_videos,
    preview_url,
    category,
    style_tags,
    gender,
    age_range,
    price_daily,
    price_weekly,
    price_monthly,
    price_yearly,
    rating,
    total_rentals,
    total_generations,
    is_active,
    is_featured,
    is_trending,
    capabilities,
    -- 注意: 不包含 trigger_word 和 metadata
    created_at,
    updated_at
FROM public.ai_models
WHERE is_active = true;

-- 视图注释
COMMENT ON VIEW public.ai_models_public IS 
'AI 模特公开信息视图，供前端使用。不包含敏感信息如 trigger_word。';

-- ============================================================================
-- 5. 创建后端专用函数 - 获取模特唤醒词 (仅限服务端调用)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_model_trigger_word(p_model_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_trigger_word TEXT;
BEGIN
    SELECT trigger_word INTO v_trigger_word
    FROM public.ai_models
    WHERE id = p_model_id AND is_active = true;
    
    RETURN v_trigger_word;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 函数注释
COMMENT ON FUNCTION get_model_trigger_word(UUID) IS 
'获取指定模特的唤醒词。此函数仅应在后端服务端调用，不应暴露给前端。';

-- ============================================================================
-- 6. 创建 Prompt 组装函数 (核心逻辑)
-- ============================================================================

CREATE OR REPLACE FUNCTION assemble_prompt(
    p_model_id UUID,
    p_user_prompt TEXT
)
RETURNS TEXT AS $$
DECLARE
    v_trigger_word TEXT;
    v_final_prompt TEXT;
BEGIN
    -- 获取模特唤醒词
    IF p_model_id IS NOT NULL THEN
        SELECT trigger_word INTO v_trigger_word
        FROM public.ai_models
        WHERE id = p_model_id AND is_active = true;
        
        IF v_trigger_word IS NOT NULL AND v_trigger_word != '' THEN
            -- 有模特唤醒词：注入到 Prompt 开头
            v_final_prompt := 'Featuring ' || v_trigger_word || ', ' || COALESCE(p_user_prompt, '');
        ELSE
            -- 模特没有唤醒词：使用通用模板
            v_final_prompt := 'Cinematic shot of product model, ' || COALESCE(p_user_prompt, '');
        END IF;
    ELSE
        -- 没有选择模特：纯产品展示
        v_final_prompt := 'Cinematic shot of product, ' || COALESCE(p_user_prompt, '');
    END IF;
    
    RETURN v_final_prompt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 函数注释
COMMENT ON FUNCTION assemble_prompt(UUID, TEXT) IS 
'组装最终发送给 Sora 2 API 的 Prompt。根据是否选择模特，自动注入唤醒词。
- 有模特：Featuring @trigger_word, [user_prompt]
- 无模特：Cinematic shot of product, [user_prompt]';

-- ============================================================================
-- 7. 添加索引优化查询性能
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ai_models_trigger_word 
ON public.ai_models(trigger_word) 
WHERE trigger_word IS NOT NULL;

-- ============================================================================
-- 完成！
-- ============================================================================

