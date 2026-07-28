-- ============================================================================
-- Canvas P1 fixture · 10 · 生产实测形状(selective history)
--
-- 重要:本文件按 2026-07-15 只读目录证据(生产 PostgreSQL 17.6)重建四张目标表,
-- 而**不是**回放 supabase/migrations 下的迁移文件。二者已证实漂移:
--
--  - 006_generations_table.sql 声明 type/source/status/created_at 为 NOT NULL,
--    并带 valid_type / valid_status CHECK 及 6 个索引 —— 生产**一个都没有**;
--  - 006 的 user_id 外键写着 ON DELETE CASCADE —— 生产该外键**无删除动作**;
--  - 006 建了 5 条策略 —— 生产只剩 1 条(无 TO 子句 => PUBLIC 的 FOR ALL USING(true));
--  - 生产既无 model_id 也无 contract_id => 008 未生效,且该表并非由 001/002 建成。
--
-- 因此生产形状**无法**由任何迁移文件回放得到,只能以目录证据为准。
-- 20260702_studio_foundation.sql 第 4 行亦明文记载「生产库与迁移文件已漂移」。
--
-- 策略表达式一律**不从生产复制**:全部由本仓库自有迁移文件(006 / 002 /
-- 20260714_canvases.sql)重新推导;断言只比对策略的元数据(条数/命令/角色/
-- permissive/是否有 using/check),不比对表达式文本。
-- ============================================================================

\set ON_ERROR_STOP on

-- 守卫先行:本文件只建不删,但仍不该在非 fixture 库里落下一堆表。
\ir guard.sql

-- ---------------------------------------------------------------------------
-- profiles(12 列)
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    name text,
    avatar_url text,
    role public.user_role NOT NULL DEFAULT 'user'::public.user_role,
    credits integer NOT NULL DEFAULT 100,
    status text DEFAULT 'active'::text,
    banned_at timestamptz,
    banned_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    phone varchar(20),
    CONSTRAINT profiles_pkey PRIMARY KEY (id),
    CONSTRAINT profiles_email_key UNIQUE (email),
    CONSTRAINT profiles_status_check CHECK (status IN ('active', 'suspended', 'banned')),
    CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_profiles_email ON public.profiles USING btree (email);
CREATE INDEX idx_profiles_role ON public.profiles USING btree (role);

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- generations(33 列)—— 注意 duration 为 integer(实测),且无 model_id/final_prompt
-- ---------------------------------------------------------------------------
CREATE TABLE public.generations (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    task_id text,
    type text DEFAULT 'video'::text,
    source text DEFAULT 'quick_gen'::text,
    prompt text,
    model text,
    duration integer,
    aspect_ratio text,
    quality text,
    source_image_url text,
    status text DEFAULT 'pending'::text,
    result_url text,
    video_url text,
    image_url text,
    thumbnail_url text,
    error_message text,
    credit_cost integer DEFAULT 0,
    use_pro boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    group_name varchar(255) DEFAULT '默认'::character varying,
    generation_type text DEFAULT 'video'::text,
    output_url text,
    progress integer DEFAULT 0,
    credits_used integer DEFAULT 0,
    credits_refunded integer DEFAULT 0,
    started_at timestamptz,
    resolution text,
    library_status text,
    batch_id uuid,
    spec jsonb,
    CONSTRAINT generations_pkey PRIMARY KEY (id),
    -- 实测:无 ON DELETE 动作(与 006 文件声明的 CASCADE 不同)
    CONSTRAINT generations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
    CONSTRAINT valid_library_status CHECK (
        library_status IS NULL OR library_status IN ('draft', 'ready', 'published')
    )
);

-- 实测:valid_source 为 NOT VALID(只约束新行,容忍历史违规行)
ALTER TABLE public.generations
    ADD CONSTRAINT valid_source CHECK (
        source IN (
            'quick_gen', 'batch_image',
            'image_factory', 'pro_studio',
            'link_video', 'viral_clone', 'ecom_factory',
            'studio', 'slideshow', 'photo_post'
        )
        OR source LIKE 'batch_video%'
    ) NOT VALID;

CREATE INDEX idx_generations_batch_id
    ON public.generations USING btree (batch_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX idx_generations_group_name
    ON public.generations USING btree (user_id, group_name);
CREATE INDEX idx_generations_library_status
    ON public.generations USING btree (user_id, library_status) WHERE (library_status IS NOT NULL);
CREATE INDEX idx_generations_task_id
    ON public.generations USING btree (task_id);

-- ---------------------------------------------------------------------------
-- credit_transactions(12 列)
-- 实测 type CHECK 不含 'consume':purchase|usage|refund|bonus|admin_adjustment
-- ---------------------------------------------------------------------------
CREATE TABLE public.credit_transactions (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    amount integer NOT NULL,
    type text NOT NULL,
    description text,
    reference_id uuid,
    reference_type text,
    balance_before integer NOT NULL,
    balance_after integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT credit_transactions_pkey PRIMARY KEY (id),
    CONSTRAINT credit_transactions_type_check CHECK (
        type IN ('purchase', 'usage', 'refund', 'bonus', 'admin_adjustment')
    ),
    CONSTRAINT credit_transactions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT credit_transactions_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);

CREATE INDEX idx_credit_transactions_type ON public.credit_transactions USING btree (type);
CREATE INDEX idx_credit_transactions_user_id ON public.credit_transactions USING btree (user_id);

-- ---------------------------------------------------------------------------
-- canvases(14 列)—— 已验收的 P0 表
-- ---------------------------------------------------------------------------
CREATE TABLE public.canvases (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    title text NOT NULL DEFAULT '未命名画布'::text,
    schema_version integer NOT NULL DEFAULT 1,
    doc jsonb NOT NULL DEFAULT '{"edges": [], "nodes": [], "groups": []}'::jsonb,
    deps jsonb NOT NULL DEFAULT '{"assets": [], "models": [], "voices": [], "recipes": [], "characters": []}'::jsonb,
    rev bigint NOT NULL DEFAULT 0,
    writer_tag text,
    writer_heartbeat_at timestamptz,
    doc_bytes integer,
    share_slug text,
    status text NOT NULL DEFAULT 'active'::text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT canvases_pkey PRIMARY KEY (id),
    CONSTRAINT canvases_share_slug_key UNIQUE (share_slug),
    CONSTRAINT canvases_status_check CHECK (status IN ('active', 'archived')),
    CONSTRAINT canvases_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_canvases_user_updated
    ON public.canvases USING btree (user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- 入向外键桩表:复现 profiles 的 11 条 incoming FK。
-- 这些桩证明 FOR NO KEY UPDATE 与外键 KEY SHARE 的兼容性,
-- 且证明 profiles.credits 不是任何外键的被引用列。
-- 只建立与外键相关的最小列,不代表这些表的真实生产形状。
-- ---------------------------------------------------------------------------
CREATE TABLE public.admin_audit_logs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    admin_id uuid,
    target_user_id uuid,
    CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id),
    CONSTRAINT admin_audit_logs_admin_id_fkey
        FOREIGN KEY (admin_id) REFERENCES public.profiles(id) ON DELETE RESTRICT,
    CONSTRAINT admin_audit_logs_target_user_id_fkey
        FOREIGN KEY (target_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE public.blueprints (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    CONSTRAINT blueprints_pkey PRIMARY KEY (id),
    CONSTRAINT blueprints_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.contracts (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    CONSTRAINT contracts_pkey PRIMARY KEY (id),
    CONSTRAINT contracts_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.quick_gen_history (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    CONSTRAINT quick_gen_history_pkey PRIMARY KEY (id),
    CONSTRAINT quick_gen_history_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.recipes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    CONSTRAINT recipes_pkey PRIMARY KEY (id),
    CONSTRAINT recipes_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.system_settings (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    updated_by uuid,
    CONSTRAINT system_settings_pkey PRIMARY KEY (id),
    CONSTRAINT system_settings_updated_by_fkey
        FOREIGN KEY (updated_by) REFERENCES public.profiles(id)
);

-- ---------------------------------------------------------------------------
-- RLS —— 实测:四张目标表均 enabled,均 forced = false
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvases ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 策略(表达式由本仓库自有迁移推导,非生产复制)
-- ---------------------------------------------------------------------------

-- profiles:3 条(SELECT using / INSERT check / UPDATE 仅 using、无 with_check)
-- 注:UPDATE 无 WITH CHECK => PG 用 USING 兼作检查,故用户可改自己行的任意
-- 非身份列(含 credits/role)。这是实测的越权面,由 Batch 3 收敛。
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- generations:实测只剩 1 条,名为 "allow_all",无 TO 子句 => PUBLIC;FOR ALL;
-- USING(true);无 WITH CHECK。这就是「匿名可见 30839 行」的发布阻断项。
--
-- 名字很重要,不是细节:实测名是 "allow_all",**不是** 006 里的
-- "Service can manage all generations" —— 再次印证生产此表并非由迁移文件建成。
-- 直接后果:20260715_generations_service_role_policy.sql 的
--   DROP POLICY IF EXISTS "Service can manage all generations"
-- 在生产是**空操作**(名字对不上),随后它新建一条 TO service_role 的策略,
-- 而 "allow_all" 原封不动留着。permissive 策略之间是 OR 关系 =>
-- 匿名**依然**看得见全部行。该发布阻断项的修复方案本身是无效的。
-- 本 fixture 如实复现 "allow_all",正是为了让这一点可被执行证明。
CREATE POLICY "allow_all" ON public.generations
    FOR ALL USING (true);

-- credit_transactions:3 条(owner SELECT / admin SELECT / admin INSERT)
CREATE POLICY "Users can view own transactions" ON public.credit_transactions
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all transactions" ON public.credit_transactions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );
CREATE POLICY "Admins can create transactions" ON public.credit_transactions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );

-- canvases:4 条(SELECT/INSERT/UPDATE[using+check]/DELETE)
CREATE POLICY "canvases_select_own" ON public.canvases
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "canvases_insert_own" ON public.canvases
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "canvases_update_own" ON public.canvases
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY "canvases_delete_own" ON public.canvases
    FOR DELETE USING (auth.uid() = user_id);
