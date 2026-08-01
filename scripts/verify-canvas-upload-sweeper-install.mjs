#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const installerUrl = new URL(
  "../deploy/install-canvas-upload-sweeper.sh",
  import.meta.url
);
const installerPath = fileURLToPath(installerUrl);
const installer = readFileSync(installerUrl, "utf8");
const worker = readFileSync(
  new URL("./sweep-canvas-upload-reservations.mjs", import.meta.url),
  "utf8"
);
let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

check(installer.startsWith("#!/usr/bin/env bash"), "installer is an explicit Bash program");
check(installer.includes("set -Eeuo pipefail"), "installer fails closed");
check(
  installer.includes('ACTION="${1:-validate}"') &&
    installer.includes("EXECUTE=0"),
  "validation is the default and mutation is separately armed"
);
check(
  installer.includes('[[ "${ACTION}" == "validate" || "${ACTION}" == "install" ]]'),
  "only validate and install actions are accepted"
);
check(
  installer.includes('[[ "${RELEASE_DIR}" == /* && "${RELEASE_DIR}" != "/" ]]') &&
    installer.includes('[[ "${ENV_FILE}" == /* && "${ENV_FILE}" != "/" ]]'),
  "broad or relative filesystem targets are rejected"
);
check(
  installer.includes('! -L "${RELEASE_DIR}"') &&
    installer.includes('! -L "${SWEEPER}"') &&
    installer.includes('! -L "${ENV_FILE}"'),
  "release, script, and secret file symlinks are rejected"
);
check(
  installer.includes("Environment file must be root-owned") &&
    installer.includes("(8#${ENV_MODE} & 077) == 0"),
  "secret file ownership and mode are enforced"
);
check(
  installer.includes("major !== 20 || minor < 12"),
  "the production Node contract is enforced"
);
check(
  installer.includes('"${SWEEPER}" --env-file "${ENV_FILE}" --dry-run'),
  "configuration is validated without database or OSS writes"
);
check(
  installer.includes('if [[ "${ACTION}" == "validate" || "${EXECUTE}" == "0" ]]'),
  "systemd changes require both install and --execute"
);
check(
  installer.includes("Type=oneshot") &&
    installer.includes("NoNewPrivileges=true") &&
    installer.includes("ProtectSystem=strict") &&
    installer.includes("ProtectHome=read-only"),
  "the service runs as a hardened one-shot"
);
check(
  installer.includes("OnUnitActiveSec=${INTERVAL_MINUTES}min") &&
    installer.includes("Persistent=true") &&
    installer.includes("RandomizedDelaySec=60"),
  "the timer is persistent, bounded, and jittered"
);

const armIndex = installer.indexOf("TRANSACTION_ARMED=1");
const firstMoveIndex = installer.indexOf('mv -f -- "${TEMP_SERVICE}" "${SERVICE_PATH}"');
check(
  armIndex >= 0 && firstMoveIndex > armIndex,
  "rollback is armed before the first unit replacement"
);
check(
  installer.includes("snapshot_unit") &&
    installer.includes("SERVICE_MODE") &&
    installer.includes("SERVICE_UID") &&
    installer.includes("SERVICE_GID") &&
    installer.includes("TIMER_UNIT_FILE_STATE") &&
    installer.includes("TIMER_ACTIVE_STATE") &&
    installer.includes("SERVICE_ACTIVE_STATE") &&
    installer.includes('mode="$(stat -c \'%a\' -- "${path}")" ||') &&
    installer.includes('uid="$(stat -c \'%u\' -- "${path}")" ||') &&
    installer.includes('gid="$(stat -c \'%g\' -- "${path}")" ||'),
  "unit bytes, metadata, and prior systemd states are snapshotted"
);
check(
  installer.includes("rollback_transaction") &&
    installer.includes("unit_snapshot_matches") &&
    installer.includes("read_timer_unit_file_state") &&
    installer.includes("read_active_state") &&
    installer.includes("PRESERVE_BACKUP=1") &&
    installer.includes("root-only backup retained at ${BACKUP_DIR}"),
  "rollback restores and strictly verifies files and systemd state"
);
check(
  installer.includes("[CRITICAL] Failed to remove installer temporary file") &&
    installer.includes("[CRITICAL] Failed to remove installer backup directory"),
  "cleanup residue is reported and fails the installation"
);
check(
  installer.includes("CANVAS_SWEEPER_INSTALL_TEST_MODE") &&
    installer.includes("CANVAS_SWEEPER_TEST_UNIT_DIR") &&
    installer.includes("--canvas-sweeper-test-probe") &&
    installer.includes('LOCK_FILE="${UNIT_DIR}/.${SERVICE_NAME}.install.lock"') &&
    !installer.includes("CANVAS_SWEEPER_TEST_LOCK_FILE"),
  "dynamic tests require an isolated unit directory, fake systemctl, and derived lock"
);
check(
  installer.includes('exec {LOCK_FD}>>"${LOCK_FILE}"') &&
    installer.includes("umask 077") &&
    installer.includes('chmod 0600 "${LOCK_FILE}"') &&
    installer.includes("flock -n \"${LOCK_FD}\"") &&
    installer.includes("Another Canvas upload sweeper installation is in progress"),
  "installations use a root-only, non-truncating, held flock"
);
check(
  installer.includes('[[ "${SERVICE_ACTIVE_STATE}" == "inactive" ]]') &&
    installer.includes("--property=LoadState --value") &&
    installer.includes("--property=UnitFileState --value") &&
    !installer.includes("enabled-runtime"),
  "ambiguous systemd states fail closed and the old one-shot must be inactive"
);

const oneShotStartIndex = installer.lastIndexOf(
  'systemctl start "${SERVICE_NAME}.service"'
);
const oneShotResultIndex = installer.lastIndexOf(
  'systemctl show "${SERVICE_NAME}.service" --property=Result --value'
);
const invocationProofIndex = installer.lastIndexOf(
  '"${SERVICE_INVOCATION_AFTER}" != "${SERVICE_INVOCATION_BEFORE}"'
);
const timerEnableIndex = installer.lastIndexOf(
  'systemctl enable "${SERVICE_NAME}.timer"'
);
const timerStartIndex = installer.lastIndexOf(
  'systemctl start "${SERVICE_NAME}.timer"'
);
check(
    oneShotStartIndex >= 0 &&
    invocationProofIndex > oneShotStartIndex &&
    oneShotResultIndex > invocationProofIndex &&
    timerEnableIndex > oneShotResultIndex &&
    timerStartIndex > timerEnableIndex &&
    !installer.includes('enable --now "${SERVICE_NAME}.timer"'),
  "the initial one-shot succeeds before the timer is enabled or started"
);
check(
  installer.includes('[[ "$(read_timer_unit_file_state)" == "enabled" ]]') &&
    installer.includes('[[ "$(read_active_state "${SERVICE_NAME}.timer")" == "active" ]]') &&
    installer.includes("TRANSACTION_COMMITTED=1"),
  "post-install state is checked before the transaction commits"
);
check(
  !installer.includes("CANVAS_RECONCILE_SECRET=") &&
    !installer.includes("SUPABASE_SERVICE_ROLE_KEY="),
  "the installer never accepts or embeds secret values"
);
check(
  worker.includes("claim_canvas_upload_purge_v1") &&
    worker.indexOf("await oss.delete(claim.object_key") <
      worker.indexOf('"complete_canvas_upload_purge_v1"'),
  "the installed worker deletes or proves absence before releasing quota"
);

function commandPath(command) {
  const lookup = spawnSync("/bin/sh", ["-c", `command -v ${command}`], {
    encoding: "utf8",
  });
  if (lookup.status !== 0 || lookup.stdout.trim() === "") return null;
  return realpathSync(lookup.stdout.trim());
}

function writeExecutable(path, lines) {
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o755 });
}

function snapshotFile(path) {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${path} must be a regular file`);
  return {
    bytes: readFileSync(path),
    mode: stat.mode & 0o7777,
    uid: stat.uid,
    gid: stat.gid,
  };
}

function assertFileSnapshot(path, expected, context) {
  if (expected === null) {
    assert.equal(existsSync(path), false, `${context}: absent unit was recreated`);
    return;
  }
  const actual = snapshotFile(path);
  assert.ok(actual, `${context}: existing unit was removed`);
  assert.deepEqual(actual.bytes, expected.bytes, `${context}: unit bytes changed`);
  assert.equal(actual.mode, expected.mode, `${context}: unit mode changed`);
  assert.equal(actual.uid, expected.uid, `${context}: unit uid changed`);
  assert.equal(actual.gid, expected.gid, `${context}: unit gid changed`);
}

const dynamicRequired =
  process.env.CANVAS_REQUIRE_INSTALLER_DYNAMIC_TESTS === "1";
const repoTempDir = join(dirname(dirname(installerPath)), ".temp");

function inspectDynamicSupport() {
  if (process.platform !== "linux") {
    return { supported: false, reason: "requires Linux" };
  }
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    return { supported: false, reason: "requires root" };
  }

  let canaryRoot = "";
  try {
    mkdirSync(repoTempDir, { recursive: true, mode: 0o755 });
    const tempStat = lstatSync(repoTempDir);
    if (!tempStat.isDirectory() || tempStat.isSymbolicLink()) {
      return {
        supported: false,
        reason: "repository .temp must be a non-symlink directory",
      };
    }
    const canonicalTemp = realpathSync(repoTempDir);
    canaryRoot = mkdtempSync(join(canonicalTemp, "canvas-sweeper-exec-canary-"));
    const canary = join(canaryRoot, "canary");
    writeExecutable(canary, ["#!/bin/sh", "exit 0"]);
    const result = spawnSync(canary, [], { encoding: "utf8" });
    if (result.status !== 0) {
      return {
        supported: false,
        reason: "repository .temp is not executable",
      };
    }

    const bashPath = commandPath("bash");
    const realMv = commandPath("mv");
    const flockPath = commandPath("flock");
    if (!bashPath || !realMv || !flockPath) {
      return {
        supported: false,
        reason: "requires executable bash, flock, and mv",
      };
    }
    return {
      supported: true,
      tempDir: canonicalTemp,
      bashPath,
      realMv,
    };
  } catch (error) {
    return {
      supported: false,
      reason: `repository .temp probe failed: ${error.message}`,
    };
  } finally {
    if (canaryRoot !== "") {
      rmSync(canaryRoot, { recursive: true, force: true });
    }
  }
}

const dynamicSupport = inspectDynamicSupport();

if (!dynamicSupport.supported) {
  if (dynamicRequired) {
    throw new Error(
      `CANVAS_REQUIRE_INSTALLER_DYNAMIC_TESTS=1: ${dynamicSupport.reason}`
    );
  }
  console.log(
    `Canvas upload sweeper installer dynamic tests: skipped (${dynamicSupport.reason})`
  );
} else {
  const { bashPath, realMv, tempDir } = dynamicSupport;
  const failures = [
    "second-mv",
    "daemon-reload",
    "oneshot-start",
    "oneshot-invocation",
    "oneshot-result",
    "timer-enable",
    "timer-start",
    "post-enabled-check",
    "post-active-check",
  ];

  function runScenario(options, verify) {
    const {
      existing,
      failure = "",
      rollbackFailure = "",
      queryFailure = "",
      validSystemctlMarker = true,
      holdInstallerLock = false,
    } = options;
    const initialTimerUnitFileState =
      options.initialTimerUnitFileState ?? (existing ? "enabled" : "not-found");
    const initialTimerActiveState =
      options.initialTimerActiveState ?? (existing ? "active" : "inactive");
    const initialServiceActiveState =
      options.initialServiceActiveState ?? "inactive";
    const context = `${existing ? "existing" : "absent"}/${
      failure === "" ? "success" : failure
    }${rollbackFailure === "" ? "" : `/rollback-${rollbackFailure}`}`;
    const root = mkdtempSync(join(tempDir, "canvas-sweeper-installer-"));
    try {
        const binDir = join(root, "bin");
        const releaseDir = join(root, "release");
        const scriptsDir = join(releaseDir, "scripts");
        const unitDir = join(root, "units");
        const stateDir = join(root, "state");
        const envFile = join(root, "production.env");
        const fakeNode = join(binDir, "node");
        const fakeSystemctl = join(binDir, "systemctl");
        const fakeMv = join(binDir, "mv");
        const servicePath = join(
          unitDir,
          "stargaze-canvas-upload-sweeper.service"
        );
        const timerPath = join(
          unitDir,
          "stargaze-canvas-upload-sweeper.timer"
        );
        const lockPath = join(
          unitDir,
          ".stargaze-canvas-upload-sweeper.install.lock"
        );

        for (const directory of [binDir, scriptsDir, unitDir, stateDir]) {
          mkdirSync(directory, { recursive: true, mode: 0o755 });
        }
        writeFileSync(
          join(scriptsDir, "sweep-canvas-upload-reservations.mjs"),
          "// isolated dynamic harness worker\n",
          { mode: 0o644 }
        );
        writeFileSync(envFile, "DYNAMIC_HARNESS_ONLY=1\n", { mode: 0o600 });
        chmodSync(envFile, 0o600);
        writeFileSync(lockPath, "pre-existing lock sentinel\n", { mode: 0o600 });
        chmodSync(lockPath, 0o600);
        const lockBefore = snapshotFile(lockPath);

        writeExecutable(fakeNode, [
          "#!/bin/sh",
          'if [ "${1:-}" = "-p" ]; then',
          "  printf '%s\\n' '20.19.6'",
          "fi",
          "exit 0",
        ]);
        writeExecutable(fakeMv, [
          "#!/bin/sh",
          'destination=""',
          'for argument in "$@"; do destination="$argument"; done',
          'if [ "${MOCK_FAIL:-}" = "second-mv" ] &&',
          '   [ "$destination" = "${CANVAS_TEST_TIMER_PATH}" ] &&',
          '   [ ! -e "${MOCK_STATE_DIR}/fault-used" ]; then',
          '  : >"${MOCK_STATE_DIR}/fault-used"',
          "  exit 91",
          "fi",
          'exec "${MOCK_REAL_MV}" "$@"',
        ]);
        writeExecutable(fakeSystemctl, [
          "#!/bin/bash",
          "set -u",
          'if [[ "${1:-}" == "--canvas-sweeper-test-probe" ]]; then',
          '  if [[ "${MOCK_VALID_SYSTEMCTL_MARKER:-0}" == "1" ]]; then',
          "    printf '%s\\n' 'canvas-sweeper-isolated-systemctl-v1'",
          "    exit 0",
          "  fi",
          "  exit 102",
          "fi",
          'cmd="${1:-}"',
          "shift || true",
          'printf \'%s %s\\n\' "$cmd" "$*" >>"${MOCK_STATE_DIR}/operations.log"',
          "get_state() {",
          '  local value="0"',
          '  if [[ -f "${MOCK_STATE_DIR}/$1" ]]; then read -r value <"${MOCK_STATE_DIR}/$1"; fi',
          '  printf \'%s\' "$value"',
          "}",
          "set_state() {",
          '  printf \'%s\\n\' "$2" >"${MOCK_STATE_DIR}/$1"',
          "}",
          "increment() {",
          '  local value="$(get_state "$1")"',
          '  value="$((value + 1))"',
          '  set_state "$1" "$value"',
          '  printf \'%s\' "$value"',
          "}",
          "fail_once() {",
          '  [[ "${MOCK_FAIL:-}" == "$1" ]] || return 1',
          '  [[ ! -e "${MOCK_STATE_DIR}/fault-used" ]] || return 1',
          '  : >"${MOCK_STATE_DIR}/fault-used"',
          "  return 0",
          "}",
          "case \"$cmd\" in",
          "  daemon-reload)",
          '    count="$(increment daemon-reload-count)"',
          '    if fail_once "daemon-reload"; then exit 92; fi',
          '    if [[ "${MOCK_ROLLBACK_FAIL:-}" == "daemon-reload" && "$count" -ge 2 ]]; then exit 98; fi',
          '    if [[ -e "${CANVAS_TEST_TIMER_PATH}" ]]; then',
          '      set_state timer-load-state loaded',
          '      if [[ "$(get_state timer-unit-file-state)" == "not-found" ]]; then',
          '        set_state timer-unit-file-state disabled',
          "      fi",
          "    else",
          '      set_state timer-load-state not-found',
          '      set_state timer-unit-file-state not-found',
          "    fi",
          "    exit 0",
          "    ;;",
          "  enable)",
          '    if fail_once "timer-enable"; then exit 93; fi',
          '    set_state timer-unit-file-state enabled',
          "    exit 0",
          "    ;;",
          "  disable)",
          '    set_state timer-unit-file-state disabled',
          "    exit 0",
          "    ;;",
          "  start)",
          '    unit="${!#}"',
          '    if [[ "$unit" == *.service ]]; then',
          '      if fail_once "oneshot-start"; then exit 94; fi',
          '      if [[ "${MOCK_FAIL:-}" == "oneshot-invocation" && ! -e "${MOCK_STATE_DIR}/fault-used" ]]; then',
          '        : >"${MOCK_STATE_DIR}/fault-used"',
          "      else",
          '        set_state service-invocation bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          "      fi",
          '      set_state service-result success',
          '      set_state service-active-state inactive',
          "    else",
          '      if fail_once "timer-start"; then exit 95; fi',
          '      set_state timer-active-state active',
          "    fi",
          "    exit 0",
          "    ;;",
          "  stop)",
          '    unit="${!#}"',
          '    if [[ "$unit" == *.service ]]; then',
          '      set_state service-active-state inactive',
          "    else",
          '      set_state timer-active-state inactive',
          "    fi",
          "    exit 0",
          "    ;;",
          "  show)",
          '    unit="${1:-}"',
          '    property=""',
          '    for argument in "$@"; do',
          '      case "$argument" in --property=*) property="${argument#--property=}" ;; esac',
          "    done",
          '    if [[ "$property" == "ActiveState" ]]; then',
          '      if [[ "$unit" == *.service ]]; then',
          '        count="$(increment show-service-active-count)"',
          '        if [[ "${MOCK_QUERY_FAIL:-}" == "service-active" && "$count" == "1" ]]; then exit 100; fi',
          '        printf \'%s\\n\' "$(get_state service-active-state)"',
          "      else",
          '        count="$(increment show-timer-active-count)"',
          '        if [[ "${MOCK_FAIL:-}" == "post-active-check" && "$count" == "3" ]]; then',
          '          : >"${MOCK_STATE_DIR}/fault-used"',
          "          exit 99",
          "        fi",
          '        printf \'%s\\n\' "$(get_state timer-active-state)"',
          "      fi",
          "      exit 0",
          "    fi",
          '    if [[ "$property" == "LoadState" && "$unit" == *.timer ]]; then',
          '      count="$(increment read-timer-unit-state-count)"',
          '      if [[ "${MOCK_QUERY_FAIL:-}" == "unit-file" && "$count" == "1" ]]; then exit 101; fi',
          '      if [[ "${MOCK_FAIL:-}" == "post-enabled-check" && "$count" == "3" ]]; then',
          '        : >"${MOCK_STATE_DIR}/fault-used"',
          "        exit 96",
          "      fi",
          '      printf \'%s\\n\' "$(get_state timer-load-state)"',
          "      exit 0",
          "    fi",
          '    if [[ "$property" == "UnitFileState" && "$unit" == *.timer ]]; then',
          '      printf \'%s\\n\' "$(get_state timer-unit-file-state)"',
          "      exit 0",
          "    fi",
          '    if [[ "$property" == "InvocationID" ]]; then',
          '      count="$(increment show-invocation-count)"',
          '      printf \'%s\\n\' "$(get_state service-invocation)"',
          "      exit 0",
          "    fi",
          '    if [[ "$property" == "Result" ]]; then',
          '      if fail_once "oneshot-result"; then printf \'failed\\n\'; exit 0; fi',
          '      printf \'%s\\n\' "$(get_state service-result)"',
          "      exit 0",
          "    fi",
          "    exit 97",
          "    ;;",
          "  *)",
          "    exit 97",
          "    ;;",
          "esac",
        ]);

        if (existing) {
          writeFileSync(servicePath, "old service bytes\n", { mode: 0o640 });
          writeFileSync(timerPath, "old timer bytes\n", { mode: 0o600 });
          chmodSync(servicePath, 0o640);
          chmodSync(timerPath, 0o600);
          chownSync(servicePath, 1, 2);
          chownSync(timerPath, 2, 1);
        }

        writeFileSync(
          join(stateDir, "timer-load-state"),
          `${existing ? "loaded" : "not-found"}\n`
        );
        writeFileSync(
          join(stateDir, "timer-unit-file-state"),
          `${initialTimerUnitFileState}\n`
        );
        writeFileSync(
          join(stateDir, "timer-active-state"),
          `${initialTimerActiveState}\n`
        );
        writeFileSync(
          join(stateDir, "service-active-state"),
          `${initialServiceActiveState}\n`
        );
        writeFileSync(
          join(stateDir, "service-invocation"),
          existing ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n" : "\n"
        );
        writeFileSync(join(stateDir, "service-result"), "success\n");
        writeFileSync(join(stateDir, "read-timer-unit-state-count"), "0\n");
        writeFileSync(join(stateDir, "show-service-active-count"), "0\n");
        writeFileSync(join(stateDir, "show-timer-active-count"), "0\n");
        writeFileSync(join(stateDir, "show-invocation-count"), "0\n");
        writeFileSync(join(stateDir, "daemon-reload-count"), "0\n");

        const serviceBefore = snapshotFile(servicePath);
        const timerBefore = snapshotFile(timerPath);
        const installerArguments = [
          installerPath,
          "install",
          "--release-dir",
          releaseDir,
          "--env-file",
          envFile,
          "--interval-minutes",
          "15",
          "--execute",
        ];
        const childOptions = {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
            CANVAS_SWEEPER_INSTALL_TEST_MODE: "1",
            CANVAS_SWEEPER_TEST_UNIT_DIR: unitDir,
            CANVAS_TEST_TIMER_PATH: timerPath,
            MOCK_FAIL: failure,
            MOCK_QUERY_FAIL: queryFailure,
            MOCK_VALID_SYSTEMCTL_MARKER: validSystemctlMarker ? "1" : "0",
            MOCK_ROLLBACK_FAIL: rollbackFailure,
            MOCK_REAL_MV: realMv,
            MOCK_STATE_DIR: stateDir,
          },
        };
        const result = holdInstallerLock
          ? spawnSync(
              bashPath,
              [
                "-c",
                'exec 8>>"$1"; flock 8; shift; exec "$@"',
                "canvas-sweeper-lock-holder",
                lockPath,
                bashPath,
                ...installerArguments,
              ],
              childOptions
            )
          : spawnSync(bashPath, installerArguments, childOptions);

        verify({
          context,
          existing,
          result,
          root,
          stateDir,
          unitDir,
          servicePath,
          timerPath,
          lockPath,
          lockBefore,
          serviceBefore,
          timerBefore,
          initialTimerUnitFileState,
          initialTimerActiveState,
          initialServiceActiveState,
        });
        assertFileSnapshot(lockPath, lockBefore, `${context}/lock`);
        passed += 1;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  function assertRestored(scenario) {
    const {
      context,
      existing,
      result,
      stateDir,
      unitDir,
      servicePath,
      timerPath,
      serviceBefore,
      timerBefore,
      initialTimerUnitFileState,
      initialTimerActiveState,
      initialServiceActiveState,
    } = scenario;
        assert.notEqual(result.status, 0, `${context}: injected install unexpectedly passed`);
        assert.match(
          result.stderr,
          /\[ROLLBACK\] Restoring the previous Canvas upload sweeper installation\./,
          `${context}: rollback start was not reported`
        );
        assert.match(
          result.stderr,
          /\[ROLLBACK\] Previous Canvas upload sweeper installation restored\./,
          `${context}: successful rollback was not reported`
        );
        assert.doesNotMatch(
          result.stderr,
          /\[CRITICAL\]/,
          `${context}: rollback verification failed`
        );
        assert.equal(
          existsSync(join(stateDir, "fault-used")),
          true,
          `${context}: requested fault was not injected`
        );
        assertFileSnapshot(servicePath, serviceBefore, `${context}/service`);
        assertFileSnapshot(timerPath, timerBefore, `${context}/timer`);
        assert.equal(
          readFileSync(join(stateDir, "timer-load-state"), "utf8"),
          `${existing ? "loaded" : "not-found"}\n`,
          `${context}: timer load state changed`
        );
        assert.equal(
          readFileSync(join(stateDir, "timer-unit-file-state"), "utf8"),
          `${initialTimerUnitFileState}\n`,
          `${context}: timer unit-file state changed`
        );
        assert.equal(
          readFileSync(join(stateDir, "timer-active-state"), "utf8"),
          `${initialTimerActiveState}\n`,
          `${context}: timer active state changed`
        );
        assert.equal(
          readFileSync(join(stateDir, "service-active-state"), "utf8"),
          `${initialServiceActiveState}\n`,
          `${context}: service active state changed`
        );
        assert.deepEqual(
          readdirSync(unitDir).sort(),
          existing
            ? [
                ".stargaze-canvas-upload-sweeper.install.lock",
                "stargaze-canvas-upload-sweeper.service",
                "stargaze-canvas-upload-sweeper.timer",
              ]
            : [".stargaze-canvas-upload-sweeper.install.lock"],
          `${context}: installer left rollback or temporary files behind`
        );

  }

  function assertSuccess(scenario) {
    const { context, result, stateDir, unitDir, servicePath, timerPath } =
      scenario;
    assert.equal(result.status, 0, `${context}: install failed: ${result.stderr}`);
    assert.match(
      result.stdout,
      /\[OK\] Canvas upload sweeper timer is installed and its initial cycle passed\./,
      `${context}: success was not reported`
    );
    assert.doesNotMatch(result.stderr, /\[ROLLBACK\]|\[CRITICAL\]/);

    for (const [path, label] of [
      [servicePath, "service"],
      [timerPath, "timer"],
    ]) {
      const installed = snapshotFile(path);
      assert.ok(installed, `${context}/${label}: unit is missing`);
      assert.equal(installed.mode, 0o644, `${context}/${label}: wrong mode`);
      assert.equal(installed.uid, 0, `${context}/${label}: wrong uid`);
      assert.equal(installed.gid, 0, `${context}/${label}: wrong gid`);
    }
    assert.match(readFileSync(servicePath, "utf8"), /Type=oneshot/);
    assert.match(readFileSync(timerPath, "utf8"), /Persistent=true/);
    assert.equal(
      readFileSync(join(stateDir, "timer-unit-file-state"), "utf8"),
      "enabled\n"
    );
    assert.equal(
      readFileSync(join(stateDir, "timer-active-state"), "utf8"),
      "active\n"
    );

    const operations = readFileSync(join(stateDir, "operations.log"), "utf8")
      .trim()
      .split("\n");
    const startService = operations.indexOf(
      "start stargaze-canvas-upload-sweeper.service"
    );
    const showResult = operations.indexOf(
      "show stargaze-canvas-upload-sweeper.service --property=Result --value"
    );
    const enableTimer = operations.indexOf(
      "enable stargaze-canvas-upload-sweeper.timer"
    );
    const startTimer = operations.indexOf(
      "start stargaze-canvas-upload-sweeper.timer"
    );
    assert.ok(
      startService >= 0 &&
        showResult > startService &&
        enableTimer > showResult &&
        startTimer > enableTimer,
      `${context}: timer scheduling preceded successful one-shot verification`
    );
    assert.deepEqual(
      readdirSync(unitDir).sort(),
      [
        ".stargaze-canvas-upload-sweeper.install.lock",
        "stargaze-canvas-upload-sweeper.service",
        "stargaze-canvas-upload-sweeper.timer",
      ],
      `${context}: installer left transaction files behind`
    );
  }

  function assertPreflightRejected(scenario) {
    assert.notEqual(
      scenario.result.status,
      0,
      `${scenario.context}: unsafe preflight state unexpectedly passed`
    );
    assert.doesNotMatch(scenario.result.stderr, /\[ROLLBACK\]/);
    assert.match(scenario.result.stderr, /\[FAIL\]/);
    assertFileSnapshot(
      scenario.servicePath,
      scenario.serviceBefore,
      `${scenario.context}/service`
    );
    assertFileSnapshot(
      scenario.timerPath,
      scenario.timerBefore,
      `${scenario.context}/timer`
    );
    assert.deepEqual(
      readdirSync(scenario.unitDir).sort(),
      scenario.existing
        ? [
            ".stargaze-canvas-upload-sweeper.install.lock",
            "stargaze-canvas-upload-sweeper.service",
            "stargaze-canvas-upload-sweeper.timer",
          ]
        : [".stargaze-canvas-upload-sweeper.install.lock"]
    );
  }

  for (const existing of [false, true]) {
    runScenario({ existing }, assertSuccess);
    for (const failure of failures) {
      runScenario({ existing, failure }, assertRestored);
    }
  }

  runScenario(
    {
      existing: true,
      failure: "preflight-activating",
      initialServiceActiveState: "activating",
    },
    assertPreflightRejected
  );
  runScenario(
    {
      existing: true,
      failure: "preflight-enabled-runtime",
      initialTimerUnitFileState: "enabled-runtime",
    },
    assertPreflightRejected
  );
  runScenario(
    {
      existing: false,
      failure: "preflight-unit-query-error",
      queryFailure: "unit-file",
    },
    assertPreflightRejected
  );
  runScenario(
    {
      existing: false,
      failure: "preflight-active-query-error",
      queryFailure: "service-active",
    },
    assertPreflightRejected
  );
  runScenario(
    {
      existing: false,
      failure: "preflight-unrecognized-systemctl",
      validSystemctlMarker: false,
    },
    assertPreflightRejected
  );
  runScenario(
    {
      existing: false,
      failure: "preflight-lock-conflict",
      holdInstallerLock: true,
    },
    (scenario) => {
      assertPreflightRejected(scenario);
      assert.match(
        scenario.result.stderr,
        /Another Canvas upload sweeper installation is in progress/
      );
    }
  );

  runScenario(
    {
      existing: true,
      failure: "timer-start",
      rollbackFailure: "daemon-reload",
    },
    (scenario) => {
      assert.notEqual(scenario.result.status, 0);
      assert.match(
        scenario.result.stderr,
        /\[ROLLBACK\] Restoring the previous Canvas upload sweeper installation\./
      );
      assert.match(
        scenario.result.stderr,
        /\[CRITICAL\] Canvas upload sweeper rollback verification failed; root-only backup retained at \/[^\n]+\./
      );
      assert.doesNotMatch(
        scenario.result.stderr,
        /\[ROLLBACK\] Previous Canvas upload sweeper installation restored\./
      );
      assertFileSnapshot(
        scenario.servicePath,
        scenario.serviceBefore,
        `${scenario.context}/service`
      );
      assertFileSnapshot(
        scenario.timerPath,
        scenario.timerBefore,
        `${scenario.context}/timer`
      );
      const retained = readdirSync(scenario.unitDir).filter((entry) =>
        entry.startsWith(".stargaze-canvas-upload-sweeper.rollback.")
      );
      assert.equal(retained.length, 1, "rollback failure must retain one backup");
      const retainedPath = join(scenario.unitDir, retained[0]);
      assert.match(
        scenario.result.stderr,
        new RegExp(
          `root-only backup retained at ${retainedPath.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          )}\\.`
        )
      );
      const retainedStat = lstatSync(retainedPath);
      assert.ok(retainedStat.isDirectory() && !retainedStat.isSymbolicLink());
      assert.equal(retainedStat.mode & 0o7777, 0o700);
      assert.deepEqual(
        readdirSync(retainedPath).sort(),
        [
          "stargaze-canvas-upload-sweeper.service",
          "stargaze-canvas-upload-sweeper.timer",
        ]
      );
      assert.deepEqual(readdirSync(scenario.unitDir).sort(), [
        ".stargaze-canvas-upload-sweeper.install.lock",
        retained[0],
        "stargaze-canvas-upload-sweeper.service",
        "stargaze-canvas-upload-sweeper.timer",
      ].sort());
    }
  );
}

console.log(`Canvas upload sweeper installer verifier: ${passed}/${passed} assertions passed`);
