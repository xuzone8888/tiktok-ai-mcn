-- ============================================================================
-- 020: 角色系统一体化迁移
--
-- 为 ai_models 表添加角色创建、多角度参考图状态、广场发布相关字段，
-- 使其同时支持官方角色和用户自建角色。
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. 角色来源与归属
-- ============================================================================

-- 角色来源（先不加 NOT NULL，等填充默认值后再加）
ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'official';

-- 角色创建者（仅 user_created 有值）
ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- 2. 角色创建扩展字段
-- ============================================================================

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS reference_images JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS character_type TEXT DEFAULT 'realistic';

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS dna_config JSONB DEFAULT '{}'::jsonb;

-- ============================================================================
-- 3. 多角度参考图状态追踪
-- ============================================================================

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS reference_sheet_url TEXT;

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS reference_status TEXT DEFAULT 'none';

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS reference_task_id TEXT;

-- ============================================================================
-- 4. 视频预览
-- ============================================================================

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS preview_video_url TEXT;

-- ============================================================================
-- 5. 广场发布
-- ============================================================================

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS publish_price INTEGER DEFAULT 100;

-- ============================================================================
-- 6. 数据订正：确保已有行的默认值正确
-- ============================================================================

UPDATE public.ai_models SET source = 'official' WHERE source IS NULL OR source = '';
UPDATE public.ai_models SET reference_images = '[]'::jsonb WHERE reference_images IS NULL;
UPDATE public.ai_models SET character_type = 'realistic' WHERE character_type IS NULL;
UPDATE public.ai_models SET dna_config = '{}'::jsonb WHERE dna_config IS NULL;
UPDATE public.ai_models SET reference_status = 'none' WHERE reference_status IS NULL;
UPDATE public.ai_models SET is_public = false WHERE is_public IS NULL;
UPDATE public.ai_models SET publish_price = 100 WHERE publish_price IS NULL;

-- ============================================================================
-- 7. 填充完毕后加 NOT NULL 约束
-- ============================================================================

ALTER TABLE public.ai_models ALTER COLUMN source SET NOT NULL;
ALTER TABLE public.ai_models ALTER COLUMN reference_images SET NOT NULL;
ALTER TABLE public.ai_models ALTER COLUMN character_type SET NOT NULL;
ALTER TABLE public.ai_models ALTER COLUMN dna_config SET NOT NULL;
ALTER TABLE public.ai_models ALTER COLUMN reference_status SET NOT NULL;
ALTER TABLE public.ai_models ALTER COLUMN is_public SET NOT NULL;
ALTER TABLE public.ai_models ALTER COLUMN publish_price SET NOT NULL;

-- ============================================================================
-- 8. 索引
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ai_models_source
  ON public.ai_models(source);

CREATE INDEX IF NOT EXISTS idx_ai_models_owner_id
  ON public.ai_models(owner_id)
  WHERE source = 'user_created';

CREATE INDEX IF NOT EXISTS idx_ai_models_is_public
  ON public.ai_models(is_public)
  WHERE is_public = true;

-- ============================================================================
-- 8. RLS 策略（用户自建角色的行级安全）
-- ============================================================================

-- 允许用户插入自己的角色
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ai_models' AND policyname = 'Users can insert own characters'
  ) THEN
    CREATE POLICY "Users can insert own characters"
      ON public.ai_models FOR INSERT
      WITH CHECK (
        owner_id = auth.uid()
        AND source = 'user_created'
      );
  END IF;
END $$;

-- 允许用户更新自己的角色
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ai_models' AND policyname = 'Users can update own characters'
  ) THEN
    CREATE POLICY "Users can update own characters"
      ON public.ai_models FOR UPDATE
      USING (
        owner_id = auth.uid()
        AND source = 'user_created'
      );
  END IF;
END $$;

-- 允许用户删除自己的角色
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ai_models' AND policyname = 'Users can delete own characters'
  ) THEN
    CREATE POLICY "Users can delete own characters"
      ON public.ai_models FOR DELETE
      USING (
        owner_id = auth.uid()
        AND source = 'user_created'
      );
  END IF;
END $$;

-- ============================================================================
-- 9. 表注释更新
-- ============================================================================

COMMENT ON COLUMN public.ai_models.source IS '角色来源：official=官方预置, user_created=用户自建';
COMMENT ON COLUMN public.ai_models.owner_id IS '创建者用户ID（仅 user_created 有值）';
COMMENT ON COLUMN public.ai_models.reference_images IS '用户上传/生成的参考图 URL 列表（JSONB 数组）';
COMMENT ON COLUMN public.ai_models.character_type IS '角色类型：realistic/anime/mascot/animal';
COMMENT ON COLUMN public.ai_models.dna_config IS 'DNA 配置快照（species、baseDna、gender 等完整选项）';
COMMENT ON COLUMN public.ai_models.reference_sheet_url IS '多角度合成参考图URL（用于图片/视频生产引用）';
COMMENT ON COLUMN public.ai_models.reference_status IS '参考图状态：none/pending/completed/failed';
COMMENT ON COLUMN public.ai_models.reference_task_id IS '参考图生成异步任务ID（nanoBanana taskId）';
COMMENT ON COLUMN public.ai_models.preview_video_url IS '角色活化视频URL';
COMMENT ON COLUMN public.ai_models.is_public IS '是否已发布到角色资源广场';
COMMENT ON COLUMN public.ai_models.publish_price IS '广场发布价格（积分）';

COMMIT;
