/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

const fs = require("node:fs");
const settingsFile =
  process.env.CANVAS_RECONCILER_SETTINGS_FILE ||
  path.join(__dirname, "canvas-reconciler.settings.json");
let stored = {};
if (fs.existsSync(settingsFile)) {
  const entry = fs.lstatSync(settingsFile);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 16 * 1024) {
    throw new Error("Canvas reconciler settings file is not trusted");
  }
  stored = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
}

const name =
  stored.name ||
  process.env.CANVAS_RECONCILER_PM2_NAME ||
  "stargaze-canvas-reconciler";
const script = stored.script || process.env.CANVAS_RECONCILER_SCRIPT;
const envFile = stored.envFile || process.env.CANVAS_RECONCILER_ENV_FILE;
const url = stored.url || process.env.CANVAS_RECONCILER_URL;
const lockFile =
  stored.lockFile ||
  process.env.CANVAS_RECONCILER_LOCK_FILE ||
  "/run/stargaze-canvas-reconciler.lock";

if (!/^[A-Za-z0-9._-]+$/.test(name)) {
  throw new Error("CANVAS_RECONCILER_PM2_NAME contains unsupported characters");
}

for (const [variable, value] of [
  ["CANVAS_RECONCILER_SCRIPT", script],
  ["CANVAS_RECONCILER_ENV_FILE", envFile],
  ["CANVAS_RECONCILER_LOCK_FILE", lockFile],
]) {
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${variable} must be an absolute path`);
  }
}

let target;
try {
  target = new URL(url);
} catch {
  throw new Error("CANVAS_RECONCILER_URL must be a valid URL");
}
if (
  target.protocol !== "http:" ||
  !["127.0.0.1", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/api/internal/canvas/reconcile" ||
  target.username ||
  target.password ||
  target.search ||
  target.hash
) {
  throw new Error(
    "CANVAS_RECONCILER_URL must be the exact loopback reconcile endpoint"
  );
}

module.exports = {
  apps: [
    {
      name,
      script,
      cwd: path.dirname(script),
      interpreter: "node",
      args: [
        "--env-file",
        envFile,
        "--url",
        target.toString(),
        "--lock-file",
        lockFile,
      ],
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      watch: false,
      time: true,
      wait_ready: true,
      shutdown_with_message: true,
      listen_timeout: 240_000,
      kill_timeout: 235_000,
      min_uptime: "30s",
      max_restarts: 10,
      restart_delay: 5_000,
    },
  ],
};
