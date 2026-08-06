-- ============================================================================
-- Canvas P1 fixture · 身份守卫(可独立执行,自身无任何副作用)
--
-- 任何破坏性脚本必须在动作前 \ir 本文件。抽成独立文件有两个目的:
--  1. 05-db-bootstrap.sql 走 JS 之外的路径(直接 psql -f)时同样 fail closed;
--  2. 让 gate 5 可以把它单独打到「错误的库」上验证守卫真的会拦 ——
--     本文件不含 DROP/CREATE,即便守卫失效也不会损坏任何东西。
-- ============================================================================

DO $$
BEGIN
    IF current_database() <> 'stargaze_canvas_p1_fixture' THEN
        RAISE EXCEPTION 'FAIL-CLOSED: 当前库 % 不是 fixture 库(期望 stargaze_canvas_p1_fixture),拒绝执行。',
            current_database();
    END IF;
    IF coalesce(host(inet_server_addr()), '') <> '127.0.0.1' THEN
        RAISE EXCEPTION 'FAIL-CLOSED: 服务器地址 % 不是 127.0.0.1,拒绝执行。',
            coalesce(host(inet_server_addr()), '(未知/非 TCP 连接)');
    END IF;
    IF coalesce(inet_server_port(), 0) <> 54329 THEN
        RAISE EXCEPTION 'FAIL-CLOSED: 服务器端口 % 不是 54329,拒绝执行。',
            coalesce(inet_server_port(), 0);
    END IF;
END
$$;
