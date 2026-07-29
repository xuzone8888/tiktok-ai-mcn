#!/usr/bin/env node

import { X509Certificate } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import process from "node:process";

import { readExactReleaseEnvironment } from "./canvas-exact-env.mjs";

const executionNodeEnv = process.env.NODE_ENV;
let environment = Object.create(null);

function usage() {
  return [
    "Usage: node scripts/check-canvas-production-env.mjs [options]",
    "",
    "Options:",
    "  --env-file <path>  Environment file to load (default: .env.local)",
    "  --root <path>      Release root used for build checks (default: cwd)",
    "  --require-build    Require a non-empty .next/BUILD_ID",
    "  --help             Show this help",
    "",
    "The checker prints variable names and readiness results only. It never",
    "prints environment-variable values, lengths, hashes, or masked values.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    envFile: ".env.local",
    root: process.cwd(),
    requireBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--require-build") {
      options.requireBuild = true;
      continue;
    }
    if (argument === "--env-file" || argument === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a path`);
      }
      if (argument === "--env-file") options.envFile = value;
      else options.root = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument at position ${index + 1}`);
  }

  return {
    envFile: resolve(options.root, options.envFile),
    root: resolve(options.root),
    requireBuild: options.requireBuild,
  };
}

function isConfigured(name) {
  const value = environment[name];
  return typeof value === "string" && value.trim().length > 0;
}

function firstConfigured(names) {
  return names.find(isConfigured);
}

function looksLikePlaceholder(name) {
  const value = environment[name]?.trim().toLowerCase() ?? "";
  if (!value) return false;
  return [
    "changeme",
    "change-me",
    "replace-me",
    "replace_with",
    "your-",
    "your_",
    "<secret>",
    "example.com",
  ].some((marker) => value.includes(marker));
}

function isHttpsUrl(name) {
  const value = environment[name];
  if (typeof value !== "string" || value !== value.trim()) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(`[FAIL] ${error.message}`);
  console.error(usage());
  process.exit(2);
}

const failures = [];
const warnings = [];

function pass(label) {
  console.log(`[OK] ${label}`);
}

function fail(label, detail) {
  failures.push(label);
  console.error(`[FAIL] ${label}${detail ? `: ${detail}` : ""}`);
}

function warn(label, detail) {
  warnings.push(label);
  console.warn(`[WARN] ${label}${detail ? `: ${detail}` : ""}`);
}

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor === 20) {
  pass("Node.js major version is 20");
} else {
  fail("Node.js major version", "Node 20 is required");
}

if (!existsSync(options.envFile)) {
  fail("environment file", "file is missing");
} else {
  try {
    environment = readExactReleaseEnvironment(
      options.root,
      options.envFile
    ).values;
    pass("environment file parsed");
  } catch {
    fail("environment file", "file could not be parsed");
  }
}

const requiredNames = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ALIYUN_OSS_REGION",
  "ALIYUN_OSS_ACCESS_KEY_ID",
  "ALIYUN_OSS_ACCESS_KEY_SECRET",
  "ALIYUN_OSS_BUCKET",
  "ALIYUN_OSS_ENDPOINT",
  "ALIYUN_OSS_CUSTOM_DOMAIN",
  "CANVAS_RECONCILE_SECRET",
  "CANVAS_RECOVERY_ADMIN_SECRET",
  "CANVAS_RECOVERY_APPROVER_SECRET",
  "CANVAS_RECOVERY_OPERATOR_LABEL",
  "CANVAS_RECOVERY_APPROVER_LABEL",
  "CANVAS_PUBLIC_ENABLED",
  "NEXT_PUBLIC_CANVAS_ENABLED",
  "CANVAS_VIDEO_MODELS",
  "NEXT_PUBLIC_CANVAS_VIDEO_MODELS",
];

for (const name of requiredNames) {
  if (!isConfigured(name)) {
    fail(name, "missing");
  } else if (environment[name] !== environment[name].trim()) {
    fail(name, "leading or trailing whitespace is not allowed");
  } else if (looksLikePlaceholder(name)) {
    fail(name, "placeholder value is not allowed");
  } else {
    pass(name);
  }
}

const providerConfigurationNames = [
  "VIDEO_PLATFORM_IMAGE_API_KEY",
  "IMAGE_PLATFORM_API_KEY",
  "VIDEO_PLATFORM_API_KEY",
  "SORA2_API_KEY",
  "WUYINKEJI_API_KEY",
  "VIDEO_PLATFORM_IMAGE_BASE_URL",
  "IMAGE_PLATFORM_BASE_URL",
  "VIDEO_PLATFORM_BASE_URL",
  "VIDEO_PLATFORM_API_BASE",
  "VIDEO_PLATFORM_API_ENDPOINT",
];

for (const name of providerConfigurationNames) {
  const rawValue = environment[name];
  if (typeof rawValue === "string" && rawValue.length > 0 && rawValue !== rawValue.trim()) {
    fail(name, "leading or trailing whitespace is not allowed");
  } else if (isConfigured(name) && looksLikePlaceholder(name)) {
    fail(name, "placeholder value is not allowed");
  }
}

for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "ALIYUN_OSS_ENDPOINT"]) {
  if (isConfigured(name) && !isHttpsUrl(name)) {
    fail(name, "must be a valid HTTPS URL");
  }
}

if (isConfigured("OAUTH_BROKER_URL")) {
  if (!isHttpsUrl("OAUTH_BROKER_URL")) {
    fail("OAUTH_BROKER_URL", "must be a valid HTTPS URL");
  } else {
    pass("OAUTH_BROKER_URL");
  }

  if (!isConfigured("NODE_EXTRA_CA_CERTS")) {
    fail(
      "NODE_EXTRA_CA_CERTS",
      "required when the OAuth broker is enabled"
    );
  } else if (
    environment.NODE_EXTRA_CA_CERTS !==
    environment.NODE_EXTRA_CA_CERTS.trim()
  ) {
    fail("NODE_EXTRA_CA_CERTS", "leading or trailing whitespace is not allowed");
  } else if (!isAbsolute(environment.NODE_EXTRA_CA_CERTS)) {
    fail("NODE_EXTRA_CA_CERTS", "must be an absolute path");
  } else {
    try {
      const caEntry = lstatSync(environment.NODE_EXTRA_CA_CERTS);
      if (!caEntry.isFile() || caEntry.isSymbolicLink()) {
        throw new Error("not a trusted regular file");
      }
      new X509Certificate(readFileSync(environment.NODE_EXTRA_CA_CERTS));
      pass("NODE_EXTRA_CA_CERTS trust anchor");
    } catch {
      fail(
        "NODE_EXTRA_CA_CERTS",
        "must reference a readable non-symlink PEM certificate"
      );
    }
  }
}

if (
  isConfigured("SUPABASE_SERVICE_ROLE_KEY") &&
  isConfigured("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
  environment.SUPABASE_SERVICE_ROLE_KEY === environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
) {
  fail("SUPABASE_SERVICE_ROLE_KEY", "must not equal the anonymous key");
}

for (const name of [
  "CANVAS_RECONCILE_SECRET",
  "CANVAS_RECOVERY_ADMIN_SECRET",
  "CANVAS_RECOVERY_APPROVER_SECRET",
]) {
  if (
    isConfigured(name) &&
    !/^[\x21-\x7e]{32,512}$/.test(environment[name])
  ) {
    fail(name, "must be 32-512 visible ASCII characters");
  }
}

const privilegedSecrets = [
  "CANVAS_RECONCILE_SECRET",
  "CANVAS_RECOVERY_ADMIN_SECRET",
  "CANVAS_RECOVERY_APPROVER_SECRET",
].filter(isConfigured);
if (
  new Set(privilegedSecrets.map((name) => environment[name])).size !==
  privilegedSecrets.length
) {
  fail(
    "Canvas internal secrets",
    "reconcile, recovery operator, and recovery approver secrets must be pairwise distinct"
  );
}

const recoveryLabelPattern = /^[A-Za-z0-9._@-]{3,48}$/;
for (const name of [
  "CANVAS_RECOVERY_OPERATOR_LABEL",
  "CANVAS_RECOVERY_APPROVER_LABEL",
]) {
  if (isConfigured(name) && !recoveryLabelPattern.test(environment[name])) {
    fail(name, "must be 3-48 characters from A-Z a-z 0-9 . _ @ -");
  }
}
if (
  isConfigured("CANVAS_RECOVERY_OPERATOR_LABEL") &&
  isConfigured("CANVAS_RECOVERY_APPROVER_LABEL") &&
  environment.CANVAS_RECOVERY_OPERATOR_LABEL ===
    environment.CANVAS_RECOVERY_APPROVER_LABEL
) {
  fail("Canvas recovery labels", "operator and approver must be different");
}

for (const name of ["CANVAS_PUBLIC_ENABLED", "NEXT_PUBLIC_CANVAS_ENABLED"]) {
  if (isConfigured(name) && !["true", "false"].includes(environment[name])) {
    fail(name, "must be exactly true or false");
  }
}

for (const name of [
  "CANVAS_VIDEO_MODELS",
  "NEXT_PUBLIC_CANVAS_VIDEO_MODELS",
]) {
  if (isConfigured(name)) {
    const supportedModels = new Set([
      "sora2",
      "sora2-pro",
      "grok",
      "veo",
      "omni",
      "seedance",
      "happyhorse",
    ]);
    const models = environment[name].split(",").map((item) => item.trim());
    if (
      models.some((item) => !item) ||
      new Set(models).size !== models.length ||
      models.some((item) => !supportedModels.has(item))
    ) {
      fail(
        name,
        "must be a unique comma-separated list of supported model IDs"
      );
    } else if (!models.includes("grok")) {
      warn(name, "the current production recommendation includes grok");
    }
  }
}

if (
  isConfigured("CANVAS_VIDEO_MODELS") &&
  isConfigured("NEXT_PUBLIC_CANVAS_VIDEO_MODELS") &&
  environment.CANVAS_VIDEO_MODELS !==
    environment.NEXT_PUBLIC_CANVAS_VIDEO_MODELS
) {
  fail(
    "Canvas video model allowlists",
    "server and build-time client allowlists must match exactly"
  );
}

if (environment.CANVAS_PUBLIC_ENABLED === "false") {
  const accessIds = environment.CANVAS_ACCESS_USER_IDS;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ids =
    typeof accessIds === "string"
      ? accessIds.split(",").map((item) => item.trim())
      : [];
  if (
    ids.length === 0 ||
    ids.some((item) => !uuidPattern.test(item)) ||
    new Set(ids).size !== ids.length
  ) {
    fail(
      "CANVAS_ACCESS_USER_IDS",
      "canary mode requires at least one unique test-user UUID"
    );
  } else {
    pass("CANVAS_ACCESS_USER_IDS canary allowlist");
  }
}

const platformImageKey = firstConfigured([
  "VIDEO_PLATFORM_IMAGE_API_KEY",
  "IMAGE_PLATFORM_API_KEY",
  "VIDEO_PLATFORM_API_KEY",
  "SORA2_API_KEY",
  "WUYINKEJI_API_KEY",
]);
const platformImageBase = firstConfigured([
  "VIDEO_PLATFORM_IMAGE_BASE_URL",
  "IMAGE_PLATFORM_BASE_URL",
  "VIDEO_PLATFORM_BASE_URL",
  "VIDEO_PLATFORM_API_BASE",
  "VIDEO_PLATFORM_API_ENDPOINT",
]);

if (platformImageKey) {
  pass("image generation provider credentials");
} else {
  fail(
    "image generation provider credentials",
    "configure a key read by the Canvas platform-image resolver"
  );
}

if (platformImageBase) {
  pass("image generation provider endpoint");
} else {
  warn(
    "image generation provider endpoint",
    "using the resolver's built-in HTTPS default; configure an explicit production endpoint"
  );
}

for (const name of ["VIDEO_PLATFORM_IMAGE_BASE_URL", "IMAGE_PLATFORM_BASE_URL"]) {
  if (isConfigured(name) && !isHttpsUrl(name)) {
    fail(name, "must be a valid HTTPS URL");
  }
}

const videoProviderKey = firstConfigured([
  "VIDEO_PLATFORM_API_KEY",
  "SORA2_API_KEY",
  "WUYINKEJI_API_KEY",
]);
const videoProviderBase = firstConfigured([
  "VIDEO_PLATFORM_BASE_URL",
  "VIDEO_PLATFORM_API_BASE",
  "VIDEO_PLATFORM_API_ENDPOINT",
]);

if (videoProviderKey) {
  pass("video generation provider credentials");
} else {
  fail(
    "video generation provider credentials",
    "configure a key read by the Canvas platform-video resolver"
  );
}

if (videoProviderBase) {
  pass("video generation provider endpoint");
} else {
  warn(
    "video generation provider endpoint",
    "using the resolver's built-in HTTPS default; configure an explicit production endpoint"
  );
}

for (const name of [
  "VIDEO_PLATFORM_BASE_URL",
  "VIDEO_PLATFORM_API_BASE",
  "VIDEO_PLATFORM_API_ENDPOINT",
]) {
  if (isConfigured(name) && !isHttpsUrl(name)) {
    fail(name, "must be a valid HTTPS URL");
  }
}

if (executionNodeEnv === "production") {
  pass("NODE_ENV is production");
} else {
  warn("NODE_ENV", "the release process must set it to production");
}

if (options.requireBuild) {
  const buildIdPath = resolve(options.root, ".next", "BUILD_ID");
  if (!existsSync(buildIdPath)) {
    fail("Next.js production build", ".next/BUILD_ID is missing");
  } else {
    try {
      if (readFileSync(buildIdPath, "utf8").trim()) {
        pass("Next.js production build");
      } else {
        fail("Next.js production build", ".next/BUILD_ID is empty");
      }
    } catch {
      fail("Next.js production build", ".next/BUILD_ID is unreadable");
    }
  }
}

if (failures.length > 0) {
  console.error(
    `Canvas production preflight failed (${failures.length} failure(s), ${warnings.length} warning(s)).`
  );
  process.exit(1);
}

console.log(
  `Canvas production preflight passed (${warnings.length} warning(s)). No environment values were printed.`
);
