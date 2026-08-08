-- 2026-08-08 · 画布 unknown 恢复面补缺：把人工裁决车道从「仅 video」扩到「video + image」
--
-- 背景(R2 实测,见 docs/SUPER_CANVAS_P0_BOARD.md 的 R2-Q2)：
--   图片直连产物车道在重试耗尽时会以 p_manual_audit 把行停放
--   (release_canvas_gpt_image_direct_media_recovery_v1 → next_reconcile_at = NULL)，
--   设计意图就是「交人工裁决」。但唯一的人工裁决 RPC
--   resolve_canvas_video_unknown_v1 硬性要求 v_gen.type = 'video'，
--   于是被停放的图片行必然 check_violation，端点返回 409 RESOLUTION_REJECTED。
--   与此同时：
--     · claim_canvas_generation_reconciliation_v1 写死 provider_submission_state <> 'unknown'
--     · fail_canvas_generation_v1 显式禁止对 unknown 行失败/退款
--   三者叠加 = 图片 unknown 是一条没有出口的路，积分永久悬空。
--   生产已有实例：generations.id = 9848fcb4-4bad-46e3-bf47-3acc8fe7ce34(扣 5 未退)。
--
-- 本迁移做什么：
--   只把类型谓词从 `v_gen.type <> 'video'` 改成 `v_gen.type NOT IN ('video','image')`，
--   并同步异常文案。其余每一道栅栏(status='pending'、provider_submission_state='unknown'、
--   task_id IS NULL、submission_token_hash/submission_started_at 非空、resolution_id
--   幂等重放比对、bind_task 的 advisory lock 与 task 唯一性、退款走
--   canvas_p1_apply_credit_delta_v1 的单条 refund 锚点、append-only 审计表)全部原样不动。
--
-- 为什么保留 `..._video_...` 这个函数名(而不是改名或新增同族函数)：
--   /api/internal/canvas/resolve-unknown 以字面量调用该名字。就地 CREATE OR REPLACE
--   同签名 = 零应用改动、零 GRANT 变更(replace 保留既有授权)、可立即生效，
--   对一次人工执行的生产迁移是最小爆炸半径。命名债记在此处：
--   将来若新增 resolve_canvas_generation_unknown_v1，把本函数改成薄包装即可。
--
-- 执行方式(铁律)：SQL 落盘 + 本地校验，生产由用户经 Supabase dashboard 执行。
-- 幂等：CREATE OR REPLACE，可重复执行。

CREATE OR REPLACE FUNCTION public.resolve_canvas_video_unknown_v1(
    p_resolution_id     uuid,
    p_generation_id     uuid,
    p_resolution        text,
    p_task_id           text,
    p_operator_label    text,
    p_provider_evidence text
)
RETURNS TABLE (
    resolution_id                    uuid,
    generation_id                    uuid,
    status                           text,
    provider_submission_state        text,
    task_id                          text,
    refunded_amount                  integer,
    balance_after                    integer,
    transitioned                     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_gen       public.generations%ROWTYPE;
    v_audit     public.canvas_generation_resolution_audit%ROWTYPE;
    v_refund    integer := 0;
    v_balance   integer;
    v_task_id   text;
    v_row_count bigint;
BEGIN
    IF p_resolution_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: resolution and generation ids are required'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_resolution NOT IN ('bind_task', 'verified_no_task_refund') THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: unsupported resolution %',
            COALESCE(p_resolution, '<null>')
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_operator_label IS NULL
       OR pg_catalog.length(p_operator_label) NOT BETWEEN 3 AND 120
       OR p_operator_label !~ '^[A-Za-z0-9._@:-]+$' THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: operator_label is invalid'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF p_provider_evidence IS NULL
       OR pg_catalog.length(p_provider_evidence) NOT BETWEEN 8 AND 2000
       OR p_provider_evidence ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: provider_evidence is invalid'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_task_id := NULLIF(pg_catalog.btrim(p_task_id), '');
    IF p_resolution = 'bind_task' THEN
        IF v_task_id IS NULL
           OR pg_catalog.length(v_task_id) > 256
           OR v_task_id !~ '^[A-Za-z0-9._:-]+$' THEN
            RAISE EXCEPTION
                'resolve_canvas_video_unknown_v1: bind_task requires a canonical task id'
                USING ERRCODE = 'invalid_parameter_value';
        END IF;
    ELSIF p_task_id IS NOT NULL THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: refund resolution must not carry a task id'
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- The generation row serializes first execution, idempotent replay, and a
    -- conflicting second operator decision for the same uncertainty.
    SELECT g.* INTO v_gen
      FROM public.generations g
     WHERE g.id = p_generation_id
       AND g.source = 'canvas'
       AND g.action_id IS NOT NULL
     FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: no Canvas action row %',
            p_generation_id;
    END IF;

    SELECT a.* INTO v_audit
      FROM public.canvas_generation_resolution_audit a
     WHERE a.resolution_id = p_resolution_id;

    IF FOUND THEN
        IF v_audit.generation_id IS DISTINCT FROM p_generation_id
           OR v_audit.resolution IS DISTINCT FROM p_resolution
           OR v_audit.task_id IS DISTINCT FROM v_task_id
           OR v_audit.operator_label IS DISTINCT FROM p_operator_label
           OR v_audit.provider_evidence IS DISTINCT FROM p_provider_evidence THEN
            RAISE EXCEPTION
                'resolve_canvas_video_unknown_v1: resolution id was reused with different input'
                USING ERRCODE = 'check_violation';
        END IF;

        resolution_id             := v_audit.resolution_id;
        generation_id             := v_audit.generation_id;
        status                    := v_audit.status_after;
        provider_submission_state := v_audit.provider_submission_state_after;
        task_id                   := v_audit.task_id;
        refunded_amount           := v_audit.refunded_amount;
        balance_after             := v_audit.balance_after;
        transitioned              := false;
        RETURN NEXT;
        RETURN;
    END IF;

    -- 2026-08-08: the lane now owns task-less pending/unknown VIDEO **and IMAGE**
    -- rows. The image direct-media lane parks a row for manual audit once it has
    -- exhausted its retries (release_canvas_gpt_image_direct_media_recovery_v1
    -- with p_manual_audit => next_reconcile_at = NULL), but this was the only
    -- manual-audit surface and it was pinned to 'video', so a parked image row
    -- had NO exit at all: the generic reconcile lane excludes every unknown row
    -- and fail_canvas_generation_v1 refuses to fail/refund an unknown row. Every
    -- other fence below is type-agnostic and stays exactly as it was.
    IF v_gen.type NOT IN ('video', 'image')
       OR v_gen.status <> 'pending'
       OR v_gen.provider_submission_state <> 'unknown'
       OR v_gen.task_id IS NOT NULL
       OR v_gen.submission_token_hash IS NULL
       OR v_gen.submission_started_at IS NULL THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: generation % is not a task-less pending video/image uncertainty',
            p_generation_id
            USING ERRCODE = 'check_violation';
    END IF;

    IF p_resolution = 'bind_task' THEN
        -- Serialize the "is this provider task already bound?" proof even when
        -- two different unknown rows are resolved concurrently.
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('canvas-provider-task:' || v_task_id, 0)
        );
        PERFORM 1
          FROM public.generations other
         WHERE other.id <> v_gen.id
           AND other.task_id = v_task_id;
        IF FOUND THEN
            RAISE EXCEPTION
                'resolve_canvas_video_unknown_v1: provider task is already bound'
                USING ERRCODE = 'unique_violation';
        END IF;

        UPDATE public.generations g
           SET status                     = 'processing',
               provider_submission_state  = 'bound',
               task_id                    = v_task_id,
               next_reconcile_at          = pg_catalog.now(),
               reconcile_owner            = NULL,
               reconcile_lease_token      = NULL,
               reconcile_lease_expires_at = NULL,
               last_reconcile_error_code  = 'operator_recovered_provider_task'
         WHERE g.id = v_gen.id
           AND g.status = 'pending'
           AND g.provider_submission_state = 'unknown'
           AND g.task_id IS NULL;
        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        IF v_row_count <> 1 THEN
            RAISE EXCEPTION
                'resolve_canvas_video_unknown_v1: bind lost its state fence'
                USING ERRCODE = 'serialization_failure';
        END IF;
    ELSE
        UPDATE public.generations g
           SET status                     = 'failed',
               error_message              = 'operator_verified_no_provider_task',
               completed_at               = pg_catalog.now(),
               next_reconcile_at          = NULL,
               reconcile_owner            = NULL,
               reconcile_lease_token      = NULL,
               reconcile_lease_expires_at = NULL,
               last_reconcile_error_code  = 'operator_verified_no_provider_task'
         WHERE g.id = v_gen.id
           AND g.status = 'pending'
           AND g.provider_submission_state = 'unknown'
           AND g.task_id IS NULL;
        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        IF v_row_count <> 1 THEN
            RAISE EXCEPTION
                'resolve_canvas_video_unknown_v1: refund lost its state fence'
                USING ERRCODE = 'serialization_failure';
        END IF;

        IF v_gen.billing_mode = 'debit' AND v_gen.credit_cost > 0 THEN
            v_refund := v_gen.credit_cost - v_gen.credits_refunded;
            IF v_refund > 0 THEN
                SELECT d.balance_after INTO v_balance
                  FROM public.canvas_p1_apply_credit_delta_v1(
                      p_user_id            => v_gen.user_id,
                      p_entry_kind         => 'refund',
                      p_amount             => v_refund,
                      p_operation_anchor   => 'canvas-refund:' || v_gen.id::text,
                      p_generation_id      => v_gen.id,
                      p_action_id          => v_gen.action_id,
                      p_canvas_id          => v_gen.canvas_id,
                      p_canvas_id_snapshot => v_gen.canvas_id_snapshot,
                      p_canvas_node_id     => v_gen.canvas_node_id,
                      p_pricing_version    => v_gen.pricing_version,
                      p_description        => 'Canvas operator-verified absent-task refund'
                  ) AS d;

                UPDATE public.generations
                   SET credits_refunded = v_gen.credit_cost
                 WHERE id = v_gen.id;
            END IF;
        END IF;
    END IF;

    IF v_balance IS NULL THEN
        SELECT pr.credits INTO v_balance
          FROM public.profiles pr
         WHERE pr.id = v_gen.user_id;
    END IF;
    IF v_balance IS NULL THEN
        RAISE EXCEPTION
            'resolve_canvas_video_unknown_v1: profile balance is unavailable';
    END IF;

    INSERT INTO public.canvas_generation_resolution_audit (
        resolution_id,
        generation_id,
        user_id,
        action_id,
        resolution,
        operator_label,
        provider_evidence,
        previous_provider_submission_state,
        status_after,
        provider_submission_state_after,
        task_id,
        refunded_amount,
        balance_after
    ) VALUES (
        p_resolution_id,
        v_gen.id,
        v_gen.user_id,
        v_gen.action_id,
        p_resolution,
        p_operator_label,
        p_provider_evidence,
        'unknown',
        CASE p_resolution WHEN 'bind_task' THEN 'processing' ELSE 'failed' END,
        CASE p_resolution WHEN 'bind_task' THEN 'bound' ELSE 'unknown' END,
        v_task_id,
        v_refund,
        v_balance
    );

    resolution_id             := p_resolution_id;
    generation_id             := v_gen.id;
    status                    := CASE p_resolution WHEN 'bind_task' THEN 'processing' ELSE 'failed' END;
    provider_submission_state := CASE p_resolution WHEN 'bind_task' THEN 'bound' ELSE 'unknown' END;
    task_id                   := v_task_id;
    refunded_amount           := v_refund;
    balance_after             := v_balance;
    transitioned              := true;
    RETURN NEXT;
END;
$$;
COMMENT ON FUNCTION public.resolve_canvas_video_unknown_v1(uuid, uuid, text, text, text, text) IS
    'Service-only, idempotent and append-only-audited resolution for task-less pending/unknown Canvas VIDEO and IMAGE generations. Bind a provider-proven task or refund only with provider evidence that no task exists. Never resubmits upstream work. Name retained for the /api/internal/canvas/resolve-unknown contract.';

REVOKE ALL ON FUNCTION public.resolve_canvas_video_unknown_v1(uuid, uuid, text, text, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_canvas_video_unknown_v1(uuid, uuid, text, text, text, text)
    TO service_role;

NOTIFY pgrst, 'reload schema';
