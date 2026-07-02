-- ============================================================================
-- 拆除 link-video 模块数据层(S2.4,BLUEPRINT_PIPELINE_PLAN §七)
--
-- 前提:S2.1-S2.3 新管线(链接腿 parse-reference + 蓝图 + 幻灯片/AI 生成腿)
-- 已可用,旧入口(/link-video 页面、API、sidebar)已在代码侧同批删除。
--
-- 拆除纪律(§七):
-- - 历史迁移文件(007_link_video_module.sql)永不删除,用本 DROP 迁移表达删表
-- - generations 历史行 source='link_video' 保留(assets/任务中心读取端保留 label,
--   valid_source CHECK 中 'link_video' 枚举不移除)
-- - credit_transactions 的 reference_type='link_video_job' 为无 FK 软引用,
--   历史交易行保留;删表后 reference_id 悬空无害(审计报表已知悉)
--
-- 执行方式:生产库经 Supabase dashboard SQL editor 人工执行(生产红线:
-- 本机不直连生产执行)。
--
-- ⚠ 执行顺序(必须):先部署/重启新代码(确认 /api/link-video/* 已全部 404)
-- 之后再执行本 SQL。清扫基于执行时刻的快照——若旧路由仍在线,快照之后发生的
-- 新扣费无法被清扫覆盖,随删表丢台账、永久无法退款(正是本清扫要堵的洞)。
-- ============================================================================

-- ============================================================================
-- 1) 在途扣款清扫(对抗审查确认项:旧退款唯一路径在已删除的轮询路由里,
--    删表前不清扫,已扣未退且未交付的积分将永久丢失且无台账可事后定位)
--    口径:credits_used > 已退 且 final_video_url 为空 = 扣了钱没交付成片。
--    轮询路由已删,这些作业的成片永远无法交付,直接退款不会造成双重给付。
-- ============================================================================
DO $$
DECLARE
    r RECORD;
    v_balance INTEGER;
    v_refunded_count INTEGER := 0;
    v_refunded_total INTEGER := 0;
BEGIN
    FOR r IN
        SELECT id, user_id, credits_used - COALESCE(credits_refunded, 0) AS refund_amount
        FROM public.link_video_jobs
        WHERE credits_used > COALESCE(credits_refunded, 0)
          AND final_video_url IS NULL
    LOOP
        UPDATE public.profiles
        SET credits = credits + r.refund_amount
        WHERE id = r.user_id
        RETURNING credits INTO v_balance;

        IF FOUND THEN
            INSERT INTO public.credit_transactions (
                user_id, type, amount, balance_before, balance_after,
                reference_type, reference_id, description
            ) VALUES (
                r.user_id, 'refund', r.refund_amount,
                v_balance - r.refund_amount, v_balance,
                'link_video_job', r.id,
                '链接秒变模块下线清扫:未交付作业退款'
            );
            UPDATE public.link_video_jobs
            SET credits_refunded = COALESCE(credits_refunded, 0) + r.refund_amount
            WHERE id = r.id;
            v_refunded_count := v_refunded_count + 1;
            v_refunded_total := v_refunded_total + r.refund_amount;
        END IF;
    END LOOP;
    RAISE NOTICE '在途扣款清扫完成:% 个作业,共退 % 积分', v_refunded_count, v_refunded_total;
END $$;

-- ============================================================================
-- 2) 台账归档(必做,非可选):清扫后整表留档,审计可溯。
--    归档表无 RLS 策略(仅 service role 可读),确认无用后可另行 DROP。
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.link_video_jobs_archive AS
    SELECT * FROM public.link_video_jobs;
CREATE TABLE IF NOT EXISTS public.product_link_cache_archive AS
    SELECT * FROM public.product_link_cache;
ALTER TABLE public.link_video_jobs_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_link_cache_archive ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3) 删表(顺序:先 jobs——其 product_link_id FK 指向 cache——后 cache)
-- ============================================================================
DROP TABLE IF EXISTS public.link_video_jobs;
DROP TABLE IF EXISTS public.product_link_cache;

-- 定价配置键随模块下线
DELETE FROM public.system_settings WHERE key = 'link_video_pricing';

NOTIFY pgrst, 'reload schema';
