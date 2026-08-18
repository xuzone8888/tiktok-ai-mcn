#!/usr/bin/env node
/* eslint-disable no-console */

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REQUEST_PATH = "/api/internal/canvas/resolve-unknown";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ENV_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TASK_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const APPROVAL_TICKET_PATTERN = /^[A-Za-z0-9._:/-]{3,120}$/u;
const RECOVERY_LABEL_PATTERN = /^[A-Za-z0-9._@-]{3,48}$/u;
const SECRET_PATTERN = /^[\x21-\x7e]{32,512}$/u;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/u;

function usage() {
  return [
    "Usage:",
    "  node scripts/resolve-canvas-unknown.mjs --url <loopback-url> \\",
    "    --env-file <root-only-env> --request-file <root-only-json> [--execute]",
    "",
    "Without --execute, the command only validates the protected files and request.",
    "Secrets and provider evidence are never accepted as arguments or printed.",
  ].join("\n");
}

function fail(message) {
  throw new Error(message);
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be a JSON object`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((entry, index) => entry !== wanted[index])
  ) {
    fail(`${label} has an unexpected shape`);
  }
}

export function parseArguments(argv) {
  const options = { execute: false };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      if (seen.has(argument)) fail("--help may only be supplied once");
      seen.add(argument);
      options.help = true;
      continue;
    }
    if (argument === "--execute") {
      if (seen.has(argument)) fail("--execute may only be supplied once");
      seen.add(argument);
      options.execute = true;
      continue;
    }

    const key = {
      "--url": "url",
      "--env-file": "envFile",
      "--request-file": "requestFile",
    }[argument];
    if (!key) fail("unknown command-line argument");
    if (seen.has(argument)) fail(`${argument} may only be supplied once`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`${argument} requires a value`);
    }
    seen.add(argument);
    options[key] = value;
    index += 1;
  }

  if (options.help) return options;
  if (!options.url || !options.envFile || !options.requestFile) {
    fail("--url, --env-file, and --request-file are required");
  }
  return options;
}

function requirePosixRoot() {
  if (
    typeof process.getuid !== "function" ||
    process.platform === "win32" ||
    process.getuid() !== 0
  ) {
    fail("this recovery command must run as root on the production POSIX host");
  }
}

function assertTrustedPathAncestors(path, label) {
  let current = dirname(path);
  while (true) {
    let entry;
    try {
      entry = lstatSync(current);
    } catch {
      fail(`${label} has an unavailable parent directory`);
    }
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      entry.uid !== 0 ||
      (entry.mode & 0o022) !== 0
    ) {
      fail(
        `${label} must be below non-symlink, root-owned directories that are not group/world writable`
      );
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function readProtectedRootFile(pathInput, label, maximumBytes) {
  requirePosixRoot();
  const path = resolve(pathInput);
  assertTrustedPathAncestors(path, label);
  let before;
  try {
    before = lstatSync(path);
  } catch {
    fail(`${label} is unavailable`);
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.uid !== 0 ||
    (before.mode & 0o077) !== 0 ||
    before.nlink !== 1 ||
    before.size < 1 ||
    before.size > maximumBytes
  ) {
    fail(
      `${label} must be a non-symlink, root-owned, root-only regular file within the size limit`
    );
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.uid !== 0 ||
      (opened.mode & 0o077) !== 0 ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size < 1 ||
      opened.size > maximumBytes
    ) {
      fail(`${label} changed or failed its protection check`);
    }
    const content = readFileSync(descriptor);
    if (content.byteLength < 1 || content.byteLength > maximumBytes) {
      content.fill(0);
      fail(`${label} is outside its size limit`);
    }
    return content;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith(`${label} `) ||
        error.message.startsWith(`${label} is`))
    ) {
      throw error;
    }
    fail(`${label} could not be read safely`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail(`${label} must be valid UTF-8`);
  } finally {
    buffer.fill(0);
  }
}

function parseQuotedEnvValue(rawValue, name) {
  const value = rawValue.trim();
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      fail(`${name} has an invalid quoted value`);
    }
    return value.slice(1, -1);
  }
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) {
      fail(`${name} has an invalid quoted value`);
    }
    const inner = value.slice(1, -1);
    if (/\\(?!["\\])/u.test(inner)) {
      fail(`${name} contains an unsupported escape`);
    }
    return inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  return value;
}

export function parseRecoveryEnvironment(text) {
  const requiredNames = new Set([
    "CANVAS_RECOVERY_ADMIN_SECRET",
    "CANVAS_RECOVERY_APPROVER_SECRET",
    "CANVAS_RECOVERY_OPERATOR_LABEL",
    "CANVAS_RECOVERY_APPROVER_LABEL",
  ]);
  const values = {};

  for (const rawLine of text.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match =
      /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/u.exec(
        rawLine
      );
    if (!match || !requiredNames.has(match[1])) continue;
    const name = match[1];
    if (Object.hasOwn(values, name)) fail(`${name} is configured more than once`);
    values[name] = parseQuotedEnvValue(match[2], name);
  }

  for (const name of requiredNames) {
    if (!Object.hasOwn(values, name)) fail(`${name} is not configured`);
  }
  if (
    !SECRET_PATTERN.test(values.CANVAS_RECOVERY_ADMIN_SECRET) ||
    !SECRET_PATTERN.test(values.CANVAS_RECOVERY_APPROVER_SECRET)
  ) {
    fail("recovery secrets must be 32-512 visible ASCII characters");
  }
  if (
    values.CANVAS_RECOVERY_ADMIN_SECRET ===
    values.CANVAS_RECOVERY_APPROVER_SECRET
  ) {
    fail("operator and approver secrets must be different");
  }
  if (
    !RECOVERY_LABEL_PATTERN.test(values.CANVAS_RECOVERY_OPERATOR_LABEL) ||
    !RECOVERY_LABEL_PATTERN.test(values.CANVAS_RECOVERY_APPROVER_LABEL)
  ) {
    fail("recovery labels do not match the production contract");
  }
  if (
    values.CANVAS_RECOVERY_OPERATOR_LABEL ===
    values.CANVAS_RECOVERY_APPROVER_LABEL
  ) {
    fail("operator and approver labels must be different");
  }
  return Object.freeze(values);
}

function assertUuid(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail(`${label} must be a canonical UUID`);
  }
  return value.toLowerCase();
}

export function validateRecoveryRequest(value) {
  const request = assertPlainObject(value, "recovery request");
  assertExactKeys(
    request,
    [
      "resolutionId",
      "generationId",
      "resolution",
      "taskId",
      "approvalTicket",
      "providerEvidence",
    ],
    "recovery request"
  );

  const resolutionId = assertUuid(request.resolutionId, "resolutionId");
  const generationId = assertUuid(request.generationId, "generationId");
  if (
    request.resolution !== "bind_task" &&
    request.resolution !== "verified_no_task_refund"
  ) {
    fail("resolution is unsupported");
  }
  if (
    typeof request.approvalTicket !== "string" ||
    !APPROVAL_TICKET_PATTERN.test(request.approvalTicket)
  ) {
    fail("approvalTicket does not match the production contract");
  }
  if (
    typeof request.providerEvidence !== "string" ||
    request.providerEvidence.length < 8 ||
    request.providerEvidence.length > 1700 ||
    /[\u0000-\u001f\u007f]/u.test(request.providerEvidence)
  ) {
    fail("providerEvidence does not match the production contract");
  }

  if (request.resolution === "bind_task") {
    if (
      typeof request.taskId !== "string" ||
      !TASK_ID_PATTERN.test(request.taskId)
    ) {
      fail("bind_task requires one canonical taskId");
    }
  } else if (request.taskId !== null) {
    fail("verified_no_task_refund requires taskId to be null");
  }

  return Object.freeze({
    resolutionId,
    generationId,
    resolution: request.resolution,
    taskId: request.taskId,
    approvalTicket: request.approvalTicket,
    providerEvidence: request.providerEvidence,
  });
}

function parseRequestFile(buffer) {
  const text = decodeUtf8(buffer, "request file");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("request file must contain valid JSON");
  }
  return validateRecoveryRequest(parsed);
}

export function parseRecoveryUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("--url must be a valid URL");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== REQUEST_PATH ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    fail("--url must be the exact numeric-loopback HTTP recovery endpoint");
  }
  return url;
}

async function readLimitedResponse(response) {
  const declaredLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10
  );
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    fail("recovery response exceeded the size limit");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail("recovery response exceeded the size limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    fail("recovery endpoint returned invalid JSON");
  }
}

function parseRejectedResponse(value, status) {
  let code = "UNCLASSIFIED";
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.error !== null &&
    typeof value.error === "object" &&
    !Array.isArray(value.error) &&
    typeof value.error.code === "string" &&
    SAFE_ERROR_CODE_PATTERN.test(value.error.code)
  ) {
    code = value.error.code;
  }
  fail(`recovery endpoint rejected the operation (HTTP ${status}, code ${code})`);
}

export function validateSuccessResponse(value, request) {
  const root = assertPlainObject(value, "recovery response");
  assertExactKeys(root, ["success", "data"], "recovery response");
  if (root.success !== true) fail("recovery response did not confirm success");
  const data = assertPlainObject(root.data, "recovery result");
  assertExactKeys(
    data,
    [
      "resolutionId",
      "generationId",
      "status",
      "providerSubmissionState",
      "taskId",
      "refundedAmount",
      "balanceAfter",
      "transitioned",
    ],
    "recovery result"
  );
  if (
    typeof data.resolutionId !== "string" ||
    typeof data.generationId !== "string" ||
    data.resolutionId.toLowerCase() !== request.resolutionId ||
    data.generationId.toLowerCase() !== request.generationId
  ) {
    fail("recovery result identity does not match the request");
  }
  if (
    !Number.isSafeInteger(data.refundedAmount) ||
    data.refundedAmount < 0 ||
    !Number.isSafeInteger(data.balanceAfter) ||
    data.balanceAfter < 0 ||
    typeof data.transitioned !== "boolean"
  ) {
    fail("recovery result contains invalid accounting data");
  }

  if (request.resolution === "bind_task") {
    if (
      data.status !== "processing" ||
      data.providerSubmissionState !== "bound" ||
      data.taskId !== request.taskId ||
      data.refundedAmount !== 0
    ) {
      fail("bind_task result violates the recovery contract");
    }
  } else if (
    data.status !== "failed" ||
    data.providerSubmissionState !== "unknown" ||
    data.taskId !== null
  ) {
    fail("verified_no_task_refund result violates the recovery contract");
  }

  return Object.freeze({
    resolutionId: request.resolutionId,
    generationId: request.generationId,
    resolution: request.resolution,
    status: data.status,
    providerSubmissionState: data.providerSubmissionState,
    taskId: data.taskId,
    refundedAmount: data.refundedAmount,
    balanceAfter: data.balanceAfter,
    transitioned: data.transitioned,
  });
}

export async function postRecovery(url, environment, request) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${environment.CANVAS_RECOVERY_ADMIN_SECRET}`,
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        "x-canvas-recovery-approval":
          environment.CANVAS_RECOVERY_APPROVER_SECRET,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    fail("recovery request failed before a valid response was received");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:;|$)/iu.test(contentType)) {
    fail("recovery endpoint did not return JSON");
  }
  const body = await readLimitedResponse(response);
  const parsed = parseJsonResponse(body);
  if (response.status !== 200) parseRejectedResponse(parsed, response.status);
  return validateSuccessResponse(parsed, request);
}

function validationSummary(environment, request) {
  return {
    mode: "validation-only",
    operatorLabel: environment.CANVAS_RECOVERY_OPERATOR_LABEL,
    approverLabel: environment.CANVAS_RECOVERY_APPROVER_LABEL,
    resolutionId: request.resolutionId,
    generationId: request.generationId,
    resolution: request.resolution,
    taskId: request.taskId,
    validated: true,
    executed: false,
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : "invalid arguments"}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  try {
    const url = parseRecoveryUrl(options.url);
    const environmentText = decodeUtf8(
      readProtectedRootFile(options.envFile, "environment file", MAX_ENV_BYTES),
      "environment file"
    );
    const environment = parseRecoveryEnvironment(environmentText);
    const request = parseRequestFile(
      readProtectedRootFile(
        options.requestFile,
        "request file",
        MAX_REQUEST_BYTES
      )
    );

    if (!options.execute) {
      console.log(JSON.stringify(validationSummary(environment, request), null, 2));
      return;
    }

    const result = await postRecovery(url, environment, request);
    console.log(
      JSON.stringify(
        {
          mode: "executed",
          operatorLabel: environment.CANVAS_RECOVERY_OPERATOR_LABEL,
          approverLabel: environment.CANVAS_RECOVERY_APPROVER_LABEL,
          ...result,
          executed: true,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      `[FAIL] ${
        error instanceof Error ? error.message : "manual recovery operation failed"
      }`
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  await main();
}
