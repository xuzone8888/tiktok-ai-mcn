/**
 * D1 本地可重复验证:20260714_canvases.sql 结构自校 + doc-limits 体积契约测试。
 *
 *   node scripts/verify-canvas-migration.mjs
 *
 * 两段:
 *   ① SQL 结构自校(离线,无需 DB):必备列/RLS/四策略/索引/NOTIFY/体积注释齐全。
 *   ② doc-limits 契约(离线,typescript 剥类型后跑):512KB 软告警 / 2MB 硬闸 / 边界 / 不可序列化。
 *
 * 可选③ 真 Postgres 语法校验(默认跳过,绝不碰生产):
 *   仅当显式设置 `CANVAS_VERIFY_PG_URL` 指向一次性本地库时启用。事务内先建最小桩
 *   (auth.uid()/public.profiles/pgcrypto)再跑迁移,**结束一律 ROLLBACK**,不落任何行。
 *   URL 主机必须严格等于 localhost / 127.0.0.1 / ::1,其余一律拒跑。生产迁移
 *   永远由用户经 Supabase dashboard 手动执行(铁律 §六)。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadCanvasModule } from "./canvas-build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SQL_PATH = join(ROOT, "supabase", "migrations", "20260714_canvases.sql");
const GENERATIONS_POLICY_PATH = join(
  ROOT,
  "supabase",
  "migrations",
  "20260715_generations_service_role_policy.sql"
);
const GENERATIONS_BASE_PATH = join(ROOT, "supabase", "migrations", "006_generations_table.sql");

let pass = 0;
let fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) {
    pass++;
  } else {
    fail++;
    fails.push(label);
    console.log(`  ❌ ${label}`);
  }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} (expected ${expected}, got ${actual})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ① SQL 结构自校
// ─────────────────────────────────────────────────────────────────────────────
console.log("① 迁移结构自校(20260714_canvases.sql)");
const sql = readFileSync(SQL_PATH, "utf8");
const generationsPolicySql = readFileSync(GENERATIONS_POLICY_PATH, "utf8");
const generationsBaseSql = readFileSync(GENERATIONS_BASE_PATH, "utf8");
const sqlNoComments = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

ok(/CREATE TABLE IF NOT EXISTS public\.canvases/i.test(sql), "建表 public.canvases(幂等)");
for (const col of [
  "id",
  "user_id",
  "title",
  "schema_version",
  "doc",
  "deps",
  "rev",
  "writer_tag",
  "writer_heartbeat_at",
  "doc_bytes",
  "share_slug",
  "status",
  "created_at",
  "updated_at",
]) {
  ok(new RegExp(`\\b${col}\\b`).test(sqlNoComments), `列存在:${col}`);
}
ok(/user_id UUID NOT NULL REFERENCES public\.profiles\(id\) ON DELETE CASCADE/i.test(sql), "user_id FK→profiles ON DELETE CASCADE");
ok(/schema_version INTEGER NOT NULL DEFAULT 1/i.test(sql), "schema_version 默认 1");
ok(/doc JSONB NOT NULL DEFAULT '\{"nodes":\[\],"edges":\[\],"groups":\[\]\}'::jsonb/i.test(sql), "doc 默认空拓扑");
ok(/deps JSONB NOT NULL DEFAULT/i.test(sql), "deps 列有默认值");
// 逐键校验五清单默认(全绿≠只查 2 个键——审查实锤:漏查 characters/voices/assets)
for (const depKey of ["models", "voices", "characters", "assets", "recipes"]) {
  ok(new RegExp(`"${depKey}":\\[\\]`).test(sql), `deps 默认含 "${depKey}":[]`);
}
ok(/rev BIGINT NOT NULL DEFAULT 0/i.test(sql), "rev CAS 锚(BIGINT 默认 0)");
ok(/doc_bytes INTEGER/i.test(sql), "doc_bytes 列(体积闸)");
ok(/share_slug TEXT UNIQUE/i.test(sql), "share_slug 唯一(P3 预留)");
ok(/status TEXT NOT NULL DEFAULT 'active' CHECK \(status IN \('active', 'archived'\)\)/i.test(sql), "status CHECK(active/archived)");
ok(/ALTER TABLE public\.canvases ENABLE ROW LEVEL SECURITY/i.test(sql), "启用 RLS");
// 逐策略校验 NAME + 幂等 DROP + **策略体内的属主谓词**(全绿≠只全局查一次 auth.uid()=user_id
// ——审查实锤:若 insert 退化成 WITH CHECK(true) 越权,名字/DROP 仍在、别的策略仍含谓词,旧断言照绿)
const POLICY_CLAUSE = { select: "USING", insert: "WITH\\s+CHECK", update: "USING", delete: "USING" };
for (const [pol, clause] of Object.entries(POLICY_CLAUSE)) {
  ok(new RegExp(`DROP POLICY IF EXISTS "canvases_${pol}_own"`, "i").test(sql), `幂等 DROP:canvases_${pol}_own`);
  const stmt = sql.match(new RegExp(`CREATE POLICY "canvases_${pol}_own"[\\s\\S]*?;`, "i"))?.[0] ?? "";
  ok(stmt.length > 0, `RLS 策略存在:canvases_${pol}_own`);
  ok(
    new RegExp(`${clause}\\s*\\(\\s*auth\\.uid\\(\\)\\s*=\\s*user_id\\s*\\)`, "i").test(stmt),
    `RLS 策略 canvases_${pol}_own 的 ${clause.replace("\\s+", " ")} 谓词=auth.uid()=user_id(逐策略体校验)`
  );
}
const updatePolicy = sql.match(/CREATE POLICY "canvases_update_own"[\s\S]*?;/i)?.[0] ?? "";
ok(
  /WITH\s+CHECK\s*\(\s*auth\.uid\(\)\s*=\s*user_id\s*\)/i.test(updatePolicy),
  "RLS UPDATE 显式 WITH CHECK=auth.uid()=user_id"
);
ok(/CREATE INDEX IF NOT EXISTS idx_canvases_user_updated/i.test(sql), "最近编辑索引(user_id,updated_at DESC)");
ok(/on public\.canvases\(user_id, updated_at DESC\)/i.test(sql), "索引列序 user_id, updated_at DESC");
ok(/NOTIFY pgrst, 'reload schema'/i.test(sql), "结尾 NOTIFY pgrst 重载 schema(仓库惯例)");
ok(/524288|512KB/.test(sql), "软告警数值 524288/512KB 注释在案");
ok(/2097152|2MB/i.test(sql), "硬拒数值 2097152/2MB 注释在案");
ok(/COMMENT ON TABLE public\.canvases/i.test(sql), "表注释在案");
// 分号计数:粗校语句完整性(不含结尾多余空语句)
const stmtCount = sqlNoComments.split(";").map((s) => s.trim()).filter((s) => s.length > 0).length;
ok(stmtCount >= 10, `语句数合理(${stmtCount} ≥ 10)`);

console.log("D1 generations RLS follow-up migration");
ok(
  /DROP POLICY IF EXISTS "Service can manage all generations" ON public\.generations\s*;/i.test(
    generationsPolicySql
  ),
  "repair migration drops the legacy unscoped service policy"
);
const generationsServicePolicy = generationsPolicySql.match(
  /CREATE POLICY "Service can manage all generations"[\s\S]*?;/i
)?.[0] ?? "";
ok(generationsServicePolicy.length > 0, "repair migration recreates the service policy");
ok(
  /FOR ALL\s+TO service_role\s+USING\s*\(\s*true\s*\)\s+WITH CHECK\s*\(\s*true\s*\)/i.test(
    generationsServicePolicy
  ),
  "recreated generations policy is scoped only to service_role"
);
ok(
  !/\bTO\s+(?:PUBLIC|authenticated)\b/i.test(generationsServicePolicy),
  "repair migration does not preserve a public or authenticated service policy"
);
ok(
  !/DROP POLICY[^;]+Users can (?:view|insert|update) own generations/i.test(generationsPolicySql),
  "repair migration leaves authenticated own-row policies intact"
);
for (const policyName of [
  "Users can view own generations",
  "Users can insert own generations",
  "Users can update own generations",
]) {
  ok(
    new RegExp(`CREATE POLICY "${policyName}" ON public\\.generations`, "i").test(generationsBaseSql),
    `base migration still defines authenticated own policy: ${policyName}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ② doc-limits 体积契约
// ─────────────────────────────────────────────────────────────────────────────
console.log("② doc-limits 体积契约(src/lib/canvas/doc-limits.ts)");
const dl = await loadCanvasModule("doc-limits");
const {
  DOC_BYTES_HARD_LIMIT,
  DOC_JSONB_WARN_LIMIT,
  computeDocBytes,
  checkDocSize,
  formatBytes,
} = dl;

eq(DOC_BYTES_HARD_LIMIT, 2097152, "硬闸常量 = 2097152 (2MB)");
eq(DOC_JSONB_WARN_LIMIT, 524288, "告警闸常量 = 524288 (512KB)");

// 字节计算与 TextEncoder 一致(含非 ASCII)
const sample = { nodes: [], edges: [], groups: [], t: "中文·mix" };
eq(computeDocBytes(sample), new TextEncoder().encode(JSON.stringify(sample)).length, "computeDocBytes == TextEncoder 字节");

// 空默认文档:远低于硬闸,ok
const emptyDoc = { nodes: [], edges: [], groups: [] };
const rEmpty = checkDocSize(emptyDoc);
ok(rEmpty.ok && !rEmpty.overHardLimit && !rEmpty.overWarnLimit, "空文档:ok 且不触闸");
eq(rEmpty.message, null, "空文档:message 为 null");
eq(rEmpty.serializable, true, "空文档:可序列化");

// 告警边界:恰好 512KB 不告警;+1 仅告警、不拒存
const overhead = computeDocBytes({ big: "" }); // {"big":""} 的字节数
const padTo = (target) => ({ big: "x".repeat(Math.max(0, target - overhead)) });
const atWarn = checkDocSize(padTo(DOC_JSONB_WARN_LIMIT));
ok(!atWarn.overWarnLimit && atWarn.ok, "恰好 512KB:不告警(严格 >)");
const overWarn = checkDocSize(padTo(DOC_JSONB_WARN_LIMIT + 1));
ok(overWarn.overWarnLimit && !overWarn.overHardLimit && overWarn.ok, "512KB+1:仅软告警");
ok(typeof overWarn.message === "string" && overWarn.message.includes("建议拆分"), "软告警有建议拆分文案");

// 512KB~2MB 之间:告警但仍可保存
const rMid = checkDocSize(padTo(1024 * 1024)); // 1MB
ok(!rMid.overHardLimit && rMid.overWarnLimit && rMid.ok, "1MB:软告警但允许保存");

// 硬闸边界:恰好 2MB 仍可保存;+1 拒存
const atHard = checkDocSize(padTo(DOC_BYTES_HARD_LIMIT));
ok(!atHard.overHardLimit && atHard.overWarnLimit && atHard.ok, "恰好 2MB:告警但不拒(严格 >)");
const overHard = checkDocSize(padTo(DOC_BYTES_HARD_LIMIT + 1));
ok(overHard.overHardLimit && overHard.overWarnLimit && !overHard.ok, "2MB+1:硬拒存");
ok(typeof overHard.message === "string" && overHard.message.includes("上限"), "硬拒有上限文案");

// 不可序列化(循环引用):拒存
const circular = {};
circular.self = circular;
const rCirc = checkDocSize(circular);
ok(!rCirc.serializable && rCirc.overHardLimit && !rCirc.ok, "循环引用:不可序列化 → 拒存");
eq(computeDocBytes(circular), Number.POSITIVE_INFINITY, "循环引用:字节 = Infinity");

// formatBytes 展示
ok(formatBytes(524288) === "512.0KB", `formatBytes(524288)=${formatBytes(524288)}`);
ok(formatBytes(2097152) === "2.00MB", `formatBytes(2097152)=${formatBytes(2097152)}`);

// ─────────────────────────────────────────────────────────────────────────────
// ③ 可选:真 Postgres 语法校验(默认跳过,绝不碰生产)
// ─────────────────────────────────────────────────────────────────────────────
function isLoopbackPgUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

ok(isLoopbackPgUrl("postgres://u:p@localhost:5432/db"), "PG 白名单:localhost");
ok(isLoopbackPgUrl("postgresql://u:p@127.0.0.1/db"), "PG 白名单:127.0.0.1");
ok(isLoopbackPgUrl("postgres://u:p@[::1]:5432/db"), "PG 白名单:::1");
ok(!isLoopbackPgUrl("postgres://u:p@127.0.0.2/db"), "PG 白名单拒绝其他 127/8 地址");
ok(!isLoopbackPgUrl("postgres://u:p@db.internal/db"), "PG 白名单拒绝任意内网主机");
ok(!isLoopbackPgUrl("postgres://u:p@example.supabase.co/db"), "PG 白名单拒绝远端主机");
ok(!isLoopbackPgUrl("not-a-url"), "PG 白名单拒绝非法 URL");

const PG_URL = process.env.CANVAS_VERIFY_PG_URL;
if (!PG_URL) {
  console.log(
    "③ 真 PG 语法校验:跳过(设 CANVAS_VERIFY_PG_URL=一次性本地库 可开启完整语法校验;生产迁移永远经 dashboard 手动执行)"
  );
} else if (!isLoopbackPgUrl(PG_URL)) {
  console.log("③ 真 PG 语法校验:拒跑 —— CANVAS_VERIFY_PG_URL 不是严格 loopback 地址");
  ok(false, "真 PG:非 loopback URL 必须拒跑");
} else {
  console.log("③ 真 PG 语法校验(事务内跑,结束 ROLLBACK,不落行)");
  try {
    const { Client } = (await import("pg")).default ?? (await import("pg"));
    const client = new Client({ connectionString: PG_URL });
    await client.connect();
    try {
      await client.query("begin");
      // 最小桩:让 FK/RLS/gen_random_uuid 可解析(全部随 ROLLBACK 消失)
      await client.query("create extension if not exists pgcrypto");
      await client.query("create schema if not exists auth");
      await client.query("create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$");
      await client.query("create table if not exists public.profiles (id uuid primary key)");
      await client.query(sql);
      await client.query("rollback");
      ok(true, "真 PG:迁移在事务内成功执行并已回滚");
    } catch (e) {
      await client.query("rollback").catch(() => {});
      ok(false, `真 PG:执行失败 → ${e.message}`);
    } finally {
      await client.end();
    }
  } catch (e) {
    ok(false, `真 PG:连接失败 → ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n结果:${pass} 通过,${fail} 失败`);
if (fail > 0) {
  console.log("失败项:\n  - " + fails.join("\n  - "));
  process.exit(1);
}
console.log("✅ D1 本地验证全绿");
