#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import process from "node:process";

import { readExactReleaseEnvironment } from "./canvas-exact-env.mjs";
let environment = Object.create(null);

function parseArgs(argv) {
  let envFile = ".env.local";
  let timeoutMs = 15_000;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--env-file") {
      const value = argv[index + 1];
      if (!value) throw new Error("--env-file requires a path");
      envFile = value;
      index += 1;
      continue;
    }
    if (argument === "--timeout-ms") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
        throw new Error("--timeout-ms must be an integer between 1000 and 60000");
      }
      timeoutMs = value;
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }
  return { envFile: resolve(envFile), timeoutMs };
}

function firstConfigured(names) {
  return names
    .map((name) => environment[name]?.trim())
    .find((value) => Boolean(value));
}

function platformUrl(baseUrl, pathname) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1")
    ? `${normalized}${pathname}`
    : `${normalized}/v1${pathname}`;
}

function modelIds(payload) {
  if (!payload || typeof payload !== "object") return [];
  const rows = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return "";
      const value = row.id ?? row.name;
      return typeof value === "string" ? value.trim() : "";
    })
    .filter(Boolean);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  environment = readExactReleaseEnvironment(
    dirname(options.envFile),
    options.envFile
  ).values;

  const baseUrl =
    firstConfigured([
      "VIDEO_PLATFORM_IMAGE_BASE_URL",
      "IMAGE_PLATFORM_BASE_URL",
      "VIDEO_PLATFORM_BASE_URL",
      "VIDEO_PLATFORM_API_BASE",
      "VIDEO_PLATFORM_API_ENDPOINT",
    ]) ?? "https://api.hellobabygo.com";
  const apiKey = firstConfigured([
    "VIDEO_PLATFORM_IMAGE_API_KEY",
    "IMAGE_PLATFORM_API_KEY",
    "VIDEO_PLATFORM_API_KEY",
    "SORA2_API_KEY",
    "WUYINKEJI_API_KEY",
  ]);
  if (!apiKey) throw new Error("Canvas image provider key is not configured");

  const url = platformUrl(baseUrl, "/models");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // The probe reports shape only and never echoes an upstream body.
  }
  const ids = modelIds(payload);
  const result = {
    host: new URL(url).hostname,
    status: response.status,
    json: payload !== null,
    modelCount: ids.length,
    hasGptImage2: ids.includes("gpt-image-2"),
  };
  console.log(JSON.stringify(result));
  if (!response.ok || !result.json || !result.hasGptImage2) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "unavailable",
      error:
        error instanceof Error && error.name === "AbortError"
          ? "timeout"
          : "probe_failed",
    })
  );
  process.exitCode = 1;
});
