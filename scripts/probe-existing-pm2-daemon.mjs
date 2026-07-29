#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  sep,
} from "node:path";
import process from "node:process";

const FIXED_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin";
const RPC_TIMEOUT_MS = 3_000;
const MAX_SMALL_FILE_BYTES = 1024 * 1024;
const MAX_TREE_ENTRIES = 100_000;
const MAX_TREE_DEPTH = 64;
const GENERIC_FAILURE =
  "[FAIL] Existing PM2 daemon identity probe failed\n";
const FORBIDDEN_DAEMON_ENVIRONMENT = new Set([
  "ALL_PROXY",
  "BASH_ENV",
  "CURL_CA_BUNDLE",
  "ENV",
  "GIT_SSL_CAINFO",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NODE_OPTIONS",
  "NO_PROXY",
  "PM2_NODE_OPTIONS",
  "PM2_DAEMON_TITLE",
  "OVER_HOME",
  "NODE_PATH",
  "REQUESTS_CA_BUNDLE",
  "SSLKEYLOGFILE",
  "LD_AUDIT",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);
const FORBIDDEN_DAEMON_ENVIRONMENT_PREFIXES = Object.freeze([
  "OPENSSL_",
  "SSL_CERT_",
]);
const EXPECTED_NODE_IPC_BOOTSTRAP_ENVIRONMENT = new Map([
  ["NODE_CHANNEL_FD", "3"],
  ["NODE_CHANNEL_SERIALIZATION_MODE", "json"],
]);
const ALLOWED_PM2_ENVIRONMENT = new Set([
  "PM2_HOME",
  "PM2_PROGRAMMATIC",
  "PM2_NO_INTERACTION",
]);

class ProbeFailure extends Error {}

function fail() {
  throw new ProbeFailure();
}

function parseArguments(argv) {
  const names = new Map([
    ["--pm2-package-root", "pm2PackageRoot"],
    ["--node-bin", "nodeBin"],
    ["--daemon-js", "daemonJs"],
    ["--pm2-home", "pm2Home"],
    ["--expected-pm2-version", "expectedPm2Version"],
    ["--expected-node-version", "expectedNodeVersion"],
    ["--mode", "mode"],
    ["--expected-token", "expectedToken"],
  ]);
  const options = {};

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    const key = names.get(name);
    if (
      !key ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--") ||
      Object.hasOwn(options, key)
    ) {
      fail();
    }
    options[key] = value;
  }

  for (const required of [
    "pm2PackageRoot",
    "nodeBin",
    "daemonJs",
    "pm2Home",
    "expectedPm2Version",
    "expectedNodeVersion",
    "mode",
  ]) {
    if (!Object.hasOwn(options, required)) fail();
  }
  if (!["token", "jlist"].includes(options.mode)) fail();
  if (
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(
      options.expectedPm2Version
    ) ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(
      options.expectedNodeVersion
    )
  ) {
    fail();
  }
  if (
    options.expectedToken !== undefined &&
    !/^[1-9][0-9]*:[0-9]+:[1-9][0-9]*:[1-9][0-9]*$/u.test(
      options.expectedToken
    )
  ) {
    fail();
  }
  return options;
}

function assertSafeCanonicalInput(value) {
  if (
    !isAbsolute(value) ||
    normalize(value) !== value ||
    /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    fail();
  }
  let canonical;
  try {
    canonical = realpathSync(value);
  } catch {
    fail();
  }
  if (canonical !== value) fail();
  return canonical;
}

function assertRootOwned(entry) {
  if (
    entry.uid !== 0 ||
    entry.gid !== 0 ||
    (!entry.isSymbolicLink() && (entry.mode & 0o022) !== 0)
  ) {
    fail();
  }
}

function assertTrustedPath(path, leafType) {
  const canonical = assertSafeCanonicalInput(path);
  const components = canonical.split(sep).filter(Boolean);
  let current = sep;

  const root = lstatSync(current);
  if (!root.isDirectory() || root.isSymbolicLink()) fail();
  assertRootOwned(root);

  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]);
    let entry;
    try {
      entry = lstatSync(current);
    } catch {
      fail();
    }
    if (entry.isSymbolicLink()) fail();
    assertRootOwned(entry);
    const isLeaf = index === components.length - 1;
    if (!isLeaf && !entry.isDirectory()) fail();
    if (
      isLeaf &&
      ((leafType === "directory" && !entry.isDirectory()) ||
        (leafType === "file" && !entry.isFile()) ||
        (leafType === "socket" && !entry.isSocket()))
    ) {
      fail();
    }
  }
  return canonical;
}

function containedBy(root, target) {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

function assertTrustedTree(root) {
  let entriesSeen = 0;
  const pending = [{ directory: root, depth: 0 }];

  while (pending.length > 0) {
    const { directory, depth } = pending.pop();
    if (depth > MAX_TREE_DEPTH) fail();
    const before = lstatSync(directory);
    if (!before.isDirectory() || before.isSymbolicLink()) fail();
    assertRootOwned(before);

    let names;
    try {
      names = readdirSync(directory);
    } catch {
      fail();
    }
    for (const name of names) {
      entriesSeen += 1;
      if (entriesSeen > MAX_TREE_ENTRIES) fail();
      const entryPath = join(directory, name);
      let entry;
      try {
        entry = lstatSync(entryPath);
      } catch {
        fail();
      }
      assertRootOwned(entry);
      if (entry.isDirectory()) {
        pending.push({ directory: entryPath, depth: depth + 1 });
      } else if (entry.isFile()) {
        continue;
      } else if (entry.isSymbolicLink()) {
        let target;
        try {
          target = realpathSync(entryPath);
        } catch {
          fail();
        }
        if (!containedBy(root, target)) fail();
        const targetEntry = lstatSync(target);
        if (
          targetEntry.isSymbolicLink() ||
          (!targetEntry.isDirectory() && !targetEntry.isFile())
        ) {
          fail();
        }
        assertRootOwned(targetEntry);
      } else {
        fail();
      }
    }

    const after = lstatSync(directory);
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.uid !== after.uid ||
      before.gid !== after.gid ||
      before.mode !== after.mode ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      fail();
    }
  }
}

function sameEntry(first, second) {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.uid === second.uid &&
    first.gid === second.gid &&
    first.mode === second.mode &&
    first.nlink === second.nlink &&
    first.size === second.size
  );
}

function readSecureRegularFile(path, maximumBytes, exactMode) {
  let descriptor;
  try {
    const before = lstatSync(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.uid !== 0 ||
      before.gid !== 0 ||
      before.nlink !== 1 ||
      before.size < 1 ||
      before.size > maximumBytes ||
      (exactMode === undefined
        ? (before.mode & 0o022) !== 0
        : (before.mode & 0o777) !== exactMode)
    ) {
      fail();
    }
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameEntry(before, opened)) fail();
    const contents = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const pathAfter = lstatSync(path);
    if (
      contents.byteLength !== opened.size ||
      !sameEntry(opened, after) ||
      !sameEntry(opened, pathAfter) ||
      pathAfter.isSymbolicLink()
    ) {
      fail();
    }
    return { contents, entry: opened };
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    fail();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateInstallation(options) {
  const pm2PackageRoot = assertTrustedPath(
    options.pm2PackageRoot,
    "directory"
  );
  const nodeBin = assertTrustedPath(options.nodeBin, "file");
  const daemonJs = assertTrustedPath(options.daemonJs, "file");
  const pm2Home = assertTrustedPath(options.pm2Home, "directory");

  if (
    daemonJs !== join(pm2PackageRoot, "lib", "Daemon.js") ||
    dirname(join(pm2Home, "pm2.pid")) !== pm2Home
  ) {
    fail();
  }
  const nodeEntry = lstatSync(nodeBin);
  const homeEntry = lstatSync(pm2Home);
  if (
    (nodeEntry.mode & 0o111) === 0 ||
    (homeEntry.mode & 0o777) !== 0o700
  ) {
    fail();
  }

  assertTrustedTree(pm2PackageRoot);
  const packageFile = join(pm2PackageRoot, "package.json");
  assertTrustedPath(packageFile, "file");
  let packageDocument;
  try {
    packageDocument = JSON.parse(
      readSecureRegularFile(
        packageFile,
        MAX_SMALL_FILE_BYTES
      ).contents.toString("utf8")
    );
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    fail();
  }
  if (
    packageDocument === null ||
    typeof packageDocument !== "object" ||
    Array.isArray(packageDocument) ||
    packageDocument.name !== "pm2" ||
    packageDocument.version !== options.expectedPm2Version
  ) {
    fail();
  }

  const axonRoot = join(pm2PackageRoot, "node_modules", "pm2-axon");
  const rpcRoot = join(pm2PackageRoot, "node_modules", "pm2-axon-rpc");
  assertTrustedPath(axonRoot, "directory");
  assertTrustedPath(rpcRoot, "directory");

  let selfExecutable;
  try {
    selfExecutable = realpathSync("/proc/self/exe");
  } catch {
    fail();
  }
  if (
    selfExecutable !== nodeBin ||
    realpathSync(process.execPath) !== nodeBin ||
    process.versions.node !== options.expectedNodeVersion
  ) {
    fail();
  }
  return {
    ...options,
    pm2PackageRoot,
    nodeBin,
    daemonJs,
    pm2Home,
    axonRoot,
    rpcRoot,
    pidFile: join(pm2Home, "pm2.pid"),
    rpcSocket: join(pm2Home, "rpc.sock"),
    pubSocket: join(pm2Home, "pub.sock"),
  };
}

function readPidFile(path) {
  const { contents, entry } = readSecureRegularFile(path, 32, 0o600);
  const value = contents.toString("ascii");
  if (!/^[1-9][0-9]*$/u.test(value)) fail();
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 1) fail();
  return { pid, value, entry };
}

function readProcessStartTicks(pid) {
  let raw;
  try {
    raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    fail();
  }
  if (raw.length < 5 || raw.length > 64 * 1024) fail();
  const closingParenthesis = raw.lastIndexOf(")");
  if (closingParenthesis < 2) fail();
  const fields = raw.slice(closingParenthesis + 1).trim().split(/\s+/u);
  if (
    fields.length < 20 ||
    ["Z", "X", "x"].includes(fields[0]) ||
    !/^[0-9]+$/u.test(fields[19])
  ) {
    fail();
  }
  return fields[19];
}

function readNullSeparated(path, maximumBytes) {
  let contents;
  try {
    contents = readFileSync(path);
  } catch {
    fail();
  }
  if (
    contents.byteLength < 1 ||
    contents.byteLength > maximumBytes ||
    contents[contents.byteLength - 1] !== 0
  ) {
    fail();
  }
  const values = contents.toString("utf8").split("\0");
  if (values.pop() !== "") fail();
  return values;
}

function parseEnvironment(values) {
  const environment = Object.create(null);
  for (const entry of values) {
    const separator = entry.indexOf("=");
    if (separator <= 0) fail();
    const key = entry.slice(0, separator);
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ||
      Object.hasOwn(environment, key)
    ) {
      fail();
    }
    environment[key] = entry.slice(separator + 1);
  }
  return environment;
}

function validateDaemonEnvironment(
  environment,
  pm2Home,
  expectIpcBootstrap
) {
  if (
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    fail();
  }
  const expected = {
    PATH: FIXED_PATH,
    HOME: "/root",
    USER: "root",
    LOGNAME: "root",
    LANG: "C.UTF-8",
    PM2_HOME: pm2Home,
    PM2_PROGRAMMATIC: "true",
    PM2_NO_INTERACTION: "true",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (
      !Object.hasOwn(environment, key) ||
      environment[key] !== value
    ) {
      fail();
    }
  }
  for (const [key, value] of EXPECTED_NODE_IPC_BOOTSTRAP_ENVIRONMENT) {
    if (
      expectIpcBootstrap
        ? environment[key] !== value
        : Object.hasOwn(environment, key)
    ) {
      fail();
    }
  }
  for (const key of Object.keys(environment)) {
    if (
      (key.startsWith("NODE_") &&
        !EXPECTED_NODE_IPC_BOOTSTRAP_ENVIRONMENT.has(key)) ||
      FORBIDDEN_DAEMON_ENVIRONMENT.has(key) ||
      FORBIDDEN_DAEMON_ENVIRONMENT_PREFIXES.some((prefix) =>
        key.startsWith(prefix)
      ) ||
      (key.startsWith("PM2_") && !ALLOWED_PM2_ENVIRONMENT.has(key))
    ) {
      fail();
    }
  }
}

function verifyProcessIdentity(pid, installation) {
  let processEntry;
  let status;
  let executable;
  try {
    processEntry = statSync(`/proc/${pid}`);
    status = readFileSync(`/proc/${pid}/status`, "utf8");
    executable = realpathSync(`/proc/${pid}/exe`);
  } catch {
    fail();
  }
  if (
    !processEntry.isDirectory() ||
    processEntry.uid !== 0 ||
    processEntry.gid !== 0 ||
    status.length > 1024 * 1024 ||
    executable !== installation.nodeBin
  ) {
    fail();
  }

  const uid = status.match(
    /^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*$/mu
  );
  const gid = status.match(
    /^Gid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*$/mu
  );
  if (
    !uid ||
    !gid ||
    uid.slice(1).some((value) => value !== "0") ||
    gid.slice(1).some((value) => value !== "0")
  ) {
    fail();
  }

  const cmdline = readNullSeparated(`/proc/${pid}/cmdline`, 64 * 1024);
  const expectedTitle =
    `PM2 v${installation.expectedPm2Version}: God Daemon ` +
    `(${installation.pm2Home})`;
  if (
    cmdline[0] !== expectedTitle ||
    cmdline.slice(1).some((value) => value !== "")
  ) {
    fail();
  }

  const environment = parseEnvironment(
    readNullSeparated(`/proc/${pid}/environ`, MAX_SMALL_FILE_BYTES)
  );
  validateDaemonEnvironment(environment, installation.pm2Home, true);
  return readProcessStartTicks(pid);
}

function readSocket(path) {
  assertTrustedPath(path, "socket");
  const entry = lstatSync(path);
  if (
    !entry.isSocket() ||
    entry.isSymbolicLink() ||
    entry.uid !== 0 ||
    entry.gid !== 0 ||
    entry.nlink !== 1 ||
    (entry.mode & 0o777) !== 0o775
  ) {
    fail();
  }
  return entry;
}

function readKernelSocketInodes(rpcSocket, pubSocket) {
  let contents;
  try {
    contents = readFileSync("/proc/net/unix", "utf8");
  } catch {
    fail();
  }
  if (contents.length < 1 || contents.length > 16 * 1024 * 1024) fail();

  const matches = new Map([
    [rpcSocket, []],
    [pubSocket, []],
  ]);
  for (const line of contents.split("\n").slice(1)) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/u);
    if (fields.length !== 8 || !matches.has(fields[7])) continue;
    if (
      fields[4] !== "0001" ||
      fields[5] !== "01" ||
      !/^[1-9][0-9]*$/u.test(fields[6])
    ) {
      fail();
    }
    matches.get(fields[7]).push(fields[6]);
  }
  const rpcMatches = matches.get(rpcSocket);
  const pubMatches = matches.get(pubSocket);
  if (
    rpcMatches.length !== 1 ||
    pubMatches.length !== 1 ||
    rpcMatches[0] === pubMatches[0]
  ) {
    fail();
  }
  return { rpc: rpcMatches[0], pub: pubMatches[0] };
}

function verifyDaemonOwnsSockets(pid, socketInodes) {
  let descriptors;
  try {
    descriptors = readdirSync(`/proc/${pid}/fd`);
  } catch {
    fail();
  }
  const wanted = new Set([
    `socket:[${socketInodes.rpc}]`,
    `socket:[${socketInodes.pub}]`,
  ]);
  const found = new Set();
  for (const descriptor of descriptors) {
    if (!/^[0-9]+$/u.test(descriptor)) continue;
    let target;
    try {
      target = readlinkSync(`/proc/${pid}/fd/${descriptor}`);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      fail();
    }
    if (wanted.has(target)) found.add(target);
  }
  if (found.size !== wanted.size) fail();
}

function entryFingerprint(entry) {
  return [
    entry.dev,
    entry.ino,
    entry.uid,
    entry.gid,
    entry.mode,
    entry.nlink,
  ].join(":");
}

function takeSnapshot(installation) {
  const firstPid = readPidFile(installation.pidFile);
  const firstStartTicks = verifyProcessIdentity(
    firstPid.pid,
    installation
  );
  const firstRpcSocket = readSocket(installation.rpcSocket);
  const firstPubSocket = readSocket(installation.pubSocket);
  const firstKernelInodes = readKernelSocketInodes(
    installation.rpcSocket,
    installation.pubSocket
  );
  verifyDaemonOwnsSockets(firstPid.pid, firstKernelInodes);

  const secondPid = readPidFile(installation.pidFile);
  const secondStartTicks = readProcessStartTicks(secondPid.pid);
  const secondRpcSocket = readSocket(installation.rpcSocket);
  const secondPubSocket = readSocket(installation.pubSocket);
  const secondKernelInodes = readKernelSocketInodes(
    installation.rpcSocket,
    installation.pubSocket
  );
  verifyDaemonOwnsSockets(secondPid.pid, secondKernelInodes);

  if (
    firstPid.value !== secondPid.value ||
    !sameEntry(firstPid.entry, secondPid.entry) ||
    firstStartTicks !== secondStartTicks ||
    entryFingerprint(firstRpcSocket) !== entryFingerprint(secondRpcSocket) ||
    entryFingerprint(firstPubSocket) !== entryFingerprint(secondPubSocket) ||
    firstKernelInodes.rpc !== secondKernelInodes.rpc ||
    firstKernelInodes.pub !== secondKernelInodes.pub
  ) {
    fail();
  }
  const token = [
    firstPid.value,
    firstStartTicks,
    firstKernelInodes.rpc,
    firstKernelInodes.pub,
  ].join(":");
  const fingerprint = [
    token,
    entryFingerprint(firstPid.entry),
    entryFingerprint(firstRpcSocket),
    entryFingerprint(firstPubSocket),
  ].join(":");
  return { token, fingerprint };
}

function loadRpcModules(installation) {
  const requireFromProbe = createRequire(import.meta.url);
  const cacheBefore = new Set(Object.keys(requireFromProbe.cache));
  let axonEntry;
  let rpcEntry;
  try {
    axonEntry = requireFromProbe.resolve(installation.axonRoot);
    rpcEntry = requireFromProbe.resolve(installation.rpcRoot);
  } catch {
    fail();
  }
  axonEntry = assertTrustedPath(realpathSync(axonEntry), "file");
  rpcEntry = assertTrustedPath(realpathSync(rpcEntry), "file");
  if (
    !containedBy(installation.axonRoot, axonEntry) ||
    !containedBy(installation.rpcRoot, rpcEntry)
  ) {
    fail();
  }

  let axon;
  let Rpc;
  try {
    axon = requireFromProbe(axonEntry);
    Rpc = requireFromProbe(rpcEntry);
  } catch {
    fail();
  }
  for (const loadedPath of Object.keys(requireFromProbe.cache)) {
    if (cacheBefore.has(loadedPath)) continue;
    let canonicalLoadedPath;
    try {
      canonicalLoadedPath = realpathSync(loadedPath);
    } catch {
      fail();
    }
    if (
      !containedBy(installation.pm2PackageRoot, canonicalLoadedPath)
    ) {
      fail();
    }
    assertTrustedPath(canonicalLoadedPath, "file");
  }
  if (
    axon === null ||
    typeof axon !== "object" ||
    typeof axon.socket !== "function" ||
    Rpc === null ||
    typeof Rpc !== "object" ||
    typeof Rpc.Client !== "function"
  ) {
    fail();
  }
  return { axon, Rpc };
}

function rpcCall(client, method) {
  return new Promise((resolvePromise, rejectPromise) => {
    try {
      client.call(method, {}, (error, value) => {
        if (error) rejectPromise(new ProbeFailure());
        else resolvePromise(value);
      });
    } catch {
      rejectPromise(new ProbeFailure());
    }
  });
}

function validateRpcReport(version, report, monitorData, installation) {
  if (
    version !== installation.expectedPm2Version ||
    report === null ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.pm2_version !== installation.expectedPm2Version ||
    report.node_version !== installation.expectedNodeVersion ||
    report.uid !== 0 ||
    report.gid !== 0 ||
    report.argv0 !== installation.nodeBin ||
    !Array.isArray(report.argv) ||
    report.argv.length !== 2 ||
    report.argv[0] !== installation.nodeBin ||
    report.argv[1] !== installation.daemonJs ||
    !Array.isArray(monitorData)
  ) {
    fail();
  }
  validateDaemonEnvironment(report.env, installation.pm2Home, false);
}

async function readExistingDaemonRpc(installation) {
  const { axon, Rpc } = loadRpcModules(installation);
  let requestSocket;
  let timer;

  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const settle = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          requestSocket?.close();
        } catch {}
        if (error) rejectPromise(new ProbeFailure());
        else resolvePromise(value);
      };

      try {
        requestSocket = axon.socket("req");
        const client = new Rpc.Client(requestSocket);
        requestSocket.on("error", () => settle(true));
        requestSocket.on("reconnect attempt", () => settle(true));
        requestSocket.once("connect", async () => {
          try {
            const version = await rpcCall(client, "getVersion");
            const report = await rpcCall(client, "getReport");
            const monitorData = await rpcCall(client, "getMonitorData");
            validateRpcReport(
              version,
              report,
              monitorData,
              installation
            );
            settle(false, monitorData);
          } catch {
            settle(true);
          }
        });
        timer = setTimeout(() => settle(true), RPC_TIMEOUT_MS);
        requestSocket.connect(installation.rpcSocket);
      } catch {
        settle(true);
      }
    });
  } catch {
    fail();
  } finally {
    clearTimeout(timer);
    try {
      requestSocket?.close();
    } catch {}
  }
}

async function main() {
  if (
    process.platform !== "linux" ||
    typeof process.getuid !== "function" ||
    typeof process.getgid !== "function" ||
    process.getuid() !== 0 ||
    process.getgid() !== 0
  ) {
    fail();
  }

  const options = parseArguments(process.argv.slice(2));
  const installation = validateInstallation(options);
  const before = takeSnapshot(installation);
  if (
    installation.expectedToken !== undefined &&
    before.token !== installation.expectedToken
  ) {
    fail();
  }

  const monitorData = await readExistingDaemonRpc(installation);
  const after = takeSnapshot(installation);
  if (
    before.token !== after.token ||
    before.fingerprint !== after.fingerprint ||
    (installation.expectedToken !== undefined &&
      after.token !== installation.expectedToken)
  ) {
    fail();
  }

  if (installation.mode === "token") {
    process.stdout.write(`${after.token}\n`);
    return;
  }
  let output;
  try {
    output = JSON.stringify(monitorData);
  } catch {
    fail();
  }
  if (typeof output !== "string") fail();
  process.stdout.write(`${output}\n`);
}

main().catch(() => {
  process.stderr.write(GENERIC_FAILURE);
  process.exitCode = 1;
});
