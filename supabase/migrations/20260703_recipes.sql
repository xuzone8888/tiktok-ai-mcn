-- ============================================================================
-- S3.5 配方库(BLUEPRINT §三:配方 = Blueprint 去实例化)
-- 执行方式:用户登录 Supabase dashboard SQL editor 粘贴执行(生产红线:
-- 本机不直连生产库;exec_sql RPC 不存在)。幂等,可重复执行。
--
-- 设计要点(S3 侦查裁决):
-- - 新表而非复用 content_templates(那是公开系统预设表,无 user_id 无属主,
--   不能装用户私有配方)也不在 blueprints 上加标志(status 语义会打架)
-- - scenes/hooks 存「槽位化」骨架:台词中的商品具体值已脱敏为
--   {商品名}/{卖点1..N}/{价格} 槽位(脱敏必经 diff 预览+用户确认,红队裁决)
-- - origin 携带门B溯源(license='structure_only' 的配方详情页明示
--   「复刻结构,非复刻素材」)
-- - source_blueprint_id 无外键:蓝图可删,配方独立存续
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    hooks JSONB NOT NULL DEFAULT '[]'::jsonb,   -- 槽位化 hook 候选 [{id,type,text,selected}]
    scenes JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 槽位化分镜 [{idx,line,visual,slot,duration_ms,beat}]
    globals JSONB NOT NULL DEFAULT '{}'::jsonb, -- 渲染预设 {aspect,duration_per_image_ms,...}
    render_mode TEXT CHECK (render_mode IS NULL OR render_mode IN ('slideshow', 'assembly', 'ai_gen')),
    origin JSONB,                               -- 门B溯源 {viral_ref,why_viral,license}
    source_blueprint_id UUID,                   -- 来源蓝图(无 FK,蓝图删除不连坐)
    use_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipes_user_created
    ON public.recipes(user_id, created_at DESC);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

-- 四条 own 策略(照抄 blueprints 模板,幂等写法)
DROP POLICY IF EXISTS "recipes_select_own" ON public.recipes;
CREATE POLICY "recipes_select_own" ON public.recipes
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "recipes_insert_own" ON public.recipes;
CREATE POLICY "recipes_insert_own" ON public.recipes
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "recipes_update_own" ON public.recipes;
CREATE POLICY "recipes_update_own" ON public.recipes
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "recipes_delete_own" ON public.recipes;
CREATE POLICY "recipes_delete_own" ON public.recipes
    FOR DELETE USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
