#!/usr/bin/env node
/**
 * Canvas P1 · Batch 2 · runtime runner.
 *
 * Executes the real PostgreSQL scenarios. Nothing here runs unless the caller
 * explicitly asks for runtime mode AND -- for the Preview Branch -- the target
 * guard's read-only identity/version/zero-data/exact-catalog gate has passed.
 *
 * The gate is not advisory: target.runWrite() refuses any remote write for a
 * target that has not been gated, so there is no code path (including a future
 * careless edit here) that can apply SQL to the branch without it.
 *
 * Results are counted executed/passed/failed/skipped separately and are never
 * merged with the offline guard/static counts.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PsqlSession,
  buildConcurrentSessionSchedule,
  openSessions,
} from "./session.mjs";
import { REGISTRY, SCENARIOS } from "./scenarios.mjs";
import { diffAgainstAllowlist, scanRepository } from "./callsites.mjs";
import { loadPostApplyManifest, loadPreApplyManifest, loadReapplyManifest } from "./manifests.mjs";
import {
  PROBE_TABLES,
  REQUIRED_POST_APPLY_SECTIONS,
  TargetRefusal,
  assertPostApplyCatalog,
  assertRemotePostApplyWriteAllowed,
  assertRemoteWriteAllowed,
  canon,
  compareCatalogSections,
  readCatalog,
  runReadOnlyProbe,
  runWrite,
  sectionDigest,
  sha256Hex,
} from "./target.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS = join(REPO_ROOT, "supabase", "migrations");
const ALLOWLIST_PATH = join(__dirname, "callsite-allowlist.json");

/**
 * Exact byte identities authorized for the Preview Branch migration batch.
 * A changed file is a different migration and cannot be executed until this
 * reviewed lock list is deliberately updated.
 */
export const MIGRATION_LOCKS = Object.freeze([
  Object.freeze({
    key: "policy",
    file: "20260715_generations_service_role_policy.sql",
    sha256: "2949cfe12695923fa0c441cb79d82db73abd84225a5b7c3cc348c9876e788555",
  }),
  Object.freeze({
    key: "foundation",
    file: "20260716_canvas_p1_lifecycle_foundation.sql",
    sha256: "c525036a97c01c90bf92a684afae9403c4b02876a4281e298bd22507853594dd",
  }),
  Object.freeze({
    key: "credit",
    file: "20260717_canvas_p1_credit_boundary.sql",
    sha256: "d6d1ad82472806fb3284070cbcdc53267709a4593976b67e1e271c98951814c2",
  }),
  Object.freeze({
    key: "api",
    file: "20260718_canvas_p1_generation_api.sql",
    sha256: "7275f5bb1c3c8e76c94dbcb180e39a679eedfed889806796f76a7eef9d319638",
  }),
  Object.freeze({
    key: "reconcile",
    file: "20260719_canvas_p1_reconciliation.sql",
    sha256: "6bf13cba88842ba173883fd6f0dd7d1d7b4d95cabd72d74e1280000522608524",
  }),
]);

export const MIGRATION_ORDER = Object.freeze(
  MIGRATION_LOCKS.map((entry) => Object.freeze([entry.key, entry.file]))
);

export function verifyMigrationLocks() {
  const failures = [];
  const locked = [];
  for (const entry of MIGRATION_LOCKS) {
    const path = join(MIGRATIONS, entry.file);
    let actual;
    try {
      actual = sha256Hex(readFileSync(path));
    } catch (err) {
      failures.push(`${entry.file}: unreadable (${err.message})`);
      continue;
    }
    if (actual !== entry.sha256) {
      failures.push(`${entry.file}: SHA-256 ${actual}, expected ${entry.sha256}`);
    }
    locked.push(Object.freeze({ ...entry, path, actual }));
  }
  if (failures.length > 0) {
    throw new Error(
      "REFUSED: the locked Canvas P1 migration batch has changed:\n" + failures.join("\n")
    );
  }
  return Object.freeze(locked);
}

/** Execute the reviewed five-file batch as one transaction. */
export function applyLockedMigrations(target) {
  const locks = verifyMigrationLocks();
  return runWrite(target, { files: locks.map((entry) => entry.path) });
}

function catalogDigest(catalog) {
  const sections = Object.keys(catalog).sort();
  return sha256Hex(canon(sections.map((key) => `${key}:${sectionDigest(catalog[key])}`)));
}

function saveCapturedCatalog(dir, name, catalog) {
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  const path = join(dir, name);
  writeFileSync(path, serialized, { encoding: "utf8", flag: "wx" });
  return Object.freeze({
    path,
    sha256: sha256Hex(serialized),
    catalogDigest: catalogDigest(catalog),
    sectionCounts: Object.freeze(
      Object.fromEntries(
        Object.keys(catalog)
          .sort()
          .map((key) => [key, Array.isArray(catalog[key]) ? catalog[key].length : 1])
      )
    ),
  });
}

function assertCapturedCatalogShape(catalog, label) {
  const required = [...REQUIRED_POST_APPLY_SECTIONS].sort();
  const actual = Object.keys(catalog ?? {}).sort();
  const missing = required.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !required.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label} catalog section set is not exact; missing=[${missing.join(",")}], ` +
        `extra=[${extra.join(",")}]`
    );
  }
}

/**
 * Phase 3B only: gate the explicitly declared pre-apply or frozen post-apply
 * Preview state, atomically apply the exact locked batch, capture the redacted
 * catalog, replay the same batch, and capture again. It intentionally runs no
 * ordinary scenario writes.
 */
export async function capturePostApplyEvidence(target, { remoteState } = {}) {
  if (target.mode !== "remote") {
    throw new Error("REFUSED: post-apply evidence capture is remote-Preview-only.");
  }
  if (remoteState !== "preapply" && remoteState !== "postapply") {
    throw new Error(
      "REFUSED: post-apply evidence capture requires explicit remoteState preapply|postapply."
    );
  }

  const gate =
    remoteState === "preapply"
      ? assertRemoteWriteAllowed(target, {
          preApplyManifest: loadPreApplyManifest(),
        })
      : assertRemotePostApplyWriteAllowed(target, {
          postApplyManifest: loadPostApplyManifest(),
        });

  const tempRoot = join(REPO_ROOT, ".temp");
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(join(tempRoot, "canvas-p1-post-apply-"));

  applyLockedMigrations(target);
  const post = readCatalog(target);
  assertCapturedCatalogShape(post, "post-apply");
  const postFile = saveCapturedCatalog(dir, "post-apply.redacted.json", post);

  applyLockedMigrations(target);
  const reapply = readCatalog(target);
  assertCapturedCatalogShape(reapply, "reapply");
  const reapplyFile = saveCapturedCatalog(dir, "reapply.redacted.json", reapply);

  const compared = compareCapturedCatalogs(post, reapply);
  if (compared.mismatches.length > 0) {
    throw new Error(
      "reapply changed the redacted catalog: " + compared.mismatches.join("; ") +
        `. Both captures were retained at ${dir}`
    );
  }

  return Object.freeze({
    gate,
    directory: dir,
    post: postFile,
    reapply: reapplyFile,
    equal: true,
    sectionCount: REQUIRED_POST_APPLY_SECTIONS.length,
  });
}

function compareCapturedCatalogs(post, reapply) {
  const manifest = { sections: post };
  return compareCatalogSections(reapply, manifest, REQUIRED_POST_APPLY_SECTIONS);
}

export function proveRemoteTestTablesEmpty(target) {
  const counts = {};
  for (const table of PROBE_TABLES) {
    const raw = runReadOnlyProbe(target, "table_count", table);
    if (!/^(0|[1-9]\d*)$/.test(raw) || Number(raw) !== 0) {
      throw new Error(
        `post-cleanup public.${table} count is ${JSON.stringify(raw)}, expected exact zero`
      );
    }
    counts[table] = Number(raw);
  }
  const authRaw = runReadOnlyProbe(target, "auth_user_count");
  if (!/^(0|[1-9]\d*)$/.test(authRaw) || Number(authRaw) !== 0) {
    throw new Error(
      `post-cleanup auth.users count is ${JSON.stringify(authRaw)}, expected exact zero`
    );
  }
  counts["auth.users"] = 0;
  return Object.freeze(counts);
}

export function migrationSql(key) {
  const locks = verifyMigrationLocks();
  const entry = locks.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`unknown migration ${key}`);
  return readFileSync(entry.path, "utf8");
}

export function loadCallsiteAllowlist() {
  return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
}

/**
 * Static half of the callsite guard. Runs offline; no database needed.
 *
 * DISCOVERS the mutation surface and diffs it against the frozen reviewed
 * allowlist. The previous implementation only checked that fourteen hard-coded
 * paths still existed, which cannot find a new unreviewed write at all.
 */
export function callsiteGuard(root = REPO_ROOT) {
  return diffAgainstAllowlist(scanRepository(root), loadCallsiteAllowlist());
}

/**
 * ADVERSARIAL PROOF that the guard actually detects an unreviewed callsite.
 *
 * Copies the frozen allowlist next to a DISPOSABLE source fixture in a temp
 * directory, plants a synthetic mutation callsite that is deliberately absent
 * from the allowlist, and requires the guard to report it.
 *
 * This is the difference R70 needs. Calling the guard against the real
 * repository only proves "the current tree matches the current allowlist" --
 * which is exactly what the old broken checker did, and it stays green whether
 * or not the guard can detect anything. Detection has to be demonstrated by
 * actually introducing the thing that must be detected.
 *
 * Nothing is written inside the repository: the fixture lives in the OS temp
 * directory and is removed in a finally block.
 */
export function proveCallsiteGuardDetectsAddition() {
  const dir = mkdtempSync(join(tmpdir(), "canvas-p1-callsite-"));
  try {
    const planted = join(dir, "src", "app", "api", "synthetic", "route.ts");
    mkdirSync(dirname(planted), { recursive: true });

    // A synthetic unreviewed direct credit write, in the exact shape the real
    // unconverted routes use.
    writeFileSync(
      planted,
      [
        "export async function POST() {",
        "  const { error } = await supabase",
        '    .from("profiles")',
        "    .update({ credits: 999999 })",
        '    .eq("id", userId);',
        "  return Response.json({ error });",
        "}",
        "",
      ].join("\n"),
      "utf8"
    );

    const inventory = scanRepository(dir);
    const plantedEntry = inventory.find((i) => i.path === "src/app/api/synthetic/route.ts");
    if (!plantedEntry) {
      throw new Error(
        "the scanner did not discover the planted synthetic credit-mutation callsite; it cannot " +
          "detect a new unreviewed direct write"
      );
    }
    if (!plantedEntry.classes.includes("profile_credit_mutation")) {
      throw new Error(
        `the planted callsite was discovered but misclassified as [${plantedEntry.classes.join(", ")}]`
      );
    }

    // The real frozen allowlist does not review it, so the diff must fail.
    const findings = diffAgainstAllowlist(inventory, loadCallsiteAllowlist());
    const addition = findings.find((f) => f.includes("UNREVIEWED CALLSITE") && f.includes("synthetic"));
    if (!addition) {
      throw new Error(
        "the guard did not report the planted unreviewed callsite as an ADDITION; it cannot fail " +
          "on a new unreviewed mutation path"
      );
    }

    // And the inverse: every real allow-listed path is absent from this
    // fixture tree, so the guard must ALSO report inventory rot. This proves
    // removal detection with the same fixture.
    const rot = findings.filter((f) => f.includes("INVENTORY ROT"));
    if (rot.length === 0) {
      throw new Error(
        "the guard did not report any INVENTORY ROT for allow-listed callsites missing from the " +
          "fixture tree; it cannot fail on a silent removal or rename"
      );
    }

    return { addition, rotCount: rot.length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function lit(v) {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Delete only an explicit, canonical set of harness-owned test user UUIDs.
 *
 * This is shared by normal finally cleanup and interrupted-runtime recovery.
 * The caller cannot supply SQL or a predicate; the exact UUID list is validated
 * before it is embedded in the transaction.
 */
export function buildCleanupSqlForUserIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > SCENARIOS.length) {
    throw new TargetRefusal("REFUSED: cleanup requires 1..77 explicit test user UUIDs");
  }
  const ids = [...new Set(userIds.map((id) => String(id)))];
  if (ids.length !== userIds.length) {
    throw new TargetRefusal("REFUSED: cleanup test user UUIDs must be unique");
  }
  for (const id of ids) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      throw new TargetRefusal(`REFUSED: cleanup encountered a noncanonical test UUID: ${id}`);
    }
  }
  const idList = ids.map(lit).join(",");

  const sql = `
BEGIN;
SET LOCAL lock_timeout = '15s';
ALTER TABLE public.credit_transactions
    DISABLE TRIGGER canvas_p1_credit_transactions_append_only;
DELETE FROM public.generation_quota_buckets WHERE user_id IN (${idList});
DELETE FROM public.credit_transactions WHERE user_id IN (${idList});
ALTER TABLE public.credit_transactions
    ENABLE TRIGGER canvas_p1_credit_transactions_append_only;
DELETE FROM public.generations WHERE user_id IN (${idList});
DELETE FROM public.canvases WHERE user_id IN (${idList});
DELETE FROM public.profiles WHERE id IN (${idList});
DELETE FROM auth.users WHERE id IN (${idList});
DO $canvas_p1_cleanup$
DECLARE
    v_residue bigint;
BEGIN
    SELECT
        (SELECT count(*) FROM public.generation_quota_buckets WHERE user_id IN (${idList})) +
        (SELECT count(*) FROM public.credit_transactions WHERE user_id IN (${idList})) +
        (SELECT count(*) FROM public.generations WHERE user_id IN (${idList})) +
        (SELECT count(*) FROM public.canvases WHERE user_id IN (${idList})) +
        (SELECT count(*) FROM public.profiles WHERE id IN (${idList})) +
        (SELECT count(*) FROM auth.users WHERE id IN (${idList}))
      INTO v_residue;
    IF v_residue <> 0 THEN
        RAISE EXCEPTION
            'canvas-p1 cleanup: % scoped test row(s) remain; rolling back', v_residue;
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_trigger
         WHERE tgrelid = 'public.credit_transactions'::regclass
           AND tgname = 'canvas_p1_credit_transactions_append_only'
           AND tgenabled <> 'D'
    ) THEN
        RAISE EXCEPTION
            'canvas-p1 cleanup: append-only trigger was not restored; rolling back';
    END IF;
END
$canvas_p1_cleanup$;
COMMIT;`;
  return Object.freeze({ ids: Object.freeze(ids), sql });
}

export function cleanupTrackedUserIds(target, userIds) {
  const cleanup = buildCleanupSqlForUserIds(userIds);
  runWrite(target, { sql: cleanup.sql });
  return Object.freeze({ users: cleanup.ids.length, cleaned: true });
}

export async function buildContext(target) {
  const sessions = new Map();
  const opened = new Set();
  const scenarioOpened = new Set();
  const createdUsers = new Set();

  function s(name) {
    if (!sessions.has(name)) {
      const sess = new PsqlSession(target, { name });
      sessions.set(name, sess);
      opened.add(sess);
      // The main session is intentionally reused across the whole suite. It
      // avoids one DNS/TLS handshake per scenario. Barrier sessions are still
      // scenario-scoped so locks and transaction state cannot leak.
      if (name !== "m") scenarioOpened.add(sess);
    }
    return sessions.get(name);
  }

  async function closeSessionSet(sessionSet) {
    const toClose = [...sessionSet];
    sessionSet.clear();
    for (const sess of toClose) {
      opened.delete(sess);
      scenarioOpened.delete(sess);
      for (const [name, cached] of sessions) {
        if (cached === sess) sessions.delete(name);
      }
    }
    const settled = await Promise.allSettled(toClose.map((sess) => sess.close()));
    const failed = settled.filter((item) => item.status === "rejected");
    if (failed.length > 0) {
      throw new Error(
        `${failed.length} psql session(s) failed to close: ${failed[0].reason?.message ?? failed[0].reason}`
      );
    }
  }

  const ctx = {
    target,
    s,

    /**
     * ISOLATION.
     *
     * Set by runRuntime() to the scenario id before each run. Every seeded user
     * is created fresh under the running scenario, so no scenario can observe
     * or be contaminated by another's rows.
     *
     * This exists because the previous suite shared global state and then made
     * GLOBAL assertions over it -- e.g. counting claimable rows across the whole
     * database and requiring zero. That is order-dependent by construction: R45
     * binds a video with next_reconcile_at = now() + 5s and leaves it, so by the
     * time a later scenario ran, that row had become due and appeared in the
     * global count. The scenario that failed was not the one that was broken.
     *
     * The rule this enforces: a scenario may only assert over rows it created.
     * `ctx.ownsGeneration(id)` and the scoped helpers below are how that is done.
     */
    scope: null,

    /**
     * Every generation id this scenario created, in creation order. Scoped
     * assertions filter against this instead of counting the world.
     */
    ownedGenerations: [],

    ownGeneration(id) {
      ctx.ownedGenerations.push(String(id).trim());
      return id;
    },

    ownsGeneration(id) {
      return ctx.ownedGenerations.includes(String(id).trim());
    },
    concurrentRequests(requestCount, prefix, runRequest) {
      if (typeof runRequest !== "function") {
        throw new TypeError("concurrent request runner must be a function");
      }
      const { workerCount, assignments } = buildConcurrentSessionSchedule(requestCount);
      const list = openSessions(target, workerCount, prefix);
      for (const sess of list) {
        opened.add(sess);
        scenarioOpened.add(sess);
      }
      return Promise.all(
        assignments.map((workerIndex, requestIndex) =>
          runRequest(list[workerIndex], requestIndex)
        )
      );
    },
    migrationSql,

    /**
     * Allocate and record a test UUID before any statement can use it.
     *
     * Negative tests also use this path. If a statement that was expected to
     * fail unexpectedly commits, cleanup still owns the exact identity.
     */
    async newTrackedTestUuid() {
      const id = String(await s("m").scalar("SELECT gen_random_uuid()")).trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
        throw new Error(`REFUSED: PostgreSQL returned a noncanonical test UUID: ${id}`);
      }
      createdUsers.add(id);
      return id;
    },

    async applyMigrations() {
      applyLockedMigrations(target);
    },

    /**
     * SHA-256 over EVERY section of the complete Batch 2 catalog surface.
     *
     * Two defects are fixed here. The previous digest covered only six sections
     * (columns/constraints/indexes/policies/relation_acl/triggers) -- so a
     * second apply could change a function ACL, a default ACL, a column grant,
     * a trigger function or the quota table and still be reported as
     * "deterministic". And it returned a canonical STRING rather than a hash,
     * which the write gate then reduced to its LENGTH.
     *
     * Reads through the closed read-only probe channel, so computing a digest
     * cannot itself write.
     */
    async catalogDigest() {
      const j = readCatalog(target);
      return catalogDigest(j);
    },

    /** Frozen manifests. Data, never a caller callback. */
    preApplyManifest: loadPreApplyManifest,
    postApplyManifest: loadPostApplyManifest,
    reapplyManifest: loadReapplyManifest,

    assertPostApply(label) {
      return assertPostApplyCatalog(target, {
        manifest: label === "reapply" ? loadReapplyManifest() : loadPostApplyManifest(),
        label,
      });
    },

    async seedAuthUserOnly() {
      const id = await ctx.newTrackedTestUuid();
      // Record before sending: if the INSERT commits but its response is lost,
      // cleanup still knows the exact test identity to remove.
      await s("m").ok(
        `INSERT INTO auth.users (id, email) VALUES (${lit(id)}, ${lit(`u-${id}@test.invalid`)})`
      );
      return id;
    },

    /**
     * Remove only rows owned by UUIDs this process created.
     *
     * Anchored ledger rows are intentionally append-only, so cleanup disables
     * the exact guard trigger only inside one transaction, deletes the scoped
     * test identities, restores the trigger, and proves zero residue before
     * commit. Any error rolls the entire cleanup back, including trigger state.
     */
    cleanupTestRows() {
      if (createdUsers.size === 0) {
        return Object.freeze({ users: 0, cleaned: true });
      }

      const ids = [...createdUsers];
      const cleaned = cleanupTrackedUserIds(target, ids);
      createdUsers.clear();
      return cleaned;
    },

    async cleanupScenarioRows() {
      if (createdUsers.size === 0) {
        return Object.freeze({ users: 0, cleaned: true });
      }
      const cleanup = buildCleanupSqlForUserIds([...createdUsers]);
      await s("m").ok(cleanup.sql);
      createdUsers.clear();
      return Object.freeze({ users: cleanup.ids.length, cleaned: true });
    },

    /** auth user + profile via the CONVERTED live trigger path. */
    async seedUser() {
      const id = await ctx.seedAuthUserOnly();
      const exists = await s("m").scalar(
        `SELECT count(*) FROM public.profiles WHERE id=${lit(id)}`
      );
      if (Number(exists) === 0) {
        // no trigger in this environment: call the initializer directly
        await s("m").ok(`SELECT public.canvas_p1_initialize_account_v1(${lit(id)})`);
      }
      return id;
    },

    async seedCanvas() {
      const u = await ctx.seedUser();
      const c = await s("m").scalar(
        `INSERT INTO public.canvases (user_id, writer_tag, writer_heartbeat_at, rev)
         VALUES (${lit(u)}, 'tab-1', now(), 0) RETURNING id`
      );
      return { u, c: c.trim() };
    },

    /**
     * Add credits through the AUTHORITATIVE boundary, never by writing the
     * balance directly.
     *
     * Seeds used `UPDATE profiles SET credits = 1000`, which silently forks the
     * ledger from the profile: the signup grant has already recorded
     * balance_after = 100, so a direct write to 1000 makes the next ledger row
     * start from a balance no ledger row ever produced. Any scenario that then
     * checks balance continuity is asserting against a discontinuity its own
     * fixture created -- which is exactly how R32 became guaranteed-red.
     *
     * The anchor carries a fresh UUID because a scenario may top up more than
     * once, and the anchor is unique per (user, anchor) by design.
     */
    async topUp(sess, userId, amount) {
      const nonce = await sess.scalar("SELECT gen_random_uuid()");
      await sess.ok(
        `SELECT public.canvas_p1_apply_credit_delta_v1(
           ${lit(userId)}, 'grant', ${Number(amount)},
           ${lit(`fixture-topup:${ctx.scope ?? "adhoc"}:${nonce}`)},
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'fixture top-up')`
      );
    },

    async expectBeginError(sess, u, c, opts = {}) {
      const {
        node = "n1",
        action = null,
        kind = "text",
        fingerprint = "a".repeat(64),
        billing = "free_quota",
        cost = 0,
        profile = null,
        interval = null,
        rev = null,
        tag = null,
      } = opts;
      const act = action ?? (await sess.scalar("SELECT gen_random_uuid()"));
      const r = rev ?? (await sess.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`));
      const t = tag ?? (await sess.scalar(`SELECT writer_tag FROM public.canvases WHERE id=${lit(c)}`));
      await sess.expectError(
        `SELECT public.begin_canvas_generation_v1(
           ${lit(u)},${lit(c)},${lit(node)},${lit(act)},${r},${lit(t)},
           ${lit(kind)},${lit(fingerprint)},'canvas-generation-v1','pricing-v1',
           ${lit(billing)},${cost},'p','m',NULL,NULL,NULL,NULL,
           ${profile ? lit(profile) : "NULL"},${interval ?? "NULL"},NULL)`,
        "begin must reject"
      );
    },

    /** A video row in pending/submitting with a known bearer. */
    async seedSubmittingVideo(sess, u, c) {
      const act = await sess.scalar("SELECT gen_random_uuid()");
      const rev = await sess.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      await ctx.topUp(sess, u, 900); // through the boundary; signup grant already gave 100
      const id = (
        await sess.ok(`SELECT generation_id FROM public.begin_canvas_generation_v1(
          ${lit(u)},${lit(c)},'n1',${lit(act)},${rev},'tab-1','video',${lit("a".repeat(64))},
          'canvas-generation-v1','pricing-v1','debit',10,'p','m',NULL,NULL,NULL,NULL,'video-poll-v1',5000,NULL)`)
      ).trim();
      const token = (
        await sess.ok(`SELECT bearer_token FROM public.claim_canvas_generation_submission_v1(
          ${lit(u)},${lit(c)},'n1',${lit(act)},${rev},'tab-1',${lit("a".repeat(64))})`)
      ).trim();
      const plannedKey = await sess.scalar(
        `SELECT planned_output_oss_key FROM public.generations WHERE id=${lit(id)}`
      );
      return { id, actionId: act, token, plannedKey };
    },

    /** A video row bound + processing, holding a live lease. */
    async seedBoundVideo(sess, u, c) {
      const g = await ctx.seedSubmittingVideo(sess, u, c);
      await sess.ok(
        `SELECT public.bind_canvas_generation_task_v1(${lit(u)},${lit(g.id)},
           jsonb_build_object('kind','submission_bearer','bearerToken',${lit(g.token)}),'task-1')`
      );
      await sess.ok(
        `UPDATE public.generations SET next_reconcile_at = now() - interval '1 second' WHERE id=${lit(g.id)}`
      );
      const owner = await sess.scalar("SELECT gen_random_uuid()");
      const row = await sess.ok(
        `SELECT lease_token||'|'||to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           FROM public.claim_canvas_generation_reconciliation_v1(${lit(owner)},1,120)`
      );
      const [token, expires] = row.trim().split("|");
      return {
        ...g,
        owner,
        token,
        expires,
        metaJson: `jsonb_build_object('generationId',${lit(g.id)},'userId',${lit(u)},'actionId',${lit(g.actionId)})`,
      };
    },

    /** A GPT Image 2 row, stale-submitting and claimable by the recovery lane. */
    async seedStaleGptImage(sess, u, c) {
      const act = await sess.scalar("SELECT gen_random_uuid()");
      const rev = await sess.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      await ctx.topUp(sess, u, 900); // through the boundary; signup grant already gave 100
      const id = (
        await sess.ok(`SELECT generation_id FROM public.begin_canvas_generation_v1(
          ${lit(u)},${lit(c)},'n1',${lit(act)},${rev},'tab-1','image',${lit("a".repeat(64))},
          'canvas-generation-v1','pricing-v1','debit',5,'p','gpt-image-2',NULL,NULL,NULL,NULL,
          'gpt-image-2-poll-v1',30000,NULL)`)
      ).trim();
      const token = (
        await sess.ok(`SELECT bearer_token FROM public.claim_canvas_generation_submission_v1(
          ${lit(u)},${lit(c)},'n1',${lit(act)},${rev},'tab-1',${lit("a".repeat(64))})`)
      ).trim();
      await sess.ok(
        `UPDATE public.generations SET submission_started_at = now() - interval '3 minutes' WHERE id=${lit(id)}`
      );
      const plannedKey = await sess.scalar(
        `SELECT planned_output_oss_key FROM public.generations WHERE id=${lit(id)}`
      );
      const owner = await sess.scalar("SELECT gen_random_uuid()");
      return { id, actionId: act, token, plannedKey, owner };
    },

    /** A DeepSeek text row, stale-submitting, sweepable. */
    async seedStaleText(sess, u, c) {
      const act = await sess.scalar("SELECT gen_random_uuid()");
      const rev = await sess.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      const id = (
        await sess.ok(`SELECT generation_id FROM public.begin_canvas_generation_v1(
          ${lit(u)},${lit(c)},'n1',${lit(act)},${rev},'tab-1','text',${lit("a".repeat(64))},
          'canvas-generation-v1','pricing-v1','free_quota',0,'p','deepseek-chat',NULL,NULL,NULL,NULL,
          NULL,NULL,NULL)`)
      ).trim();
      const token = (
        await sess.ok(`SELECT bearer_token FROM public.claim_canvas_generation_submission_v1(
          ${lit(u)},${lit(c)},'n1',${lit(act)},${rev},'tab-1',${lit("a".repeat(64))})`)
      ).trim();
      await sess.ok(
        `UPDATE public.generations SET submission_started_at = now() - interval '3 minutes' WHERE id=${lit(id)}`
      );
      return { id, actionId: act, token };
    },

    assertCallsiteInventory() {
      const findings = callsiteGuard();
      if (findings.length > 0) throw new Error(findings.join("; "));
    },

    proveCallsiteGuardDetectsAddition,

    closeScenarioSessions() {
      return closeSessionSet(scenarioOpened);
    },
    async closeAll() {
      await closeSessionSet(opened);
      sessions.clear();
    },
  };

  return ctx;
}

/**
 * Run the runtime suite. Returns separate executed/passed/failed/skipped counts.
 */
export async function runRuntime(target, { only = null, remoteState = null } = {}) {
  const result = {
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
    gate: null,
    cleanup: null,
    cleanupCounts: null,
    finalCatalog: null,
  };

  if (target.mode === "remote") {
    // MANDATORY, and the only thing that mints write permission.
    //
    // The manifest is loaded HERE from frozen data rather than accepted as a
    // caller argument: the previous signature took `expectedCatalog` from the
    // verifier, which made the caller the authority over its own gate.
    if (remoteState === "postapply") {
      result.gate = assertRemotePostApplyWriteAllowed(target, {
        postApplyManifest: loadPostApplyManifest(),
      });
    } else {
      throw new Error(
        'REFUSED: remote runtime requires explicit remoteState "postapply". The pre-apply ' +
          "Preview Branch may only use --capture-post-apply, which stops before ordinary scenarios."
      );
    }
  }

  const ctx = await buildContext(target);
  let cleanedUsers = 0;

  try {
    for (let index = 0; index < SCENARIOS.length; index += 1) {
      const scenario = SCENARIOS[index];
      if (only && !only.includes(scenario.id) && !only.includes(scenario.test)) {
        result.skipped += 1;
        continue;
      }
      const impl = REGISTRY.get(scenario.test);
      if (!impl || typeof impl.run !== "function") {
        result.failed += 1;
        result.failures.push(`${scenario.id} ${scenario.test}: NO IMPLEMENTATION`);
        result.skipped += SCENARIOS.length - index - 1;
        break;
      }

      // ISOLATION: a fresh scope and a fresh owned-row set per scenario. Every
      // user/canvas a scenario seeds is new, so rows never leak across
      // scenarios, and scoped assertions can tell "my rows" from "the world".
      ctx.scope = scenario.id;
      ctx.ownedGenerations = [];

      result.executed += 1;
      let scenarioError = null;
      try {
        await impl.run(ctx);
      } catch (err) {
        scenarioError = err;
      }
      try {
        await ctx.closeScenarioSessions();
      } catch (err) {
        scenarioError ??= new Error(`session cleanup failed: ${err.message}`);
      }
      try {
        const cleaned = await ctx.cleanupScenarioRows();
        cleanedUsers += cleaned.users;
      } catch (err) {
        scenarioError = new Error(
          `${scenarioError ? `${scenarioError.message}; ` : ""}scenario row cleanup failed: ${err.message}`
        );
      } finally {
        ctx.scope = null;
      }

      if (scenarioError) {
        result.failed += 1;
        result.failures.push(`${scenario.id} ${scenario.test}: ${scenarioError.message}`);
        // Stop on the first failed scenario. Continuing would write additional
        // test state after the evidence chain has already failed and can
        // compound a transaction or lock error.
        result.skipped += SCENARIOS.length - index - 1;
        break;
      }
      result.passed += 1;
    }
  } finally {
    try {
      await ctx.closeAll();
    } catch (err) {
      result.failures.push(`SESSION CLOSE: ${err.message}`);
    }
    try {
      const fallbackCleanup = ctx.cleanupTestRows();
      cleanedUsers += fallbackCleanup.users;
      result.cleanup = Object.freeze({ users: cleanedUsers, cleaned: true });
    } catch (err) {
      result.failures.push(`CLEANUP: ${err.message}`);
    }
  }

  if (target.mode === "remote" && remoteState === "postapply") {
    try {
      result.cleanupCounts = proveRemoteTestTablesEmpty(target);
    } catch (err) {
      result.failures.push(`CLEANUP PROOF: ${err.message}`);
    }
    try {
      result.finalCatalog = assertPostApplyCatalog(target, {
        manifest: loadReapplyManifest(),
        label: "post-runtime",
      });
    } catch (err) {
      result.failures.push(`FINAL CATALOG: ${err.message}`);
    }
  }

  return result;
}
