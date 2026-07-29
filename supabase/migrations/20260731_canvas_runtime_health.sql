-- Canvas production health contract.
--
-- This service-role-only RPC performs catalog reads only. It never invokes a
-- lifecycle/recovery RPC, takes a business-row lock, or mutates application
-- state. Its purpose is to prove that the database is reachable and that the
-- exact RPC contracts required by the production Canvas release are installed
-- and executable by their intended roles.

CREATE OR REPLACE FUNCTION public.canvas_production_healthcheck_v1()
RETURNS TABLE (
    contract_version   text,
    read_only_probe    boolean,
    required_rpc_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_requirement record;
    v_function_oid oid;
    v_function_is_security_definer boolean;
    v_search_path_matches boolean;
    v_required_rpc_count integer := 0;
BEGIN
    FOR v_requirement IN
        SELECT *
          FROM (
            VALUES
              ('public.create_canvas_project_v1(uuid,text,integer,jsonb,jsonb,integer)', 'authenticated', true, ''),
              ('public.delete_canvas_project_v1(uuid)', 'authenticated', true, ''),
              ('public.begin_canvas_generation_v1(uuid,uuid,text,uuid,bigint,text,text,text,text,text,text,integer,text,text,integer,text,text,text,text,integer,jsonb)', 'service_role', true, ''),
              ('public.lookup_canvas_generation_v1(uuid,uuid,text,uuid)', 'service_role', true, ''),
              ('public.replay_canvas_generation_completion_v1(uuid,uuid,uuid,uuid,text,text)', 'service_role', true, ''),
              ('public.claim_canvas_generation_submission_v1(uuid,uuid,text,uuid,bigint,text,text)', 'service_role', true, ''),
              ('public.abandon_canvas_generation_v1(uuid,uuid)', 'service_role', true, ''),
              ('public.bind_canvas_generation_task_v1(uuid,uuid,jsonb,text)', 'service_role', true, ''),
              ('public.replay_canvas_generation_bind_v1(uuid,uuid,uuid,uuid,text,text,text)', 'service_role', true, ''),
              ('public.mark_canvas_generation_unknown_v1(uuid,uuid,jsonb,text)', 'service_role', true, ''),
              ('public.fail_canvas_generation_v1(uuid,uuid,jsonb,text)', 'service_role', true, ''),
              ('public.complete_canvas_generation_v1(uuid,uuid,jsonb,text,text,jsonb)', 'service_role', true, ''),
              ('public.claim_canvas_generation_reconciliation_v1(uuid,integer,integer)', 'service_role', true, ''),
              ('public.release_canvas_generation_reconciliation_v1(uuid,jsonb)', 'service_role', true, ''),
              ('public.claim_canvas_gpt_image_direct_media_recovery_v1(uuid,integer,integer)', 'service_role', true, ''),
              ('public.release_canvas_gpt_image_direct_media_recovery_v1(uuid,jsonb,boolean,text)', 'service_role', true, ''),
              ('public.sweep_stale_canvas_text_submission_unknown_v1(integer)', 'service_role', true, ''),
              ('public.sweep_stale_canvas_not_started_v1(integer)', 'service_role', true, ''),
              ('public.resolve_canvas_video_unknown_v1(uuid,uuid,text,text,text,text)', 'service_role', true, ''),
              ('public.canvas_owned_media_key_v1(text,uuid)', 'service_role', false, ''),
              ('public.reserve_canvas_uploads_v1(uuid,jsonb)', 'service_role', true, ''),
              ('public.finalize_canvas_upload_v1(uuid,uuid,text,bigint,text)', 'service_role', true, ''),
              ('public.assert_canvas_media_keys_ready_v1(uuid,uuid,bigint,text[])', 'service_role', true, ''),
              ('public.sweep_expired_canvas_uploads_v1(integer)', 'service_role', true, ''),
              ('public.mark_canvas_upload_orphans_v1(integer,integer)', 'service_role', true, ''),
              ('public.claim_canvas_upload_purge_v1(integer,integer)', 'service_role', true, ''),
              ('public.complete_canvas_upload_purge_v1(uuid,uuid)', 'service_role', true, '')
          ) AS required(
              signature,
              executor_role,
              expected_security_definer,
              expected_search_path
          )
    LOOP
        v_function_oid := pg_catalog.to_regprocedure(v_requirement.signature);
        IF v_function_oid IS NULL THEN
            RAISE EXCEPTION 'required Canvas RPC is missing: %',
                v_requirement.signature
                USING ERRCODE = '55000';
        END IF;

        SELECT
            proc.prosecdef,
            EXISTS (
                SELECT 1
                  FROM pg_catalog.unnest(
                      COALESCE(
                          proc.proconfig,
                          ARRAY[]::text[]
                      )
                  ) AS config(value)
                 WHERE pg_catalog.split_part(config.value, '=', 1) = 'search_path'
                   AND CASE
                         WHEN v_requirement.expected_search_path = '' THEN
                           pg_catalog.btrim(
                               pg_catalog.replace(
                                   pg_catalog.substr(
                                       config.value,
                                       pg_catalog.strpos(config.value, '=') + 1
                                   ),
                                   '"',
                                   ''
                               )
                           ) = ''
                         ELSE
                           pg_catalog.btrim(
                               pg_catalog.substr(
                                   config.value,
                                   pg_catalog.strpos(config.value, '=') + 1
                               )
                           ) = v_requirement.expected_search_path
                       END
            )
          INTO
            v_function_is_security_definer,
            v_search_path_matches
          FROM pg_catalog.pg_proc AS proc
         WHERE proc.oid = v_function_oid
           AND proc.prokind = 'f';

        IF v_function_is_security_definer IS DISTINCT FROM
           v_requirement.expected_security_definer THEN
            RAISE EXCEPTION 'required Canvas RPC SECURITY DEFINER drift: %',
                v_requirement.signature
                USING ERRCODE = '55000';
        END IF;

        IF v_search_path_matches IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'required Canvas RPC search_path drift: %',
                v_requirement.signature
                USING ERRCODE = '55000';
        END IF;

        IF NOT pg_catalog.has_function_privilege(
            v_requirement.executor_role,
            v_function_oid,
            'EXECUTE'
        ) THEN
            RAISE EXCEPTION 'required Canvas RPC is not executable by %: %',
                v_requirement.executor_role,
                v_requirement.signature
                USING ERRCODE = '42501';
        END IF;

        IF pg_catalog.has_function_privilege(
            'anon',
            v_function_oid,
            'EXECUTE'
        ) THEN
            RAISE EXCEPTION 'anon may execute required Canvas RPC: %',
                v_requirement.signature
                USING ERRCODE = '42501';
        END IF;

        IF v_requirement.executor_role = 'service_role'
           AND pg_catalog.has_function_privilege(
               'authenticated',
               v_function_oid,
               'EXECUTE'
           ) THEN
            RAISE EXCEPTION 'authenticated may execute service-only Canvas RPC: %',
                v_requirement.signature
                USING ERRCODE = '42501';
        END IF;

        v_required_rpc_count := v_required_rpc_count + 1;
    END LOOP;

    RETURN QUERY
    SELECT
        'canvas-production-health-v1'::text,
        true,
        v_required_rpc_count;
END;
$$;

REVOKE ALL ON FUNCTION public.canvas_production_healthcheck_v1()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canvas_production_healthcheck_v1()
    TO service_role;

COMMENT ON FUNCTION public.canvas_production_healthcheck_v1() IS
    'Read-only catalog probe for the production Canvas lifecycle, recovery, and upload RPC contract; service_role only.';

NOTIFY pgrst, 'reload schema';
