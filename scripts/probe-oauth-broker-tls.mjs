#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readExactReleaseEnvironment } from "./canvas-exact-env.mjs";

const CHILD_FLAG = "--child";
const DEFAULT_TIMEOUT_MS = 10_000;

function fail(message) {
  console.error(`[FAIL] OAuth broker TLS preflight: ${message}`);
  process.exit(1);
}

function assertTrustedBrokerCa(filePath) {
  if (!isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
    throw new Error("CA path is not canonical");
  }
  let current = filePath;
  let leaf = true;
  while (true) {
    const entry = lstatSync(current);
    if (
      entry.isSymbolicLink() ||
      (leaf ? !entry.isFile() : !entry.isDirectory()) ||
      (process.platform !== "win32" &&
        (entry.uid !== 0 || entry.gid !== 0 || (entry.mode & 0o022) !== 0))
    ) {
      throw new Error("CA path is not trusted");
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
    leaf = false;
  }
  new X509Certificate(readFileSync(filePath));
}

function parseArguments(argv) {
  const options = {
    root: process.cwd(),
    envFile: ".env.local",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (
      !["--root", "--env-file", "--timeout-ms"].includes(argument) ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error("invalid arguments");
    }
    if (argument === "--root") options.root = value;
    else if (argument === "--env-file") options.envFile = value;
    else options.timeoutMs = Number.parseInt(value, 10);
    index += 1;
  }
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1_000 ||
    options.timeoutMs > 30_000
  ) {
    throw new Error("timeout must be between 1000 and 30000 milliseconds");
  }
  return options;
}

async function runChild(urlValue, timeoutValue) {
  const timeoutMs = Number.parseInt(timeoutValue, 10);
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    fail("broker URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !Number.isInteger(timeoutMs)
  ) {
    fail("broker URL or timeout is invalid");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    console.log(
      `[OK] OAuth broker TLS handshake succeeded (HTTP ${response.status}).`
    );
  } catch (error) {
    const code =
      error?.cause?.code ||
      (error?.name === "AbortError" ? "TIMEOUT" : "REQUEST_FAILED");
    fail(`handshake failed (${code})`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (process.argv[2] === CHILD_FLAG) {
    await runChild(process.argv[3], process.argv[4]);
    return;
  }

  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch {
    fail("invalid command-line arguments");
  }

  let environment;
  try {
    environment = readExactReleaseEnvironment(
      options.root,
      options.envFile
    ).values;
  } catch {
    fail("exact release environment could not be read");
  }

  const brokerUrl = environment.OAUTH_BROKER_URL?.trim();
  if (!brokerUrl) {
    console.log("[OK] OAuth broker TLS preflight skipped (broker disabled).");
    return;
  }
  const brokerCa = environment.NODE_EXTRA_CA_CERTS?.trim();
  if (!brokerCa) {
    fail("NODE_EXTRA_CA_CERTS is missing");
  }
  try {
    assertTrustedBrokerCa(brokerCa);
  } catch {
    fail("NODE_EXTRA_CA_CERTS is not a trusted root-owned PEM certificate");
  }

  const childEnvironment = Object.create(null);
  for (const name of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TZ",
    "SystemRoot",
    "SYSTEMROOT",
  ]) {
    if (typeof process.env[name] === "string") {
      childEnvironment[name] = process.env[name];
    }
  }
  childEnvironment.NODE_EXTRA_CA_CERTS = brokerCa;

  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      CHILD_FLAG,
      brokerUrl,
      String(options.timeoutMs),
    ],
    {
      encoding: "utf8",
      env: childEnvironment,
      timeout: options.timeoutMs + 5_000,
      windowsHide: true,
    }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    fail(
      result.error?.code === "ETIMEDOUT"
        ? "child probe timed out"
        : "child probe failed"
    );
  }
}

main().catch(() => fail("unexpected probe failure"));
