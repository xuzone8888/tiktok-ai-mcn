-- ============================================================================
-- 角色系统 (Character Studio) — 数据库迁移
-- ============================================================================
-- 创建时间: 2026-03-13
-- 描述: 扩展 ai_models 表以支持用户自建角色（捏脸舱），同时保持与现有平台模特的兼容
-- ============================================================================

-- ============================================================================
-- 1. 新增字段
-- ============================================================================

-- 来源标识：marketplace(平台公域) | user_created(用户自建)
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'marketplace';

-- 创建者 ID：仅 user_created 角色有值
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id);

-- 角色类型：realistic | anime | mascot | animal
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS character_type TEXT DEFAULT 'realistic';

-- 多角度参考图数组（16:9 转面图）
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS reference_images TEXT[] DEFAULT '{}';

-- DNA 捏脸配置（JSONB），用于二次编辑时还原选中状态
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS dna_config JSONB DEFAULT '{}'::jsonb;

-- 绑定角色专属音色（ElevenLabs / Doubao Voice ID）
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS voice_id TEXT;

-- ============================================================================
-- 2. 数据染色（保障旧数据可见性）
-- ============================================================================

-- 将所有现有平台模特标记为 marketplace，避免新 RLS 策略下"消失"
UPDATE ai_models SET source = 'marketplace' WHERE source IS NULL;

-- ============================================================================
-- 3. 索引
-- ============================================================================

-- 部分索引：仅为用户自建角色创建索引（marketplace 模特无需此索引）
CREATE INDEX IF NOT EXISTS idx_ai_models_owner
  ON ai_models(owner_id) WHERE source = 'user_created';

-- ============================================================================
-- 4. RLS 策略重建
-- ============================================================================

-- 【关键】先清除旧的通配策略，避免 "policy already exists" 报错
DROP POLICY IF EXISTS "Anyone can view active models" ON ai_models;
DROP POLICY IF EXISTS "marketplace_visible" ON ai_models;
DROP POLICY IF EXISTS "own_chars_visible" ON ai_models;
DROP POLICY IF EXISTS "create_chars" ON ai_models;
DROP POLICY IF EXISTS "manage_own_chars" ON ai_models;
DROP POLICY IF EXISTS "delete_own_chars" ON ai_models;

-- 策略 1：平台公域模特对全体已认证用户可见（替代旧的 is_active 判断）
CREATE POLICY "marketplace_visible" ON ai_models FOR SELECT
  USING (source = 'marketplace' OR source IS NULL);

-- 策略 2：用户只能看到自己创建的角色
CREATE POLICY "own_chars_visible" ON ai_models FOR SELECT
  USING (source = 'user_created' AND owner_id = auth.uid());

-- 策略 3：用户只能插入自己的角色
CREATE POLICY "create_chars" ON ai_models FOR INSERT
  WITH CHECK (source = 'user_created' AND owner_id = auth.uid());

-- 策略 4：用户只能更新自己的角色
CREATE POLICY "manage_own_chars" ON ai_models FOR UPDATE
  USING (source = 'user_created' AND owner_id = auth.uid());

-- 策略 5：用户只能删除自己的角色
CREATE POLICY "delete_own_chars" ON ai_models FOR DELETE
  USING (source = 'user_created' AND owner_id = auth.uid());
