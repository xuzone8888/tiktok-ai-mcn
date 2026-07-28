#!/usr/bin/env node
/**
 * Canvas P1 selective-history fixture — hard-coded identity + fail-closed guard.
 *
 * 本模块是 fixture 的唯一连接入口。任何破坏性操作(DROP SCHEMA / 重建)必须先经
 * assertFixtureIdentity() 证明:主机 = 127.0.0.1、端口 = 54329、当前库 = 硬编码的
 * fixture 库名。任一条件不满足或无法证明 => 立即抛错(fail closed),绝不动作。
 *
 * 安全铁律:
 * - 绝不持久化密码。认证完全交给 libpq 既有机制(pgpass/环境),psql 一律带
 *   --no-password;认证失败即 fail closed。本文件不读、不写、不回显任何凭据。
 * - 维护连接(postgres 库)只跑两件事:CREATE DATABASE,以及集群级角色脚本
 *   (该脚本自带 guard-cluster.sql 的 host/port 守卫)。此连接上永不 DROP。
 * - 破坏性操作只在 fixture 库内进行,且以 current_database() 为准绳。
 *
 * 守卫能证明什么、不能证明什么(诚实边界):
 * - inet_server_addr()/inet_server_port() 由**后端**求值,反映真实 socket,
 *   因此能挡住 PGHOSTADDR / PGSERVICE 这类把 -h 架空的环境重定向。
 * - 它证明的是「后端自己的 socket 长这样」,而非「你在自己机器上」。
 *   若有隧道/池化器终结在远端、且远端本地恰有同名库跑在 127.0.0.1:54329,
 *   三项断言会同时成立。属刻意记录的残余边界。
 * - 证明与动作是两个 psql 进程 => 天然 TOCTOU。同 argv/env 下实践稳定,
 *   但这是「邻接证明」,不是「对执行动作的那条连接的证明」。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/** 本地官方解包的 PostgreSQL 17.10 回环集群(已授权用于离线 fixture)。 */
export const FIXTURE_HOST = "127.0.0.1";
export const FIXTURE_PORT = 54329;
/** 硬编码 fixture 库名;绝不参数化,避免误伤其它库。 */
export const FIXTURE_DB = "stargaze_canvas_p1_fixture";
/** 仅用于 CREATE DATABASE/ROLE 的维护库;此连接上永不执行 DROP。 */
export const MAINTENANCE_DB = "postgres";
export const FIXTURE_SUPERUSER = "postgres";

/** 永不允许作为破坏性操作目标的库名。 */
export const FORBIDDEN_TARGET_DBS = Object.freeze([
  "postgres",
  "template0",
  "template1",
]);

/** 生产实测版本(证据快照),与本地运行时版本区分记录,不做并发语义等价宣称。 */
export const PRODUCTION_SERVER_VERSION = "17.6";
export const EXPECTED_LOCAL_MAJOR = 17;

const PSQL_CANDIDATES = [
  process.env.CANVAS_P1_PSQL,
  "E:\\pg17-stargaze-test\\pgsql\\bin\\psql.exe",
  "psql",
].filter(Boolean);

let cachedPsql = null;

/** 定位 psql 可执行文件;找不到即 fail closed。 */
export function resolvePsql() {
  if (cachedPsql) return cachedPsql;
  for (const candidate of PSQL_CANDIDATES) {
    if (candidate === "psql") {
      const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
      if (probe.status === 0) return (cachedPsql = candidate);
      continue;
    }
    if (existsSync(candidate)) return (cachedPsql = candidate);
  }
  throw new Error(
    "FAIL-CLOSED: 未找到 psql 可执行文件。设置 CANVAS_P1_PSQL 指向本地 17.x 的 psql。"
  );
}

/**
 * 执行一段 SQL。永不传递密码;--no-password 让 libpq 既有认证静默生效。
 * @param {{ db: string, sql?: string, file?: string, tuplesOnly?: boolean }} opts
 */
export function psql({ db, sql, file, tuplesOnly = true }) {
  if (!db) throw new Error("FAIL-CLOSED: psql() 必须显式指定数据库,拒绝不确定连接。");
  const args = [
    "--no-password",
    "--no-psqlrc",
    "-h", FIXTURE_HOST,
    "-p", String(FIXTURE_PORT),
    "-U", FIXTURE_SUPERUSER,
    "-d", db,
    "-v", "ON_ERROR_STOP=1",
  ];
  if (tuplesOnly) args.push("-At");
  if (file) args.push("-f", file);
  else args.push("-c", sql);

  const result = spawnSync(resolvePsql(), args, {
    encoding: "utf8",
    env: {
      // 显式不注入任何凭据;继承父环境即可,由用户侧 pgpass/环境决定。
      ...process.env,
      // Windows 控制台默认走 OS 代码页(本机为 GBK),会把 SQL 里的中文字面量
      // ('默认' / '未命名画布')和回读的默认值双向损坏,导致默认值比对假失败。
      // 固定 UTF8 让文件读入与结果输出两侧都稳定。
      PGCLIENTENCODING: "UTF8",
      // 目录渲染对 search_path 敏感,必须钉死:
      //   format_type            -> user_role   vs public.user_role
      //   pg_get_expr            -> 'user'::user_role / uuid_generate_v4()
      //   pg_get_constraintdef   -> REFERENCES profiles(id) vs public.profiles(id)
      // 生产证据是在默认 search_path 下采集的(auth.users 被限定、profiles 未限定即为实证)。
      // 这里显式覆盖 PGOPTIONS:既复现生产的默认路径,又挡掉从父环境继承进来的
      // PGOPTIONS=-c search_path=... —— 否则会一次性打歪约二十条断言,且错因极难定位。
      PGOPTIONS: '-c search_path="$user",public',
    },
  });
  if (result.error) {
    throw new Error(`FAIL-CLOSED: 无法启动 psql: ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

/** 执行并要求成功,否则抛错(含 stderr,便于定位;stderr 不含凭据)。 */
export function psqlOrThrow(opts) {
  const r = psql(opts);
  if (r.status !== 0) {
    throw new Error(
      `FAIL-CLOSED: psql 退出码 ${r.status}\n${r.stderr || r.stdout}`
    );
  }
  return r;
}

/**
 * 只读身份探测:返回 { database, user, host, port, version, versionNum }。
 * 认证失败/无法证明地址端口 => 抛错。
 */
export function probeIdentity(db) {
  const r = psql({
    db,
    sql:
      "SELECT current_database() || '|' || current_user || '|' || " +
      "coalesce(host(inet_server_addr()), '') || '|' || " +
      "coalesce(inet_server_port()::text, '') || '|' || " +
      "current_setting('server_version') || '|' || current_setting('server_version_num');",
  });
  if (r.status !== 0) {
    throw new Error(
      `FAIL-CLOSED: 身份探测失败(认证或连接不可用),不执行任何操作。\n${r.stderr || r.stdout}`
    );
  }
  const [database, user, host, port, version, versionNum] = r.stdout.split("|");
  // 显式拒绝「证明不出来」的情形,而不是依赖 Number('') === 0 这种巧合失败。
  // 走 unix socket 时 inet_server_addr()/inet_server_port() 为 NULL,
  // coalesce 后是空串 => 这里必须判定为不可证明。
  if (!database || !host || !port || !/^\d+$/.test(port)) {
    throw new Error(
      "FAIL-CLOSED: 无法从后端证明库名/地址/端口(可能是 unix socket 连接),拒绝操作。"
    );
  }
  return {
    database,
    user,
    host,
    port: Number(port),
    version,
    versionNum: Number(versionNum),
  };
}

/**
 * 破坏性操作前置断言。必须证明:回环主机 + 精确端口 + 精确 fixture 库名。
 * 任一项无法证明 => 抛错。
 * @param {{ allowDestructive?: boolean }} opts
 */
export function assertFixtureIdentity(db, { allowDestructive = false } = {}) {
  const id = probeIdentity(db);

  if (id.host !== FIXTURE_HOST) {
    throw new Error(
      `FAIL-CLOSED: 服务器地址 ${id.host || "(未知)"} != ${FIXTURE_HOST}。拒绝操作。`
    );
  }
  if (id.port !== FIXTURE_PORT) {
    throw new Error(
      `FAIL-CLOSED: 服务器端口 ${id.port || "(未知)"} != ${FIXTURE_PORT}。拒绝操作。`
    );
  }
  if (id.database !== db) {
    throw new Error(
      `FAIL-CLOSED: 实际连接库 ${id.database} != 请求库 ${db}。拒绝操作。`
    );
  }
  if (allowDestructive) {
    // 先查黑名单再查白名单。二者在当前常量下逻辑冗余,但这道冗余是有意的:
    // 万一将来有人把 FIXTURE_DB 改成 'postgres'/'template1',白名单会放行,
    // 黑名单仍然拦得住。顺序反过来这道防线就失效了。
    if (FORBIDDEN_TARGET_DBS.includes(id.database)) {
      throw new Error(
        `FAIL-CLOSED: ${id.database} 属于禁止目标(维护库/模板库)。拒绝操作。`
      );
    }
    if (id.database !== FIXTURE_DB) {
      throw new Error(
        `FAIL-CLOSED: 破坏性操作目标必须是 ${FIXTURE_DB},实际为 ${id.database}。拒绝操作。`
      );
    }
  }
  if (!Number.isFinite(id.versionNum) || Math.floor(id.versionNum / 10000) !== EXPECTED_LOCAL_MAJOR) {
    throw new Error(
      `FAIL-CLOSED: 本地服务器主版本非 ${EXPECTED_LOCAL_MAJOR}(实测 ${id.version})。拒绝操作。`
    );
  }
  return id;
}
