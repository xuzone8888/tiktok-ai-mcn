#!/usr/bin/env node

import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import {
  exactProcessEnvironment,
  readExactReleaseEnvironment,
} from "./canvas-exact-env.mjs";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("missing build argument");
    }
    if (argument === "--root") options.root = value;
    else if (argument === "--env-file") options.envFile = value;
    else if (argument === "--release-commit") options.releaseCommit = value;
    else throw new Error("unsupported build argument");
    index += 1;
  }
  if (!options.root || !options.envFile) {
    throw new Error("incomplete build arguments");
  }
  if (
    options.releaseCommit !== undefined &&
    !/^[0-9a-f]{40}$/.test(options.releaseCommit)
  ) {
    throw new Error("release commit must be an exact lowercase Git commit");
  }
  return {
    root: resolve(options.root),
    envFile: resolve(options.envFile),
    releaseCommit: options.releaseCommit ?? null,
  };
}

async function runGuard(scriptPath, root) {
  const guardEntry = lstatSync(scriptPath);
  if (!guardEntry.isFile() || guardEntry.isSymbolicLink()) {
    throw new Error("untrusted duplicate-route guard entrypoint");
  }
  const guard = spawn(process.execPath, [scriptPath], {
    cwd: root,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  const guardExit = await new Promise((resolveExit, rejectExit) => {
    guard.once("error", rejectExit);
    guard.once("exit", (code, signal) => {
      if (signal) rejectExit(new Error("duplicate-route guard terminated by signal"));
      else resolveExit(code ?? 1);
    });
  });
  if (guardExit !== 0) {
    throw new Error("duplicate App Router routes detected");
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const exactEnvironment = readExactReleaseEnvironment(
    options.root,
    options.envFile
  );
  if (Object.hasOwn(exactEnvironment.values, "CANVAS_RELEASE_COMMIT")) {
    throw new Error(
      "CANVAS_RELEASE_COMMIT is controller-only and must not be stored in .env.local"
    );
  }
  const nextCli = join(
    exactEnvironment.root,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next"
  );
  const nextEntry = lstatSync(nextCli);
  if (!nextEntry.isFile() || nextEntry.isSymbolicLink()) {
    throw new Error("untrusted Next.js build entrypoint");
  }

  // Guard: two page files normalizing to the same URL build "successfully" but
  // leave one entry without a client-reference-manifest, which makes that route
  // throw "Cannot read properties of undefined (reading 'clientModules')" at
  // render time. Abort before the build so it never reaches a release directory.
  await runGuard(
    join(exactEnvironment.root, "scripts", "check-duplicate-app-routes.mjs"),
    exactEnvironment.root
  );

  // Only the release controller may opt in to a commit-bound BUILD_ID.
  const additions = { NODE_ENV: "production" };
  if (options.releaseCommit !== null) {
    additions.CANVAS_RELEASE_COMMIT = options.releaseCommit;
  }

  const child = spawn(process.execPath, [nextCli, "build"], {
    cwd: exactEnvironment.root,
    env: exactProcessEnvironment(exactEnvironment.values, additions),
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });

  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectExit(new Error("build process terminated by signal"));
      } else {
        resolveExit(code ?? 1);
      }
    });
  });
  if (exitCode !== 0) {
    throw new Error("Next.js production build failed");
  }
}

main().catch((error) => {
  const reason =
    error instanceof Error ? error.message : "unknown controlled build failure";
  console.error(`[Canvas build] Exact-environment production build failed: ${reason}`);
  process.exit(1);
});
