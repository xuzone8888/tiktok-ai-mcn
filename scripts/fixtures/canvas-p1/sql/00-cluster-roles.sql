-- ============================================================================
-- Canvas P1 fixture · 00 · 集群级角色(唯一的 cluster-global 副作用)
--
-- 目的:复现生产的 ACL/RLS 评估主体。没有这些角色,relation ACL 与
-- default ACL 无法忠实重建,Stage 2 的「anon/authenticated 无权限」断言会
-- 变成空断言(vacuous pass)。
--
-- 与生产的实测差异(刻意,已记录):
-- - 全部建为 NOLOGIN 且不设任何密码 => 本 fixture 永不持久化凭据。
--   测试用 SET ROLE 切换主体,不需要登录,也就不需要密码。
-- - supabase_admin 在生产是 LOGIN+SUPERUSER;此处只作为 default ACL 的属主
--   存在,故意不授予 LOGIN/SUPERUSER,避免在本地造出可登录超级用户。
-- - authenticator 与生产的 role membership 图谱不复制(敏感,且本批次不需要)。
--
-- 忠实保留的关键属性:
-- - service_role BYPASSRLS = true(实测)。这决定了 Stage 2 的账本 append-only
--   守卫必须用 TRIGGER 之类不可绕过的机制,RLS 对 service_role 无效。
-- - anon / authenticated NOBYPASSRLS(实测)。
--
-- 幂等:可重复执行。角色是集群级对象,跨 fixture 库重建后依然存在。
--
-- 安全:角色是 **cluster-global** 的 —— 本文件的写动作会影响该集群的每一个库。
-- 它必须跑在维护库(postgres)上,因而套不了 guard.sql 的 fixture 库名断言;
-- 改用 guard-cluster.sql 证明「这是本地 127.0.0.1:54329 测试集群」。
-- 没有这道守卫时,带着生产 PG* 环境变量手跑本文件会把生产 service_role 改成
-- NOLOGIN,直接打死 PostgREST/service-key 认证。
-- ============================================================================

\set ON_ERROR_STOP on

-- 守卫必须先于任何写动作;\ir 相对本脚本目录解析,不依赖调用方 CWD。
\ir guard-cluster.sql

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        -- BYPASSRLS 为实测事实,不可省略,否则安全断言失真。
        CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
        CREATE ROLE supabase_admin NOLOGIN NOINHERIT NOBYPASSRLS;
    END IF;
END
$$;

-- 收敛到期望属性(幂等;若角色已存在但属性漂移,这里纠正)。
ALTER ROLE anon           NOLOGIN NOBYPASSRLS;
ALTER ROLE authenticated  NOLOGIN NOBYPASSRLS;
ALTER ROLE service_role   NOLOGIN BYPASSRLS;
ALTER ROLE supabase_admin NOLOGIN NOBYPASSRLS;
