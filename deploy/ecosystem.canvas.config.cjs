/* eslint-disable @typescript-eslint/no-require-imports */
const { lstatSync, readFileSync, realpathSync } = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

const REQUIRED_NODE_VERSION = "24.18.0";
const name = process.env.CANVAS_PM2_NAME || "stargaze-canvas-candidate";
const cwd = process.env.CANVAS_APP_DIR;
const port = Number.parseInt(process.env.CANVAS_PORT || "", 10);
const envFile = process.env.CANVAS_ENV_FILE;
const nodeBin = process.env.CANVAS_NODE_BIN;

function assertTrustedRootPathChain(filePath, variable) {
  let current = filePath;
  while (true) {
    const entry = lstatSync(current);
    if (
      entry.isSymbolicLink() ||
      (process.platform !== "win32" &&
        (entry.uid !== 0 || (entry.mode & 0o022) !== 0))
    ) {
      throw new Error(
        `${variable} and every parent must be root-owned and not group- or other-writable`
      );
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

if (!cwd || !path.isAbsolute(cwd)) {
  throw new Error("CANVAS_APP_DIR must be an absolute release directory");
}

if (!/^[A-Za-z0-9._-]+$/.test(name)) {
  throw new Error("CANVAS_PM2_NAME contains unsupported characters");
}

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("CANVAS_PORT must be an integer between 1024 and 65535");
}

if (envFile !== path.join(cwd, ".env.local")) {
  throw new Error("CANVAS_ENV_FILE must be the release's exact .env.local");
}

if (!nodeBin || !path.isAbsolute(nodeBin) || realpathSync(nodeBin) !== nodeBin) {
  throw new Error("CANVAS_NODE_BIN must be a canonical absolute path");
}
assertTrustedRootPathChain(nodeBin, "CANVAS_NODE_BIN");
const nodeEntry = lstatSync(nodeBin);
if (
  !nodeEntry.isFile() ||
  nodeEntry.isSymbolicLink() ||
  (process.platform !== "win32" &&
    (nodeEntry.mode & 0o111) === 0)
) {
  throw new Error(
    "CANVAS_NODE_BIN must reference a trusted root-owned executable file"
  );
}

const envEntry = lstatSync(envFile);
if (!envEntry.isFile() || envEntry.isSymbolicLink()) {
  throw new Error("CANVAS_ENV_FILE must be a trusted regular file");
}
const releaseEnvironment = parseEnv(readFileSync(envFile, "utf8"));
const brokerCa = releaseEnvironment.NODE_EXTRA_CA_CERTS?.trim();
if (
  !brokerCa ||
  !path.isAbsolute(brokerCa) ||
  realpathSync(brokerCa) !== brokerCa
) {
  throw new Error("NODE_EXTRA_CA_CERTS must be a canonical absolute path");
}
assertTrustedRootPathChain(brokerCa, "NODE_EXTRA_CA_CERTS");
const brokerCaEntry = lstatSync(brokerCa);
if (!brokerCaEntry.isFile() || brokerCaEntry.isSymbolicLink()) {
  throw new Error("NODE_EXTRA_CA_CERTS must reference a trusted regular file");
}

module.exports = {
  apps: [
    {
      name,
      script: "scripts/start-canvas-web.mjs",
      interpreter: nodeBin,
      // Node 24 recognizes --env-file as its own option even after a script
      // path. End interpreter option parsing before PM2 appends script args.
      interpreter_args: ["--"],
      args: [
        "--root",
        cwd,
        "--env-file",
        envFile,
        "--port",
        String(port),
      ],
      cwd,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        CANVAS_REQUIRED_NODE_VERSION: REQUIRED_NODE_VERSION,
        PORT: String(port),
        // Node consumes extra trust anchors before this bootstrap executes.
        // Supplying the path in PM2 is therefore mandatory even though the
        // exact release environment is installed again inside the process.
        NODE_EXTRA_CA_CERTS: brokerCa,
      },
      autorestart: true,
      watch: false,
      max_memory_restart: process.env.CANVAS_PM2_MAX_MEMORY || "1G",
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 15000,
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
