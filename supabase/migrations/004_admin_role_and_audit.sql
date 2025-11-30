-- ============================================================================
-- TikTok AI MCN - Admin 角色权限与审计系统
-- ============================================================================
-- 创建时间: 2024
-- 描述: 
--   1. 用户角色系统 (role field)
--   2. Admin 审计日志表 (admin_audit_logs)
--   3. RLS 策略升级 (保护 ai_models 和 trigger_word)
-- ============================================================================

-- ============================================================================
-- 1. 用户角色系统 (Role System)
-- ============================================================================

-- 创建角色枚举类型
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('user', 'admin', 'super_admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 添加 role 字段到 users 表
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS role user_role DEFAULT 'user' NOT NULL;

-- 添加 status 字段 (用于封禁用户)
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' NOT NULL 
CHECK (status IN ('active', 'suspended', 'banned'));

-- 添加 banned_at 和 banned_reason 字段
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS banned_reason TEXT;

-- 添加角色字段索引
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users(status);

-- 字段注释
COMMENT ON COLUMN public.users.role IS '用户角色: user(普通用户), admin(管理员), super_admin(超级管理员)';
COMMENT ON COLUMN public.users.status IS '用户状态: active(正常), suspended(暂停), banned(封禁)';
COMMENT ON COLUMN public.users.banned_at IS '封禁时间';
COMMENT ON COLUMN public.users.banned_reason IS '封禁原因';

-- ============================================================================
-- 2. 设置初始 Admin 账号
-- ============================================================================

-- 注意：请将下面的邮箱替换为您自己的 Admin 邮箱
-- 方法1：通过邮箱设置 (推荐)
UPDATE public.users 
SET role = 'super_admin' 
WHERE email = 'admin@mcn.ai';

-- 方法2：如果您知道用户ID，可以直接设置
-- UPDATE public.users 
-- SET role = 'super_admin' 
-- WHERE id = '您的Supabase用户ID';

-- ============================================================================
-- 3. Admin 审计日志表 (Audit Logs)
-- ============================================================================

-- 创建审计日志操作类型枚举
DO $$ BEGIN
    CREATE TYPE audit_action_type AS ENUM (
        -- 用户管理
        'create_user',
        'update_user',
        'ban_user',
        'unban_user',
        'suspend_user',
        'delete_user',
        'change_role',
        
        -- 积分管理
        'recharge_credits',
        'deduct_credits',
        'refund_credits',
        
        -- 模特管理
        'create_model',
        'update_model',
        'delete_model',
        'update_trigger_word',
        
        -- 合约管理
        'cancel_contract',
        'extend_contract',
        
        -- 系统操作
        'system_config',
        'other'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 创建审计日志表
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 操作人信息
    admin_id UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    admin_email TEXT,  -- 冗余存储，防止用户删除后无法追踪
    
    -- 被操作对象
    target_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    target_model_id UUID REFERENCES public.ai_models(id) ON DELETE SET NULL,
    target_type TEXT,  -- 'user', 'model', 'contract', 'system'
    
    -- 操作详情
    action_type audit_action_type NOT NULL,
    action_description TEXT,
    
    -- 详细数据 (JSONB)
    details JSONB DEFAULT '{}'::jsonb NOT NULL,
    -- 格式示例：
    -- {
    --   "before": { "credits": 100 },
    --   "after": { "credits": 500 },
    --   "amount": 400,
    --   "reason": "用户投诉补偿"
    -- }
    
    -- 请求信息 (用于安全审计)
    ip_address INET,
    user_agent TEXT,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 审计日志索引
CREATE INDEX idx_audit_logs_admin_id ON public.admin_audit_logs(admin_id);
CREATE INDEX idx_audit_logs_target_user ON public.admin_audit_logs(target_user_id);
CREATE INDEX idx_audit_logs_action_type ON public.admin_audit_logs(action_type);
CREATE INDEX idx_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_target_type ON public.admin_audit_logs(target_type);

-- 审计日志表注释
COMMENT ON TABLE public.admin_audit_logs IS 'Admin 操作审计日志表，记录所有管理员操作，用于安全审计和问题追溯';
COMMENT ON COLUMN public.admin_audit_logs.details IS '操作详情 JSONB，包含 before/after 状态、金额、原因等';

-- ============================================================================
-- 4. RLS 策略升级 - 保护 AI 模特数据
-- ============================================================================

-- 辅助函数：检查当前用户是否是 Admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
        AND status = 'active'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 辅助函数：检查当前用户是否是 Super Admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND role = 'super_admin'
        AND status = 'active'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 辅助函数：获取当前用户角色
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
DECLARE
    v_role user_role;
BEGIN
    SELECT role INTO v_role
    FROM public.users
    WHERE id = auth.uid();
    
    RETURN COALESCE(v_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- AI_Models 表 RLS 策略升级
-- ----------------------------------------------------------------------------

-- 删除旧的 RLS 策略
DROP POLICY IF EXISTS "Anyone can view active models" ON public.ai_models;
DROP POLICY IF EXISTS "Users can view active models basic info" ON public.ai_models;

-- 新策略：普通用户只能查看活跃模特（不包含 trigger_word）
CREATE POLICY "Users can view active models"
    ON public.ai_models FOR SELECT
    USING (is_active = true OR is_admin());

-- 新策略：只有 Admin 可以插入模特
CREATE POLICY "Admins can insert models"
    ON public.ai_models FOR INSERT
    WITH CHECK (is_admin());

-- 新策略：只有 Admin 可以更新模特
CREATE POLICY "Admins can update models"
    ON public.ai_models FOR UPDATE
    USING (is_admin())
    WITH CHECK (is_admin());

-- 新策略：只有 Super Admin 可以删除模特
CREATE POLICY "Super admins can delete models"
    ON public.ai_models FOR DELETE
    USING (is_super_admin());

-- ----------------------------------------------------------------------------
-- Admin_Audit_Logs 表 RLS 策略
-- ----------------------------------------------------------------------------

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- 只有 Admin 可以查看审计日志
CREATE POLICY "Admins can view audit logs"
    ON public.admin_audit_logs FOR SELECT
    USING (is_admin());

-- 只有系统可以插入审计日志 (通过 service role)
-- 注意：普通 Admin 不能直接插入，必须通过 API 函数

-- ----------------------------------------------------------------------------
-- Users 表 RLS 策略升级 (Admin 可以查看和修改所有用户)
-- ----------------------------------------------------------------------------

-- 删除旧策略
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;

-- 新策略：用户可以查看自己的信息，Admin 可以查看所有
CREATE POLICY "Users can view profiles"
    ON public.users FOR SELECT
    USING (auth.uid() = id OR is_admin());

-- 新策略：用户可以更新自己的信息，Admin 可以更新所有
CREATE POLICY "Users can update profiles"
    ON public.users FOR UPDATE
    USING (auth.uid() = id OR is_admin())
    WITH CHECK (
        -- 普通用户不能修改自己的 role 和 status
        (auth.uid() = id AND (
            COALESCE(role, 'user') = 'user' OR is_admin()
        ))
        OR is_admin()
    );

-- ============================================================================
-- 5. 安全视图 - 隐藏 trigger_word (前端使用)
-- ============================================================================

-- 删除旧视图
DROP VIEW IF EXISTS public.ai_models_public;

-- 创建新的公开视图（不包含 trigger_word）
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
    created_at,
    updated_at
    -- 注意：不包含 trigger_word 和 metadata
FROM public.ai_models
WHERE is_active = true;

-- 视图注释
COMMENT ON VIEW public.ai_models_public IS 
'AI 模特公开信息视图，供前端 API 使用。不包含敏感字段 trigger_word。';

-- ============================================================================
-- 6. Admin 专用函数
-- ============================================================================

-- 函数：Admin 充值积分 (带审计日志)
CREATE OR REPLACE FUNCTION admin_recharge_credits(
    p_admin_id UUID,
    p_target_user_id UUID,
    p_amount INTEGER,
    p_reason TEXT DEFAULT NULL,
    p_ip_address INET DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_old_credits INTEGER;
    v_new_credits INTEGER;
    v_admin_email TEXT;
    v_log_id UUID;
BEGIN
    -- 验证是否是 Admin
    IF NOT EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = p_admin_id AND role IN ('admin', 'super_admin')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Not an admin';
    END IF;
    
    -- 获取 Admin 邮箱
    SELECT email INTO v_admin_email FROM public.users WHERE id = p_admin_id;
    
    -- 获取当前积分
    SELECT credits INTO v_old_credits FROM public.users WHERE id = p_target_user_id;
    
    IF v_old_credits IS NULL THEN
        RAISE EXCEPTION 'User not found';
    END IF;
    
    -- 更新积分
    v_new_credits := v_old_credits + p_amount;
    
    UPDATE public.users 
    SET credits = v_new_credits, updated_at = NOW()
    WHERE id = p_target_user_id;
    
    -- 记录审计日志
    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, target_user_id, target_type,
        action_type, action_description, details, ip_address
    ) VALUES (
        p_admin_id, v_admin_email, p_target_user_id, 'user',
        'recharge_credits', 
        'Admin recharged ' || p_amount || ' credits',
        jsonb_build_object(
            'before', jsonb_build_object('credits', v_old_credits),
            'after', jsonb_build_object('credits', v_new_credits),
            'amount', p_amount,
            'reason', COALESCE(p_reason, 'Admin recharge')
        ),
        p_ip_address
    )
    RETURNING id INTO v_log_id;
    
    -- 记录积分交易
    INSERT INTO public.credit_transactions (
        user_id, type, amount, balance_after, 
        reference_type, reference_id, description
    ) VALUES (
        p_target_user_id, 'bonus', p_amount, v_new_credits,
        'admin_recharge', v_log_id, 
        'Admin recharge: ' || COALESCE(p_reason, 'No reason provided')
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'old_credits', v_old_credits,
        'new_credits', v_new_credits,
        'amount', p_amount,
        'log_id', v_log_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 函数：Admin 封禁用户 (带审计日志)
CREATE OR REPLACE FUNCTION admin_ban_user(
    p_admin_id UUID,
    p_target_user_id UUID,
    p_reason TEXT,
    p_ip_address INET DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_admin_email TEXT;
    v_target_email TEXT;
    v_log_id UUID;
BEGIN
    -- 验证是否是 Admin
    IF NOT EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = p_admin_id AND role IN ('admin', 'super_admin')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Not an admin';
    END IF;
    
    -- 防止封禁其他 Admin
    IF EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = p_target_user_id AND role IN ('admin', 'super_admin')
    ) THEN
        -- 只有 Super Admin 可以封禁 Admin
        IF NOT EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = p_admin_id AND role = 'super_admin'
        ) THEN
            RAISE EXCEPTION 'Cannot ban admin users';
        END IF;
    END IF;
    
    -- 获取邮箱
    SELECT email INTO v_admin_email FROM public.users WHERE id = p_admin_id;
    SELECT email INTO v_target_email FROM public.users WHERE id = p_target_user_id;
    
    -- 更新用户状态
    UPDATE public.users 
    SET status = 'banned', 
        banned_at = NOW(), 
        banned_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_target_user_id;
    
    -- 记录审计日志
    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, target_user_id, target_type,
        action_type, action_description, details, ip_address
    ) VALUES (
        p_admin_id, v_admin_email, p_target_user_id, 'user',
        'ban_user', 
        'Admin banned user: ' || v_target_email,
        jsonb_build_object(
            'target_email', v_target_email,
            'reason', p_reason,
            'banned_at', NOW()
        ),
        p_ip_address
    )
    RETURNING id INTO v_log_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_target_user_id,
        'status', 'banned',
        'log_id', v_log_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 函数：Admin 解封用户
CREATE OR REPLACE FUNCTION admin_unban_user(
    p_admin_id UUID,
    p_target_user_id UUID,
    p_reason TEXT DEFAULT 'Admin unbanned',
    p_ip_address INET DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_admin_email TEXT;
    v_target_email TEXT;
    v_log_id UUID;
BEGIN
    -- 验证是否是 Admin
    IF NOT EXISTS (
        SELECT 1 FROM public.users 
        WHERE id = p_admin_id AND role IN ('admin', 'super_admin')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Not an admin';
    END IF;
    
    -- 获取邮箱
    SELECT email INTO v_admin_email FROM public.users WHERE id = p_admin_id;
    SELECT email INTO v_target_email FROM public.users WHERE id = p_target_user_id;
    
    -- 更新用户状态
    UPDATE public.users 
    SET status = 'active', 
        banned_at = NULL, 
        banned_reason = NULL,
        updated_at = NOW()
    WHERE id = p_target_user_id;
    
    -- 记录审计日志
    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, target_user_id, target_type,
        action_type, action_description, details, ip_address
    ) VALUES (
        p_admin_id, v_admin_email, p_target_user_id, 'user',
        'unban_user', 
        'Admin unbanned user: ' || v_target_email,
        jsonb_build_object(
            'target_email', v_target_email,
            'reason', p_reason
        ),
        p_ip_address
    )
    RETURNING id INTO v_log_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_target_user_id,
        'status', 'active',
        'log_id', v_log_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. 创建获取用户信息的安全函数 (用于中间件验证)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_profile_for_auth()
RETURNS TABLE (
    id UUID,
    email TEXT,
    name TEXT,
    role user_role,
    status TEXT,
    credits INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.email,
        u.name,
        u.role,
        u.status,
        u.credits
    FROM public.users u
    WHERE u.id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 完成！
-- ============================================================================

-- 输出提示信息
DO $$
BEGIN
    RAISE NOTICE '====================================';
    RAISE NOTICE 'Admin Role and Audit System Created!';
    RAISE NOTICE '====================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Next Steps:';
    RAISE NOTICE '1. Update the admin email in this migration file';
    RAISE NOTICE '2. Run: UPDATE users SET role = ''super_admin'' WHERE email = ''your-admin-email@example.com''';
    RAISE NOTICE '';
END $$;

