#!/usr/bin/env node
/**
 * 20260810 迁移的本地行为验收(PGlite,真 Postgres 引擎)
 *
 * ## 为什么需要它
 *
 * 画布的本地 dev 与生产**共用同一个 Supabase**,所以「先在本地库试一次」是不存在的 ——
 * 试就是改生产。而 `CREATE FUNCTION` 对 plpgsql 函数体只做词法检查:列名写错、
 * LATERAL/UNION 构造不合法、真实 jsonb 形状不对,统统要等真实用户触发才炸,
 * 症状是保存 500(比原来的 422 更难诊断),而且同样触发粘性暂停。
 *
 * 这个脚本在内存里起一个真 Postgres(PGlite),按生产列结构建最小 schema,
 * 把迁移原文喂进去,再用真实形状的行跑正反用例。**它不连生产、不需要任何凭证。**
 *
 * 用法:node scripts/verify-canvas-readiness-migration.mjs
 * 依赖:npm i --no-save @electric-sql/pglite
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = path.join(
  ROOT,
  "supabase/migrations/20260810_canvas_media_readiness_history_assets.sql"
);
const REGISTRY = path.join(
  ROOT,
  "supabase/migrations/20260801_canvas_upload_registry.sql"
);

const USER = "2cca16b7-2751-4afb-8369-e516b82a3a9c";
const OTHER = "11111111-2222-3333-4444-555555555555";
const HOST = "https://media.toryxai.com";

/** 从 20260801 里原样抠出归属校验函数 —— 它是本次判定的第一道分支,不能用近似实现。 */
function extractOwnedKeyFn() {
  const sql = fs.readFileSync(REGISTRY, "utf8").replace(/\r\n/g, "\n");
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.canvas_owned_media_key_v1("
  );
  if (start < 0) throw new Error("找不到 canvas_owned_media_key_v1 定义");
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error("canvas_owned_media_key_v1 定义未闭合");
  return sql.slice(start, end + 4);
}

/** 迁移里 GRANT/REVOKE 与后置断言依赖 Supabase 的角色,本地建出来即可。 */
const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS auth;
-- 主闸头一件事就是校验 auth.role();本地固定成 service_role,与服务端调用方一致。
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
AS $fn$ SELECT 'service_role'::text $fn$;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END;
$roles$;

-- 最小 schema:只建被闸门读到的表与列,列类型照生产。
CREATE TABLE public.canvases (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  rev bigint NOT NULL,
  doc jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.canvas_upload_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  object_key text NOT NULL,
  status text NOT NULL,
  orphaned_at timestamptz,
  purge_lease_token uuid,
  purge_lease_expires_at timestamptz,
  last_referenced_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE public.generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text,
  type text,
  output_oss_key text,
  output_url text,
  result_url text,
  video_url text,
  image_url text
);

CREATE TABLE public.blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_type text NOT NULL,
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  product jsonb,
  scenes jsonb NOT NULL DEFAULT '[]'::jsonb,
  globals jsonb NOT NULL DEFAULT '{}'::jsonb
);
`;

const db = new PGlite();
const fail = [];
const pass = [];

function check(name, ok, extra) {
  (ok ? pass : fail).push(extra ? `${name} — ${extra}` : name);
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${extra ? ` — ${extra}` : ""}`);
}

async function ready(keys, { canvasId = null, baseRev = null } = {}) {
  const res = await db.query(
    "SELECT public.assert_canvas_media_keys_ready_v1($1::uuid, $2::uuid, $3::bigint, $4::text[]) AS r",
    [USER, canvasId, baseRev, keys]
  );
  return res.rows[0].r;
}

console.log("== 1. 建 schema 与归属校验函数 ==");
await db.exec(BOOTSTRAP);
await db.exec(extractOwnedKeyFn());
console.log("  ✅ bootstrap 完成");

console.log("\n== 2. 执行迁移原文(等价于在 dashboard 里粘贴执行)==");
const migrationSql = fs.readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");
try {
  await db.exec(migrationSql);
  console.log("  ✅ 迁移执行成功(含末尾 DO 后置断言)");
} catch (error) {
  console.error("  ❌ 迁移执行失败:", error.message);
  process.exit(1);
}

console.log("\n== 3. 灌入真实形状的数据 ==");
// 蓝图:与生产实测形状一致(product.images[] 与 scenes[].slot.asset_ref 存同一个完整 URL)
const bpImage = `products/${USER}/1783008777483-470t8y3t.webp`;
await db.query(
  `INSERT INTO public.blueprints (user_id, source_type, source_ref, product, scenes, globals)
   VALUES ($1, 'product_images', '{}'::jsonb, $2::jsonb, $3::jsonb, '{}'::jsonb)`,
  [
    USER,
    JSON.stringify({ title: "鞋", images: [`${HOST}/${bpImage}`] }),
    JSON.stringify([
      { idx: 0, slot: { kind: "product_image", asset_ref: `${HOST}/${bpImage}` } },
    ]),
  ]
);
// 蓝图:reference_video 才把 source_ref.url 当媒体载体
const refVideo = `videos/${USER}/ref-clip.mp4`;
await db.query(
  `INSERT INTO public.blueprints (user_id, source_type, source_ref)
   VALUES ($1, 'reference_video', $2::jsonb)`,
  [USER, JSON.stringify({ url: `${HOST}/${refVideo}` })]
);
// 非 reference_video 的 source_ref.url —— 面板不吐,闸门也不该认
const nonRefUrl = `videos/${USER}/not-a-carrier.mp4`;
await db.query(
  `INSERT INTO public.blueprints (user_id, source_type, source_ref)
   VALUES ($1, 'product_link', $2::jsonb)`,
  [USER, JSON.stringify({ url: `${HOST}/${nonRefUrl}` })]
);
// 别人的蓝图,同形状 key
const otherKey = `products/${OTHER}/other.webp`;
await db.query(
  `INSERT INTO public.blueprints (user_id, source_type, source_ref, product)
   VALUES ($1, 'product_images', '{}'::jsonb, $2::jsonb)`,
  [OTHER, JSON.stringify({ images: [`${HOST}/${otherKey}`] })]
);
// 幻灯片:completed、owner 路径、无 output_oss_key —— 生产实测存在 5 条这种
const slideshow = `videos/slideshow/${USER}/deadbeef.mp4`;
await db.query(
  `INSERT INTO public.generations (user_id, status, type, output_url, result_url, video_url)
   VALUES ($1, 'completed', 'video', $2, $2, $2)`,
  [USER, `${HOST}/${slideshow}`]
);
// 画布自己的产物:有 output_oss_key(走原分支③)
const canvasKey = `images/${USER}/canvas-abc.jpg`;
await db.query(
  `INSERT INTO public.generations (user_id, status, type, output_oss_key, output_url, image_url)
   VALUES ($1, 'completed', 'image', $2, $3, $3)`,
  [USER, canvasKey, `${HOST}/${canvasKey}`]
);
// 未完成的生成 —— 不该被放行
const pendingKey = `videos/${USER}/still-running.mp4`;
await db.query(
  `INSERT INTO public.generations (user_id, status, type, output_url)
   VALUES ($1, 'processing', 'video', $2)`,
  [USER, `${HOST}/${pendingKey}`]
);
// 右边界用例:存的是更长的 key
const longer = `images/${USER}/boundary.png.bak`;
await db.query(
  `INSERT INTO public.blueprints (user_id, source_type, source_ref)
   VALUES ($1, 'reference_video', $2::jsonb)`,
  [USER, JSON.stringify({ url: `${HOST}/${longer}` })]
);
// 登记表与文档:验证原有三条分支没被破坏
const reservedKey = `images/${USER}/reserved-ready.jpg`;
await db.query(
  `INSERT INTO public.canvas_upload_reservations (user_id, object_key, status)
   VALUES ($1, $2, 'ready')`,
  [USER, reservedKey]
);
const pendingReserved = `images/${USER}/reserved-pending.jpg`;
await db.query(
  `INSERT INTO public.canvas_upload_reservations (user_id, object_key, status)
   VALUES ($1, $2, 'pending')`,
  [USER, pendingReserved]
);
const inDocKey = `images/${USER}/already-in-doc.jpg`;
const CANVAS_ID = "d154b6ed-a812-45ad-9f26-c1a93b828842";
await db.query(
  `INSERT INTO public.canvases (id, user_id, rev, doc)
   VALUES ($1::uuid, $2, 7, $3::jsonb)`,
  [
    CANVAS_ID,
    USER,
    JSON.stringify({ nodes: [{ id: "n1", data: { media: { ossKey: inDocKey } } }] }),
  ]
);
console.log("  ✅ 数据就绪");

console.log("\n== 4. 新分支:面板给得出的素材必须放行 ==");
check("蓝图 product.images[] 的图", (await ready([bpImage])).ok);
check("蓝图 scenes[].slot.asset_ref 的图", (await ready([bpImage])).ok);
check(
  "reference_video 的 source_ref.url",
  (await ready([refVideo])).ok
);
check(
  "🔴 幻灯片视频(completed 但无 output_oss_key)",
  (await ready([slideshow])).ok,
  "这条是对抗审查查出的、初版会漏的缺口"
);

console.log("\n== 5. 原有三条分支不得回归 ==");
check("登记表 status=ready", (await ready([reservedKey])).ok);
check(
  "登记表 status=pending 仍被拒",
  (await ready([pendingReserved])).rejected?.[0]?.reason === "not_ready"
);
check(
  "文档里已存在的 key(需带 canvasId/baseRev)",
  (await ready([inDocKey], { canvasId: CANVAS_ID, baseRev: 7 })).ok
);
check("generations.output_oss_key", (await ready([canvasKey])).ok);

console.log("\n== 6. 负控:不该放行的一律拒 ==");
const unrefer = `images/${USER}/never-referenced.jpg`;
check(
  "从未被任何来源引用的 key",
  (await ready([unrefer])).rejected?.[0]?.reason === "not_ready"
);
check(
  "他人 uid 的 key(归属分支应先拦)",
  (await ready([otherKey])).rejected?.[0]?.reason === "not_owned"
);
check(
  "未完成生成的 URL",
  (await ready([pendingKey])).rejected?.[0]?.reason === "not_ready"
);
check(
  "非 reference_video 的 source_ref.url(面板不吐,闸门也不该认)",
  (await ready([nonRefUrl])).rejected?.[0]?.reason === "not_ready"
);
check(
  "右边界:存 boundary.png.bak 不得放行 boundary.png",
  (await ready([`images/${USER}/boundary.png`])).rejected?.[0]?.reason ===
    "not_ready"
);
check(
  "左边界:xproducts/… 不得误配 products/…",
  (
    await (async () => {
      await db.query(
        `INSERT INTO public.blueprints (user_id, source_type, source_ref)
         VALUES ($1, 'reference_video', $2::jsonb)`,
        [USER, JSON.stringify({ url: `${HOST}/xproducts/${USER}/edge.webp` })]
      );
      return ready([`products/${USER}/edge.webp`]);
    })()
  ).rejected?.[0]?.reason === "not_ready"
);

console.log("\n== 7. 批量与边界 ==");
const batch = await ready([bpImage, slideshow, canvasKey, unrefer]);
check(
  "混合批次只拒该拒的那一个",
  batch.ok === false &&
    batch.rejected.length === 1 &&
    batch.rejected[0].objectKey === unrefer
);
check("空数组", (await ready([])).ok);

console.log("\n" + "=".repeat(56));
if (fail.length) {
  console.log(`❌ ${fail.length} 条未通过 / 共 ${pass.length + fail.length} 条`);
  fail.forEach((f) => console.log("   - " + f));
  process.exit(1);
}
console.log(`✅ 全部 ${pass.length} 条通过`);
