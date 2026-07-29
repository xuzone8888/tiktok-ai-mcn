#!/usr/bin/env node
/* eslint-disable no-console */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseArguments,
  parseRecoveryEnvironment,
  parseRecoveryUrl,
  postRecovery,
  validateRecoveryRequest,
  validateSuccessResponse,
} from "./resolve-canvas-unknown.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  readFileSync(join(root, relativePath), "utf8");

const cliSource = read("scripts/resolve-canvas-unknown.mjs");
const routeSource = read(
  "src/app/api/internal/canvas/resolve-unknown/route.ts"
);
const migrationSource = read(
  "supabase/migrations/20260730_canvas_generation_recovery.sql"
);
const runbookSource = read("deploy/CANVAS_UNKNOWN_RECOVERY_RUNBOOK.md");
const envTemplateSource = read("deploy/canvas.production.env.template");
const envCheckerSource = read("scripts/check-canvas-production-env.mjs");
const packageDocument = JSON.parse(read("package.json"));

let passed = 0;

async function check(label, callback) {
  try {
    const result = callback();
    if (result && typeof result.then === "function") await result;
    passed += 1;
    console.log(`[PASS] ${label}`);
  } catch (error) {
    console.error(
      `[FAIL] ${label}: ${error instanceof Error ? error.message : "unknown error"}`
    );
    process.exitCode = 1;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrows(callback, pattern, label) {
  let thrown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error, `${label} did not reject`);
  if (pattern) {
    assert(pattern.test(thrown.message), `${label} returned an unexpected error`);
  }
}

async function expectRejects(callback, pattern, label) {
  let thrown;
  try {
    await callback();
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error, `${label} did not reject`);
  if (pattern) {
    assert(pattern.test(thrown.message), `${label} returned an unexpected error`);
  }
  return thrown;
}

const adminSecret = `admin-${"A".repeat(40)}`;
const approverSecret = `approve-${"B".repeat(40)}`;
const environment = Object.freeze({
  CANVAS_RECOVERY_ADMIN_SECRET: adminSecret,
  CANVAS_RECOVERY_APPROVER_SECRET: approverSecret,
  CANVAS_RECOVERY_OPERATOR_LABEL: "operator.oncall",
  CANVAS_RECOVERY_APPROVER_LABEL: "approver.oncall",
});
const bindRequest = Object.freeze({
  resolutionId: "11111111-1111-4111-8111-111111111111",
  generationId: "22222222-2222-4222-8222-222222222222",
  resolution: "bind_task",
  taskId: "provider-task-123",
  approvalTicket: "INC-2026-001",
  providerEvidence:
    "SENSITIVE-EVIDENCE provider ticket confirms one unique task in the UTC window",
});
const refundRequest = Object.freeze({
  resolutionId: "33333333-3333-4333-8333-333333333333",
  generationId: "44444444-4444-4444-8444-444444444444",
  resolution: "verified_no_task_refund",
  taskId: null,
  approvalTicket: "INC-2026-002",
  providerEvidence:
    "SENSITIVE-EVIDENCE provider support confirmed no task in the full UTC window",
});

function successPayload(request, transitioned = true) {
  const bind = request.resolution === "bind_task";
  return {
    success: true,
    data: {
      resolutionId: request.resolutionId,
      generationId: request.generationId,
      status: bind ? "processing" : "failed",
      providerSubmissionState: bind ? "bound" : "unknown",
      taskId: bind ? request.taskId : null,
      refundedAmount: bind ? 0 : 5,
      balanceAfter: 100,
      transitioned,
    },
  };
}

async function withServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  try {
    const address = server.address();
    assert(
      address !== null && typeof address === "object",
      "test server has no address"
    );
    await callback(address.port);
  } finally {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
    });
  }
}

await check("route requires the independent admin bearer", () => {
  assert(
    /hasCanvasBearer\(\s*request,\s*"CANVAS_RECOVERY_ADMIN_SECRET"\s*\)/u.test(
      routeSource
    ),
    "admin bearer check is missing"
  );
});

await check("route requires the independent approver header", () => {
  assert(
    /hasCanvasHeaderSecret\(\s*request,\s*"x-canvas-recovery-approval",\s*"CANVAS_RECOVERY_APPROVER_SECRET"\s*\)/u.test(
      routeSource
    ),
    "approver header check is missing"
  );
  assert(
    /CANVAS_RECOVERY_ADMIN_SECRET[\s\S]{0,160}CANVAS_RECOVERY_APPROVER_SECRET/u.test(
      routeSource
    ) && routeSource.includes("!secretsDistinct"),
    "route does not fail closed for equal secrets"
  );
});

await check("route enforces distinct audited identities and strict input", () => {
  for (const token of [
    ".strictObject(",
    "approvalTicket",
    "providerEvidence",
    "operatorLabel !== approverLabel",
    "ticket=${input.approvalTicket}",
    "approver=${approverLabel}",
    "evidence=${input.providerEvidence}",
  ]) {
    assert(routeSource.includes(token), `route is missing ${token}`);
  }
});

await check("migration audit table is append-only and one-shot", () => {
  assert(
    /CREATE UNIQUE INDEX[\s\S]+ON public\.canvas_generation_resolution_audit \(generation_id\)/u.test(
      migrationSource
    ),
    "one-audit-per-generation index is missing"
  );
  assert(
    /ALTER TABLE public\.canvas_generation_resolution_audit FORCE ROW LEVEL SECURITY/u.test(
      migrationSource
    ),
    "forced RLS is missing"
  );
  assert(
    /CREATE TRIGGER canvas_generation_resolution_audit_append_only[\s\S]+BEFORE UPDATE OR DELETE/u.test(
      migrationSource
    ),
    "append-only trigger is missing"
  );
  assert(
    /REFERENCES public\.generations\(id\) ON DELETE RESTRICT/u.test(
      migrationSource
    ),
    "audit deletion fence is missing"
  );
});

await check("migration exposes audit and resolver only to service_role", () => {
  assert(
    /REVOKE ALL ON TABLE public\.canvas_generation_resolution_audit\s+FROM PUBLIC, anon, authenticated/u.test(
      migrationSource
    ),
    "audit table client revoke is missing"
  );
  assert(
    /GRANT SELECT ON TABLE public\.canvas_generation_resolution_audit TO service_role/u.test(
      migrationSource
    ),
    "audit table service grant is missing"
  );
  assert(
    /REVOKE ALL ON FUNCTION public\.resolve_canvas_video_unknown_v1\([\s\S]+?\)\s+FROM PUBLIC, anon, authenticated/u.test(
      migrationSource
    ),
    "resolver client revoke is missing"
  );
  assert(
    /GRANT EXECUTE ON FUNCTION public\.resolve_canvas_video_unknown_v1\([\s\S]+?\)\s+TO service_role/u.test(
      migrationSource
    ),
    "resolver service-only grant is missing"
  );
  assert(
    /SECURITY DEFINER\s+SET search_path = ''/u.test(migrationSource),
    "resolver does not pin search_path"
  );
});

await check("CLI source contains the file and transport fail-closed controls", () => {
  for (const token of [
    "constants.O_NOFOLLOW",
    "before.isSymbolicLink()",
    "before.uid !== 0",
    "(before.mode & 0o077) !== 0",
    "before.nlink !== 1",
    "assertTrustedPathAncestors(path, label)",
    "(entry.mode & 0o022) !== 0",
    'redirect: "error"',
    "AbortSignal.timeout(REQUEST_TIMEOUT_MS)",
    "const REQUEST_TIMEOUT_MS = 30_000",
    "const MAX_RESPONSE_BYTES = 64 * 1024",
    'url.protocol !== "http:"',
    '["127.0.0.1", "[::1]"]',
  ]) {
    assert(cliSource.includes(token), `CLI is missing ${token}`);
  }
});

await check("CLI accepts no secret or evidence command-line option", () => {
  expectThrows(
    () => parseArguments(["--admin-secret", adminSecret]),
    /unknown command-line argument/u,
    "secret argv"
  );
  expectThrows(
    () => parseArguments(["--provider-evidence", "secret"]),
    /unknown command-line argument/u,
    "evidence argv"
  );
  const dryRun = parseArguments([
    "--url",
    "http://127.0.0.1:3004/api/internal/canvas/resolve-unknown",
    "--env-file",
    "/root/recovery.env",
    "--request-file",
    "/root/request.json",
  ]);
  assert(dryRun.execute === false, "default mode is not validation-only");
  const execute = parseArguments([
    "--url",
    "http://127.0.0.1:3004/api/internal/canvas/resolve-unknown",
    "--env-file",
    "/root/recovery.env",
    "--request-file",
    "/root/request.json",
    "--execute",
  ]);
  assert(execute.execute === true, "--execute was not explicit");
});

await check("CLI help is executable and discloses no operation data", () => {
  const output = execFileSync(
    process.execPath,
    [join(root, "scripts/resolve-canvas-unknown.mjs"), "--help"],
    { encoding: "utf8", windowsHide: true }
  );
  assert(output.includes("Without --execute"), "help omits dry-run semantics");
  for (const sensitive of [adminSecret, approverSecret, "SENSITIVE-EVIDENCE"]) {
    assert(!output.includes(sensitive), "help disclosed sensitive material");
  }
});

await check("environment parser requires two strong, distinct secrets and labels", () => {
  const parsed = parseRecoveryEnvironment(
    [
      `CANVAS_RECOVERY_ADMIN_SECRET=${adminSecret}`,
      `CANVAS_RECOVERY_APPROVER_SECRET=${approverSecret}`,
      "CANVAS_RECOVERY_OPERATOR_LABEL=operator.oncall",
      "CANVAS_RECOVERY_APPROVER_LABEL=approver.oncall",
    ].join("\n")
  );
  assert(
    parsed.CANVAS_RECOVERY_ADMIN_SECRET === adminSecret,
    "admin secret was not parsed"
  );
  expectThrows(
    () =>
      parseRecoveryEnvironment(
        [
          `CANVAS_RECOVERY_ADMIN_SECRET=${adminSecret}`,
          `CANVAS_RECOVERY_APPROVER_SECRET=${adminSecret}`,
          "CANVAS_RECOVERY_OPERATOR_LABEL=operator.oncall",
          "CANVAS_RECOVERY_APPROVER_LABEL=approver.oncall",
        ].join("\n")
      ),
    /secrets must be different/u,
    "equal secrets"
  );
  expectThrows(
    () =>
      parseRecoveryEnvironment(
        [
          `CANVAS_RECOVERY_ADMIN_SECRET=${adminSecret}`,
          `CANVAS_RECOVERY_APPROVER_SECRET=${approverSecret}`,
          "CANVAS_RECOVERY_OPERATOR_LABEL=same.person",
          "CANVAS_RECOVERY_APPROVER_LABEL=same.person",
        ].join("\n")
      ),
    /labels must be different/u,
    "equal labels"
  );
});

await check("request validator accepts only the two exact resolution shapes", () => {
  const bind = validateRecoveryRequest({ ...bindRequest });
  const refund = validateRecoveryRequest({ ...refundRequest });
  assert(bind.taskId === bindRequest.taskId, "bind task identity changed");
  assert(refund.taskId === null, "refund did not retain explicit null");

  expectThrows(
    () => validateRecoveryRequest({ ...bindRequest, taskId: null }),
    /requires one canonical taskId/u,
    "bind without task"
  );
  expectThrows(
    () =>
      validateRecoveryRequest({
        ...refundRequest,
        taskId: "must-not-exist",
      }),
    /requires taskId to be null/u,
    "refund with task"
  );
  expectThrows(
    () => validateRecoveryRequest({ ...bindRequest, extra: true }),
    /unexpected shape/u,
    "extra input"
  );
  const missing = { ...bindRequest };
  delete missing.approvalTicket;
  expectThrows(
    () => validateRecoveryRequest(missing),
    /unexpected shape/u,
    "missing input"
  );
});

await check("request validator rejects malformed identity and evidence", () => {
  expectThrows(
    () =>
      validateRecoveryRequest({
        ...bindRequest,
        generationId: "00000000-0000-0000-0000-000000000000",
      }),
    /canonical UUID/u,
    "nil UUID"
  );
  expectThrows(
    () =>
      validateRecoveryRequest({
        ...bindRequest,
        approvalTicket: "bad ticket",
      }),
    /approvalTicket/u,
    "approval ticket"
  );
  expectThrows(
    () =>
      validateRecoveryRequest({
        ...bindRequest,
        providerEvidence: "valid text\nsecond line",
      }),
    /providerEvidence/u,
    "control character"
  );
  expectThrows(
    () =>
      validateRecoveryRequest({
        ...bindRequest,
        providerEvidence: "x".repeat(1701),
      }),
    /providerEvidence/u,
    "oversized evidence"
  );
});

await check("URL parser permits only the exact numeric-loopback endpoint", () => {
  for (const valid of [
    "http://127.0.0.1:3004/api/internal/canvas/resolve-unknown",
    "http://[::1]:3004/api/internal/canvas/resolve-unknown",
  ]) {
    parseRecoveryUrl(valid);
  }
  for (const invalid of [
    "https://127.0.0.1:3004/api/internal/canvas/resolve-unknown",
    "http://localhost:3004/api/internal/canvas/resolve-unknown",
    "http://127.0.0.2:3004/api/internal/canvas/resolve-unknown",
    "http://user@127.0.0.1:3004/api/internal/canvas/resolve-unknown",
    "http://127.0.0.1:3004/api/internal/canvas/resolve-unknown?execute=1",
    "http://127.0.0.1:3004/api/internal/canvas/resolve-unknown#fragment",
    "http://127.0.0.1:3004/api/internal/canvas/resolve-unknown/",
    "http://127.0.0.1:3004/api/internal/canvas/health",
  ]) {
    expectThrows(
      () => parseRecoveryUrl(invalid),
      /exact numeric-loopback/u,
      "unsafe URL"
    );
  }
});

await check("POST sends both secrets and the exact approved request", async () => {
  await withServer(
    async (incoming, response) => {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert(incoming.method === "POST", "method is not POST");
      assert(
        incoming.url === "/api/internal/canvas/resolve-unknown",
        "request path changed"
      );
      assert(
        incoming.headers.authorization === `Bearer ${adminSecret}`,
        "admin bearer is missing"
      );
      assert(
        incoming.headers["x-canvas-recovery-approval"] === approverSecret,
        "approver secret is missing"
      );
      assert(
        JSON.stringify(body) === JSON.stringify(bindRequest),
        "request body changed"
      );
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(successPayload(bindRequest)));
    },
    async (port) => {
      const result = await postRecovery(
        parseRecoveryUrl(
          `http://127.0.0.1:${port}/api/internal/canvas/resolve-unknown`
        ),
        environment,
        bindRequest
      );
      assert(result.status === "processing", "bind result was not validated");
      assert(result.refundedAmount === 0, "bind unexpectedly refunded credits");
    }
  );
});

await check("POST refuses redirects without reaching the target", async () => {
  let redirected = false;
  await withServer(
    (incoming, response) => {
      if (incoming.url === "/redirect-target") {
        redirected = true;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(successPayload(bindRequest)));
        return;
      }
      response.writeHead(302, { Location: "/redirect-target" });
      response.end();
    },
    async (port) => {
      await expectRejects(
        () =>
          postRecovery(
            parseRecoveryUrl(
              `http://127.0.0.1:${port}/api/internal/canvas/resolve-unknown`
            ),
            environment,
            bindRequest
          ),
        /failed before a valid response/u,
        "redirect"
      );
    }
  );
  assert(redirected === false, "redirect target was reached");
});

await check("POST caps response bytes before parsing", async () => {
  await withServer(
    (_incoming, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": String(65 * 1024),
      });
      response.end("x".repeat(65 * 1024));
    },
    async (port) => {
      await expectRejects(
        () =>
          postRecovery(
            parseRecoveryUrl(
              `http://127.0.0.1:${port}/api/internal/canvas/resolve-unknown`
            ),
            environment,
            bindRequest
          ),
        /exceeded the size limit/u,
        "oversized response"
      );
    }
  );
});

await check("response validation rejects cross-operation or unsafe results", () => {
  validateSuccessResponse(successPayload(refundRequest), refundRequest);
  const crossed = successPayload(bindRequest);
  crossed.data.generationId = refundRequest.generationId;
  expectThrows(
    () => validateSuccessResponse(crossed, bindRequest),
    /identity does not match/u,
    "crossed identity"
  );
  const nonStringIdentity = successPayload(bindRequest);
  nonStringIdentity.data.resolutionId = { toLowerCase: "not-callable" };
  expectThrows(
    () => validateSuccessResponse(nonStringIdentity, bindRequest),
    /identity does not match/u,
    "non-string identity"
  );
  const badRefund = successPayload(refundRequest);
  badRefund.data.taskId = "unexpected-task";
  expectThrows(
    () => validateSuccessResponse(badRefund, refundRequest),
    /refund result violates/u,
    "refund task"
  );
});

await check("rejected responses do not echo secrets or provider evidence", async () => {
  await withServer(
    (_incoming, response) => {
      response.writeHead(409, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          success: false,
          error: {
            code: "RESOLUTION_REJECTED",
            message: `${adminSecret} ${bindRequest.providerEvidence}`,
          },
        })
      );
    },
    async (port) => {
      const error = await expectRejects(
        () =>
          postRecovery(
            parseRecoveryUrl(
              `http://127.0.0.1:${port}/api/internal/canvas/resolve-unknown`
            ),
            environment,
            bindRequest
          ),
        /HTTP 409, code RESOLUTION_REJECTED/u,
        "rejected operation"
      );
      assert(!error.message.includes(adminSecret), "error disclosed admin secret");
      assert(
        !error.message.includes(bindRequest.providerEvidence),
        "error disclosed provider evidence"
      );
    }
  );
});

await check("production env template and checker cover two-person recovery", () => {
  for (const name of [
    "CANVAS_RECOVERY_ADMIN_SECRET",
    "CANVAS_RECOVERY_APPROVER_SECRET",
    "CANVAS_RECOVERY_OPERATOR_LABEL",
    "CANVAS_RECOVERY_APPROVER_LABEL",
  ]) {
    assert(envTemplateSource.includes(`${name}=`), `template is missing ${name}`);
    assert(envCheckerSource.includes(`"${name}"`), `checker is missing ${name}`);
  }
  assert(
    envCheckerSource.includes("privilegedSecrets") &&
      envCheckerSource.includes("recoveryLabelPattern") &&
      envCheckerSource.includes("operator and approver must be different"),
    "environment checker omits secret/identity separation"
  );
});

await check("runbook forbids blind refunds and repeat submissions", () => {
  for (const token of [
    "不得因为前端超时",
    "不得对 unknown 记录重新提交生成",
    "bind_task",
    "verified_no_task_refund",
    "双人职责",
    "Provider evidence 标准",
    "root:root",
    "Dry-run 与执行",
    "同一份 JSON 原样重放",
    "canvas_generation_resolution_audit",
    "credit_transactions",
  ]) {
    assert(runbookSource.includes(token), `runbook is missing ${token}`);
  }
});

await check("package exposes only file-based operation and verifier commands", () => {
  assert(
    packageDocument.scripts["canvas:resolve-unknown"] ===
      "node -- scripts/resolve-canvas-unknown.mjs",
    "operation script is not registered"
  );
  assert(
    packageDocument.scripts["verify:canvas-manual-recovery"] ===
      "node -- scripts/verify-canvas-manual-recovery.mjs",
    "verification script is not registered"
  );
});

if (process.exitCode) {
  console.error(`[FAIL] Canvas manual recovery verification failed after ${passed} passing checks.`);
} else {
  console.log(`[OK] Canvas manual recovery verification passed (${passed} checks).`);
}
