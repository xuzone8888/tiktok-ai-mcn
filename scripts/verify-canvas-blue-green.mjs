#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

import {
  exactProcessEnvironment,
  readExactReleaseEnvironment,
} from "./canvas-exact-env.mjs";

const root = resolve(".");
const temporaryRoot = mkdtempSync(
  join(resolve(tmpdir()), "canvas-blue-green-verifier-")
);
const bundleTool = resolve("scripts/canvas-rollback-bundle.mjs");
const healthProbe = resolve("scripts/probe-canvas-internal-health.mjs");
let assertions = 0;

function assert(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function assertIncludes(source, token, label) {
  assert(source.includes(token), `${label} is missing: ${token}`);
}

function runNode(argumentsList, extraEnv = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const environment = {
      ...process.env,
      ...extraEnv,
    };
    if (extraEnv.CANVAS_RECONCILE_SECRET === null) {
      delete environment.CANVAS_RECONCILE_SECRET;
    }
    const child = spawn(process.execPath, argumentsList, {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 1024 * 1024) child.kill();
    });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

function runCommand(command, argumentsList, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, argumentsList, {
      cwd: options.cwd ?? root,
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 1024 * 1024) child.kill();
    });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function writeExecutable(file, source) {
  writeFileSync(file, source, { encoding: "utf8", mode: 0o755 });
  chmodSync(file, 0o755);
}

function writeRelease(parent, name, buildId, port) {
  const release = join(parent, name);
  mkdirSync(join(release, ".next"), { recursive: true });
  writeFileSync(join(release, ".next", "BUILD_ID"), `${buildId}\n`);
  writeFileSync(
    join(release, "package.json"),
    `${JSON.stringify({ name, version: "0.1.0" })}\n`
  );
  writeFileSync(
    join(release, ".env.local"),
    `CANVAS_RECONCILE_SECRET=${"s".repeat(48)}\n`
  );
  chmodSync(join(release, ".env.local"), 0o600);
  const nginx = join(parent, `${name}.nginx.conf`);
  writeFileSync(
    nginx,
    [
      "server {",
      "  location ^~ /api/internal/canvas/ { return 404; }",
      `  location / { proxy_pass http://127.0.0.1:${port}; }`,
      "}",
      "",
    ].join("\n")
  );
  return { release, envFile: join(release, ".env.local"), nginx, port };
}

function commonBundleArguments(rollbackDir, bundleDir, nginx, worker) {
  return [
    "--bundle-dir",
    bundleDir,
    "--rollback-dir",
    rollbackDir,
    "--expected-nginx-config",
    nginx,
    "--expected-worker-name",
    worker.name,
    "--expected-worker-install-dir",
    worker.installDir,
    "--allow-non-root-test",
  ];
}

async function testBundles() {
  const rollbackDir = join(temporaryRoot, "rollback");
  const workerInstallDir = join(temporaryRoot, "stable-worker");
  const workerEnv = join(temporaryRoot, "worker.env");
  mkdirSync(rollbackDir);
  chmodSync(rollbackDir, 0o700);
  mkdirSync(workerInstallDir);
  writeFileSync(workerEnv, `CANVAS_RECONCILE_SECRET=${"w".repeat(48)}\n`);
  const release = writeRelease(temporaryRoot, "release-present", "build-present", 4101);
  const worker = {
    name: "stargaze-canvas-reconciler",
    installDir: workerInstallDir,
  };
  const installedScript = join(
    workerInstallDir,
    "canvas-reconciler-worker.mjs"
  );
  const installedConfig = join(
    workerInstallDir,
    "ecosystem.canvas-reconciler.config.cjs"
  );
  const installedSettings = join(
    workerInstallDir,
    "canvas-reconciler.settings.json"
  );
  writeFileSync(installedScript, "console.log('original worker');\n");
  writeFileSync(installedConfig, "module.exports = { apps: [] };\n");
  writeFileSync(
    installedSettings,
    `${JSON.stringify({
      name: worker.name,
      script: installedScript,
      envFile: workerEnv,
      url: "http://127.0.0.1:4101/api/internal/canvas/reconcile",
      lockFile: join(temporaryRoot, "worker.lock"),
    })}\n`
  );
  chmodSync(installedScript, 0o755);
  chmodSync(installedConfig, 0o644);
  chmodSync(installedSettings, 0o600);

  const presentBundle = join(rollbackDir, "present-bundle");
  const createPresent = await runNode(
    [
      bundleTool,
      "create",
      "--bundle-dir",
      presentBundle,
      "--rollback-dir",
      rollbackDir,
      "--nginx-config",
      release.nginx,
      "--web-name",
      "canvas-present",
      "--web-port",
      String(release.port),
      "--web-root",
      release.release,
      "--web-env-file",
      release.envFile,
      "--web-health-contract",
      "exact",
      "--worker-name",
      worker.name,
      "--worker-install-dir",
      worker.installDir,
      "--worker-process-present",
      "true",
      "--allow-non-root-test",
    ],
    { NODE_ENV: "test" }
  );
  assert(createPresent.code === 0, `present bundle create failed: ${createPresent.stderr}`);

  const verifyPresent = await runNode(
    [
      bundleTool,
      "verify",
      ...commonBundleArguments(
        rollbackDir,
        presentBundle,
        release.nginx,
        worker
      ),
    ],
    { NODE_ENV: "test" }
  );
  assert(verifyPresent.code === 0, `present bundle verify failed: ${verifyPresent.stderr}`);
  const inspectPresent = await runNode(
    [
      bundleTool,
      "inspect",
      ...commonBundleArguments(
        rollbackDir,
        presentBundle,
        release.nginx,
        worker
      ),
    ],
    { NODE_ENV: "test" }
  );
  const presentFields = inspectPresent.stdout.trim().split(/\r?\n/u);
  assert(inspectPresent.code === 0, `present bundle inspect failed: ${inspectPresent.stderr}`);
  assert(
    presentFields[5] === "exact" && presentFields[6] === "true",
    "exact worker-present contract was not persisted"
  );

  const invalidLegacyBundle = join(rollbackDir, "invalid-legacy-worker-bundle");
  const rejectLegacyWorker = await runNode(
    [
      bundleTool,
      "create",
      "--bundle-dir",
      invalidLegacyBundle,
      "--rollback-dir",
      rollbackDir,
      "--nginx-config",
      release.nginx,
      "--web-name",
      "canvas-present",
      "--web-port",
      String(release.port),
      "--web-root",
      release.release,
      "--web-env-file",
      release.envFile,
      "--web-health-contract",
      "legacy-bootstrap",
      "--worker-name",
      worker.name,
      "--worker-install-dir",
      worker.installDir,
      "--worker-process-present",
      "true",
      "--allow-non-root-test",
    ],
    { NODE_ENV: "test" }
  );
  assert(
    rejectLegacyWorker.code !== 0,
    "legacy-bootstrap bundle accepted an existing worker"
  );

  writeFileSync(installedScript, "console.log('mutated worker');\n");
  writeFileSync(installedConfig, "module.exports = { broken: true };\n");
  writeFileSync(installedSettings, "{}\n");
  const restorePresent = await runNode(
    [
      bundleTool,
      "restore-worker",
      ...commonBundleArguments(
        rollbackDir,
        presentBundle,
        release.nginx,
        worker
      ),
    ],
    { NODE_ENV: "test" }
  );
  assert(restorePresent.code === 0, `present worker restore failed: ${restorePresent.stderr}`);
  assert(restorePresent.stdout.trim() === "present", "present worker state was not restored");
  assert(
    readFileSync(installedScript, "utf8") ===
      "console.log('original worker');\n",
    "worker script bytes were not restored"
  );
  assert(
    JSON.parse(readFileSync(installedSettings, "utf8")).url ===
      "http://127.0.0.1:4101/api/internal/canvas/reconcile",
    "worker settings URL was not restored"
  );

  const legacyWorkerInstallDir = join(temporaryRoot, "legacy-worker");
  const legacyWorker = {
    name: worker.name,
    installDir: legacyWorkerInstallDir,
  };
  const legacyRelease = writeRelease(
    temporaryRoot,
    "release-legacy-worker",
    "build-legacy-worker",
    4103
  );
  mkdirSync(legacyWorkerInstallDir);
  const legacyInstalledScript = join(
    legacyWorkerInstallDir,
    "canvas-reconciler-worker.mjs"
  );
  const legacyInstalledConfig = join(
    legacyWorkerInstallDir,
    "ecosystem.canvas-reconciler.cjs"
  );
  const currentInstalledConfig = join(
    legacyWorkerInstallDir,
    "ecosystem.canvas-reconciler.config.cjs"
  );
  const legacyInstalledSettings = join(
    legacyWorkerInstallDir,
    "canvas-reconciler.settings.json"
  );
  writeFileSync(legacyInstalledScript, "console.log('legacy worker');\n");
  writeFileSync(legacyInstalledConfig, "module.exports = { apps: ['legacy'] };\n");
  writeFileSync(
    legacyInstalledSettings,
    `${JSON.stringify({
      name: legacyWorker.name,
      script: legacyInstalledScript,
      envFile: workerEnv,
      url: "http://127.0.0.1:4103/api/internal/canvas/reconcile",
      lockFile: join(temporaryRoot, "legacy-worker.lock"),
    })}\n`
  );
  chmodSync(legacyInstalledScript, 0o755);
  chmodSync(legacyInstalledConfig, 0o644);
  chmodSync(legacyInstalledSettings, 0o600);

  const legacyWorkerBundle = join(rollbackDir, "legacy-worker-present-bundle");
  const createLegacyWorker = await runNode(
    [
      bundleTool,
      "create",
      "--bundle-dir",
      legacyWorkerBundle,
      "--rollback-dir",
      rollbackDir,
      "--nginx-config",
      legacyRelease.nginx,
      "--web-name",
      "canvas-legacy-worker",
      "--web-port",
      String(legacyRelease.port),
      "--web-root",
      legacyRelease.release,
      "--web-env-file",
      legacyRelease.envFile,
      "--web-health-contract",
      "exact",
      "--worker-name",
      legacyWorker.name,
      "--worker-install-dir",
      legacyWorker.installDir,
      "--worker-process-present",
      "true",
      "--allow-non-root-test",
    ],
    { NODE_ENV: "test" }
  );
  assert(
    createLegacyWorker.code === 0,
    `legacy worker bundle create failed: ${createLegacyWorker.stderr}`
  );
  const legacyManifest = JSON.parse(
    readFileSync(join(legacyWorkerBundle, "manifest.json"), "utf8")
  );
  assert(
    legacyManifest.worker.files.config.bundleFile ===
      "worker/ecosystem.canvas-reconciler.cjs",
    "legacy v1 worker bundle filename was not preserved"
  );
  const verifyLegacyWorker = await runNode(
    [
      bundleTool,
      "verify",
      ...commonBundleArguments(
        rollbackDir,
        legacyWorkerBundle,
        legacyRelease.nginx,
        legacyWorker
      ),
    ],
    { NODE_ENV: "test" }
  );
  assert(
    verifyLegacyWorker.code === 0,
    `legacy worker bundle verify failed: ${verifyLegacyWorker.stderr}`
  );
  writeFileSync(legacyInstalledConfig, "module.exports = { broken: true };\n");
  const restoreLegacyWorker = await runNode(
    [
      bundleTool,
      "restore-worker",
      ...commonBundleArguments(
        rollbackDir,
        legacyWorkerBundle,
        legacyRelease.nginx,
        legacyWorker
      ),
    ],
    { NODE_ENV: "test" }
  );
  assert(
    restoreLegacyWorker.code === 0,
    `legacy worker restore failed: ${restoreLegacyWorker.stderr}`
  );
  assert(
    existsSync(currentInstalledConfig) &&
      readFileSync(currentInstalledConfig, "utf8") ===
        "module.exports = { apps: ['legacy'] };\n",
    "legacy worker config was not normalized to the PM2-compatible filename"
  );
  assert(
    !existsSync(legacyInstalledConfig),
    "legacy worker config filename remained after normalization"
  );

  writeFileSync(join(presentBundle, "nginx.conf"), "tampered\n");
  const rejectTamper = await runNode(
    [
      bundleTool,
      "verify",
      ...commonBundleArguments(
        rollbackDir,
        presentBundle,
        release.nginx,
        worker
      ),
    ],
    { NODE_ENV: "test" }
  );
  assert(rejectTamper.code !== 0, "a tampered rollback bundle was accepted");
  assert(
    rejectTamper.stderr.includes("checksum mismatch"),
    "tamper rejection did not identify the checksum boundary"
  );

  const absentInstallDir = join(temporaryRoot, "first-deploy-worker");
  const absentWorker = {
    name: worker.name,
    installDir: absentInstallDir,
  };
  const absentRelease = writeRelease(
    temporaryRoot,
    "release-absent",
    "build-absent",
    4102
  );
  const absentBundle = join(rollbackDir, "absent-bundle");
  const createAbsent = await runNode(
    [
      bundleTool,
      "create",
      "--bundle-dir",
      absentBundle,
      "--rollback-dir",
      rollbackDir,
      "--nginx-config",
      absentRelease.nginx,
      "--web-name",
      "canvas-absent",
      "--web-port",
      String(absentRelease.port),
      "--web-root",
      absentRelease.release,
      "--web-env-file",
      absentRelease.envFile,
      "--web-health-contract",
      "legacy-bootstrap",
      "--worker-name",
      absentWorker.name,
      "--worker-install-dir",
      absentWorker.installDir,
      "--worker-process-present",
      "false",
      "--allow-non-root-test",
    ],
    { NODE_ENV: "test" }
  );
  assert(createAbsent.code === 0, `absent bundle create failed: ${createAbsent.stderr}`);
  const inspectAbsent = await runNode(
    [
      bundleTool,
      "inspect",
      ...commonBundleArguments(
        rollbackDir,
        absentBundle,
        absentRelease.nginx,
        absentWorker
      ),
    ],
    { NODE_ENV: "test" }
  );
  const absentFields = inspectAbsent.stdout.trim().split(/\r?\n/u);
  assert(inspectAbsent.code === 0, `absent bundle inspect failed: ${inspectAbsent.stderr}`);
  assert(
    absentFields[5] === "legacy-bootstrap" &&
      absentFields[6] === "false",
    "legacy-bootstrap no-worker contract was not persisted"
  );

  mkdirSync(absentInstallDir);
  for (const file of [
    "canvas-reconciler-worker.mjs",
    "ecosystem.canvas-reconciler.cjs",
    "ecosystem.canvas-reconciler.config.cjs",
    "canvas-reconciler.settings.json",
  ]) {
    writeFileSync(join(absentInstallDir, file), "new release state\n");
  }
  const restoreAbsent = await runNode(
    [
      bundleTool,
      "restore-worker",
      ...commonBundleArguments(
        rollbackDir,
        absentBundle,
        absentRelease.nginx,
        absentWorker
      ),
    ],
    { NODE_ENV: "test" }
  );
  assert(restoreAbsent.code === 0, `absent worker restore failed: ${restoreAbsent.stderr}`);
  assert(restoreAbsent.stdout.trim() === "absent", "no-worker state was not restored");
  for (const file of [
    "canvas-reconciler-worker.mjs",
    "ecosystem.canvas-reconciler.cjs",
    "ecosystem.canvas-reconciler.config.cjs",
    "canvas-reconciler.settings.json",
  ]) {
    assert(
      !existsSync(join(absentInstallDir, file)),
      `first-deploy rollback retained ${file}`
    );
  }
}

async function withHealthServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object", "mock server address is invalid");
    await callback(address.port);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

async function testHealthProbe() {
  const release = writeRelease(
    temporaryRoot,
    "health-release",
    "health-build-id",
    4201
  );
  const secret = "s".repeat(48);
  let mode = "healthy";
  await withHealthServer((request, response) => {
    const authorized = request.headers.authorization === `Bearer ${secret}`;
    if (!authorized) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end('{"status":"error"}');
      return;
    }
    if (mode === "wrong-status") {
      response.writeHead(204, { "Content-Type": "application/json" });
      response.end();
      return;
    }
    const buildId = mode === "wrong-build" ? "different-build" : "health-build-id";
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        status: "ok",
        build: { id: buildId, version: "0.1.0" },
        database: { reachable: true, readOnlyProbe: true },
        canvas: {
          contractVersion: "canvas-production-health-v1",
          requiredRpcCount: 27,
        },
      })
    );
  }, async (port) => {
    const baseArguments = [
      healthProbe,
      "--url",
      `http://127.0.0.1:${port}/api/internal/canvas/health`,
      "--root",
      release.release,
      "--env-file",
      release.envFile,
      "--attempts",
      "1",
      "--interval-ms",
      "0",
    ];
    const healthy = await runNode(baseArguments, {
      NODE_ENV: "test",
      CANVAS_RECONCILE_SECRET: null,
    });
    assert(healthy.code === 0, `exact health probe failed: ${healthy.stderr}`);

    const contaminated = await runNode(baseArguments, {
      NODE_ENV: "test",
      CANVAS_RECONCILE_SECRET: "x".repeat(48),
    });
    assert(
      contaminated.code === 0,
      "health probe allowed inherited environment to override the exact release file"
    );

    mode = "wrong-build";
    const wrongBuild = await runNode(baseArguments, {
      NODE_ENV: "test",
      CANVAS_RECONCILE_SECRET: null,
    });
    assert(wrongBuild.code !== 0, "health probe accepted a different BUILD_ID");

    mode = "wrong-status";
    const wrongStatus = await runNode(baseArguments, {
      NODE_ENV: "test",
      CANVAS_RECONCILE_SECRET: null,
    });
    assert(wrongStatus.code !== 0, "health probe accepted non-200 status");
  });
}

function testExactEnvironmentBoundary() {
  const release = writeRelease(
    temporaryRoot,
    "exact-env-release",
    "exact-env-build",
    4202
  );
  const previousSecret = process.env.CANVAS_RECONCILE_SECRET;
  const previousNodeOptions = process.env.NODE_OPTIONS;
  process.env.CANVAS_RECONCILE_SECRET = "x".repeat(48);
  process.env.NODE_OPTIONS = "--inspect=127.0.0.1:0";
  try {
    const parsed = readExactReleaseEnvironment(
      release.release,
      release.envFile
    );
    const childEnvironment = exactProcessEnvironment(parsed.values, {
      NODE_ENV: "production",
      PORT: "4202",
    });
    assert(
      childEnvironment.CANVAS_RECONCILE_SECRET === "s".repeat(48),
      "exact environment did not override a contaminated Canvas secret"
    );
    assert(
      !Object.hasOwn(childEnvironment, "NODE_OPTIONS"),
      "exact environment inherited NODE_OPTIONS"
    );
    assert(
      childEnvironment.NODE_ENV === "production" &&
        childEnvironment.PORT === "4202",
      "exact environment did not install bounded runtime additions"
    );
  } finally {
    if (previousSecret === undefined) {
      delete process.env.CANVAS_RECONCILE_SECRET;
    } else {
      process.env.CANVAS_RECONCILE_SECRET = previousSecret;
    }
    if (previousNodeOptions === undefined) {
      delete process.env.NODE_OPTIONS;
    } else {
      process.env.NODE_OPTIONS = previousNodeOptions;
    }
  }
}

function installerBash() {
  if (process.platform !== "linux") return "";
  for (const candidate of ["/usr/bin/bash", "/bin/bash"]) {
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

function createInstallerMockFixture(
  name,
  {
    initialState,
    probeIdentities,
    oldFiles = false,
    failRestore = false,
    failDelete = false,
  }
) {
  const fixture = join(temporaryRoot, `installer-${name}`);
  const fakeBin = join(fixture, "bin");
  const installDir = join(fixture, "install");
  const home = join(fixture, "home");
  const pm2Home = join(home, ".pm2");
  const stateFile = join(fixture, "pm2-state");
  const eventLog = join(fixture, "events.log");
  const probeQueue = join(fixture, "probe-queue");
  const sourceScript = join(fixture, "source-worker.mjs");
  const sourceConfig = join(fixture, "source-ecosystem.config.cjs");
  const envFile = join(fixture, "worker.env");
  const lockFile = join(fixture, "worker.lock");
  const installedScript = join(installDir, "canvas-reconciler-worker.mjs");
  const installedConfig = join(
    installDir,
    "ecosystem.canvas-reconciler.config.cjs"
  );
  const installedSettings = join(
    installDir,
    "canvas-reconciler.settings.json"
  );
  const pm2Name = "canvas-reconciler-test";
  const targetUrl =
    "http://127.0.0.1:49999/api/internal/canvas/reconcile";
  const readyProbe = resolve(root, "scripts/probe-canvas-reconciler-readiness.mjs");
  const realCopy = existsSync("/usr/bin/cp") ? "/usr/bin/cp" : "/bin/cp";

  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(pm2Home, { recursive: true });
  writeFileSync(stateFile, `${initialState}\n`);
  writeFileSync(eventLog, "");
  writeFileSync(
    probeQueue,
    `${probeIdentities.map((identity) => `ok:${identity}`).join("\n")}\n`
  );
  writeFileSync(
    sourceScript,
    [
      "#!/usr/bin/env node",
      'if (process.argv.includes("--dry-run")) process.exit(0);',
      "",
    ].join("\n")
  );
  chmodSync(sourceScript, 0o755);
  writeFileSync(sourceConfig, "module.exports = { apps: [] };\n");
  chmodSync(sourceConfig, 0o644);
  writeFileSync(
    envFile,
    `CANVAS_RECONCILE_SECRET=${"i".repeat(48)}\n`
  );
  chmodSync(envFile, 0o600);

  const oldBytes = {
    script: "#!/usr/bin/env node\nconsole.log('old worker');\n",
    config: "module.exports = { apps: [{ name: 'old worker' }] };\n",
  };
  if (oldFiles) {
    mkdirSync(installDir, { recursive: true });
    writeFileSync(installedScript, oldBytes.script);
    writeFileSync(installedConfig, oldBytes.config);
    writeFileSync(
      installedSettings,
      `${JSON.stringify({
        name: pm2Name,
        script: installedScript,
        envFile,
        url: targetUrl,
        lockFile,
      })}\n`
    );
    chmodSync(installedScript, 0o755);
    chmodSync(installedConfig, 0o644);
    chmodSync(installedSettings, 0o600);
  }

  const onlineState = JSON.stringify([
    {
      name: pm2Name,
      pid: 4242,
      pm2_env: {
        status: "online",
        exec_mode: "fork_mode",
        pm_exec_path: installedScript,
        pm_uptime: Date.now() - 1_000,
      },
    },
  ]);
  writeExecutable(
    join(fakeBin, "pm2"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `STATE=${shellQuote(stateFile)}`,
      `EVENTS=${shellQuote(eventLog)}`,
      `ONLINE_JSON=${shellQuote(onlineState)}`,
      `FAIL_DELETE=${failDelete ? "1" : "0"}`,
      'case "${1:-}" in',
      "  -v)",
      '    printf "%s\\n" "6.0.14"',
      "    ;;",
      "  jlist)",
      '    printf "%s\\n" "pm2:jlist" >> "${EVENTS}"',
      '    current_state="absent"',
      '    IFS= read -r current_state < "${STATE}" || true',
      '    if [[ "${current_state}" == "online" ]]; then',
      '      printf "%s\\n" "${ONLINE_JSON}"',
      "    else",
      '      printf "%s\\n" "[]"',
      "    fi",
      "    ;;",
      "  startOrReload)",
      '    printf "%s\\n" "pm2:startOrReload" >> "${EVENTS}"',
      '    printf "%s\\n" "online" > "${STATE}"',
      "    ;;",
      "  delete)",
      '    printf "%s\\n" "pm2:delete" >> "${EVENTS}"',
      '    if [[ "${FAIL_DELETE}" == "1" ]]; then',
      '      printf "%s\\n" "pm2:delete-failed" >> "${EVENTS}"',
      "      exit 98",
      "    fi",
      '    printf "%s\\n" "absent" > "${STATE}"',
      "    ;;",
      "  save)",
      '    printf "%s\\n" "pm2:save" >> "${EVENTS}"',
      "    ;;",
      "  *)",
      '    printf "unexpected pm2 command: %s\\n" "${1:-missing}" >&2',
      "    exit 90",
      "    ;;",
      "esac",
      "",
    ].join("\n")
  );
  writeExecutable(
    join(fakeBin, "node"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `REAL_NODE=${shellQuote(process.execPath)}`,
      `READY_PROBE=${shellQuote(readyProbe)}`,
      `QUEUE=${shellQuote(probeQueue)}`,
      `EVENTS=${shellQuote(eventLog)}`,
      'if [[ "${1:-}" == "${READY_PROBE}" ]]; then',
      '  if [[ ! -s "${QUEUE}" ]]; then',
      '    printf "%s\\n" "probe:unexpected-empty-queue" >> "${EVENTS}"',
      '    printf "%s\\n" "mock readiness queue is empty" >&2',
      "    exit 91",
      "  fi",
      '  outcome=""',
      '  IFS= read -r outcome < "${QUEUE}" || true',
      '  tail -n +2 -- "${QUEUE}" > "${QUEUE}.next"',
      '  mv -f -- "${QUEUE}.next" "${QUEUE}"',
      '  printf "probe:%s\\n" "${outcome}" >> "${EVENTS}"',
      '  case "${outcome}" in',
      "    ok:*)",
      '      printf "%s\\n" "${outcome#ok:}"',
      "      exit 0",
      "      ;;",
      "    *)",
      '      printf "%s\\n" "mock readiness failure" >&2',
      "      exit 92",
      "      ;;",
      "  esac",
      "fi",
      'exec "${REAL_NODE}" "$@"',
      "",
    ].join("\n")
  );
  writeExecutable(
    join(fakeBin, "sleep"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf "%s\\n" "sleep:${1:-missing}" >> ' + shellQuote(eventLog),
      "",
    ].join("\n")
  );
  if (failRestore) {
    writeExecutable(
      join(fakeBin, "cp"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `REAL_CP=${shellQuote(realCopy)}`,
        `EVENTS=${shellQuote(eventLog)}`,
        'for argument in "$@"; do',
        '  if [[ "${argument}" == *"/.canvas-reconciler-restore."* ]]; then',
        '    printf "%s\\n" "restore-copy-fail" >> "${EVENTS}"',
        "    exit 97",
        "  fi",
        "done",
        'exec "${REAL_CP}" "$@"',
        "",
      ].join("\n")
    );
  }

  return {
    eventLog,
    envFile,
    fakeBin,
    home,
    installDir,
    installedConfig,
    installedScript,
    installedSettings,
    lockFile,
    oldBytes,
    pm2Home,
    pm2Name,
    probeQueue,
    sourceConfig,
    sourceScript,
    stateFile,
    targetUrl,
  };
}

async function runInstallerMock(bash, fixture) {
  return runCommand(
    bash,
    [
      resolve(root, "deploy/install-canvas-reconciler.sh"),
      "install",
      "--execute",
      "--env-file",
      fixture.envFile,
      "--url",
      fixture.targetUrl,
      "--install-dir",
      fixture.installDir,
      "--lock-file",
      fixture.lockFile,
      "--pm2-name",
      fixture.pm2Name,
      "--source-script",
      fixture.sourceScript,
      "--source-config",
      fixture.sourceConfig,
    ],
    {
      env: {
        PATH: `${fixture.fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        HOME: fixture.home,
        PM2_HOME: fixture.pm2Home,
        USER: "root",
        LOGNAME: "root",
        LANG: "C.UTF-8",
      },
    }
  );
}

function eventLines(fixture) {
  return readFileSync(fixture.eventLog, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean);
}

async function testInstallerFailureHarness() {
  const bash = installerBash();
  const canRun =
    bash &&
    typeof process.getuid === "function" &&
    process.getuid() === 0;
  if (!canRun) {
    assert(
      process.env.CANVAS_REQUIRE_INSTALLER_DYNAMIC_TESTS !== "1",
      "dynamic installer tests require Linux, bash, and uid 0"
    );
    return;
  }

  const absent = createInstallerMockFixture("absent-rollback", {
    initialState: "absent",
    probeIdentities: ["8100:100", "8101:101"],
  });
  const absentResult = await runInstallerMock(bash, absent);
  const absentEvents = eventLines(absent);
  assert(
    absentResult.code !== 0,
    "installer accepted two different post-install readiness identities"
  );
  assert(
    absentResult.stderr.includes("[ROLLBACK]"),
    "failed first install did not enter rollback"
  );
  assert(
    readFileSync(absent.stateFile, "utf8").trim() === "absent",
    "first-install rollback left a mocked PM2 process present"
  );
  assert(
    absentEvents.filter((event) => event === "pm2:startOrReload").length === 1 &&
      absentEvents.includes("pm2:delete"),
    "first-install rollback did not delete the newly started process"
  );
  for (const installedFile of [
    absent.installedScript,
    absent.installedConfig,
    absent.installedSettings,
  ]) {
    assert(
      !existsSync(installedFile),
      `first-install rollback retained ${installedFile}`
    );
  }

  const failedDelete = createInstallerMockFixture(
    "rollback-delete-failure",
    {
      initialState: "absent",
      probeIdentities: ["8150:150", "8151:151"],
      failDelete: true,
    }
  );
  const failedDeleteResult = await runInstallerMock(bash, failedDelete);
  const failedDeleteEvents = eventLines(failedDelete);
  const firstFailedDelete = failedDeleteEvents.indexOf("pm2:delete-failed");
  assert(
    failedDeleteResult.code !== 0 &&
      failedDeleteResult.stderr.includes("[CRITICAL]"),
    "rollback PM2 delete failure was not surfaced as critical"
  );
  assert(
    firstFailedDelete >= 0 &&
      failedDeleteEvents
        .slice(firstFailedDelete + 1)
        .includes("pm2:jlist"),
    "rollback did not observe that the process remained online after delete failed"
  );
  assert(
    readFileSync(failedDelete.stateFile, "utf8").trim() === "online",
    "delete-failure fixture did not retain the mocked online process"
  );
  assert(
    !failedDeleteEvents.includes("pm2:save"),
    "rollback persisted PM2 state after delete failed and the process remained online"
  );

  const failedRestore = createInstallerMockFixture("restore-failure", {
    initialState: "online",
    probeIdentities: [
      "8200:200",
      "8200:200",
      "8300:300",
      "8301:301",
    ],
    oldFiles: true,
    failRestore: true,
  });
  const failedRestoreResult = await runInstallerMock(bash, failedRestore);
  const failedRestoreEvents = eventLines(failedRestore);
  const restoreFailureIndex = failedRestoreEvents.indexOf("restore-copy-fail");
  assert(
    failedRestoreResult.code !== 0 &&
      failedRestoreResult.stderr.includes("[CRITICAL]"),
    "old-file restoration failure was not surfaced as critical"
  );
  assert(
    restoreFailureIndex >= 0,
    "mock old-file restoration failure was not exercised"
  );
  assert(
    failedRestoreEvents.filter(
      (event) => event === "pm2:startOrReload"
    ).length === 1 &&
      !failedRestoreEvents
        .slice(restoreFailureIndex)
        .includes("pm2:startOrReload"),
    "rollback called startOrReload after an old-file restoration failure"
  );
  assert(
    readFileSync(failedRestore.stateFile, "utf8").trim() === "absent",
    "failed old-file restoration did not fail closed by deleting the process"
  );

  const unstablePrevious = createInstallerMockFixture(
    "unstable-previous-identity",
    {
      initialState: "online",
      probeIdentities: ["8400:400", "8401:401"],
      oldFiles: true,
    }
  );
  const previousScriptBytes = readFileSync(
    unstablePrevious.installedScript,
    "utf8"
  );
  const unstableResult = await runInstallerMock(bash, unstablePrevious);
  const unstableEvents = eventLines(unstablePrevious);
  assert(
    unstableResult.code !== 0 &&
      unstableResult.stderr.includes(
        "neither stably absent nor one healthy online process"
      ),
    "installer accepted a changing pre-install worker identity"
  );
  assert(
    !unstableEvents.includes("pm2:startOrReload"),
    "installer mutated PM2 after a changing pre-install worker identity"
  );
  assert(
    readFileSync(unstablePrevious.installedScript, "utf8") ===
      previousScriptBytes &&
      readFileSync(unstablePrevious.stateFile, "utf8").trim() === "online",
    "pre-install identity rejection changed old files or process state"
  );
}

function testStaticContracts() {
  const migration = read("supabase/migrations/20260731_canvas_runtime_health.sql");
  for (const signature of [
    "create_canvas_project_v1(uuid,text,integer,jsonb,jsonb,integer)",
    "delete_canvas_project_v1(uuid)",
    "sweep_stale_canvas_not_started_v1(integer)",
    "resolve_canvas_video_unknown_v1(uuid,uuid,text,text,text,text)",
    "canvas_owned_media_key_v1(text,uuid)",
    "reserve_canvas_uploads_v1(uuid,jsonb)",
    "finalize_canvas_upload_v1(uuid,uuid,text,bigint,text)",
    "assert_canvas_media_keys_ready_v1(uuid,uuid,bigint,text[])",
    "sweep_expired_canvas_uploads_v1(integer)",
    "mark_canvas_upload_orphans_v1(integer,integer)",
    "claim_canvas_upload_purge_v1(integer,integer)",
    "complete_canvas_upload_purge_v1(uuid,uuid)",
  ]) {
    assertIncludes(migration, signature, "health migration");
  }
  assertIncludes(migration, "STABLE", "health migration");
  assertIncludes(migration, "SECURITY DEFINER", "health migration");
  assertIncludes(
    migration,
    "REVOKE ALL ON FUNCTION public.canvas_production_healthcheck_v1()",
    "health migration"
  );
  assertIncludes(
    migration,
    "TO service_role",
    "health migration service-only grant"
  );
  assertIncludes(
    migration,
    "expected_security_definer",
    "health migration SECURITY DEFINER contract"
  );
  assertIncludes(
    migration,
    "expected_search_path",
    "health migration search_path contract"
  );
  assertIncludes(
    migration,
    "('public.canvas_owned_media_key_v1(text,uuid)', 'service_role', false, '')",
    "health migration invoker upload helper contract"
  );
  assertIncludes(
    migration,
    "('public.resolve_canvas_video_unknown_v1(uuid,uuid,text,text,text,text)', 'service_role', true, '')",
    "health migration empty-search-path recovery contract"
  );
  assertIncludes(
    migration,
    "'authenticated'",
    "health migration service-only ACL contract"
  );
  assertIncludes(
    migration,
    "'anon'",
    "health migration anonymous ACL contract"
  );
  assert(
    !/^\s*(?:BEGIN|COMMIT)\s*;/imu.test(migration),
    "health migration must not own a transaction boundary"
  );

  const route = read("src/app/api/internal/canvas/health/route.ts");
  assertIncludes(route, 'hasCanvasBearer(request, "CANVAS_RECONCILE_SECRET")', "health route");
  assertIncludes(route, ".next\", \"BUILD_ID", "health route build identity");
  assertIncludes(route, "canvas_production_healthcheck_v1", "health route RPC");
  assertIncludes(route, "REQUIRED_RPC_COUNT = 27", "health route RPC count");
  assertIncludes(route, "status: \"ok\"", "health route exact success");

  const authentication = read("src/lib/canvas/internal-auth.ts");
  assertIncludes(authentication, "hasCanvasHeaderSecret", "internal auth");
  assertIncludes(authentication, "isCanvasSecretConfigured", "internal auth");
  assertIncludes(authentication, "CANVAS_RECOVERY_APPROVER_SECRET", "internal auth");
  assertIncludes(authentication, "timingSafeEqual", "internal auth");

  const deploy = read("deploy/canvas-blue-green.sh");
  for (const token of [
    'EXPECTED_ENV_FILE="${CANDIDATE_DIR}/.env.local"',
    "--allow-legacy-active",
    "legacy-bootstrap",
    "/api/internal/canvas/health",
    "create_state_bundle",
    "restore_worker_from_bundle",
    "restore_nginx_from_bundle",
    "SYSTEM_STATE_CHANGED=1",
    'pm2 delete "${RECONCILER_NAME}"',
    "/api/internal/canvas/",
    "scripts/run-canvas-build.mjs",
    "scripts/start-canvas-web.mjs",
    "ecosystem.canvas.config.cjs",
    'CANVAS_ENV_FILE="${ENV_FILE}"',
    "Stop the Canvas upload sweeper service and disable its timer before rollback",
    "stargaze-canvas-upload-sweeper.service",
    "canvas_upload_sweeper_is_stopped",
    "--property=LoadState",
    "--property=UnitFileState",
    '== "not-found"',
    '== "disabled"',
    '"$(command -v npm)" ci --include=dev',
    "same server block as the unique proxy",
    "run_pm2_with_clean_environment",
    "env -i",
    "unset NODE_OPTIONS",
    "PM2 >=4.3 is required",
    "AUTO_RESTORE_SUCCEEDED=0",
    "AUTO_RESTORE_SUCCEEDED == 1",
    "probe-canvas-reconciler-readiness.mjs",
    "probe-oauth-broker-tls.mjs",
    'node "${RECONCILER_READY_PROBE}"',
    '--lock-file "${RECONCILER_LOCK_FILE}"',
  ]) {
    assertIncludes(deploy, token, "blue/green deployer");
  }
  const exactEnvironment = read("scripts/canvas-exact-env.mjs");
  assertIncludes(exactEnvironment, "O_NOFOLLOW", "exact environment loader");
  assertIncludes(exactEnvironment, "sameFile(before, opened)", "exact environment loader");
  assert(
    !exactEnvironment
      .slice(
        exactEnvironment.indexOf("SYSTEM_ENV_ALLOWLIST"),
        exactEnvironment.indexOf("]);", exactEnvironment.indexOf("SYSTEM_ENV_ALLOWLIST"))
      )
      .includes("NODE_OPTIONS"),
    "exact environment OS allowlist contains NODE_OPTIONS"
  );
  const buildRunner = read("scripts/run-canvas-build.mjs");
  assertIncludes(buildRunner, "exactProcessEnvironment", "exact build runner");
  assertIncludes(buildRunner, 'process.execPath, [nextCli, "build"]', "exact build runner");
  const webBootstrap = read("scripts/start-canvas-web.mjs");
  assertIncludes(webBootstrap, "installExactProcessEnvironment", "exact Web bootstrap");
  assertIncludes(webBootstrap, "await import(pathToFileURL", "exact Web bootstrap IPC boundary");
  const ecosystem = read("deploy/ecosystem.canvas.config.cjs");
  assertIncludes(ecosystem, 'script: "scripts/start-canvas-web.mjs"', "Canvas PM2 config");
  assertIncludes(ecosystem, "CANVAS_ENV_FILE", "Canvas PM2 config");
  assertIncludes(ecosystem, "NODE_EXTRA_CA_CERTS: brokerCa", "Canvas PM2 config");
  const brokerTlsProbe = read("scripts/probe-oauth-broker-tls.mjs");
  assertIncludes(brokerTlsProbe, "spawnSync", "OAuth broker TLS preflight");
  assertIncludes(
    brokerTlsProbe,
    "childEnvironment.NODE_EXTRA_CA_CERTS = brokerCa",
    "OAuth broker TLS preflight"
  );
  const reconcilerEcosystem = read(
    "deploy/ecosystem.canvas-reconciler.config.cjs"
  );
  assertIncludes(
    reconcilerEcosystem,
    "kill_timeout: 15_000",
    "Canvas reconciler bounded shutdown"
  );
  const reconcilerInstaller = read("deploy/install-canvas-reconciler.sh");
  assertIncludes(
    reconcilerInstaller,
    "ecosystem.canvas-reconciler.config.cjs",
    "Canvas reconciler PM2 config"
  );
  assertIncludes(
    reconcilerInstaller,
    "run_pm2_with_clean_environment",
    "Canvas reconciler installer"
  );
  assertIncludes(reconcilerInstaller, "env -i", "Canvas reconciler installer");
  for (const token of [
    "LEGACY_INSTALLED_CONFIG",
    "HAD_PROCESS=0",
    "pm2_worker_previous_state",
    "restore_backup_atomically",
    "PM2 >=4.3 is required",
    ".XXXXXX.config.cjs",
    "probe-canvas-reconciler-readiness.mjs",
    'node "${READY_PROBE}"',
    '--lock-file "${lock_file}"',
    '[[ "${first_identity}" == "${second_identity}" ]]',
    "elif ((HAD_PROCESS == 1)); then",
  ]) {
    assertIncludes(reconcilerInstaller, token, "Canvas reconciler installer");
  }
  assert(
    reconcilerInstaller.indexOf("FILES_REPLACED=1") <
      reconcilerInstaller.indexOf('mv -f -- "${STAGE_SCRIPT}"'),
    "Canvas reconciler installer arms rollback after its first staged move"
  );
  assert(
    reconcilerInstaller.indexOf("PROCESS_UPDATED=1") <
      reconcilerInstaller.indexOf('mv -f -- "${STAGE_SCRIPT}"'),
    "Canvas reconciler installer guards against a restart during staged moves"
  );
  const restoreSystem = deploy.slice(
    deploy.indexOf("restore_system_from_bundle()"),
    deploy.indexOf("switch_nginx_to_port()")
  );
  const restoreWorkerFailure = restoreSystem.indexOf(
    'if ! restore_worker_from_bundle "${bundle}"; then'
  );
  const restoreNginx = restoreSystem.indexOf(
    'if ! restore_nginx_from_bundle "${bundle}"; then'
  );
  assert(
    restoreWorkerFailure >= 0 &&
      restoreNginx > restoreWorkerFailure &&
      restoreSystem
        .slice(restoreWorkerFailure, restoreNginx)
        .includes("return 1"),
    "Canvas automatic recovery must not switch Nginx after worker restore failure"
  );
  const nginx = read("deploy/ssl/toryxai.com.conf");
  assertIncludes(
    nginx,
    "location ^~ /api/internal/canvas/",
    "production Nginx internal-route deny"
  );
  assertIncludes(nginx, "return 404;", "production Nginx internal-route deny");
}

async function main() {
  try {
    testStaticContracts();
    testExactEnvironmentBoundary();
    await testBundles();
    await testHealthProbe();
    await testInstallerFailureHarness();
    console.log(
      `[OK] Canvas blue/green verifier passed ${assertions} assertions.`
    );
  } finally {
    const resolvedTemporaryRoot = resolve(temporaryRoot);
    const resolvedSystemTemporaryRoot = resolve(tmpdir());
    const relation = resolvedTemporaryRoot.startsWith(
      `${resolvedSystemTemporaryRoot}${process.platform === "win32" ? "\\" : "/"}`
    );
    if (relation) rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(
    `[FAIL] ${
      error instanceof Error ? error.stack ?? error.message : "verification failed"
    }`
  );
  process.exitCode = 1;
}
