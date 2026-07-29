#!/usr/bin/env node

import {
  lstatSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  installExactProcessEnvironment,
  readExactReleaseEnvironment,
} from "./canvas-exact-env.mjs";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("missing bootstrap argument");
    }
    if (argument === "--root") options.root = value;
    else if (argument === "--env-file") options.envFile = value;
    else if (argument === "--port") options.port = value;
    else throw new Error("unsupported bootstrap argument");
    index += 1;
  }
  if (!options.root || !options.envFile || !options.port) {
    throw new Error("incomplete bootstrap arguments");
  }
  if (!/^[0-9]+$/u.test(options.port)) {
    throw new Error("invalid bootstrap port");
  }
  const port = Number.parseInt(options.port, 10);
  if (port < 1024 || port > 65535) {
    throw new Error("invalid bootstrap port");
  }
  return {
    root: resolve(options.root),
    envFile: resolve(options.envFile),
    port: String(port),
  };
}

function readExactEnvironment(options) {
  const exactEnvironment = readExactReleaseEnvironment(
    options.root,
    options.envFile
  );
  const serverPath = join(exactEnvironment.root, "server.js");
  const serverEntry = lstatSync(serverPath);
  if (!serverEntry.isFile() || serverEntry.isSymbolicLink()) {
    throw new Error("untrusted production server");
  }

  return {
    serverPath,
    values: exactEnvironment.values,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const exactEnvironment = readExactEnvironment(options);
  installExactProcessEnvironment(exactEnvironment.values, {
    NODE_ENV: "production",
    PORT: options.port,
  });
  await import(pathToFileURL(exactEnvironment.serverPath).href);
}

main().catch(() => {
  console.error("[Canvas bootstrap] Refusing to start with an invalid release environment.");
  process.exit(1);
});
