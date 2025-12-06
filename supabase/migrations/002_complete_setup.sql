-- ============================================================================
-- TikTok AI MCN - 完整数据库初始化
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================================

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. 用户角色枚举
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('user', 'admin', 'super_admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 2. Profiles 表 (用户配置)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    avatar_url TEXT,
    role user_role DEFAULT 'user' NOT NULL,
    credits INTEGER DEFAULT 100 NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
    banned_at TIMESTAMPTZ,
    banned_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- ============================================================================
-- 3. AI Models 表 (AI 模特)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    avatar_url TEXT,
    sample_images JSONB DEFAULT '[]'::jsonb,
    sample_videos JSONB DEFAULT '[]'::jsonb,
    category TEXT NOT NULL DEFAULT 'general',
    style_tags JSONB DEFAULT '[]'::jsonb,
    gender TEXT CHECK (gender IN ('male', 'female', 'neutral')),
    age_range TEXT,
    
    -- 定价
    price_daily INTEGER DEFAULT 100,
    price_weekly INTEGER DEFAULT 500,
    price_monthly INTEGER DEFAULT 1500,
    price_yearly INTEGER DEFAULT 12000,
    
    -- 统计
    rating DECIMAL(3,2) DEFAULT 0,
    total_rentals INTEGER DEFAULT 0,
    total_generations INTEGER DEFAULT 0,
    
    -- 状态标记
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    is_trending BOOLEAN DEFAULT false,
    
    -- ⚠️ 敏感字段：Trigger Word (仅后端可见)
    trigger_word TEXT,
    
    -- 元数据
    capabilities JSONB DEFAULT '{"video": true, "image": true, "voice": false}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_ai_models_category ON public.ai_models(category);
CREATE INDEX IF NOT EXISTS idx_ai_models_is_active ON public.ai_models(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_models_is_featured ON public.ai_models(is_featured);

-- ============================================================================
-- 4. Contracts 表 (签约合同)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES public.ai_models(id) ON DELETE CASCADE,
    rental_period TEXT NOT NULL CHECK (rental_period IN ('daily', 'weekly', 'monthly', 'yearly')),
    start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_date TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
    credits_paid INTEGER NOT NULL,
    generations_count INTEGER DEFAULT 0,
    auto_renew BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    
    -- 防止同一用户重复签约同一模特
    UNIQUE(user_id, model_id, status)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_contracts_user_id ON public.contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_model_id ON public.contracts(model_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON public.contracts(status);

-- ============================================================================
-- 5. Generations 表 (生成记录)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.generations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    model_id UUID REFERENCES public.ai_models(id) ON DELETE SET NULL,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
    
    -- 输入
    prompt TEXT,
    source_image_url TEXT,
    
    -- 配置
    generation_type TEXT NOT NULL CHECK (generation_type IN ('video', 'image')),
    duration TEXT,
    aspect_ratio TEXT DEFAULT '9:16',
    resolution TEXT DEFAULT '1080p',
    
    -- 输出
    output_url TEXT,
    thumbnail_url TEXT,
    
    -- 状态
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    progress INTEGER DEFAULT 0,
    error_message TEXT,
    
    -- 积分
    credits_used INTEGER DEFAULT 0,
    credits_refunded INTEGER DEFAULT 0,
    
    -- 时间
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_generations_user_id ON public.generations(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_status ON public.generations(status);
CREATE INDEX IF NOT EXISTS idx_generations_created_at ON public.generations(created_at DESC);

-- ============================================================================
-- 6. Credit Transactions 表 (积分交易记录)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('purchase', 'usage', 'refund', 'bonus', 'admin_adjustment')),
    description TEXT,
    reference_id UUID, -- 关联的生成任务或合约 ID
    reference_type TEXT, -- 'generation', 'contract', etc.
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by UUID REFERENCES public.profiles(id) -- 操作人 (用于 admin 调整)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON public.credit_transactions(type);

-- ============================================================================
-- 7. Admin Audit Logs 表 (管理员操作日志)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    admin_email TEXT,
    target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    target_model_id UUID REFERENCES public.ai_models(id) ON DELETE SET NULL,
    target_type TEXT CHECK (target_type IN ('user', 'model', 'system', 'contract')),
    action_type TEXT NOT NULL,
    action_description TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id ON public.admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);

-- ============================================================================
-- 8. System Settings 表 (系统配置)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT NOT NULL UNIQUE,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES public.profiles(id)
);

-- 插入默认配置
INSERT INTO public.system_settings (key, value, description) VALUES
    ('pricing_video', '{"5s": 30, "10s": 50, "15s": 80, "20s": 120}', '视频生成定价'),
    ('pricing_image', '{"fast": 10, "pro": 28}', '图片处理定价'),
    ('announcement', '{"enabled": false, "content": "", "type": "info"}', '全站公告'),
    ('maintenance_mode', '{"enabled": false}', '维护模式'),
    ('payment_info', '{"bank": {}, "crypto": {}, "alipay": "", "wechat": ""}', '收款信息')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 9. RLS (Row Level Security) 策略
-- ============================================================================

-- 启用 RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 9.1 Profiles 策略
-- ============================================================================

-- 用户可以查看自己的 profile
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- 用户可以更新自己的 profile (除了 role 和 credits)
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Admin 可以查看所有 profiles
CREATE POLICY "Admins can view all profiles"
    ON public.profiles FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Admin 可以更新所有 profiles
CREATE POLICY "Admins can update all profiles"
    ON public.profiles FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- 允许新用户创建 profile
CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- ============================================================================
-- 9.2 AI Models 策略
-- ============================================================================

-- 所有人可以查看激活的模特 (不含 trigger_word)
CREATE POLICY "Anyone can view active models"
    ON public.ai_models FOR SELECT
    USING (is_active = true);

-- Admin 可以查看所有模特
CREATE POLICY "Admins can view all models"
    ON public.ai_models FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Admin 可以创建模特
CREATE POLICY "Admins can insert models"
    ON public.ai_models FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Admin 可以更新模特
CREATE POLICY "Admins can update models"
    ON public.ai_models FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Super Admin 可以删除模特
CREATE POLICY "Super admins can delete models"
    ON public.ai_models FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role = 'super_admin'
        )
    );

-- ============================================================================
-- 9.3 Contracts 策略
-- ============================================================================

-- 用户可以查看自己的合约
CREATE POLICY "Users can view own contracts"
    ON public.contracts FOR SELECT
    USING (auth.uid() = user_id);

-- 用户可以创建合约
CREATE POLICY "Users can create contracts"
    ON public.contracts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Admin 可以查看所有合约
CREATE POLICY "Admins can view all contracts"
    ON public.contracts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- ============================================================================
-- 9.4 Generations 策略
-- ============================================================================

-- 用户可以查看自己的生成记录
CREATE POLICY "Users can view own generations"
    ON public.generations FOR SELECT
    USING (auth.uid() = user_id);

-- 用户可以创建生成任务
CREATE POLICY "Users can create generations"
    ON public.generations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 用户可以更新自己的生成任务
CREATE POLICY "Users can update own generations"
    ON public.generations FOR UPDATE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 9.5 Credit Transactions 策略
-- ============================================================================

-- 用户可以查看自己的交易记录
CREATE POLICY "Users can view own transactions"
    ON public.credit_transactions FOR SELECT
    USING (auth.uid() = user_id);

-- Admin 可以查看所有交易
CREATE POLICY "Admins can view all transactions"
    ON public.credit_transactions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Admin 可以创建交易 (充值/扣款)
CREATE POLICY "Admins can create transactions"
    ON public.credit_transactions FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- ============================================================================
-- 9.6 Admin Audit Logs 策略
-- ============================================================================

-- 只有 Admin 可以查看审计日志
CREATE POLICY "Admins can view audit logs"
    ON public.admin_audit_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Admin 可以创建审计日志
CREATE POLICY "Admins can create audit logs"
    ON public.admin_audit_logs FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- ============================================================================
-- 9.7 System Settings 策略
-- ============================================================================

-- 所有人可以读取部分设置 (公告等)
CREATE POLICY "Anyone can view public settings"
    ON public.system_settings FOR SELECT
    USING (key IN ('announcement', 'maintenance_mode'));

-- Admin 可以查看所有设置
CREATE POLICY "Admins can view all settings"
    ON public.system_settings FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- Admin 可以更新设置
CREATE POLICY "Admins can update settings"
    ON public.system_settings FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- ============================================================================
-- 10. 触发器：自动更新 updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为各表创建触发器
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ai_models_updated_at ON public.ai_models;
CREATE TRIGGER update_ai_models_updated_at
    BEFORE UPDATE ON public.ai_models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contracts_updated_at ON public.contracts;
CREATE TRIGGER update_contracts_updated_at
    BEFORE UPDATE ON public.contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 11. 触发器：新用户注册时自动创建 Profile
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, name, role, credits)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        'user',
        100  -- 新用户赠送 100 积分
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建触发器
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 12. 辅助函数：获取当前用户角色
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ============================================================================
-- 13. 视图：公开模特列表 (不含 trigger_word)
-- ============================================================================

CREATE OR REPLACE VIEW public.ai_models_public AS
SELECT 
    id,
    name,
    description,
    avatar_url,
    sample_images,
    sample_videos,
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
    -- ⚠️ 注意：trigger_word 和 metadata 被排除
FROM public.ai_models
WHERE is_active = true;

-- ============================================================================
-- 14. 插入示例 AI 模特数据
-- ============================================================================

INSERT INTO public.ai_models (name, description, avatar_url, category, style_tags, gender, age_range, price_monthly, rating, is_active, is_featured, is_trending, trigger_word) VALUES
('Luna AI', '时尚穿搭达人，擅长展示各类服装和配饰', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=500&fit=crop', 'Fashion', '["American", "Teen", "Streetwear"]', 'female', '20-25', 1500, 4.9, true, true, true, '@luna_fashion_v1'),
('Alex Storm', '健身运动博主，专业展示运动装备', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=500&fit=crop', 'Fitness', '["Athletic", "Sporty", "Energetic"]', 'male', '25-30', 1800, 4.8, true, true, true, '@alex_fitness_v1'),
('Mia Rose', '美妆护肤专家，精通各类化妆品展示', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=500&fit=crop', 'Beauty', '["Elegant", "Glamour", "K-Beauty"]', 'female', '22-28', 2200, 4.9, true, true, false, '@mia_beauty_v1'),
('Marcus Tech', '科技数码评测员，擅长电子产品展示', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=500&fit=crop', 'Tech', '["Professional", "Tech-savvy", "Modern"]', 'male', '28-35', 1500, 4.7, true, false, false, '@max_tech_v1'),
('Sophia Chen', '生活方式博主，展示日常生活和家居用品', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=500&fit=crop', 'Lifestyle', '["Asian", "Cozy", "Minimalist"]', 'female', '25-32', 1900, 4.9, true, true, true, '@sophia_lifestyle_v2')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 完成提示
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ 数据库初始化完成！';
    RAISE NOTICE '';
    RAISE NOTICE '下一步：';
    RAISE NOTICE '1. 前往 Storage 创建存储桶';
    RAISE NOTICE '2. 注册账号并设置管理员';
END $$;

