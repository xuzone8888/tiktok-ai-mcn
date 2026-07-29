#!/usr/bin/env node

import {
  chmodSync,
  chownSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const SCHEMA_VERSION = "canvas-rollback-bundle-v1";
const MAX_METADATA_BYTES = 128 * 1024;
const WORKER_FILE_DEFINITIONS = {
  script: {
    installedName: "canvas-reconciler-worker.mjs",
    bundleName: "worker/canvas-reconciler-worker.mjs",
  },
  config: {
    installedName: "ecosystem.canvas-reconciler.cjs",
    bundleName: "worker/ecosystem.canvas-reconciler.cjs",
  },
  settings: {
    installedName: "canvas-reconciler.settings.json",
    bundleName: "worker/canvas-reconciler.settings.json",
  },
};

function usage() {
  return [
    "Usage:",
    "  node scripts/canvas-rollback-bundle.mjs create [options]",
    "  node scripts/canvas-rollback-bundle.mjs verify [options]",
    "  node scripts/canvas-rollback-bundle.mjs inspect [options]",
    "  node scripts/canvas-rollback-bundle.mjs restore-nginx [options]",
    "  node scripts/canvas-rollback-bundle.mjs restore-worker [options]",
    "",
    "Common options:",
    "  --bundle-dir <absolute>            Bundle directory.",
    "  --rollback-dir <absolute>          Root-only bundle parent.",
    "  --expected-nginx-config <absolute> Expected active Nginx file.",
    "  --expected-worker-name <name>      Stable worker PM2 name.",
    "  --expected-worker-install-dir <absolute>",
    "",
    "Create-only options:",
    "  --nginx-config <absolute>",
    "  --web-name <pm2-name>",
    "  --web-port <port>",
    "  --web-root <absolute>",
    "  --web-env-file <absolute>",
    "  --web-health-contract <exact|legacy-bootstrap>",
    "  --worker-name <pm2-name>",
    "  --worker-install-dir <absolute>",
    "  --worker-process-present <true|false>",
    "",
    "The bundle contains no bearer value. All files are root-only and hashed.",
  ].join("\n");
}

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const command = argv[0];
  if (
    ![
      "create",
      "verify",
      "inspect",
      "restore-nginx",
      "restore-worker",
    ].includes(command)
  ) {
    fail("a valid command is required");
  }
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--allow-non-root-test") {
      options.allowNonRootTest = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    const key = {
      "--bundle-dir": "bundleDir",
      "--rollback-dir": "rollbackDir",
      "--expected-nginx-config": "expectedNginxConfig",
      "--expected-worker-name": "expectedWorkerName",
      "--expected-worker-install-dir": "expectedWorkerInstallDir",
      "--nginx-config": "nginxConfig",
      "--web-name": "webName",
      "--web-port": "webPort",
      "--web-root": "webRoot",
      "--web-env-file": "webEnvFile",
      "--web-health-contract": "webHealthContract",
      "--worker-name": "workerName",
      "--worker-install-dir": "workerInstallDir",
      "--worker-process-present": "workerProcessPresent",
    }[argument];
    if (!key) fail(`unknown argument: ${argument}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
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

function asObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be an object`);
  }
  return value;
}

function assertSafeText(value, label, maximum = 4096) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function assertName(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function assertAbsolutePath(value, label) {
  assertSafeText(value, label);
  if (!isAbsolute(value) || resolve(value) === resolve(value, "..")) {
    fail(`${label} must be an absolute non-root path`);
  }
  return resolve(value);
}

function parsePort(value, label) {
  if (!/^[0-9]+$/u.test(String(value ?? ""))) fail(`${label} is invalid`);
  const port = Number.parseInt(value, 10);
  if (port < 1024 || port > 65535) fail(`${label} is invalid`);
  return port;
}

function parseBoolean(value, label) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  fail(`${label} must be true or false`);
}

function assertRegularFile(path, label, maximumBytes = undefined) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    fail(`${label} must be a non-symlink regular file`);
  }
  if (maximumBytes !== undefined && entry.size > maximumBytes) {
    fail(`${label} is too large`);
  }
  return entry;
}

function assertDirectory(path, label) {
  const entry = lstatSync(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    fail(`${label} must be a non-symlink directory`);
  }
  return entry;
}

function allowNonRootTest(options, targetPath) {
  if (!options.allowNonRootTest || process.env.NODE_ENV !== "test") return false;
  const temporaryRoot = realpathSync(tmpdir());
  const target = resolve(targetPath);
  const relation = relative(temporaryRoot, target);
  return relation !== ".." && !relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function requireRoot(options, targetPath) {
  if (typeof process.getuid !== "function" || process.getuid() === 0) return;
  if (allowNonRootTest(options, targetPath)) return;
  fail("rollback bundles may only be managed by root");
}

function isRootEnforced(options, targetPath) {
  return (
    typeof process.getuid === "function" &&
    process.getuid() === 0 &&
    !allowNonRootTest(options, targetPath)
  );
}

function assertDirectBundlePath(rollbackDirInput, bundleDirInput) {
  const rollbackDir = assertAbsolutePath(rollbackDirInput, "rollback directory");
  assertDirectory(rollbackDir, "rollback directory");
  const canonicalRollbackDir = realpathSync(rollbackDir);
  const bundleDir = assertAbsolutePath(bundleDirInput, "bundle directory");
  if (dirname(bundleDir) !== canonicalRollbackDir) {
    fail("bundle directory must be a direct child of the rollback directory");
  }
  return { rollbackDir: canonicalRollbackDir, bundleDir };
}

function assertRollbackDirectorySecurity(options, rollbackDir, targetPath) {
  if (allowNonRootTest(options, targetPath)) return;
  const entry = assertDirectory(rollbackDir, "rollback directory");
  if ((entry.mode & 0o077) !== 0) {
    fail("rollback directory is not root-only");
  }
  if (
    typeof process.getuid === "function" &&
    process.getuid() === 0 &&
    entry.uid !== 0
  ) {
    fail("rollback directory is not owned by root");
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseNginxProxyPort(path) {
  const source = readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.replace(/#.*/u, ""))
    .join("\n");
  const matches = [
    ...source.matchAll(
      /proxy_pass\s+http:\/\/127\.0\.0\.1:([0-9]+);/gu
    ),
  ];
  if (matches.length !== 1) {
    fail("Nginx config must contain exactly one loopback proxy target");
  }
  return parsePort(matches[0][1], "Nginx proxy port");
}

function readJson(path, label) {
  assertRegularFile(path, label, MAX_METADATA_BYTES);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function captureMetadata(entry) {
  return {
    mode: entry.mode & 0o777,
    uid: entry.uid,
    gid: entry.gid,
  };
}

function validateMetadata(value, label) {
  const metadata = asObject(value, label);
  assertExactKeys(metadata, ["mode", "uid", "gid"], label);
  if (
    !Number.isInteger(metadata.mode) ||
    metadata.mode < 0 ||
    metadata.mode > 0o777 ||
    !Number.isInteger(metadata.uid) ||
    metadata.uid < 0 ||
    !Number.isInteger(metadata.gid) ||
    metadata.gid < 0
  ) {
    fail(`${label} is invalid`);
  }
  return metadata;
}

function validateWorkerSettings(value, expected) {
  const settings = asObject(value, "worker settings");
  assertExactKeys(
    settings,
    ["name", "script", "envFile", "url", "lockFile"],
    "worker settings"
  );
  if (settings.name !== expected.name) fail("worker settings name mismatch");
  if (settings.script !== join(expected.installDir, WORKER_FILE_DEFINITIONS.script.installedName)) {
    fail("worker settings script mismatch");
  }
  assertAbsolutePath(settings.envFile, "worker settings env file");
  assertAbsolutePath(settings.lockFile, "worker settings lock file");

  let target;
  try {
    target = new URL(settings.url);
  } catch {
    fail("worker settings URL is invalid");
  }
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.pathname !== "/api/internal/canvas/reconcile" ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    Number.parseInt(target.port, 10) !== expected.webPort
  ) {
    fail("worker settings URL does not target the bundled web release");
  }
  return settings;
}

function readReleaseIdentity(rootInput, envInput) {
  const root = assertAbsolutePath(rootInput, "web root");
  assertDirectory(root, "web root");
  const canonicalRoot = realpathSync(root);
  const envFile = assertAbsolutePath(envInput, "web env file");
  if (envFile !== join(canonicalRoot, ".env.local")) {
    fail("web env file must equal the release's exact .env.local");
  }
  const envEntry = assertRegularFile(
    envFile,
    "web env file",
    1024 * 1024
  );
  if (
    typeof process.getuid === "function" &&
    process.getuid() === 0 &&
    (envEntry.uid !== 0 || (envEntry.mode & 0o077) !== 0)
  ) {
    fail("web env file must be root-owned and root-only");
  }
  const buildIdPath = join(canonicalRoot, ".next", "BUILD_ID");
  assertRegularFile(buildIdPath, "web BUILD_ID", 4096);
  const packagePath = join(canonicalRoot, "package.json");
  assertRegularFile(packagePath, "web package.json", MAX_METADATA_BYTES);
  const buildId = readFileSync(buildIdPath, "utf8").trim();
  if (!/^[A-Za-z0-9._-]{1,200}$/u.test(buildId)) {
    fail("web BUILD_ID is invalid");
  }
  const packageDocument = asObject(
    readJson(packagePath, "web package.json"),
    "web package.json"
  );
  const version = assertSafeText(packageDocument.version, "web version", 100);
  return { root: canonicalRoot, envFile, buildId, version };
}

function createBundle(options) {
  for (const required of [
    "bundleDir",
    "rollbackDir",
    "nginxConfig",
    "webName",
    "webPort",
    "webRoot",
    "webEnvFile",
    "webHealthContract",
    "workerName",
    "workerInstallDir",
    "workerProcessPresent",
  ]) {
    if (options[required] === undefined) fail(`--${required} is required`);
  }
  const { rollbackDir, bundleDir } = assertDirectBundlePath(
    options.rollbackDir,
    options.bundleDir
  );
  requireRoot(options, bundleDir);
  assertRollbackDirectorySecurity(options, rollbackDir, bundleDir);
  if (existsSync(bundleDir)) fail("bundle directory already exists");

  const nginxConfig = assertAbsolutePath(options.nginxConfig, "Nginx config");
  const nginxEntry = assertRegularFile(
    nginxConfig,
    "Nginx config",
    1024 * 1024
  );
  const webPort = parsePort(options.webPort, "web port");
  if (parseNginxProxyPort(nginxConfig) !== webPort) {
    fail("Nginx config does not target the bundled web release");
  }
  const webName = assertName(options.webName, "web PM2 name");
  const web = readReleaseIdentity(options.webRoot, options.webEnvFile);
  const webHealthContract = options.webHealthContract;
  if (!["exact", "legacy-bootstrap"].includes(webHealthContract)) {
    fail("web health contract must be exact or legacy-bootstrap");
  }
  const workerName = assertName(options.workerName, "worker PM2 name");
  const workerInstallDir = assertAbsolutePath(
    options.workerInstallDir,
    "worker install directory"
  );
  const processPresent = parseBoolean(
    options.workerProcessPresent,
    "worker process presence"
  );

  const workerFiles = {};
  let settings = null;
  for (const [kind, definition] of Object.entries(WORKER_FILE_DEFINITIONS)) {
    const source = join(workerInstallDir, definition.installedName);
    if (!existsSync(source)) {
      workerFiles[kind] = { present: false, metadata: null };
      continue;
    }
    const entry = assertRegularFile(source, `installed worker ${kind}`);
    workerFiles[kind] = {
      present: true,
      metadata: captureMetadata(entry),
      source,
    };
    if (kind === "settings") {
      settings = validateWorkerSettings(
        readJson(source, "installed worker settings"),
        { name: workerName, installDir: workerInstallDir, webPort }
      );
    }
  }
  if (
    processPresent &&
    Object.values(workerFiles).some((entry) => !entry.present)
  ) {
    fail("an online worker requires script, config, and settings files");
  }
  if (webHealthContract === "legacy-bootstrap" && processPresent) {
    fail("a legacy-bootstrap rollback target cannot have a worker");
  }

  mkdirSync(bundleDir, { mode: 0o700 });
  mkdirSync(join(bundleDir, "worker"), { mode: 0o700 });
  copyFileSync(nginxConfig, join(bundleDir, "nginx.conf"));
  chmodSync(join(bundleDir, "nginx.conf"), 0o600);
  for (const [kind, entry] of Object.entries(workerFiles)) {
    if (!entry.present) continue;
    const destination = join(
      bundleDir,
      WORKER_FILE_DEFINITIONS[kind].bundleName
    );
    copyFileSync(entry.source, destination);
    chmodSync(destination, 0o600);
    delete entry.source;
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    nginx: {
      configPath: nginxConfig,
      metadata: captureMetadata(nginxEntry),
      bundleFile: "nginx.conf",
    },
    web: {
      name: webName,
      port: webPort,
      root: web.root,
      envFile: web.envFile,
      buildId: web.buildId,
      version: web.version,
      healthContract: webHealthContract,
    },
    worker: {
      processPresent,
      name: workerName,
      installDir: workerInstallDir,
      url: settings?.url ?? null,
      files: Object.fromEntries(
        Object.entries(workerFiles).map(([kind, entry]) => [
          kind,
          {
            present: entry.present,
            metadata: entry.metadata,
            bundleFile: entry.present
              ? WORKER_FILE_DEFINITIONS[kind].bundleName
              : null,
          },
        ])
      ),
    },
  };
  const manifestPath = join(bundleDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });

  const hashedFiles = ["manifest.json", "nginx.conf"];
  for (const entry of Object.values(manifest.worker.files)) {
    if (entry.present) hashedFiles.push(entry.bundleFile);
  }
  hashedFiles.sort();
  const checksums = {
    algorithm: "sha256",
    files: Object.fromEntries(
      hashedFiles.map((file) => [file, sha256(join(bundleDir, file))])
    ),
  };
  writeFileSync(
    join(bundleDir, "checksums.json"),
    `${JSON.stringify(checksums, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  );
  chmodSync(join(bundleDir, "worker"), 0o700);
  chmodSync(bundleDir, 0o700);
  console.log("[OK] Root-only Canvas rollback bundle created and hashed.");
}

function validateManifest(value, options) {
  const manifest = asObject(value, "manifest");
  assertExactKeys(
    manifest,
    ["schemaVersion", "createdAt", "nginx", "web", "worker"],
    "manifest"
  );
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    fail("unsupported rollback bundle schema");
  }
  if (
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  ) {
    fail("manifest timestamp is invalid");
  }

  const nginx = asObject(manifest.nginx, "manifest Nginx state");
  assertExactKeys(
    nginx,
    ["configPath", "metadata", "bundleFile"],
    "manifest Nginx state"
  );
  nginx.configPath = assertAbsolutePath(nginx.configPath, "manifest Nginx path");
  nginx.metadata = validateMetadata(nginx.metadata, "manifest Nginx metadata");
  if (nginx.bundleFile !== "nginx.conf") fail("manifest Nginx file is invalid");
  if (
    options.expectedNginxConfig &&
    nginx.configPath !== resolve(options.expectedNginxConfig)
  ) {
    fail("rollback bundle belongs to a different Nginx config");
  }

  const web = asObject(manifest.web, "manifest web state");
  assertExactKeys(
    web,
    [
      "name",
      "port",
      "root",
      "envFile",
      "buildId",
      "version",
      "healthContract",
    ],
    "manifest web state"
  );
  web.name = assertName(web.name, "manifest web PM2 name");
  web.port = parsePort(web.port, "manifest web port");
  web.root = assertAbsolutePath(web.root, "manifest web root");
  web.envFile = assertAbsolutePath(web.envFile, "manifest web env file");
  if (web.envFile !== join(web.root, ".env.local")) {
    fail("manifest web env file is not the exact release .env.local");
  }
  if (!/^[A-Za-z0-9._-]{1,200}$/u.test(web.buildId)) {
    fail("manifest web BUILD_ID is invalid");
  }
  assertSafeText(web.version, "manifest web version", 100);
  if (!["exact", "legacy-bootstrap"].includes(web.healthContract)) {
    fail("manifest web health contract is invalid");
  }

  const worker = asObject(manifest.worker, "manifest worker state");
  assertExactKeys(
    worker,
    ["processPresent", "name", "installDir", "url", "files"],
    "manifest worker state"
  );
  worker.processPresent = parseBoolean(
    worker.processPresent,
    "manifest worker process presence"
  );
  worker.name = assertName(worker.name, "manifest worker PM2 name");
  worker.installDir = assertAbsolutePath(
    worker.installDir,
    "manifest worker install directory"
  );
  if (
    options.expectedWorkerName &&
    worker.name !== options.expectedWorkerName
  ) {
    fail("rollback bundle belongs to a different worker name");
  }
  if (
    options.expectedWorkerInstallDir &&
    worker.installDir !== resolve(options.expectedWorkerInstallDir)
  ) {
    fail("rollback bundle belongs to a different worker install directory");
  }

  const files = asObject(worker.files, "manifest worker files");
  assertExactKeys(
    files,
    Object.keys(WORKER_FILE_DEFINITIONS),
    "manifest worker files"
  );
  for (const [kind, definition] of Object.entries(WORKER_FILE_DEFINITIONS)) {
    const file = asObject(files[kind], `manifest worker ${kind}`);
    assertExactKeys(
      file,
      ["present", "metadata", "bundleFile"],
      `manifest worker ${kind}`
    );
    file.present = parseBoolean(
      file.present,
      `manifest worker ${kind} presence`
    );
    if (file.present) {
      file.metadata = validateMetadata(
        file.metadata,
        `manifest worker ${kind} metadata`
      );
      if (file.bundleFile !== definition.bundleName) {
        fail(`manifest worker ${kind} bundle path is invalid`);
      }
    } else if (file.metadata !== null || file.bundleFile !== null) {
      fail(`manifest absent worker ${kind} contains file metadata`);
    }
  }
  if (
    worker.processPresent &&
    Object.values(files).some((entry) => !entry.present)
  ) {
    fail("manifest online worker is missing required files");
  }
  if (web.healthContract === "legacy-bootstrap" && worker.processPresent) {
    fail("manifest legacy-bootstrap target unexpectedly has a worker");
  }
  if (files.settings.present) {
    if (typeof worker.url !== "string") fail("manifest worker URL is missing");
  } else if (worker.url !== null) {
    fail("manifest worker URL exists without settings");
  }
  return manifest;
}

function verifyBundle(options, { quiet = false } = {}) {
  for (const required of [
    "bundleDir",
    "rollbackDir",
    "expectedNginxConfig",
    "expectedWorkerName",
    "expectedWorkerInstallDir",
  ]) {
    if (!options[required]) fail(`--${required} is required`);
  }
  const { rollbackDir, bundleDir } = assertDirectBundlePath(
    options.rollbackDir,
    options.bundleDir
  );
  requireRoot(options, bundleDir);
  assertRollbackDirectorySecurity(options, rollbackDir, bundleDir);
  const bundleEntry = assertDirectory(bundleDir, "bundle directory");
  const canonicalBundleDir = realpathSync(bundleDir);
  if (canonicalBundleDir !== bundleDir) {
    fail("bundle directory path is not canonical");
  }

  const rootEnforced = isRootEnforced(options, bundleDir);
  const permissionsEnforced = !allowNonRootTest(options, bundleDir);
  if (permissionsEnforced && (bundleEntry.mode & 0o077) !== 0) {
    fail("bundle directory is not root-only");
  }
  if (rootEnforced && bundleEntry.uid !== 0) {
    fail("bundle directory is not owned by root");
  }
  const workerDirectoryEntry = assertDirectory(
    join(bundleDir, "worker"),
    "bundle worker directory"
  );
  if (
    permissionsEnforced &&
    (workerDirectoryEntry.mode & 0o077) !== 0
  ) {
    fail("bundle worker directory is not root-only");
  }
  if (rootEnforced && workerDirectoryEntry.uid !== 0) {
    fail("bundle worker directory is not owned by root");
  }
  const topLevelEntries = readdirSync(bundleDir).sort();
  assertExactKeys(
    Object.fromEntries(topLevelEntries.map((entry) => [entry, true])),
    ["checksums.json", "manifest.json", "nginx.conf", "worker"],
    "bundle directory entries"
  );

  const manifest = validateManifest(
    readJson(join(bundleDir, "manifest.json"), "manifest"),
    options
  );
  const checksums = asObject(
    readJson(join(bundleDir, "checksums.json"), "checksums"),
    "checksums"
  );
  assertExactKeys(checksums, ["algorithm", "files"], "checksums");
  if (checksums.algorithm !== "sha256") fail("checksum algorithm is invalid");
  const checksumFiles = asObject(checksums.files, "checksum files");
  const expectedFiles = ["manifest.json", "nginx.conf"];
  for (const file of Object.values(manifest.worker.files)) {
    if (file.present) expectedFiles.push(file.bundleFile);
  }
  expectedFiles.sort();
  assertExactKeys(checksumFiles, expectedFiles, "checksum files");
  const expectedWorkerEntries = expectedFiles
    .filter((file) => file.startsWith("worker/"))
    .map((file) => file.slice("worker/".length))
    .sort();
  assertExactKeys(
    Object.fromEntries(
      readdirSync(join(bundleDir, "worker"))
        .sort()
        .map((entry) => [entry, true])
    ),
    expectedWorkerEntries,
    "bundle worker directory entries"
  );

  for (const file of [...expectedFiles, "checksums.json"]) {
    const path = join(bundleDir, file);
    const entry = assertRegularFile(path, `bundle file ${file}`);
    if (permissionsEnforced && (entry.mode & 0o077) !== 0) {
      fail(`bundle file ${file} is not root-only`);
    }
    if (rootEnforced && entry.uid !== 0) {
      fail(`bundle file ${file} is not owned by root`);
    }
    if (
      file !== "checksums.json" &&
      (!/^[a-f0-9]{64}$/u.test(checksumFiles[file]) ||
        sha256(path) !== checksumFiles[file])
    ) {
      fail(`checksum mismatch for ${file}`);
    }
  }
  if (
    parseNginxProxyPort(join(bundleDir, manifest.nginx.bundleFile)) !==
    manifest.web.port
  ) {
    fail("bundled Nginx target does not match the manifest");
  }

  const liveWeb = readReleaseIdentity(manifest.web.root, manifest.web.envFile);
  if (
    liveWeb.buildId !== manifest.web.buildId ||
    liveWeb.version !== manifest.web.version
  ) {
    fail("rollback target release identity changed after bundle creation");
  }
  if (manifest.worker.files.settings.present) {
    const settings = validateWorkerSettings(
      readJson(
        join(bundleDir, WORKER_FILE_DEFINITIONS.settings.bundleName),
        "bundled worker settings"
      ),
      {
        name: manifest.worker.name,
        installDir: manifest.worker.installDir,
        webPort: manifest.web.port,
      }
    );
    if (settings.url !== manifest.worker.url) {
      fail("bundled worker URL does not match the manifest");
    }
    if (manifest.worker.processPresent) {
      assertRegularFile(settings.envFile, "bundled worker env reference", 1024 * 1024);
    }
  }
  if (!quiet) {
    console.log("[OK] Canvas rollback bundle ownership and hashes verified.");
  }
  return { manifest, bundleDir };
}

function temporarySibling(path) {
  return join(
    dirname(path),
    `.${process.pid}.${randomBytes(8).toString("hex")}.restore`
  );
}

function restoreFile(source, destination, metadata, rootEnforced) {
  const temporary = temporarySibling(destination);
  copyFileSync(source, temporary);
  chmodSync(temporary, metadata.mode);
  if (rootEnforced) chownSync(temporary, metadata.uid, metadata.gid);
  renameSync(temporary, destination);
}

function restoreNginx(options) {
  const { manifest, bundleDir } = verifyBundle(options, { quiet: true });
  const parent = dirname(manifest.nginx.configPath);
  assertDirectory(parent, "Nginx config parent");
  restoreFile(
    join(bundleDir, manifest.nginx.bundleFile),
    manifest.nginx.configPath,
    manifest.nginx.metadata,
    isRootEnforced(options, bundleDir)
  );
  console.log("[OK] Bundled Nginx file restored atomically.");
}

function restoreWorker(options) {
  const { manifest, bundleDir } = verifyBundle(options, { quiet: true });
  const worker = manifest.worker;
  const anyFilePresent = Object.values(worker.files).some(
    (entry) => entry.present
  );
  if (anyFilePresent && !existsSync(worker.installDir)) {
    mkdirSync(worker.installDir, { mode: 0o755 });
  }
  if (existsSync(worker.installDir)) {
    assertDirectory(worker.installDir, "worker install directory");
  }
  const rootEnforced = isRootEnforced(options, bundleDir);
  for (const [kind, definition] of Object.entries(WORKER_FILE_DEFINITIONS)) {
    const destination = join(worker.installDir, definition.installedName);
    const file = worker.files[kind];
    if (file.present) {
      restoreFile(
        join(bundleDir, file.bundleFile),
        destination,
        file.metadata,
        rootEnforced
      );
    } else if (existsSync(destination)) {
      const entry = lstatSync(destination);
      if (entry.isDirectory()) {
        fail(`worker ${kind} target unexpectedly became a directory`);
      }
      unlinkSync(destination);
    }
  }
  console.log(worker.processPresent ? "present" : "absent");
}

function inspectBundle(options) {
  const { manifest } = verifyBundle(options, { quiet: true });
  console.log(manifest.web.name);
  console.log(String(manifest.web.port));
  console.log(manifest.web.root);
  console.log(manifest.web.envFile);
  console.log(manifest.web.buildId);
  console.log(manifest.web.healthContract);
  console.log(manifest.worker.processPresent ? "true" : "false");
}

async function main() {
  try {
    const { command, options } = parseArguments(process.argv.slice(2));
    if (command === "create") createBundle(options);
    else if (command === "verify") verifyBundle(options);
    else if (command === "inspect") inspectBundle(options);
    else if (command === "restore-nginx") restoreNginx(options);
    else if (command === "restore-worker") restoreWorker(options);
  } catch (error) {
    console.error(
      `[FAIL] ${
        error instanceof Error ? error.message : "rollback bundle operation failed"
      }`
    );
    process.exitCode = 1;
  }
}

await main();
