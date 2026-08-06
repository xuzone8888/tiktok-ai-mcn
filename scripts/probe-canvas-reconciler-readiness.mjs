#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";

const READY_MARKER_SCHEMA = "canvas-reconciler-ready-v2";
const MAX_PM2_JSON_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 4096;
const MAX_READINESS_WINDOW_MS = 5_000_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  const options = { name: "", script: "", lockFile: "" };
  const supported = new Map([
    ["--name", "name"],
    ["--script", "script"],
    ["--lock-file", "lockFile"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = supported.get(argv[index]);
    const value = argv[index + 1];
    if (!key || !value) fail("invalid_arguments");
    options[key] = value;
    index += 1;
  }
  if (
    !/^[A-Za-z0-9._-]+$/.test(options.name) ||
    !isAbsolute(options.script) ||
    !isAbsolute(options.lockFile) ||
    dirname(options.script) === options.script ||
    dirname(options.lockFile) === options.lockFile
  ) {
    fail("invalid_arguments");
  }
  options.script = resolve(options.script);
  options.lockFile = resolve(options.lockFile);
  options.readyFile = `${options.lockFile}.ready`;
  return options;
}

function sameEntry(first, second) {
  return first.dev === second.dev && first.ino === second.ino;
}

function assertExactKeys(value, expected, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== [...expected].sort().join("\n")
  ) {
    fail(code);
  }
}

function readSecureJson(file, code) {
  let before;
  try {
    before = lstatSync(file);
  } catch {
    fail(code);
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 2 ||
    before.size > MAX_EVIDENCE_BYTES ||
    (process.platform !== "win32" && (before.mode & 0o777) !== 0o600)
  ) {
    fail(code);
  }

  let descriptor;
  try {
    descriptor = openSync(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      !sameEntry(before, opened) ||
      opened.size < 2 ||
      opened.size > MAX_EVIDENCE_BYTES ||
      (process.platform !== "win32" && (opened.mode & 0o777) !== 0o600)
    ) {
      fail(code);
    }
    const raw = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor);
    if (!sameEntry(opened, after) || after.size !== opened.size) fail(code);
    const pathAfter = lstatSync(file);
    if (
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      !sameEntry(opened, pathAfter) ||
      pathAfter.size !== opened.size ||
      (process.platform !== "win32" && (pathAfter.mode & 0o777) !== 0o600)
    ) {
      fail(code);
    }
    return { value: JSON.parse(raw), entry: opened };
  } catch {
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function linuxProcessStartTicks(pid) {
  if (process.platform !== "linux") fail("unsupported_platform");
  let raw;
  try {
    raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    fail("process_identity_invalid");
  }
  const closing = raw.lastIndexOf(")");
  if (closing < 0) fail("process_identity_invalid");
  const fields = raw.slice(closing + 1).trim().split(/\s+/);
  if (["Z", "X", "x"].includes(fields[0])) {
    fail("process_identity_invalid");
  }
  const ticks = fields[19];
  if (!/^[0-9]+$/.test(ticks ?? "")) fail("process_identity_invalid");
  return ticks;
}

function validTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

async function readStdin() {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input, "utf8") > MAX_PM2_JSON_BYTES) {
      fail("pm2_state_too_large");
    }
  }
  try {
    return JSON.parse(input);
  } catch {
    fail("pm2_state_invalid");
  }
}

function verifyEvidence(pm2State, options) {
  if (!Array.isArray(pm2State)) fail("pm2_state_invalid");
  const matches = pm2State.filter((entry) => entry?.name === options.name);
  const entry = matches[0];
  const pid = entry?.pid;
  if (
    matches.length !== 1 ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    entry.pm2_env?.status !== "online" ||
    entry.pm2_env?.exec_mode !== "fork_mode" ||
    resolve(entry.pm2_env?.pm_exec_path ?? "") !== options.script
  ) {
    fail("pm2_identity_invalid");
  }

  const script = lstatSync(options.script);
  if (!script.isFile() || script.isSymbolicLink()) {
    fail("worker_script_untrusted");
  }

  const processEntry = statSync(`/proc/${pid}`);
  const processStartTicks = linuxProcessStartTicks(pid);
  const lock = readSecureJson(options.lockFile, "lock_evidence_invalid");
  const ready = readSecureJson(options.readyFile, "ready_evidence_invalid");
  if (
    lock.entry.uid !== processEntry.uid ||
    lock.entry.gid !== processEntry.gid ||
    ready.entry.uid !== processEntry.uid ||
    ready.entry.gid !== processEntry.gid
  ) {
    fail("evidence_owner_invalid");
  }

  assertExactKeys(
    lock.value,
    ["pid", "token", "startedAt", "processStartTicks"],
    "lock_evidence_invalid"
  );
  assertExactKeys(
    ready.value,
    [
      "schema",
      "pid",
      "processStartTicks",
      "lockToken",
      "readyAt",
      "expiresAt",
    ],
    "ready_evidence_invalid"
  );
  if (
    lock.value.pid !== pid ||
    ready.value.pid !== pid ||
    lock.value.processStartTicks !== processStartTicks ||
    ready.value.processStartTicks !== processStartTicks ||
    typeof lock.value.token !== "string" ||
    !UUID_PATTERN.test(lock.value.token) ||
    ready.value.lockToken !== lock.value.token ||
    ready.value.schema !== READY_MARKER_SCHEMA ||
    !validTimestamp(lock.value.startedAt) ||
    !validTimestamp(ready.value.readyAt) ||
    !validTimestamp(ready.value.expiresAt)
  ) {
    fail("readiness_identity_mismatch");
  }

  const startedAt = Date.parse(lock.value.startedAt);
  const readyAt = Date.parse(ready.value.readyAt);
  const expiresAt = Date.parse(ready.value.expiresAt);
  const pm2StartedAt = Number(entry.pm2_env?.pm_uptime);
  const now = Date.now();
  if (
    readyAt < startedAt ||
    readyAt > now + 10_000 ||
    expiresAt <= now ||
    expiresAt <= readyAt ||
    expiresAt - readyAt > MAX_READINESS_WINDOW_MS ||
    !Number.isFinite(pm2StartedAt) ||
    pm2StartedAt > readyAt + 10_000
  ) {
    fail("readiness_time_invalid");
  }
  const finalStartTicksBefore = linuxProcessStartTicks(pid);
  const finalProcessEntry = statSync(`/proc/${pid}`);
  const finalStartTicksAfter = linuxProcessStartTicks(pid);
  if (
    finalStartTicksBefore !== processStartTicks ||
    finalStartTicksAfter !== processStartTicks ||
    finalProcessEntry.uid !== processEntry.uid ||
    finalProcessEntry.gid !== processEntry.gid
  ) {
    fail("process_identity_changed");
  }
  if (expiresAt <= Date.now()) fail("readiness_time_invalid");
  return { pid, processStartTicks };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const pm2State = await readStdin();
  const evidence = verifyEvidence(pm2State, options);
  process.stdout.write(`${evidence.pid}:${evidence.processStartTicks}\n`);
}

main().catch((error) => {
  const code =
    error instanceof Error && /^[a-z0-9_]+$/.test(error.code ?? error.message)
      ? error.code ?? error.message
      : "readiness_probe_failed";
  process.stderr.write(`[FAIL] Canvas reconciler readiness evidence: ${code}\n`);
  process.exitCode = 1;
});
