#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { readExactReleaseEnvironment } from "./canvas-exact-env.mjs";

const HEALTH_CONTRACT = "canvas-production-health-v1";
const REQUIRED_RPC_COUNT = 27;
const MAX_RESPONSE_BYTES = 64 * 1024;

function usage() {
  return [
    "Usage: node scripts/probe-canvas-internal-health.mjs [options]",
    "",
    "Required:",
    "  --url <loopback-url>  Exact /api/internal/canvas/health endpoint.",
    "  --root <release-dir>   Release whose .next/BUILD_ID must answer.",
    "  --env-file <path>      Must be that release's exact .env.local.",
    "",
    "Optional:",
    "  --attempts <n>         Number of attempts (default: 1).",
    "  --interval-ms <n>      Delay between attempts (default: 2000).",
    "  --timeout-ms <n>       Per-request timeout (default: 10000).",
    "  --help                 Show this help.",
    "",
    "No secret is accepted on the command line or printed.",
  ].join("\n");
}

function parseInteger(value, name, minimum, maximum) {
  if (!/^[0-9]+$/u.test(value ?? "")) {
    throw new Error(`${name} must be an integer`);
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseArguments(argv) {
  const options = {
    attempts: 1,
    intervalMs: 2_000,
    timeoutMs: 10_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    if (argument === "--url") options.url = value;
    else if (argument === "--root") options.root = value;
    else if (argument === "--env-file") options.envFile = value;
    else if (argument === "--attempts") {
      options.attempts = parseInteger(value, "--attempts", 1, 120);
    } else if (argument === "--interval-ms") {
      options.intervalMs = parseInteger(value, "--interval-ms", 0, 30_000);
    } else if (argument === "--timeout-ms") {
      options.timeoutMs = parseInteger(value, "--timeout-ms", 500, 30_000);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
    index += 1;
  }
  if (!options.url || !options.root || !options.envFile) {
    throw new Error("--url, --root, and --env-file are required");
  }
  return options;
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} is not an object`);
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
    throw new Error(`${label} has an unexpected shape`);
  }
}

function parseExpectedResponse(value, expectedBuildId, expectedVersion) {
  const root = assertPlainObject(value, "health response");
  assertExactKeys(
    root,
    ["status", "build", "database", "canvas"],
    "health response"
  );
  if (root.status !== "ok") throw new Error("health status is not ok");

  const build = assertPlainObject(root.build, "build metadata");
  assertExactKeys(build, ["id", "version"], "build metadata");
  if (build.id !== expectedBuildId || build.version !== expectedVersion) {
    throw new Error("candidate build identity mismatch");
  }

  const database = assertPlainObject(root.database, "database health");
  assertExactKeys(
    database,
    ["reachable", "readOnlyProbe"],
    "database health"
  );
  if (database.reachable !== true || database.readOnlyProbe !== true) {
    throw new Error("database read-only probe did not pass");
  }

  const canvas = assertPlainObject(root.canvas, "Canvas contract");
  assertExactKeys(
    canvas,
    ["contractVersion", "requiredRpcCount"],
    "Canvas contract"
  );
  if (
    canvas.contractVersion !== HEALTH_CONTRACT ||
    canvas.requiredRpcCount !== REQUIRED_RPC_COUNT
  ) {
    throw new Error("Canvas RPC contract mismatch");
  }
}

function readReleaseIdentity(rootInput, envInput) {
  const root = resolve(rootInput);
  const envFile = resolve(envInput);
  if (!existsSync(root)) throw new Error("release root does not exist");
  const rootEntry = lstatSync(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error("release root must be a non-symlink directory");
  }
  const canonicalRoot = realpathSync(root);
  const expectedEnvFile = join(canonicalRoot, ".env.local");
  if (envFile !== expectedEnvFile) {
    throw new Error("--env-file must equal the release's exact .env.local");
  }
  const envEntry = lstatSync(envFile);
  if (
    !envEntry.isFile() ||
    envEntry.isSymbolicLink() ||
    envEntry.size > 1024 * 1024
  ) {
    throw new Error(".env.local must be a trusted regular file");
  }
  if (
    typeof process.getuid === "function" &&
    process.getuid() === 0 &&
    (envEntry.uid !== 0 || (envEntry.mode & 0o077) !== 0)
  ) {
    throw new Error(".env.local must be root-owned and root-only");
  }
  const environment = readExactReleaseEnvironment(
    canonicalRoot,
    envFile
  ).values;
  const secret = environment.CANVAS_RECONCILE_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("CANVAS_RECONCILE_SECRET is not configured");
  }

  const buildId = readFileSync(join(canonicalRoot, ".next", "BUILD_ID"), "utf8")
    .trim();
  const packageDocument = JSON.parse(
    readFileSync(join(canonicalRoot, "package.json"), "utf8")
  );
  const version =
    typeof packageDocument.version === "string"
      ? packageDocument.version.trim()
      : "";
  if (!/^[A-Za-z0-9._-]{1,200}$/u.test(buildId)) {
    throw new Error("release BUILD_ID is invalid");
  }
  if (
    version.length < 1 ||
    version.length > 100 ||
    /[\u0000-\u001f\u007f]/u.test(version)
  ) {
    throw new Error("release version is invalid");
  }
  return { root: canonicalRoot, envFile, secret, buildId, version };
}

function parseHealthUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--url must be a valid URL");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/api/internal/canvas/health" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("--url must be the exact loopback Canvas health endpoint");
  }
  return url;
}

async function sleep(milliseconds) {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function readLimitedBody(response) {
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
        throw new Error("health response is too large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function probeOnce(url, release, timeoutMs) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${release.secret}`,
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== 200) {
    throw new Error(`health endpoint returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:;|$)/iu.test(contentType)) {
    throw new Error("health endpoint did not return JSON");
  }
  const declaredLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10
  );
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("health response is too large");
  }
  const body = await readLimitedBody(response);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("health response is invalid JSON");
  }
  parseExpectedResponse(parsed, release.buildId, release.version);
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`[FAIL] ${error.message}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  let release;
  let url;
  try {
    release = readReleaseIdentity(options.root, options.envFile);
    url = parseHealthUrl(options.url);
  } catch (error) {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let lastError;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      await probeOnce(url, release, options.timeoutMs);
      console.log("[OK] Exact Canvas internal health contract passed.");
      return;
    } catch (error) {
      lastError = error;
      if (attempt < options.attempts) await sleep(options.intervalMs);
    }
  }
  console.error(
    `[FAIL] Canvas internal health failed: ${
      lastError instanceof Error ? lastError.message : "unknown error"
    }`
  );
  process.exitCode = 1;
}

await main();
