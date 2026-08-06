#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";

import { createClient } from "@supabase/supabase-js";
import OSS from "ali-oss";

const MAX_ENV_FILE_BYTES = 1024 * 1024;
const DEFAULT_LIMIT = 100;
const DEFAULT_ORPHAN_GRACE_SECONDS = 7 * 24 * 60 * 60;
const PURGE_LEASE_SECONDS = 300;
const PURGE_CONCURRENCY = 3;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UPLOAD_KEY_RE =
  /^(images|videos)\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|avi)$/;

function usage() {
  return [
    "Usage: node scripts/sweep-canvas-upload-reservations.mjs --env-file <path> [options]",
    "",
    "Required:",
    "  --env-file <path>               Non-symlink production env file",
    "",
    "Optional:",
    "  --limit <n>                     Rows per lifecycle step, 1..1000",
    "  --orphan-grace-seconds <n>      Initial no-reference grace, 86400..7776000",
    "  --dry-run                       Validate configuration without DB/OSS calls",
    "  --help                          Show this help",
    "",
    "The worker runs one cron-safe cycle. It never logs object keys or secrets.",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    envFile: undefined,
    limit: DEFAULT_LIMIT,
    orphanGraceSeconds: DEFAULT_ORPHAN_GRACE_SECONDS,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }
    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (
      value !== "--env-file" &&
      value !== "--limit" &&
      value !== "--orphan-grace-seconds"
    ) {
      throw new Error("unknown_argument");
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error("missing_argument_value");
    if (value === "--env-file") options.envFile = next;
    if (value === "--limit") options.limit = parseInteger(next, 1, 1000, "invalid_limit");
    if (value === "--orphan-grace-seconds") {
      options.orphanGraceSeconds = parseInteger(
        next,
        86_400,
        7_776_000,
        "invalid_orphan_grace"
      );
    }
    index += 1;
  }
  return options;
}

function parseInteger(raw, minimum, maximum, code) {
  if (!/^[0-9]+$/.test(raw)) throw new Error(code);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(code);
  }
  return value;
}

function readSecureEnvFile(filePath) {
  if (!filePath) throw new Error("env_file_required");
  const absolutePath = resolve(filePath);
  const entry = lstatSync(absolutePath);
  if (entry.isSymbolicLink()) throw new Error("env_file_symlink_rejected");
  if (!entry.isFile()) throw new Error("env_file_not_regular");
  if (entry.size > MAX_ENV_FILE_BYTES) throw new Error("env_file_too_large");
  if (process.platform !== "win32" && (entry.mode & 0o077) !== 0) {
    throw new Error("env_file_permissions_too_open");
  }

  const descriptor = openSync(
    absolutePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  );
  let raw;
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== entry.dev ||
      opened.ino !== entry.ino
    ) {
      throw new Error("env_file_changed_during_open");
    }
    raw = readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
  return parseEnv(raw);
}

function required(config, name, minimumLength = 1) {
  const value = config[name];
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < minimumLength ||
    /[\r\n]/.test(value)
  ) {
    throw new Error(`invalid_${name.toLowerCase()}`);
  }
  return value;
}

function loadConfiguration(values) {
  const supabaseUrl = new URL(required(values, "NEXT_PUBLIC_SUPABASE_URL"));
  if (supabaseUrl.protocol !== "https:") throw new Error("supabase_https_required");
  const serviceRoleKey = required(values, "SUPABASE_SERVICE_ROLE_KEY", 32);
  const endpoint = new URL(
    values.ALIYUN_OSS_ENDPOINT ||
      `https://${required(values, "ALIYUN_OSS_REGION")}.aliyuncs.com`
  );
  if (endpoint.protocol !== "https:") throw new Error("oss_https_required");
  const bucket = required(values, "ALIYUN_OSS_BUCKET");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("invalid_oss_bucket");
  }
  return {
    supabaseUrl: supabaseUrl.toString().replace(/\/$/, ""),
    serviceRoleKey,
    oss: {
      region: required(values, "ALIYUN_OSS_REGION"),
      accessKeyId: required(values, "ALIYUN_OSS_ACCESS_KEY_ID", 8),
      accessKeySecret: required(values, "ALIYUN_OSS_ACCESS_KEY_SECRET", 16),
      bucket,
      endpoint: endpoint.toString().replace(/\/$/, ""),
      secure: true,
      timeout: 30_000,
    },
  };
}

function rows(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name}_invalid_result`);
  return value;
}

function validClaim(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const match =
    typeof value.object_key === "string"
      ? UPLOAD_KEY_RE.exec(value.object_key)
      : null;
  return (
    typeof value.reservation_id === "string" &&
    UUID_RE.test(value.reservation_id) &&
    typeof value.user_id === "string" &&
    UUID_RE.test(value.user_id) &&
    typeof value.lease_token === "string" &&
    UUID_RE.test(value.lease_token) &&
    typeof value.expected_size === "number" &&
    Number.isSafeInteger(value.expected_size) &&
    value.expected_size > 0 &&
    !!match &&
    match[2] === value.user_id &&
    match[3] === value.reservation_id
  );
}

function isDefinitelyAbsent(error) {
  return (
    error?.status === 404 ||
    error?.code === "NoSuchKey" ||
    error?.code === "NoSuchKeyError"
  );
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const results = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    })
  );
  return results;
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const wrapped = new Error(`${name}_failed`);
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
}

async function runCycle(config, options) {
  const database = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const oss = new OSS(config.oss);

  const expired = rows(
    await rpc(database, "sweep_expired_canvas_uploads_v1", {
      p_limit: options.limit,
    }),
    "sweep"
  );
  const orphaned = rows(
    await rpc(database, "mark_canvas_upload_orphans_v1", {
      p_limit: options.limit,
      p_unreferenced_grace_seconds: options.orphanGraceSeconds,
    }),
    "orphan"
  );
  const claims = rows(
    await rpc(database, "claim_canvas_upload_purge_v1", {
      p_limit: options.limit,
      p_lease_seconds: PURGE_LEASE_SECONDS,
    }),
    "claim"
  );

  const outcomes = await runPool(claims, PURGE_CONCURRENCY, async (claim) => {
    if (!validClaim(claim)) return false;
    try {
      await oss.delete(claim.object_key, { timeout: 30_000 });
    } catch (error) {
      if (!isDefinitelyAbsent(error)) return false;
    }
    try {
      const completed = await rpc(
        database,
        "complete_canvas_upload_purge_v1",
        {
          p_reservation_id: claim.reservation_id,
          p_lease_token: claim.lease_token,
        }
      );
      return completed === true;
    } catch {
      return false;
    }
  });
  const completed = outcomes.filter(Boolean).length;
  return {
    expired: expired.length,
    orphaned: orphaned.length,
    claimed: claims.length,
    completed,
    failed: claims.length - completed,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const configuration = loadConfiguration(readSecureEnvFile(options.envFile));
  if (options.dryRun) {
    process.stdout.write("Canvas upload sweeper configuration is valid.\n");
    return;
  }
  const result = await runCycle(configuration, options);
  process.stdout.write(
    `Canvas upload sweep: expired=${result.expired} orphaned=${result.orphaned} claimed=${result.claimed} completed=${result.completed} failed=${result.failed}\n`
  );
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(
    `Canvas upload sweep failed: ${
      error instanceof Error ? error.message : "unknown_error"
    }\n`
  );
  process.exitCode = 1;
});
