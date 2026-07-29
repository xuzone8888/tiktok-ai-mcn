#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const installerUrl = new URL(
  "../deploy/install-canvas-upload-sweeper.sh",
  import.meta.url
);
const installerPath = fileURLToPath(installerUrl);
const installer = readFileSync(installerUrl, "utf8");
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const worker = readFileSync(
  new URL("./sweep-canvas-upload-reservations.mjs", import.meta.url),
  "utf8"
);
const productionChecklist = readFileSync(
  new URL("../deploy/CANVAS_PRODUCTION_CHECKLIST.md", import.meta.url),
  "utf8"
);
let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

function hasTrustedBootstrap(source) {
  const fixedPath = source.indexOf(
    'declare -rx PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"'
  );
  const argumentParsing = source.indexOf('ACTION="${1:-validate}"');
  const firstResolution = source.indexOf("command -v");
  const helperGate = source.indexOf(
    'for helper in "${STAT_BIN}" "${DIRNAME_BIN}" "${REALPATH_BIN}" "${SYSTEMCTL_BIN}"'
  );
  const withoutPinnedSystemctlPath = source.replaceAll(
    '"/usr/bin/systemctl"',
    ""
  );
  return (
    fixedPath >= 0 &&
    fixedPath < argumentParsing &&
    fixedPath < firstResolution &&
    source.includes('readonly STAT_BIN="/usr/bin/stat"') &&
    source.includes('readonly DIRNAME_BIN="/usr/bin/dirname"') &&
    source.includes('readonly REALPATH_BIN="/usr/bin/realpath"') &&
    source.includes('readonly SYSTEMCTL_BIN="/usr/bin/systemctl"') &&
    helperGate > fixedPath &&
    source.includes('! -L "${helper}" && -x "${helper}"') &&
    !/(?:^|[\s;|&(])(?:stat|dirname|realpath|systemctl)(?=\s|$)/m.test(
      withoutPinnedSystemctlPath
    )
  );
}

function hasPrivilegedEntrypoint(source) {
  const privilegedModeGate = source.indexOf('case "$-" in');
  const fixedPath = source.indexOf(
    'declare -rx PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"'
  );
  return (
    source.startsWith("#!/bin/bash -p") &&
    privilegedModeGate > 0 &&
    privilegedModeGate < fixedPath &&
    source.includes(
      "Installer must run via its privileged /bin/bash -p entrypoint."
    )
  );
}

function hasTrustedNodeExecutionOrder(source) {
  const trustGate = source.indexOf(
    'NODE_BIN="$(resolve_trusted_root_executable node)"'
  );
  const systemdPathGate = source.indexOf(
    '[[ "${NODE_BIN}" =~ ^/[A-Za-z0-9_./-]+$ ]]'
  );
  const versionProbe = source.indexOf(
    'NODE_VERSION="$("${NODE_BIN}" -p "process.versions.node")"'
  );
  const syntaxCheck = source.indexOf(
    '"${NODE_BIN}" --check "${SWEEPER}"'
  );
  return (
    trustGate >= 0 &&
    systemdPathGate > trustGate &&
    versionProbe > systemdPathGate &&
    syntaxCheck > trustGate &&
    source.includes('[[ "${current}" == "/" ]] && break') &&
    source.includes('[[ "${uid}" == "0" ]]') &&
    source.includes("(8#${mode} & 022) == 0") &&
    source.includes(
      'current="$("${DIRNAME_BIN}" -- "${current}")"'
    ) &&
    source.includes('trusted_root_path_chain "${command_parent}"') &&
    source.includes('trusted_root_path_chain "${resolved}"') &&
    !/^[ \t]*node(?:[ \t]|$)/m.test(source)
  );
}

function neutralizesNodeOptions(source) {
  const clearEnvironment = source.indexOf(
    "unset BASH_ENV ENV CDPATH GLOBIGNORE NODE_OPTIONS"
  );
  const argumentParsing = source.indexOf('ACTION="${1:-validate}"');
  return (
    clearEnvironment >= 0 &&
    clearEnvironment < argumentParsing &&
    source.includes('declare -rx BASH_ENV=""') &&
    source.includes('declare -rx ENV=""') &&
    source.includes('declare -rx NODE_OPTIONS=""') &&
    source.includes("Environment=NODE_OPTIONS=") &&
    source.includes("UnsetEnvironment=NODE_OPTIONS")
  );
}

function hasPhasedRollback(source) {
  const armFileReplacement = source.indexOf("FILES_REPLACED=1");
  const firstUnitMove = source.indexOf(
    'mv -f -- "${TEMP_SERVICE}" "${SERVICE_PATH}"'
  );
  const conditionalFileRestore = source.indexOf(
    "if ((FILES_REPLACED == 1)); then"
  );
  const safeStateRestore = source.indexOf(
    "if ((restore_files_ok == 1 && reload_ok == 1)); then"
  );
  const firstRollbackStart = source.indexOf(
    '"${SYSTEMCTL_BIN}" start "${SERVICE_NAME}.service"',
    safeStateRestore
  );
  return (
    source.includes("FILES_REPLACED=0") &&
    armFileReplacement >= 0 &&
    armFileReplacement < firstUnitMove &&
    conditionalFileRestore >= 0 &&
    source.includes("local restore_files_ok=1") &&
    source.includes("local reload_ok=1") &&
    safeStateRestore > conditionalFileRestore &&
    firstRollbackStart > safeStateRestore &&
    source.includes(
      "Unit files or daemon state are unsafe; previous units were not restarted."
    )
  );
}

function capturesOnlyStableActivity(source) {
  const activeStateFunction = source.slice(
    source.indexOf("capture_active_state()"),
    source.indexOf("disable_enabled_state()")
  );
  return (
    activeStateFunction.includes("active|inactive)") &&
    !/\b(?:activating|reloading|deactivating|maintenance|failed|unknown)\b/.test(
      activeStateFunction
    ) &&
    source.includes(
      'die "Existing upload sweeper timer could not be quiesced"'
    ) &&
    source.includes(
      'die "Existing upload sweeper service could not be quiesced"'
    )
  );
}

function derivesUnitExistenceFromLoadState(source) {
  const serviceEnableSnapshot = source.indexOf(
    'capture_enabled_state "${SERVICE_NAME}.service"'
  );
  const serviceLoadSnapshot = source.indexOf(
    'capture_load_state "${SERVICE_NAME}.service"'
  );
  const serviceExistsGate = source.indexOf(
    'if [[ "${SERVICE_LOAD_STATE}" == "loaded" ]]; then'
  );
  const serviceActivitySnapshot = source.indexOf(
    'capture_active_state "${SERVICE_NAME}.service"',
    serviceExistsGate
  );
  const timerEnableSnapshot = source.indexOf(
    'capture_enabled_state "${SERVICE_NAME}.timer"'
  );
  const timerLoadSnapshot = source.indexOf(
    'capture_load_state "${SERVICE_NAME}.timer"'
  );
  const timerExistsGate = source.indexOf(
    'if [[ "${TIMER_LOAD_STATE}" == "loaded" ]]; then'
  );
  const timerActivitySnapshot = source.indexOf(
    'capture_active_state "${SERVICE_NAME}.timer"',
    timerExistsGate
  );
  return (
    source.includes("SERVICE_UNIT_EXISTS=0") &&
    source.includes("TIMER_UNIT_EXISTS=0") &&
    serviceEnableSnapshot >= 0 &&
    serviceLoadSnapshot > serviceEnableSnapshot &&
    serviceExistsGate > serviceLoadSnapshot &&
    serviceActivitySnapshot > serviceExistsGate &&
    timerEnableSnapshot >= 0 &&
    timerLoadSnapshot > timerEnableSnapshot &&
    timerExistsGate > timerLoadSnapshot &&
    timerActivitySnapshot > timerExistsGate &&
    source.includes("Service load and unit-file state are inconsistent") &&
    source.includes("Timer load and unit-file state are inconsistent") &&
    source.includes("if ((SERVICE_UNIT_EXISTS == 1)); then") &&
    source.includes("if ((TIMER_UNIT_EXISTS == 1)); then")
  );
}

function provesSynchronousInitialCycle(source) {
  const daemonReload = source.lastIndexOf(
    '"${SYSTEMCTL_BIN}" daemon-reload'
  );
  const loadGate = source.indexOf(
    '[[ "$(capture_load_state "${SERVICE_NAME}.service")" == "loaded" ]]',
    daemonReload
  );
  const inactiveGate = source.indexOf(
    '[[ "$(capture_active_state "${SERVICE_NAME}.service")" == "inactive" ]]',
    loadGate
  );
  const serviceStart = source.indexOf(
    '"${SYSTEMCTL_BIN}" start "${SERVICE_NAME}.service"',
    inactiveGate
  );
  const timerEnable = source.indexOf(
    '"${SYSTEMCTL_BIN}" enable --now "${SERVICE_NAME}.timer"',
    serviceStart
  );
  return (
    daemonReload >= 0 &&
    loadGate > daemonReload &&
    inactiveGate > loadGate &&
    serviceStart > inactiveGate &&
    timerEnable > serviceStart &&
    !source.includes("--property=InvocationID")
  );
}

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  assert.notEqual(first, -1, `${label} fixture source was not found`);
  assert.equal(
    source.indexOf(search, first + search.length),
    -1,
    `${label} fixture source was ambiguous`
  );
  return `${source.slice(0, first)}${replacement}${source.slice(
    first + search.length
  )}`;
}

function runFreshInstallSystemdFixture() {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "stargaze-sweeper-fresh-install-")
  );
  try {
    const unitDir = join(fixtureRoot, "systemd");
    const systemctlPath = join(fixtureRoot, "systemctl");
    const systemctlLog = join(fixtureRoot, "systemctl.log");
    const envPath = join(fixtureRoot, "canvas.env");
    const fixtureInstaller = join(fixtureRoot, "installer.sh");
    mkdirSync(unitDir);
    writeFileSync(
      systemctlPath,
      [
        "#!/bin/bash -p",
        "set -eu",
        'printf "%s %s\\n" "$1" "${*:2}" >>"$SYSTEMCTL_LOG"',
        'case "$1" in',
        "  is-enabled)",
        '    printf "%s\\n" "not-found"',
        "    exit 4",
        "    ;;",
        "  is-active)",
        '    if [[ "${2:-}" == "--quiet" ]]; then exit 0; fi',
        '    printf "%s\\n" "inactive"',
        "    exit 4",
        "    ;;",
        "  show)",
        '    case " ${*:2} " in',
        '      *" --property=LoadState "*)',
        '        if [[ -e "$SYSTEMCTL_UNITS/stargaze-canvas-upload-sweeper.service" ]]; then',
        '          printf "%s\\n" "loaded"',
        "        else",
        '          printf "%s\\n" "not-found"',
        "        fi",
        "        ;;",
        '      *" --property=ActiveState "*) printf "%s\\n" "inactive" ;;',
        "      *) exit 96 ;;",
        "    esac",
        "    ;;",
        "  daemon-reload|start|enable)",
        "    ;;",
        "  *)",
        "    exit 97",
        "    ;;",
        "esac",
        "",
      ].join("\n")
    );
    chmodSync(systemctlPath, 0o755);
    writeFileSync(
      envPath,
      [
        "NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co",
        `SUPABASE_SERVICE_ROLE_KEY=${"s".repeat(40)}`,
        "ALIYUN_OSS_REGION=oss-cn-hangzhou",
        "ALIYUN_OSS_ACCESS_KEY_ID=fixturekey",
        `ALIYUN_OSS_ACCESS_KEY_SECRET=${"x".repeat(20)}`,
        "ALIYUN_OSS_BUCKET=fixture-bucket",
        "",
      ].join("\n"),
      { mode: 0o600 }
    );

    let fixtureSource = replaceExactlyOnce(
      installer,
      'readonly SYSTEMCTL_BIN="/usr/bin/systemctl"',
      `readonly SYSTEMCTL_BIN=${JSON.stringify(systemctlPath)}`,
      "systemctl binary"
    );
    fixtureSource = replaceExactlyOnce(
      fixtureSource,
      'UNIT_DIR="/etc/systemd/system"',
      `UNIT_DIR=${JSON.stringify(unitDir)}`,
      "systemd unit directory"
    );
    const trustStart = fixtureSource.indexOf("trusted_root_path_chain() {");
    const trustEndMarker = "\n}\n\nresolve_trusted_root_executable()";
    const trustEnd = fixtureSource.indexOf(trustEndMarker, trustStart);
    assert.ok(
      trustStart >= 0 && trustEnd > trustStart,
      "trusted path fixture boundary is available"
    );
    fixtureSource = `${fixtureSource.slice(
      0,
      trustStart
    )}trusted_root_path_chain() {\n  return 0\n${fixtureSource.slice(
      trustEnd
    )}`;
    writeFileSync(fixtureInstaller, fixtureSource);
    chmodSync(fixtureInstaller, 0o755);

    const result = spawnSync(
      "/bin/bash",
      [
        "-p",
        fixtureInstaller,
        "install",
        "--release-dir",
        projectRoot.replace(/[\\/]$/u, ""),
        "--env-file",
        envPath,
        "--execute",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SYSTEMCTL_LOG: systemctlLog,
          SYSTEMCTL_UNITS: unitDir,
        },
        timeout: 120_000,
      }
    );
    check(
      result.status === 0 &&
        result.stdout.includes(
          "[OK] Canvas upload sweeper timer is installed and its initial cycle passed."
        ),
      `a fresh install with both units absent commits successfully${
        result.status === 0
          ? ""
          : ` (stderr: ${result.stderr.trim().slice(0, 300)})`
      }`
    );
    const calls = readFileSync(systemctlLog, "utf8")
      .trim()
      .split(/\r?\n/u);
    check(
      calls.some((call) =>
        call.startsWith(
          "start stargaze-canvas-upload-sweeper.service"
        )
      ) &&
        calls.some((call) =>
          call.startsWith(
            "enable --now stargaze-canvas-upload-sweeper.timer"
          )
        ) &&
        !calls.some(
          (call) =>
            call.startsWith("stop ") || call.startsWith("disable ")
        ),
      "fresh installation does not stop nonexistent units before its initial cycle"
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function hasTrustedReleaseRuntimeTree(source) {
  const releaseGate = source.indexOf(
    'trusted_root_path_chain "${RELEASE_DIR}"'
  );
  const workerGate = source.indexOf('trusted_root_path_chain "${SWEEPER}"');
  const dependencyRootGate = source.indexOf(
    'trusted_root_path_chain "${RUNTIME_MODULES}"'
  );
  const nodeVersionProbe = source.indexOf(
    'NODE_VERSION="$("${NODE_BIN}" -p "process.versions.node")"'
  );
  const dependencyTreeProbe = source.indexOf(
    "const { lstatSync, readdirSync, realpathSync } = require(\"node:fs\");"
  );
  const workerSyntaxCheck = source.indexOf(
    '"${NODE_BIN}" --check "${SWEEPER}"'
  );
  return (
    releaseGate >= 0 &&
    workerGate > releaseGate &&
    dependencyRootGate > workerGate &&
    nodeVersionProbe > dependencyRootGate &&
    dependencyTreeProbe > nodeVersionProbe &&
    workerSyntaxCheck > dependencyTreeProbe &&
    source.includes(
      'entry.uid !== 0 || (entry.mode & 0o022) !== 0'
    ) &&
    source.includes(
      'target !== root && !target.startsWith(prefix)'
    )
  );
}

function hasTrustedMutationTargets(source) {
  const envCanonicalGate = source.indexOf(
    '[[ "$("${REALPATH_BIN}" -e -- "${ENV_FILE}")" == "${ENV_FILE}" ]]'
  );
  const envChainGate = source.indexOf(
    'trusted_root_path_chain "${ENV_FILE}"'
  );
  const rootGate = source.indexOf(
    '((EUID == 0)) || die "Installation must run as root"'
  );
  const unitChainGate = source.indexOf(
    'trusted_root_path_chain "${UNIT_DIR}"'
  );
  const firstUnitTemporary = source.indexOf(
    'TEMP_SERVICE="$(mktemp "${UNIT_DIR}/'
  );
  return (
    envCanonicalGate >= 0 &&
    envChainGate > envCanonicalGate &&
    rootGate > envChainGate &&
    unitChainGate > rootGate &&
    firstUnitTemporary > unitChainGate
  );
}

function preservesRecoveryBackup(source) {
  return (
    source.includes(
      'cp -a -- "${BACKUP_DIR}/service" "${SERVICE_PATH}"'
    ) &&
    source.includes('cp -a -- "${BACKUP_DIR}/timer" "${TIMER_PATH}"') &&
    !source.includes('mv -f -- "${BACKUP_DIR}/') &&
    source.includes("preserve_backup=1") &&
    source.includes('cleanup_install_artifacts "${preserve_backup}"') &&
    source.includes('chown root:root "${BACKUP_DIR}"') &&
    source.includes('chmod 0700 "${BACKUP_DIR}"') &&
    source.includes(
      '[RECOVERY] Root-only rollback backup retained at: ${BACKUP_DIR}'
    )
  );
}

check(
  hasPrivilegedEntrypoint(installer),
  "installer cannot load caller BASH_ENV before its trusted bootstrap"
);
check(
  productionChecklist.includes(
    "/bin/bash -p deploy/install-canvas-upload-sweeper.sh validate"
  ) &&
    productionChecklist.includes(
      "/bin/bash -p deploy/install-canvas-upload-sweeper.sh install"
    ) &&
    !/(?:^|\n)bash deploy\/install-canvas-upload-sweeper\.sh/m.test(
      productionChecklist
    ),
  "production operator commands use the privileged absolute Bash entrypoint"
);
const nonPrivilegedShellCounterexample = installer.replace(
  "#!/bin/bash -p",
  "#!/bin/bash"
);
check(
  !hasPrivilegedEntrypoint(nonPrivilegedShellCounterexample),
  "the verifier rejects a non-privileged root Bash entrypoint"
);
check(installer.includes("set -Eeuo pipefail"), "installer fails closed");
check(
  hasTrustedBootstrap(installer),
  "caller PATH cannot replace bootstrap filesystem or systemd helpers"
);
const inheritedPathCounterexample = installer.replace(
  'declare -rx PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"',
  "# caller PATH was left inherited"
);
check(
  !hasTrustedBootstrap(inheritedPathCounterexample),
  "the verifier rejects an installer that inherits caller PATH"
);
const bareStatCounterexample = installer.replace(
  '"${STAT_BIN}" -c \'%u\' -- "${current}"',
  'stat -c \'%u\' -- "${current}"'
);
check(
  !hasTrustedBootstrap(bareStatCounterexample),
  "the verifier rejects a path-chain check that resolves stat through PATH"
);
check(
  neutralizesNodeOptions(installer),
  "caller and systemd NODE_OPTIONS cannot affect any Node process"
);
const inheritedNodeOptionsCounterexample = installer.replace(
  "unset BASH_ENV ENV CDPATH GLOBIGNORE NODE_OPTIONS",
  "# NODE_OPTIONS was left inherited"
);
check(
  !neutralizesNodeOptions(inheritedNodeOptionsCounterexample),
  "the verifier rejects an installer that inherits caller NODE_OPTIONS"
);
check(
  installer.includes('ACTION="${1:-validate}"') &&
    installer.includes('EXECUTE=0'),
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
    installer.includes("(8#${ENV_MODE} & 077) == 0") &&
    hasTrustedMutationTargets(installer),
  "secret and systemd mutation paths have fully trusted ownership chains"
);
const writableEnvironmentParentCounterexample = installer.replace(
  'trusted_root_path_chain "${ENV_FILE}"',
  "# environment ancestors were accepted"
);
check(
  !hasTrustedMutationTargets(writableEnvironmentParentCounterexample),
  "the verifier rejects an environment file below a writable ancestor"
);
const writableUnitParentCounterexample = installer.replace(
  'trusted_root_path_chain "${UNIT_DIR}"',
  "# systemd unit ancestors were accepted"
);
check(
  !hasTrustedMutationTargets(writableUnitParentCounterexample),
  "the verifier rejects a systemd unit directory below a writable ancestor"
);
check(
  installer.includes('[[ "${NODE_VERSION}" == "24.18.0" ]]') &&
    installer.includes(
      "Node must resolve through a fully trusted root-owned path chain"
    ) &&
    installer.includes('trusted_root_path_chain "${command_parent}"') &&
    installer.includes('trusted_root_path_chain "${resolved}"') &&
    installer.includes("(8#${mode} & 022) == 0") &&
    installer.includes(
      "ExecStartPre=${NODE_BIN} -e 'process.exit(process.versions.node===\"24.18.0\"?0:1)'"
    ) &&
    hasTrustedNodeExecutionOrder(installer) &&
    hasTrustedReleaseRuntimeTree(installer),
  "the exact trusted Node 24.18.0 production contract is enforced"
);
const bareNodeCounterexample = installer.replace(
  '"${NODE_BIN}" --check "${SWEEPER}"',
  'node --check "${SWEEPER}"'
);
check(
  !hasTrustedNodeExecutionOrder(bareNodeCounterexample),
  "the verifier rejects a bare Node execution before the trusted binary contract"
);
const writableNodeParentCounterexample = installer.replace(
  "(( (8#${mode} & 022) == 0 )) || return 1",
  "# group/other-writable ancestors were accepted"
);
check(
  !hasTrustedNodeExecutionOrder(writableNodeParentCounterexample),
  "the verifier rejects a Node executable below a writable ancestor"
);
const unsafeSystemdNodePathCounterexample = installer.replace(
  '[[ "${NODE_BIN}" =~ ^/[A-Za-z0-9_./-]+$ ]]',
  "# systemd path characters were not checked"
);
check(
  !hasTrustedNodeExecutionOrder(unsafeSystemdNodePathCounterexample),
  "the verifier rejects a Node path that was not constrained for systemd"
);
const writableRuntimeTreeCounterexample = installer.replace(
  "entry.uid !== 0 || (entry.mode & 0o022) !== 0",
  "false"
);
check(
  !hasTrustedReleaseRuntimeTree(writableRuntimeTreeCounterexample),
  "the verifier rejects a writable or non-root runtime dependency tree"
);
check(
  installer.includes(
    '"${NODE_BIN}" -- "${SWEEPER}" --env-file "${ENV_FILE}" --dry-run'
  ) &&
    installer.includes(
      "ExecStart=${NODE_BIN} -- ${SWEEPER} --env-file ${ENV_FILE}"
    ),
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
    installer.includes("OnBootSec=5min") &&
    installer.includes("RandomizedDelaySec=60") &&
    !installer.includes("Persistent=true"),
  "the monotonic timer is boot-activated, bounded, and jittered without a false persistence claim"
);
check(
  installer.lastIndexOf(
    '"${SYSTEMCTL_BIN}" start "${SERVICE_NAME}.service"'
  ) <
      installer.indexOf(
        '"${SYSTEMCTL_BIN}" enable --now "${SERVICE_NAME}.timer"'
      ) &&
    provesSynchronousInitialCycle(installer),
  "the initial one-shot must succeed before the timer can be enabled"
);
check(
  installer.includes("TXN_ACTIVE=0") &&
    installer.includes("TXN_COMMITTED=0") &&
    hasPhasedRollback(installer) &&
    installer.includes("trap on_exit EXIT") &&
    installer.includes("rollback_installation"),
  "all post-snapshot mutations use a phase-aware exit rollback"
);
const unguardedFileRollbackCounterexample = installer.replace(
  "if ((FILES_REPLACED == 1)); then",
  "if true; then"
);
check(
  !hasPhasedRollback(unguardedFileRollbackCounterexample),
  "the verifier rejects unit-file rollback before replacement begins"
);
const unsafeRestartCounterexample = installer.replace(
  "if ((restore_files_ok == 1 && reload_ok == 1)); then",
  "if true; then"
);
check(
  !hasPhasedRollback(unsafeRestartCounterexample),
  "the verifier rejects restarting units after an incomplete file restore or reload"
);
check(
  installer.includes('cp -a -- "${SERVICE_PATH}" "${BACKUP_DIR}/service"') &&
    installer.includes('cp -a -- "${TIMER_PATH}" "${BACKUP_DIR}/timer"') &&
    installer.includes(
      'cp -a -- "${BACKUP_DIR}/service" "${SERVICE_PATH}"'
    ) &&
    installer.includes('cp -a -- "${BACKUP_DIR}/timer" "${TIMER_PATH}"'),
  "existing service and timer unit files are backed up and restored"
);
check(
  hasTrustedNodeExecutionOrder(installer) &&
    preservesRecoveryBackup(installer),
  "trusted Node ordering and recoverable rollback backups are mandatory"
);
const cleanupCounterexample = installer.replace(
  'cleanup_install_artifacts "${preserve_backup}"',
  "cleanup_install_artifacts 0"
);
check(
  !preservesRecoveryBackup(cleanupCounterexample),
  "the verifier rejects deleting the only backup after an incomplete rollback"
);
check(
  installer.includes(
    "Existing service unit path has an unsupported file type"
  ) &&
    installer.includes(
      "Existing timer unit path has an unsupported file type"
    ),
  "rollback refuses unit path types it cannot restore precisely"
);
check(
  installer.includes(
    'capture_enabled_state "${SERVICE_NAME}.service"'
  ) &&
    installer.includes(
      'capture_enabled_state "${SERVICE_NAME}.timer"'
    ) &&
    installer.includes(
      'capture_active_state "${SERVICE_NAME}.service"'
    ) &&
    installer.includes('capture_active_state "${SERVICE_NAME}.timer"') &&
    installer.includes(
      'die "Unable to snapshot the existing timer enablement state"'
    ) &&
    installer.includes("restore_enabled_state") &&
    installer.includes('state_is_active "${TIMER_ACTIVE_STATE}"'),
  "rollback fails closed unless enabled and active unit state can be restored"
);
check(
  capturesOnlyStableActivity(installer) &&
    derivesUnitExistenceFromLoadState(installer) &&
    provesSynchronousInitialCycle(installer),
  "installation proves the new inactive unit with a synchronous first cycle before timer enablement"
);
const transientActivityCounterexample = installer.replace(
  "active|inactive)",
  "active|activating|inactive)"
);
check(
  !capturesOnlyStableActivity(transientActivityCounterexample),
  "the verifier rejects transient systemd activity snapshots"
);
const activeStateExistenceCounterexample = installer.replace(
  'if [[ "${SERVICE_LOAD_STATE}" == "loaded" ]]; then',
  'if [[ "${SERVICE_ENABLE_STATE}" != "not-found" ]]; then'
);
check(
  !derivesUnitExistenceFromLoadState(activeStateExistenceCounterexample),
  "the verifier rejects using unit-file enablement as a loaded-unit signal"
);
const missingPreStartStateCounterexample = installer.replace(
  '[[ "$(capture_active_state "${SERVICE_NAME}.service")" == "inactive" ]] ||\n' +
    '  die "New upload sweeper service was not inactive before its first cycle"',
  "# the candidate service state was not proved before start"
);
check(
  !provesSynchronousInitialCycle(missingPreStartStateCounterexample),
  "the verifier rejects a first cycle without an inactive candidate service"
);
check(
  installer.includes('rm -f -- "${SERVICE_PATH}" "${TIMER_PATH}"') &&
    installer.includes("SERVICE_PATH_EXISTED=0") &&
    installer.includes("TIMER_PATH_EXISTED=0"),
  "a failed first installation removes exactly the newly installed unit paths"
);
check(
    installer.includes("TIMER_ENABLE_ATTEMPTED=1") &&
    installer.includes(
      '"${SYSTEMCTL_BIN}" disable --now "${SERVICE_NAME}.timer"'
    ) &&
    installer.includes("SERVICE_START_ATTEMPTED=1") &&
    installer.includes(
      '"${SYSTEMCTL_BIN}" stop "${SERVICE_NAME}.service"'
    ),
  "partial activation is stopped before unit files are rolled back"
);
check(
  installer.indexOf(
    '"${SYSTEMCTL_BIN}" is-active --quiet "${SERVICE_NAME}.timer"'
  ) <
      installer.indexOf("TXN_COMMITTED=1") &&
    installer.indexOf("TXN_COMMITTED=1") <
      installer.indexOf(
        'echo "[OK] Canvas upload sweeper timer is installed'
      ),
  "the transaction commits only after the timer activation check passes"
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

const requireDynamicTests =
  process.env.CANVAS_REQUIRE_INSTALLER_DYNAMIC_TESTS === "1";
if (process.platform === "linux") {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "stargaze-sweeper-path-poison-")
  );
  try {
    const poisonBin = join(fixtureRoot, "bin");
    const releaseDir = join(fixtureRoot, "release");
    const scriptsDir = join(releaseDir, "scripts");
    const markerPath = join(fixtureRoot, "poison-helper-ran");
    const bashEnvPath = join(fixtureRoot, "poison-bash-env.sh");
    const envPath = join(fixtureRoot, "canvas.env");
    mkdirSync(poisonBin);
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(join(releaseDir, "node_modules"));
    writeFileSync(
      join(scriptsDir, "sweep-canvas-upload-reservations.mjs"),
      ""
    );
    writeFileSync(envPath, "CANVAS_RECONCILE_SECRET=fixture\n", {
      mode: 0o600,
    });
    writeFileSync(
      bashEnvPath,
      'printf "%s\\n" "BASH_ENV" >>"$POISON_MARKER"\n'
    );
    for (const command of [
      "bash",
      "dirname",
      "node",
      "realpath",
      "stat",
      "systemctl",
    ]) {
      const commandPath = join(poisonBin, command);
      writeFileSync(
        commandPath,
        '#!/bin/sh\nprintf "%s\\n" "$0" >>"$POISON_MARKER"\nexit 0\n'
      );
      chmodSync(commandPath, 0o755);
    }

    const result = spawnSync(
      "/bin/bash",
      [
        "-p",
        installerPath,
        "validate",
        "--release-dir",
        releaseDir,
        "--env-file",
        envPath,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          BASH_ENV: bashEnvPath,
          PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
          POISON_MARKER: markerPath,
        },
      }
    );
    check(
      result.status !== 0 &&
        result.stderr.includes(
          "Release directory must be root-owned with a trusted path chain"
        ),
      "a writable release below poisoned PATH fails at the real ownership gate"
    );
    check(
      !existsSync(markerPath),
      "poisoned bash and helper executables are never invoked"
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
} else if (!requireDynamicTests) {
  process.stdout.write(
    `[SKIP] poisoned-PATH execution fixture requires Linux (current: ${process.platform})\n`
  );
}

const canRunFreshInstallFixture =
  process.platform === "linux" &&
  process.getuid?.() === 0 &&
  process.versions.node === "24.18.0" &&
  existsSync(join(projectRoot, "node_modules"));
if (canRunFreshInstallFixture) {
  runFreshInstallSystemdFixture();
} else if (requireDynamicTests) {
  throw new Error(
    "CANVAS_REQUIRE_INSTALLER_DYNAMIC_TESTS=1 requires Linux root, Node 24.18.0, and installed dependencies"
  );
} else {
  process.stdout.write(
    "[SKIP] fresh-install systemd fixture requires Linux root with the exact runtime\n"
  );
}

process.stdout.write(
  `Canvas upload sweeper installer verifier: ${passed}/${passed} assertions passed\n`
);
