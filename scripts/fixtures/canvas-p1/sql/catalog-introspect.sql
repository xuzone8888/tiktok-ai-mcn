-- ============================================================================
-- Canvas P1 fixture · 目录自省(只读,单条 SELECT,输出一个 JSON)
--
-- 输出结构与 expected-catalog.json 的字段白名单严格对齐,便于逐项比对。
-- 刻意**不导出**策略表达式文本 / 例程体 / 角色成员图谱:
-- 只导出 has_using / has_check / using_is_literal_true 这类形状标志。
-- ============================================================================

WITH targets(name) AS (
    VALUES ('canvases'), ('credit_transactions'), ('generations'), ('profiles')
),
target_rel AS (
    SELECT c.oid, c.relname, c.relkind, c.relacl, c.relowner,
           c.relrowsecurity, c.relforcerowsecurity,
           pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (SELECT name FROM targets)
),
cols AS (
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'ordinal', a.attnum,
               'name', a.attname,
               'type', format_type(a.atttypid, a.atttypmod),
               'not_null', a.attnotnull,
               'default', pg_get_expr(d.adbin, d.adrelid)
           )), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
),
cons AS (
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'name', ct.conname,
               'type', ct.contype::text,
               'validated', ct.convalidated,
               'definition', pg_catalog.pg_get_constraintdef(ct.oid, true)
           )), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_constraint ct ON ct.conrelid = r.oid
),
idx AS (
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'name', ic.relname,
               'unique', ix.indisunique,
               'primary', ix.indisprimary,
               'definition', pg_get_indexdef(ix.indexrelid)
           )), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_index ix ON ix.indrelid = r.oid
    JOIN pg_class ic ON ic.oid = ix.indexrelid
),
rels AS (
    SELECT coalesce(json_agg(json_build_object(
               'name', relname,
               'kind', relkind::text,
               'owner', owner,
               'rls_enabled', relrowsecurity,
               'rls_forced', relforcerowsecurity
           )), '[]'::json) AS j
    FROM target_rel
),
pol AS (
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               -- 策略名属元数据(且本就写在仓库自有迁移里),不是「策略表达式」。
               -- 必须导出:否则同表同命令的两条策略(credit_transactions 的两条 SELECT)
               -- 在比对时完全同形,多重集断言会出现盲区。
               'name', p.polname,
               'command', p.polcmd::text,
               'permissive', p.polpermissive,
               'roles', CASE
                   WHEN p.polroles = '{0}'::oid[] THEN json_build_array('PUBLIC')
                   ELSE (SELECT json_agg(pg_get_userbyid(u) ORDER BY u) FROM unnest(p.polroles) AS u)
               END,
               'has_using', pg_get_expr(p.polqual, p.polrelid) IS NOT NULL,
               'has_check', pg_get_expr(p.polwithcheck, p.polrelid) IS NOT NULL,
               'using_is_literal_true',
                   coalesce(btrim(pg_get_expr(p.polqual, p.polrelid)) = 'true', false)
           )), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_policy p ON p.polrelid = r.oid
),
acl AS (
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                               ELSE pg_get_userbyid(a.grantee) END,
               'privilege', a.privilege_type
           )), '[]'::json) AS j
    FROM target_rel r
    CROSS JOIN LATERAL aclexplode(coalesce(r.relacl, acldefault('r', r.relowner))) AS a
),
dacl AS (
    SELECT coalesce(json_agg(json_build_object(
               'owner', pg_get_userbyid(d.defaclrole),
               'schema', n.nspname,
               'object_type', d.defaclobjtype::text,
               'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                               ELSE pg_get_userbyid(a.grantee) END,
               'privilege', a.privilege_type
           )), '[]'::json) AS j
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
),
infk AS (
    SELECT coalesce(json_agg(json_build_object(
               'source_table', sc.relname,
               'target_table', tr.relname,
               'name', ct.conname,
               'definition', pg_catalog.pg_get_constraintdef(ct.oid, true)
           )), '[]'::json) AS j
    FROM target_rel tr
    JOIN pg_constraint ct ON ct.confrelid = tr.oid AND ct.contype = 'f'
    JOIN pg_class sc ON sc.oid = ct.conrelid
),
profile_keys AS (
    SELECT coalesce(json_agg(json_build_object(
               'column', a.attname,
               'primary_or_unique', EXISTS (
                   SELECT 1 FROM pg_index i
                   WHERE i.indrelid = r.oid AND i.indisunique
                     AND a.attnum = ANY (i.indkey::smallint[])
               ),
               'referenced_by_foreign_key', EXISTS (
                   SELECT 1 FROM pg_constraint fk
                   WHERE fk.confrelid = r.oid AND fk.contype = 'f'
                     AND a.attnum = ANY (fk.confkey)
               )
           ) ORDER BY a.attnum), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE r.relname = 'profiles'
),
trg AS (
    SELECT coalesce(json_agg(json_build_object(
               'table', r.relname,
               'name', t.tgname,
               'function', p.proname || '()',
               'enabled', t.tgenabled::text
           )), '[]'::json) AS j
    FROM target_rel r
    JOIN pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal
    JOIN pg_proc p ON p.oid = t.tgfoid
)
SELECT json_build_object(
    'columns', (SELECT j FROM cols),
    'constraints', (SELECT j FROM cons),
    'indexes', (SELECT j FROM idx),
    'relations', (SELECT j FROM rels),
    'policies', (SELECT j FROM pol),
    'relation_acl', (SELECT j FROM acl),
    'default_acl', (SELECT j FROM dacl),
    'incoming_foreign_keys', (SELECT j FROM infk),
    'profile_key_columns', (SELECT j FROM profile_keys),
    'triggers', (SELECT j FROM trg),
    'server_version', current_setting('server_version'),
    'server_version_num', current_setting('server_version_num'),
    'database', current_database()
)::text;
