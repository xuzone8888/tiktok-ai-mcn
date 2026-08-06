# Canvas P1 · selective-history fixture(Batch 1B)

离线复现生产四张目标表(`profiles` / `generations` / `credit_transactions` / `canvases`)
的**实测形状**,供 Batch 2 的加法迁移在真实 PostgreSQL 上做 DDL / ACL / RLS / 约束 / 幂等验证。

## 运行

```bash
node scripts/fixtures/canvas-p1/build.mjs      # 建/重建 fixture
node scripts/verify-canvas-p1-fixture.mjs      # 六道 gate
```

目标集群固定为本地官方解包的 PostgreSQL 17.10 回环实例 `127.0.0.1:54329`,
库名硬编码 `stargaze_canvas_p1_fixture`。

**认证**:一律 `psql --no-password`,完全交给 libpq 既有机制(pgpass / 环境)。
本目录不读、不写、不回显、不持久化任何密码;认证失败即 fail closed。
测试主体切换用 `SET ROLE`(角色均为 NOLOGIN),因此**根本不需要密码**。

### 守卫(两道,都必须先于写动作)

| 守卫 | 证明 | 用于 |
|---|---|---|
| `sql/guard.sql` | host + port + **库名** = fixture 库 | `05` / `10` / `20`(库内对象) |
| `sql/guard-cluster.sql` | host + port(**不**校验库名) | `00`(角色是 cluster-global,必须跑在维护库上,套不了库名断言) |

四个会写入的 SQL 文件**全部**在首个写语句前 `\ir` 守卫,并设 `ON_ERROR_STOP`
——这样即便绕开 JS 直接 `psql -f` 也 fail closed。`verify-canvas-p1-fixture.mjs`
的 gate 5 对这一点有防回归断言。

> 为什么角色脚本必须有守卫:角色是集群级的。带着生产 `PG*` 环境变量手跑
> `00-cluster-roles.sql`,会把生产 `service_role` 改成 `NOLOGIN`,直接打死
> PostgREST / service-key 认证。`-h` 也不足以证明目的地(`PGHOSTADDR` /
> `PGSERVICE` 可架空它),所以守卫用后端自己求值的
> `inet_server_addr()` / `inet_server_port()`。

守卫的诚实边界:它证明的是「后端 socket 长这样」,不是「你在自己机器上」;
且证明与动作分属两个 psql 进程,天然 TOCTOU。详见 `identity.mjs` 头部注释。

## 证据来源与脱敏

形状来自 2026-07-15 一次性只读生产目录 preflight(v3,SHA-256 `4A87CE02…`,生产 PostgreSQL 17.6)。
原始快照存放在仓库之外(`E:\pg17-stargaze-test\preflight-prod.json`),**永不入 git**。

本目录只保留脱敏后的结构事实(`expected-catalog.json`,由白名单字段生成):

| 保留 | 不保留 |
|---|---|
| 列 / 类型 / 默认值 / 非空 | 例程体(function body) |
| 约束定义 / validated 标志 | 策略表达式文本 |
| 索引定义 | 角色成员图谱(role membership) |
| RLS 标志、策略**元数据**(条数/命令/角色/permissive/是否有 using·check) | 应用行负载 |
| relation ACL / default ACL | |

- 策略断言只比对元数据,不比对表达式;fixture 里的策略表达式全部从**本仓库自有迁移**
  (`006` / `002_complete_setup` / `20260714_canvases`)重新推导,不是从生产复制。
- `auth.uid()` 与 `update_updated_at_column()` 是按公开行为自写的等价实现。
- 历史行全部人工编造(`*.example.invalid`),证据采集本身也从未读过应用行。

## 为什么不能回放迁移文件

生产形状**无法**由 `supabase/migrations` 回放得到,已实证漂移:

| 项 | `006_generations_table.sql` 声明 | 生产实测 |
|---|---|---|
| `type`/`source`/`status`/`created_at` | NOT NULL | 可空 |
| `valid_type` / `valid_status` | 存在 | **不存在** |
| `user_id` 外键 | `ON DELETE CASCADE` | **无删除动作** |
| 索引 | 6 个(user_id/type/status/source/created_at/user_created) | **一个都没有** |
| 策略 | 5 条 | **仅 1 条**(无 TO ⇒ PUBLIC 的 `FOR ALL USING (true)`) |

且生产既无 `model_id` 也无 `contract_id` ⇒ `008` 未生效,该表也不是由 `001`/`002` 建成
(那两个文件的 CREATE TABLE 都带 `model_id`/`contract_id`)。
`20260702_studio_foundation.sql` 第 4 行亦明文记载「生产库与迁移文件已漂移」。

**结论:目录证据是唯一事实源,fixture 按证据重建,不按文件回放。**

## 忠实保留的关键事实(直接影响 Batch 2 设计)

1. `generations.duration` 为 **integer**(后来的 `ADD COLUMN IF NOT EXISTS duration TEXT` 未改变既有类型)。
2. `008` 未生效 ⇒ 无 `model_id` / `final_prompt`。
3. `20260715_generations_service_role_policy.sql` **未生效** ⇒ `generations` 仍是 PUBLIC 的
   `FOR ALL USING (true)` 单策略(匿名可见 30839 行的发布阻断项)。

   **该迁移即便执行也修不好这个阻断项 —— 需上会裁决。**
   实测策略名是 **`allow_all`**,而不是 `006` 里的 `"Service can manage all generations"`。
   而该迁移的第一句是:

   ```sql
   DROP POLICY IF EXISTS "Service can manage all generations" ON public.generations;
   ```

   名字对不上 ⇒ 这是**空操作**;随后它新建一条 `TO service_role` 的策略,
   `allow_all` 原封不动活着。permissive 策略之间是 **OR** 关系,
   所以匿名**依然**能看到全部 30839 行。该迁移的注释("The policy created by 006
   had no TO clause")也建立在错误前提上:生产这条策略根本不是 006 建的。

   修复须**显式** `DROP POLICY IF EXISTS "allow_all"`(并以实测策略清单复核,
   而非以迁移文件的命名假设复核)。`verify-canvas-p1-fixture.mjs` 的 gate 2
   对此有钉死断言。
4. `valid_source` 为 **NOT VALID** ⇒ 只约束新行,容忍历史违规行。Batch 2 的新不变量若不条件化,
   会把这类历史行变成不可读/不可更新。
5. **`service_role` 持有 BYPASSRLS**(实测)⇒ 账本 append-only 守卫**必须**用 TRIGGER 之类
   不可绕过的机制;RLS 对 service_role 无效。
6. `public` schema 的 **default ACL** 会给 `anon`/`authenticated` 自动授予新表的全部 8 项权限
   —— 这正是四张目标表上 anon 各持 8 项权限的来源。Batch 2 新建 `generation_quota_buckets`
   若不显式 REVOKE,会**自动**被授权。fixture 必须复现 default ACL,否则
   「配额桶无 anon/authenticated 权限」会变成空断言(vacuous pass)。
7. `profiles.credits` 非主键/唯一键、不被任何外键引用 ⇒ `FOR NO KEY UPDATE` 合法;
   `profiles.id` 是主键且被 11 条入向外键引用 ⇒ 外键插入取 `KEY SHARE`,与之兼容。

## 与生产的刻意差异(已记录,非疏漏)

- 角色一律 NOLOGIN 无密码;`supabase_admin` 只作为 default ACL 属主存在,不给 LOGIN/SUPERUSER。
- `authenticator` 角色与 role membership 图谱不复制(敏感且本批次不需要)。
- 本地 `postgres` 是超级用户,生产 `postgres` **不是**超级用户(但持有 BYPASSRLS)。
  涉及「超级用户能否绕过」的断言必须用 `SET ROLE` 到非超级用户主体求证。
- 入向外键桩表(`admin_audit_logs` / `blueprints` / `contracts` / `quick_gen_history` /
  `recipes` / `system_settings`)只建与外键相关的最小列,不代表其真实生产形状。
- 运行时 **17.10**,生产 **17.6**。仅用于形状/DDL/ACL/RLS/约束/幂等证据;
  **不构成**生产锁与并发语义的等价证明(17.7/17.8/17.10 修过并发更新/行锁可见性行为)。
  最终并发证据需隔离的同版本 Supabase 环境,或生产升级到已评审的小版本后重采证据。
