#!/usr/bin/env node
/**
 * Canvas P1 · Batch 2 · frozen pre-apply / post-apply / reapply manifests.
 *
 * WHY THESE ARE COMPOSED HERE RATHER THAN COPY-PASTED
 * ---------------------------------------------------------------------------
 * Ten of the pre-apply sections already exist as independently verified data:
 * Codex re-derived `expected-catalog.json` from the retained production artifact
 * SHA-256 C3BBA412...E6486 through a reviewed whitelist and matched all eleven
 * sections and every per-section canonical hash exactly.
 *
 * Copying those rows into a second file would fork that provenance: the copy
 * could drift from the verified original and nothing would notice. Instead the
 * accepted artifact is loaded and its SHA-256 is PINNED to the value Codex
 * accepted. If `expected-catalog.json` changes by one byte, every manifest here
 * refuses to load. The frozen additions that the accepted artifact does not
 * carry live in `manifest-additions.json`, which is plain frozen data.
 *
 * This is derivation-with-provenance, not a caller-supplied callback: no caller
 * can inject or override a section, the composition is fixed, and the inputs
 * are hash-pinned.
 *
 * WHAT "FROZEN" MEANS FOR THE POST-APPLY / REAPPLY MANIFESTS
 * ---------------------------------------------------------------------------
 * Until the first authorized Preview apply they remain explicitly UNPROVEN.
 * Phase 3 captures the real PostgreSQL renderings through the closed read-only
 * probe, reviews them, then freezes the same measured catalog for post-apply
 * and reapply. Source-derived guesses are never accepted as evidence.
 *
 * UNPROVEN SECTIONS ARE A REFUSAL, NOT A WILDCARD
 * ---------------------------------------------------------------------------
 * A surface whose expected value is not established by reviewed evidence is
 * marked UNPROVEN. The gate then REFUSES. Fabricating a plausible value would
 * be worse than refusing, and omitting the section would be worse still --
 * that is precisely the "vacuous pass" the empty-ACL disposition warns about.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REQUIRED_POST_APPLY_SECTIONS, UNPROVEN, sha256Hex } from "./target.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..");

/**
 * The exact accepted identity of the Batch 1B expected catalog.
 *
 * Recorded by Codex on 2026-07-15 after re-deriving it independently from the
 * production artifact and matching all eleven sections. Pinned here so this
 * module fails closed rather than silently composing a manifest from a drifted
 * or substituted artifact.
 */
export const ACCEPTED_EXPECTED_CATALOG_SHA256 =
  "60747532147a5be8f8593661275c39977ff09b9344c397827f9cceffa8b3b93d";

export const EXPECTED_CATALOG_PATH = join(FIXTURE_DIR, "expected-catalog.json");
export const ADDITIONS_PATH = join(__dirname, "manifest-additions.json");
export const POST_APPLY_CATALOG_PATH = join(__dirname, "post-apply-catalog.json");
export const POST_APPLY_CATALOG_SHA256 =
  "f45d91fcf9a4074ff440549c37cca512dc949158b0b0758897a13cf26f89e30f";
let postApplyCatalogCache = null;

function loadAcceptedCatalog() {
  const raw = readFileSync(EXPECTED_CATALOG_PATH, "utf8");
  const actual = sha256Hex(raw);
  if (actual !== ACCEPTED_EXPECTED_CATALOG_SHA256) {
    throw new Error(
      `FAIL-CLOSED: expected-catalog.json SHA-256 is ${actual}, expected the Codex-accepted ` +
        `${ACCEPTED_EXPECTED_CATALOG_SHA256}. The Batch 2 manifests are composed from that exact ` +
        "artifact; refusing to build evidence on a drifted baseline."
    );
  }
  return JSON.parse(raw);
}

function loadAdditions() {
  return JSON.parse(readFileSync(ADDITIONS_PATH, "utf8"));
}

function loadPostApplyCatalog() {
  if (postApplyCatalogCache) return postApplyCatalogCache;
  const raw = readFileSync(POST_APPLY_CATALOG_PATH, "utf8");
  const actual = sha256Hex(raw);
  if (actual !== POST_APPLY_CATALOG_SHA256) {
    throw new Error(
      `FAIL-CLOSED: post-apply-catalog.json SHA-256 is ${actual}, expected the reviewed Preview ` +
        `${POST_APPLY_CATALOG_SHA256}. Refusing to build post-apply evidence from drifted bytes.`
    );
  }
  const catalog = JSON.parse(raw);
  const expectedSections = [...REQUIRED_POST_APPLY_SECTIONS].sort();
  const actualSections = Object.keys(catalog).sort();
  if (JSON.stringify(actualSections) !== JSON.stringify(expectedSections)) {
    throw new Error(
      "FAIL-CLOSED: post-apply-catalog.json does not contain exactly the required catalog sections."
    );
  }
  const deepFreeze = (value) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  };
  postApplyCatalogCache = deepFreeze(catalog);
  return postApplyCatalogCache;
}

/**
 * Unfold an accepted FOLDED ACL section into the FLAT shape the introspection
 * emits.
 *
 * `expected-catalog.json` stores relation/default ACLs folded
 * ({table, grants:[{grantee, privileges:[..]}]}) because the Batch 1B verifier
 * folds the actual rows before comparing. `batch2-introspect.sql` emits the
 * flat rows directly for these two sections, matching the accepted Batch 1B
 * introspection shape. This turns one into the other with no information added
 * or lost, so the comparison still rests on the verified data.
 */
function unfoldRelationAcl(folded) {
  const rows = [];
  for (const entry of folded) {
    for (const grant of entry.grants) {
      for (const privilege of grant.privileges) {
        rows.push({ table: entry.table, grantee: grant.grantee, privilege });
      }
    }
  }
  return rows;
}

function unfoldDefaultAcl(folded) {
  const rows = [];
  for (const entry of folded) {
    // Only defaults that can affect objects this migration creates are in the
    // safety surface. The remote backend identity is proven as postgres and
    // every new object is schema-qualified under public, so supabase_admin and
    // other platform-role defaults are unrelated platform inventory. Global
    // postgres defaults would also apply and are intentionally retained.
    if (
      entry.owner !== "postgres" ||
      (entry.schema !== "public" && entry.schema !== null)
    ) {
      continue;
    }
    for (const grant of entry.grants) {
      for (const privilege of grant.privileges) {
        rows.push({
          owner: entry.owner,
          schema: entry.schema,
          object_type: entry.object_type,
          grantee: grant.grantee,
          privilege,
        });
      }
    }
  }
  return rows;
}

/**
 * The frozen PRE-APPLY manifest.
 *
 * Ten sections come verbatim from the hash-pinned accepted catalog. The rest are
 * frozen additions whose values are established by reviewed evidence:
 *
 *  * target_expectations  -- the four baseline tables are present ordinary
 *    tables (accepted catalog `relations`); generation_quota_buckets does NOT
 *    yet exist, which is what makes this a pre-apply state.
 *  * column_acl           -- measured as exactly ZERO rows on both production
 *    and the Preview Branch (Codex, 2026-07-16: "128 relation ACL rows, 0
 *    column ACL rows"). This migration grants column-level SELECT/UPDATE, so
 *    the section going from empty to populated is a real transition and the
 *    empty side must be asserted explicitly rather than skipped.
 *  * lifecycle_routines   -- MUST be empty. A pre-existing routine under a
 *    lifecycle name would either be replaced while keeping its old ACL, or --
 *    with a different signature -- become an overload that CREATE OR REPLACE
 *    never touches: an unreviewed function reachable under a reviewed name.
 *  * auth_signup_trigger / auth_user_triggers -- directly measured on the
 *    current Preview Branch as absent / empty. The migration repairs the
 *    missing trigger after refusing any competing registration trigger.
 *  * handle_new_user      -- directly measured in both retained catalog
 *    artifacts: plpgsql SECURITY DEFINER RETURNS TRIGGER, owner postgres,
 *    config `search_path=public`.
 *  * trigger_functions    -- directly measured, redacted identity/config/ACL
 *    shape from both retained artifacts. See manifest-additions.json.
 */
export function loadPreApplyManifest() {
  const accepted = loadAcceptedCatalog();
  const add = loadAdditions();

  return Object.freeze({
    manifestVersion: "canvas-p1-batch2-pre-apply-v1",
    provenance: Object.freeze({
      acceptedExpectedCatalogSha256: ACCEPTED_EXPECTED_CATALOG_SHA256,
      productionArtifactSha256:
        "c3bba412da5632d5d2c2c34bba82fd1f7ad81ab1d8880c88285e50cb5d6e6486",
      previewBranchContainerSha256:
        "4d67655c5beea00e9b86be354c7447adc827c61ed49a2c076e36fe8b2b176202",
      note:
        "Ten sections are the Codex-verified expected-catalog.json rows verbatim. The rest are " +
        "frozen additions established from reviewed evidence; see manifest-additions.json.",
    }),
    sections: Object.freeze({
      // --- verbatim from the hash-pinned accepted catalog ------------------
      columns: accepted.columns,
      constraints: accepted.constraints,
      indexes: accepted.indexes,
      relations: accepted.relations,
      policies: accepted.policies,
      incoming_foreign_keys: accepted.incoming_foreign_keys,
      profile_key_columns: accepted.profile_key_columns,
      triggers: accepted.triggers,
      relation_acl: unfoldRelationAcl(accepted.relation_acl),
      default_acl: unfoldDefaultAcl(accepted.default_acl),

      // --- frozen additions ------------------------------------------------
      target_expectations: add.preApply.target_expectations,
      column_acl: add.preApply.column_acl,
      trigger_functions: add.preApply.trigger_functions,
      lifecycle_routines: add.preApply.lifecycle_routines,
      auth_signup_trigger: add.preApply.auth_signup_trigger,
      auth_user_triggers: add.preApply.auth_user_triggers,
      handle_new_user: add.preApply.handle_new_user,
    }),
  });
}

/**
 * The frozen POST-APPLY manifest, and the REAPPLY manifest.
 *
 * They are the SAME OBJECT by construction, and that is the entire point of the
 * idempotency claim: a second application must converge on byte-identical
 * catalog state. Returning one manifest for both is therefore not a shortcut --
 * it is the assertion. If reapply needed a different expectation, the migration
 * would not be idempotent.
 */
export function loadPostApplyManifest() {
  const catalog = loadPostApplyCatalog();
  return Object.freeze({
    manifestVersion: "canvas-p1-batch2-post-apply-v1",
    provenance: Object.freeze({
      previewBranchRef: "liibsugstuidwlmliyif",
      capturedAt: "2026-07-27",
      postApplyCatalogSha256: POST_APPLY_CATALOG_SHA256,
      postApplyCatalogDigest:
        "c41445c27ca3811172743d827fd04480f5b9aff146f1f9897763d8095a2e7d24",
      note:
        "Captured after the first authorized Preview apply and byte-identical deterministic " +
        "reapply. Redacted 18-section PostgreSQL evidence; no source-derived rendering.",
    }),
    sections: Object.freeze(catalog),
  });
}

export function loadReapplyManifest() {
  const post = loadPostApplyManifest();
  return Object.freeze({
    ...post,
    manifestVersion: "canvas-p1-batch2-reapply-v1",
    provenance: Object.freeze({
      note:
        "Identical to the post-apply manifest BY DESIGN. A deterministic second apply must " +
        "converge on the same catalog; a reapply expectation that differed from post-apply would " +
        "be an admission that the migration is not idempotent.",
    }),
  });
}

/** Section names a manifest currently marks UNPROVEN. */
export function unprovenSections(manifest) {
  return Object.keys(manifest.sections).filter((k) => manifest.sections[k] === UNPROVEN);
}
