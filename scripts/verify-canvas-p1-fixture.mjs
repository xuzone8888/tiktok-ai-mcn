#!/usr/bin/env node
/**
 * Canvas P1 Batch 1B — selective-history fixture 聚焦验证器。
 *
 * 针对已授权的本地官方解包 PostgreSQL 17.10 回环集群(127.0.0.1:54329)执行。
 * 绝不连接生产、绝不使用生产凭据、绝不重跑生产 preflight。
 * 认证一律 --no-password,交给 libpq 既有机制;失败即 fail closed 并退出非零。
 *
 * 六道 gate:
 *   1. 在真实 PostgreSQL 17.10 上干净建出 fixture;
 *   2. 目录断言与「脱敏生产证据 + selective-history 规则」逐项一致;
 *   3. 合成历史行可装载且可读;
 *   4. 确定性、幂等的重建/重跑;
 *   5. 错误 host/port/库身份 与 蓄意 schema 漂移 均 fail closed;
 *   6. 输出如实记录本地 17.10 vs 生产 17.6,不做并发/锁等价宣称。
 *
 * 退出非零即失败,并打印精确 PASS/FAIL/TOTAL。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFixture } from "./fixtures/canvas-p1/build.mjs";
import {
  FIXTURE_DB,
  FIXTURE_HOST,
  FIXTURE_PORT,
  MAINTENANCE_DB,
  PRODUCTION_SERVER_VERSION,
  assertFixtureIdentity,
  probeIdentity,
  psql,
  psqlOrThrow,
  resolvePsql,
} from "./fixtures/canvas-p1/identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures", "canvas-p1");
const SQL_DIR = join(FIXTURE_DIR, "sql");

const expected = JSON.parse(
  readFileSync(join(FIXTURE_DIR, "expected-catalog.json"), "utf8")
);

let passed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) passed += 1;
  else failures.push(label);
}

function eq(actual, expectedValue, label) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expectedValue),
    `${label} (expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual)})`
  );
}

/** 键序稳定的规范化 JSON,供多重集比对。 */
function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * 确定性快照:json_agg 的数组顺序依赖扫描顺序,跨重建不保证稳定,
 * 直接比对原文会假阳性。故对每个 section 的数组按规范化字符串排序后再比对 ——
 * 顺序无关,但内容仍是逐项精确的。
 */
function stableSnapshot(shape) {
  const out = {};
  for (const key of Object.keys(shape).sort()) {
    const value = shape[key];
    out[key] = Array.isArray(value) ? value.map(canon).sort() : value;
  }
  return canon(out);
}

/**
 * 真·多重集差异(按出现次数计数,不是集合成员判定)。
 *
 * 早前的实现用 includes() 判成员,重数只靠总长度兜底 —— 那是集合比对。
 * 「重数互换但总数不变」的漂移会整个漏掉:例如删掉一条 credit_transactions 的
 * admin SELECT 策略、同时多出一条 profiles SELECT 策略,总数仍是 11,
 * 集合比对全绿,而一条管理员可见性策略已经无声消失。
 * 现在按 (项 -> 次数) 计数比对,重数差异必被抓到。
 */
function diffMultiset(actualArr, expectedArr) {
  const count = (arr) => {
    const m = new Map();
    for (const x of arr.map(canon)) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const a = count(actualArr);
  const e = count(expectedArr);
  const missing = [];
  const extra = [];
  for (const [k, n] of e) {
    const got = a.get(k) ?? 0;
    if (got < n) missing.push(`${k} ×${n - got}`);
  }
  for (const [k, n] of a) {
    const want = e.get(k) ?? 0;
    if (n > want) extra.push(`${k} ×${n - want}`);
  }
  return { missing, extra, actualLen: actualArr.length, expectedLen: expectedArr.length };
}

/** 多重集比对:数量、缺失、多余都要报出来。 */
function compareMultiset(actualArr, expectedArr, label) {
  const d = diffMultiset(actualArr, expectedArr);
  eq(d.actualLen, d.expectedLen, `${label}: 行数`);
  ok(d.missing.length === 0, `${label}: 缺失 ${d.missing.length} 项 -> ${d.missing.slice(0, 3).join(" | ")}`);
  ok(d.extra.length === 0, `${label}: 多余 ${d.extra.length} 项 -> ${d.extra.slice(0, 3).join(" | ")}`);
}

/** 读取 fixture 当前目录形状。 */
function introspect() {
  const r = psqlOrThrow({
    db: FIXTURE_DB,
    file: join(SQL_DIR, "catalog-introspect.sql"),
  });
  return JSON.parse(r.stdout);
}

/** 把自省的扁平 ACL 行折叠成 expected-catalog.json 的嵌套形状。 */
function foldRelationAcl(rows) {
  const m = {};
  for (const r of rows) ((m[r.table] ??= {})[r.grantee] ??= []).push(r.privilege);
  return Object.keys(m)
    .sort()
    .map((t) => ({
      table: t,
      grants: Object.keys(m[t])
        .sort()
        .map((g) => ({ grantee: g, privileges: m[t][g].sort() })),
    }));
}

function foldDefaultAcl(rows) {
  const m = {};
  for (const r of rows) {
    // 用 JSON 做键,无损往返:schema 可能为 null(全局 default ACL),
    // 字符串拼接会把 null 变成 "null",且理论上可被含分隔符的名字歧义分割。
    const key = JSON.stringify([r.owner, r.schema ?? null, r.object_type]);
    ((m[key] ??= {})[r.grantee] ??= []).push(r.privilege);
  }
  return Object.keys(m)
    .map((key) => {
      const [owner, schema, object_type] = JSON.parse(key);
      return {
        owner,
        schema,
        object_type,
        grants: Object.keys(m[key])
          .sort()
          .map((g) => ({ grantee: g, privileges: m[key][g].sort() })),
      };
    })
    .sort((a, b) => (a.owner + a.object_type).localeCompare(b.owner + b.object_type));
}

function scalar(sql) {
  return psqlOrThrow({ db: FIXTURE_DB, sql }).stdout.trim();
}

/**
 * 「进程真的跑起来了,并以非零退出」。
 * 不能只写 status !== 0:spawnSync 在 ENOENT(psql 根本没启动)时 status 为 null,
 * 而 null !== 0 为真 —— 那会把「压根没执行」误判成「守卫成功拦截」,是空断言。
 */
function exitedNonZero(result) {
  return typeof result.status === "number" && result.status !== 0;
}

function main() {
  // =========================================================================
  // Gate 1 —— 在真实 PostgreSQL 17.10 上干净建出 fixture
  // =========================================================================
  const info = buildFixture({ withRows: true, log: () => {} });
  ok(
    /^17\./.test(info.localVersion),
    `gate1: 本地运行时为 PostgreSQL 17.x(实测 ${info.localVersion})`
  );
  // 用 probeIdentity(纯只读、不抛身份错)来断言,而不是 assertFixtureIdentity ——
  // 后者一旦不匹配就直接抛,断言便永远为真(空断言)。这里要的是可失败的断言。
  const id = probeIdentity(FIXTURE_DB);
  eq(id.database, FIXTURE_DB, "gate1: 连接库为硬编码 fixture 库");
  eq(id.host, FIXTURE_HOST, "gate1: 主机为 127.0.0.1");
  eq(id.port, FIXTURE_PORT, "gate1: 端口为 54329");
  // 建成后四张目标表必须真的存在(证明 gate1 不是「没抛异常」的同义反复)
  eq(
    scalar(
      "SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
        "WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN " +
        "('profiles','generations','credit_transactions','canvases');"
    ),
    "4",
    "gate1: 四张目标表已建出"
  );

  // =========================================================================
  // Gate 2 —— 目录断言 vs 脱敏生产证据
  // =========================================================================
  const actual = introspect();

  compareMultiset(actual.columns, expected.columns, "gate2: columns");
  compareMultiset(actual.constraints, expected.constraints, "gate2: constraints");
  compareMultiset(actual.indexes, expected.indexes, "gate2: indexes");
  compareMultiset(actual.relations, expected.relations, "gate2: relations");
  compareMultiset(actual.policies, expected.policies, "gate2: policies");
  compareMultiset(
    foldRelationAcl(actual.relation_acl),
    expected.relation_acl,
    "gate2: relation_acl"
  );
  compareMultiset(
    foldDefaultAcl(actual.default_acl),
    expected.default_acl,
    "gate2: default_acl"
  );
  compareMultiset(
    actual.incoming_foreign_keys,
    expected.incoming_foreign_keys,
    "gate2: incoming_foreign_keys"
  );
  compareMultiset(
    actual.profile_key_columns,
    expected.profile_key_columns,
    "gate2: profile_key_columns"
  );
  compareMultiset(actual.triggers, expected.triggers, "gate2: triggers(非内部)");

  // 计数复核(与证据文件记录的 71/16/15/11/128/11/6/1 对齐)
  eq(actual.columns.length, expected.counts.columns, "gate2: 列数 = 71");
  eq(actual.constraints.length, expected.counts.constraints, "gate2: 约束数 = 16");
  eq(actual.indexes.length, expected.counts.indexes, "gate2: 索引数 = 15");
  eq(actual.policies.length, expected.counts.policies, "gate2: 策略数 = 11");
  eq(
    actual.relation_acl.length,
    expected.counts.relation_acl_rows,
    "gate2: relation ACL 行数 = 128"
  );
  eq(
    actual.incoming_foreign_keys.length,
    expected.counts.incoming_foreign_keys,
    "gate2: profiles 入向外键 = 11"
  );
  eq(
    foldDefaultAcl(actual.default_acl).length,
    expected.counts.default_acl,
    "gate2: default ACL 条目 = 6"
  );
  eq(
    actual.triggers.length,
    expected.counts.non_internal_triggers,
    "gate2: 非内部触发器 = 1"
  );

  // --- selective-history 规则(逐条断言,不能靠上面的整体比对含混带过) ---
  const gencols = actual.columns.filter((c) => c.table === "generations");
  const dur = gencols.find((c) => c.name === "duration");
  eq(dur?.type, "integer", "gate2/选择性历史: generations.duration 为 integer(非 text)");
  ok(
    !gencols.some((c) => c.name === "model_id"),
    "gate2/选择性历史: 008 未生效 —— 无 model_id"
  );
  ok(
    !gencols.some((c) => c.name === "final_prompt"),
    "gate2/选择性历史: 008 未生效 —— 无 final_prompt"
  );

  const genPolicies = actual.policies.filter((p) => p.table === "generations");
  eq(genPolicies.length, 1, "gate2/选择性历史: generations 仅 1 条策略");
  eq(genPolicies[0]?.command, "*", "gate2/选择性历史: 该策略为 FOR ALL");
  eq(genPolicies[0]?.roles, ["PUBLIC"], "gate2/选择性历史: 20260715 未生效 —— 角色仍是 PUBLIC 而非 service_role");
  eq(genPolicies[0]?.using_is_literal_true, true, "gate2/选择性历史: USING 为字面 true(匿名可见阻断项)");
  eq(genPolicies[0]?.has_check, false, "gate2/选择性历史: 该策略无 WITH CHECK");
  // 名字是实锤,不是细节:实测名为 "allow_all",而非 006 声明的
  // "Service can manage all generations"。
  // 后果:20260715 的 DROP POLICY IF EXISTS "Service can manage all generations"
  // 在生产是空操作,"allow_all" 会活下来;permissive 策略 OR 合并 =>
  // 该迁移**修不好**它自称要修的匿名可见阻断项。此断言把这一事实钉死。
  eq(genPolicies[0]?.name, "allow_all", "gate2/选择性历史: 实测策略名为 allow_all(非 006 的命名)");
  ok(
    genPolicies[0]?.name !== "Service can manage all generations",
    "gate2/发布阻断: 20260715 的 DROP 目标名与实测名不符 => 该迁移无法移除 allow_all"
  );

  const validSource = actual.constraints.find((c) => c.name === "valid_source");
  eq(validSource?.validated, false, "gate2/选择性历史: valid_source 为 NOT VALID");
  ok(
    /batch_video%/.test(validSource?.definition ?? ""),
    "gate2/选择性历史: valid_source 含 batch_video% 通配分支"
  );
  ok(
    !actual.constraints.some((c) => c.name === "valid_type" || c.name === "valid_status"),
    "gate2/选择性历史: 生产实测无 valid_type / valid_status(006 文件声明过,但未生效)"
  );

  const ctType = actual.constraints.find((c) => c.name === "credit_transactions_type_check");
  ok(
    !/consume/.test(ctType?.definition ?? ""),
    "gate2/选择性历史: credit_transactions type CHECK 不含 'consume'(与冻结契约表述相悖,以实测为准)"
  );

  const genFk = actual.constraints.find((c) => c.name === "generations_user_id_fkey");
  ok(
    !/ON DELETE/.test(genFk?.definition ?? ""),
    "gate2/选择性历史: generations_user_id_fkey 无 ON DELETE 动作(006 文件写的 CASCADE 未生效)"
  );

  // FOR NO KEY UPDATE 兼容性:credits 必须是非键列
  const credits = actual.profile_key_columns.find((c) => c.column === "credits");
  eq(credits?.primary_or_unique, false, "gate2/锁契约: profiles.credits 非主键/唯一键");
  eq(
    credits?.referenced_by_foreign_key,
    false,
    "gate2/锁契约: profiles.credits 不被任何外键引用 => FOR NO KEY UPDATE 合法"
  );
  const pid = actual.profile_key_columns.find((c) => c.column === "id");
  eq(pid?.primary_or_unique, true, "gate2/锁契约: profiles.id 为主键/唯一键");
  eq(pid?.referenced_by_foreign_key, true, "gate2/锁契约: profiles.id 被外键引用");

  // RLS 标志
  for (const r of actual.relations) {
    eq(r.rls_enabled, true, `gate2: ${r.name} RLS 已启用`);
    eq(r.rls_forced, false, `gate2: ${r.name} RLS 未 forced`);
  }

  // default ACL 必须真的把 anon/authenticated 自动授到新表上,
  // 否则 Stage 2 的「配额桶无 anon/authenticated 权限」会变成空断言。
  const tableDefaultAcl = foldDefaultAcl(actual.default_acl).filter(
    (d) => d.object_type === "r"
  );
  ok(
    tableDefaultAcl.length > 0 &&
      tableDefaultAcl.every((d) =>
        ["anon", "authenticated"].every((g) =>
          d.grants.some((x) => x.grantee === g && x.privileges.length === 8)
        )
      ),
    "gate2: public schema 的表默认 ACL 会给 anon/authenticated 自动授予 8 项权限"
  );

  // =========================================================================
  // Gate 3 —— 合成历史行装载且可读
  // =========================================================================
  eq(scalar("SELECT count(*)::text FROM public.generations;"), "6", "gate3: generations 历史行 6 条");
  eq(scalar("SELECT count(*)::text FROM public.credit_transactions;"), "8", "gate3: 账本历史行 8 条");
  eq(scalar("SELECT count(*)::text FROM public.canvases;"), "2", "gate3: canvases 历史行 2 条");
  eq(scalar("SELECT count(*)::text FROM public.profiles;"), "3", "gate3: profiles 3 条");
  eq(
    scalar(
      "SELECT duration::text FROM public.generations WHERE id = 'a1111111-0000-4000-8000-000000000001';"
    ),
    "5",
    "gate3: integer duration 可读回"
  );
  eq(
    scalar(
      "SELECT source FROM public.generations WHERE id = 'a1111111-0000-4000-8000-000000000006';"
    ),
    "legacy_unlisted_source",
    "gate3: NOT VALID 容忍的历史违规 source 行仍可读"
  );
  eq(
    scalar(
      "SELECT credits::text FROM public.profiles WHERE id = '11111111-1111-4111-8111-111111111111';"
    ),
    "550",
    "gate3: profiles.credits 与账本终值一致"
  );
  // 账本连续性:每行 balance_after = balance_before + amount
  eq(
    scalar(
      "SELECT count(*)::text FROM public.credit_transactions WHERE balance_after <> balance_before + amount;"
    ),
    "0",
    "gate3: 账本 balance_after = balance_before + amount 全部连续"
  );
  // 历史行在 Stage 2 加上 action_id 后必须全部是 null-action 行
  eq(
    scalar(
      "SELECT count(*)::text FROM information_schema.columns WHERE table_schema='public' AND table_name='generations' AND column_name='action_id';"
    ),
    "0",
    "gate3: Stage 1 尚未引入 action_id(Stage 2 的加法迁移才引入)"
  );

  // =========================================================================
  // Gate 4 —— 确定性、幂等
  // =========================================================================
  const snapshot1 = stableSnapshot(introspect());
  buildFixture({ withRows: true, log: () => {} });
  const snapshot2 = stableSnapshot(introspect());
  ok(snapshot1 === snapshot2, "gate4: 重建后目录形状完全一致(确定性)");

  // 历史行脚本重跑不得重复插入
  psqlOrThrow({ db: FIXTURE_DB, file: join(SQL_DIR, "20-legacy-rows.sql") });
  psqlOrThrow({ db: FIXTURE_DB, file: join(SQL_DIR, "20-legacy-rows.sql") });
  eq(scalar("SELECT count(*)::text FROM public.generations;"), "6", "gate4: 历史行脚本重跑后仍是 6 条(幂等)");
  eq(scalar("SELECT count(*)::text FROM public.credit_transactions;"), "8", "gate4: 账本重跑后仍是 8 条(幂等)");
  const snapshot3 = stableSnapshot(introspect());
  ok(snapshot2 === snapshot3, "gate4: 历史行重跑不改变目录形状");

  // =========================================================================
  // Gate 5 —— 身份错误 / 蓄意漂移 均 fail closed
  // =========================================================================
  // 5a. JS 守卫:破坏性操作指向维护库必须抛错
  let threw = null;
  try {
    assertFixtureIdentity(MAINTENANCE_DB, { allowDestructive: true });
  } catch (e) {
    threw = e.message;
  }
  ok(
    threw != null && /FAIL-CLOSED/.test(threw),
    "gate5: 破坏性操作指向 postgres 维护库 -> fail closed"
  );

  // 5b. SQL 守卫打到错误的库上必须失败(guard.sql 自身无副作用,安全可测)
  const wrongDbGuard = psql({ db: MAINTENANCE_DB, file: join(SQL_DIR, "guard.sql") });
  ok(exitedNonZero(wrongDbGuard), "gate5: guard.sql 在非 fixture 库上退出非零");
  ok(/FAIL-CLOSED/.test(wrongDbGuard.stderr), "gate5: guard.sql 明确报出 FAIL-CLOSED 原因");

  // 5c. 同一守卫打到 fixture 库上必须通过(证明 5b 不是恒失败的假阳性)
  const rightDbGuard = psql({ db: FIXTURE_DB, file: join(SQL_DIR, "guard.sql") });
  eq(rightDbGuard.status, 0, "gate5: guard.sql 在 fixture 库上通过(守卫非恒失败)");

  // 5c-2. 集群守卫在本地集群上必须通过(它只校验 host/port,不校验库名,
  //       因此在维护库上也应通过 —— 这正是角色脚本能用它的原因)
  const clusterGuardFixture = psql({ db: FIXTURE_DB, file: join(SQL_DIR, "guard-cluster.sql") });
  eq(clusterGuardFixture.status, 0, "gate5: guard-cluster.sql 在本地集群通过");
  const clusterGuardMaint = psql({ db: MAINTENANCE_DB, file: join(SQL_DIR, "guard-cluster.sql") });
  eq(clusterGuardMaint.status, 0, "gate5: guard-cluster.sql 不校验库名(维护库上亦通过)");

  // 5c-3. 结构性回归守卫:每个会写入的 SQL 文件都必须先 \ir 某个守卫。
  //       这是对「新增脚本忘记加守卫」这一具体缺陷的防回归 ——
  //       角色脚本一旦无守卫地手跑到生产,会把 service_role 改成 NOLOGIN。
  //       注:这是对**产物结构**的断言,不用作运行时语义的证据。
  const WRITING_SQL = ["00-cluster-roles.sql", "05-db-bootstrap.sql", "10-live-shape.sql", "20-legacy-rows.sql"];
  for (const name of WRITING_SQL) {
    const src = readFileSync(join(SQL_DIR, name), "utf8");
    const guardIdx = src.search(/\\ir\s+guard(-cluster)?\.sql/);
    const firstWrite = src.search(
      /^\s*(DROP|CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)\b/im
    );
    ok(guardIdx >= 0, `gate5: ${name} 引入了守卫`);
    ok(
      guardIdx >= 0 && (firstWrite < 0 || guardIdx < firstWrite),
      `gate5: ${name} 的守卫位于首个写语句之前`
    );
    ok(/ON_ERROR_STOP/.test(src), `gate5: ${name} 设了 ON_ERROR_STOP(手跑时不会带伤继续)`);
  }

  // 5d. 不指定库必须拒绝,不允许「未指定连接」
  let noDbThrew = null;
  try {
    psql({ db: "", sql: "SELECT 1;" });
  } catch (e) {
    noDbThrew = e.message;
  }
  ok(noDbThrew != null && /FAIL-CLOSED/.test(noDbThrew), "gate5: 未指定库的连接被拒绝");

  // 5e. 错误端口不得静默回退到其它实例
  const wrongPort = spawnSync(
    resolvePsql(),
    ["--no-password", "--no-psqlrc", "-h", FIXTURE_HOST, "-p", "1", "-U", "postgres",
     "-d", FIXTURE_DB, "-At", "-c", "SELECT 1;"],
    { encoding: "utf8" }
  );
  ok(exitedNonZero(wrongPort), "gate5: 错误端口连接失败,无静默回退");

  // 5f. 蓄意 schema 漂移必须被 gate2 的断言抓到(证明断言非空转)
  psqlOrThrow({
    db: FIXTURE_DB,
    sql: "ALTER TABLE public.generations ALTER COLUMN duration TYPE text USING duration::text;",
  });
  const drifted = introspect();
  const driftedDur = drifted.columns.find(
    (c) => c.table === "generations" && c.name === "duration"
  );
  ok(driftedDur?.type === "text", "gate5: 漂移已注入(duration -> text)");
  // 必须用 gate2 实际使用的那个比对器来证明「断言非空转」。
  // 早前这里比的是 canon(数组) 的字符串,而 canon 对数组保序、json_agg 又是扫描序,
  // 于是该断言恒为真 —— 它本该证明比对器有效,却根本没调用那个比对器。
  const driftDiff = diffMultiset(drifted.columns, expected.columns);
  ok(
    driftDiff.missing.length > 0 && driftDiff.extra.length > 0,
    `gate5: gate2 的同一比对器检出了漂移(缺失 ${driftDiff.missing.length} / 多余 ${driftDiff.extra.length}),证明其非空转`
  );
  // 且必须精确指向被改坏的那一列,而不是「有差异就算数」
  ok(
    driftDiff.extra.some((x) => /"name":"duration"/.test(x) && /"type":"text"/.test(x)),
    "gate5: 比对器精确指出 duration 变成了 text"
  );
  // 再建一次,确认能恢复到期望形状
  buildFixture({ withRows: true, log: () => {} });
  const restored = introspect();
  compareMultiset(restored.columns, expected.columns, "gate5: 重建后形状恢复");

  // =========================================================================
  // Gate 6 —— 版本如实记录,不做等价宣称
  // =========================================================================
  // 与字面量 "17.6" 比,而不是与导入的同一个常量比 ——
  // 后者是 build.mjs 里的同一个绑定,恒等,永远不会失败。
  eq(info.productionVersion, "17.6", "gate6: 记录的生产版本正是证据快照中的 17.6");
  eq(restored.server_version, info.localVersion, "gate6: 本地版本取自实测,而非写死常量");
  ok(
    info.localVersion !== info.productionVersion,
    `gate6: 如实记录版本差异(本地 ${info.localVersion} != 生产 ${info.productionVersion})`
  );
  // parityClaim 必须引用**实测**的本地版本号:写死版本号会让证据说谎。
  ok(
    info.parityClaim.includes(info.localVersion),
    `gate6: 免责声明引用实测本地版本 ${info.localVersion}(非写死)`
  );
  ok(
    info.parityClaim.includes("17.6") && /不构成/.test(info.parityClaim),
    "gate6: 明确声明不构成生产 17.6 的锁/并发等价证明"
  );

  console.log("");
  console.log(`local runtime : PostgreSQL ${info.localVersion}`);
  console.log(`production    : PostgreSQL ${info.productionVersion}(只读证据快照)`);
  console.log(`parity        : ${info.parityClaim}`);
  console.log("");
  for (const f of failures) console.log(`FAIL: ${f}`);
  console.log("");
  const total = passed + failures.length;
  console.log(`P1 fixture verifier: PASS ${passed} / FAIL ${failures.length} / TOTAL ${total}`);
  if (failures.length > 0) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.log(
    `P1 fixture verifier: PASS ${passed} / FAIL ${failures.length + 1} / TOTAL ${passed + failures.length + 1}`
  );
  process.exit(1);
}
