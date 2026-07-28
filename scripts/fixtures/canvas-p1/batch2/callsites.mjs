#!/usr/bin/env node
/**
 * Canvas P1 · Batch 2 · deterministic mutation-callsite inventory.
 *
 * WHY THE PREVIOUS GUARD WAS NOT A GUARD
 * ---------------------------------------------------------------------------
 * It held fourteen hard-coded paths and checked that each still EXISTS. That is
 * structurally incapable of discovering a new unreviewed direct write: a brand
 * new route that debits credits outside the shared boundary would leave all
 * fourteen files present, so the guard would report success. Codex independently
 * found at least nine active mutation paths outside that list -- not because the
 * list was carelessly written, but because an existence check cannot find what
 * it does not already name.
 *
 * A guard that can only confirm what it already knows is a bookkeeping exercise.
 * This module DISCOVERS instead, and compares the discovery to a frozen reviewed
 * allowlist. It fails on ADDITIONS (a new unreviewed callsite) and equally on
 * REMOVALS/RENAMES (an inventoried callsite that silently moved), because a
 * disappearing entry is how an inventory rots into a comforting lie.
 *
 * SCANNER HONESTY -- WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 * This is a CONSERVATIVE LEXICAL scanner, not an AST/type-aware analysis, and it
 * is deliberately biased toward OVER-reporting. Its exact limitations, so no
 * reviewer over-trusts it:
 *
 *  * It matches a table name and a mutating method within a bounded character
 *    window. It does not resolve variables, aliases, or indirection: code that
 *    builds a table name dynamically (`from(tbl)`), wraps the client in a helper,
 *    or reaches PostgREST over raw fetch is INVISIBLE to it.
 *  * It cannot prove a matched site actually executes, nor that an unmatched
 *    file is safe. It proves only "the reviewed inventory still exactly equals
 *    what these patterns find".
 *  * It does not read SQL executed through .rpc() bodies.
 *
 * It is therefore a CHANGE DETECTOR over a reviewed baseline, which is exactly
 * what the frozen contract asks a static callsite guard to be. Its real value is
 * that it FAILS when the surface moves, forcing a human decision. It is not, and
 * must never be cited as, proof that the conversion surface is complete -- that
 * proof is Batch 3's exhaustive audit plus the runtime boundary.
 *
 * SCOPE
 * ---------------------------------------------------------------------------
 * This module only INVENTORIES. This correction is explicitly forbidden from
 * editing application callsites; converting them is Batch 3.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Mutation classes the frozen contract requires Batch 3 to convert. */
export const MUTATION_CLASSES = Object.freeze({
  PROFILE_CREDIT: "profile_credit_mutation",
  LEDGER: "ledger_mutation",
  GENERATION_LIFECYCLE: "generation_lifecycle_mutation",
  DESTRUCTIVE_ADMIN: "destructive_admin",
});

/** Directories that hold no application mutation surface. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".temp",
  "dist",
  "build",
  "coverage",
  "scripts",
  "supabase",
  ".claude",
]);

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * Lookahead window, in characters, between a table reference and a mutating
 * method. Supabase chains are commonly broken across several lines with an
 * object literal in between; 600 covers the observed shapes in this repository
 * while staying short enough that two unrelated statements do not bleed into
 * one another. Over-matching produces a false ADDITION, which fails loudly and
 * is corrected by review -- the safe direction.
 */
const WINDOW = 600;

const TABLE_REF = (table) =>
  new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)`, "g");

const MUTATING_METHOD = /\.(insert|update|upsert|delete)\s*\(/;

export function listSourceFiles(root, dir = root, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) listSourceFiles(root, full, out);
    else if (SOURCE_EXT.test(entry)) out.push(full);
  }
  return out;
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line += 1;
  return line;
}

/**
 * Find every (table, mutating method) pair in one source text.
 * Returns [{ table, method, line }].
 */
export function scanSource(src) {
  const hits = [];
  for (const table of ["profiles", "credit_transactions", "generations"]) {
    const re = TABLE_REF(table);
    let m;
    while ((m = re.exec(src)) !== null) {
      const window = src.slice(m.index, m.index + WINDOW);
      const mm = window.match(MUTATING_METHOD);
      if (!mm) continue;
      hits.push({ table, method: mm[1], line: lineOf(src, m.index) });
    }
  }
  return hits;
}

/** Map one hit to its mutation classes. */
function classifyHit(hit, windowText) {
  const classes = new Set();

  if (hit.table === "profiles") {
    if (hit.method === "delete") classes.add(MUTATION_CLASSES.DESTRUCTIVE_ADMIN);
    // A profiles UPDATE only matters here if it touches the balance. Narrowed
    // to `credits`, so ordinary self-service name/phone/avatar updates are not
    // dragged into the credit-conversion inventory and do not mask real ones.
    if (
      (hit.method === "update" || hit.method === "upsert" || hit.method === "insert") &&
      /\bcredits\b/.test(windowText)
    ) {
      classes.add(MUTATION_CLASSES.PROFILE_CREDIT);
    }
  }

  if (hit.table === "credit_transactions") {
    classes.add(MUTATION_CLASSES.LEDGER);
    if (hit.method === "delete") classes.add(MUTATION_CLASSES.DESTRUCTIVE_ADMIN);
  }

  if (hit.table === "generations") {
    classes.add(MUTATION_CLASSES.GENERATION_LIFECYCLE);
    if (hit.method === "delete") classes.add(MUTATION_CLASSES.DESTRUCTIVE_ADMIN);
  }

  return [...classes];
}

/**
 * Scan a repository root. Returns a deterministic, sorted inventory:
 *   [{ path, classes: [...sorted], evidence: [{table, method, line}] }]
 * `path` is POSIX-normalized so the frozen allowlist is portable.
 */
export function scanRepository(root) {
  const files = listSourceFiles(root).sort();
  const inventory = [];

  for (const file of files) {
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!/\.from\(/.test(src)) continue;

    const hits = scanSource(src);
    if (hits.length === 0) continue;

    const classes = new Set();
    const evidence = [];
    for (const hit of hits) {
      const idx = src.indexOf("\n".repeat(0)); // no-op; window recomputed below
      void idx;
      // Recompute the hit's window for classification.
      const re = TABLE_REF(hit.table);
      let m;
      let windowText = "";
      while ((m = re.exec(src)) !== null) {
        if (lineOf(src, m.index) === hit.line) {
          windowText = src.slice(m.index, m.index + WINDOW);
          break;
        }
      }
      const hitClasses = classifyHit(hit, windowText);
      if (hitClasses.length === 0) continue;
      for (const c of hitClasses) classes.add(c);
      evidence.push({ table: hit.table, method: hit.method, line: hit.line });
    }

    if (classes.size === 0) continue;

    inventory.push({
      path: relative(root, file).split(sep).join("/"),
      classes: [...classes].sort(),
      evidence: evidence.sort((a, b) => a.line - b.line),
    });
  }

  return inventory.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Compare a discovered inventory against the frozen reviewed allowlist.
 *
 * Fails on BOTH directions:
 *  * ADDITION      -- a discovered path the allowlist does not review. This is
 *                     the case the old guard could never see.
 *  * REMOVAL       -- an allow-listed path no longer discovered. Either it was
 *                     converted (good, but the allowlist must say so) or it was
 *                     renamed/moved (in which case the inventory is now lying).
 *  * CLASS DRIFT   -- the same path now mutates a different surface than the one
 *                     that was reviewed.
 */
export function diffAgainstAllowlist(inventory, allowlist) {
  const findings = [];
  const allowed = new Map(allowlist.callsites.map((c) => [c.path, c]));
  const found = new Map(inventory.map((c) => [c.path, c]));

  for (const item of inventory) {
    const entry = allowed.get(item.path);
    if (!entry) {
      findings.push(
        `UNREVIEWED CALLSITE: ${item.path} mutates [${item.classes.join(", ")}] ` +
          `(lines ${item.evidence.map((e) => e.line).join(", ")}) but is not in the frozen ` +
          "Batch 3 allowlist. Every mutation path must be reviewed and given a disposition."
      );
      continue;
    }
    const want = [...entry.classes].sort().join(",");
    const got = [...item.classes].sort().join(",");
    if (want !== got) {
      findings.push(
        `CLASS DRIFT: ${item.path} was reviewed as [${want}] but now mutates [${got}]. ` +
          "Its Batch 3 disposition was decided against the old class set and must be re-reviewed."
      );
    }
  }

  for (const entry of allowlist.callsites) {
    if (!found.has(entry.path)) {
      findings.push(
        `INVENTORY ROT: ${entry.path} is in the frozen allowlist but the scan no longer finds a ` +
          "mutation there. It was converted, renamed or moved. Either outcome requires updating " +
          "the allowlist -- a silently stale entry makes the inventory look complete when it is not."
      );
    }
  }

  return findings;
}
