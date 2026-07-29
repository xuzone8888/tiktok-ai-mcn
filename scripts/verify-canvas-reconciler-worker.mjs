#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { computeBackoffDelay } from "./canvas-reconciler-worker.mjs";

const worker = resolve("scripts/canvas-reconciler-worker.mjs");
const temporaryRoot = mkdtempSync(join(tmpdir(), "canvas-reconciler-"));
chmodSync(temporaryRoot, 0o700);
const envFile = join(temporaryRoot, "worker.env");
const secret = "test-only-canvas-reconcile-secret-000000000001";
writeFileSync(envFile, `CANVAS_RECONCILE_SECRET=${secret}\n`, {
  mode: 0o600,
});

let mode = "success";
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

function launch(argumentsList) {
  const child = spawn(process.execPath, [worker, ...argumentsList], {
    env: { ...process.env, NODE_ENV: "test" },
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

  mode = "failure";
  const failed = launch(["--once", ...commonArguments("failure.lock")]);
  const failedResult = await failed.completed;
  assert.equal(failedResult.code, 1);
  assert.match(failedResult.stdout, /"httpStatus":500/);
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
  assert.match(workerSource, /processStartTicks: linuxProcessStartTicks/);

  process.stdout.write(
    "Canvas reconciler worker verification passed: loopback auth, safe logs, " +
      "dry-run, cron once, singleton lock, timeout, backoff, single-flight, " +
      "and graceful shutdown.\n"
  );
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  rmSync(temporaryRoot, { recursive: true, force: true });
}
