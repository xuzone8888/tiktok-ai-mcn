#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

function occurrences(source, token) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(token, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + token.length;
  }
}

function includesInOrder(source, tokens) {
  let offset = 0;
  for (const token of tokens) {
    const index = source.indexOf(token, offset);
    if (index < 0) return false;
    offset = index + token.length;
  }
  return true;
}

function bashFunction(source, name) {
  const marker = `${name}() {`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const remainder = source.slice(start + marker.length);
  const nextFunction = remainder.match(
    /\n(?=[A-Za-z_][A-Za-z0-9_]*\(\) \{)/u
  );
  const end =
    nextFunction === null
      ? source.length
      : start + marker.length + nextFunction.index;
  return source.slice(start, end);
}

function counterexample(source, token, replacement = "# verifier counterexample") {
  assert(
    occurrences(source, token) === 1,
    `counterexample token must occur exactly once: ${token}`
  );
  return source.replace(token, replacement);
}

function hasTrustedRootChainResolver(source) {
  const chain = bashFunction(source, "trusted_root_path_chain");
  const resolver = bashFunction(source, "resolve_trusted_root_executable");
  return (
    includesInOrder(chain, [
      '[[ "${current}" == /* ]] || return 1',
      '[[ -e "${current}" && ! -L "${current}" ]] || return 1',
      '"${STAT_BIN}" -c \'%u\'',
      '[[ "${uid}" == "0" ]]',
      '"${STAT_BIN}" -c \'%a\'',
      "(8#${mode} & 022) == 0",
      '[[ "${current}" == "/" ]] && break',
      'current="$("${DIRNAME_BIN}" -- "${current}")"',
    ]) &&
    includesInOrder(resolver, [
      'command_path="$(command -v "${command_name}")"',
      '[[ "${command_path}" == /* ]]',
      'command_parent="$(',
      '"${REALPATH_BIN}" -e',
      'trusted_root_path_chain "${command_parent}"',
      '[[ "$("${STAT_BIN}" -c \'%u\' -- "${command_path}")" == "0" ]]',
      'resolved="$("${REALPATH_BIN}" -e -- "${command_path}")"',
      '[[ "${resolved}" == /* && -f "${resolved}" && ! -L "${resolved}" && -x "${resolved}" ]]',
      'trusted_root_path_chain "${resolved}"',
    ])
  );
}

function hasPrivilegedBootstrap(source) {
  const preamble = source.slice(0, source.indexOf("usage() {"));
  const pin = bashFunction(source, "pin_trusted_command");
  const helperNames = [
    ...preamble.matchAll(/^readonly ([A-Z][A-Z0-9_]*_BIN)=/gmu),
  ].map((match) => match[1]);
  const helperLoopStart = preamble.indexOf("for helper in \\");
  const helperLoopEnd = preamble.indexOf("; do", helperLoopStart);
  const helperLoop =
    helperLoopStart >= 0 && helperLoopEnd > helperLoopStart
      ? preamble.slice(helperLoopStart, helperLoopEnd)
      : "";
  const unsetStart = preamble.indexOf("unset ");
  const unsetEnd = preamble.indexOf("\ndeclare -rx ", unsetStart);
  const unsetBlock =
    unsetStart >= 0 && unsetEnd > unsetStart
      ? preamble.slice(unsetStart, unsetEnd).replaceAll("\\\n", " ")
      : "";
  const scrubbedVariables = [
    "BASH_ENV",
    "ENV",
    "CDPATH",
    "GLOBIGNORE",
    "HOME",
    "LANG",
    "LD_AUDIT",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "LOGNAME",
    "NODE_EXTRA_CA_CERTS",
    "NODE_ICU_DATA",
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_REPL_EXTERNAL_MODULE",
    "OPENSSL_CONF",
    "PM2_HOME",
    "PM2_NODE_OPTIONS",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "USER",
  ];
  const emptyPoisonVariables = scrubbedVariables.filter(
    (name) =>
      !["CDPATH", "GLOBIGNORE", "HOME", "LANG", "LOGNAME", "PM2_HOME", "USER"].includes(
        name
      )
  );
  return (
    source.startsWith("#!/bin/bash -p\n") &&
    includesInOrder(preamble, [
      "set -Eeuo pipefail",
      'case "$-" in',
      "*p*) ;;",
      'declare -rx PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"',
      'readonly STAT_BIN="/usr/bin/stat"',
      'readonly DIRNAME_BIN="/usr/bin/dirname"',
      'readonly REALPATH_BIN="/usr/bin/realpath"',
      'readonly ENV_BIN="/usr/bin/env"',
      'readonly FLOCK_BIN="/usr/bin/flock"',
      'readonly READLINK_BIN="/usr/bin/readlink"',
      '[[ -f "${helper}" && ! -L "${helper}" && -x "${helper}" ]]',
      'declare -rx BASH_ENV=""',
      'declare -rx ENV=""',
      'declare -rx HOME="/root"',
      'declare -rx NODE_OPTIONS=""',
      'declare -rx PM2_HOME="/root/.pm2"',
      'declare -rx PM2_NODE_OPTIONS=""',
    ]) &&
    helperNames.length >= 6 &&
    helperNames.every(
      (name) =>
        new RegExp(
          `^readonly ${name}="/usr/(?:local/)?(?:s?bin|bin)/[^"]+"$`,
          "mu"
        ).test(preamble) && helperLoop.includes(`"\${${name}}"`)
    ) &&
    scrubbedVariables.every((name) =>
      new RegExp(`(?:^|\\s)${name}(?:\\s|$)`, "u").test(unsetBlock)
    ) &&
    emptyPoisonVariables.every((name) =>
      preamble.includes(`declare -rx ${name}=""`)
    ) &&
    includesInOrder(pin, [
      'resolved="$(resolve_trusted_root_executable "${command_name}")"',
      'hash -p "${resolved}" "${command_name}"',
    ]) &&
    !/(^|\n)[ \t]*env[ \t]+-i\b/u.test(source) &&
    !/(^|\n)[ \t]*dirname[ \t]+--/u.test(source)
  );
}

function hasPinnedMutableCommands(source) {
  const expected =
    source.includes("canvas-blue-green.sh [plan|deploy|rollback]")
      ? [
          "grep",
          "sed",
          "head",
          "tail",
          "sleep",
          "mktemp",
          "cp",
          "mv",
          "chmod",
          "chown",
          "mkdir",
          "date",
          "rm",
        ]
      : [
          "cp",
          "mv",
          "chmod",
          "chown",
          "mkdir",
          "mktemp",
          "rm",
          "date",
          "tail",
          "sleep",
        ];
  const pinCall = 'pin_trusted_command "${command}"';
  const pinCallIndex = source.indexOf(pinCall);
  if (pinCallIndex < 0) return false;
  const loopStart = source.lastIndexOf("for command in ", pinCallIndex);
  const loopHeaderEnd = source.indexOf("; do", loopStart);
  if (loopStart < 0 || loopHeaderEnd < 0) return false;
  const names = source
    .slice(loopStart + "for command in ".length, loopHeaderEnd)
    .trim()
    .split(/\s+/u);
  return (
    names.length === expected.length &&
    expected.every((name, index) => names[index] === name) &&
    pinCallIndex < source.indexOf('NODE_VERSION="$("${NODE_BIN}"')
  );
}

function hasTrustedDirectoryContract(source) {
  const directory = bashFunction(source, "prepare_trusted_root_directory");
  return (
    includesInOrder(directory, [
      '[[ "${directory}" == /* && "${directory}" != "/" ]]',
      '[[ "${directory}" =~ ^/[A-Za-z0-9_./-]+$ ]]',
      'if [[ -e "${directory}" || -L "${directory}" ]]',
      '[[ -d "${directory}" && ! -L "${directory}" ]]',
      '"${REALPATH_BIN}" -e -- "${directory}")" == "${directory}"',
      'trusted_root_path_chain "${directory}"',
      '"${STAT_BIN}" -c \'%a\' -- "${directory}")" == "${normalized_mode}"',
      'parent="$("${DIRNAME_BIN}" -- "${directory}")"',
      '[[ -d "${parent}" && ! -L "${parent}" ]]',
      '"${REALPATH_BIN}" -e -- "${parent}")" == "${parent}"',
      '"${REALPATH_BIN}" -m -- "${directory}")" == "${directory}"',
      'trusted_root_path_chain "${parent}"',
      'mkdir --mode="${expected_mode}" -- "${directory}"',
      'trusted_root_path_chain "${directory}"',
    ]) &&
    !directory.includes("mkdir -p")
  );
}

function hasTrustedReleaseTreeContract(source) {
  const tree = bashFunction(source, "trusted_root_release_tree");
  return includesInOrder(tree, [
    'const { lstatSync, readdirSync, realpathSync }',
    "const root = realpathSync(requested)",
    "if (root !== requested) process.exit(1)",
    "const visited = new Set()",
    "if (entry.isSymbolicLink())",
    "if (entry.uid !== 0) process.exit(1)",
    "const target = realpathSync(current)",
    "if (target !== root && !target.startsWith(prefix)) process.exit(1)",
    "if (visited.has(identity)) continue",
    "if (entry.uid !== 0 || (entry.mode & 0o022) !== 0) process.exit(1)",
    "if (entry.isDirectory())",
    "} else if (!entry.isFile())",
    "process.exit(1)",
  ]);
}

function hasPm2AccessDiscipline(source) {
  const existingJlist = bashFunction(source, "pm2_existing_jlist");
  const trusted = bashFunction(source, "run_trusted_pm2");
  const clean = bashFunction(source, "run_pm2_with_clean_environment");
  const nakedPm2Call =
    /(^|\n)[ \t]*pm2[ \t]+(?:-v|jlist|save|stop|delete|startOrReload)\b/u;
  const unsafeJlistLine = source
    .split(/\r?\n/u)
    .filter((line) => /\bjlist\b/u.test(line))
    .some(
      (line) =>
        !line.includes("pm2_existing_jlist") &&
        !line.includes("probe_existing_pm2_daemon jlist")
    );
  return (
    source.includes('PM2_BIN="$(resolve_trusted_root_executable pm2)"') &&
    includesInOrder(existingJlist, [
      '[[ -n "${PM2_DAEMON_TOKEN}" ]] || return 1',
      'probe_existing_pm2_daemon jlist "${PM2_DAEMON_TOKEN}"',
    ]) &&
    includesInOrder(trusted, [
      '[[ -n "${PM2_DAEMON_TOKEN}" ]] || return 1',
      'probe_existing_pm2_daemon token "${PM2_DAEMON_TOKEN}"',
      '[[ "${before_token}" == "${PM2_DAEMON_TOKEN}" ]]',
      "run_pm2_with_clean_environment",
      '"${NODE_BIN}" --require "${PM2_NO_AUTOSTART_GUARD}" --',
      '"${PM2_BIN}" "$@"',
      'probe_existing_pm2_daemon token "${before_token}"',
      '[[ "${after_token}" == "${before_token}" ]]',
      'return "${command_status}"',
    ]) &&
    includesInOrder(clean, [
      '"${ENV_BIN}" -i',
      '"PM2_HOME=${PM2_HOME}"',
      '"STARGAZE_PM2_PACKAGE_ROOT=${PM2_PACKAGE_ROOT}"',
    ]) &&
    occurrences(source, "run_pm2_with_clean_environment") === 2 &&
    occurrences(source, '"${PM2_BIN}"') === 2 &&
    source.includes("read_trusted_pm2_version") &&
    !source.includes("run_trusted_pm2 -v") &&
    !source.includes("run_trusted_pm2 jlist") &&
    !source.includes("run_pm2_with_clean_environment jlist") &&
    !/run_pm2_with_clean_environment[^\n]*(?:startOrReload|delete|save|stop)\b/u.test(
      source
    ) &&
    !source.includes("$(command -v pm2)") &&
    !source.includes("$(pm2 ") &&
    !unsafeJlistLine &&
    !nakedPm2Call.test(source)
  );
}

function hasPm2NoAutostartIntegration(source) {
  const trusted = bashFunction(source, "run_trusted_pm2");
  const guardAssignment =
    source.includes(
      'PM2_NO_AUTOSTART_GUARD="${CANDIDATE_DIR}/scripts/pm2-existing-daemon-only.cjs"'
    ) ||
    source.includes(
      'PM2_NO_AUTOSTART_GUARD="${REPO_ROOT}/scripts/pm2-existing-daemon-only.cjs"'
    );
  const initialToken = source.indexOf(
    'PM2_DAEMON_TOKEN="$(probe_existing_pm2_daemon token)"'
  );
  const guardCheck = source.indexOf(
    '"${NODE_BIN}" --check "${PM2_NO_AUTOSTART_GUARD}"'
  );
  const trustedGuardFile =
    source.includes(
      '[[ -f "${PM2_NO_AUTOSTART_GUARD}" && ! -L "${PM2_NO_AUTOSTART_GUARD}" ]]'
    ) ||
    source.includes('safe_absolute_file "${PM2_NO_AUTOSTART_GUARD}"');
  return (
    guardAssignment &&
    trustedGuardFile &&
    guardCheck >= 0 &&
    initialToken > guardCheck &&
    includesInOrder(trusted, [
      'probe_existing_pm2_daemon token "${PM2_DAEMON_TOKEN}"',
      'run_pm2_with_clean_environment',
      '"${NODE_BIN}" --require "${PM2_NO_AUTOSTART_GUARD}" --',
      '"${PM2_BIN}" "$@"',
      'probe_existing_pm2_daemon token "${before_token}"',
    ]) &&
    occurrences(source, '"${PM2_BIN}" "$@"') === 1
  );
}

function hasHardenedCurlProbe(source) {
  const pageProbe = bashFunction(source, "page_is_healthy");
  return includesInOrder(pageProbe, [
    '"${ENV_BIN}" -i',
    '"PATH=${PATH}"',
    '"HOME=${HOME}"',
    '"USER=${USER}"',
    '"LOGNAME=${LOGNAME}"',
    '"LANG=${LANG}"',
    '"${CURL_BIN}" --disable --noproxy \'*\'',
    "--silent --show-error --output /dev/null",
    "--connect-timeout 3 --max-time 10",
    "--write-out '%{http_code}'",
    '[[ "${code}" == "200" ]]',
  ]);
}

function hasDeployLockContract(source) {
  const lock = bashFunction(source, "acquire_deploy_lock");
  return (
    source.includes(
      'readonly DEPLOY_LOCK_FILE="/run/stargaze-canvas/deploy.lock"'
    ) &&
    includesInOrder(lock, [
      'lock_parent="$("${DIRNAME_BIN}" -- "${DEPLOY_LOCK_FILE}")"',
      'prepare_trusted_root_directory "${lock_parent}" 0700',
      'if [[ -n "${inherited_fd}" ]]',
      '[[ "${inherited_fd}" =~ ^[1-9][0-9]*$ ]]',
      'fd_path="/proc/self/fd/${inherited_fd}"',
      '[[ -f "${fd_path}" ]]',
      '"${READLINK_BIN}" -f -- "${fd_path}"',
      '[[ "${resolved_fd_path}" == "${DEPLOY_LOCK_FILE}" ]]',
      '"${STAT_BIN}" -Lc \'%d:%i:%u:%g:%a:%h\' -- "${DEPLOY_LOCK_FILE}"',
      '"${STAT_BIN}" -Lc \'%d:%i:%u:%g:%a:%h\' -- "${fd_path}"',
      '[[ "${fd_metadata}" == "${lock_metadata}" ]]',
      '"${FLOCK_BIN}" --exclusive --nonblock "${inherited_fd}"',
      '[[ -f "${DEPLOY_LOCK_FILE}" && ! -L "${DEPLOY_LOCK_FILE}" ]]',
      '"${STAT_BIN}" -c \'%u:%g:%a:%h\' -- "${DEPLOY_LOCK_FILE}")" == "0:0:600:1"',
      'exec 9>"${DEPLOY_LOCK_FILE}"',
      'chmod 0600 -- "${DEPLOY_LOCK_FILE}"',
      'chown 0:0 -- "${DEPLOY_LOCK_FILE}"',
      '"${FLOCK_BIN}" --exclusive --nonblock "${DEPLOY_LOCK_FD}"',
      'export CANVAS_DEPLOY_LOCK_FD="${DEPLOY_LOCK_FD}"',
    ])
  );
}

function hasPm2DaemonShellContract(source) {
  const probe = bashFunction(source, "probe_existing_pm2_daemon");
  const initialToken = source.indexOf(
    'PM2_DAEMON_TOKEN="$(probe_existing_pm2_daemon token)"'
  );
  const packageTree = source.indexOf(
    'trusted_root_release_tree "${PM2_PACKAGE_ROOT}"'
  );
  const lock = source.indexOf("acquire_deploy_lock ||", packageTree);
  const pm2HomeExists = source.indexOf(
    '[[ -d "${PM2_HOME}" && ! -L "${PM2_HOME}" ]]',
    lock
  );
  const pm2Home = source.indexOf(
    'prepare_trusted_root_directory "${PM2_HOME}" 0700'
  );
  return (
    source.includes('REQUIRED_PM2_VERSION="6.0.14"') &&
    source.includes('PM2_DAEMON_JS="${PM2_PACKAGE_ROOT}/lib/Daemon.js"') &&
    source.includes(
      '[[ -f "${PM2_DAEMON_JS}" && ! -L "${PM2_DAEMON_JS}" ]]'
    ) &&
    includesInOrder(probe, [
      '--pm2-package-root "${PM2_PACKAGE_ROOT}"',
      '--node-bin "${NODE_BIN}"',
      '--daemon-js "${PM2_DAEMON_JS}"',
      '--pm2-home "${PM2_HOME}"',
      '--expected-pm2-version "${REQUIRED_PM2_VERSION}"',
      '--expected-node-version "${REQUIRED_NODE_VERSION}"',
      '--mode "${mode}"',
      'arguments+=(--expected-token "${expected_token}")',
      'run_pm2_gate_with_clean_environment',
      '"${NODE_BIN}" -- "${PM2_DAEMON_PROBE}"',
    ]) &&
    packageTree >= 0 &&
    lock > packageTree &&
    pm2HomeExists > lock &&
    pm2Home > pm2HomeExists &&
    initialToken > pm2Home &&
    source
      .slice(initialToken, initialToken + 500)
      .includes('[[ -n "${PM2_DAEMON_TOKEN}" ]]')
  );
}

function hasNodeArgumentBoundary(source) {
  return (
    source.includes("Array.isArray(entry.pm2_env?.node_args)") &&
    source.includes(
      'JSON.stringify(entry.pm2_env.node_args) === "[\\"--\\"]"'
    )
  );
}

function hasSupplyChainContract(source) {
  const npmCi = source.indexOf('"${NODE_BIN}" -- "${NPM_CLI}" ci');
  const npmBranch = source.lastIndexOf(
    "if ((RUN_BUILD == 1)); then",
    npmCi
  );
  const npmBranchEnd = source.indexOf("\nfi", npmCi);
  const supply = source.indexOf(
    '"${NODE_BIN}" -- "${SUPPLY_CHAIN_CHECK}"'
  );
  const buildBranch = source.indexOf(
    "if ((RUN_BUILD == 1)); then",
    supply
  );
  const buildRunner = source.indexOf(
    '"${NODE_BIN}" -- scripts/run-canvas-build.mjs',
    buildBranch
  );
  const buildBranchEnd = source.indexOf("\nfi", buildRunner);
  const postBuildTree = source.indexOf(
    'trusted_root_release_tree "${CANDIDATE_DIR}"',
    buildBranchEnd
  );
  const candidateStart = source.indexOf("CANDIDATE_STARTED=1");
  const npmSection = source.slice(npmBranch, npmBranchEnd);
  const unconditionalSupply = source.slice(npmBranchEnd, buildBranch);
  return (
    npmBranch >= 0 &&
    npmCi > npmBranch &&
    npmBranchEnd > npmCi &&
    supply > npmBranchEnd &&
    buildBranch > supply &&
    buildRunner > buildBranch &&
    buildBranchEnd > buildRunner &&
    postBuildTree > buildBranchEnd &&
    candidateStart > postBuildTree &&
    includesInOrder(npmSection, [
      '"${ENV_BIN}" -i',
      '"PATH=${PATH}"',
      '"HOME=${HOME}"',
      '"NPM_CONFIG_USERCONFIG=${NPM_USER_CONFIG}"',
      '"NPM_CONFIG_GLOBALCONFIG=${NPM_GLOBAL_CONFIG}"',
      '"${NODE_BIN}" -- "${NPM_CLI}" ci',
      "--include=dev",
      "--ignore-scripts",
      "--allow-remote=root",
      "--allow-git=none",
      "--allow-file=none",
      "--allow-directory=none",
    ]) &&
    includesInOrder(unconditionalSupply, [
      '"${ENV_BIN}" -i',
      '"PATH=${PATH}"',
      '"HOME=${HOME}"',
      '"NPM_CONFIG_USERCONFIG=${NPM_USER_CONFIG}"',
      '"NPM_CONFIG_GLOBALCONFIG=${NPM_GLOBAL_CONFIG}"',
      '"STARGAZE_NPM_CLI=${NPM_CLI}"',
      '"STARGAZE_GIT_BIN=${GIT_BIN}"',
      '"${NODE_BIN}" -- "${SUPPLY_CHAIN_CHECK}"',
    ]) &&
    !unconditionalSupply.includes("RUN_BUILD") &&
    source.includes('readonly NPM_USER_CONFIG="/dev/null"') &&
    source.includes(
      'readonly NPM_GLOBAL_CONFIG="/run/stargaze-canvas/npm-globalconfig-disabled"'
    ) &&
    source.includes("assert_disabled_npm_config_paths ||") &&
    source.includes('NPM_CLI="$(resolve_trusted_root_executable npm)"') &&
    source.includes('GIT_BIN="$(resolve_trusted_root_executable git)"') &&
    source.indexOf('"${NODE_BIN}" --check "${SUPPLY_CHAIN_CHECK}"') <
      npmCi &&
    source.indexOf(
      '[[ -f "${SUPPLY_CHAIN_CHECK}" && ! -L "${SUPPLY_CHAIN_CHECK}" ]]'
    ) < npmCi
  );
}

function moveSupplyVerifierIntoBuildBranch(source) {
  const npmCi = source.indexOf('"${NODE_BIN}" -- "${NPM_CLI}" ci');
  const supply = source.indexOf(
    '"${NODE_BIN}" -- "${SUPPLY_CHAIN_CHECK}"'
  );
  const blockStart = source.lastIndexOf("\n(\n", supply) + 1;
  const blockEnd = source.indexOf("\n)", supply) + 2;
  assert(
    npmCi >= 0 &&
      supply > npmCi &&
      blockStart > npmCi &&
      blockEnd > supply,
    "unable to construct the build-gated supply-chain counterexample"
  );
  const block = source.slice(blockStart, blockEnd);
  const withoutBlock =
    source.slice(0, blockStart) + source.slice(blockEnd);
  const npmBranchEnd = withoutBlock.indexOf("\nfi", npmCi);
  assert(
    npmBranchEnd > npmCi,
    "unable to locate the npm-ci branch boundary for its counterexample"
  );
  return (
    withoutBlock.slice(0, npmBranchEnd) +
    `\n${block}` +
    withoutBlock.slice(npmBranchEnd)
  );
}

function hasBlueGreenTrustedObjectIntegration(source) {
  const initialCandidateTree = source.indexOf(
    'trusted_root_release_tree "${CANDIDATE_DIR}"'
  );
  const npmCi = source.indexOf('"${NODE_BIN}" -- "${NPM_CLI}" ci');
  const postBuildTree = source.indexOf(
    'trusted_root_release_tree "${CANDIDATE_DIR}"',
    initialCandidateTree + 1
  );
  return (
    hasTrustedDirectoryContract(source) &&
    hasTrustedReleaseTreeContract(source) &&
    initialCandidateTree >= 0 &&
    initialCandidateTree < npmCi &&
    postBuildTree > npmCi &&
    includesInOrder(source, [
      '[[ -d "${CANDIDATE_DIR}" && ! -L "${CANDIDATE_DIR}" ]]',
      '"${REALPATH_BIN}" -e -- "${CANDIDATE_DIR}")" == "${CANDIDATE_DIR}"',
      'trusted_root_path_chain "${CANDIDATE_DIR}"',
      'trusted_root_release_tree "${CANDIDATE_DIR}"',
    ]) &&
    includesInOrder(source, [
      '[[ -f "${NGINX_CONFIG}" && ! -L "${NGINX_CONFIG}" ]]',
      '"${REALPATH_BIN}" -e -- "${NGINX_CONFIG}")" == "${NGINX_CONFIG}"',
      'trusted_root_path_chain "${NGINX_CONFIG}"',
    ]) &&
    source.includes(
      'prepare_trusted_root_directory "${ROLLBACK_DIR}" 0700'
    ) &&
    source.includes(
      'prepare_trusted_root_directory "${RECONCILER_INSTALL_DIR}" 0755'
    ) &&
    includesInOrder(source, [
      '[[ -d "${reconciler_lock_parent}" && ! -L "${reconciler_lock_parent}" ]]',
      '"${REALPATH_BIN}" -e -- "${reconciler_lock_parent}")" == "${reconciler_lock_parent}"',
      '"${REALPATH_BIN}" -m -- "${RECONCILER_LOCK_FILE}")" == "${RECONCILER_LOCK_FILE}"',
      'trusted_root_path_chain "${reconciler_lock_parent}"',
    ]) &&
    includesInOrder(source, [
      '[[ -f "${ENV_FILE}" && ! -L "${ENV_FILE}" ]]',
      '"${REALPATH_BIN}" -e -- "${ENV_FILE}")" == "${ENV_FILE}"',
      'trusted_root_path_chain "${ENV_FILE}"',
      "(8#${env_mode} & 077) == 0",
    ]) &&
    includesInOrder(source, [
      '[[ -f "${RECONCILER_ENV_FILE}" && ! -L "${RECONCILER_ENV_FILE}" ]]',
      '"${REALPATH_BIN}" -e -- "${RECONCILER_ENV_FILE}")" == "${RECONCILER_ENV_FILE}"',
      'trusted_root_path_chain "${RECONCILER_ENV_FILE}"',
      '"${STAT_BIN}" -c \'%a\' -- "${RECONCILER_ENV_FILE}")" == "600"',
    ])
  );
}

function hasInstallerTrustedObjectIntegration(source) {
  const safeFile = bashFunction(source, "safe_absolute_file");
  return (
    hasTrustedDirectoryContract(source) &&
    hasTrustedReleaseTreeContract(source) &&
    includesInOrder(safeFile, [
      '[[ "${candidate}" == /* && -f "${candidate}" && ! -L "${candidate}" ]]',
      '"${REALPATH_BIN}" -e -- "${candidate}")" == "${candidate}"',
      'trusted_root_path_chain "${candidate}"',
    ]) &&
    source.includes('trusted_root_release_tree "${PM2_PACKAGE_ROOT}"') &&
    source.includes('trusted_root_release_tree "${REPO_ROOT}"') &&
    source.includes('safe_absolute_file "${SOURCE_SCRIPT}"') &&
    source.includes('safe_absolute_file "${SOURCE_CONFIG}"') &&
    source.includes('safe_absolute_file "${READY_PROBE}"') &&
    source.includes('safe_absolute_file "${PM2_DAEMON_PROBE}"') &&
    source.includes('safe_absolute_file "${ENV_FILE}"') &&
    source.includes(
      '[[ "$("${STAT_BIN}" -c \'%a\' -- "${ENV_FILE}")" == "600" ]]'
    ) &&
    includesInOrder(source, [
      '[[ -d "${lock_parent}" && ! -L "${lock_parent}" ]]',
      '"${REALPATH_BIN}" -e -- "${lock_parent}")" == "${lock_parent}"',
      '"${REALPATH_BIN}" -m -- "${LOCK_FILE}")" == "${LOCK_FILE}"',
      'trusted_root_path_chain "${lock_parent}"',
    ]) &&
    source.includes(
      'prepare_trusted_root_directory "${PM2_HOME}" 0700'
    ) &&
    source.includes(
      'prepare_trusted_root_directory "${INSTALL_DIR}" 0755'
    ) &&
    [
      "INSTALLED_SCRIPT",
      "PREVIOUS_CONFIG_PATH",
      "INSTALLED_SETTINGS",
      "LEGACY_INSTALLED_CONFIG",
    ].every((name) =>
      source.includes(`trusted_root_path_chain "\${${name}}"`)
    )
  );
}

function hasTransactionContract(source) {
  const restore = bashFunction(source, "restore_system_from_bundle");
  const switchNginx = bashFunction(source, "switch_nginx_to_port");
  const onExit = bashFunction(source, "on_exit");
  const rollbackStart = source.lastIndexOf(
    'if [[ "${ACTION}" == "rollback" ]]'
  );
  const rollbackEnd = source.indexOf("\nfi", source.indexOf("exit 0", rollbackStart));
  const rollback = source.slice(rollbackStart, rollbackEnd);
  const candidateStart = source.indexOf("CANDIDATE_STARTED=1");
  const candidateMutation = source.indexOf(
    "run_trusted_pm2 startOrReload",
    candidateStart
  );
  return (
    includesInOrder(restore, [
      "local restore_status=0",
      'if ! restore_nginx_from_bundle "${bundle}"; then',
      "restore_status=1",
      'if ! restore_worker_from_bundle "${bundle}"; then',
      "restore_status=1",
      'return "${restore_status}"',
    ]) &&
    !restore.includes("return 1") &&
    !restore.includes("run_trusted_pm2 save") &&
    /SYSTEM_STATE_CHANGED=1\s+mv -f -- "\$\{TEMP_CONFIG\}" "\$\{NGINX_CONFIG\}"/u.test(
      switchNginx
    ) &&
    occurrences(switchNginx, "SYSTEM_STATE_CHANGED=1") === 1 &&
    includesInOrder(rollback, [
      "SYSTEM_STATE_CHANGED=1",
      'restore_worker_from_bundle "${ROLLBACK_BUNDLE}"',
      'restore_nginx_from_bundle "${ROLLBACK_BUNDLE}"',
      "run_trusted_pm2 save",
      "CUTOVER_COMMITTED=1",
    ]) &&
    candidateStart >= 0 &&
    candidateMutation > candidateStart &&
    includesInOrder(onExit, [
      'if ! restore_system_from_bundle "${RESTORE_BUNDLE}"; then',
      "AUTO_RESTORE_SUCCEEDED=1",
      'run_trusted_pm2 delete "${CANDIDATE_NAME}"',
      'if ! pm2_name_is_absent "${CANDIDATE_NAME}"',
      "candidate_cleanup_ok=0",
      "candidate_cleanup_ok == 1",
      "AUTO_RESTORE_SUCCEEDED == 1",
      "run_trusted_pm2 save",
    ]) &&
    onExit.includes(
      "(SYSTEM_STATE_CHANGED == 0 && CANDIDATE_STARTED == 1)"
    ) &&
    occurrences(source, "run_trusted_pm2 save\n  CUTOVER_COMMITTED=1") +
      occurrences(source, "run_trusted_pm2 save\nCUTOVER_COMMITTED=1") ===
      2
  );
}

function hasDaemonProbeContract(source) {
  return (
    includesInOrder(source, [
      'const FIXED_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"',
      'const FORBIDDEN_DAEMON_ENVIRONMENT = new Set([',
      '"NODE_OPTIONS"',
      '"PM2_NODE_OPTIONS"',
      "function assertTrustedTree(root)",
      "function readSecureRegularFile(path, maximumBytes, exactMode)",
      "constants.O_NOFOLLOW",
      "function validateInstallation(options)",
      "const pm2PackageRoot = assertTrustedPath(",
      "assertTrustedTree(pm2PackageRoot)",
      'join(pm2PackageRoot, "node_modules", "pm2-axon")',
      'join(pm2PackageRoot, "node_modules", "pm2-axon-rpc")',
      "function readPidFile(path)",
      "if (!/^[1-9][0-9]*$/u.test(value)) fail()",
      "function validateDaemonEnvironment(",
      "EXPECTED_NODE_IPC_BOOTSTRAP_ENVIRONMENT",
      "expectIpcBootstrap",
      'key.startsWith("NODE_")',
      "FORBIDDEN_DAEMON_ENVIRONMENT_PREFIXES.some",
      'key.startsWith("PM2_")',
      "function verifyProcessIdentity(pid, installation)",
      'realpathSync(`/proc/${pid}/exe`)',
      'readNullSeparated(`/proc/${pid}/cmdline`',
      'readNullSeparated(`/proc/${pid}/environ`',
      "function readSocket(path)",
      "function verifyDaemonOwnsSockets(pid, socketInodes)",
      "function loadRpcModules(installation)",
      'rpcCall(client, "getVersion")',
      'rpcCall(client, "getReport")',
      'rpcCall(client, "getMonitorData")',
      "const before = takeSnapshot(installation)",
      "const monitorData = await readExistingDaemonRpc(installation)",
      "const after = takeSnapshot(installation)",
      "before.token !== after.token",
      "before.fingerprint !== after.fingerprint",
    ]) &&
    source.includes("process.getuid() !== 0") &&
    source.includes("process.getgid() !== 0") &&
    source.includes('["NODE_CHANNEL_FD", "3"]') &&
    source.includes('["NODE_CHANNEL_SERIALIZATION_MODE", "json"]') &&
    source.includes("PATH: FIXED_PATH") &&
    source.includes('HOME: "/root"') &&
    source.includes('USER: "root"') &&
    source.includes('LOGNAME: "root"') &&
    source.includes('LANG: "C.UTF-8"') &&
    source.includes("(homeEntry.mode & 0o777) !== 0o700") &&
    source.includes("readSecureRegularFile(path, 32, 0o600)") &&
    source.includes(
      "`PM2 v${installation.expectedPm2Version}: God Daemon `"
    ) &&
    source.includes("cmdline[0] !== expectedTitle") &&
    source.includes("(entry.mode & 0o777) !== 0o775") &&
    source.includes("report.pm2_version !== installation.expectedPm2Version") &&
    source.includes("report.node_version !== installation.expectedNodeVersion") &&
    source.includes("report.argv0 !== installation.nodeBin") &&
    source.includes("report.argv[1] !== installation.daemonJs") &&
    source.includes("entry.uid !== 0") &&
    source.includes("entry.gid !== 0") &&
    source.includes("entry.nlink !== 1") &&
    !source.includes("pm2.connect") &&
    !source.includes("child_process")
  );
}

function hasPm2NoAutostartGuardContract(source) {
  return (
    includesInOrder(source, [
      'const EXPECTED_PM2_VERSION = "6.0.14"',
      "const packageRoot = process.env.STARGAZE_PM2_PACKAGE_ROOT",
      "!path.isAbsolute(packageRoot)",
      "realpathSync(packageRoot) !== packageRoot",
      "const packageEntry = lstatSync(packageRoot)",
      'const packageFile = path.join(packageRoot, "package.json")',
      'const clientFile = path.join(packageRoot, "lib", "Client.js")',
      "packageEntry.isSymbolicLink()",
      "realpathSync(packageFile) !== packageFile",
      "realpathSync(clientFile) !== clientFile",
      "metadata?.name !== \"pm2\"",
      "metadata?.version !== EXPECTED_PM2_VERSION",
      "const Client = require(clientFile)",
      'typeof Client.prototype?.launchDaemon !== "function"',
      'Object.defineProperty(Client.prototype, "launchDaemon"',
      "configurable: false",
      "writable: false",
      "value(options, callback)",
      'const done = typeof options === "function" ? options : callback',
      'process.nextTick(() => done(error))',
      "throw error",
      "delete process.env.STARGAZE_PM2_PACKAGE_ROOT",
    ]) &&
    !source.includes("child_process") &&
    !source.includes(".spawn(") &&
    !source.includes(".exec(")
  );
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
    const child = spawn(process.execPath, ["--", ...argumentsList], {
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

async function testPm2NoAutostartGuard() {
  const fixturePath = join(temporaryRoot, "pm2-no-autostart-guard");
  mkdirSync(fixturePath, { recursive: true });
  const fixture = realpathSync(fixturePath);
  const packageRoot = join(fixture, "pm2");
  const clientDirectory = join(packageRoot, "lib");
  const guardedSentinel = join(fixture, "guarded-launch-sentinel");
  const baselineSentinel = join(fixture, "baseline-launch-sentinel");
  const guardedExercise = join(fixture, "guarded-exercise.cjs");
  const baselineExercise = join(fixture, "baseline-exercise.cjs");
  mkdirSync(clientDirectory, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify({ name: "pm2", version: "6.0.14" })}\n`
  );
  writeFileSync(
    join(clientDirectory, "Client.js"),
    [
      '"use strict";',
      'const { writeFileSync } = require("node:fs");',
      "module.exports = class Client {",
      "  launchDaemon(options, callback) {",
      '    writeFileSync(process.env.STARGAZE_TEST_SENTINEL, "launched\\n");',
      "    if (typeof callback === \"function\") callback(null);",
      "    return true;",
      "  }",
      "};",
      "",
    ].join("\n")
  );

  writeFileSync(
    guardedExercise,
    [
      'const Client = require(process.env.STARGAZE_TEST_CLIENT);',
      "let callbackCalled = false;",
      "const result = new Client().launchDaemon({}, (error) => {",
      "  callbackCalled = true;",
      "  if (!(error instanceof Error)) process.exit(21);",
      "  if (!error.message.includes(\"auto-start is forbidden\")) process.exit(22);",
      "  if (process.env.STARGAZE_PM2_PACKAGE_ROOT !== undefined) process.exit(23);",
      "  process.stdout.write(\"guarded\\n\");",
      "});",
      "if (result !== false) process.exit(24);",
      "setTimeout(() => { if (!callbackCalled) process.exit(25); }, 25);",
      "",
    ].join("\n")
  );
  writeFileSync(
    baselineExercise,
    [
      'const Client = require(process.env.STARGAZE_TEST_CLIENT);',
      "new Client().launchDaemon({}, (error) => {",
      "  if (error) process.exit(31);",
      "  process.stdout.write(\"baseline\\n\");",
      "});",
      "",
    ].join("\n")
  );
  const guard = resolve(root, "scripts/pm2-existing-daemon-only.cjs");
  const guarded = await runCommand(
    process.execPath,
    ["--require", guard, "--", guardedExercise],
    {
      env: {
        STARGAZE_PM2_PACKAGE_ROOT: packageRoot,
        STARGAZE_TEST_CLIENT: join(clientDirectory, "Client.js"),
        STARGAZE_TEST_SENTINEL: guardedSentinel,
      },
    }
  );
  assert(
    guarded.code === 0 && guarded.stdout.trim() === "guarded",
    `PM2 no-auto-start guard fixture failed: ${guarded.stderr}`
  );
  assert(
    !existsSync(guardedSentinel),
    "PM2 no-auto-start guard allowed the original launchDaemon implementation"
  );

  const baseline = await runCommand(
    process.execPath,
    ["--", baselineExercise],
    {
      env: {
        STARGAZE_TEST_CLIENT: join(clientDirectory, "Client.js"),
        STARGAZE_TEST_SENTINEL: baselineSentinel,
      },
    }
  );
  assert(
    baseline.code === 0 &&
      baseline.stdout.trim() === "baseline" &&
      existsSync(baselineSentinel),
    "PM2 guard fixture did not prove that the unguarded launch path is live"
  );
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
    fixtureRoot = temporaryRoot,
  }
) {
  const fixture = join(fixtureRoot, `installer-${name}`);
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
  chmodSync(fixture, 0o700);
  chmodSync(fakeBin, 0o755);
  chmodSync(home, 0o700);
  chmodSync(pm2Home, 0o700);
  writeFileSync(
    join(fixture, "package.json"),
    `${JSON.stringify({ name: "pm2", version: "6.0.14" })}\n`
  );
  chmodSync(join(fixture, "package.json"), 0o644);
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
        exec_interpreter: join(fakeBin, "node"),
        node_version: "24.18.0",
        pm_exec_path: installedScript,
        pm_uptime: Date.now() - 1_000,
      },
    },
  ]);
  writeExecutable(
    join(fakeBin, "pm2"),
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      `const stateFile = ${JSON.stringify(stateFile)};`,
      `const eventLog = ${JSON.stringify(eventLog)};`,
      `const onlineJson = ${JSON.stringify(onlineState)};`,
      `const failDelete = ${failDelete ? "true" : "false"};`,
      'const command = process.argv[2] ?? "";',
      'function append(value) { fs.appendFileSync(eventLog, `${value}\\n`); }',
      "switch (command) {",
      '  case "-v":',
      '    process.stdout.write("6.0.14\\n");',
      "    break;",
      '  case "jlist": {',
      '    append("pm2:jlist");',
      '    const state = fs.readFileSync(stateFile, "utf8").trim();',
      '    process.stdout.write(`${state === "online" ? onlineJson : "[]"}\\n`);',
      "    break;",
      "  }",
      '  case "startOrReload":',
      '    append("pm2:startOrReload");',
      '    fs.writeFileSync(stateFile, "online\\n");',
      "    break;",
      '  case "delete":',
      '    append("pm2:delete");',
      "    if (failDelete) {",
      '      append("pm2:delete-failed");',
      "      process.exit(98);",
      "    }",
      '    fs.writeFileSync(stateFile, "absent\\n");',
      "    break;",
      '  case "save":',
      '    append("pm2:save");',
      "    break;",
      "  default:",
      '    process.stderr.write(`unexpected pm2 command: ${command || "missing"}\\n`);',
      "    process.exit(90);",
      "}",
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
      'if [[ "${1:-}" == "-p" && "${2:-}" == "process.versions.node" ]]; then',
      '  printf "%s\\n" "24.18.0"',
      "  exit 0",
      "fi",
      'SCRIPT_BOUNDARY=0',
      'if [[ "${1:-}" == "--" ]]; then',
      "  SCRIPT_BOUNDARY=1",
      "  shift",
      "fi",
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
      'if [[ "${SCRIPT_BOUNDARY}" == "1" ]]; then',
      '  exec "${REAL_NODE}" -- "$@"',
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
    fixture,
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
  // The former PATH/HOME-based mock cannot exercise the privileged entrypoint,
  // fixed command paths, deployment lock, or an already-running PM2 daemon.
  // Keep this fail-closed opt-in until it is rebuilt in a Linux mount namespace.
  const isolatedHarnessReady = false;
  const canRun =
    isolatedHarnessReady &&
    bash &&
    typeof process.getuid === "function" &&
    process.getuid() === 0;
  if (!canRun) {
    const platformReason =
      process.platform === "win32"
        ? "Windows cannot provide the required Linux /proc, Unix sockets, and root-owned fixed paths"
        : "the legacy PATH-injection fixture is incompatible with the privileged fixed-path daemon gate";
    assert(
      process.env.CANVAS_REQUIRE_INSTALLER_DYNAMIC_TESTS !== "1",
      `dynamic installer tests are required but unavailable: ${platformReason}`
    );
    process.stdout.write(
      `[SKIP] Canvas installer dynamic fixture: ${platformReason}.\n`
    );
    return;
  }

  const trustedFixtureRoot = mkdtempSync(
    join("/root", "canvas-blue-green-installer-verifier-")
  );
  chmodSync(trustedFixtureRoot, 0o700);
  const createTrustedFixture = (name, options) =>
    createInstallerMockFixture(name, {
      ...options,
      fixtureRoot: trustedFixtureRoot,
    });

  try {
  const writableParent = createTrustedFixture("writable-command-parent", {
    initialState: "absent",
    probeIdentities: ["unused"],
  });
  chmodSync(writableParent.fakeBin, 0o777);
  const writableParentResult = await runInstallerMock(bash, writableParent);
  assert(
    writableParentResult.code !== 0 &&
      writableParentResult.stderr.includes(
        "Node must resolve through a fully trusted root-owned path chain"
      ),
    "installer accepted a Node executable below a group/other-writable parent"
  );
  assert(
    !eventLines(writableParent).some((event) => event.startsWith("pm2:")),
    "writable Node parent rejection occurred after a PM2 command"
  );

  const maliciousPm2 = createTrustedFixture("malicious-pm2-symlink", {
    initialState: "absent",
    probeIdentities: ["unused"],
  });
  const unsafePm2Parent = join(maliciousPm2.fixture, "unsafe-pm2-parent");
  const unsafePm2Target = join(unsafePm2Parent, "pm2-malicious.cjs");
  mkdirSync(unsafePm2Parent);
  chmodSync(unsafePm2Parent, 0o777);
  renameSync(join(maliciousPm2.fakeBin, "pm2"), unsafePm2Target);
  symlinkSync(unsafePm2Target, join(maliciousPm2.fakeBin, "pm2"));
  const maliciousPm2Result = await runInstallerMock(bash, maliciousPm2);
  assert(
    maliciousPm2Result.code !== 0 &&
      maliciousPm2Result.stderr.includes(
        "PM2 must resolve through a fully trusted root-owned path chain"
      ),
    "installer accepted a PM2 symlink into a group/other-writable parent"
  );
  assert(
    !eventLines(maliciousPm2).some((event) => event.startsWith("pm2:")),
    "malicious PM2 symlink rejection occurred after a PM2 command"
  );

  const absent = createTrustedFixture("absent-rollback", {
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

  const failedDelete = createTrustedFixture(
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

  const failedRestore = createTrustedFixture("restore-failure", {
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

  const unstablePrevious = createTrustedFixture(
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
  } finally {
    const resolvedTrustedFixtureRoot = resolve(trustedFixtureRoot);
    assert(
      /^\/root\/canvas-blue-green-installer-verifier-[^/]+$/u.test(
        resolvedTrustedFixtureRoot
      ),
      "trusted installer fixture cleanup target escaped its bounded root"
    );
    rmSync(resolvedTrustedFixtureRoot, { recursive: true, force: true });
  }
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
    'run_trusted_pm2 delete "${RECONCILER_NAME}"',
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
    "same server block as the unique proxy",
    "run_pm2_with_clean_environment",
    '"${ENV_BIN}" -i',
    "unset BASH_ENV ENV CDPATH GLOBIGNORE HOME LANG",
    'REQUIRED_PM2_VERSION="6.0.14"',
    "AUTO_RESTORE_SUCCEEDED=0",
    "AUTO_RESTORE_SUCCEEDED == 1",
    "probe-canvas-reconciler-readiness.mjs",
    "probe-oauth-broker-tls.mjs",
    "probe-existing-pm2-daemon.mjs",
    '"${NODE_BIN}" -- "${RECONCILER_READY_PROBE}"',
    '--lock-file "${RECONCILER_LOCK_FILE}"',
    'REQUIRED_NODE_VERSION="24.18.0"',
    'REQUIRED_NPM_VERSION="12.0.1"',
    "resolve_trusted_root_executable",
    "trusted_root_path_chain",
    'PM2_BIN="$(resolve_trusted_root_executable pm2)"',
    "run_trusted_pm2",
    "read_trusted_pm2_version",
    'NPM_VERSION="$("${NODE_BIN}" -- "${NPM_CLI}" --version)"',
    'NODE_ENV=production "${NODE_BIN}" -- scripts/check-canvas-production-env.mjs',
    'entry.pm2_env?.exec_interpreter === expectedNodeBin',
    'entry.pm2_env?.node_version === expectedNodeVersion',
    'JSON.stringify(entry.pm2_env.node_args) === "[\\"--\\"]"',
    'CANVAS_NODE_BIN="${NODE_BIN}"',
    'CANVAS_DEPLOY_LOCK_FD="${DEPLOY_LOCK_FD}"',
    "/bin/bash -p",
  ]) {
    assertIncludes(deploy, token, "blue/green deployer");
  }
  assert(
    hasPrivilegedBootstrap(deploy),
    "blue/green privileged bootstrap, fixed PATH/helpers, or environment cleanup is incomplete"
  );
  assert(
    hasPinnedMutableCommands(deploy),
    "blue/green mutable utility set is not completely pinned to trusted canonical paths"
  );
  assert(
    hasTrustedRootChainResolver(deploy),
    "blue/green executable resolver must validate every ancestor through /"
  );
  assert(
    hasBlueGreenTrustedObjectIntegration(deploy),
    "blue/green trusted directory/release-tree integration is incomplete"
  );
  assert(
    hasSupplyChainContract(deploy),
    "blue/green supply-chain verification is not unconditional and correctly ordered"
  );
  assert(
    hasDeployLockContract(deploy),
    "blue/green deployment lock does not prove an exclusive trusted lock identity"
  );
  assert(
    hasPm2DaemonShellContract(deploy),
    "blue/green PM2 package/daemon/initial-token gate is incomplete"
  );
  assert(
    hasPm2NoAutostartIntegration(deploy),
    "blue/green PM2 CLI is not preloaded with the existing-daemon-only guard"
  );
  assert(
    hasHardenedCurlProbe(deploy),
    "blue/green public/direct page probes inherit curl configuration or proxy state"
  );
  assertIncludes(
    deploy,
    'url.hostname === "www.toryxai.com"',
    "blue/green canonical public Canvas URL"
  );
  assert(
    hasPm2AccessDiscipline(deploy),
    "blue/green PM2 reads or mutations bypass the daemon-verified wrappers"
  );
  assert(
    hasNodeArgumentBoundary(deploy),
    "blue/green PM2 runtime identity does not require node_args=[\"--\"]"
  );
  assert(
    hasTransactionContract(deploy),
    "blue/green rollback/candidate cleanup/final-save transaction ordering is incomplete"
  );
  const writableParentCounterexample = deploy.replace(
    "(( (8#${mode} & 022) == 0 )) || return 1",
    "# group/other-writable ancestors were accepted"
  );
  assert(
    !hasTrustedRootChainResolver(writableParentCounterexample),
    "the verifier accepted an executable below a writable ancestor"
  );
  const untrustedPm2TargetCounterexample = deploy.replace(
    'trusted_root_path_chain "${resolved}" || return 1',
    "# canonical symlink target ancestors were not checked"
  );
  assert(
    !hasTrustedRootChainResolver(untrustedPm2TargetCounterexample),
    "the verifier accepted a PM2 symlink target below an untrusted ancestor"
  );
  const unprivilegedCounterexample = counterexample(
    deploy,
    "#!/bin/bash -p",
    "#!/bin/bash"
  );
  assert(
    !hasPrivilegedBootstrap(unprivilegedCounterexample),
    "the verifier accepted an unprivileged blue/green entrypoint"
  );
  const inheritedLoaderCounterexample = counterexample(
    deploy,
    'declare -rx LD_PRELOAD=""',
    "# LD_PRELOAD remained inherited"
  );
  assert(
    !hasPrivilegedBootstrap(inheritedLoaderCounterexample),
    "the verifier accepted a privileged entrypoint that inherited LD_PRELOAD"
  );
  const unpinnedCommandCounterexample = counterexample(
    deploy,
    '  hash -p "${resolved}" "${command_name}" || return 1',
    "  # mutable command remained PATH-resolved"
  );
  assert(
    !hasPrivilegedBootstrap(unpinnedCommandCounterexample),
    "the verifier accepted mutable utilities without hash-pinning their trusted paths"
  );
  const missingPinnedUtilityCounterexample = counterexample(
    deploy,
    "for command in grep sed head tail sleep mktemp cp mv chmod chown mkdir date rm; do",
    "for command in grep sed head tail sleep mktemp cp mv chmod chown mkdir date; do"
  );
  assert(
    !hasPinnedMutableCommands(missingPinnedUtilityCounterexample),
    "the verifier accepted an incomplete mutable-utility pin set"
  );
  const recursiveDirectoryCounterexample = counterexample(
    deploy,
    'mkdir --mode="${expected_mode}" -- "${directory}"',
    'mkdir -p --mode="${expected_mode}" -- "${directory}"'
  );
  assert(
    !hasTrustedDirectoryContract(recursiveDirectoryCounterexample),
    "the verifier accepted recursive creation through untrusted missing ancestors"
  );
  const escapingSymlinkCounterexample = counterexample(
    deploy,
    "if (target !== root && !target.startsWith(prefix)) process.exit(1)",
    "// symlink targets may escape the release"
  );
  assert(
    !hasTrustedReleaseTreeContract(escapingSymlinkCounterexample),
    "the verifier accepted a release-tree symlink escaping its root"
  );
  const missingNpmRestrictionCounterexample = counterexample(
    deploy,
    "        --allow-git=none \\",
    "        # Git lifecycle dependency execution was allowed"
  );
  assert(
    !hasSupplyChainContract(missingNpmRestrictionCounterexample),
    "the verifier accepted npm ci without --allow-git=none"
  );
  const inheritedNpmConfigCounterexample = deploy.replaceAll(
    '"NPM_CONFIG_GLOBALCONFIG=${NPM_GLOBAL_CONFIG}" \\',
    "# inherited npm global config was accepted"
  );
  assert(
    inheritedNpmConfigCounterexample !== deploy &&
      !hasSupplyChainContract(inheritedNpmConfigCounterexample),
    "the verifier accepted npm/supply checks with inherited global npm configuration"
  );
  const duplicateNpmConfigCounterexample = counterexample(
    deploy,
    'readonly NPM_GLOBAL_CONFIG="/run/stargaze-canvas/npm-globalconfig-disabled"',
    'readonly NPM_GLOBAL_CONFIG="/dev/null"'
  );
  assert(
    !hasSupplyChainContract(duplicateNpmConfigCounterexample),
    "the verifier accepted duplicate npm user/global configuration paths"
  );
  const curlConfigCounterexample = counterexample(
    deploy,
    '"${CURL_BIN}" --disable --noproxy \'*\'',
    '"${CURL_BIN}"'
  );
  assert(
    !hasHardenedCurlProbe(curlConfigCounterexample),
    "the verifier accepted a curl probe with inherited config or proxy routing"
  );
  const redirectSuccessCounterexample = counterexample(
    deploy,
    '[[ "${code}" == "200" ]]',
    '[[ "${code}" =~ ^[23][0-9][0-9]$ ]]'
  );
  assert(
    !hasHardenedCurlProbe(redirectSuccessCounterexample),
    "the verifier accepted an HTTP redirect as Canvas health"
  );
  const gatedSupplyCounterexample =
    moveSupplyVerifierIntoBuildBranch(deploy);
  assert(
    !hasSupplyChainContract(gatedSupplyCounterexample),
    "the verifier accepted a build-gated supply-chain verifier"
  );
  const unlockedCounterexample = counterexample(
    deploy,
    '"${FLOCK_BIN}" --exclusive --nonblock "${inherited_fd}" || return 1',
    "# inherited deployment lock was not re-validated"
  );
  assert(
    !hasDeployLockContract(unlockedCounterexample),
    "the verifier accepted an inherited deployment FD without a nonblocking lock proof"
  );
  const noInitialDaemonCounterexample = counterexample(
    deploy,
    'PM2_DAEMON_TOKEN="$(probe_existing_pm2_daemon token)" ||',
    'PM2_DAEMON_TOKEN="unchecked-daemon" ||'
  );
  assert(
    !hasPm2DaemonShellContract(noInitialDaemonCounterexample),
    "the verifier accepted PM2 access without an initial daemon token"
  );
  const noAutostartGuardCounterexample = counterexample(
    deploy,
    '"${NODE_BIN}" --require "${PM2_NO_AUTOSTART_GUARD}" -- \\',
    '"${NODE_BIN}" -- \\'
  );
  assert(
    !hasPm2NoAutostartIntegration(noAutostartGuardCounterexample) &&
      !hasPm2AccessDiscipline(noAutostartGuardCounterexample),
    "the verifier accepted PM2 CLI execution without the no-auto-start preload"
  );
  const directReadCounterexample = counterexample(
    deploy,
    'pm2_name_is_absent() {\n  local name="$1"\n  pm2_existing_jlist 2>/dev/null |',
    'pm2_name_is_absent() {\n  local name="$1"\n  run_trusted_pm2 jlist 2>/dev/null |'
  );
  assert(
    !hasPm2AccessDiscipline(directReadCounterexample),
    "the verifier accepted a CLI jlist read that could auto-start PM2"
  );
  const directMutationCounterexample = counterexample(
    deploy,
    '  run_trusted_pm2 startOrReload "${PM2_CONFIG}" \\',
    '  run_pm2_with_clean_environment "${NODE_BIN}" -- "${PM2_BIN}" startOrReload "${PM2_CONFIG}" \\'
  );
  assert(
    !hasPm2AccessDiscipline(directMutationCounterexample),
    "the verifier accepted a PM2 mutation without pre/post daemon-token checks"
  );
  const missingBeforeTokenCounterexample = counterexample(
    deploy,
    '[[ "${before_token}" == "${PM2_DAEMON_TOKEN}" ]] || return 1',
    "# daemon token before the PM2 mutation was not compared"
  );
  assert(
    !hasPm2AccessDiscipline(missingBeforeTokenCounterexample),
    "the verifier accepted a PM2 mutation without a before-token equality proof"
  );
  const missingAfterTokenCounterexample = counterexample(
    deploy,
    '[[ "${after_token}" == "${before_token}" ]] || return 1',
    "# daemon token after the PM2 mutation was not compared"
  );
  assert(
    !hasPm2AccessDiscipline(missingAfterTokenCounterexample),
    "the verifier accepted a PM2 mutation without an after-token equality proof"
  );
  const missingNodeArgsCounterexample = deploy.replaceAll(
    'JSON.stringify(entry.pm2_env.node_args) === "[\\"--\\"]"',
    "true"
  );
  assert(
    missingNodeArgsCounterexample !== deploy &&
      !hasNodeArgumentBoundary(missingNodeArgsCounterexample),
    "the verifier accepted PM2 application identities without node_args=[\"--\"]"
  );
  const lateCandidateArmCounterexample = counterexample(
    deploy,
    "CANDIDATE_STARTED=1",
    "# candidate cleanup was not armed"
  );
  assert(
    !hasTransactionContract(lateCandidateArmCounterexample),
    "the verifier accepted candidate startup without pre-armed cleanup"
  );
  const earlyCutoverStateCounterexample = counterexample(
    deploy,
    'SYSTEM_STATE_CHANGED=1\n  mv -f -- "${TEMP_CONFIG}" "${NGINX_CONFIG}"',
    'mv -f -- "${TEMP_CONFIG}" "${NGINX_CONFIG}"\n  SYSTEM_STATE_CHANGED=1'
  );
  assert(
    !hasTransactionContract(earlyCutoverStateCounterexample),
    "the verifier accepted arming Nginx rollback after the atomic replacement"
  );
  const earlyCommitCounterexample = counterexample(
    deploy,
    "run_trusted_pm2 save\nCUTOVER_COMMITTED=1",
    "CUTOVER_COMMITTED=1\nrun_trusted_pm2 save"
  );
  assert(
    !hasTransactionContract(earlyCommitCounterexample),
    "the verifier accepted commit before the final PM2 save"
  );
  assertIncludes(
    deploy,
    '"${NPM_VERSION}" == "${REQUIRED_NPM_VERSION}"',
    "blue/green exact npm gate"
  );
  assertIncludes(
    deploy,
    'pm2_single_worker_is_online "${NODE_BIN}" "${REQUIRED_NODE_VERSION}"',
    "blue/green reconciler runtime identity gate"
  );
  const productionEnvironmentCheck = read(
    "scripts/check-canvas-production-env.mjs"
  );
  assertIncludes(
    productionEnvironmentCheck,
    'const REQUIRED_NODE_VERSION = "24.18.0"',
    "Canvas production environment runtime pin"
  );
  assertIncludes(
    productionEnvironmentCheck,
    "process.versions.node === REQUIRED_NODE_VERSION",
    "Canvas production environment exact runtime gate"
  );
  const productionSupplyChainCheck = read(
    "scripts/verify-production-supply-chain.mjs"
  );
  assertIncludes(
    productionSupplyChainCheck,
    "const expectedNpmEntries = [",
    "production supply-chain exact npm policy"
  );
  assertIncludes(
    productionSupplyChainCheck,
    "JSON.stringify(npmEntries)",
    "production supply-chain exact npm policy"
  );
  assertIncludes(
    productionSupplyChainCheck,
    "JSON.stringify(expectedNpmEntries)",
    "production supply-chain exact npm policy"
  );
  const dockerfile = read("Dockerfile");
  for (const token of [
    "FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d",
    "npm@12.0.1",
    'test "$(npm --version)" = "12.0.1"',
  ]) {
    assertIncludes(dockerfile, token, "Canvas worker image runtime pin");
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
  assertIncludes(ecosystem, "interpreter: nodeBin", "Canvas PM2 config");
  assertIncludes(
    ecosystem,
    'interpreter_args: ["--"]',
    "Canvas PM2 Node 24 argument boundary"
  );
  assertIncludes(
    ecosystem,
    'const REQUIRED_NODE_VERSION = "24.18.0"',
    "Canvas PM2 runtime pin"
  );
  assertIncludes(
    ecosystem,
    "assertTrustedRootPathChain(nodeBin",
    "Canvas PM2 interpreter ancestor trust gate"
  );
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
  assertIncludes(
    reconcilerEcosystem,
    "interpreter: nodeBin",
    "Canvas reconciler trusted interpreter"
  );
  assertIncludes(
    reconcilerEcosystem,
    'interpreter_args: ["--"]',
    "Canvas reconciler Node 24 argument boundary"
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
  assertIncludes(
    reconcilerInstaller,
    '"${ENV_BIN}" -i',
    "Canvas reconciler installer"
  );
  for (const token of [
    "LEGACY_INSTALLED_CONFIG",
    "HAD_PROCESS=0",
    "pm2_worker_previous_state",
    "restore_backup_atomically",
    'REQUIRED_PM2_VERSION="6.0.14"',
    ".XXXXXX.config.cjs",
    "probe-canvas-reconciler-readiness.mjs",
    "probe-existing-pm2-daemon.mjs",
    '"${NODE_BIN}" -- "${READY_PROBE}"',
    '--lock-file "${lock_file}"',
    '[[ "${first_identity}" == "${second_identity}" ]]',
    "elif ((HAD_PROCESS == 1)); then",
    'REQUIRED_NODE_VERSION="24.18.0"',
    "resolve_trusted_root_executable",
    "trusted_root_path_chain",
    'PM2_BIN="$(resolve_trusted_root_executable pm2)"',
    "run_trusted_pm2",
    "read_trusted_pm2_version",
    "pm2_worker_runtime_is_exact_from_json",
    'entry.pm2_env?.exec_interpreter === expectedNodeBin',
    'entry.pm2_env?.node_version === expectedNodeVersion',
    'JSON.stringify(entry.pm2_env.node_args) === "[\\"--\\"]"',
    'CANVAS_NODE_BIN="${NODE_BIN}"',
  ]) {
    assertIncludes(reconcilerInstaller, token, "Canvas reconciler installer");
  }
  assert(
    hasPrivilegedBootstrap(reconcilerInstaller),
    "reconciler privileged bootstrap, fixed PATH/helpers, or environment cleanup is incomplete"
  );
  assert(
    hasPinnedMutableCommands(reconcilerInstaller),
    "reconciler mutable utility set is not completely pinned to trusted canonical paths"
  );
  assert(
    hasTrustedRootChainResolver(reconcilerInstaller),
    "reconciler installer executable resolver must validate every ancestor through /"
  );
  assert(
    hasInstallerTrustedObjectIntegration(reconcilerInstaller),
    "reconciler trusted source/env/lock/install/release-tree integration is incomplete"
  );
  assert(
    hasDeployLockContract(reconcilerInstaller),
    "reconciler deployment lock does not prove an exclusive trusted lock identity"
  );
  assert(
    hasPm2DaemonShellContract(reconcilerInstaller),
    "reconciler PM2 package/daemon/initial-token gate is incomplete"
  );
  assert(
    hasPm2NoAutostartIntegration(reconcilerInstaller),
    "reconciler PM2 CLI is not preloaded with the existing-daemon-only guard"
  );
  assert(
    hasPm2AccessDiscipline(reconcilerInstaller),
    "reconciler PM2 reads or mutations bypass the daemon-verified wrappers"
  );
  assert(
    hasNodeArgumentBoundary(reconcilerInstaller),
    "reconciler PM2 runtime identity does not require node_args=[\"--\"]"
  );
  assertIncludes(
    reconcilerEcosystem,
    "assertTrustedRootPathChain(nodeBin",
    "Canvas reconciler interpreter ancestor trust gate"
  );
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
  const installerNoPrivilegeCounterexample = counterexample(
    reconcilerInstaller,
    "#!/bin/bash -p",
    "#!/bin/bash"
  );
  assert(
    !hasPrivilegedBootstrap(installerNoPrivilegeCounterexample),
    "the verifier accepted an unprivileged reconciler entrypoint"
  );
  const unsafeSourceCounterexample = counterexample(
    reconcilerInstaller,
    '  trusted_root_path_chain "${candidate}"',
    "  # source-file ancestor trust was skipped"
  );
  assert(
    !hasInstallerTrustedObjectIntegration(unsafeSourceCounterexample),
    "the verifier accepted reconciler source files below an untrusted ancestor"
  );
  const installerDirectMutationCounterexample = counterexample(
    reconcilerInstaller,
    '  run_trusted_pm2 startOrReload "${INSTALLED_CONFIG}" \\',
    '  run_pm2_with_clean_environment "${NODE_BIN}" -- "${PM2_BIN}" startOrReload "${INSTALLED_CONFIG}" \\'
  );
  assert(
    !hasPm2AccessDiscipline(installerDirectMutationCounterexample),
    "the verifier accepted a reconciler mutation without daemon-token checks"
  );
  const installerNoAutostartGuardCounterexample = counterexample(
    reconcilerInstaller,
    '"${NODE_BIN}" --require "${PM2_NO_AUTOSTART_GUARD}" -- \\',
    '"${NODE_BIN}" -- \\'
  );
  assert(
    !hasPm2NoAutostartIntegration(
      installerNoAutostartGuardCounterexample
    ) &&
      !hasPm2AccessDiscipline(installerNoAutostartGuardCounterexample),
    "the verifier accepted reconciler PM2 CLI execution without the no-auto-start preload"
  );
  const installerNoPackageTreeCounterexample = counterexample(
    reconcilerInstaller,
    'trusted_root_release_tree "${PM2_PACKAGE_ROOT}" ||',
    "# PM2 dependency tree was not recursively trusted ||"
  );
  assert(
    !hasPm2DaemonShellContract(installerNoPackageTreeCounterexample),
    "the verifier accepted PM2 package metadata without a recursive tree proof"
  );
  const daemonProbe = read("scripts/probe-existing-pm2-daemon.mjs");
  assert(
    hasDaemonProbeContract(daemonProbe),
    "existing-PM2-daemon probe lacks trusted installation/process/socket/RPC before-after proofs"
  );
  const daemonProbeNoEnvironmentCounterexample = counterexample(
    daemonProbe,
    '  "PM2_NODE_OPTIONS",',
    "  // PM2_NODE_OPTIONS was allowed,"
  );
  assert(
    !hasDaemonProbeContract(daemonProbeNoEnvironmentCounterexample),
    "the verifier accepted a daemon probe that allows PM2_NODE_OPTIONS"
  );
  const daemonProbeNoAfterCounterexample = counterexample(
    daemonProbe,
    "    before.fingerprint !== after.fingerprint ||",
    "    false ||"
  );
  assert(
    !hasDaemonProbeContract(daemonProbeNoAfterCounterexample),
    "the verifier accepted a daemon probe without a before/after fingerprint proof"
  );
  const daemonProbeNoPackageTreeCounterexample = counterexample(
    daemonProbe,
    "  assertTrustedTree(pm2PackageRoot);",
    "  // PM2 dependencies were not recursively trusted;"
  );
  assert(
    !hasDaemonProbeContract(daemonProbeNoPackageTreeCounterexample),
    "the verifier accepted a daemon probe without recursively trusting the PM2 package"
  );
  const daemonNoAutostartGuard = read(
    "scripts/pm2-existing-daemon-only.cjs"
  );
  assert(
    hasPm2NoAutostartGuardContract(daemonNoAutostartGuard),
    "PM2 no-auto-start preload does not pin Client.launchDaemon to a fail-closed implementation"
  );
  const guardLaunchCounterexample = counterexample(
    daemonNoAutostartGuard,
    'Object.defineProperty(Client.prototype, "launchDaemon"',
    'Object.defineProperty(Client.prototype, "startDaemon"'
  );
  assert(
    !hasPm2NoAutostartGuardContract(guardLaunchCounterexample),
    "the verifier accepted a guard that did not patch Client.launchDaemon"
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
    restoreNginx >= 0 &&
      restoreWorkerFailure > restoreNginx &&
      !restoreSystem.includes("return 1") &&
      restoreSystem.includes('return "${restore_status}"'),
    "Canvas automatic recovery must attempt Nginx first and still attempt worker restoration"
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
    await testPm2NoAutostartGuard();
    await testInstallerFailureHarness();
    process.stdout.write(
      `[OK] Canvas blue/green verifier passed ${assertions} assertions.\n`
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
