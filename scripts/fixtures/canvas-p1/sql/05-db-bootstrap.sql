-- ============================================================================
-- Canvas P1 fixture · 05 · 库内地基(在 fixture 库内执行)
--
-- 顺序要求:default ACL 必须在建表之前设置,否则新表不会继承 anon/authenticated
-- 的自动授权,ACL 断言就会失真(生产正是靠 default ACL 让 anon 拿到 8 项权限)。
--
-- 本文件不含任何生产例程体、策略表达式或角色图谱。auth.uid() 与
-- update_updated_at_column() 均为按公开行为自行编写的等价实现。
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 0. 身份守卫:破坏性重建只允许发生在硬编码 fixture 库内的本地回环集群上。
--    \ir 相对本脚本所在目录解析,不依赖调用方 CWD。
-- ---------------------------------------------------------------------------
\ir guard.sql

-- ---------------------------------------------------------------------------
-- 1. 清空重建(只作用于本库的 public / auth schema)
-- ---------------------------------------------------------------------------
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
CREATE SCHEMA auth AUTHORIZATION postgres;

-- ---------------------------------------------------------------------------
-- 2. 扩展:credit_transactions.id 实测默认值是 uuid_generate_v4()
--    (generations/canvases 用内置 gen_random_uuid(),PG13+ 无需扩展)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- ---------------------------------------------------------------------------
-- 3. default ACL —— 必须早于建表
--    实测:public schema 下 postgres 与 supabase_admin 两个属主各有
--    表/函数/序列三类默认授权,授予 postgres/anon/authenticated/service_role。
--    这正是 anon 在四张目标表上各持 8 项权限的来源。
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
    GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. auth 桩:profiles.id 实测外键指向 auth.users(id) ON DELETE CASCADE
-- ---------------------------------------------------------------------------
CREATE TABLE auth.users (
    id uuid NOT NULL,
    email text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_pkey PRIMARY KEY (id)
);

-- auth.uid():按 Supabase 的公开行为自行实现(读 JWT claim GUC)。
-- 测试用 SET LOCAL request.jwt.claim.sub = '<uuid>' 模拟登录主体;
-- 未设置时返回 NULL,等价于匿名。
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- 5. 枚举与触发器函数
-- ---------------------------------------------------------------------------
CREATE TYPE public.user_role AS ENUM ('user', 'admin', 'super_admin');

-- 与生产 public.update_updated_at_column() 行为等价的自写实现
-- (实测:plpgsql、非 SECURITY DEFINER、volatile、无 proconfig)。
-- 刻意不复制生产例程体。
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
