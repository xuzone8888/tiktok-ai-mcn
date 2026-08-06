#!/usr/bin/env node
/**
 * Canvas P1 selective-history fixture builder.
 *
 * 用法:
 *   node scripts/fixtures/canvas-p1/build.mjs            # 建/重建 fixture
 *   node scripts/fixtures/canvas-p1/build.mjs --shape    # 只建形状,不灌历史行
 *
 * 分两个连接阶段,职责严格分离:
 *   A. 维护连接(postgres 库):只允许 CREATE ROLE / CREATE DATABASE,**永不 DROP**。
 *   B. fixture 连接:先证明 host/port/库名,再做破坏性重建(仅限本库的 schema)。
 *
 * 认证:一律 --no-password,交给 libpq 既有机制;失败即 fail closed。
 * 本模块不读、不写、不回显、不持久化任何密码。
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXTURE_DB,
  MAINTENANCE_DB,
  PRODUCTION_SERVER_VERSION,
  assertFixtureIdentity,
  probeIdentity,
  psql,
  psqlOrThrow,
} from "./identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(__dirname, "sql");

/** 阶段 A:集群角色 + fixture 库存在性。此连接永不 DROP。 */
function ensureClusterAndDatabase(log) {
  // 维护连接也要证明是本地回环集群,但不允许破坏性动作。
  const id = assertFixtureIdentity(MAINTENANCE_DB, { allowDestructive: false });
  log(`maintenance conn: ${id.database} @ ${id.host}:${id.port} (PostgreSQL ${id.version})`);

  psqlOrThrow({ db: MAINTENANCE_DB, file: join(SQL_DIR, "00-cluster-roles.sql") });
  log("cluster roles ensured (anon / authenticated / service_role / supabase_admin)");

  const exists = psqlOrThrow({
    db: MAINTENANCE_DB,
    sql: `SELECT 1 FROM pg_database WHERE datname = '${FIXTURE_DB}';`,
  }).stdout.trim();

  if (exists !== "1") {
    // CREATE 是此连接上唯一允许的写动作。
    //
    // TEMPLATE template0 + C locale 是必需的,不是讲究:
    // 本机是 Windows 11 中文版,若 initdb 未显式指定编码/区域,template1 会是
    // WIN936 / Chinese (Simplified)_China.936。此时只写 ENCODING='UTF8' 会直接报
    // 「new encoding (UTF8) is incompatible with the encoding of the template database」。
    // template0 允许自由指定编码/区域,而 C 区域与任何编码都兼容 => 确定性建库。
    // 区域不影响目录形状断言(列上没有显式 collation,索引定义也不含 COLLATE 子句)。
    psqlOrThrow({
      db: MAINTENANCE_DB,
      sql:
        `CREATE DATABASE ${FIXTURE_DB} WITH OWNER = postgres ` +
        `TEMPLATE = template0 ENCODING = 'UTF8' LC_COLLATE = 'C' LC_CTYPE = 'C';`,
    });
    log(`created database ${FIXTURE_DB}`);
  } else {
    log(`database ${FIXTURE_DB} already exists (will rebuild its schemas in place)`);
  }
}

/** 阶段 B:在 fixture 库内重建 schema。破坏性,受身份守卫保护。 */
function rebuildFixture({ withRows = true } = {}, log) {
  const id = assertFixtureIdentity(FIXTURE_DB, { allowDestructive: true });
  log(`fixture conn: ${id.database} @ ${id.host}:${id.port} (PostgreSQL ${id.version})`);

  // 05 自带同样的守卫 DO 块:即便有人绕过 JS 直接 psql -f,也仍 fail closed。
  psqlOrThrow({ db: FIXTURE_DB, file: join(SQL_DIR, "05-db-bootstrap.sql") });
  log("bootstrap applied (schemas / extension / default ACL / auth stub / enum / trigger fn)");

  psqlOrThrow({ db: FIXTURE_DB, file: join(SQL_DIR, "10-live-shape.sql") });
  log("live shape applied (4 targets + 6 incoming-FK stubs + RLS + policies)");

  if (withRows) {
    psqlOrThrow({ db: FIXTURE_DB, file: join(SQL_DIR, "20-legacy-rows.sql") });
    log("synthetic legacy rows loaded");
  }

  return id;
}

/**
 * 建/重建 fixture,返回运行时版本信息。
 * @param {{ withRows?: boolean, log?: (m: string) => void }} opts
 */
export function buildFixture({ withRows = true, log = () => {} } = {}) {
  ensureClusterAndDatabase(log);
  const id = rebuildFixture({ withRows }, log);
  return {
    localVersion: id.version,
    localVersionNum: id.versionNum,
    productionVersion: PRODUCTION_SERVER_VERSION,
    // 明确不做并发/锁语义等价宣称。
    // 版本号必须由实测值插值得到:早前这里把「本地 17.10」写死在字符串里,
    // 换成 17.9 的集群时,打印出来的「证据」会睁眼说瞎话,而 gate6 照样通过。
    parityClaim:
      `本地 ${id.version} 仅用于形状/DDL/ACL/RLS/约束/幂等证据;` +
      `不构成生产 ${PRODUCTION_SERVER_VERSION} 的锁与并发语义等价证明。`,
  };
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const withRows = !process.argv.includes("--shape");
  try {
    const info = buildFixture({ withRows, log: (m) => console.log(`  ${m}`) });
    console.log("");
    console.log(`fixture ready: ${FIXTURE_DB}`);
    console.log(`  local runtime : PostgreSQL ${info.localVersion}`);
    console.log(`  production    : PostgreSQL ${info.productionVersion} (证据快照)`);
    console.log(`  parity        : ${info.parityClaim}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
