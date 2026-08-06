import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";

const MAX_ENV_BYTES = 1024 * 1024;
const SYSTEM_ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "PWD",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TZ",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
]);

function sameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.uid === right.uid
  );
}

function readTrustedRegularFile(pathname) {
  const before = lstatSync(pathname);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > MAX_ENV_BYTES
  ) {
    throw new Error("untrusted environment file");
  }
  if (
    typeof process.getuid === "function" &&
    process.getuid() === 0 &&
    (before.uid !== 0 || (before.mode & 0o077) !== 0)
  ) {
    throw new Error("unsafe environment permissions");
  }

  const noFollow =
    process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(pathname, constants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameFile(before, opened)) {
      throw new Error("environment file changed during validation");
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

export function readExactReleaseEnvironment(rootInput, envInput) {
  const root = resolve(rootInput);
  const envFile = resolve(envInput);
  const rootEntry = lstatSync(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    throw new Error("untrusted release root");
  }
  const canonicalRoot = realpathSync(root);
  if (canonicalRoot !== root) {
    throw new Error("non-canonical release root");
  }
  if (envFile !== join(canonicalRoot, ".env.local")) {
    throw new Error("environment path is not release-local");
  }

  return {
    root: canonicalRoot,
    envFile,
    values: Object.assign(
      Object.create(null),
      parseEnv(readTrustedRegularFile(envFile))
    ),
  };
}

export function exactProcessEnvironment(values, additions = {}) {
  const environment = Object.create(null);
  for (const name of SYSTEM_ENV_ALLOWLIST) {
    const value = process.env[name];
    if (typeof value === "string") environment[name] = value;
  }
  for (const [name, value] of Object.entries(values)) {
    environment[name] = value;
  }
  for (const [name, value] of Object.entries(additions)) {
    environment[name] = String(value);
  }
  return environment;
}

export function installExactProcessEnvironment(values, additions = {}) {
  const environment = exactProcessEnvironment(values, additions);
  for (const name of Object.keys(process.env)) {
    delete process.env[name];
  }
  for (const [name, value] of Object.entries(environment)) {
    process.env[name] = value;
  }
}
