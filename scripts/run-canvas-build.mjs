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
    else throw new Error("unsupported build argument");
    index += 1;
  }
  if (!options.root || !options.envFile) {
    throw new Error("incomplete build arguments");
  }
  return {
    root: resolve(options.root),
    envFile: resolve(options.envFile),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const exactEnvironment = readExactReleaseEnvironment(
    options.root,
    options.envFile
  );
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

  const child = spawn(process.execPath, [nextCli, "build"], {
    cwd: exactEnvironment.root,
    env: exactProcessEnvironment(exactEnvironment.values, {
      NODE_ENV: "production",
    }),
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

main().catch(() => {
  console.error("[Canvas build] Exact-environment production build failed.");
  process.exit(1);
});
