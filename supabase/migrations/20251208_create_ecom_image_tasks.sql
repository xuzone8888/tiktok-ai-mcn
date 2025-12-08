-- ============================================================================
-- 电商图片工厂 - 数据库迁移脚本
-- 
-- 使用方法:
-- 1. 登录 Supabase Dashboard: https://supabase.com/dashboard
-- 2. 进入项目 → SQL Editor
-- 3. 复制并执行此脚本
-- ============================================================================

-- ============================================================================
-- 1. 创建枚举类型
-- ============================================================================

-- 电商图片模式枚举
DO $$ BEGIN
  CREATE TYPE ecom_image_mode AS ENUM (
    'ecom_five_pack',     -- 电商五图套装
    'white_background',   -- 一键白底图
    'scene_image',        -- 一键产品场景图
    'try_on',             -- 一键试穿试戴
    'buyer_show'          -- 一键买家秀
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 电商任务状态枚举
DO $$ BEGIN
  CREATE TYPE ecom_task_status AS ENUM (
    'created',
    'generating_prompts',
    'generating_images',
    'success',
    'partial_success',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 2. 创建主表
-- ============================================================================

CREATE TABLE IF NOT EXISTS ecom_image_tasks (
  -- 主键
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 用户关联
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- 模式配置
  mode ecom_image_mode NOT NULL,
  model_type TEXT NOT NULL CHECK (model_type IN ('nano-banana', 'nano-banana-pro')),
  language TEXT NOT NULL CHECK (language IN ('zh', 'en')) DEFAULT 'zh',
  ratio TEXT NOT NULL DEFAULT 'auto',
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('1k', '2k', '4k')),
  
  -- 输入数据
  input_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- 模式特有配置
  -- ecom_five_pack: { "product_category": "clothing" }
  -- scene_image: { "scene_type": "bedroom" }
  -- try_on: { "model_id": "uuid", "model_name": "xxx", "model_trigger_word": "xxx", "product_type": "clothing" }
  -- buyer_show: { "style": "selfie", "persona": { "age": "18-25", "gender": "female", "region": "asia" } }
  mode_config JSONB DEFAULT '{}'::jsonb,
  
  -- 提示词
  -- {
  --   "original": { "main": "...", "scene": "...", ... },
  --   "modified": { "main": "...", "scene": "...", ... }
  -- }
  prompts JSONB DEFAULT '{}'::jsonb,
  
  -- 输出结果
  -- [
  --   { "type": "main", "url": "...", "task_id": "...", "status": "completed" },
  --   { "type": "scene", "url": "...", "task_id": "...", "status": "completed" },
  --   ...
  -- ]
  output_items JSONB DEFAULT '[]'::jsonb,
  
  -- 状态
  status ecom_task_status NOT NULL DEFAULT 'created',
  current_step INTEGER NOT NULL DEFAULT 1,  -- 1=上传, 2=生成提示词, 3=生成图片
  error_message TEXT,
  
  -- 积分
  credits_cost INTEGER NOT NULL DEFAULT 0,
  credits_charged BOOLEAN NOT NULL DEFAULT FALSE,
  credits_charged_at TIMESTAMPTZ,
  
  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  -- 元数据（扩展字段）
  metadata JSONB DEFAULT '{}'::jsonb
);

-- ============================================================================
-- 3. 创建索引
-- ============================================================================

-- 用户索引（最常用查询）
CREATE INDEX IF NOT EXISTS idx_ecom_image_tasks_user_id 
  ON ecom_image_tasks(user_id);

-- 模式索引（按类型筛选）
CREATE INDEX IF NOT EXISTS idx_ecom_image_tasks_mode 
  ON ecom_image_tasks(mode);

-- 状态索引（查询进行中/失败任务）
CREATE INDEX IF NOT EXISTS idx_ecom_image_tasks_status 
  ON ecom_image_tasks(status);

-- 创建时间索引（排序用）
CREATE INDEX IF NOT EXISTS idx_ecom_image_tasks_created_at 
  ON ecom_image_tasks(created_at DESC);

-- 复合索引：用户+状态（常见查询模式）
CREATE INDEX IF NOT EXISTS idx_ecom_image_tasks_user_status 
  ON ecom_image_tasks(user_id, status);

-- 复合索引：用户+模式（按类型查看历史）
CREATE INDEX IF NOT EXISTS idx_ecom_image_tasks_user_mode 
  ON ecom_image_tasks(user_id, mode);

-- ============================================================================
-- 4. 启用 RLS (Row Level Security)
-- ============================================================================

ALTER TABLE ecom_image_tasks ENABLE ROW LEVEL SECURITY;

-- 用户只能查看自己的任务
CREATE POLICY "Users can view own ecom tasks"
  ON ecom_image_tasks FOR SELECT
  USING (auth.uid() = user_id);

-- 用户只能创建自己的任务
CREATE POLICY "Users can create own ecom tasks"
  ON ecom_image_tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 用户只能更新自己的任务
CREATE POLICY "Users can update own ecom tasks"
  ON ecom_image_tasks FOR UPDATE
  USING (auth.uid() = user_id);

-- 用户只能删除自己的任务
CREATE POLICY "Users can delete own ecom tasks"
  ON ecom_image_tasks FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 5. 创建触发器：自动更新 updated_at
-- ============================================================================

-- 创建函数（如果不存在）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器
DROP TRIGGER IF EXISTS trigger_ecom_image_tasks_updated_at ON ecom_image_tasks;
CREATE TRIGGER trigger_ecom_image_tasks_updated_at
  BEFORE UPDATE ON ecom_image_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. 添加注释
-- ============================================================================

COMMENT ON TABLE ecom_image_tasks IS '电商图片工厂任务表';
COMMENT ON COLUMN ecom_image_tasks.mode IS '任务模式：电商五图套装/白底图/场景图/试穿/买家秀';
COMMENT ON COLUMN ecom_image_tasks.model_type IS '图片模型：nano-banana 或 nano-banana-pro';
COMMENT ON COLUMN ecom_image_tasks.language IS '语言：zh(中文) 或 en(英文)';
COMMENT ON COLUMN ecom_image_tasks.ratio IS '图片比例：auto/1:1/16:9/9:16/4:3/3:4';
COMMENT ON COLUMN ecom_image_tasks.resolution IS '输出分辨率：1k/2k/4k（仅Pro模型）';
COMMENT ON COLUMN ecom_image_tasks.input_image_urls IS '输入图片URL数组';
COMMENT ON COLUMN ecom_image_tasks.mode_config IS '模式特有配置';
COMMENT ON COLUMN ecom_image_tasks.prompts IS '提示词（原始/修改后）';
COMMENT ON COLUMN ecom_image_tasks.output_items IS '输出项数组';
COMMENT ON COLUMN ecom_image_tasks.current_step IS '当前步骤：1=上传, 2=生成提示词, 3=生成图片';
COMMENT ON COLUMN ecom_image_tasks.credits_cost IS '任务消耗积分';
COMMENT ON COLUMN ecom_image_tasks.credits_charged IS '是否已扣费';

-- ============================================================================
-- 7. 授权 Service Role（用于API服务端操作）
-- ============================================================================

-- 注意：这允许服务端 API 绕过 RLS 进行操作
-- 在实际 API 中，我们使用 createAdminClient() 来操作

GRANT ALL ON ecom_image_tasks TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ============================================================================
-- 迁移完成
-- ============================================================================

-- 验证表是否创建成功
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'ecom_image_tasks'
  ) THEN
    RAISE NOTICE '✅ 表 ecom_image_tasks 创建成功！';
  ELSE
    RAISE EXCEPTION '❌ 表 ecom_image_tasks 创建失败！';
  END IF;
END $$;

