/**
 * D1 本地可重复验证:20260714_canvases.sql 结构自校 + doc-limits 体积契约测试。
 *
 *   node scripts/verify-canvas-migration.mjs
 *
 * 两段:
 *   ① SQL 结构自校(离线,无需 DB):必备列/RLS/四策略/索引/NOTIFY/体积注释齐全。
 *   ② doc-limits 契约(离线,typescript 剥类型后跑):512KB 硬闸 / 2MB 告警 / 边界 / 不可序列化。
 *
 * 可选③ 真 Postgres 语法校验(默认跳过,绝不碰生产):
 *   仅当显式设置 `CANVAS_VERIFY_PG_URL` 指向一次性本地库时启用。事务内先建最小桩
 *   (auth.uid()/public.profiles/pgcrypto)再跑迁移,**结束一律 ROLLBACK**,不落任何行。
 *   URL 命中生产标记(supabase.co / 已知 project ref)一律拒跑。生产迁移永远由用户
 *   经 Supabase dashboard 手动执行(铁律 §六)。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadCanvasModule } from "./canvas-build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SQL_PATH = join(ROOT, "supabase", "migrations", "20260714_canvases.sql");

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
ok(/CREATE INDEX IF NOT EXISTS idx_canvases_user_updated/i.test(sql), "最近编辑索引(user_id,updated_at DESC)");
ok(/on public\.canvases\(user_id, updated_at DESC\)/i.test(sql), "索引列序 user_id, updated_at DESC");
ok(/NOTIFY pgrst, 'reload schema'/i.test(sql), "结尾 NOTIFY pgrst 重载 schema(仓库惯例)");
ok(/524288|512KB/.test(sql), "体积闸数值 524288/512KB 注释在案");
ok(/COMMENT ON TABLE public\.canvases/i.test(sql), "表注释在案");
// 分号计数:粗校语句完整性(不含结尾多余空语句)
const stmtCount = sqlNoComments.split(";").map((s) => s.trim()).filter((s) => s.length > 0).length;
ok(stmtCount >= 10, `语句数合理(${stmtCount} ≥ 10)`);

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

eq(DOC_BYTES_HARD_LIMIT, 524288, "硬闸常量 = 524288 (512KB)");
eq(DOC_JSONB_WARN_LIMIT, 2097152, "告警闸常量 = 2097152 (2MB)");

// 字节计算与 TextEncoder 一致(含非 ASCII)
const sample = { nodes: [], edges: [], groups: [], t: "中文·mix" };
eq(computeDocBytes(sample), new TextEncoder().encode(JSON.stringify(sample)).length, "computeDocBytes == TextEncoder 字节");

// 空默认文档:远低于硬闸,ok
const emptyDoc = { nodes: [], edges: [], groups: [] };
const rEmpty = checkDocSize(emptyDoc);
ok(rEmpty.ok && !rEmpty.overHardLimit && !rEmpty.overWarnLimit, "空文档:ok 且不触闸");
eq(rEmpty.message, null, "空文档:message 为 null");
eq(rEmpty.serializable, true, "空文档:可序列化");

// 硬闸边界:恰好 524288 字节不算超;+1 算超
const overhead = computeDocBytes({ big: "" }); // {"big":""} 的字节数
const padTo = (target) => ({ big: "x".repeat(Math.max(0, target - overhead)) });
const atLimit = padTo(DOC_BYTES_HARD_LIMIT);
eq(computeDocBytes(atLimit), DOC_BYTES_HARD_LIMIT, "构造 == 硬闸字节");
const rAt = checkDocSize(atLimit);
ok(!rAt.overHardLimit && rAt.ok, "恰好 524288:不拒(严格 >)");
const rOver = checkDocSize(padTo(DOC_BYTES_HARD_LIMIT + 1));
ok(rOver.overHardLimit && !rOver.ok, "524289:超硬闸 → 拒存");
ok(typeof rOver.message === "string" && rOver.message.length > 0, "超硬闸:有中文拒存文案");

// 告警闸:>2MB 同时超硬闸与告警闸
const rWarn = checkDocSize(padTo(DOC_JSONB_WARN_LIMIT + 1));
ok(rWarn.overWarnLimit, "2MB+:overWarnLimit=true");
ok(rWarn.overHardLimit, "2MB+:亦超硬闸(数值张力已在契约文档标注)");

// 512KB~2MB 之间:超硬闸但未到告警闸
const rMid = checkDocSize(padTo(1024 * 1024)); // 1MB
ok(rMid.overHardLimit && !rMid.overWarnLimit, "1MB:超硬闸、未到 2MB 告警");

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
const PG_URL = process.env.CANVAS_VERIFY_PG_URL;
const PROD_MARKERS = ["supabase.co", "supabase.com", "hfabrifuvujpdzarlbky", "pooler.supabase"];
if (!PG_URL) {
  console.log(
    "③ 真 PG 语法校验:跳过(设 CANVAS_VERIFY_PG_URL=一次性本地库 可开启完整语法校验;生产迁移永远经 dashboard 手动执行)"
  );
} else if (PROD_MARKERS.some((m) => PG_URL.includes(m))) {
  console.log(`③ 真 PG 语法校验:拒跑 —— CANVAS_VERIFY_PG_URL 命中生产标记,本机绝不对生产执行迁移`);
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
