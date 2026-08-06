-- ============================================================================
-- Canvas P1 fixture · 20 · 合成历史行(synthetic legacy rows)
--
-- 全部为**人工编造**的确定性数据:固定 UUID、固定时间戳、固定金额。
-- 绝不使用任何生产行负载(证据采集本身就没有读过应用行)。
--
-- 这些行的作用:
-- 1. 证明生产实测形状能装下真实历史形态的行(gate 3);
-- 2. 成为 Stage 2 的「legacy null-action 行」——加了 action_id 之后,
--    这些行的 action_id 全为 NULL,任何新增不变量都必须条件化放过它们;
-- 3. 账本行提供连续的 balance_before/balance_after 序列,供 Stage 2 的
--    共享原子扣减边界做连续性回归。
--
-- 幂等:全部 ON CONFLICT (id) DO NOTHING;可重复执行。
-- ============================================================================

\set ON_ERROR_STOP on

-- 守卫必须先于任何写动作。本文件会 DROP CONSTRAINT 并写入行,且这些行按生产
-- 实测形状构造 => 列是兼容的,误打到生产会真的插进去,并把 valid_source 换成
-- fixture 的定义。\ir 相对本脚本目录解析,不依赖调用方 CWD。
\ir guard.sql

-- ---------------------------------------------------------------------------
-- auth.users / profiles
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, created_at) VALUES
    ('11111111-1111-4111-8111-111111111111', 'fixture-user-1@example.invalid', '2026-01-02 03:04:05+00'),
    ('22222222-2222-4222-8222-222222222222', 'fixture-admin@example.invalid',  '2026-01-02 03:04:06+00'),
    ('33333333-3333-4333-8333-333333333333', 'fixture-user-3@example.invalid', '2026-01-02 03:04:07+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, name, role, credits, status, created_at, updated_at, phone) VALUES
    ('11111111-1111-4111-8111-111111111111', 'fixture-user-1@example.invalid', 'Fixture User One', 'user',        550, 'active', '2026-01-02 03:04:05+00', '2026-01-02 03:04:05+00', '13000000001'),
    ('22222222-2222-4222-8222-222222222222', 'fixture-admin@example.invalid',  'Fixture Admin',    'admin',       100, 'active', '2026-01-02 03:04:06+00', '2026-01-02 03:04:06+00', NULL),
    ('33333333-3333-4333-8333-333333333333', 'fixture-user-3@example.invalid', 'Fixture User Three','user',         0, 'active', '2026-01-02 03:04:07+00', '2026-01-02 03:04:07+00', NULL)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- generations —— 历史行
--
-- 复现生产成因:历史行先于 valid_source 约束存在,该约束以 NOT VALID 加上,
-- 因而容忍既有违规行。此处临时摘下约束插入一行「不在枚举内」的历史行,
-- 再以 NOT VALID 重新加上,精确复刻这一语义。
-- ---------------------------------------------------------------------------
ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS valid_source;

INSERT INTO public.generations (
    id, user_id, task_id, type, source, prompt, model, duration, aspect_ratio, quality,
    status, result_url, video_url, credit_cost, use_pro, metadata, created_at, completed_at,
    group_name, generation_type, output_url, progress, credits_used, credits_refunded,
    started_at, resolution, library_status, batch_id, spec
) VALUES
    -- 1) 典型 quick_gen 视频成品:duration 为 integer(实测类型)
    ('a1111111-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
     'legacy-task-0001', 'video', 'quick_gen', '一只猫在草地上奔跑', 'sora2', 5, '9:16', 'standard',
     'completed', 'https://cdn.example.invalid/legacy/1.mp4', 'https://cdn.example.invalid/legacy/1.mp4',
     20, false, '{"legacy": true}'::jsonb, '2026-02-01 10:00:00+00', '2026-02-01 10:03:00+00',
     '默认', 'video', 'https://cdn.example.invalid/legacy/1.mp4', 100, 20, 0,
     '2026-02-01 10:00:05+00', '1080p', NULL, NULL, NULL),

    -- 2) batch_video% 通配分支(生产按模型半动态拼接 source)
    ('a1111111-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
     'legacy-task-0002', 'video', 'batch_video_prompt_grok', '产品展示镜头', 'grok', 10, '16:9', 'standard',
     'completed', NULL, 'https://cdn.example.invalid/legacy/2.mp4', 30, false, '{}'::jsonb,
     '2026-02-02 11:00:00+00', '2026-02-02 11:05:00+00',
     '批量组', 'video', 'https://cdn.example.invalid/legacy/2.mp4', 100, 30, 0,
     '2026-02-02 11:00:10+00', '1080p', NULL, NULL, NULL),

    -- 3) studio 图片 + 内容库字段(library_status/batch_id/spec)
    ('a1111111-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
     NULL, 'image', 'studio', '商品主图', 'gpt-image-2', NULL, '1:1', NULL,
     'completed', NULL, NULL, 10, false, '{}'::jsonb, '2026-02-03 12:00:00+00', '2026-02-03 12:01:00+00',
     '默认', 'image', 'https://cdn.example.invalid/legacy/3.jpg', 100, 10, 0,
     '2026-02-03 12:00:02+00', NULL, 'ready', 'b0000000-0000-4000-8000-00000000000b',
     '{"scene": 1}'::jsonb),

    -- 4) 失败并已退款(credits_refunded <= credits_used)
    ('a1111111-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333',
     'legacy-task-0004', 'video', 'quick_gen', '失败用例', 'seedance', 5, '9:16', 'hd',
     'failed', NULL, NULL, 25, false, '{}'::jsonb, '2026-02-04 13:00:00+00', '2026-02-04 13:02:00+00',
     '默认', 'video', NULL, 0, 25, 25,
     '2026-02-04 13:00:03+00', NULL, NULL, NULL, NULL),

    -- 5) 仍在处理中(pending):证明非终态历史行可存
    ('a1111111-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111',
     'legacy-task-0005', 'video', 'photo_post', '进行中', 'veo', 8, '9:16', 'standard',
     'pending', NULL, NULL, 40, true, '{}'::jsonb, '2026-02-05 14:00:00+00', NULL,
     '默认', 'video', NULL, 0, 0, 0,
     NULL, NULL, NULL, NULL, NULL),

    -- 6) NOT VALID 容忍面:source 不在枚举内、也不匹配 batch_video%。
    --    这类行在生产真实存在(约束是后加且 NOT VALID),Stage 2 不得让它变得不可读。
    ('a1111111-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111',
     'legacy-task-0006', 'video', 'legacy_unlisted_source', '远古来源', 'sora2', 12, '16:9', 'standard',
     'completed', NULL, 'https://cdn.example.invalid/legacy/6.mp4', 15, false, '{}'::jsonb,
     '2026-01-10 09:00:00+00', '2026-01-10 09:04:00+00',
     '默认', 'video', 'https://cdn.example.invalid/legacy/6.mp4', 100, 15, 0,
     '2026-01-10 09:00:05+00', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

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

-- ---------------------------------------------------------------------------
-- credit_transactions —— 连续余额序列
-- 实测 type CHECK 只允许 purchase|usage|refund|bonus|admin_adjustment。
-- 注意:**没有** 'consume'。冻结契约称「历史与调用方同时使用 usage 与 consume」,
-- 与该实测 CHECK 相矛盾,已在自审findings中上报,此处以实测为准。
-- ---------------------------------------------------------------------------
INSERT INTO public.credit_transactions (
    id, user_id, amount, type, description, reference_id, reference_type,
    balance_before, balance_after, created_at, created_by, metadata
) VALUES
    -- user1:注册赠送 -> 消耗 -> 退款 -> 充值 -> 消耗,终值 550(与 profiles.credits 一致)
    ('c1111111-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
      100, 'bonus',    '注册赠送',   NULL, NULL,   0, 100, '2026-01-02 03:04:05+00', NULL, '{}'::jsonb),
    ('c1111111-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
     -20, 'usage',     '生成消耗',   'a1111111-0000-4000-8000-000000000001', 'generation', 100,  80, '2026-02-01 10:00:00+00', NULL, '{}'::jsonb),
    ('c1111111-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
      20, 'refund',    '失败退款',   'a1111111-0000-4000-8000-000000000001', 'generation',  80, 100, '2026-02-01 10:04:00+00', NULL, '{}'::jsonb),
    ('c1111111-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
     500, 'purchase',  '充值',       NULL, NULL, 100, 600, '2026-02-02 09:00:00+00', NULL, '{}'::jsonb),
    ('c1111111-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111',
     -50, 'usage',     '生成消耗',   'a1111111-0000-4000-8000-000000000002', 'generation', 600, 550, '2026-02-02 11:00:00+00', NULL, '{}'::jsonb),

    -- admin:注册赠送
    ('c2222222-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
     100, 'bonus',     '注册赠送',   NULL, NULL,   0, 100, '2026-01-02 03:04:06+00', NULL, '{}'::jsonb),

    -- user3:注册赠送 -> 管理员调整(created_by 指向 admin,证明 created_by 外键)
    ('c3333333-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
     100, 'bonus',            '注册赠送', NULL, NULL,   0, 100, '2026-01-02 03:04:07+00', NULL, '{}'::jsonb),
    ('c3333333-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
    -100, 'admin_adjustment', '管理员扣减', NULL, NULL, 100,   0, '2026-02-04 13:05:00+00',
     '22222222-2222-4222-8222-222222222222', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- canvases —— 已验收 P0 形状的历史行
-- ---------------------------------------------------------------------------
INSERT INTO public.canvases (
    id, user_id, title, schema_version, doc, deps, rev, writer_tag, writer_heartbeat_at,
    doc_bytes, share_slug, status, created_at, updated_at
) VALUES
    ('d1111111-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
     '带货画布', 1,
     '{"edges": [], "nodes": [], "groups": []}'::jsonb,
     '{"assets": [], "models": [], "voices": [], "recipes": [], "characters": []}'::jsonb,
     0, NULL, NULL, 64, NULL, 'active', '2026-03-01 08:00:00+00', '2026-03-01 08:00:00+00'),
    ('d1111111-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
     '已归档画布', 1,
     '{"edges": [], "nodes": [], "groups": []}'::jsonb,
     '{"assets": [], "models": [], "voices": [], "recipes": [], "characters": []}'::jsonb,
     3, NULL, NULL, 64, 'fixture-share-slug-1', 'archived', '2026-03-02 08:00:00+00', '2026-03-02 09:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- 入向外键桩行:证明 profiles 被 11 条外键引用时,
-- FOR NO KEY UPDATE 仍与外键插入取的 KEY SHARE 锁兼容。
INSERT INTO public.blueprints (id, user_id) VALUES
    ('e1111111-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.admin_audit_logs (id, admin_id, target_user_id) VALUES
    ('e2222222-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
     '33333333-3333-4333-8333-333333333333')
ON CONFLICT (id) DO NOTHING;
