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
-- 本机不直连生产执行)。执行前可自查残留:
--   SELECT count(*) FROM link_video_jobs;      -- 历史作业数(删前留档可选)
--   SELECT count(*) FROM product_link_cache;   -- 旧解析缓存(已被 reference_cache 取代)
-- ============================================================================

-- 顺序:先 jobs(其 product_link_id FK 指向 cache)后 cache
DROP TABLE IF EXISTS public.link_video_jobs;
DROP TABLE IF EXISTS public.product_link_cache;

-- 定价配置键随模块下线
DELETE FROM public.system_settings WHERE key = 'link_video_pricing';

NOTIFY pgrst, 'reload schema';
