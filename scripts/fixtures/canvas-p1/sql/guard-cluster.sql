-- ============================================================================
-- Canvas P1 fixture · 集群身份守卫(可独立执行,自身无任何副作用)
--
-- 与 guard.sql 的区别:本文件**不**校验库名,只证明「这是本地回环测试集群」。
-- 用于角色这类 cluster-global 对象的脚本 —— 它们必须在维护库(postgres)上执行,
-- 因而无法套用 guard.sql 的 fixture 库名断言。
--
-- 安全含义:角色是集群级的。若在生产集群上误跑角色脚本,
-- 会把 service_role 改成 NOLOGIN,直接打死 PostgREST/service-key 认证。
-- 因此任何触碰角色的脚本都必须先 \ir 本文件。
-- ============================================================================

DO $$
BEGIN
    IF coalesce(host(inet_server_addr()), '') <> '127.0.0.1' THEN
        RAISE EXCEPTION 'FAIL-CLOSED: 服务器地址 % 不是 127.0.0.1(本地 fixture 集群),拒绝改动集群级角色。',
            coalesce(host(inet_server_addr()), '(未知/非 TCP 连接)');
    END IF;
    IF coalesce(inet_server_port(), 0) <> 54329 THEN
        RAISE EXCEPTION 'FAIL-CLOSED: 服务器端口 % 不是 54329(本地 fixture 集群),拒绝改动集群级角色。',
            coalesce(inet_server_port(), 0);
    END IF;
END
$$;
