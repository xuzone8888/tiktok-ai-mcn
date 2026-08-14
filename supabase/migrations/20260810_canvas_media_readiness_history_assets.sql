-- 画布保存闸:承认「历史面板给得出的素材」为 ready
--
-- ## 为什么要这条迁移
--
-- 2026-08-09 走查实测:从历史面板加一张**蓝图**来源的图,`PATCH /api/canvas/{id}` 立刻
-- 422 `CANVAS_DOC_INVALID · 画布包含尚未完成服务端确认的上传对象`,随后自动保存进入
-- 「保存已暂停」,**且暂停是粘性的** —— 删掉肇事节点、等待、Ctrl+Z 都不解除,
-- UI 里没有恢复入口,只能删节点 + 刷新页面。画布已对所有登录用户开放,任何人从历史面板
-- 挑一张这类素材都会踩到。
--
-- ## 缺口有两块,不是一块
--
-- `assert_canvas_media_keys_ready_v1` 原本只接受三类 object key:
--   ① `canvas_upload_reservations` 里 status='ready' 的;
--   ② 当前文档里已经存在的(存量兼容);
--   ③ `generations` 里 status='completed' 的 **`output_oss_key`**。
--
-- 而 `/api/canvas/history` 供三个来源,逐一核对后:
--
-- **(a) blueprints** —— 完全不在白名单。这是最初发现的那条。
--
-- **(b) generations** —— 抬头曾断言「已在白名单」,**该断言是错的**(2026-08-10 对抗审查查出,
-- 并经生产数据坐实)。面板从 `output_url / result_url / video_url / image_url` 换算 objectKey
-- (`history-assets.ts` 的 `normalizeGeneration`),而分支③只比 `output_oss_key`;
-- **`output_oss_key` 只有画布自己的行会写**(20260716 的三条约束都以 `action_id IS NULL OR …` 开头,
-- 非画布行不写)。于是幻灯片 `videos/slideshow/<uid>/…`、拼装 `videos/assembly/<uid>/…`、
-- 以及统一视频网关落的 `quick-gen/<uid>/…`、`videos/<uid>/…` 这批**所有者路径布局的非画布产物**,
-- 面板列得出、也允许加进画布,却一条分支都命中不了 ⇒ 与蓝图那条一模一样地 422。
-- 生产实测:`status='completed' AND output_oss_key IS NULL` 且 URL 落在
-- `videos/slideshow|assembly/` 下的行有 **5** 条。
-- ⇒ **只放行蓝图等于只修一半**,复验若只走蓝图会得到假绿。
--
-- **(c) products** —— 该来源在本库**确实不存在**:生产实测 `to_regclass('public.products')` 为 NULL
-- (历史路由本就有 `relation_not_found` 容错)。⇒ 无需放行,也**不能**在 SQL 里引用它,
-- 否则 plpgsql 运行时会因缺表报错。
--
-- ## 为什么放行是安全的
--
-- 归属**已经由路径结构强制**:`canvas_owned_media_key_v1` 要求 key 形如
-- `<前缀>/<user_id>/<文件>` 且 `<user_id>` 必须等于调用者本人,该分支在本函数里排在最前、
-- 不满足直接判 `not_owned`。⇒ **任何通过归属校验的 key 在结构上只可能指向用户自己的命名空间**;
-- readiness 这道闸不是跨用户的安全边界,而是「这个对象登记过没有」的生命周期约束。
-- 实测被拒的理由也确实是 `not_ready` 而非 `not_owned`。
--
-- ⚠️ **但要认下一次实质的信任模型变更**(对抗审查提出,此处明确接受):
-- 蓝图 JSON 是用户可写的(`PATCH /api/studio/blueprints/{id}` 对 `scenes[].slot.asset_ref`
-- 只做 `slice(0,2000)`,不校验形状),所以用户可以往自己的蓝图里写一个从未上传过的 key
-- 来「自证 ready」。边界仍钉死在本人命名空间、OSS 写入仍需签出 policy,**不构成提权**;
-- 代价是 `canvas_upload_reservations` 那句「only server-verified ready rows are accepted」
-- 对这条路不再成立。收窄办法(给该路由加 `isOwnedObjectKey` 校验)留作后续,不在本迁移内。
--
-- ⚠️ **本迁移同时放宽了「生成输入」闸,这是有意的**:
-- `assert_canvas_media_keys_ready_v1` 有两个调用方 —— `assertCanvasDocumentMediaReady`(保存,
-- 传 canvasId/baseRev)与 `assertCanvasInputKeysReady`(生成输入,canvasId=null/baseRev=null)。
-- 原分支②因 `v_existing_keys` 恒空而对生成输入不可达,是刻意设计;新分支④没有这个限制,
-- 两条通道一视同仁。**这正是需要的** —— #23「从历史记录选一张图」建出来的就是上游节点,
-- 若它能进文档却不能当生成输入,用户会在点生成时撞第二种错。
-- 📌 因此 `src/lib/canvas/upload-registry.ts` 里「Generation has no legacy exception」那段注释
-- 已不准确,需随本迁移一并订正。
--
-- ## 匹配规则
--
-- 面板换算 objectKey 用的是 `new URL(v).pathname.slice(1)`,且**拒绝带 search/hash 的 URL**
-- (`history-assets.ts` 的 `extractOwnedHistoryObjectKey`)。⇒ 面板给得出的 key,其原始串必然
-- 形如 `https://<host>/<key>`。所以判据两端都锚死:
--   `media_url = key`  或  `right(media_url, char_length(key)+1) = '/' || key`
-- 左锚(前导 '/')挡住 `xproducts/…` 误配 `products/…`;
-- 右锚挡住「前缀 key 蹭过」—— 例如存的是 `images/<uid>/photo.png.bak` 时,
-- 不该把从未登记的 `images/<uid>/photo.png` 也判成 ready。
-- 用 `right()` 而非 LIKE:object key 允许含 `_`,那是 LIKE 的单字符通配符。
--
-- ## 为什么内联而不抽 helper 函数
--
-- 初版抽了个 `canvas_blueprint_media_key_ref_v1`,对抗审查指出三个连带成本:
-- ①plpgsql 创建期不解析函数引用,主函数若被单独执行会留下运行时 42883;
-- ②回滚必须「先还原主函数、再 DROP helper」,顺序反了就是线上直接报错;
-- ③它是 `assert_` 的硬依赖却没进 `canvas_production_healthcheck_v1` 的契约表
-- (同构的 `canvas_owned_media_key_v1` 是登记在案的)。
-- 内联把三条一次性消掉:**不新增任何 schema 对象**,回滚 = 把 20260801:684-846 的原版
-- 原样 `CREATE OR REPLACE` 回去,一句话、无顺序陷阱、健康检查契约表保持完整准确。
--
-- ## 执行方式与并发
--
-- **整份文件一次性粘贴执行**,靠 SQL Editor 的隐式事务拿到 all-or-nothing;
-- 不要加显式 BEGIN/COMMIT(仓库的 `TRANSACTION_BOUNDARY_RE` 守卫会拒收带事务边界的迁移)。
-- `CREATE OR REPLACE FUNCTION` 只在函数对象上取 AccessExclusiveLock,函数**执行**不在
-- pg_proc 上取对象锁 ⇒ 并发 RPC 既不阻塞也不报错,无停机窗口。
--
-- ## 性能
--
-- 新分支排在①②③之后,只对「既没登记、又不在当前文档里、也不是自己产物 oss key」的 key 触发。
-- 保存链路上一张素材至多命中一次(第一次入档后由分支②短路);生成输入链路因
-- `v_existing_keys` 恒空,每次提交都会走一次,但频率是「用户点一次生成」而非 2 秒一次的自动保存。
-- 两张表都按 `user_id` 过滤,只扫调用者自己的行。

CREATE OR REPLACE FUNCTION public.assert_canvas_media_keys_ready_v1(
    p_user_id uuid,
    p_canvas_id uuid,
    p_base_rev bigint,
    p_object_keys text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now            timestamptz := clock_timestamp();
    v_doc            jsonb;
    v_existing_keys  text[] := ARRAY[]::text[];
    v_rejected       jsonb;
BEGIN
    IF COALESCE(auth.role()::text, '') <> 'service_role' THEN
        RAISE EXCEPTION 'canvas_upload_service_role_required'
            USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NULL OR COALESCE(array_length(p_object_keys, 1), 0) > 2000 THEN
        RAISE EXCEPTION 'canvas_upload_readiness_invalid_input';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM unnest(COALESCE(p_object_keys, ARRAY[]::text[]))
               AS item(object_key)
         WHERE item.object_key IS NULL
            OR item.object_key = ''
    ) THEN
        RAISE EXCEPTION 'canvas_upload_readiness_invalid_key';
    END IF;
    IF p_canvas_id IS NULL AND p_base_rev IS NOT NULL THEN
        RAISE EXCEPTION 'canvas_upload_readiness_invalid_canvas_identity';
    END IF;
    IF p_canvas_id IS NOT NULL THEN
        IF p_base_rev IS NULL OR p_base_rev < 0 THEN
            RAISE EXCEPTION 'canvas_upload_readiness_invalid_canvas_identity';
        END IF;
        SELECT c.doc
          INTO v_doc
          FROM public.canvases c
         WHERE c.id = p_canvas_id
           AND c.user_id = p_user_id
           AND c.rev = p_base_rev;
        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'ok', false,
                'reason', 'canvas_revision_mismatch',
                'rejected', '[]'::jsonb
            );
        END IF;
        SELECT COALESCE(array_agg(DISTINCT media_key), ARRAY[]::text[])
          INTO v_existing_keys
          FROM (
              SELECT node.value #>> '{data,media,ossKey}' AS media_key
                FROM jsonb_array_elements(
                    CASE
                        WHEN jsonb_typeof(v_doc->'nodes') = 'array'
                            THEN v_doc->'nodes'
                        ELSE '[]'::jsonb
                    END
                ) AS node(value)
          ) existing
         WHERE media_key IS NOT NULL
           AND media_key <> '';

        -- A ready upload can only become orphaned after a separate grace
        -- period and an authoritative no-reference scan. If a still-current
        -- canvas reaches this RPC during that window, rescue it before any
        -- purge claim is allowed to transition it to purging.
        UPDATE public.canvas_upload_reservations r
           SET status = 'ready',
               orphaned_at = NULL,
               purge_lease_token = NULL,
               purge_lease_expires_at = NULL,
               last_referenced_at = v_now,
               updated_at = v_now
         WHERE r.user_id = p_user_id
           AND r.status = 'orphaned'
           AND r.object_key = ANY(v_existing_keys);
    END IF;

    WITH candidate AS (
        SELECT DISTINCT item.object_key
          FROM unnest(COALESCE(p_object_keys, ARRAY[]::text[]))
               AS item(object_key)
         WHERE item.object_key IS NOT NULL
           AND item.object_key <> ''
    ),
    verdict AS (
        SELECT
            candidate.object_key,
            CASE
                WHEN NOT public.canvas_owned_media_key_v1(
                    candidate.object_key,
                    p_user_id
                )
                    THEN 'not_owned'
                WHEN EXISTS (
                    SELECT 1
                      FROM public.canvas_upload_reservations r
                     WHERE r.user_id = p_user_id
                       AND r.object_key = candidate.object_key
                )
                    THEN CASE
                        WHEN EXISTS (
                            SELECT 1
                              FROM public.canvas_upload_reservations r
                             WHERE r.user_id = p_user_id
                               AND r.object_key = candidate.object_key
                               AND r.status = 'ready'
                        )
                            THEN NULL
                        ELSE 'not_ready'
                    END
                -- Existing unregistered media predates the upload registry.
                -- It remains writable for compatibility, but cannot be used
                -- as a new generation input because generation calls pass no
                -- canvas revision and therefore have no existing-key set.
                WHEN candidate.object_key = ANY(v_existing_keys)
                    THEN NULL
                WHEN EXISTS (
                    SELECT 1
                      FROM public.generations g
                     WHERE g.user_id = p_user_id
                       AND g.output_oss_key = candidate.object_key
                       AND g.status = 'completed'
                )
                    THEN NULL
                -- 历史面板给得出的素材(2026-08-09 走查 + 2026-08-10 对抗审查)。
                -- 放行面严格对齐 `history-assets.ts` 里两个 normalize 函数实际会吐出
                -- objectKey 的字段;两端锚死路径边界;只扫调用者自己的行。
                -- 本库无 `public.products` 表、`generations` 也无 `output_urls` 列,
                -- 故两者都不在此引用(引用即运行时报错)。
                WHEN EXISTS (
                    SELECT 1
                      FROM (
                          -- 蓝图:source_ref.url 仅在 reference_video 时是媒体载体,
                          -- 与 normalizeBlueprint 的条件一致;scenes[].visual 面板不吐,故不收。
                          SELECT m.media_url
                            FROM public.blueprints b
                            CROSS JOIN LATERAL (
                                SELECT CASE
                                           WHEN b.source_type = 'reference_video'
                                               THEN b.source_ref #>> '{url}'
                                       END AS media_url
                                UNION ALL
                                SELECT b.source_ref #>> '{upload_url}'
                                UNION ALL
                                SELECT jsonb_array_elements_text(
                                    CASE
                                        WHEN jsonb_typeof(b.source_ref -> 'asset_urls') = 'array'
                                            THEN b.source_ref -> 'asset_urls'
                                        ELSE '[]'::jsonb
                                    END
                                )
                                UNION ALL
                                SELECT jsonb_array_elements_text(
                                    CASE
                                        WHEN jsonb_typeof(b.product -> 'images') = 'array'
                                            THEN b.product -> 'images'
                                        ELSE '[]'::jsonb
                                    END
                                )
                                UNION ALL
                                SELECT scene.value #>> '{slot,asset_ref}'
                                  FROM jsonb_array_elements(
                                      CASE
                                          WHEN jsonb_typeof(b.scenes) = 'array'
                                              THEN b.scenes
                                          ELSE '[]'::jsonb
                                      END
                                  ) AS scene(value)
                                UNION ALL
                                SELECT b.globals #>> ARRAY[k.key]
                                  FROM unnest(ARRAY[
                                      'audio_key', 'audio_url', 'bgm_key',
                                      'bgm_url', 'voice_key', 'voice_url'
                                  ]) AS k(key)
                            ) AS m
                           WHERE b.user_id = p_user_id
                          UNION ALL
                          -- 自己已完成的生成:面板取 key 的 URL 列。
                          SELECT u.media_url
                            FROM public.generations g
                            CROSS JOIN LATERAL (
                                VALUES (g.output_url), (g.result_url),
                                       (g.video_url), (g.image_url)
                            ) AS u(media_url)
                           WHERE g.user_id = p_user_id
                             AND g.status = 'completed'
                      ) AS media(media_url)
                     WHERE media.media_url IS NOT NULL
                       AND media.media_url <> ''
                       AND (
                            media.media_url = candidate.object_key
                         OR right(
                                media.media_url,
                                char_length(candidate.object_key) + 1
                            ) = '/' || candidate.object_key
                       )
                )
                    THEN NULL
                ELSE 'not_ready'
            END AS rejection
          FROM candidate
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object('objectKey', object_key, 'reason', rejection)
            ORDER BY object_key
        ) FILTER (WHERE rejection IS NOT NULL),
        '[]'::jsonb
    )
      INTO v_rejected
      FROM verdict;

    UPDATE public.canvas_upload_reservations r
       SET last_referenced_at = v_now,
           updated_at = v_now
     WHERE r.user_id = p_user_id
       AND r.status = 'ready'
       AND r.object_key = ANY(COALESCE(p_object_keys, ARRAY[]::text[]));

    RETURN jsonb_build_object(
        'ok', jsonb_array_length(v_rejected) = 0,
        'reason',
            CASE
                WHEN jsonb_array_length(v_rejected) = 0 THEN NULL
                ELSE 'media_not_ready'
            END,
        'rejected', v_rejected
    );
END;
$$;

REVOKE ALL ON FUNCTION public.assert_canvas_media_keys_ready_v1(uuid, uuid, bigint, text[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_canvas_media_keys_ready_v1(uuid, uuid, bigint, text[])
    TO service_role;

-- 后置断言(照 20260801 的惯例):任何一条不成立就 RAISE,整份文件在隐式事务里回滚,
-- 生产保持旧函数。这里只断言存在性与授权 —— 函数体的运行时行为由随迁移一起提交的
-- PGlite 用例覆盖(scripts/verify-canvas-readiness-migration.mjs)。
DO $postconditions$
DECLARE
    v_fn regprocedure := to_regprocedure(
        'public.assert_canvas_media_keys_ready_v1(uuid,uuid,bigint,text[])'
    );
BEGIN
    IF v_fn IS NULL THEN
        RAISE EXCEPTION 'assert_canvas_media_keys_ready_v1 missing after migration';
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'service_role lost EXECUTE on %', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'anon/authenticated must not have EXECUTE on %', v_fn;
    END IF;
    -- 新分支确实进了函数体(防「粘贴了旧版还以为已修」)。
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'assert_canvas_media_keys_ready_v1'
           AND p.prosrc LIKE '%public.blueprints%'
           AND p.prosrc LIKE '%char_length(candidate.object_key) + 1%'
    ) THEN
        RAISE EXCEPTION 'new history-asset branch not present in function body';
    END IF;
END;
$postconditions$;
