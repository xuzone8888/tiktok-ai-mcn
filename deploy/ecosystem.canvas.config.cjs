/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

const name = process.env.CANVAS_PM2_NAME || "stargaze-canvas-candidate";
const cwd = process.env.CANVAS_APP_DIR;
const port = Number.parseInt(process.env.CANVAS_PORT || "", 10);
const envFile = process.env.CANVAS_ENV_FILE;

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

module.exports = {
  apps: [
    {
      name,
      script: "scripts/start-canvas-web.mjs",
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
        PORT: String(port),
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
