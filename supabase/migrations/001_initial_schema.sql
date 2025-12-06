-- ============================================================================
-- TikTok AI MCN - 数据库结构
-- ============================================================================
-- 创建时间: 2024
-- 描述: 完整的数据库架构，包含用户、产品、模特、合约和生成记录
-- ============================================================================

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ENUMS (枚举类型)
-- ============================================================================

-- 合约状态枚举
CREATE TYPE contract_status AS ENUM ('active', 'expired', 'cancelled');

-- 生成类型枚举
CREATE TYPE generation_type AS ENUM ('video', 'image');

-- 生成状态枚举
CREATE TYPE generation_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- 产品状态枚举
CREATE TYPE product_status AS ENUM ('pending', 'processing', 'ready', 'failed');

-- 租赁周期枚举
CREATE TYPE rental_period AS ENUM ('daily', 'weekly', 'monthly', 'yearly');

-- ============================================================================
-- 2. USERS 表 - 用户信息
-- ============================================================================

CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    avatar_url TEXT,
    credits INTEGER DEFAULT 0 NOT NULL CHECK (credits >= 0),
    
    -- 用户设置
    settings JSONB DEFAULT '{
        "notifications": true,
        "language": "zh-CN",
        "timezone": "Asia/Shanghai"
    }'::jsonb,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 用户表索引
CREATE INDEX idx_users_email ON public.users(email);
CREATE INDEX idx_users_created_at ON public.users(created_at DESC);

-- 用户表注释
COMMENT ON TABLE public.users IS '用户信息表，存储用户基本信息和积分余额';
COMMENT ON COLUMN public.users.credits IS '用户积分余额，用于租赁模特和生成内容';

-- ============================================================================
-- 3. AI_MODELS 表 - AI 模特库
-- ============================================================================

CREATE TABLE public.ai_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 基本信息
    name TEXT NOT NULL,
    description TEXT,
    avatar_url TEXT,
    
    -- 样片和展示
    sample_images JSONB DEFAULT '[]'::jsonb,  -- 样片图片 URLs
    sample_videos JSONB DEFAULT '[]'::jsonb,  -- 样片视频 URLs
    preview_url TEXT,                          -- 预览视频/图片
    
    -- 分类和标签
    category TEXT NOT NULL,                    -- 主分类：时尚、美妆、健身等
    style_tags TEXT[] DEFAULT '{}',            -- 风格标签数组
    gender TEXT CHECK (gender IN ('male', 'female', 'neutral')),
    age_range TEXT,                            -- 年龄范围：20-25, 25-30 等
    
    -- 定价（以积分计算）
    price_daily INTEGER NOT NULL DEFAULT 100,
    price_weekly INTEGER NOT NULL DEFAULT 500,
    price_monthly INTEGER NOT NULL DEFAULT 1500,
    price_yearly INTEGER NOT NULL DEFAULT 12000,
    
    -- 统计数据
    rating DECIMAL(2,1) DEFAULT 5.0 CHECK (rating >= 0 AND rating <= 5),
    total_rentals INTEGER DEFAULT 0,
    total_generations INTEGER DEFAULT 0,
    
    -- 状态
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    is_trending BOOLEAN DEFAULT false,
    
    -- 能力和限制
    capabilities JSONB DEFAULT '{
        "video": true,
        "image": true,
        "voice": true,
        "languages": ["zh-CN", "en-US"]
    }'::jsonb,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 模特表索引
CREATE INDEX idx_ai_models_category ON public.ai_models(category);
CREATE INDEX idx_ai_models_style_tags ON public.ai_models USING GIN(style_tags);
CREATE INDEX idx_ai_models_is_active ON public.ai_models(is_active) WHERE is_active = true;
CREATE INDEX idx_ai_models_is_trending ON public.ai_models(is_trending) WHERE is_trending = true;
CREATE INDEX idx_ai_models_rating ON public.ai_models(rating DESC);
CREATE INDEX idx_ai_models_price_daily ON public.ai_models(price_daily);

-- 模特表注释
COMMENT ON TABLE public.ai_models IS 'AI 模特库，存储系统提供的 1000+ 数字人模特';
COMMENT ON COLUMN public.ai_models.sample_images IS '模特样片图片 URLs，JSONB 数组格式';
COMMENT ON COLUMN public.ai_models.style_tags IS '风格标签，如：["时尚", "年轻", "活力"]';

-- ============================================================================
-- 4. PRODUCTS 表 - 用户上传的产品/素材
-- ============================================================================

CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    
    -- 基本信息
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    
    -- 原始图片
    original_image_url TEXT NOT NULL,
    
    -- AI 处理后的九宫格图集
    -- 格式: { "grid_images": ["url1", "url2", ...], "processed_at": "timestamp" }
    processed_images JSONB DEFAULT NULL,
    
    -- 产品状态
    status product_status DEFAULT 'pending',
    processing_error TEXT,
    
    -- 标签和分类
    tags TEXT[] DEFAULT '{}',
    
    -- 元数据（存储额外的产品信息）
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 统计
    usage_count INTEGER DEFAULT 0,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    processed_at TIMESTAMPTZ
);

-- 产品表索引
CREATE INDEX idx_products_user_id ON public.products(user_id);
CREATE INDEX idx_products_status ON public.products(status);
CREATE INDEX idx_products_category ON public.products(category);
CREATE INDEX idx_products_tags ON public.products USING GIN(tags);
CREATE INDEX idx_products_created_at ON public.products(created_at DESC);

-- 产品表注释
COMMENT ON TABLE public.products IS '用户上传的产品/素材表';
COMMENT ON COLUMN public.products.processed_images IS 'AI 处理后的九宫格图集，JSONB 格式存储多个 URL';

-- ============================================================================
-- 5. CONTRACTS 表 - 模特租赁合约 (核心表)
-- ============================================================================

CREATE TABLE public.contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES public.ai_models(id) ON DELETE RESTRICT,
    
    -- 租赁周期
    rental_period rental_period NOT NULL,
    
    -- 合约时间
    start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_date TIMESTAMPTZ NOT NULL,
    
    -- 合约状态
    status contract_status DEFAULT 'active',
    
    -- 费用信息
    credits_paid INTEGER NOT NULL CHECK (credits_paid > 0),
    
    -- 使用统计
    generations_count INTEGER DEFAULT 0,
    
    -- 自动续费
    auto_renew BOOLEAN DEFAULT false,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    cancelled_at TIMESTAMPTZ,
    
    -- 约束：确保结束日期大于开始日期
    CONSTRAINT valid_date_range CHECK (end_date > start_date)
);

-- 合约表索引
CREATE INDEX idx_contracts_user_id ON public.contracts(user_id);
CREATE INDEX idx_contracts_model_id ON public.contracts(model_id);
CREATE INDEX idx_contracts_status ON public.contracts(status);
CREATE INDEX idx_contracts_end_date ON public.contracts(end_date);
CREATE INDEX idx_contracts_user_status ON public.contracts(user_id, status) WHERE status = 'active';

-- 复合索引：快速查询用户的有效合约
CREATE INDEX idx_contracts_user_active ON public.contracts(user_id, model_id) 
    WHERE status = 'active';

-- 合约表注释
COMMENT ON TABLE public.contracts IS '模特租赁合约表 - 核心业务表，记录用户与模特的租赁关系';
COMMENT ON COLUMN public.contracts.status IS '合约状态：active(有效), expired(已过期), cancelled(已取消)';
COMMENT ON COLUMN public.contracts.credits_paid IS '本次租赁支付的积分数量';

-- ============================================================================
-- 6. GENERATIONS 表 - 内容生成记录
-- ============================================================================

CREATE TABLE public.generations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    model_id UUID NOT NULL REFERENCES public.ai_models(id) ON DELETE RESTRICT,
    
    -- 生成类型和状态
    type generation_type NOT NULL,
    status generation_status DEFAULT 'pending',
    
    -- 输入参数
    input_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 格式示例：
    -- {
    --   "script": "文案内容",
    --   "duration": 30,
    --   "style": "casual",
    --   "voice_id": "xxx",
    --   "background_music": "xxx"
    -- }
    
    -- 输出结果
    output_url TEXT,
    output_urls JSONB DEFAULT '[]'::jsonb,  -- 多个输出文件
    thumbnail_url TEXT,
    
    -- 生成信息
    duration INTEGER,           -- 视频时长（秒）
    resolution TEXT,            -- 分辨率：1080x1920
    file_size INTEGER,          -- 文件大小（字节）
    
    -- 积分消耗
    credits_used INTEGER DEFAULT 0,
    
    -- 错误信息
    error_message TEXT,
    
    -- 进度跟踪
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- 生成记录表索引
CREATE INDEX idx_generations_user_id ON public.generations(user_id);
CREATE INDEX idx_generations_contract_id ON public.generations(contract_id);
CREATE INDEX idx_generations_model_id ON public.generations(model_id);
CREATE INDEX idx_generations_product_id ON public.generations(product_id);
CREATE INDEX idx_generations_type ON public.generations(type);
CREATE INDEX idx_generations_status ON public.generations(status);
CREATE INDEX idx_generations_created_at ON public.generations(created_at DESC);

-- 生成记录表注释
COMMENT ON TABLE public.generations IS '内容生成历史记录表，记录所有生成的视频/图片';
COMMENT ON COLUMN public.generations.input_params IS '生成输入参数，包含文案、风格、时长等';
COMMENT ON COLUMN public.generations.output_urls IS '多个输出文件 URLs，JSONB 数组格式';

-- ============================================================================
-- 7. CREDIT_TRANSACTIONS 表 - 积分交易记录
-- ============================================================================

CREATE TABLE public.credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    
    -- 交易类型
    type TEXT NOT NULL CHECK (type IN ('purchase', 'consume', 'refund', 'bonus', 'expire')),
    
    -- 积分变动
    amount INTEGER NOT NULL,  -- 正数为增加，负数为减少
    balance_after INTEGER NOT NULL,  -- 交易后余额
    
    -- 关联信息
    reference_type TEXT,  -- 关联类型：contract, generation, order
    reference_id UUID,    -- 关联 ID
    
    -- 描述
    description TEXT,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 时间戳
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 积分交易表索引
CREATE INDEX idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_type ON public.credit_transactions(type);
CREATE INDEX idx_credit_transactions_created_at ON public.credit_transactions(created_at DESC);
CREATE INDEX idx_credit_transactions_reference ON public.credit_transactions(reference_type, reference_id);

-- 积分交易表注释
COMMENT ON TABLE public.credit_transactions IS '积分交易记录表，记录所有积分的增减变动';

-- ============================================================================
-- 8. ROW LEVEL SECURITY (RLS) 策略
-- ============================================================================

-- 启用 RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Users 表 RLS 策略
-- ----------------------------------------------------------------------------

-- 用户只能查看自己的信息
CREATE POLICY "Users can view own profile"
    ON public.users FOR SELECT
    USING (auth.uid() = id);

-- 用户只能更新自己的信息
CREATE POLICY "Users can update own profile"
    ON public.users FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- 新用户注册时插入（通过触发器处理）
CREATE POLICY "Enable insert for authentication"
    ON public.users FOR INSERT
    WITH CHECK (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- AI_Models 表 RLS 策略
-- ----------------------------------------------------------------------------

-- 所有已认证用户都可以查看活跃的模特
CREATE POLICY "Anyone can view active models"
    ON public.ai_models FOR SELECT
    USING (is_active = true);

-- 只有管理员可以修改模特（通过 service role）

-- ----------------------------------------------------------------------------
-- Products 表 RLS 策略
-- ----------------------------------------------------------------------------

-- 用户只能查看自己的产品
CREATE POLICY "Users can view own products"
    ON public.products FOR SELECT
    USING (auth.uid() = user_id);

-- 用户只能创建自己的产品
CREATE POLICY "Users can create own products"
    ON public.products FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 用户只能更新自己的产品
CREATE POLICY "Users can update own products"
    ON public.products FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 用户只能删除自己的产品
CREATE POLICY "Users can delete own products"
    ON public.products FOR DELETE
    USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Contracts 表 RLS 策略
-- ----------------------------------------------------------------------------

-- 用户只能查看自己的合约
CREATE POLICY "Users can view own contracts"
    ON public.contracts FOR SELECT
    USING (auth.uid() = user_id);

-- 用户只能创建自己的合约
CREATE POLICY "Users can create own contracts"
    ON public.contracts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 用户只能更新自己的合约（有限制）
CREATE POLICY "Users can update own contracts"
    ON public.contracts FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Generations 表 RLS 策略
-- ----------------------------------------------------------------------------

-- 用户只能查看自己的生成记录
CREATE POLICY "Users can view own generations"
    ON public.generations FOR SELECT
    USING (auth.uid() = user_id);

-- 用户只能创建自己的生成记录
CREATE POLICY "Users can create own generations"
    ON public.generations FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 用户只能更新自己的生成记录
CREATE POLICY "Users can update own generations"
    ON public.generations FOR UPDATE
    USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Credit_Transactions 表 RLS 策略
-- ----------------------------------------------------------------------------

-- 用户只能查看自己的交易记录
CREATE POLICY "Users can view own transactions"
    ON public.credit_transactions FOR SELECT
    USING (auth.uid() = user_id);

-- 交易记录只能通过服务端插入（安全考虑）

-- ============================================================================
-- 9. 函数和触发器
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 自动更新 updated_at 时间戳
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为各表添加触发器
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ai_models_updated_at
    BEFORE UPDATE ON public.ai_models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contracts_updated_at
    BEFORE UPDATE ON public.contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_generations_updated_at
    BEFORE UPDATE ON public.generations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 新用户注册时自动创建用户记录
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 触发器：auth.users 插入时触发
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ----------------------------------------------------------------------------
-- 检查用户是否有有效合约
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_active_contract(
    p_user_id UUID,
    p_model_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.contracts
        WHERE user_id = p_user_id
          AND model_id = p_model_id
          AND status = 'active'
          AND end_date > NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 获取用户所有有效合约的模特
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_user_active_models(p_user_id UUID)
RETURNS TABLE (
    contract_id UUID,
    model_id UUID,
    model_name TEXT,
    model_avatar TEXT,
    model_category TEXT,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    days_remaining INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id AS contract_id,
        m.id AS model_id,
        m.name AS model_name,
        m.avatar_url AS model_avatar,
        m.category AS model_category,
        c.start_date,
        c.end_date,
        EXTRACT(DAY FROM (c.end_date - NOW()))::INTEGER AS days_remaining
    FROM public.contracts c
    JOIN public.ai_models m ON c.model_id = m.id
    WHERE c.user_id = p_user_id
      AND c.status = 'active'
      AND c.end_date > NOW()
    ORDER BY c.end_date ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 创建合约（带积分扣除）
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_contract(
    p_user_id UUID,
    p_model_id UUID,
    p_rental_period rental_period
)
RETURNS UUID AS $$
DECLARE
    v_price INTEGER;
    v_user_credits INTEGER;
    v_end_date TIMESTAMPTZ;
    v_contract_id UUID;
BEGIN
    -- 获取模特价格
    SELECT 
        CASE p_rental_period
            WHEN 'daily' THEN price_daily
            WHEN 'weekly' THEN price_weekly
            WHEN 'monthly' THEN price_monthly
            WHEN 'yearly' THEN price_yearly
        END INTO v_price
    FROM public.ai_models
    WHERE id = p_model_id AND is_active = true;
    
    IF v_price IS NULL THEN
        RAISE EXCEPTION 'Model not found or inactive';
    END IF;
    
    -- 检查用户积分
    SELECT credits INTO v_user_credits
    FROM public.users
    WHERE id = p_user_id;
    
    IF v_user_credits < v_price THEN
        RAISE EXCEPTION 'Insufficient credits. Required: %, Available: %', v_price, v_user_credits;
    END IF;
    
    -- 计算结束日期
    v_end_date := CASE p_rental_period
        WHEN 'daily' THEN NOW() + INTERVAL '1 day'
        WHEN 'weekly' THEN NOW() + INTERVAL '7 days'
        WHEN 'monthly' THEN NOW() + INTERVAL '30 days'
        WHEN 'yearly' THEN NOW() + INTERVAL '365 days'
    END;
    
    -- 扣除积分
    UPDATE public.users
    SET credits = credits - v_price
    WHERE id = p_user_id;
    
    -- 创建合约
    INSERT INTO public.contracts (user_id, model_id, rental_period, end_date, credits_paid)
    VALUES (p_user_id, p_model_id, p_rental_period, v_end_date, v_price)
    RETURNING id INTO v_contract_id;
    
    -- 记录积分交易
    INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (
        p_user_id,
        'consume',
        -v_price,
        v_user_credits - v_price,
        'contract',
        v_contract_id,
        'Model rental: ' || p_rental_period::TEXT
    );
    
    -- 更新模特租赁次数
    UPDATE public.ai_models
    SET total_rentals = total_rentals + 1
    WHERE id = p_model_id;
    
    RETURN v_contract_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 创建生成任务（验证合约有效性）
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_generation(
    p_user_id UUID,
    p_model_id UUID,
    p_product_id UUID,
    p_type generation_type,
    p_input_params JSONB
)
RETURNS UUID AS $$
DECLARE
    v_contract_id UUID;
    v_generation_id UUID;
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
    
    -- 验证产品所有权（如果提供了产品ID）
    IF p_product_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.products
            WHERE id = p_product_id AND user_id = p_user_id
        ) THEN
            RAISE EXCEPTION 'Product not found or access denied';
        END IF;
    END IF;
    
    -- 创建生成任务
    INSERT INTO public.generations (
        user_id, contract_id, product_id, model_id, type, input_params
    )
    VALUES (
        p_user_id, v_contract_id, p_product_id, p_model_id, p_type, p_input_params
    )
    RETURNING id INTO v_generation_id;
    
    -- 更新合约生成次数
    UPDATE public.contracts
    SET generations_count = generations_count + 1
    WHERE id = v_contract_id;
    
    -- 更新模特生成次数
    UPDATE public.ai_models
    SET total_generations = total_generations + 1
    WHERE id = p_model_id;
    
    RETURN v_generation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 定时任务：过期合约状态更新
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION expire_contracts()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE public.contracts
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'active' AND end_date <= NOW();
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 10. 视图
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 用户仪表盘统计视图
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.user_dashboard_stats AS
SELECT 
    u.id AS user_id,
    u.credits,
    (SELECT COUNT(*) FROM public.contracts c WHERE c.user_id = u.id AND c.status = 'active' AND c.end_date > NOW()) AS active_contracts,
    (SELECT COUNT(*) FROM public.products p WHERE p.user_id = u.id) AS total_products,
    (SELECT COUNT(*) FROM public.generations g WHERE g.user_id = u.id) AS total_generations,
    (SELECT COUNT(*) FROM public.generations g WHERE g.user_id = u.id AND g.type = 'video') AS video_generations,
    (SELECT COUNT(*) FROM public.generations g WHERE g.user_id = u.id AND g.type = 'image') AS image_generations
FROM public.users u;

-- ============================================================================
-- 11. 初始数据（示例模特）
-- ============================================================================

-- 插入示例模特数据
INSERT INTO public.ai_models (name, description, avatar_url, category, style_tags, gender, age_range, price_daily, price_weekly, price_monthly, price_yearly, rating, is_featured, is_trending)
VALUES 
    ('Luna AI', '时尚穿搭达人，擅长展示各类服装和配饰', NULL, '时尚穿搭', ARRAY['女性', '时尚', '年轻', '活力'], 'female', '20-25', 100, 500, 1500, 12000, 4.9, true, true),
    ('Alex Virtual', '健身运动博主，专业展示运动装备和健身内容', NULL, '健身运动', ARRAY['男性', '健身', '活力', '阳光'], 'male', '25-30', 120, 600, 1800, 14000, 4.8, true, true),
    ('Mia Digital', '美妆护肤专家，精通各类化妆品展示', NULL, '美妆护肤', ARRAY['女性', '美妆', '精致', '优雅'], 'female', '22-28', 150, 750, 2200, 18000, 4.9, true, false),
    ('Max AI', '科技数码评测员，擅长电子产品展示', NULL, '科技数码', ARRAY['男性', '科技', '专业', '理性'], 'male', '28-35', 100, 500, 1500, 12000, 4.7, false, false),
    ('Sophia Virtual', '生活方式博主，展示日常生活和家居用品', NULL, '生活方式', ARRAY['女性', '生活', '温暖', '亲和'], 'female', '25-32', 130, 650, 1900, 15000, 4.9, true, true),
    ('Leo Digital', '美食探店达人，擅长食品和餐饮展示', NULL, '美食探店', ARRAY['男性', '美食', '亲和', '幽默'], 'male', '26-32', 110, 550, 1600, 13000, 4.6, false, false);

-- ============================================================================
-- 完成！
-- ============================================================================



