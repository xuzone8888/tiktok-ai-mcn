#!/usr/bin/env node
/**
 * Canvas P1 · Batch 2 · long-lived psql session.
 *
 * Real concurrent database sessions with real transaction barriers. A
 * spawnSync-per-statement helper cannot express "session A holds a row lock
 * while session B blocks on it", which is exactly what the lock-order, race and
 * ABA evidence requires. So each session is a persistent psql child whose stdin
 * stays open; statements are written to it and results are read back
 * asynchronously, which lets a caller START a statement, prove it is still
 * blocked, release the other session, and only then await it.
 *
 * All connections go through the same explicit, validated argv the target guard
 * builds -- there is no connection string and no credential handling here.
 */
import { spawn } from "node:child_process";

import { resolvePsql } from "../identity.mjs";
import {
  assertRemoteTlsRootCertificate,
  buildChildEnv,
  isGated,
  TargetRefusal,
} from "./target.mjs";

const SENTINEL = "__CANVAS_P1_EOS__";

// The Preview Session Pooler exposes 15 slots. Keep three slots in reserve for
// named main/barrier/monitor sessions and platform activity; logical request
// counts may exceed this because several requests can be queued per worker.
export const MAX_CONCURRENT_SESSION_WORKERS = 12;

/**
 * Map N logical concurrent requests onto a bounded set of database sessions.
 *
 * Promise creation remains concurrent, and at least two workers exercise real
 * database contention whenever N > 1. Requests assigned to the same persistent
 * psql worker are serialized by PostgreSQL's session protocol.
 */
export function buildConcurrentSessionSchedule(
  requestCount,
  workerLimit = MAX_CONCURRENT_SESSION_WORKERS
) {
  if (!Number.isInteger(requestCount) || requestCount <= 0) {
    throw new TypeError("concurrent request count must be a positive integer");
  }
  if (!Number.isInteger(workerLimit) || workerLimit <= 0) {
    throw new TypeError("concurrent worker limit must be a positive integer");
  }
  const workerCount = Math.min(requestCount, workerLimit);
  const assignments = Array.from({ length: requestCount }, (_, index) => index % workerCount);
  return Object.freeze({
    workerCount,
    assignments: Object.freeze(assignments),
  });
}

/**
 * Build one framed psql request.
 *
 * A psql meta-command does not submit a pending SQL buffer. Therefore `\echo`
 * immediately after SQL that lacks a trailing semicolon emits the sentinel
 * first and makes the caller observe an empty result while the SQL remains
 * buffered. An independent `;` line is always safe (an empty statement when
 * the caller already terminated its SQL) and guarantees the SQL is submitted
 * before the sentinel.
 */
export function buildSessionRequest(sql, id) {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new TypeError("psql session SQL must be a non-empty string");
  }
  if (!Number.isInteger(id) || id <= 0) {
    throw new TypeError("psql session request id must be a positive integer");
  }
  return `${sql}\n;\n\\echo ${SENTINEL}${id}\n`;
}

export class PsqlSession {
  #proc;
  #stdout = "";
  #stderr = "";
  #queue = [];
  #closed = false;
  #exitPromise;

  constructor(target, { name = "session" } = {}) {
    // A session is a WRITE-CAPABLE channel: it holds an open stdin and the
    // scenarios issue DDL/DML through it. target.runWrite() therefore is NOT the
    // only write path unless opening a session is itself gated -- so it is.
    // Without this, a remote session could be opened before (or instead of) the
    // read-only identity/zero-data/exact-catalog gate, which is precisely the
    // "alternate write path" the contract forbids.
    if (target.mode === "remote" && !isGated(target)) {
      throw new TargetRefusal(
        `REFUSED: cannot open psql session "${name}" against the Preview Branch before ` +
          "assertRemoteWriteAllowed() has passed for this target."
      );
    }
    if (target.mode === "remote") assertRemoteTlsRootCertificate(target);

    this.name = name;
    this.target = target;

    const args = [
      "--no-password",
      "--no-psqlrc",
      "--no-align",
      "--tuples-only",
      "--quiet",
      "-h",
      String(target.host),
      "-p",
      String(target.port),
      "-d",
      String(target.database),
      "-U",
      String(target.user),
    ];

    this.#proc = spawn(resolvePsql(), args, {
      env: buildChildEnv(target),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#exitPromise = new Promise((resolve) => {
      this.#proc.once("exit", resolve);
      this.#proc.once("error", resolve);
    });

    this.#proc.stdout.setEncoding("utf8");
    this.#proc.stderr.setEncoding("utf8");
    this.#proc.stdout.on("data", (d) => {
      this.#stdout += d;
      this.#drain();
    });
    this.#proc.stderr.on("data", (d) => {
      this.#stderr += d;
      this.#drain();
    });
    this.#proc.on("exit", () => {
      this.#closed = true;
      this.#drain(true);
    });
    this.#proc.on("error", (err) => {
      this.#stderr += `psql spawn error: ${err.message}`;
      this.#closed = true;
      this.#drain(true);
    });
  }

  #drain(force = false) {
    while (this.#queue.length > 0) {
      const head = this.#queue[0];
      const marker = SENTINEL + head.id;
      const idx = this.#stdout.indexOf(marker);

      if (idx === -1) {
        if (force && this.#closed) {
          this.#queue.shift();
          head.reject(new Error(`psql session ${this.name} exited: ${this.#stderr.trim()}`));
          continue;
        }
        return;
      }

      const out = this.#stdout.slice(0, idx);
      this.#stdout = this.#stdout.slice(idx + marker.length);
      const err = this.#stderr;
      this.#stderr = "";
      this.#queue.shift();

      head.resolve({
        stdout: out.trim(),
        stderr: err.trim(),
        error: /^(ERROR|FATAL|PANIC):/m.test(err) ? err.trim() : null,
      });
    }
  }

  /**
   * Send SQL. Returns a promise that settles when this statement finishes.
   * Deliberately NOT awaited by barrier tests until the barrier is released.
   */
  send(sql) {
    if (this.#closed) return Promise.reject(new Error(`session ${this.name} is closed`));

    const id = Math.abs(
      // deterministic per-session counter, not a random id: reproducibility
      (this.#counter = (this.#counter ?? 0) + 1)
    );

    const p = new Promise((resolve, reject) => {
      this.#queue.push({ id, resolve, reject });
    });

    this.#proc.stdin.write(buildSessionRequest(sql, id));
    return p;
  }

  #counter;

  /** Send and throw on database error. */
  async ok(sql) {
    const r = await this.send(sql);
    if (r.error) throw new Error(`[${this.name}] ${sql.slice(0, 90)} -> ${r.error}`);
    return r.stdout;
  }

  /** Send and REQUIRE a database error. Returns the error text. */
  async expectError(sql, label = "") {
    const r = await this.send(sql);
    if (!r.error) {
      throw new Error(
        `[${this.name}] expected an error${label ? ` (${label})` : ""} but the statement SUCCEEDED: ` +
          sql.slice(0, 120)
      );
    }
    return r.error;
  }

  /** Single scalar. */
  async scalar(sql) {
    const out = await this.ok(sql);
    return out.split("\n")[0]?.trim() ?? "";
  }

  async begin() {
    return this.ok("BEGIN");
  }
  async commit() {
    return this.ok("COMMIT");
  }
  async rollback() {
    return this.ok("ROLLBACK");
  }

  /** Run as a non-superuser role, so BYPASSRLS/ownership cannot mask a result. */
  async asRole(role, sql) {
    await this.ok(`SET ROLE ${role}`);
    try {
      return await this.send(sql);
    } finally {
      await this.ok("RESET ROLE");
    }
  }

  close() {
    if (!this.#closed) {
      try {
        this.#proc.stdin.end();
      } catch {
        /* already gone */
      }
    }
    return this.#exitPromise;
  }
}

/**
 * Prove a backend is waiting on a PostgreSQL lock, not merely that its network
 * response is slow. The monitor reads only wait_event_type/state and never the
 * blocked query text.
 */
export async function isWaitingOnDatabaseLock(
  monitor,
  backendPid,
  statementPromise,
  timeoutMs = 5000
) {
  const pid = Number(backendPid);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`invalid backend pid for lock proof: ${backendPid}`);
  }

  let settled = false;
  statementPromise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (settled) return false;
    const state = await monitor.scalar(
      `SELECT coalesce(wait_event_type,'') || '|' || state
         FROM pg_catalog.pg_stat_activity
        WHERE pid=${pid}`
    );
    if (state.startsWith("Lock|")) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}

/** Open N sessions against the same target. */
export function openSessions(target, count, prefix = "s") {
  return Array.from({ length: count }, (_, i) => new PsqlSession(target, { name: `${prefix}${i + 1}` }));
}
