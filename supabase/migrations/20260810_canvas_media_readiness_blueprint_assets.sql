-- 画布保存闸:承认「历史面板给得出的蓝图素材」为 ready
--
-- ## 为什么要这条迁移
--
-- 2026-08-09 走查实测:从历史面板加一张**蓝图**来源的图,`PATCH /api/canvas/{id}` 立刻
-- 422 `CANVAS_DOC_INVALID · 画布包含尚未完成服务端确认的上传对象`,随后自动保存进入
-- 「保存已暂停」,**且暂停是粘性的** —— 删掉肇事节点、等待、Ctrl+Z 都不解除,
-- UI 里没有恢复入口,只能删节点 + 刷新页面。画布已对所有登录用户开放,任何人从历史面板
-- 挑一张蓝图素材都会踩到。
--
-- 根因不是「蓝图」特有:`assert_canvas_media_keys_ready_v1` 只接受三类 object key ——
--   ① `canvas_upload_reservations` 里 status='ready' 的;
--   ② 当前文档里已经存在的(存量兼容);
--   ③ `generations` 里 status='completed' 的 output_oss_key。
-- 而 `/api/canvas/history` 供的是 `generations` / `products` / `blueprints` 三个来源,
-- **后两个一个都不在白名单里**。(`products` 表在本库并不存在,历史路由已按缺表容错跳过,
-- 因此实际只有 `blueprints` 需要放行。)
--
-- ## 为什么放行是安全的
--
-- 归属**已经由路径结构强制**:`canvas_owned_media_key_v1` 要求 key 形如
-- `<前缀>/<user_id>/<文件>` 且 `<user_id>` 必须等于调用者本人,该分支在本函数里排在最前、
-- 不满足直接判 `not_owned`。⇒ **任何通过归属校验的 key 在结构上只可能指向用户自己的命名空间**,
-- readiness 这道闸不是跨用户的安全边界,而是「这个对象登记过没有」的生命周期约束。
-- 实测被拒的理由也确实是 `not_ready` 而非 `not_owned`。
--
-- 本迁移把放行面**严格对齐历史面板实际给得出的字段**(`src/lib/canvas/history-assets.ts`
-- 的 `normalizeBlueprint`),不做整行 `::text` 模糊匹配:
--   source_ref.url / source_ref.upload_url / source_ref.asset_urls[]
--   product.images[] / scenes[].slot.asset_ref
--   globals.{audio_key,audio_url,bgm_key,bgm_url,voice_key,voice_url}
-- ⚠️ **刻意不含 `scenes[].visual`** —— 该字段是描述性文案,不是媒体载体
-- (history-assets.ts 里有一行注释明确写了这点)。面板给不出它,闸门也就不该认它。
--
-- ## 性能
--
-- 新分支排在 ①②③ 之后,只对「既没登记、又不在当前文档里、也不是自己产物」的 key 触发。
-- 一张素材加进画布后,**第一次保存**走这条路,之后它就进了文档、由分支②短路。
-- ⇒ 每张素材至多命中一次,不是自动保存的常驻开销。

-- 判定:某 object key 是否被该用户自己的蓝图行引用(只读)。
CREATE OR REPLACE FUNCTION public.canvas_blueprint_media_key_ref_v1(
    p_object_key text,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.blueprints b
          CROSS JOIN LATERAL (
              SELECT b.source_ref #>> '{url}' AS media_url
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
              SELECT b.globals #>> ARRAY[g.key]
                FROM unnest(ARRAY[
                    'audio_key', 'audio_url', 'bgm_key',
                    'bgm_url', 'voice_key', 'voice_url'
                ]) AS g(key)
          ) AS media
         WHERE b.user_id = p_user_id
           AND media.media_url IS NOT NULL
           AND media.media_url <> ''
           AND (
                -- 直接存 object key 的写法
                media.media_url = p_object_key
                -- 存完整 URL 的写法:https://<host>/<objectKey>
                -- 带上前导 '/' 是为了卡住路径边界,避免 `xproducts/…` 误配 `products/…`。
                -- 用 position() 而非 LIKE:object key 允许含 '_',那是 LIKE 的单字符通配符。
             OR position('/' || p_object_key IN media.media_url) > 0
           )
    );
$$;

REVOKE ALL ON FUNCTION public.canvas_blueprint_media_key_ref_v1(text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_blueprint_media_key_ref_v1(text, uuid)
    TO service_role;

-- 主闸重建:在原三条放行分支之后追加第四条(蓝图素材)。其余逻辑逐字保持不变。
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
                -- 历史面板的蓝图素材(2026-08-09 走查查出的既有缺陷)。放行面严格对齐
                -- history-assets.ts 的 normalizeBlueprint 实际给得出的字段;归属已由
                -- 上面的 canvas_owned_media_key_v1 分支保证只能是本人命名空间。
                WHEN public.canvas_blueprint_media_key_ref_v1(
                    candidate.object_key,
                    p_user_id
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
