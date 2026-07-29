"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const { lstatSync, readFileSync, realpathSync } = require("node:fs");
const path = require("node:path");

const EXPECTED_PM2_VERSION = "6.0.14";
const packageRoot = process.env.STARGAZE_PM2_PACKAGE_ROOT;

function reject() {
  throw new Error(
    "[FAIL] PM2 daemon auto-start is forbidden; an existing verified daemon is required"
  );
}

if (
  !packageRoot ||
  !path.isAbsolute(packageRoot) ||
  realpathSync(packageRoot) !== packageRoot
) {
  reject();
}

const packageEntry = lstatSync(packageRoot);
const packageFile = path.join(packageRoot, "package.json");
const clientFile = path.join(packageRoot, "lib", "Client.js");
if (
  !packageEntry.isDirectory() ||
  packageEntry.isSymbolicLink() ||
  realpathSync(packageFile) !== packageFile ||
  realpathSync(clientFile) !== clientFile
) {
  reject();
}

const metadata = JSON.parse(readFileSync(packageFile, "utf8"));
if (metadata?.name !== "pm2" || metadata?.version !== EXPECTED_PM2_VERSION) {
  reject();
}

const Client = require(clientFile);
if (
  typeof Client !== "function" ||
  typeof Client.prototype?.launchDaemon !== "function"
) {
  reject();
}

Object.defineProperty(Client.prototype, "launchDaemon", {
  configurable: false,
  enumerable: false,
  writable: false,
  value(options, callback) {
    const done = typeof options === "function" ? options : callback;
    const error = new Error(
      "[FAIL] PM2 daemon auto-start is forbidden; an existing verified daemon is required"
    );
    if (typeof done === "function") {
      process.nextTick(() => done(error));
      return false;
    }
    throw error;
  },
});

delete process.env.STARGAZE_PM2_PACKAGE_ROOT;
