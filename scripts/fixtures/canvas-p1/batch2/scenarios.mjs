#!/usr/bin/env node
/**
 * Canvas P1 · Batch 2 · executable PostgreSQL scenarios.
 *
 * REPLACES the previous declaration-only matrix, which Codex correctly rejected:
 * it named 70 tests and implemented none of them.
 *
 * Every entry here has a real `run(ctx)` that executes SQL against a real
 * database, and several open genuinely concurrent sessions and prove a statement
 * is still blocked before releasing the other side. Nothing in this file passes
 * by inspecting source text.
 *
 * A scenario FAILS by throwing. `ctx` provides sessions and seed helpers.
 *
 * Naming contract: REGISTRY is keyed by `test`, and the offline verifier fails
 * if any declared scenario lacks a callable implementation here -- so this file
 * cannot drift back into prose.
 */
import { isWaitingOnDatabaseLock } from "./session.mjs";

/* ------------------------------------------------------------------ helpers */

const GPT_PROFILE = "gpt-image-2-poll-v1";
const GPT_INTERVAL = 30000;
const FP = "a".repeat(64); // canonical 64-hex fingerprint for tests

function bearer(tok) {
  return `jsonb_build_object('kind','submission_bearer','bearerToken',${lit(tok)})`;
}
function lease(owner, token, expires) {
  return `jsonb_build_object('kind','reconciliation_lease','owner',${lit(owner)},'leaseToken',${lit(
    token
  )},'leaseExpiresAt',${lit(expires)})`;
}
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Begin a canvas action through the real RPC. Returns generation id. */
async function beginAction(s, u, c, opts = {}) {
  const {
    node = "n1",
    action = null,
    kind = "text",
    fingerprint = FP,
    billing = "free_quota",
    cost = 0,
    profile = null,
    interval = null,
  } = opts;

  const act = action ?? (await s.scalar("SELECT gen_random_uuid()"));
  const rev = await s.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
  const tag = await s.scalar(`SELECT writer_tag FROM public.canvases WHERE id=${lit(c)}`);

  const out = await s.ok(`
    SELECT generation_id FROM public.begin_canvas_generation_v1(
      ${lit(u)}, ${lit(c)}, ${lit(node)}, ${lit(act)}, ${rev}, ${lit(tag)},
      ${lit(kind)}, ${lit(fingerprint)}, 'canvas-generation-v1', 'pricing-v1',
      ${lit(billing)}, ${cost},
      'p', 'm', NULL, NULL, NULL, NULL,
      ${profile ? lit(profile) : "NULL"}, ${interval ?? "NULL"}, NULL
    )`);
  return { generationId: out.split("\n")[0].trim(), actionId: act };
}

/* --------------------------------------------------------------- scenarios */

export const SCENARIOS = [
  /* ============================ 1. apply / idempotency ==================== */
  {
    id: "R01",
    area: "apply",
    test: "apply_all_migrations_clean",
    invariant: "clean apply of all five migrations on the reviewed shape",
    async run(ctx) {
      await ctx.applyMigrations();
      const n = await ctx.s("m").scalar(
        `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname LIKE '%canvas%'`
      );
      if (Number(n) < 20) throw new Error(`expected the lifecycle function set, got ${n}`);
    },
  },
  {
    id: "R02",
    area: "apply",
    test: "assert_catalog_after_apply",
    invariant: "exact post-apply catalog/ACL/RLS/function-ACL assertions",
    async run(ctx) {
      const s = ctx.s("m");
      // deterministic post-apply expectations, not a ">=" shortcut
      for (const [role, priv] of [
        ["anon", "SELECT"],
        ["anon", "INSERT"],
        ["authenticated", "INSERT"],
        ["authenticated", "UPDATE"],
        ["anon", "MAINTAIN"],
        ["authenticated", "MAINTAIN"],
      ]) {
        const has = await s.scalar(
          `SELECT has_table_privilege('${role}','public.generations','${priv}')`
        );
        if (has === "t") throw new Error(`${role} still holds ${priv} on generations`);
      }
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "MAINTAIN"]) {
        for (const role of ["anon", "authenticated"]) {
          const has = await s.scalar(
            `SELECT has_table_privilege('${role}','public.generation_quota_buckets','${priv}')`
          );
          if (has === "t") throw new Error(`${role} holds ${priv} on quota buckets`);
        }
      }
      const rls = await s.scalar(
        `SELECT relrowsecurity FROM pg_class WHERE oid='public.generation_quota_buckets'::regclass`
      );
      if (rls !== "t") throw new Error("RLS not enabled on quota buckets");

      for (const fn of [
        "public.begin_canvas_generation_v1",
        "public.complete_canvas_generation_v1",
        "public.canvas_p1_apply_credit_delta_v1",
      ]) {
        const bad = await s.scalar(
          `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='${fn.split(".")[1]}'
              AND (NOT p.prosecdef OR p.proconfig IS NULL)`
        );
        if (Number(bad) !== 0) throw new Error(`${fn} is not SECURITY DEFINER with pinned search_path`);
      }
    },
  },
  {
    id: "R03",
    area: "apply",
    test: "apply_twice_identical",
    invariant: "deterministic second apply produces the same accepted catalog",
    async run(ctx) {
      const before = await ctx.catalogDigest();
      await ctx.applyMigrations();
      const after = await ctx.catalogDigest();
      if (before !== after) throw new Error("second apply changed the catalog; not deterministic");
    },
  },
  {
    id: "R04",
    area: "apply",
    test: "drift_fails_closed",
    invariant: "deliberate live-shape drift fails the preflight closed",
    async run(ctx) {
      const s = ctx.s("m");
      await s.ok("BEGIN");
      // duration integer -> text is the single most load-bearing shape fact
      await s.ok("ALTER TABLE public.generations ALTER COLUMN duration TYPE text");
      const err = await s.expectError(
        await ctx.migrationSql("foundation"),
        "preflight must reject drifted duration"
      );
      if (!/duration/i.test(err)) throw new Error(`preflight failed for the wrong reason: ${err}`);
      await s.ok("ROLLBACK");
    },
  },
  {
    id: "R05",
    area: "apply",
    test: "legacy_rows_compatible",
    invariant: "synthetic legacy rows stay readable and updatable after apply",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      await s.ok(
        `INSERT INTO public.generations (user_id, type, source, status, prompt)
         VALUES (${lit(u)}, 'video', 'quick_gen', 'completed', 'legacy')`
      );
      const n = await s.scalar(
        `SELECT count(*) FROM public.generations WHERE user_id=${lit(u)} AND action_id IS NULL`
      );
      if (Number(n) !== 1) throw new Error("legacy row not insertable after apply");
      await s.ok(
        `UPDATE public.generations SET progress=50 WHERE user_id=${lit(u)} AND action_id IS NULL`
      );
    },
  },
  {
    id: "R06",
    area: "apply",
    test: "policy_anon_zero_owner_ok",
    invariant: "anon sees 0 generations while the owner still reads its own",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      await s.ok(
        `INSERT INTO public.generations (user_id, type, source, status) VALUES (${lit(u)},'video','quick_gen','completed')`
      );
      const anon = await s.asRole("anon", "SELECT count(*) FROM public.generations");
      if (!anon.error && Number(anon.stdout.trim()) !== 0) {
        throw new Error(`anon can see ${anon.stdout.trim()} generation rows`);
      }
      const catchAll = await s.scalar(
        `SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
          WHERE c.relname='generations' AND p.polroles='{0}'::oid[]`
      );
      if (Number(catchAll) !== 0) throw new Error("a PUBLIC policy remains on generations");
    },
  },

  /* ============================ 2. direct forgery ======================== */
  {
    id: "R07",
    area: "acl",
    test: "forge_generations_dml",
    invariant: "anon/authenticated cannot INSERT/UPDATE generations",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      const existing = await s.scalar(
        `INSERT INTO public.generations (user_id, type, source, status)
         VALUES (${lit(u)},'video','quick_gen','completed') RETURNING id`
      );
      for (const role of ["anon", "authenticated"]) {
        for (const privilege of ["INSERT", "UPDATE"]) {
          const has = await s.scalar(
            `SELECT has_table_privilege('${role}','public.generations','${privilege}')`
          );
          if (has === "t") {
            throw new Error(`${role} still holds ${privilege} on generations`);
          }
        }
        const r = await s.asRole(
          role,
          `INSERT INTO public.generations (user_id, type, source, status)
           VALUES (${lit(u)},'video','quick_gen','completed')`
        );
        if (!r.error) throw new Error(`${role} inserted a generation row`);
        const updated = await s.asRole(
          role,
          `UPDATE public.generations SET progress=51 WHERE id=${lit(existing)}`
        );
        if (!updated.error) throw new Error(`${role} updated generations`);
      }
    },
  },
  {
    id: "R08",
    area: "acl",
    test: "forge_profile_insert",
    invariant: "anon/authenticated cannot INSERT a profile (forged signup)",
    async run(ctx) {
      const s = ctx.s("m");
      for (const role of ["anon", "authenticated"]) {
        const attemptedId = await ctx.newTrackedTestUuid();
        const has = await s.scalar(
          `SELECT has_table_privilege('${role}','public.profiles','INSERT')`
        );
        if (has === "t") throw new Error(`${role} still holds INSERT on profiles`);
        const r = await s.asRole(
          role,
          `INSERT INTO public.profiles (id,email,credits,role)
           VALUES (${lit(attemptedId)},'x@y.invalid',999999,'admin')`
        );
        if (!r.error) throw new Error(`${role} forged a profile insert`);
      }
    },
  },
  {
    id: "R09",
    area: "acl",
    test: "forge_profile_privileged_columns",
    invariant: "authenticated cannot UPDATE credits/role/status",
    async run(ctx) {
      const s = ctx.s("m");
      for (const col of ["credits", "role", "status", "banned_at"]) {
        const has = await s.scalar(
          `SELECT has_column_privilege('authenticated','public.profiles','${col}','UPDATE')`
        );
        if (has === "t") throw new Error(`authenticated may UPDATE profiles.${col}`);
      }
      for (const col of ["name", "phone", "avatar_url"]) {
        const has = await s.scalar(
          `SELECT has_column_privilege('authenticated','public.profiles','${col}','UPDATE')`
        );
        if (has !== "t") throw new Error(`authenticated lost self-service UPDATE on ${col}`);
      }
    },
  },
  {
    id: "R10",
    area: "acl",
    test: "forge_ledger_dml",
    invariant: "clients cannot INSERT/UPDATE/DELETE ledger rows",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      const legacy = await s.scalar(
        `INSERT INTO public.credit_transactions
           (user_id,amount,type,balance_before,balance_after,description)
         VALUES (${lit(u)},1,'bonus',100,101,'acl legacy probe')
         RETURNING id`
      );
      for (const role of ["anon", "authenticated"]) {
        for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
          const has = await s.scalar(
            `SELECT has_table_privilege('${role}','public.credit_transactions','${privilege}')`
          );
          if (has === "t") {
            throw new Error(`${role} still holds ${privilege} on credit_transactions`);
          }
        }
        for (const sql of [
          `INSERT INTO public.credit_transactions
             (user_id,amount,type,balance_before,balance_after,description)
           VALUES (${lit(u)},1,'bonus',100,101,'client forgery')`,
          `UPDATE public.credit_transactions SET description='client forgery' WHERE id=${lit(legacy)}`,
          `DELETE FROM public.credit_transactions WHERE id=${lit(legacy)}`,
        ]) {
          const r = await s.asRole(role, sql);
          if (!r.error) throw new Error(`${role} performed ledger DML: ${sql.slice(0, 40)}`);
        }
      }
    },
  },
  {
    id: "R11",
    area: "acl",
    test: "forge_quota_bucket",
    invariant: "clients hold zero privileges on generation_quota_buckets",
    async run(ctx) {
      const s = ctx.s("m");
      for (const role of ["anon", "authenticated"]) {
        for (const privilege of [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
          "REFERENCES",
          "TRIGGER",
          "MAINTAIN",
        ]) {
          const has = await s.scalar(
            `SELECT has_table_privilege('${role}','public.generation_quota_buckets','${privilege}')`
          );
          if (has === "t") {
            throw new Error(
              `${role} still holds ${privilege} on generation_quota_buckets`
            );
          }
        }
        const r = await s.asRole(role, `SELECT count(*) FROM public.generation_quota_buckets`);
        if (!r.error) throw new Error(`${role} can read quota buckets`);
      }
    },
  },
  {
    id: "R12",
    area: "acl",
    test: "forge_function_execute",
    invariant: "clients cannot EXECUTE any service-only function",
    async run(ctx) {
      const s = ctx.s("m");
      const fns = (
        await s.ok(
          `SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND (p.proname LIKE 'canvas_p1_%' OR p.proname LIKE '%_canvas_generation_%'
               OR p.proname LIKE 'begin_canvas_%' OR p.proname LIKE 'handle_new_user%')`
        )
      )
        .split("\n")
        .filter(Boolean);
      if (fns.length === 0) throw new Error("no lifecycle functions found");
      for (const fn of fns) {
        for (const role of ["anon", "authenticated", "public"]) {
          const has = await s.scalar(
            `SELECT has_function_privilege('${role}', ${lit(fn)}, 'EXECUTE')`
          );
          if (has === "t") throw new Error(`${role} may EXECUTE ${fn}`);
        }
      }
    },
  },
  {
    id: "R13",
    area: "acl",
    test: "forge_sensitive_columns",
    invariant: "authenticated cannot SELECT token hash / reconcile / planned key",
    async run(ctx) {
      const s = ctx.s("m");
      for (const col of [
        "submission_token_hash",
        "planned_output_oss_key",
        "reconcile_lease_token",
        "reconcile_owner",
        "next_reconcile_at",
        "canvas_rev",
        "writer_tag",
      ]) {
        for (const role of ["anon", "authenticated"]) {
          const has = await s.scalar(
            `SELECT has_column_privilege('${role}','public.generations','${col}','SELECT')`
          );
          if (has === "t") throw new Error(`${role} can read generations.${col}`);
        }
      }
    },
  },

  /* ============================ 3. anchored ledger ======================= */
  {
    id: "R14",
    area: "ledger",
    test: "anchor_update_rejected",
    invariant: "anchored row rejects UPDATE even as service_role",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      await s.expectError(
        `UPDATE public.credit_transactions SET description='x' WHERE user_id=${lit(u)} AND operation_anchor IS NOT NULL`,
        "anchored UPDATE"
      );
    },
  },
  {
    id: "R15",
    area: "ledger",
    test: "anchor_delete_rejected",
    invariant: "anchored row rejects DELETE even as service_role",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      await s.expectError(
        `DELETE FROM public.credit_transactions WHERE user_id=${lit(u)} AND operation_anchor IS NOT NULL`,
        "anchored DELETE"
      );
    },
  },
  {
    id: "R16",
    area: "ledger",
    test: "anchor_clear_rejected",
    invariant: "anchor cannot be cleared or changed",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      await s.expectError(
        `UPDATE public.credit_transactions SET operation_anchor=NULL WHERE user_id=${lit(u)}`,
        "anchor clear"
      );
      await s.expectError(
        `UPDATE public.credit_transactions SET operation_anchor='other' WHERE user_id=${lit(u)}`,
        "anchor change"
      );
    },
  },
  {
    id: "R17",
    area: "ledger",
    test: "anchor_introduce_rejected",
    invariant: "a legacy null-anchor row cannot acquire an anchor via UPDATE",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      await s.ok(
        `INSERT INTO public.credit_transactions (user_id,amount,type,balance_before,balance_after)
         VALUES (${lit(u)}, -5, 'usage', 100, 95)`
      );
      await s.expectError(
        `UPDATE public.credit_transactions SET operation_anchor='minted'
          WHERE user_id=${lit(u)} AND operation_anchor IS NULL`,
        "anchor introduction"
      );
    },
  },
  {
    id: "R18",
    area: "ledger",
    test: "generation_delete_restricted",
    invariant: "a generation with a ledger row cannot be deleted",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const { generationId } = await beginAction(s, u, c);
      await s.expectError(
        `DELETE FROM public.generations WHERE id=${lit(generationId)}`,
        "FK RESTRICT"
      );
    },
  },
  {
    id: "R19",
    area: "ledger",
    test: "account_delete_blocked",
    invariant: "profile hard-delete cascade is blocked by the anchored ledger",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      // the measured FK is ON DELETE CASCADE, so this attempts a ledger delete
      await s.expectError(`DELETE FROM public.profiles WHERE id=${lit(u)}`, "cascade into anchors");
    },
  },
  {
    id: "R20",
    area: "ledger",
    test: "deactivate_preserves_audit",
    invariant: "deactivation anonymizes PII and retains every anchored row",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      const before = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions WHERE user_id=${lit(u)}`
      );
      await s.ok(`SELECT public.canvas_p1_deactivate_account_v1(${lit(u)}, 'test')`);
      const after = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions WHERE user_id=${lit(u)}`
      );
      if (before !== after) throw new Error("deactivation lost ledger rows");
      const row = await s.scalar(
        `SELECT email||'|'||coalesce(name,'-')||'|'||status FROM public.profiles WHERE id=${lit(u)}`
      );
      if (!row.includes("deactivated") || !row.includes("banned")) {
        throw new Error(`profile not anonymized: ${row}`);
      }
    },
  },
  {
    id: "R21",
    area: "ledger",
    test: "legacy_ledger_still_mutable",
    invariant: "historical null-anchor rows remain updatable and are NOT reinterpreted",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      await s.ok(
        `INSERT INTO public.credit_transactions (user_id,amount,type,balance_before,balance_after)
         VALUES (${lit(u)}, -1, 'usage', 100, 99)`
      );
      await s.ok(
        `UPDATE public.credit_transactions SET description='legacy edit'
          WHERE user_id=${lit(u)} AND operation_anchor IS NULL`
      );

      // ASSERT THE EFFECT, not merely the absence of an error.
      //
      // The previous revision ran the INSERT and the UPDATE and stopped. Both
      // statements only had to not-throw, so the scenario would have passed
      // unchanged if the UPDATE had matched zero rows -- i.e. it could not tell
      // "legacy rows remain updatable" from "the WHERE clause found nothing".
      // The whole point of this invariant is that the append-only trigger does
      // NOT catch null-anchor history, and a zero-row UPDATE is exactly what a
      // silently over-broad trigger would produce.
      const edited = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions
          WHERE user_id=${lit(u)} AND operation_anchor IS NULL AND description='legacy edit'`
      );
      if (Number(edited) !== 1) {
        throw new Error(
          `expected exactly 1 legacy row to carry the edit, got ${edited}; the UPDATE reported ` +
            "success but changed nothing"
        );
      }

      // And the anchored signup grant on the same user must still be frozen --
      // proving the trigger discriminates by anchor rather than by table.
      await s.expectError(
        `UPDATE public.credit_transactions SET description='should fail'
          WHERE user_id=${lit(u)} AND operation_anchor IS NOT NULL`,
        "the anchored signup grant on the same user must remain append-only"
      );
    },
  },

  /* ============================ 4. signup ================================ */
  {
    id: "R22",
    area: "signup",
    test: "init_creates_zero_credit",
    invariant: "verified auth event yields one profile at exactly 100 after grant",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      const r = await s.scalar(
        `SELECT credits||'|'||role FROM public.profiles WHERE id=${lit(u)}`
      );
      if (r !== "100|user") throw new Error(`expected 100|user, got ${r}`);
    },
  },
  {
    id: "R23",
    area: "signup",
    test: "init_idempotent_single_grant",
    invariant: "exactly one anchored 100 grant; duplicate init grants nothing",
    async run(ctx) {
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      await s.ok(`SELECT public.canvas_p1_initialize_account_v1(${lit(u)})`);
      await s.ok(`SELECT public.canvas_p1_initialize_account_v1(${lit(u)})`);
      const grants = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions
          WHERE user_id=${lit(u)} AND entry_kind='grant'`
      );
      if (Number(grants) !== 1) throw new Error(`expected 1 grant, got ${grants}`);
      const credits = await s.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      if (Number(credits) !== 100) throw new Error(`double grant: credits=${credits}`);
    },
  },
  {
    id: "R24",
    area: "signup",
    test: "init_requires_auth_event",
    invariant: "init without an auth.users row refuses",
    async run(ctx) {
      const s = ctx.s("m");
      const ghostId = await ctx.newTrackedTestUuid();
      await s.expectError(
        `SELECT public.canvas_p1_initialize_account_v1(${lit(ghostId)}, 'ghost@x.invalid')`,
        "no auth event"
      );
    },
  },
  {
    id: "R25",
    area: "signup",
    test: "init_concurrent_single_grant",
    invariant: "both concurrent initializers succeed/converge; one profile, one grant",
    async run(ctx) {
      const a = ctx.s("a");
      const b = ctx.s("b");
      const m = ctx.s("m");
      const u = await ctx.seedAuthUserOnly();

      const [r1, r2] = await Promise.all([
        a.send(`SELECT public.canvas_p1_initialize_account_v1(${lit(u)}, 'c@x.invalid')`),
        b.send(`SELECT public.canvas_p1_initialize_account_v1(${lit(u)}, 'c@x.invalid')`),
      ]);

      // INSPECT BOTH PARTICIPANTS.
      //
      // The previous revision awaited both and then looked only at the final
      // balance. A run where one initializer CRASHED and the other happened to
      // land 100 credits passed identically to a run where both converged
      // correctly -- so the scenario could not distinguish "idempotent" from
      // "one of them blew up". The contract requires both to converge, so both
      // results are asserted.
      for (const [label, r] of [["a", r1], ["b", r2]]) {
        if (r.error) {
          throw new Error(
            `concurrent initializer ${label} errored instead of converging: ${r.error}. ` +
              "Duplicate trigger/register/SMS delivery must return the same initialized state."
          );
        }
      }

      const rows = await m.scalar(`SELECT count(*) FROM public.profiles WHERE id=${lit(u)}`);
      if (Number(rows) !== 1) throw new Error(`expected exactly 1 profile, got ${rows}`);

      const grants = await m.scalar(
        `SELECT count(*) FROM public.credit_transactions
          WHERE user_id=${lit(u)} AND entry_kind='grant'`
      );
      if (Number(grants) !== 1) throw new Error(`expected exactly 1 anchored grant, got ${grants}`);

      const credits = await m.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      if (Number(credits) !== 100) throw new Error(`concurrent init gave credits=${credits}`);
    },
  },

  /* ============================ 5. begin / quota ========================= */
  {
    id: "R26",
    area: "begin",
    test: "begin_20_duplicates_one_debit",
    invariant: "20 duplicate begin calls create one row and one debit",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();

      // Top up through the boundary so the ledger stays continuous from the
      // signup grant (see R32).
      await s.ok(
        `SELECT public.canvas_p1_apply_credit_delta_v1(
           ${lit(u)}, 'grant', 900, 'r26-topup:${ctx.scope}:${u}',
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'duplicate-begin fixture')`
      );

      const act = await s.scalar("SELECT gen_random_uuid()");
      const rev = await s.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      const tag = await s.scalar(`SELECT writer_tag FROM public.canvases WHERE id=${lit(c)}`);

      const results = await ctx.concurrentRequests(
        20,
        "dup",
        (x) =>
          x.send(`SELECT generation_id FROM public.begin_canvas_generation_v1(
              ${lit(u)}, ${lit(c)}, 'n1', ${lit(act)}, ${rev}, ${lit(tag)},
              'video', ${lit(FP)}, 'canvas-generation-v1', 'pricing-v1', 'debit', 10,
              'p','m',NULL,NULL,NULL,NULL,'video-poll-v1',5000,NULL)`)
      );

      // EVERY DUPLICATE MUST RETURN THE REQUIRED REPLAY RESULT.
      //
      // The previous revision discarded all 20 results and checked only the
      // final balance. The contract does not merely say "one debit happens" --
      // it says a duplicate begin RETURNS THE EXISTING ROW. A run where 19
      // callers errored and one succeeded produces exactly the same final
      // balance as a correct run, so the old assertion could not tell a working
      // idempotent begin from a broken one that mostly throws.
      const errored = results.filter((r) => r.error);
      if (errored.length > 0) {
        throw new Error(
          `${errored.length}/20 duplicate begins errored instead of returning the existing row: ` +
            errored[0].error
        );
      }

      // All 20 must name the SAME generation id. A duplicate that returns a
      // different row would mean two truth rows for one action.
      const returned = results.map((r) => String(r.stdout).trim());
      const distinct = [...new Set(returned)];
      if (distinct.length !== 1 || !distinct[0]) {
        throw new Error(
          `20 duplicate begins returned ${distinct.length} distinct generation ids (${distinct.join(", ")}); ` +
            "an action must have exactly one truth row"
        );
      }
      ctx.ownGeneration(distinct[0]);

      const rows = await s.scalar(
        `SELECT count(*) FROM public.generations WHERE user_id=${lit(u)} AND action_id=${lit(act)}`
      );
      if (Number(rows) !== 1) throw new Error(`expected 1 generation row, got ${rows}`);
      const debits = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions WHERE user_id=${lit(u)} AND entry_kind='consume'`
      );
      if (Number(debits) !== 1) throw new Error(`expected 1 consume row, got ${debits}`);
      const credits = await s.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      if (Number(credits) !== 990) throw new Error(`expected 990 credits, got ${credits}`);
    },
  },
  {
    id: "R27",
    area: "begin",
    test: "begin_fingerprint_conflict",
    invariant: "a differing fingerprint on an existing action rejects",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const { actionId } = await beginAction(s, u, c);
      await ctx.expectBeginError(s, u, c, { action: actionId, fingerprint: "b".repeat(64) });
    },
  },
  {
    id: "R28",
    area: "begin",
    test: "begin_free_one_usage",
    invariant: "a free begin consumes exactly one allowance",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      await beginAction(s, u, c);
      const used = await s.scalar(
        `SELECT used FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      if (Number(used) !== 1) throw new Error(`expected used=1, got ${used}`);
      const rows = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions WHERE user_id=${lit(u)} AND entry_kind='free_usage'`
      );
      if (Number(rows) !== 1) throw new Error(`expected 1 free_usage row, got ${rows}`);
    },
  },
  {
    id: "R29",
    area: "begin",
    test: "quota_limit_20_utc_boundary",
    invariant: "limit 20 enforced; 21st rejects; bucket window is the DB UTC day",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      for (let i = 0; i < 20; i++) await beginAction(s, u, c, { node: `n${i}` });
      const used = await s.scalar(
        `SELECT used FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      if (Number(used) !== 20) throw new Error(`expected used=20, got ${used}`);
      await ctx.expectBeginError(s, u, c, { node: "n21" }); // 21st
      const w = await s.scalar(
        `SELECT window_start = date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
           FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      if (w !== "t") throw new Error("bucket window is not the database UTC calendar day");
    },
  },
  {
    id: "R30",
    area: "begin",
    test: "begin_no_negative_balance",
    invariant: "a complete task identity is accepted, partial identity is rejected, replay is idempotent, and a debit may never drive the balance negative",
    async run(ctx) {
      const s = ctx.s("m");
      const { u } = await ctx.seedCanvas();
      const taskId = `r30-task:${ctx.scope}:${u}`;
      const anchor = `r30-task-consume:${ctx.scope}:${u}`;
      const applied = await s.scalar(
        `SELECT applied FROM public.canvas_p1_apply_credit_delta_v1(
           ${lit(u)}, 'consume', -95, ${lit(anchor)},
           NULL, NULL, NULL, NULL, NULL, ${lit(taskId)}, NULL,
           'legacy-task-v1', NULL, NULL, 'task-scoped consume fixture')`
      );
      if (applied !== "t") throw new Error(`first task-scoped consume applied=${applied}`);

      const replayed = await s.scalar(
        `SELECT applied FROM public.canvas_p1_apply_credit_delta_v1(
           ${lit(u)}, 'consume', -95, ${lit(anchor)},
           NULL, NULL, NULL, NULL, NULL, ${lit(taskId)}, NULL,
           'legacy-task-v1', NULL, NULL, 'task-scoped consume fixture')`
      );
      if (replayed !== "f") throw new Error(`task-scoped replay applied=${replayed}`);

      await s.expectError(
        `SELECT public.canvas_p1_apply_credit_delta_v1(
           ${lit(u)}, 'consume', -1, 'r30-partial:${ctx.scope}:${u}',
           gen_random_uuid(), NULL, NULL, NULL, NULL, ${lit(taskId)}, NULL,
           'legacy-task-v1', NULL, NULL, 'partial identity must fail')`,
        "partial action identity must not fall back to task scope"
      );
      await s.expectError(
        `SELECT public.canvas_p1_apply_credit_delta_v1(
           ${lit(u)}, 'consume', -1, 'r30-blank-task:${ctx.scope}:${u}',
           NULL, NULL, NULL, NULL, NULL, '   ', NULL,
           'legacy-task-v1', NULL, NULL, 'blank task must fail')`,
        "blank task identity must fail"
      );
      await s.expectError(
        `SELECT public.canvas_p1_apply_credit_delta_v1(
           ${lit(u)}, 'consume', -999, 'r30-overdraft:${ctx.scope}:${u}',
           NULL, NULL, NULL, NULL, NULL, ${lit(`${taskId}:overdraft`)}, NULL,
           'legacy-task-v1', NULL, NULL, 'overdraft must fail')`,
        "task-scoped debit must not overdraw"
      );

      const credits = await s.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      if (Number(credits) !== 5) throw new Error(`balance moved to ${credits}`);
      const rows = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions
          WHERE user_id=${lit(u)} AND operation_anchor=${lit(anchor)}`
      );
      if (Number(rows) !== 1) throw new Error(`task-scoped replay created ${rows} ledger rows`);
    },
  },
  {
    id: "R31",
    area: "begin",
    test: "quota_key_and_limit_are_db_pinned",
    invariant: "caller cannot choose quota key/limit/window; drifted bucket rejects",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();

      // The RPC exposes no quota parameters at all: proving the signature is the
      // proof that a caller cannot supply key/limit/window.
      const params = await s.scalar(
        `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='begin_canvas_generation_v1'
            AND pg_get_function_arguments(p.oid) LIKE '%quota%'`
      );
      if (Number(params) !== 0) throw new Error("begin still exposes quota parameters");

      // A drifted bucket must be refused, not silently honoured.
      const win = await s.scalar(
        `SELECT (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text`
      );
      await s.expectError(
        `INSERT INTO public.generation_quota_buckets (user_id,quota_key,window_start,quota_limit,used)
         VALUES (${lit(u)},'canvas-deepseek-v1',${lit(win)},9999,0)`,
        "v1 limit pin must reject an inflated limit"
      );
    },
  },

  /* ============================ 6. races / lock order ==================== */
  {
    id: "R32",
    area: "race",
    test: "race_mixed_balance_continuity",
    invariant: "mixed same-user mutations keep ordered continuous balances",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();

      // CONTINUOUS FIXTURE, built through the authoritative boundary.
      //
      // The previous revision did `UPDATE profiles SET credits=1000` directly
      // while the signup grant had already recorded balance_after=100, then
      // asserted that every ledger row's balance_before equals the previous
      // row's balance_after. That assertion could not pass: the first consume
      // recorded balance_before=1000 against a preceding balance_after=100, so
      // the scenario manufactured the exact discontinuity it then reported. It
      // was guaranteed-red, and a guaranteed-red test proves nothing about the
      // code -- it only proves the fixture is wrong.
      //
      // The balance is now built by the same anchored boundary that every other
      // mutation uses, so the ledger stays continuous from the signup grant
      // through to the last consume, and the assertion measures the DATABASE
      // rather than the fixture's own bookkeeping error.
      await s.ok(
        `SELECT public.canvas_p1_apply_credit_delta_v1(
           ${lit(u)}, 'grant', 900, 'r32-topup:${ctx.scope}:${u}',
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'continuity fixture top-up')`
      );

      const before = await s.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      if (Number(before) !== 1000) {
        throw new Error(`fixture top-up did not reach 1000 through the boundary, got ${before}`);
      }

      const rev = await s.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      const tag = await s.scalar(`SELECT writer_tag FROM public.canvases WHERE id=${lit(c)}`);
      const results = await ctx.concurrentRequests(
        6,
        "mix",
        async (x, i) => {
          const act = await x.scalar("SELECT gen_random_uuid()");
          return x.send(`SELECT generation_id FROM public.begin_canvas_generation_v1(
              ${lit(u)}, ${lit(c)}, ${lit(`race-${i}`)}, ${lit(act)}, ${rev}, ${lit(tag)},
              'video', ${lit(FP)}, 'canvas-generation-v1', 'pricing-v1', 'debit', 1,
              'p','m',NULL,NULL,NULL,NULL,'video-poll-v1',5000,NULL)`);
        }
      );

      // INSPECT EVERY PARTICIPANT. A concurrent scenario cannot pass merely
      // because the final state looks right while a participant errored.
      const failed = results.filter((r) => r.error);
      if (failed.length > 0) {
        throw new Error(
          `${failed.length}/6 concurrent paid begins errored: ${failed.map((r) => r.error).join(" | ")}`
        );
      }

      const bad = await s.scalar(
        `WITH o AS (
           SELECT balance_before, balance_after,
                  lag(balance_after) OVER (ORDER BY created_at, id) AS prev
             FROM public.credit_transactions WHERE user_id=${lit(u)} AND entry_kind IS NOT NULL)
         SELECT count(*) FROM o WHERE prev IS NOT NULL AND prev <> balance_before`
      );
      if (Number(bad) !== 0) throw new Error(`${bad} ledger rows break balance continuity`);

      // The whole chain must also reconcile to the profile: signup 100 + 900
      // top-up - 6 consumes = 994.
      const after = await s.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      if (Number(after) !== 994) throw new Error(`expected 994 after 6 consumes, got ${after}`);

      const last = await s.scalar(
        `SELECT balance_after FROM public.credit_transactions
          WHERE user_id=${lit(u)} AND entry_kind IS NOT NULL
          ORDER BY created_at DESC, id DESC LIMIT 1`
      );
      if (Number(last) !== 994) {
        throw new Error(`ledger tail (${last}) disagrees with the profile balance (${after})`);
      }
    },
  },
  {
    id: "R33",
    area: "race",
    test: "race_no_deadlock",
    invariant: "paid/free/terminal lock orders do not deadlock",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      await ctx.topUp(s, u, 4900); // through the boundary; signup grant already gave 100
      const results = await ctx.concurrentRequests(
        4,
        "dl",
        (x, i) =>
          x.send(
            i % 2 === 0
              ? `SELECT public.canvas_p1_apply_credit_delta_v1(${lit(u)},'consume',-1,'dl-c-${i}',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'d')`
              : `SELECT public.canvas_p1_apply_credit_delta_v1(${lit(u)},'refund',1,'dl-r-${i}',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'d')`
          )
      );
      for (const r of results) {
        if (r.error && /deadlock/i.test(r.error)) throw new Error(`deadlock detected: ${r.error}`);
      }
    },
  },
  {
    id: "R34",
    area: "race",
    test: "duplicate_no_side_effect",
    invariant: "duplicate begin touches neither profile nor bucket",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const { actionId } = await beginAction(s, u, c);
      const usedBefore = await s.scalar(
        `SELECT used FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      const credBefore = await s.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      await beginAction(s, u, c, { action: actionId });
      const usedAfter = await s.scalar(
        `SELECT used FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      const credAfter = await s.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      if (usedBefore !== usedAfter) throw new Error("duplicate begin consumed quota");
      if (credBefore !== credAfter) throw new Error("duplicate begin touched the balance");
    },
  },
  {
    id: "R35",
    area: "race",
    test: "key_share_compatible",
    invariant: "FK KEY SHARE stays compatible with FOR NO KEY UPDATE",
    async run(ctx) {
      const a = ctx.s("a");
      const b = ctx.s("b");
      const { u, c } = await ctx.seedCanvas();
      await a.begin();
      await a.ok(`SELECT credits FROM public.profiles WHERE id=${lit(u)} FOR NO KEY UPDATE`);
      // an FK insert takes KEY SHARE on profiles.id and must NOT block
      const bPid = await b.scalar("SELECT pg_backend_pid()");
      const p = b.send(
        `INSERT INTO public.generations (user_id,type,source) VALUES (${lit(u)},'video','quick_gen')`
      );
      const blocked = await isWaitingOnDatabaseLock(ctx.s("m"), bPid, p);
      await a.commit();
      const r = await p;
      if (blocked) throw new Error("FK KEY SHARE blocked behind FOR NO KEY UPDATE");
      if (r.error) throw new Error(`FK insert failed: ${r.error}`);
    },
  },

  /* ============================ 7. canvas fence ========================== */
  {
    id: "R36",
    area: "fence",
    test: "fence_patch_before_begin",
    invariant: "a PATCH between recompute and begin rejects begin",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const rev = await s.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      await s.ok(`UPDATE public.canvases SET rev=rev+1 WHERE id=${lit(c)}`); // the PATCH
      await ctx.expectBeginError(s, u, c, { rev }); // stale observed rev
    },
  },
  {
    id: "R37",
    area: "fence",
    test: "fence_takeover_before_begin",
    invariant: "a writer takeover rejects begin",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const tag = await s.scalar(`SELECT writer_tag FROM public.canvases WHERE id=${lit(c)}`);
      await s.ok(`UPDATE public.canvases SET writer_tag='other-tab' WHERE id=${lit(c)}`);
      await ctx.expectBeginError(s, u, c, { tag });
    },
  },
  {
    id: "R38",
    area: "fence",
    test: "fence_expiry_before_begin",
    invariant: "an expired heartbeat rejects begin",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      await s.ok(
        `UPDATE public.canvases SET writer_heartbeat_at = now() - interval '31 seconds' WHERE id=${lit(c)}`
      );
      await ctx.expectBeginError(s, u, c, {});
    },
  },
  {
    id: "R39",
    area: "fence",
    test: "fence_barriers_before_claim",
    invariant: "the same three barriers reject claim",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const { actionId } = await beginAction(s, u, c);
      const rev = await s.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      await s.ok(`UPDATE public.canvases SET rev=rev+1 WHERE id=${lit(c)}`);
      await s.expectError(
        `SELECT public.claim_canvas_generation_submission_v1(${lit(u)},${lit(c)},'n1',${lit(actionId)},${rev},'tab-1',${lit(FP)})`,
        "stale rev must reject claim"
      );
    },
  },
  {
    id: "R40",
    area: "fence",
    test: "fence_resume_after_takeover",
    invariant: "a NEW current writer may Resume the still-current action",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const { actionId } = await beginAction(s, u, c);
      await s.ok(
        `UPDATE public.canvases SET writer_tag='tab-2', writer_heartbeat_at=now() WHERE id=${lit(c)}`
      );
      const rev = await s.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      const tok = await s.ok(
        `SELECT bearer_token FROM public.claim_canvas_generation_submission_v1(
           ${lit(u)},${lit(c)},'n1',${lit(actionId)},${rev},'tab-2',${lit(FP)})`
      );
      if (!tok.trim()) throw new Error("a legitimate new writer could not Resume");
    },
  },

  /* ============================ 8. lifecycle ============================= */
  {
    id: "R41",
    area: "lifecycle",
    test: "resume_vs_abandon",
    invariant: "Resume vs abandon: exactly one wins",
    async run(ctx) {
      const a = ctx.s("a");
      const b = ctx.s("b");
      const m = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const { actionId } = await beginAction(m, u, c);
      const rev = await m.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      const [r1, r2] = await Promise.all([
        a.send(
          `SELECT bearer_token FROM public.claim_canvas_generation_submission_v1(${lit(u)},${lit(c)},'n1',${lit(actionId)},${rev},'tab-1',${lit(FP)})`
        ),
        b.send(`SELECT public.abandon_canvas_generation_v1(${lit(u)},${lit(actionId)})`),
      ]);
      const wins = [r1, r2].filter((r) => !r.error).length;
      if (wins !== 1) throw new Error(`expected exactly one winner, got ${wins}`);
    },
  },
  {
    id: "R42",
    area: "lifecycle",
    test: "abandon_duplicate",
    invariant: "duplicate abandon is idempotent and refunds once",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      // No top-up: the anchored signup grant already leaves exactly 100.
      const { actionId } = await beginAction(s, u, c, {
        kind: "video", billing: "debit", cost: 10, profile: "video-poll-v1", interval: 5000,
      });
      await s.ok(`SELECT public.abandon_canvas_generation_v1(${lit(u)},${lit(actionId)})`);
      await s.ok(`SELECT public.abandon_canvas_generation_v1(${lit(u)},${lit(actionId)})`);
      const refunds = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions WHERE user_id=${lit(u)} AND entry_kind='refund'`
      );
      if (Number(refunds) !== 1) throw new Error(`expected 1 refund, got ${refunds}`);
      const credits = await s.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      if (Number(credits) !== 100) throw new Error(`expected restored 100, got ${credits}`);
    },
  },
  {
    id: "R43",
    area: "lifecycle",
    test: "resume_after_abandon",
    invariant: "Resume after abandon is unconditionally rejected",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const { actionId } = await beginAction(s, u, c);
      await s.ok(`SELECT public.abandon_canvas_generation_v1(${lit(u)},${lit(actionId)})`);
      const rev = await s.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      await s.expectError(
        `SELECT public.claim_canvas_generation_submission_v1(${lit(u)},${lit(c)},'n1',${lit(actionId)},${rev},'tab-1',${lit(FP)})`,
        "resume after abandon"
      );
    },
  },
  {
    id: "R44",
    area: "lifecycle",
    test: "refund_vs_complete",
    invariant: "refund vs complete yields one terminal outcome",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedBoundVideo(s, u, c);
      const [r1, r2] = await Promise.all([
        ctx.s("a").send(
          `SELECT public.fail_canvas_generation_v1(${lit(u)},${lit(g.id)},${lease(g.owner, g.token, g.expires)},'provider_failed')`
        ),
        ctx.s("b").send(
          `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${lease(g.owner, g.token, g.expires)},NULL,${lit(g.plannedKey)},${g.metaJson})`
        ),
      ]);
      const wins = [r1, r2].filter((r) => !r.error).length;
      const terminal = await s.scalar(
        `SELECT status FROM public.generations WHERE id=${lit(g.id)}`
      );
      const refunds = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions
          WHERE generation_id=${lit(g.id)} AND entry_kind='refund'`
      );
      const credits = await s.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      if (wins !== 1) {
        throw new Error(
          `expected exactly one terminal winner, got ${wins}; ` +
            `fail=${r1.error ?? "<success>"}; complete=${r2.error ?? "<success>"}; ` +
            `terminal=${terminal}; refunds=${refunds}; credits=${credits}`
        );
      }
      if (terminal !== "failed" && terminal !== "completed") {
        throw new Error(`terminal race left status=${terminal}`);
      }
      const expectedRefunds = terminal === "failed" ? 1 : 0;
      const expectedCredits = terminal === "failed" ? 1000 : 990;
      if (Number(refunds) !== expectedRefunds || Number(credits) !== expectedCredits) {
        throw new Error(
          `terminal=${terminal} produced refunds=${refunds}/credits=${credits}; ` +
            `expected ${expectedRefunds}/${expectedCredits}`
        );
      }
    },
  },
  {
    id: "R45",
    area: "lifecycle",
    test: "bind_task_races",
    invariant: "same/different task bind races",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedSubmittingVideo(s, u, c);
      await s.ok(
        `SELECT public.bind_canvas_generation_task_v1(${lit(u)},${lit(g.id)},${bearer(g.token)},'task-1')`
      );
      // second bind of the SAME task must now reject (strict, no early return)
      await s.expectError(
        `SELECT public.bind_canvas_generation_task_v1(${lit(u)},${lit(g.id)},${bearer(g.token)},'task-1')`,
        "rebind same task"
      );
      // but the exact-identity replay must succeed with zero mutation
      const out = await s.ok(
        `SELECT task_id FROM public.replay_canvas_generation_bind_v1(
           ${lit(u)},${lit(g.id)},${lit(g.actionId)},${lit(c)},'n1',${lit(FP)},'task-1')`
      );
      if (out.trim() !== "task-1") throw new Error("bind replay did not return the bound task");
      // a DIFFERENT task must reject
      await s.expectError(
        `SELECT public.bind_canvas_generation_task_v1(${lit(u)},${lit(g.id)},${bearer(g.token)},'task-2')`,
        "different task"
      );
    },
  },

  /* ============================ 9. authority ============================= */
  {
    id: "R46",
    area: "authority",
    test: "authority_strict_keys",
    invariant: "missing/unknown/extra keys reject before row lookup",
    async run(ctx) {
      const s = ctx.s("m");
      for (const dto of [
        `'{}'::jsonb`,
        `'{"kind":"submission_bearer"}'::jsonb`,
        `'{"kind":"submission_bearer","bearerToken":"t","extra":1}'::jsonb`,
        `'{"kind":"nope","bearerToken":"t"}'::jsonb`,
        `'[]'::jsonb`,
        `'"str"'::jsonb`,
      ]) {
        await s.expectError(
          `SELECT public.canvas_p1_parse_authority_v1(${dto})`,
          `strict keys: ${dto}`
        );
      }
    },
  },
  {
    id: "R47",
    area: "authority",
    test: "authority_mixed_rejects",
    invariant: "mixed bearer+lease fields reject",
    async run(ctx) {
      const s = ctx.s("m");
      await s.expectError(
        `SELECT public.canvas_p1_parse_authority_v1('{"kind":"submission_bearer","bearerToken":"t","owner":"00000000-0000-0000-0000-000000000000"}'::jsonb)`,
        "bearer + lease field"
      );
      await s.expectError(
        `SELECT public.canvas_p1_parse_authority_v1('{"kind":"reconciliation_lease","owner":"00000000-0000-0000-0000-000000000000","leaseToken":"00000000-0000-0000-0000-000000000000","leaseExpiresAt":"2026-07-16T00:00:00Z","bearerToken":"t"}'::jsonb)`,
        "lease + bearer field"
      );
    },
  },
  {
    id: "R48",
    area: "authority",
    test: "authority_noncanonical_rejects",
    invariant: "blank/noncanonical UUID or non-Z timestamp rejects",
    async run(ctx) {
      const s = ctx.s("m");
      // Must contain hexadecimal letters: uppercasing an all-zero UUID is a
      // no-op and therefore cannot serve as a noncanonical-uppercase negative.
      const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      for (const dto of [
        `'{"kind":"submission_bearer","bearerToken":""}'::jsonb`,
        `'{"kind":"submission_bearer","bearerToken":"   "}'::jsonb`,
        `'{"kind":"reconciliation_lease","owner":"00000000-0000-0000-0000-00000000000G","leaseToken":"${U}","leaseExpiresAt":"2026-07-16T00:00:00Z"}'::jsonb`,
        `'{"kind":"reconciliation_lease","owner":"00000000-0000-0000-0000-000000000000","leaseToken":"${U}","leaseExpiresAt":"2026-07-16T00:00:00+00:00"}'::jsonb`,
        `'{"kind":"reconciliation_lease","owner":"${U.toUpperCase()}","leaseToken":"${U}","leaseExpiresAt":"2026-07-16T00:00:00Z"}'::jsonb`,
      ]) {
        await s.expectError(`SELECT public.canvas_p1_parse_authority_v1(${dto})`, "noncanonical");
      }
    },
  },
  {
    id: "R49",
    area: "authority",
    test: "authority_tag_mismatch",
    invariant: "bearer under reconciliation_lease (and vice versa) rejects",
    async run(ctx) {
      const s = ctx.s("m");
      await s.expectError(
        `SELECT public.canvas_p1_parse_authority_v1('{"kind":"reconciliation_lease","bearerToken":"t"}'::jsonb)`,
        "lease tag with bearer body"
      );
    },
  },

  /* ============================ 10. lease ABA ============================ */
  {
    id: "R50",
    area: "lease",
    test: "lease_aba_new_token",
    invariant: "expiry/reclaim mints a different token for the SAME worker id",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedBoundVideo(s, u, c);
      const w = g.owner;
      await s.ok(
        `UPDATE public.generations SET reconcile_lease_expires_at = now() - interval '1 second',
            next_reconcile_at = now() - interval '1 second' WHERE id=${lit(g.id)}`
      );
      const t2 = await s.scalar(
        `SELECT lease_token FROM public.claim_canvas_generation_reconciliation_v1(${lit(w)},1,60)`
      );
      if (!t2 || t2 === g.token) throw new Error("reclaim reused the old lease token (ABA)");
    },
  },
  {
    id: "R51",
    area: "lease",
    test: "lease_stale_cannot_act",
    invariant: "stale owner/token cannot bind/complete/fail/mark-unknown/release",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();

      // EVERY behaviour the invariant names is exercised.
      //
      // The previous revision named five operations and executed three: bind
      // and mark-unknown were never attempted with the stale tuple, so the
      // invariant was two-fifths prose. bind and mark-unknown both need a
      // task-LESS row (bind requires task_id IS NULL; mark-unknown requires an
      // unbound submitting row), while fail/complete/release need the BOUND
      // row -- so the two shapes are seeded separately rather than pretending
      // one row can prove all five.

      // --- shape 1: bound video. fail / complete / release ------------------
      const bound = await ctx.seedBoundVideo(s, u, c);
      const staleBound = lease(bound.owner, bound.token, bound.expires);
      await s.ok(
        `UPDATE public.generations SET reconcile_lease_token = gen_random_uuid() WHERE id=${lit(bound.id)}`
      );
      for (const [label, sql] of [
        ["fail", `SELECT public.fail_canvas_generation_v1(${lit(u)},${lit(bound.id)},${staleBound},'x')`],
        [
          "complete",
          `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(bound.id)},${staleBound},NULL,${lit(bound.plannedKey)},${bound.metaJson})`,
        ],
        [
          "release",
          `SELECT public.release_canvas_generation_reconciliation_v1(${lit(bound.id)},${staleBound})`,
        ],
      ]) {
        await s.expectError(sql, `stale token must not ${label}`);
      }

      // --- shape 2: stale unbound video. bind / mark-unknown ----------------
      // A stale-submitting video is claimable by the generic lane, which is the
      // only way to obtain a real lease tuple for an unbound row.
      const unbound = await ctx.seedSubmittingVideo(s, u, c);
      await s.ok(
        `UPDATE public.generations SET submission_started_at = now() - interval '3 minutes'
          WHERE id=${lit(unbound.id)}`
      );
      const claim = await s.ok(
        `SELECT lease_owner||'|'||lease_token||'|'||
                to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           FROM public.claim_canvas_generation_reconciliation_v1(gen_random_uuid(),100,120)
          WHERE generation_id=${lit(unbound.id)}`
      );
      if (!claim.trim()) {
        throw new Error("the generic lane did not claim the stale unbound video this scenario owns");
      }
      const [o2, t2, e2] = claim.trim().split("|");
      const staleUnbound = lease(o2, t2, e2);

      // Invalidate that exact tuple by reclaiming with a fresh token.
      await s.ok(
        `UPDATE public.generations SET reconcile_lease_token = gen_random_uuid() WHERE id=${lit(unbound.id)}`
      );

      for (const [label, sql] of [
        [
          "bind",
          `SELECT public.bind_canvas_generation_task_v1(${lit(u)},${lit(unbound.id)},${staleUnbound},'stale-task')`,
        ],
        [
          "mark-unknown",
          `SELECT public.mark_canvas_generation_unknown_v1(${lit(u)},${lit(unbound.id)},${staleUnbound},'timeout')`,
        ],
      ]) {
        await s.expectError(sql, `stale token must not ${label}`);
      }

      // And prove the stale tuple changed nothing: the row must still be an
      // unbound submitting row. A rejection that had already mutated would be
      // just as bad as an acceptance.
      const st = await s.scalar(
        `SELECT status||'|'||provider_submission_state||'|'||coalesce(task_id,'-')
           FROM public.generations WHERE id=${lit(unbound.id)}`
      );
      if (st !== "pending|submitting|-") {
        throw new Error(`stale-lease attempts mutated the row: ${st}`);
      }
    },
  },
  {
    id: "R52",
    area: "lease",
    test: "gpt_lease_aba",
    invariant: "the GPT recovery lane has the same ABA guard",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedStaleGptImage(s, u, c);
      const t1 = await s.scalar(
        `SELECT lease_token FROM public.claim_canvas_gpt_image_direct_media_recovery_v1(${lit(g.owner)},1,60)`
      );
      await s.ok(
        `UPDATE public.generations SET reconcile_lease_expires_at = now() - interval '1 second' WHERE id=${lit(g.id)}`
      );
      const t2 = await s.scalar(
        `SELECT lease_token FROM public.claim_canvas_gpt_image_direct_media_recovery_v1(${lit(g.owner)},1,60)`
      );
      if (!t2 || t1 === t2) throw new Error("GPT lane reused the lease token on reclaim");
    },
  },

  /* ============================ 11. completion =========================== */
  {
    id: "R53",
    area: "complete",
    test: "complete_planned_key_only",
    invariant: "any key other than the persisted planned key rejects",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedBoundVideo(s, u, c);
      await s.expectError(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${lease(g.owner, g.token, g.expires)},NULL,'videos/other/evil.mp4',${g.metaJson})`,
        "alternate key"
      );
    },
  },
  {
    id: "R54",
    area: "complete",
    test: "complete_metadata_identity",
    invariant: "media metadata must name this generation/user/action",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedBoundVideo(s, u, c);
      await s.expectError(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${lease(g.owner, g.token, g.expires)},NULL,${lit(g.plannedKey)},
           jsonb_build_object('generationId', gen_random_uuid()::text, 'userId', ${lit(u)}, 'actionId', ${lit(g.actionId)}))`,
        "mismatched metadata"
      );
      await s.expectError(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${lease(g.owner, g.token, g.expires)},NULL,${lit(g.plannedKey)},NULL)`,
        "absent metadata"
      );
    },
  },
  {
    id: "R55",
    area: "complete",
    test: "complete_gpt_exceptions",
    invariant: "GPT submitting (B5) and unknown (B6/9b) complete; video unknown/submitting reject",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();

      // EVERY LANE AND STATE THE TITLE NAMES.
      //
      // The previous revision proved ONE of the four cases its title claimed
      // (leased GPT stale-submitting recovery) and asserted nothing at all
      // about the GPT unknown exception 9(b) or about either forbidden video
      // case -- while its name promised all of them. A scenario that half-
      // executes its own title is worse than an absent one, because the suite
      // reports it as covering the contract.

      // --- B5: leased GPT stale-SUBMITTING -> normal completion -------------
      const gSub = await ctx.seedStaleGptImage(s, u, c);
      const cl1 = await s.ok(
        `SELECT lease_owner||'|'||lease_token||'|'||
                to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           FROM public.claim_canvas_gpt_image_direct_media_recovery_v1(${lit(gSub.owner)},100,120)
          WHERE generation_id=${lit(gSub.id)}`
      );
      if (!cl1.trim()) throw new Error("the GPT recovery lane did not claim the stale submitting row");
      const [o1, t1, e1] = cl1.trim().split("|");
      await s.ok(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(gSub.id)},${lease(o1, t1, e1)},NULL,
           ${lit(gSub.plannedKey)},
           jsonb_build_object('generationId',${lit(gSub.id)},'userId',${lit(u)},'actionId',${lit(gSub.actionId)}))`
      );
      const st1 = await s.scalar(
        `SELECT status||'|'||(output_oss_key = planned_output_oss_key)::text
           FROM public.generations WHERE id=${lit(gSub.id)}`
      );
      if (st1 !== "completed|true") {
        throw new Error(`B5 GPT stale-submitting recovery did not complete to the planned key: ${st1}`);
      }

      // --- B6 / exception 9(b): leased GPT UNKNOWN -> completion ------------
      const gUnk = await ctx.seedStaleGptImage(s, u, c);
      // Move it to unknown through the lane's own no-proof disposition, and
      // make it due so the lane can reclaim it.
      const cl2 = await s.ok(
        `SELECT lease_owner||'|'||lease_token||'|'||
                to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           FROM public.claim_canvas_gpt_image_direct_media_recovery_v1(${lit(gUnk.owner)},100,120)
          WHERE generation_id=${lit(gUnk.id)}`
      );
      if (!cl2.trim()) throw new Error("the GPT recovery lane did not claim the second stale row");
      const [o2, t2, e2] = cl2.trim().split("|");
      await s.ok(
        `SELECT public.release_canvas_gpt_image_direct_media_recovery_v1(
           ${lit(gUnk.id)},${lease(o2, t2, e2)},false,'no_proof')`
      );
      const unkState = await s.scalar(
        `SELECT provider_submission_state FROM public.generations WHERE id=${lit(gUnk.id)}`
      );
      if (unkState !== "unknown") {
        throw new Error(`no-proof GPT stale-submitting release did not converge to unknown: ${unkState}`);
      }
      await s.ok(
        `UPDATE public.generations SET next_reconcile_at = now() - interval '1 second'
          WHERE id=${lit(gUnk.id)}`
      );
      const cl3 = await s.ok(
        `SELECT lease_owner||'|'||lease_token||'|'||
                to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           FROM public.claim_canvas_gpt_image_direct_media_recovery_v1(gen_random_uuid(),100,120)
          WHERE generation_id=${lit(gUnk.id)}`
      );
      if (!cl3.trim()) throw new Error("the GPT recovery lane did not reclaim the due unknown row");
      const [o3, t3, e3] = cl3.trim().split("|");
      await s.ok(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(gUnk.id)},${lease(o3, t3, e3)},NULL,
           ${lit(gUnk.plannedKey)},
           jsonb_build_object('generationId',${lit(gUnk.id)},'userId',${lit(u)},'actionId',${lit(gUnk.actionId)}))`
      );
      const st3 = await s.scalar(
        `SELECT status||'|'||(output_oss_key = planned_output_oss_key)::text
           FROM public.generations WHERE id=${lit(gUnk.id)}`
      );
      if (st3 !== "completed|true") {
        throw new Error(`B6 GPT unknown exception 9(b) did not complete to the planned key: ${st3}`);
      }

      // --- forbidden: VIDEO unknown completion ------------------------------
      // A video that went unknown, then acquired a real generic-lane lease.
      const vid = await ctx.seedSubmittingVideo(s, u, c);
      await s.ok(
        `SELECT public.mark_canvas_generation_unknown_v1(${lit(u)},${lit(vid.id)},${bearer(vid.token)},'timeout')`
      );
      // Hand it a genuinely valid, unexpired lease tuple.
      const vo = await s.scalar("SELECT gen_random_uuid()");
      const vt = await s.scalar("SELECT gen_random_uuid()");
      const ve = await s.scalar(
        `SELECT to_char((now()+interval '120 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`
      );
      await s.ok(
        `UPDATE public.generations SET reconcile_owner=${lit(vo)}, reconcile_lease_token=${lit(vt)},
            reconcile_lease_expires_at=${lit(ve)}::timestamptz WHERE id=${lit(vid.id)}`
      );
      await s.expectError(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(vid.id)},${lease(vo, vt, ve)},NULL,
           ${lit(vid.plannedKey)},
           jsonb_build_object('generationId',${lit(vid.id)},'userId',${lit(u)},'actionId',${lit(vid.actionId)}))`,
        "video UNKNOWN completion is forbidden even with a valid lease and apparent media"
      );

      // The rejection must not have mutated it.
      const vst = await s.scalar(
        `SELECT status||'|'||provider_submission_state FROM public.generations WHERE id=${lit(vid.id)}`
      );
      if (vst !== "pending|unknown") {
        throw new Error(`the forbidden video-unknown completion mutated the row: ${vst}`);
      }
    },
  },
  {
    id: "R56",
    area: "complete",
    test: "complete_submitting_video_forbidden",
    invariant: "EVERY submitting-video completion rejects, even with a valid lease",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedSubmittingVideo(s, u, c);
      // hand it a genuinely valid, unexpired lease tuple
      const o = await s.scalar("SELECT gen_random_uuid()");
      const t = await s.scalar("SELECT gen_random_uuid()");
      const e = await s.scalar(
        `SELECT to_char((now()+interval '60 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`
      );
      await s.ok(
        `UPDATE public.generations SET reconcile_owner=${lit(o)}, reconcile_lease_token=${lit(t)},
            reconcile_lease_expires_at=${lit(e)}::timestamptz WHERE id=${lit(g.id)}`
      );
      await s.expectError(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${lease(o, t, e)},NULL,${lit(g.plannedKey)},
           jsonb_build_object('generationId',${lit(g.id)},'userId',${lit(u)},'actionId',${lit(g.actionId)}))`,
        "submitting video completion is forbidden"
      );
    },
  },
  {
    id: "R57",
    area: "complete",
    test: "bind_schedules_one_interval",
    invariant: "the first bind schedules exactly one stored interval later",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedSubmittingVideo(s, u, c);
      await s.ok(
        `SELECT public.bind_canvas_generation_task_v1(${lit(u)},${lit(g.id)},${bearer(g.token)},'task-x')`
      );
      const ok = await s.scalar(
        `SELECT abs(extract(epoch from (next_reconcile_at - now())) * 1000 - reconcile_interval_ms) < 2000
           FROM public.generations WHERE id=${lit(g.id)}`
      );
      if (ok !== "t") throw new Error("bind did not schedule exactly one stored interval later");
    },
  },
  {
    id: "R58",
    area: "complete",
    test: "release_future_due",
    invariant: "a released row is not immediately reclaimable",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedBoundVideo(s, u, c);
      await s.ok(
        `SELECT public.release_canvas_generation_reconciliation_v1(${lit(g.id)},${lease(g.owner, g.token, g.expires)})`
      );

      // SCOPED, not global.
      //
      // The previous revision claimed with limit 10 across the WHOLE database
      // and required the result to be EMPTY. That is a global assertion over
      // residue: R45 binds a video and leaves it with next_reconcile_at =
      // now() + 5s, so once five seconds had elapsed that unrelated row became
      // due, got claimed here, and failed THIS scenario for something another
      // scenario did. The suite's verdict depended on wall-clock timing and
      // scenario order.
      //
      // What this scenario actually claims to test is "MY released row is not
      // immediately reclaimable". So it asks exactly that: claim broadly, then
      // check whether MY id came back. Other scenarios' rows may legitimately be
      // due and are none of this scenario's business.
      //
      // Claiming still leases whatever else was due, which is harmless: every
      // scenario asserts only over rows it owns.
      const claimed = await s.ok(
        `SELECT generation_id FROM public.claim_canvas_generation_reconciliation_v1(gen_random_uuid(),100,60)`
      );
      const ids = claimed.split("\n").map((x) => x.trim()).filter(Boolean);
      if (ids.includes(g.id)) {
        throw new Error(
          "a released row was immediately reclaimable; its future next_reconcile_at did not " +
            "prevent reclaim"
        );
      }
    },
  },
  {
    id: "R59",
    area: "complete",
    test: "reconcile_excludes_terminal",
    invariant: "completed/failed/legacy rows are never claimed",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();

      // Three distinct exclusions, each proven on a row THIS scenario owns:
      // completed, failed, and a legacy (action_id IS NULL) row.
      const completed = await ctx.seedBoundVideo(s, u, c);
      await s.ok(
        `SELECT public.complete_canvas_generation_v1(
           ${lit(u)},${lit(completed.id)},${lease(completed.owner, completed.token, completed.expires)},
           NULL,${lit(completed.plannedKey)},${completed.metaJson})`
      );
      await s.ok(
        `UPDATE public.generations
            SET next_reconcile_at=now()-interval '1 minute'
          WHERE id=${lit(completed.id)}`
      );

      const failed = await ctx.seedBoundVideo(s, u, c);
      await s.ok(
        `SELECT public.fail_canvas_generation_v1(
           ${lit(u)},${lit(failed.id)},${lease(failed.owner, failed.token, failed.expires)},
           'fixture_terminal_exclusion')`
      );
      await s.ok(
        `UPDATE public.generations
            SET next_reconcile_at=now()-interval '1 minute'
          WHERE id=${lit(failed.id)}`
      );

      const legacyId = (
        await s.ok(
          `INSERT INTO public.generations (user_id, type, source, status, task_id)
           VALUES (${lit(u)},'video','quick_gen','processing','legacy-task') RETURNING id`
        )
      ).trim();

      const claimed = await s.ok(
        `SELECT generation_id FROM public.claim_canvas_generation_reconciliation_v1(gen_random_uuid(),100,60)`
      );
      const ids = claimed.split("\n").map((x) => x.trim()).filter(Boolean);

      // Scoped: only MY rows are asserted over.
      for (const [label, id] of [
        ["completed", completed.id],
        ["failed", failed.id],
        ["legacy (action_id IS NULL)", legacyId],
      ]) {
        if (ids.includes(id)) throw new Error(`a ${label} row was claimed by the generic lane`);
      }
    },
  },
  {
    id: "R60",
    area: "complete",
    test: "complete_negative_crossproduct",
    invariant: "one-dimension-at-a-time negatives all reject",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedBoundVideo(s, u, c);
      const good = lease(g.owner, g.token, g.expires);
      const cases = [
        // wrong authority tag
        [`${bearer("anything")}`, g.plannedKey, g.metaJson, "bearer on a bound video"],
        // expired lease
        [
          lease(g.owner, g.token, "2000-01-01T00:00:00Z"),
          g.plannedKey,
          g.metaJson,
          "expired lease",
        ],
        // wrong owner
        [
          lease("00000000-0000-0000-0000-000000000000", g.token, g.expires),
          g.plannedKey,
          g.metaJson,
          "wrong owner",
        ],
        // text output on a media row
        [good, null, g.metaJson, "missing key"],
      ];
      for (const [auth, key, meta, label] of cases) {
        await s.expectError(
          `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${auth},NULL,${key ? lit(key) : "NULL"},${meta ?? "NULL"})`,
          label
        );
      }
      // already-completed must reject and direct to replay
      await s.ok(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${good},NULL,${lit(g.plannedKey)},${g.metaJson})`
      );
      await s.expectError(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${good},NULL,${lit(g.plannedKey)},${g.metaJson})`,
        "completion must not be idempotent; replay is the boundary"
      );
    },
  },

  /* ============================ 12. sweeper ============================== */
  {
    id: "R61",
    area: "sweeper",
    test: "sweep_vs_late_success_both_orders",
    invariant: "stale sweep vs exact original-token late success, both orders",
    async run(ctx) {
      const s = ctx.s("m");
      for (const sweepFirst of [true, false]) {
        const { u, c } = await ctx.seedCanvas();
        const g = await ctx.seedStaleText(s, u, c);
        if (sweepFirst) {
          await s.ok(`SELECT public.sweep_stale_canvas_text_submission_unknown_v1(50)`);
          await s.ok(
            `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${bearer(g.token)},'late text',NULL,NULL)`
          );
        } else {
          await s.ok(
            `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${bearer(g.token)},'late text',NULL,NULL)`
          );
          await s.ok(`SELECT public.sweep_stale_canvas_text_submission_unknown_v1(50)`);
        }
        const st = await s.scalar(
          `SELECT status||'|'||coalesce(output_text,'-') FROM public.generations WHERE id=${lit(g.id)}`
        );
        if (st !== "completed|late text") {
          throw new Error(`order sweepFirst=${sweepFirst} converged wrong: ${st}`);
        }
      }
    },
  },
  {
    id: "R62",
    area: "sweeper",
    test: "sweep_no_side_effects",
    invariant: "the sweeper performs zero refund/resubmit side effects",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedStaleText(s, u, c);
      const before = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions WHERE user_id=${lit(u)}`
      );
      await s.ok(`SELECT public.sweep_stale_canvas_text_submission_unknown_v1(50)`);
      const after = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions WHERE user_id=${lit(u)}`
      );
      if (before !== after) throw new Error("sweeper wrote a ledger row");
      const hash = await s.scalar(
        `SELECT submission_token_hash IS NOT NULL FROM public.generations WHERE id=${lit(g.id)}`
      );
      if (hash !== "t") throw new Error("sweeper dropped the submission hash");
    },
  },
  {
    id: "R63",
    area: "sweeper",
    test: "sweep_concurrent_idempotent",
    invariant: "concurrent sweepers transition a row at most once",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      await ctx.seedStaleText(s, u, c);
      const res = await ctx.concurrentRequests(
        4,
        "sw",
        (x) => x.send(`SELECT count(*) FROM public.sweep_stale_canvas_text_submission_unknown_v1(50)`)
      );
      const total = res.reduce((a, r) => a + Number(r.stdout.trim() || 0), 0);
      if (total > 1) throw new Error(`row swept ${total} times`);
    },
  },
  {
    id: "R64",
    area: "sweeper",
    test: "text_unknown_token_mismatch",
    invariant: "a wrong token on unknown text rejects",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedStaleText(s, u, c);
      await s.ok(`SELECT public.sweep_stale_canvas_text_submission_unknown_v1(50)`);
      await s.expectError(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${bearer("wrong-token")},'x',NULL,NULL)`,
        "token mismatch"
      );
    },
  },

  /* ============================ 13. kill points ========================== */
  {
    id: "R65",
    area: "killpoint",
    test: "kill_after_begin",
    invariant: "a lost begin response is found by the read-only lookup",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const { actionId } = await beginAction(s, u, c);
      const found = await s.scalar(
        `SELECT count(*) FROM public.lookup_canvas_generation_v1(${lit(u)},${lit(c)},'n1',${lit(actionId)})`
      );
      if (Number(found) !== 1) throw new Error("lookup did not find the charged row");
      const used = await s.scalar(
        `SELECT used FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      if (Number(used) !== 1) throw new Error("a passive lookup consumed quota");
    },
  },
  {
    id: "R66",
    area: "killpoint",
    test: "kill_after_claim",
    invariant: "a claimed action cannot be re-claimed",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const { actionId } = await beginAction(s, u, c);
      const rev = await s.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      await s.ok(
        `SELECT public.claim_canvas_generation_submission_v1(${lit(u)},${lit(c)},'n1',${lit(actionId)},${rev},'tab-1',${lit(FP)})`
      );
      await s.expectError(
        `SELECT public.claim_canvas_generation_submission_v1(${lit(u)},${lit(c)},'n1',${lit(actionId)},${rev},'tab-1',${lit(FP)})`,
        "re-claim"
      );
    },
  },
  {
    id: "R67",
    area: "killpoint",
    test: "kill_before_bind",
    invariant: "a late bearer bind works after an accepted task",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedSubmittingVideo(s, u, c);
      await s.ok(
        `SELECT public.mark_canvas_generation_unknown_v1(${lit(u)},${lit(g.id)},${bearer(g.token)},'timeout')`
      );
      // the original bearer may still bind a late task from unknown
      await s.ok(
        `SELECT public.bind_canvas_generation_task_v1(${lit(u)},${lit(g.id)},${bearer(g.token)},'late-task')`
      );
      const st = await s.scalar(
        `SELECT status||'|'||provider_submission_state FROM public.generations WHERE id=${lit(g.id)}`
      );
      if (st !== "processing|bound") throw new Error(`late bind produced ${st}`);
    },
  },
  {
    id: "R68",
    area: "killpoint",
    test: "kill_after_upload",
    invariant: "an upload crash converges via exact-key completion",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedStaleGptImage(s, u, c);
      const cl = await s.ok(
        `SELECT lease_owner||'|'||lease_token||'|'||to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           FROM public.claim_canvas_gpt_image_direct_media_recovery_v1(gen_random_uuid(),1,120)`
      );
      const [o, t, e] = cl.trim().split("|");
      await s.ok(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${lease(o, t, e)},NULL,${lit(g.plannedKey)},
           jsonb_build_object('generationId',${lit(g.id)},'userId',${lit(u)},'actionId',${lit(g.actionId)}))`
      );
      const k = await s.scalar(
        `SELECT output_oss_key = planned_output_oss_key FROM public.generations WHERE id=${lit(g.id)}`
      );
      if (k !== "t") throw new Error("recovery did not write the exact planned key");
    },
  },
  {
    id: "R69",
    area: "killpoint",
    test: "kill_after_complete_replay",
    invariant: "a lost completion response replays as a zero-mutation no-op",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const g = await ctx.seedBoundVideo(s, u, c);
      await s.ok(
        `SELECT public.complete_canvas_generation_v1(${lit(u)},${lit(g.id)},${lease(g.owner, g.token, g.expires)},NULL,${lit(g.plannedKey)},${g.metaJson})`
      );
      const before = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions WHERE user_id=${lit(u)}`
      );
      const out = await s.ok(
        `SELECT output_oss_key FROM public.replay_canvas_generation_completion_v1(
           ${lit(u)},${lit(g.id)},${lit(g.actionId)},${lit(c)},'n1',${lit(FP)})`
      );
      if (out.trim() !== g.plannedKey) throw new Error("replay returned the wrong output");
      const after = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions WHERE user_id=${lit(u)}`
      );
      if (before !== after) throw new Error("replay mutated the ledger");
      // mismatched fingerprint must reject
      await s.expectError(
        `SELECT public.replay_canvas_generation_completion_v1(${lit(u)},${lit(g.id)},${lit(g.actionId)},${lit(c)},'n1',${lit("b".repeat(64))})`,
        "replay fingerprint mismatch"
      );
    },
  },

  /* ============================ 14. callsite guard ======================= */
  {
    id: "R70",
    area: "batch3",
    test: "callsite_guard_inventory",
    invariant:
      "the guard DISCOVERS mutation callsites and fails on a synthetic unreviewed addition",
    async run(ctx) {
      // Runtime half: prove the database rejects the legacy delete-ledger-first
      // pattern that src/app/api/admin/users/route.ts:428-435 still performs.
      const s = ctx.s("m");
      const u = await ctx.seedUser();
      await s.expectError(
        `DELETE FROM public.credit_transactions WHERE user_id=${lit(u)}`,
        "the admin delete-ledger-first route must now fail"
      );

      // DETECTION half. The previous revision called the (broken) static
      // checker against the real tree and passed -- which proves nothing: that
      // checker only confirmed fourteen files still existed, so it stayed green
      // whether or not it could detect anything at all.
      //
      // This plants a synthetic unreviewed credit-mutation callsite in a
      // DISPOSABLE temp fixture and requires the guard to report it as an
      // addition, and to report inventory rot for the allow-listed paths that
      // fixture lacks. Detection is demonstrated, not assumed.
      ctx.proveCallsiteGuardDetectsAddition();

      // Baseline half: the real tree must still match the frozen allowlist.
      ctx.assertCallsiteInventory();
    },
  },

  /* ============ 15. quota concurrency + UTC boundary (contract) =========== */
  {
    id: "R71",
    area: "quota",
    test: "quota_true_concurrent_19_20_21",
    invariant: "true concurrent free actions consume 19/20 then reject the 21st",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();

      // TRUE concurrency, not a sequential loop. R29 proves the limit with 20
      // sequential begins, which cannot exercise the bucket's row lock at all.
      // The contract requires the limit to hold when 21 callers race, i.e. that
      // the ON CONFLICT ... DO UPDATE ... WHERE used < quota_limit predicate is
      // what enforces it, rather than a read-then-write window.
      const rev = await s.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      const tag = await s.scalar(`SELECT writer_tag FROM public.canvases WHERE id=${lit(c)}`);

      const results = await ctx.concurrentRequests(
        21,
        "q",
        async (x, i) => {
          const act = await x.scalar("SELECT gen_random_uuid()");
          return x.send(`SELECT generation_id FROM public.begin_canvas_generation_v1(
              ${lit(u)}, ${lit(c)}, 'q${i}', ${lit(act)}, ${rev}, ${lit(tag)},
              'text', ${lit(FP)}, 'canvas-generation-v1', 'pricing-v1', 'free_quota', 0,
              'p','deepseek-chat',NULL,NULL,NULL,NULL,NULL,NULL,NULL)`);
        }
      );

      const ok = results.filter((r) => !r.error);
      const rejected = results.filter((r) => r.error);

      if (ok.length !== 20) {
        throw new Error(
          `expected exactly 20 of 21 concurrent free begins to succeed, got ${ok.length} ` +
            `(rejected ${rejected.length})`
        );
      }
      if (rejected.length !== 1) {
        throw new Error(`expected exactly 1 rejection, got ${rejected.length}`);
      }
      if (!/quota exhausted/i.test(rejected[0].error)) {
        throw new Error(`the 21st was rejected for the wrong reason: ${rejected[0].error}`);
      }

      const used = await s.scalar(
        `SELECT used FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      if (Number(used) !== 20) throw new Error(`bucket used=${used}, expected exactly 20`);

      const usage = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions
          WHERE user_id=${lit(u)} AND entry_kind='free_usage'`
      );
      if (Number(usage) !== 20) throw new Error(`expected 20 free_usage rows, got ${usage}`);
    },
  },
  {
    id: "R72",
    area: "quota",
    test: "quota_duplicate_action_consumes_nothing",
    invariant: "a duplicate free action does not consume a second allowance",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      const { actionId } = await beginAction(s, u, c);

      const usedBefore = await s.scalar(
        `SELECT used FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );

      const rev = await s.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      const tag = await s.scalar(`SELECT writer_tag FROM public.canvases WHERE id=${lit(c)}`);
      const results = await ctx.concurrentRequests(
        10,
        "qd",
        (x) =>
          x.send(`SELECT generation_id FROM public.begin_canvas_generation_v1(
              ${lit(u)}, ${lit(c)}, 'n1', ${lit(actionId)}, ${rev}, ${lit(tag)},
              'text', ${lit(FP)}, 'canvas-generation-v1', 'pricing-v1', 'free_quota', 0,
              'p','deepseek-chat',NULL,NULL,NULL,NULL,NULL,NULL,NULL)`)
      );

      const errored = results.filter((r) => r.error);
      if (errored.length > 0) {
        throw new Error(
          `${errored.length}/10 duplicate free begins errored instead of returning the existing ` +
            `row: ${errored[0].error}`
        );
      }

      const usedAfter = await s.scalar(
        `SELECT used FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      if (usedBefore !== usedAfter) {
        throw new Error(
          `duplicate free begins consumed allowance: used went ${usedBefore} -> ${usedAfter}`
        );
      }
      const usage = await s.scalar(
        `SELECT count(*) FROM public.credit_transactions
          WHERE user_id=${lit(u)} AND entry_kind='free_usage'`
      );
      if (Number(usage) !== 1) throw new Error(`expected exactly 1 free_usage row, got ${usage}`);
    },
  },
  {
    id: "R73",
    area: "quota",
    test: "quota_window_is_db_utc_day_only",
    invariant: "previous/future windows are unreachable; the bucket is the DB UTC day",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      await beginAction(s, u, c);

      // The caller cannot address any window: begin exposes no window parameter
      // at all, so the ONLY reachable bucket is the database's current UTC day.
      const params = await s.scalar(
        `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='begin_canvas_generation_v1'
            AND pg_get_function_arguments(p.oid) ~ '(quota|window)'`
      );
      if (Number(params) !== 0) {
        throw new Error("begin exposes a quota/window parameter; the caller can choose its window");
      }

      const rows = await s.scalar(
        `SELECT count(*) FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      if (Number(rows) !== 1) throw new Error(`expected exactly 1 bucket, got ${rows}`);

      const shape = await s.scalar(
        `SELECT quota_key||'|'||quota_limit||'|'||
                (window_start = date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text
           FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      if (shape !== "canvas-deepseek-v1|20|true") {
        throw new Error(`bucket is not the pinned v1 / DB-UTC-day shape: ${shape}`);
      }

      // A previous-day and a future-day bucket with an inflated limit is the
      // bypass shape; the v1 pin must reject both even from a direct insert.
      for (const [label, expr] of [
        [
          "previous",
          `(date_trunc('day', now() AT TIME ZONE 'UTC') - interval '1 day') AT TIME ZONE 'UTC'`,
        ],
        [
          "future",
          `(date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC'`,
        ],
      ]) {
        await s.expectError(
          `INSERT INTO public.generation_quota_buckets (user_id,quota_key,window_start,quota_limit,used)
           VALUES (${lit(u)},'canvas-deepseek-v1',${expr},9999,0)`,
          `${label}-window bucket with an inflated limit must be rejected by the v1 pin`
        );
      }

      // A non-midnight window is rejected by the UTC-day CHECK.
      await s.expectError(
        `INSERT INTO public.generation_quota_buckets (user_id,quota_key,window_start,quota_limit,used)
         VALUES (${lit(u)},'canvas-deepseek-v1',
                 date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '3 hours',
                 20,0)`,
        "a non-midnight window must be rejected"
      );
    },
  },

  /* =============== 16. barrier-controlled same-user lock order ============ */
  {
    id: "R74",
    area: "race",
    test: "barrier_same_user_paid_begin_lock_order",
    invariant: "a same-user paid begin serializes on the profile lock",
    async run(ctx) {
      const a = ctx.s("a");
      const b = ctx.s("b");
      const m = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();
      await ctx.topUp(m, u, 900);

      // A BARRIER, not two sequential calls. Session A holds the profile lock,
      // and B's begin must genuinely BLOCK on it. A sequential pair would pass
      // even if no lock were taken at all, so lock order would be INFERRED
      // rather than exercised. PostgreSQL's own wait_event_type is the real
      // assertion: it proves B is waiting on a lock rather than on network I/O.
      await a.begin();
      await a.ok(`SELECT credits FROM public.profiles WHERE id=${lit(u)} FOR NO KEY UPDATE`);

      const rev = await m.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      const tag = await m.scalar(`SELECT writer_tag FROM public.canvases WHERE id=${lit(c)}`);
      const act = await m.scalar("SELECT gen_random_uuid()");

      const bPid = await b.scalar("SELECT pg_backend_pid()");
      const pending = b.send(`SELECT generation_id FROM public.begin_canvas_generation_v1(
          ${lit(u)}, ${lit(c)}, 'n-barrier', ${lit(act)}, ${rev}, ${lit(tag)},
          'video', ${lit(FP)}, 'canvas-generation-v1', 'pricing-v1', 'debit', 10,
          'p','m',NULL,NULL,NULL,NULL,'video-poll-v1',5000,NULL)`);

      const blocked = await isWaitingOnDatabaseLock(m, bPid, pending);
      if (!blocked) {
        throw new Error(
          "a paid begin did NOT block behind an existing FOR NO KEY UPDATE on the same profile; " +
            "the profile lock is not serializing same-user balance mutations"
        );
      }

      await a.commit();
      const r = await pending;
      if (r.error) throw new Error(`the blocked begin failed after release: ${r.error}`);

      const credits = await m.scalar(`SELECT credits FROM public.profiles WHERE id=${lit(u)}`);
      if (Number(credits) !== 990) throw new Error(`expected 990 after one debit, got ${credits}`);
    },
  },
  {
    id: "R75",
    area: "race",
    test: "barrier_free_begin_bucket_after_profile",
    invariant: "a free begin takes the profile lock BEFORE the quota bucket",
    async run(ctx) {
      const a = ctx.s("a");
      const b = ctx.s("b");
      const m = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();

      // Prove the contractual order Canvas -> generation -> profile -> bucket by
      // holding the PROFILE and showing a free begin blocks before it can reach
      // the bucket. If begin took the bucket first, `used` would already be
      // incremented while blocked here -- so it must still be 0 at the barrier.
      await a.begin();
      await a.ok(`SELECT credits FROM public.profiles WHERE id=${lit(u)} FOR NO KEY UPDATE`);

      const rev = await m.scalar(`SELECT rev FROM public.canvases WHERE id=${lit(c)}`);
      const tag = await m.scalar(`SELECT writer_tag FROM public.canvases WHERE id=${lit(c)}`);
      const act = await m.scalar("SELECT gen_random_uuid()");

      const bPid = await b.scalar("SELECT pg_backend_pid()");
      const pending = b.send(`SELECT generation_id FROM public.begin_canvas_generation_v1(
          ${lit(u)}, ${lit(c)}, 'n-free-barrier', ${lit(act)}, ${rev}, ${lit(tag)},
          'text', ${lit(FP)}, 'canvas-generation-v1', 'pricing-v1', 'free_quota', 0,
          'p','deepseek-chat',NULL,NULL,NULL,NULL,NULL,NULL,NULL)`);

      const blocked = await isWaitingOnDatabaseLock(m, bPid, pending);
      if (!blocked) throw new Error("a free begin did not block on the profile lock");

      const usedDuring = await m.scalar(
        `SELECT coalesce(max(used), 0) FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      if (Number(usedDuring) !== 0) {
        throw new Error(
          `the quota bucket was already incremented (used=${usedDuring}) while the free begin was ` +
            "still blocked on the profile lock; the contractual profile -> bucket order is inverted"
        );
      }

      await a.commit();
      const r = await pending;
      if (r.error) throw new Error(`the blocked free begin failed after release: ${r.error}`);

      const usedAfter = await m.scalar(
        `SELECT used FROM public.generation_quota_buckets WHERE user_id=${lit(u)}`
      );
      if (Number(usedAfter) !== 1) throw new Error(`expected used=1 after release, got ${usedAfter}`);
    },
  },

  /* ================== 17. deliberate same-name drift matrix =============== */
  {
    id: "R76",
    area: "drift",
    test: "drift_matrix_same_name_objects",
    invariant:
      "wrong same-name policy/FK/CHECK/index/trigger/function-config/ACL drift fails or converges",
    async run(ctx) {
      const s = ctx.s("m");

      // Each case introduces ONE deliberate same-name drift, re-applies the
      // owning migration, and requires the accepted definition to be restored.
      // Every case runs in its own transaction and is rolled back, so a drift
      // never escapes into a later scenario.
      //
      // The previous suite's only drift test altered `duration` to text (R04).
      // That is one column type: it proved the PREFLIGHT, not the same-name
      // object guards -- which is exactly where the accepted-drift defect lived.
      const cases = [
        {
          label: "same-name policy widened to a PUBLIC catch-all",
          migration: "policy",
          drift: `DROP POLICY IF EXISTS "generations_select_own" ON public.generations;
                  CREATE POLICY "generations_select_own" ON public.generations
                      FOR ALL TO public USING (true) WITH CHECK (true);`,
          verify: async () => {
            const shape = await s.scalar(
              `SELECT p.polcmd::text||'|'||p.polpermissive::text||'|'||
                      (p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[])::text
                 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                WHERE c.relname='generations' AND p.polname='generations_select_own'`
            );
            if (shape !== "r|true|true") {
              throw new Error(`policy did not converge on the accepted shape: ${shape}`);
            }
          },
        },
        {
          label: "same-name FK with ON DELETE CASCADE instead of RESTRICT",
          migration: "foundation",
          drift: `ALTER TABLE public.credit_transactions
                      DROP CONSTRAINT credit_transactions_generation_id_fkey;
                  ALTER TABLE public.credit_transactions
                      ADD CONSTRAINT credit_transactions_generation_id_fkey
                      FOREIGN KEY (generation_id) REFERENCES public.generations(id) ON DELETE CASCADE;`,
          verify: async () => {
            const act = await s.scalar(
              `SELECT confdeltype FROM pg_constraint
                WHERE conname='credit_transactions_generation_id_fkey'`
            );
            if (act !== "r") {
              throw new Error(
                `the anchored-ledger FK did not converge back to ON DELETE RESTRICT ` +
                  `(confdeltype=${act}); CASCADE here would free operation anchors for replay`
              );
            }
          },
        },
        {
          label: "same-name quota CHECK that does not pin the v1 limit",
          migration: "foundation",
          drift: `ALTER TABLE public.generation_quota_buckets
                      DROP CONSTRAINT generation_quota_buckets_v1_limit_pinned;
                  ALTER TABLE public.generation_quota_buckets
                      ADD CONSTRAINT generation_quota_buckets_v1_limit_pinned CHECK (true);`,
          verify: async () => {
            const u = await ctx.seedUser();
            const win = await s.scalar(
              `SELECT (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text`
            );
            await s.expectError(
              `INSERT INTO public.generation_quota_buckets (user_id,quota_key,window_start,quota_limit,used)
               VALUES (${lit(u)},'canvas-deepseek-v1',${lit(win)},9999,0)`,
              "the v1 limit pin must be restored and must reject an inflated limit"
            );
          },
        },
        {
          label: "same-name action index without UNIQUE",
          migration: "foundation",
          drift: `DROP INDEX public.generations_user_action_uniq;
                  CREATE INDEX generations_user_action_uniq
                      ON public.generations (user_id, action_id) WHERE action_id IS NOT NULL;`,
          verify: async () => {
            const uniq = await s.scalar(
              `SELECT indexdef LIKE 'CREATE UNIQUE INDEX%' FROM pg_indexes
                WHERE schemaname='public' AND indexname='generations_user_action_uniq'`
            );
            if (uniq !== "t") {
              throw new Error("the duplicate-action guarantee did not converge back to UNIQUE");
            }
          },
        },
        {
          label: "append-only ledger trigger disabled",
          migration: "foundation",
          drift: `ALTER TABLE public.credit_transactions
                      DISABLE TRIGGER canvas_p1_credit_transactions_append_only;`,
          verify: async () => {
            const en = await s.scalar(
              `SELECT tgenabled FROM pg_trigger
                WHERE tgrelid='public.credit_transactions'::regclass
                  AND tgname='canvas_p1_credit_transactions_append_only'`
            );
            if (en === "D") {
              throw new Error("the append-only ledger trigger is still DISABLED after re-apply");
            }
          },
        },
        {
          label: "lifecycle function search_path unpinned",
          migration: "credit",
          drift: `ALTER FUNCTION public.canvas_p1_apply_credit_delta_v1(
                      uuid, text, integer, text, uuid, uuid, uuid, uuid, text, text,
                      uuid, text, text, timestamptz, text) RESET search_path;`,
          verify: async () => {
            const cfg = await s.scalar(
              `SELECT coalesce(array_to_string(proconfig, ','), '<none>') FROM pg_proc
                WHERE oid='public.canvas_p1_apply_credit_delta_v1(uuid, text, integer, text, uuid, uuid, uuid, uuid, text, text, uuid, text, text, timestamptz, text)'::regprocedure`
            );
            if (!cfg.includes("search_path")) {
              throw new Error(`the shared credit boundary is running unpinned: proconfig=${cfg}`);
            }
          },
        },
        {
          label: "hostile client EXECUTE granted on the shared credit boundary",
          migration: "credit",
          drift: `GRANT EXECUTE ON FUNCTION public.canvas_p1_apply_credit_delta_v1(
                      uuid, text, integer, text, uuid, uuid, uuid, uuid, text, text,
                      uuid, text, text, timestamptz, text) TO anon;`,
          verify: async () => {
            const has = await s.scalar(
              `SELECT has_function_privilege('anon','public.canvas_p1_apply_credit_delta_v1(uuid, text, integer, text, uuid, uuid, uuid, uuid, text, text, uuid, text, text, timestamptz, text)','EXECUTE')`
            );
            if (has === "t") {
              throw new Error("anon retains EXECUTE on the shared credit boundary after re-apply");
            }
          },
        },
      ];

      for (const kase of cases) {
        await s.ok("BEGIN");
        try {
          await s.ok(kase.drift);
          const r = await s.send(ctx.migrationSql(kase.migration));
          if (r.error) {
            throw new Error(`[${kase.label}] re-apply FAILED instead of converging: ${r.error}`);
          }
          await kase.verify();
        } finally {
          await s.ok("ROLLBACK");
        }
      }
    },
  },

  /* ============ 18. one-dimension lane negatives (contract item 10/11) ==== */
  {
    id: "R77",
    area: "lane",
    test: "lane_negatives_one_dimension_at_a_time",
    invariant: "generic and GPT lanes reject a row that differs in exactly one dimension",
    async run(ctx) {
      const s = ctx.s("m");
      const { u, c } = await ctx.seedCanvas();

      // GENERIC LANE: a pending/bound/task row must NOT be claimable. The lane
      // requires processing/bound/task, and every operation it hands a lease to
      // (fail, complete) requires processing/bound/task too -- so claiming a
      // pending/bound row would issue a lease no operation could use.
      const g = await ctx.seedBoundVideo(s, u, c);
      await s.ok("BEGIN");
      try {
        await s.ok(
          `UPDATE public.generations
              SET status='pending',
                  reconcile_owner=NULL, reconcile_lease_token=NULL, reconcile_lease_expires_at=NULL,
                  next_reconcile_at=now()-interval '1 minute'
            WHERE id=${lit(g.id)}`
        );
        const claimed = await s.ok(
          `SELECT generation_id FROM public.claim_canvas_generation_reconciliation_v1(gen_random_uuid(),100,60)`
        );
        const ids = claimed.split("\n").map((x) => x.trim()).filter(Boolean);
        if (ids.includes(g.id)) {
          throw new Error(
            "the generic lane claimed a pending/bound/task row; it must require the exact " +
              "processing/bound/task tuple"
          );
        }
      } finally {
        await s.ok("ROLLBACK");
      }

      // GPT LANE: the exact profile string with a DRIFTED interval must not be
      // claimable. The contract pins gpt-image-2-poll-v1 to exactly 30000 ms as
      // a PAIR, so the profile string alone is not the lane's identity.
      const gpt = await ctx.seedStaleGptImage(s, u, c);
      await s.ok("BEGIN");
      try {
        await s.ok(
          `UPDATE public.generations SET reconcile_interval_ms=${GPT_INTERVAL + 1}
            WHERE id=${lit(gpt.id)}`
        );
        const claimed = await s.ok(
          `SELECT generation_id FROM public.claim_canvas_gpt_image_direct_media_recovery_v1(gen_random_uuid(),100,60)`
        );
        const ids = claimed.split("\n").map((x) => x.trim()).filter(Boolean);
        if (ids.includes(gpt.id)) {
          throw new Error(
            `the GPT recovery lane claimed a ${GPT_PROFILE} row whose interval is not exactly ` +
              `${GPT_INTERVAL} ms; the profile/interval pair must be pinned together`
          );
        }
      } finally {
        await s.ok("ROLLBACK");
      }

      // CROSS-LANE: a GPT-profile row BOUND to a task belongs to the generic
      // lane, and the GPT release path must refuse to launder it.
      const gptBound = await ctx.seedStaleGptImage(s, u, c);
      const cl = await s.ok(
        `SELECT lease_owner||'|'||lease_token||'|'||
                to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           FROM public.claim_canvas_gpt_image_direct_media_recovery_v1(${lit(gptBound.owner)},100,120)
          WHERE generation_id=${lit(gptBound.id)}`
      );
      if (!cl.trim()) throw new Error("the GPT lane did not claim its stale row");
      const [o, t, e] = cl.trim().split("|");
      await s.ok("BEGIN");
      try {
        await s.ok(`UPDATE public.generations SET task_id='sneaky' WHERE id=${lit(gptBound.id)}`);
        await s.expectError(
          `SELECT public.release_canvas_gpt_image_direct_media_recovery_v1(
             ${lit(gptBound.id)},${lease(o, t, e)},false,'x')`,
          "a task-bearing GPT row belongs to the generic bound-task lane and must not be released here"
        );
      } finally {
        await s.ok("ROLLBACK");
      }
    },
  },
];

export const REGISTRY = new Map(SCENARIOS.map((s) => [s.test, s]));

/**
 * THE SINGLE AUTHORITATIVE SCENARIO REGISTRY CHECK.
 *
 * Fails if an id is missing, duplicated, unimplemented, or registered without
 * executable assertions. The last one is the important one: the whole reason
 * this file was rewritten is that the original 70 entries were names and prose
 * with no implementation, and the registry check of the day was satisfied by
 * "unique ids, nonblank strings, count >= 70" -- which a prose array passes
 * perfectly.
 *
 * A scenario is only counted as implemented if it has a real async `run(ctx)`
 * that takes the database context AND actually asserts something. A body that
 * cannot throw cannot fail, and a test that cannot fail is not evidence.
 */
export function assertEveryScenarioImplemented() {
  const problems = [];
  const seenIds = new Set();
  const seenTests = new Set();

  for (const s of SCENARIOS) {
    const label = `${s.id ?? "<no id>"} ${s.test ?? "<no test>"}`;

    if (!s.id || typeof s.id !== "string") problems.push(`${label}: missing id`);
    else if (seenIds.has(s.id)) problems.push(`${label}: DUPLICATE id`);
    else seenIds.add(s.id);

    if (!s.test || typeof s.test !== "string") problems.push(`${label}: missing test name`);
    else if (seenTests.has(s.test)) problems.push(`${label}: DUPLICATE test name`);
    else seenTests.add(s.test);

    if (!s.invariant || typeof s.invariant !== "string" || s.invariant.trim().length === 0) {
      problems.push(`${label}: missing invariant`);
    }

    if (typeof s.run !== "function") {
      problems.push(`${label}: NO IMPLEMENTATION`);
      continue;
    }
    if (s.run.constructor.name !== "AsyncFunction") {
      problems.push(`${label}: run() is not async, so it cannot execute SQL`);
    }
    if (s.run.length < 1) {
      problems.push(`${label}: run() takes no database context, so it cannot touch a database`);
    }

    // EXECUTABLE ASSERTIONS. A body with no throw/expectError path can only
    // ever pass, which is indistinguishable from prose.
    const body = s.run.toString();
    const asserts =
      /\bthrow\s+new\s+Error\b/.test(body) ||
      /\bexpectError\s*\(/.test(body) ||
      /\bexpectBeginError\s*\(/.test(body) ||
      /\bassertCallsiteInventory\s*\(/.test(body) ||
      /\bproveCallsiteGuardDetectsAddition\s*\(/.test(body);
    if (!asserts) {
      problems.push(
        `${label}: registered without executable assertions (no throw/expectError path); ` +
          "a scenario that cannot fail is not evidence"
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`scenario registry is not authoritative:\n  - ${problems.join("\n  - ")}`);
  }
  return SCENARIOS.length;
}
