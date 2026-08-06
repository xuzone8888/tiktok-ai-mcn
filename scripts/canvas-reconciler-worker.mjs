#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const RECONCILE_PATH = "/api/internal/canvas/reconcile";
const READY_MARKER_SCHEMA = "canvas-reconciler-ready-v2";
const MAX_ENV_FILE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_READY_MARKER_BYTES = 4096;
const DEFAULTS = Object.freeze({
  intervalMs: 15_000,
  timeoutMs: 225_000,
  maxBackoffMs: 300_000,
  limit: 10,
  leaseSeconds: 300,
  timeBudgetMs: 210_000,
  startupLockWaitMs: 15_000,
});

const SAFE_ENV_NAMES = Object.freeze({
  url: "CANVAS_RECONCILE_URL",
  intervalMs: "CANVAS_RECONCILE_INTERVAL_MS",
  timeoutMs: "CANVAS_RECONCILE_TIMEOUT_MS",
  maxBackoffMs: "CANVAS_RECONCILE_MAX_BACKOFF_MS",
  limit: "CANVAS_RECONCILE_LIMIT",
  leaseSeconds: "CANVAS_RECONCILE_LEASE_SECONDS",
  timeBudgetMs: "CANVAS_RECONCILE_TIME_BUDGET_MS",
  lockFile: "CANVAS_RECONCILE_LOCK_FILE",
});

function usage() {
  return [
    "Usage: node scripts/canvas-reconciler-worker.mjs [options]",
    "",
    "Modes:",
    "  --once                  Run one cycle and exit (cron-safe)",
    "  --dry-run               Validate configuration without a request or lock",
    "",
    "Required:",
    "  --env-file <path>       Non-symlink env file containing CANVAS_RECONCILE_SECRET",
    "  --url <loopback-url>    Exact localhost reconcile endpoint",
    "",
    "Optional:",
    "  --lock-file <path>      Singleton lock file",
    "  --interval-ms <n>       Healthy-cycle interval (default: 15000)",
    "  --timeout-ms <n>        Per-request timeout (default: 225000)",
    "  --max-backoff-ms <n>    Failure backoff ceiling (default: 300000)",
    "  --limit <n>             Claims per request, 1..100 (default: 10)",
    "  --lease-seconds <n>     Database lease, 240..300 (default: 300)",
    "  --time-budget-ms <n>    Server time budget (default: 210000)",
    "  --help                  Show this help",
    "",
    "Non-secret settings may also use their CANVAS_RECONCILE_* environment",
    "variables. The bearer secret is read only from --env-file and is never",
    "accepted as a command-line argument or emitted in logs.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    once: false,
    dryRun: false,
    help: false,
    envFile: undefined,
    url: undefined,
    lockFile: undefined,
    intervalMs: undefined,
    timeoutMs: undefined,
    maxBackoffMs: undefined,
    limit: undefined,
    leaseSeconds: undefined,
    timeBudgetMs: undefined,
  };
  const valueOptions = new Map([
    ["--env-file", "envFile"],
    ["--url", "url"],
    ["--lock-file", "lockFile"],
    ["--interval-ms", "intervalMs"],
    ["--timeout-ms", "timeoutMs"],
    ["--max-backoff-ms", "maxBackoffMs"],
    ["--limit", "limit"],
    ["--lease-seconds", "leaseSeconds"],
    ["--time-budget-ms", "timeBudgetMs"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--once") {
      options.once = true;
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const key = valueOptions.get(argument);
    if (!key) {
      throw new Error("unknown_argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("missing_argument_value");
    }
    options[key] = value;
    index += 1;
  }

  if (options.once && options.dryRun) {
    throw new Error("conflicting_modes");
  }
  return options;
}

function assertSupportedNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const supported = major === 20 && minor >= 12;
  if (process.env.NODE_ENV === "production" && !supported) {
    throw new Error("unsupported_node_runtime");
  }
  if (major < 20 || (major === 20 && minor < 12)) {
    throw new Error("unsupported_node_runtime");
  }
}

function readSecureEnvFile(filePath) {
  if (!filePath) throw new Error("env_file_required");
  const absolutePath = resolve(filePath);
  const entry = lstatSync(absolutePath);
  if (entry.isSymbolicLink()) throw new Error("env_file_symlink_rejected");
  if (!entry.isFile()) throw new Error("env_file_not_regular");
  if (entry.size > MAX_ENV_FILE_BYTES) throw new Error("env_file_too_large");

  if (process.platform !== "win32") {
    // Group-read is permitted for a dedicated service group. Group-write and
    // every permission for "other" are rejected.
    if ((entry.mode & 0o027) !== 0) {
      throw new Error("env_file_permissions_too_open");
    }
    if (typeof process.getuid === "function") {
      const uid = process.getuid();
      if (entry.uid !== uid && entry.uid !== 0) {
        throw new Error("env_file_owner_mismatch");
      }
    }
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(absolutePath, constants.O_RDONLY | noFollow);
  let raw;
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) throw new Error("env_file_not_regular");
    if (opened.dev !== entry.dev || opened.ino !== entry.ino) {
      throw new Error("env_file_changed_during_open");
    }
    raw = readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }

  const parsed = parseEnv(raw);
  const secret = parsed.CANVAS_RECONCILE_SECRET;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("reconcile_secret_missing");
  }
  if (secret !== secret.trim() || secret.length < 32 || secret.length > 4096) {
    throw new Error("reconcile_secret_invalid");
  }
  if (/[\r\n]/.test(secret)) throw new Error("reconcile_secret_invalid");
  if (
    /(change[-_]?me|replace[-_]?me|your[-_]?secret|<secret>)/i.test(secret)
  ) {
    throw new Error("reconcile_secret_placeholder");
  }

  const selected = {};
  for (const name of Object.values(SAFE_ENV_NAMES)) {
    if (typeof parsed[name] === "string") selected[name] = parsed[name];
  }
  return { absolutePath, secret, selected };
}

function configuredValue(cliValue, environmentName, fileValues) {
  if (cliValue !== undefined) return cliValue;
  if (process.env[environmentName] !== undefined) {
    return process.env[environmentName];
  }
  return fileValues[environmentName];
}

function integerSetting(value, fallback, minimum, maximum, code) {
  const raw = value === undefined ? String(fallback) : String(value);
  if (!/^[0-9]+$/.test(raw)) throw new Error(code);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(code);
  }
  return parsed;
}

function normalizeLoopbackUrl(rawValue) {
  if (!rawValue) throw new Error("reconcile_url_required");
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error("reconcile_url_invalid");
  }
  const loopbackHosts = new Set(["127.0.0.1", "[::1]"]);
  if (
    url.protocol !== "http:" ||
    !loopbackHosts.has(url.hostname) ||
    url.pathname !== RECONCILE_PATH ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("reconcile_url_must_be_exact_loopback_endpoint");
  }
  return url.toString();
}

function normalizeLockFile(rawValue) {
  if (!rawValue) {
    throw new Error("lock_file_required");
  }
  const filePath = resolve(rawValue);
  if (!isAbsolute(filePath) || dirname(filePath) === filePath) {
    throw new Error("lock_file_invalid");
  }
  const parent = statSync(dirname(filePath));
  if (!parent.isDirectory()) throw new Error("lock_parent_not_directory");
  if (process.platform !== "win32" && (parent.mode & 0o022) !== 0) {
    throw new Error("lock_parent_writable");
  }
  return filePath;
}

function buildConfiguration(options, envFile) {
  const production = process.env.NODE_ENV === "production";
  const value = (key) =>
    configuredValue(options[key], SAFE_ENV_NAMES[key], envFile.selected);
  const intervalMs = integerSetting(
    value("intervalMs"),
    DEFAULTS.intervalMs,
    production ? 5_000 : 50,
    900_000,
    "interval_ms_invalid"
  );
  const timeoutMs = integerSetting(
    value("timeoutMs"),
    DEFAULTS.timeoutMs,
    production ? 5_000 : 100,
    295_000,
    "timeout_ms_invalid"
  );
  const maxBackoffMs = integerSetting(
    value("maxBackoffMs"),
    DEFAULTS.maxBackoffMs,
    intervalMs,
    3_600_000,
    "max_backoff_ms_invalid"
  );
  const limit = integerSetting(
    value("limit"),
    DEFAULTS.limit,
    1,
    100,
    "limit_invalid"
  );
  const leaseSeconds = integerSetting(
    value("leaseSeconds"),
    DEFAULTS.leaseSeconds,
    240,
    300,
    "lease_seconds_invalid"
  );
  const timeBudgetMs = integerSetting(
    value("timeBudgetMs"),
    DEFAULTS.timeBudgetMs,
    1_000,
    240_000,
    "time_budget_ms_invalid"
  );
  if (production && timeoutMs < timeBudgetMs + 5_000) {
    throw new Error("timeout_must_exceed_time_budget");
  }

  return {
    once: options.once,
    dryRun: options.dryRun,
    secret: envFile.secret,
    url: normalizeLoopbackUrl(value("url")),
    lockFile: normalizeLockFile(value("lockFile")),
    intervalMs,
    timeoutMs,
    maxBackoffMs,
    limit,
    leaseSeconds,
    timeBudgetMs,
  };
}

function safeLog(event, details = {}) {
  const allowed = {};
  for (const [key, value] of Object.entries(details)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      allowed[key] = value;
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...allowed,
    })}\n`
  );
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function linuxProcessStartTicks(pid) {
  if (process.platform !== "linux") return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // comm is parenthesized and may contain spaces. Fields after the final ')'
    // begin at proc field 3; starttime is field 22, therefore index 19.
    const closing = stat.lastIndexOf(")");
    if (closing < 0) return null;
    const fields = stat.slice(closing + 1).trim().split(/\s+/);
    const startTicks = fields[19];
    return /^[0-9]+$/.test(startTicks ?? "") ? startTicks : null;
  } catch {
    return null;
  }
}

function sameEntry(first, second) {
  return first.dev === second.dev && first.ino === second.ino;
}

function unlinkOwnedEntry(file, identity) {
  try {
    const current = lstatSync(file);
    if (
      current.isFile() &&
      !current.isSymbolicLink() &&
      sameEntry(identity, current)
    ) {
      unlinkSync(file);
    }
  } catch {
    // Cleanup is best effort; callers remain fail-closed.
  }
}

function readyFileForLock(lockFile) {
  return `${lockFile}.ready`;
}

function clearStaleReadyMarker(readyFile) {
  let entry;
  try {
    entry = lstatSync(readyFile);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error("ready_file_unreadable");
  }
  if (
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    entry.size > MAX_READY_MARKER_BYTES ||
    (process.platform !== "win32" && (entry.mode & 0o077) !== 0)
  ) {
    throw new Error("ready_file_untrusted");
  }
  unlinkSync(readyFile);
}

function writeReadyMarker(readyFile, lock, validityMs) {
  const processStartTicks = linuxProcessStartTicks(process.pid);
  if (
    (process.platform === "linux" &&
      (!processStartTicks || processStartTicks !== lock.processStartTicks)) ||
    typeof lock.token !== "string" ||
    !Number.isSafeInteger(validityMs) ||
    validityMs <= 0
  ) {
    throw new Error("ready_process_identity_unavailable");
  }

  const temporary = `${readyFile}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    const readyAt = new Date();
    const record = {
      schema: READY_MARKER_SCHEMA,
      pid: process.pid,
      processStartTicks,
      lockToken: lock.token,
      readyAt: readyAt.toISOString(),
      expiresAt: new Date(readyAt.getTime() + validityMs).toISOString(),
    };
    writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
    const identity = fstatSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, readyFile);
    const installed = lstatSync(readyFile);
    if (
      !installed.isFile() ||
      installed.isSymbolicLink() ||
      !sameEntry(identity, installed)
    ) {
      throw new Error("ready_file_changed");
    }
    return { identity, record };
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Best effort; the process will fail closed below.
      }
    }
    try {
      unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") {
        safeLog("ready_file_cleanup_failed", { reason: "filesystem_error" });
      }
    }
    if (
      error instanceof Error &&
      /^[a-z0-9_]+$/.test(error.message)
    ) {
      throw error;
    }
    throw new Error("ready_file_write_failed");
  }
}

function removeOwnedReadyMarker(readyFile, marker) {
  if (!marker) return true;
  try {
    const current = lstatSync(readyFile);
    if (
      current.isFile() &&
      !current.isSymbolicLink() &&
      sameEntry(marker.identity, current)
    ) {
      unlinkSync(readyFile);
      return true;
    }
    safeLog("ready_file_cleanup_failed", { reason: "identity_changed" });
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    safeLog("ready_file_cleanup_failed", { reason: "filesystem_error" });
    return false;
  }
}

function inspectExistingLock(lockFile) {
  const before = lstatSync(lockFile);
  if (before.isSymbolicLink() || !before.isFile() || before.size > 4096) {
    throw new Error("lock_file_untrusted");
  }
  let record;
  try {
    record = JSON.parse(readFileSync(lockFile, "utf8"));
  } catch {
    throw new Error("lock_file_unreadable");
  }
  if (processIsAlive(record?.pid)) {
    const actualStartTicks = linuxProcessStartTicks(record.pid);
    if (
      !record?.processStartTicks ||
      !actualStartTicks ||
      record.processStartTicks === actualStartTicks
    ) {
      return "active";
    }
    // A live process with the same PID but a different /proc start time is PID
    // reuse, not the worker that created this lock.
  }

  const after = lstatSync(lockFile);
  if (!sameEntry(before, after)) throw new Error("lock_file_changed");
  unlinkSync(lockFile);
  return "stale_removed";
}

function tryAcquireLock(lockFile) {
  const temporary = `${lockFile}.${process.pid}.${randomUUID()}.candidate`;
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600
    );
  } catch {
    throw new Error("lock_candidate_create_failed");
  }

  const createdIdentity = fstatSync(descriptor);
  const token = randomUUID();
  const processStartTicks = linuxProcessStartTicks(process.pid);
  if (process.platform === "linux" && !processStartTicks) {
    closeSync(descriptor);
    unlinkOwnedEntry(temporary, createdIdentity);
    throw new Error("lock_process_identity_unavailable");
  }
  let identity;
  try {
    writeFileSync(
      descriptor,
      JSON.stringify({
        pid: process.pid,
        token,
        startedAt: new Date().toISOString(),
        processStartTicks,
      }),
      "utf8"
    );
    identity = fstatSync(descriptor);
  } catch {
    closeSync(descriptor);
    unlinkOwnedEntry(temporary, createdIdentity);
    throw new Error("lock_file_write_failed");
  }

  try {
    linkSync(temporary, lockFile);
  } catch (error) {
    closeSync(descriptor);
    unlinkOwnedEntry(temporary, identity);
    if (error?.code === "EEXIST") {
      return { acquired: false, state: inspectExistingLock(lockFile) };
    }
    throw new Error("lock_file_install_failed");
  }
  try {
    const installed = lstatSync(lockFile);
    if (
      !installed.isFile() ||
      installed.isSymbolicLink() ||
      !sameEntry(identity, installed)
    ) {
      throw new Error("lock_file_changed");
    }
    unlinkOwnedEntry(temporary, identity);
  } catch (error) {
    closeSync(descriptor);
    unlinkOwnedEntry(lockFile, identity);
    unlinkOwnedEntry(temporary, identity);
    if (
      error instanceof Error &&
      /^[a-z0-9_]+$/.test(error.message)
    ) {
      throw error;
    }
    throw new Error("lock_file_install_failed");
  }

  let released = false;
  return {
    acquired: true,
    state: "acquired",
    token,
    processStartTicks,
    release() {
      if (released) return;
      released = true;
      closeSync(descriptor);
      try {
        const current = lstatSync(lockFile);
        if (current.isFile() && sameEntry(identity, current)) {
          unlinkSync(lockFile);
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          safeLog("lock_release_failed", { reason: "filesystem_error" });
        }
      }
    },
  };
}

async function acquireSingleton(lockFile, once) {
  const deadline = Date.now() + (once ? 0 : DEFAULTS.startupLockWaitMs);
  while (true) {
    const lock = tryAcquireLock(lockFile);
    if (lock.acquired) return lock;
    if (lock.state === "stale_removed") continue;
    if (Date.now() >= deadline) return null;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
}

async function readBoundedResponse(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function safeErrorCode(value) {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value)
    ? value
    : undefined;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
    ? value
    : null;
}

function parseAggregate(raw) {
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("invalid_json_response");
  }
  if (!body || body.success !== true || typeof body.data !== "object") {
    return {
      accepted: false,
      errorCode: safeErrorCode(body?.error?.code),
    };
  }
  const fields = [
    "claimed",
    "completed",
    "failed",
    "markedUnknown",
    "released",
    "sweptText",
    "sweptNotStarted",
    "errors",
  ];
  const aggregate = {};
  for (const field of fields) {
    aggregate[field] = count(body.data[field]);
    if (aggregate[field] === null) {
      throw new Error("invalid_aggregate_response");
    }
  }
  return { accepted: true, aggregate };
}

async function runCycle(configuration, runtime) {
  const startedAt = Date.now();
  const controller = new AbortController();
  runtime.activeController = controller;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, configuration.timeoutMs);
  timeout.unref();

  try {
    const response = await fetch(configuration.url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${configuration.secret}`,
        "cache-control": "no-store",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        limit: configuration.limit,
        leaseSeconds: configuration.leaseSeconds,
        timeBudgetMs: configuration.timeBudgetMs,
      }),
      redirect: "error",
      signal: controller.signal,
    });
    const raw = await readBoundedResponse(response);
    const parsed = parseAggregate(raw);
    const durationMs = Date.now() - startedAt;

    if (!response.ok || !parsed.accepted) {
      safeLog("reconcile_cycle", {
        outcome: "http_error",
        httpStatus: response.status,
        errorCode: parsed.errorCode ?? null,
        durationMs,
      });
      return { accepted: false, healthy: false };
    }

    const healthy = parsed.aggregate.errors === 0;
    safeLog("reconcile_cycle", {
      outcome: healthy ? "ok" : "degraded",
      httpStatus: response.status,
      durationMs,
      ...parsed.aggregate,
    });
    return { accepted: true, healthy };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    safeLog("reconcile_cycle", {
      outcome: timedOut
        ? "timeout"
        : runtime.stopRequested
          ? "shutdown"
          : "network_or_protocol_error",
      durationMs,
      reason:
        error instanceof Error && error.message === "response_too_large"
          ? "response_too_large"
          : null,
    });
    return { accepted: false, healthy: false };
  } finally {
    clearTimeout(timeout);
    if (runtime.activeController === controller) {
      runtime.activeController = null;
    }
  }
}

export function computeBackoffDelay(
  intervalMs,
  maxBackoffMs,
  consecutiveFailures,
  randomValue = Math.random()
) {
  const exponent = Math.max(0, Math.min(20, consecutiveFailures - 1));
  const ceiling = Math.min(maxBackoffMs, intervalMs * 2 ** exponent);
  const boundedRandom = Math.max(0, Math.min(1, randomValue));
  return Math.floor(ceiling / 2 + (ceiling / 2) * boundedRandom);
}

function healthyDelay(intervalMs) {
  return intervalMs + Math.floor(Math.random() * Math.min(5_000, intervalMs / 10));
}

function waitForNextCycle(delayMs, runtime) {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      runtime.wake = null;
      resolvePromise();
    }, delayMs);
    runtime.wake = () => {
      clearTimeout(timer);
      runtime.wake = null;
      resolvePromise();
    };
  });
}

function readinessValidityMs(configuration) {
  const healthyJitterMs = Math.min(5_000, configuration.intervalMs / 10);
  return Math.ceil(
    configuration.intervalMs +
      healthyJitterMs +
      configuration.timeoutMs +
      configuration.maxBackoffMs +
      30_000
  );
}

function recordAcceptedReadiness(
  runtime,
  readyFile,
  lock,
  validityMs
) {
  const marker = writeReadyMarker(readyFile, lock, validityMs);
  try {
    if (!runtime.ready) {
      if (typeof process.send === "function") process.send("ready");
      safeLog("worker_ready", { singleton: true, target: "loopback" });
    }
    runtime.readyMarker = marker;
    runtime.ready = true;
  } catch (error) {
    removeOwnedReadyMarker(readyFile, marker);
    throw error;
  }
}

function clearReadinessEvidence(runtime, readyFile) {
  if (!runtime.readyMarker) return;
  if (!removeOwnedReadyMarker(readyFile, runtime.readyMarker)) {
    throw new Error("ready_file_cleanup_failed");
  }
  runtime.readyMarker = null;
}

async function run(configuration) {
  if (configuration.dryRun) {
    safeLog("configuration_valid", {
      mode: "dry_run",
      target: "loopback",
      intervalMs: configuration.intervalMs,
      timeoutMs: configuration.timeoutMs,
      maxBackoffMs: configuration.maxBackoffMs,
      limit: configuration.limit,
      leaseSeconds: configuration.leaseSeconds,
      timeBudgetMs: configuration.timeBudgetMs,
    });
    return 0;
  }

  const lock = await acquireSingleton(configuration.lockFile, configuration.once);
  if (!lock) {
    safeLog("singleton_busy", {
      outcome: configuration.once ? "skipped" : "startup_failed",
    });
    return configuration.once ? 0 : 75;
  }

  const runtime = {
    activeController: null,
    wake: null,
    stopRequested: false,
    ready: false,
    readyMarker: null,
  };
  const readyFile = readyFileForLock(configuration.lockFile);
  const readyValidityMs = readinessValidityMs(configuration);
  const stop = (signal) => {
    if (runtime.stopRequested) return;
    runtime.stopRequested = true;
    safeLog("shutdown_requested", { signal });
    runtime.activeController?.abort();
    runtime.wake?.();
  };
  const onSigterm = () => stop("SIGTERM");
  const onSigint = () => stop("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  const onMessage = (message) => {
    if (message === "shutdown") stop("IPC");
  };
  process.on("message", onMessage);

  try {
    clearStaleReadyMarker(readyFile);
    let consecutiveFailures = 0;
    do {
      const outcome = await runCycle(configuration, runtime);
      if (outcome.accepted) {
        recordAcceptedReadiness(
          runtime,
          readyFile,
          lock,
          readyValidityMs
        );
      } else {
        clearReadinessEvidence(runtime, readyFile);
      }
      if (configuration.once) return outcome.healthy ? 0 : 1;
      if (runtime.stopRequested) break;

      if (outcome.healthy) consecutiveFailures = 0;
      else consecutiveFailures += 1;
      const delayMs = outcome.healthy
        ? healthyDelay(configuration.intervalMs)
        : computeBackoffDelay(
            configuration.intervalMs,
            configuration.maxBackoffMs,
            consecutiveFailures
          );
      safeLog("cycle_scheduled", {
        delayMs,
        consecutiveFailures,
      });
      await waitForNextCycle(delayMs, runtime);
    } while (!runtime.stopRequested);
    return 0;
  } finally {
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    process.off("message", onMessage);
    removeOwnedReadyMarker(readyFile, runtime.readyMarker);
    lock.release();
    safeLog("worker_stopped", { clean: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    assertSupportedNode();
    const options = parseArguments(argv);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const envFile = readSecureEnvFile(options.envFile);
    const configuration = buildConfiguration(options, envFile);
    return await run(configuration);
  } catch (error) {
    safeLog("worker_configuration_failed", {
      reason:
        error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
          ? error.message
          : "unexpected_error",
    });
    return 2;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
const pm2ExecPath =
  typeof process.env.pm_exec_path === "string"
    ? pathToFileURL(resolve(process.env.pm_exec_path)).href
    : "";
const invokedByPm2 =
  process.env.NODE_APP_INSTANCE === "0" &&
  process.env.pm_id !== undefined &&
  typeof process.send === "function" &&
  pm2ExecPath === import.meta.url;
if (invokedPath === import.meta.url || invokedByPm2) {
  process.exitCode = await main();
}
