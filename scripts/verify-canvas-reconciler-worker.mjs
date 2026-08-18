#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { computeBackoffDelay } from "./canvas-reconciler-worker.mjs";

const worker = resolve("scripts/canvas-reconciler-worker.mjs");
const readinessProbe = resolve(
  "scripts/probe-canvas-reconciler-readiness.mjs"
);
const temporaryRoot = mkdtempSync(join(tmpdir(), "canvas-reconciler-"));
chmodSync(temporaryRoot, 0o700);
const envFile = join(temporaryRoot, "worker.env");
const secret = "test-only-canvas-reconcile-secret-000000000001";
writeFileSync(envFile, `CANVAS_RECONCILE_SECRET=${secret}\n`, {
  mode: 0o600,
});
const pm2Harness = join(temporaryRoot, "pm2-import-harness.mjs");
writeFileSync(
  pm2Harness,
  [
    'import { pathToFileURL } from "node:url";',
    "const workerPath = process.argv[2];",
    "process.argv.splice(2, 1);",
    "await import(pathToFileURL(workerPath).href);",
    "if (process.connected) process.disconnect();",
    "",
  ].join("\n"),
  { mode: 0o600 }
);

let mode = "success";
let heldResponseResolvers = [];
let requests = 0;
let delayedActive = 0;
let maximumDelayedActive = 0;
let lastAuthorization = "";
let lastBody = null;
const responseSentinel = "RESPONSE_BODY_MUST_NOT_REACH_LOGS";
const server = createServer(async (request, response) => {
  requests += 1;
  if (mode === "delayed") {
    delayedActive += 1;
    maximumDelayedActive = Math.max(maximumDelayedActive, delayedActive);
  }
  lastAuthorization = request.headers.authorization ?? "";
  let raw = "";
  for await (const chunk of request) raw += chunk;
  lastBody = JSON.parse(raw);

  if (mode === "timeout") {
    return;
  }
  if (mode === "held") {
    await new Promise((resolvePromise) => {
      heldResponseResolvers.push(resolvePromise);
    });
  }
  if (mode === "delayed") {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
  }

  if (mode === "failure") {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        success: false,
        error: { code: "RECONCILE_FAILED", detail: responseSentinel },
      })
    );
  } else {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        success: true,
        data: {
          workerId: "ignored",
          claimed: 2,
          completed: 1,
          failed: 0,
          markedUnknown: 0,
          released: 1,
          sweptText: 0,
          sweptNotStarted: 0,
          errors: 0,
          ignored: responseSentinel,
        },
      })
    );
  }
  if (mode === "delayed") delayedActive -= 1;
});

function waitForRequestCount(target, timeoutMs = 3_000) {
  if (requests >= target) return Promise.resolve();
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(
      () => {
        clearInterval(interval);
        rejectPromise(new Error(`request count did not reach ${target}`));
      },
      timeoutMs
    );
    const interval = setInterval(() => {
      if (requests < target) return;
      clearTimeout(timeout);
      clearInterval(interval);
      resolvePromise();
    }, 10);
  });
}

function launch(argumentsList, options = {}) {
  const entry = options.entry ?? worker;
  const child = spawn(process.execPath, [entry, ...argumentsList], {
    env: { ...process.env, NODE_ENV: "test", ...(options.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) =>
      resolvePromise({ code, signal, stdout, stderr })
    );
  });
  return { child, completed };
}

function waitForCondition(predicate, label, timeoutMs = 3_000) {
  if (predicate()) return Promise.resolve();
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      rejectPromise(new Error(`condition timed out: ${label}`));
    }, timeoutMs);
    const interval = setInterval(() => {
      if (!predicate()) return;
      clearTimeout(timeout);
      clearInterval(interval);
      resolvePromise();
    }, 10);
  });
}

function runReadinessProbe(pm2State, lockFile) {
  const child = spawn(
    process.execPath,
    [
      readinessProbe,
      "--name",
      "test-canvas-reconciler",
      "--script",
      worker,
      "--lock-file",
      lockFile,
    ],
    {
      env: { ...process.env, NODE_ENV: "test" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify(pm2State));
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

function commonArguments(lockName) {
  return [
    "--env-file",
    envFile,
    "--url",
    `http://127.0.0.1:${server.address().port}/api/internal/canvas/reconcile`,
    "--lock-file",
    join(temporaryRoot, lockName),
    "--interval-ms",
    "50",
    "--timeout-ms",
    "2000",
    "--time-budget-ms",
    "1000",
  ];
}

function assertNoSensitiveOutput(result) {
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(combined.includes(secret), false, "secret leaked to output");
  assert.equal(
    combined.includes(responseSentinel),
    false,
    "raw response leaked to output"
  );
}

try {
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise)
  );

  assert.equal(computeBackoffDelay(1_000, 60_000, 1, 0), 500);
  assert.equal(computeBackoffDelay(1_000, 60_000, 3, 1), 4_000);
  assert.equal(computeBackoffDelay(1_000, 2_000, 9, 1), 2_000);

  mode = "success";
  const success = launch(["--once", ...commonArguments("success.lock")]);
  const successResult = await success.completed;
  assert.equal(successResult.code, 0);
  assert.match(successResult.stdout, /"outcome":"ok"/);
  assert.match(successResult.stdout, /"claimed":2/);
  assertNoSensitiveOutput(successResult);
  assert.equal(lastAuthorization, `Bearer ${secret}`);
  assert.deepEqual(lastBody, {
    limit: 10,
    leaseSeconds: 300,
    timeBudgetMs: 1000,
  });

  const beforeDryRun = requests;
  const dryRun = launch(["--dry-run", ...commonArguments("dry-run.lock")]);
  const dryRunResult = await dryRun.completed;
  assert.equal(dryRunResult.code, 0);
  assert.match(dryRunResult.stdout, /"event":"configuration_valid"/);
  assert.equal(requests, beforeDryRun);
  assert.equal(existsSync(join(temporaryRoot, "dry-run.lock")), false);
  assertNoSensitiveOutput(dryRunResult);

  const pm2DryRun = launch(
    [worker, "--dry-run", ...commonArguments("pm2-dry-run.lock")],
    {
      entry: pm2Harness,
      env: {
        NODE_APP_INSTANCE: "0",
        pm_id: "9001",
        pm_exec_path: worker,
      },
    }
  );
  const pm2DryRunResult = await pm2DryRun.completed;
  assert.equal(pm2DryRunResult.code, 0);
  assert.match(pm2DryRunResult.stdout, /"event":"configuration_valid"/);
  assertNoSensitiveOutput(pm2DryRunResult);

  const rejectedPm2Import = launch(
    [worker, "--dry-run", ...commonArguments("pm2-rejected.lock")],
    {
      entry: pm2Harness,
      env: {
        NODE_APP_INSTANCE: "1",
        pm_id: "9002",
        pm_exec_path: worker,
      },
    }
  );
  const rejectedPm2ImportResult = await rejectedPm2Import.completed;
  assert.equal(rejectedPm2ImportResult.code, 0);
  assert.equal(rejectedPm2ImportResult.stdout, "");
  assert.equal(existsSync(join(temporaryRoot, "pm2-rejected.lock")), false);
  assertNoSensitiveOutput(rejectedPm2ImportResult);

  mode = "failure";
  const failed = launch(["--once", ...commonArguments("failure.lock")]);
  const failedResult = await failed.completed;
  assert.equal(failedResult.code, 1);
  assert.match(failedResult.stdout, /"httpStatus":500/);
  assert.equal(existsSync(join(temporaryRoot, "failure.lock.ready")), false);
  assertNoSensitiveOutput(failedResult);

  const busyLock = join(temporaryRoot, "busy.lock");
  writeFileSync(
    busyLock,
    JSON.stringify({ pid: process.pid, token: "live-test" }),
    { mode: 0o600 }
  );
  const beforeBusy = requests;
  const busy = launch(["--once", ...commonArguments("busy.lock")]);
  const busyResult = await busy.completed;
  assert.equal(busyResult.code, 0);
  assert.match(busyResult.stdout, /"event":"singleton_busy"/);
  assert.equal(requests, beforeBusy);
  assertNoSensitiveOutput(busyResult);

  mode = "timeout";
  const timed = launch([
    "--once",
    ...commonArguments("timeout.lock"),
    "--timeout-ms",
    "150",
  ]);
  const timedResult = await timed.completed;
  assert.equal(timedResult.code, 1);
  assert.match(timedResult.stdout, /"outcome":"timeout"/);
  assertNoSensitiveOutput(timedResult);

  mode = "held";
  heldResponseResolvers = [];
  const readinessLock = join(temporaryRoot, "readiness.lock");
  const readyLaunchStartedAt = Date.now();
  const readinessRequestTarget = requests + 1;
  const readiness = launch(commonArguments("readiness.lock"));
  await waitForRequestCount(readinessRequestTarget);
  assert.equal(existsSync(readinessLock), true);
  assert.equal(
    existsSync(`${readinessLock}.ready`),
    false,
    "readiness marker appeared before an accepted reconcile response"
  );
  mode = "success";
  for (const resolveHeldResponse of heldResponseResolvers.splice(0)) {
    resolveHeldResponse();
  }
  await waitForCondition(
    () => existsSync(`${readinessLock}.ready`),
    "accepted-cycle readiness marker"
  );
  const liveLock = JSON.parse(readFileSync(readinessLock, "utf8"));
  const liveReady = JSON.parse(
    readFileSync(`${readinessLock}.ready`, "utf8")
  );
  assert.equal(liveReady.schema, "canvas-reconciler-ready-v2");
  assert.equal(liveReady.pid, readiness.child.pid);
  assert.equal(liveReady.lockToken, liveLock.token);
  assert.equal(liveReady.processStartTicks, liveLock.processStartTicks);
  assert(Date.parse(liveReady.expiresAt) > Date.parse(liveReady.readyAt));

  const readinessPm2State = [
    {
      name: "test-canvas-reconciler",
      pid: readiness.child.pid,
      pm2_env: {
        status: "online",
        exec_mode: "fork_mode",
        pm_exec_path: worker,
        pm_uptime: readyLaunchStartedAt,
      },
    },
  ];
  if (process.platform === "linux") {
    const evidenceLock = join(temporaryRoot, "readiness-evidence.lock");
    writeFileSync(evidenceLock, readFileSync(readinessLock), { mode: 0o600 });
    writeFileSync(
      `${evidenceLock}.ready`,
      readFileSync(`${readinessLock}.ready`),
      { mode: 0o600 }
    );
    const validEvidence = await runReadinessProbe(
      readinessPm2State,
      evidenceLock
    );
    assert.equal(validEvidence.code, 0, validEvidence.stderr);
    assert.match(validEvidence.stdout, /^\d+:\d+\n$/);

    const tamperedReady = JSON.parse(
      readFileSync(`${evidenceLock}.ready`, "utf8")
    );
    tamperedReady.lockToken = "00000000-0000-4000-8000-000000000000";
    writeFileSync(
      `${evidenceLock}.ready`,
      `${JSON.stringify(tamperedReady)}\n`,
      { mode: 0o600 }
    );
    const mismatchedEvidence = await runReadinessProbe(
      readinessPm2State,
      evidenceLock
    );
    assert.notEqual(mismatchedEvidence.code, 0);
    assert.match(mismatchedEvidence.stderr, /readiness_identity_mismatch/);

    writeFileSync(
      `${evidenceLock}.ready`,
      `${JSON.stringify(liveReady)}\n`,
      { mode: 0o600 }
    );
    chmodSync(`${evidenceLock}.ready`, 0o644);
    const openModeEvidence = await runReadinessProbe(
      readinessPm2State,
      evidenceLock
    );
    assert.notEqual(openModeEvidence.code, 0);
    assert.match(openModeEvidence.stderr, /ready_evidence_invalid/);

    const expiredReady = {
      ...liveReady,
      readyAt: "2024-01-01T00:00:00.000Z",
      expiresAt: "2024-01-01T00:05:00.000Z",
    };
    writeFileSync(
      `${evidenceLock}.ready`,
      `${JSON.stringify(expiredReady)}\n`,
      { mode: 0o600 }
    );
    chmodSync(`${evidenceLock}.ready`, 0o600);
    const expiredEvidence = await runReadinessProbe(
      readinessPm2State,
      evidenceLock
    );
    assert.notEqual(expiredEvidence.code, 0);
    assert.match(expiredEvidence.stderr, /readiness_time_invalid/);
  }

  mode = "failure";
  const failedAfterReadyTarget = requests + 1;
  await waitForRequestCount(failedAfterReadyTarget);
  await waitForCondition(
    () => !existsSync(`${readinessLock}.ready`),
    "failed-cycle readiness revocation"
  );
  if (process.platform === "linux") {
    const revokedEvidence = await runReadinessProbe(
      readinessPm2State,
      readinessLock
    );
    assert.notEqual(revokedEvidence.code, 0);
    assert.match(revokedEvidence.stderr, /ready_evidence_invalid/);
  }

  mode = "success";
  const recoveredAfterReadyTarget = requests + 1;
  await waitForRequestCount(recoveredAfterReadyTarget);
  await waitForCondition(
    () => existsSync(`${readinessLock}.ready`),
    "recovered-cycle readiness refresh"
  );
  mode = "held";
  heldResponseResolvers = [];
  const heldAfterRecoveryTarget = requests + 1;
  await waitForRequestCount(heldAfterRecoveryTarget);
  const recoveredReady = JSON.parse(
    readFileSync(`${readinessLock}.ready`, "utf8")
  );
  assert(Date.parse(recoveredReady.readyAt) >= Date.parse(liveReady.readyAt));
  assert(
    Date.parse(recoveredReady.expiresAt) > Date.parse(recoveredReady.readyAt)
  );
  if (process.platform === "linux") {
    const recoveredEvidence = await runReadinessProbe(
      readinessPm2State,
      readinessLock
    );
    assert.equal(recoveredEvidence.code, 0, recoveredEvidence.stderr);
  }
  mode = "success";
  for (const resolveHeldResponse of heldResponseResolvers.splice(0)) {
    resolveHeldResponse();
  }

  readiness.child.send("shutdown");
  const readinessResult = await readiness.completed;
  assert.equal(readinessResult.code, 0);
  assert.equal(existsSync(readinessLock), false);
  assert.equal(existsSync(`${readinessLock}.ready`), false);
  assert.match(readinessResult.stdout, /"event":"worker_ready"/);
  assertNoSensitiveOutput(readinessResult);

  mode = "delayed";
  maximumDelayedActive = 0;
  const startCount = requests;
  const persistent = launch(commonArguments("persistent.lock"));
  await waitForRequestCount(startCount + 2);
  persistent.child.send("shutdown");
  const persistentResult = await persistent.completed;
  assert.equal(
    maximumDelayedActive,
    1,
    "worker overlapped its own requests"
  );
  assert.equal(persistentResult.code, 0);
  assert.match(persistentResult.stdout, /"event":"shutdown_requested"/);
  assert.match(persistentResult.stdout, /"signal":"IPC"/);
  assert.match(persistentResult.stdout, /"event":"worker_stopped"/);
  assertNoSensitiveOutput(persistentResult);

  const workerSource = await import("node:fs/promises").then(({ readFile }) =>
    readFile(worker, "utf8")
  );
  assert.match(workerSource, /linuxProcessStartTicks/);
  assert.match(workerSource, /const invokedByPm2/);
  assert.match(workerSource, /lockToken: lock\.token/);
  assert.match(workerSource, /recordAcceptedReadiness/);
  assert.match(workerSource, /clearReadinessEvidence/);
  assert.match(workerSource, /linkSync\(temporary, lockFile\)/);
  assert.match(workerSource, /removeOwnedReadyMarker/);

  process.stdout.write(
    "Canvas reconciler worker verification passed: loopback auth, safe logs, " +
      "dry-run, PM2 import identity, cron once, singleton lock, timeout, " +
      "backoff, readiness evidence, single-flight, and graceful shutdown.\n"
  );
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  rmSync(temporaryRoot, { recursive: true, force: true });
}
