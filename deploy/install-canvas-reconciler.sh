#!/bin/bash -p
#
# Installs one release-independent Canvas reconciliation worker. The worker
# secret remains in the caller-selected root-owned env file; it is never put
# in PM2 metadata, command arguments, or this installation directory.

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

case "$-" in
  *p*) ;;
  *)
    echo "[FAIL] Installer must run via its privileged /bin/bash -p entrypoint." >&2
    exit 1
    ;;
esac

declare -rx PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"
readonly STAT_BIN="/usr/bin/stat"
readonly DIRNAME_BIN="/usr/bin/dirname"
readonly REALPATH_BIN="/usr/bin/realpath"
readonly ENV_BIN="/usr/bin/env"
readonly FLOCK_BIN="/usr/bin/flock"
readonly READLINK_BIN="/usr/bin/readlink"
for helper in \
  "${STAT_BIN}" "${DIRNAME_BIN}" "${REALPATH_BIN}" "${ENV_BIN}" \
  "${FLOCK_BIN}" "${READLINK_BIN}"; do
  [[ -f "${helper}" && ! -L "${helper}" && -x "${helper}" ]] || {
    echo "[FAIL] A required bootstrap helper is unavailable." >&2
    exit 1
  }
done

unset BASH_ENV ENV CDPATH GLOBIGNORE HOME LANG LD_AUDIT LD_LIBRARY_PATH \
  LD_PRELOAD LOGNAME NODE_EXTRA_CA_CERTS NODE_ICU_DATA NODE_OPTIONS NODE_PATH \
  NODE_REPL_EXTERNAL_MODULE OPENSSL_CONF PM2_HOME PM2_NODE_OPTIONS SSL_CERT_DIR \
  SSL_CERT_FILE USER
declare -rx BASH_ENV=""
declare -rx ENV=""
declare -rx HOME="/root"
declare -rx LANG="C.UTF-8"
declare -rx LD_AUDIT=""
declare -rx LD_LIBRARY_PATH=""
declare -rx LD_PRELOAD=""
declare -rx LOGNAME="root"
declare -rx NODE_EXTRA_CA_CERTS=""
declare -rx NODE_ICU_DATA=""
declare -rx NODE_OPTIONS=""
declare -rx NODE_PATH=""
declare -rx NODE_REPL_EXTERNAL_MODULE=""
declare -rx OPENSSL_CONF=""
declare -rx PM2_HOME="/root/.pm2"
declare -rx PM2_NODE_OPTIONS=""
declare -rx SSL_CERT_DIR=""
declare -rx SSL_CERT_FILE=""
declare -rx USER="root"

SCRIPT_DIR="$(cd -- "$("${DIRNAME_BIN}" -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

ACTION="plan"
EXECUTE=0
SOURCE_SCRIPT="${REPO_ROOT}/scripts/canvas-reconciler-worker.mjs"
SOURCE_CONFIG="${REPO_ROOT}/deploy/ecosystem.canvas-reconciler.config.cjs"
READY_PROBE="${REPO_ROOT}/scripts/probe-canvas-reconciler-readiness.mjs"
PM2_DAEMON_PROBE="${REPO_ROOT}/scripts/probe-existing-pm2-daemon.mjs"
PM2_NO_AUTOSTART_GUARD="${REPO_ROOT}/scripts/pm2-existing-daemon-only.cjs"
INSTALL_DIR="${CANVAS_RECONCILER_INSTALL_DIR:-/opt/stargaze-canvas-reconciler}"
ENV_FILE="${CANVAS_RECONCILER_ENV_FILE:-}"
TARGET_URL="${CANVAS_RECONCILER_URL:-}"
LOCK_FILE="${CANVAS_RECONCILER_LOCK_FILE:-/run/stargaze-canvas-reconciler.lock}"
PM2_NAME="${CANVAS_RECONCILER_PM2_NAME:-stargaze-canvas-reconciler}"
REQUIRED_NODE_VERSION="24.18.0"
REQUIRED_PM2_VERSION="6.0.14"
NODE_BIN=""
PM2_BIN=""
PM2_PACKAGE_ROOT=""
PM2_DAEMON_JS=""
PM2_DAEMON_TOKEN=""
readonly DEPLOY_LOCK_FILE="/run/stargaze-canvas/deploy.lock"
DEPLOY_LOCK_FD=""

INSTALLED_SCRIPT=""
INSTALLED_CONFIG=""
LEGACY_INSTALLED_CONFIG=""
INSTALLED_SETTINGS=""
PREVIOUS_CONFIG_PATH=""
BACKUP_SCRIPT=""
BACKUP_CONFIG=""
BACKUP_SETTINGS=""
SCRIPT_MODE=""
SCRIPT_UID=""
SCRIPT_GID=""
CONFIG_MODE=""
CONFIG_UID=""
CONFIG_GID=""
SETTINGS_MODE=""
SETTINGS_UID=""
SETTINGS_GID=""
HAD_SCRIPT=0
HAD_CONFIG=0
HAD_SETTINGS=0
HAD_PROCESS=0
CONFIG_WAS_LEGACY=0
FILES_REPLACED=0
PROCESS_UPDATED=0
STAGE_SCRIPT=""
STAGE_CONFIG=""
STAGE_SETTINGS=""

usage() {
  cat <<'USAGE'
Usage:
  deploy/install-canvas-reconciler.sh [plan|validate|install] [options]

Actions:
  plan       Resolve and print a safe plan without reading secrets (default).
  validate   Read-only validation, including env permissions and endpoint shape.
  install    Atomically install/reload the singleton; requires --execute.

Options:
  --execute                 Arm the install mutation.
  --env-file <absolute>     Root-owned env file with CANVAS_RECONCILE_SECRET.
  --url <loopback-url>      Exact active-release localhost reconcile endpoint.
  --install-dir <absolute>  Stable install directory.
  --lock-file <absolute>    Stable singleton lock file.
  --pm2-name <name>         Stable PM2 process name.
  --source-script <path>    Release worker source (normally unchanged).
  --source-config <path>    Release PM2 config source (normally unchanged).
  --help                    Show help.

No option accepts the bearer secret.
USAGE
}

die() {
  echo "[FAIL] $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    die "Required command is unavailable: $1"
}

trusted_root_path_chain() {
  local current="$1"
  local mode
  local uid
  [[ "${current}" == /* ]] || return 1
  while true; do
    [[ -e "${current}" && ! -L "${current}" ]] || return 1
    uid="$("${STAT_BIN}" -c '%u' -- "${current}")" || return 1
    [[ "${uid}" == "0" ]] || return 1
    mode="$("${STAT_BIN}" -c '%a' -- "${current}")" || return 1
    [[ "${mode}" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#${mode} & 022) == 0 )) || return 1
    [[ "${current}" == "/" ]] && break
    current="$("${DIRNAME_BIN}" -- "${current}")" || return 1
  done
}

resolve_trusted_root_executable() {
  local command_name="$1"
  local command_path
  local command_parent
  local resolved
  command_path="$(command -v "${command_name}")" || return 1
  [[ "${command_path}" == /* ]] || return 1
  [[ -f "${command_path}" || -L "${command_path}" ]] || return 1
  command_parent="$(
    "${REALPATH_BIN}" -e -- "$("${DIRNAME_BIN}" -- "${command_path}")"
  )" ||
    return 1
  trusted_root_path_chain "${command_parent}" || return 1
  if [[ -L "${command_path}" ]]; then
    [[ "$("${STAT_BIN}" -c '%u' -- "${command_path}")" == "0" ]] || return 1
  fi
  resolved="$("${REALPATH_BIN}" -e -- "${command_path}")" || return 1
  [[ "${resolved}" == /* && -f "${resolved}" && ! -L "${resolved}" && -x "${resolved}" ]] ||
    return 1
  trusted_root_path_chain "${resolved}" || return 1
  printf '%s' "${resolved}"
}

pin_trusted_command() {
  local command_name="$1"
  local resolved
  resolved="$(resolve_trusted_root_executable "${command_name}")" || return 1
  hash -p "${resolved}" "${command_name}" || return 1
}

prepare_trusted_root_directory() {
  local directory="$1"
  local expected_mode="$2"
  local parent
  local normalized_mode="${expected_mode#0}"

  [[ "${directory}" == /* && "${directory}" != "/" ]] || return 1
  [[ "${directory}" =~ ^/[A-Za-z0-9_./-]+$ ]] || return 1
  if [[ -e "${directory}" || -L "${directory}" ]]; then
    [[ -d "${directory}" && ! -L "${directory}" ]] || return 1
    [[ "$("${REALPATH_BIN}" -e -- "${directory}")" == "${directory}" ]] ||
      return 1
    trusted_root_path_chain "${directory}" || return 1
    [[ "$("${STAT_BIN}" -c '%a' -- "${directory}")" == "${normalized_mode}" ]] ||
      return 1
    return 0
  fi

  parent="$("${DIRNAME_BIN}" -- "${directory}")" || return 1
  [[ -d "${parent}" && ! -L "${parent}" ]] || return 1
  [[ "$("${REALPATH_BIN}" -e -- "${parent}")" == "${parent}" ]] || return 1
  [[ "$("${REALPATH_BIN}" -m -- "${directory}")" == "${directory}" ]] || return 1
  trusted_root_path_chain "${parent}" || return 1
  mkdir --mode="${expected_mode}" -- "${directory}" || return 1
  trusted_root_path_chain "${directory}" || return 1
  [[ "$("${STAT_BIN}" -c '%a' -- "${directory}")" == "${normalized_mode}" ]]
}

trusted_root_release_tree() {
  local root="$1"
  "${NODE_BIN}" -e '
    const { lstatSync, readdirSync, realpathSync } = require("node:fs");
    const { join, sep } = require("node:path");
    const requested = process.argv[1];
    try {
      const root = realpathSync(requested);
      if (root !== requested) process.exit(1);
      const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
      const pending = [root];
      const visited = new Set();
      while (pending.length > 0) {
        const current = pending.pop();
        const entry = lstatSync(current);
        if (entry.isSymbolicLink()) {
          if (entry.uid !== 0) process.exit(1);
          const target = realpathSync(current);
          if (target !== root && !target.startsWith(prefix)) process.exit(1);
          pending.push(target);
          continue;
        }
        const identity = `${entry.dev}:${entry.ino}`;
        if (visited.has(identity)) continue;
        visited.add(identity);
        if (entry.uid !== 0 || (entry.mode & 0o022) !== 0) process.exit(1);
        if (entry.isDirectory()) {
          for (const name of readdirSync(current)) {
            pending.push(join(current, name));
          }
        } else if (!entry.isFile()) {
          process.exit(1);
        }
      }
    } catch {
      process.exit(1);
    }
  ' "${root}"
}

read_trusted_pm2_version() {
  local package_json="${PM2_PACKAGE_ROOT}/package.json"
  [[ -n "${PM2_PACKAGE_ROOT}" ]] || return 1
  [[ -f "${package_json}" && ! -L "${package_json}" ]] || return 1
  trusted_root_path_chain "${package_json}" || return 1
  "${NODE_BIN}" -e '
    const fs = require("node:fs");
    try {
      const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (
        metadata.name !== "pm2" ||
        typeof metadata.version !== "string" ||
        !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(metadata.version)
      ) process.exit(1);
      process.stdout.write(metadata.version);
    } catch {
      process.exit(1);
    }
  ' "${package_json}"
}

run_pm2_with_clean_environment() {
  local variable_name
  local -a pm2_environment_command=(
    "${ENV_BIN}" -i
    "PATH=${PATH}"
    "HOME=${HOME}"
    "USER=${USER}"
    "LOGNAME=${LOGNAME}"
    "LANG=${LANG}"
    "PM2_HOME=${PM2_HOME}"
    "PM2_PROGRAMMATIC=true"
    "PM2_NO_INTERACTION=true"
    "STARGAZE_PM2_PACKAGE_ROOT=${PM2_PACKAGE_ROOT}"
  )
  for variable_name in \
    CANVAS_PM2_NAME CANVAS_APP_DIR CANVAS_PORT CANVAS_ENV_FILE \
    CANVAS_NODE_BIN CANVAS_RECONCILER_SETTINGS_FILE; do
    if [[ -v "${variable_name}" && -n "${!variable_name}" ]]; then
      pm2_environment_command+=("${variable_name}=${!variable_name}")
    fi
  done
  "${pm2_environment_command[@]}" "$@"
}

run_pm2_gate_with_clean_environment() {
  "${ENV_BIN}" -i \
    "PATH=${PATH}" \
    "HOME=${HOME}" \
    "USER=${USER}" \
    "LOGNAME=${LOGNAME}" \
    "LANG=${LANG}" \
    "PM2_HOME=${PM2_HOME}" \
    "PM2_PROGRAMMATIC=true" \
    "PM2_NO_INTERACTION=true" \
    "$@"
}

probe_existing_pm2_daemon() {
  local mode="$1"
  local expected_token="${2:-}"
  local -a arguments=(
    --pm2-package-root "${PM2_PACKAGE_ROOT}"
    --node-bin "${NODE_BIN}"
    --daemon-js "${PM2_DAEMON_JS}"
    --pm2-home "${PM2_HOME}"
    --expected-pm2-version "${REQUIRED_PM2_VERSION}"
    --expected-node-version "${REQUIRED_NODE_VERSION}"
    --mode "${mode}"
  )
  if [[ -n "${expected_token}" ]]; then
    arguments+=(--expected-token "${expected_token}")
  fi
  run_pm2_gate_with_clean_environment \
    "${NODE_BIN}" -- "${PM2_DAEMON_PROBE}" "${arguments[@]}"
}

pm2_existing_jlist() {
  [[ -n "${PM2_DAEMON_TOKEN}" ]] || return 1
  probe_existing_pm2_daemon jlist "${PM2_DAEMON_TOKEN}"
}

run_trusted_pm2() {
  local before_token
  local after_token
  local command_status

  [[ -n "${PM2_DAEMON_TOKEN}" ]] || return 1
  before_token="$(
    probe_existing_pm2_daemon token "${PM2_DAEMON_TOKEN}"
  )" || return 1
  [[ "${before_token}" == "${PM2_DAEMON_TOKEN}" ]] || return 1

  if run_pm2_with_clean_environment \
    "${NODE_BIN}" --require "${PM2_NO_AUTOSTART_GUARD}" -- \
    "${PM2_BIN}" "$@"; then
    command_status=0
  else
    command_status=$?
  fi

  after_token="$(
    probe_existing_pm2_daemon token "${before_token}"
  )" || return 1
  [[ "${after_token}" == "${before_token}" ]] || return 1
  return "${command_status}"
}

acquire_deploy_lock() {
  local inherited_fd="${CANVAS_DEPLOY_LOCK_FD:-}"
  local fd_metadata
  local fd_path
  local lock_metadata
  local lock_parent
  local resolved_fd_path

  lock_parent="$("${DIRNAME_BIN}" -- "${DEPLOY_LOCK_FILE}")" || return 1
  prepare_trusted_root_directory "${lock_parent}" 0700 || return 1

  if [[ -n "${inherited_fd}" ]]; then
    [[ "${inherited_fd}" =~ ^[1-9][0-9]*$ ]] || return 1
    fd_path="/proc/self/fd/${inherited_fd}"
    [[ -f "${fd_path}" ]] || return 1
    resolved_fd_path="$(
      "${READLINK_BIN}" -f -- "${fd_path}"
    )" || return 1
    [[ "${resolved_fd_path}" == "${DEPLOY_LOCK_FILE}" ]] || return 1
    [[ -f "${DEPLOY_LOCK_FILE}" && ! -L "${DEPLOY_LOCK_FILE}" ]] || return 1
    [[ "$("${REALPATH_BIN}" -e -- "${DEPLOY_LOCK_FILE}")" == "${DEPLOY_LOCK_FILE}" ]] ||
      return 1
    trusted_root_path_chain "${DEPLOY_LOCK_FILE}" || return 1
    lock_metadata="$(
      "${STAT_BIN}" -Lc '%d:%i:%u:%g:%a:%h' -- "${DEPLOY_LOCK_FILE}"
    )" || return 1
    fd_metadata="$(
      "${STAT_BIN}" -Lc '%d:%i:%u:%g:%a:%h' -- "${fd_path}"
    )" || return 1
    [[ "${lock_metadata}" =~ ^[0-9]+:[0-9]+:0:0:600:1$ ]] || return 1
    [[ "${fd_metadata}" == "${lock_metadata}" ]] || return 1
    "${FLOCK_BIN}" --exclusive --nonblock "${inherited_fd}" || return 1
    DEPLOY_LOCK_FD="${inherited_fd}"
  else
    if [[ -e "${DEPLOY_LOCK_FILE}" || -L "${DEPLOY_LOCK_FILE}" ]]; then
      [[ -f "${DEPLOY_LOCK_FILE}" && ! -L "${DEPLOY_LOCK_FILE}" ]] || return 1
      [[ "$("${REALPATH_BIN}" -e -- "${DEPLOY_LOCK_FILE}")" == "${DEPLOY_LOCK_FILE}" ]] ||
        return 1
      trusted_root_path_chain "${DEPLOY_LOCK_FILE}" || return 1
      [[ "$("${STAT_BIN}" -c '%u:%g:%a:%h' -- "${DEPLOY_LOCK_FILE}")" == "0:0:600:1" ]] ||
        return 1
    fi
    exec 9>"${DEPLOY_LOCK_FILE}" || return 1
    DEPLOY_LOCK_FD="9"
    chmod 0600 -- "${DEPLOY_LOCK_FILE}" || return 1
    chown 0:0 -- "${DEPLOY_LOCK_FILE}" || return 1
    [[ "$("${STAT_BIN}" -c '%u:%g:%a:%h' -- "${DEPLOY_LOCK_FILE}")" == "0:0:600:1" ]] ||
      return 1
    fd_path="/proc/self/fd/${DEPLOY_LOCK_FD}"
    [[ -f "${fd_path}" ]] || return 1
    lock_metadata="$(
      "${STAT_BIN}" -Lc '%d:%i:%u:%g:%a:%h' -- "${DEPLOY_LOCK_FILE}"
    )" || return 1
    fd_metadata="$(
      "${STAT_BIN}" -Lc '%d:%i:%u:%g:%a:%h' -- "${fd_path}"
    )" || return 1
    [[ "${fd_metadata}" == "${lock_metadata}" ]] || return 1
    "${FLOCK_BIN}" --exclusive --nonblock "${DEPLOY_LOCK_FD}" || return 1
  fi

  export CANVAS_DEPLOY_LOCK_FD="${DEPLOY_LOCK_FD}"
}

safe_absolute_file() {
  local candidate="$1"
  [[ "${candidate}" == /* && -f "${candidate}" && ! -L "${candidate}" ]] ||
    return 1
  [[ "$("${REALPATH_BIN}" -e -- "${candidate}")" == "${candidate}" ]] ||
    return 1
  trusted_root_path_chain "${candidate}"
}

pm2_worker_runtime_is_exact_from_json() {
  local name="$1"
  local expected_node_bin="$2"
  local expected_node_version="$3"
  "${NODE_BIN}" -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const [name, expectedNodeBin, expectedNodeVersion] = process.argv.slice(1);
      try {
        const matches = JSON.parse(input).filter(
          (entry) =>
            entry.name === name &&
            entry.pm2_env?.exec_interpreter === expectedNodeBin &&
            entry.pm2_env?.node_version === expectedNodeVersion &&
            Array.isArray(entry.pm2_env?.node_args) &&
            JSON.stringify(entry.pm2_env.node_args) === "[\"--\"]"
        );
        process.exit(matches.length === 1 ? 0 : 1);
      } catch {
        process.exit(2);
      }
    });
  ' "${name}" "${expected_node_bin}" "${expected_node_version}"
}

pm2_worker_is_online() {
  local name="$1"
  local script="$2"
  local lock_file="$3"
  local expected_node_bin="${4:-}"
  local expected_node_version="${5:-}"
  local first_pm2_state
  local second_pm2_state
  local first_identity
  local second_identity
  first_pm2_state="$(pm2_existing_jlist 2>/dev/null)" || return 1
  if [[ -n "${expected_node_bin}" || -n "${expected_node_version}" ]]; then
    [[ -n "${expected_node_bin}" && -n "${expected_node_version}" ]] ||
      return 1
    printf '%s' "${first_pm2_state}" |
      pm2_worker_runtime_is_exact_from_json \
        "${name}" "${expected_node_bin}" "${expected_node_version}" ||
      return 1
  fi
  first_identity="$(
    printf '%s' "${first_pm2_state}" |
      "${NODE_BIN}" -- "${READY_PROBE}" \
        --name "${name}" \
        --script "${script}" \
        --lock-file "${lock_file}"
  )" || return 1
  [[ -n "${first_identity}" ]] || return 1
  sleep 1
  second_pm2_state="$(pm2_existing_jlist 2>/dev/null)" || return 1
  if [[ -n "${expected_node_bin}" ]]; then
    printf '%s' "${second_pm2_state}" |
      pm2_worker_runtime_is_exact_from_json \
        "${name}" "${expected_node_bin}" "${expected_node_version}" ||
      return 1
  fi
  second_identity="$(
    printf '%s' "${second_pm2_state}" |
      "${NODE_BIN}" -- "${READY_PROBE}" \
        --name "${name}" \
        --script "${script}" \
        --lock-file "${lock_file}"
  )" || return 1
  [[ "${first_identity}" == "${second_identity}" ]]
}

pm2_worker_identity_is_safe() {
  local name="$1"
  local script="$2"
  pm2_existing_jlist 2>/dev/null |
    "${NODE_BIN}" -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const [name, script] = process.argv.slice(1);
        try {
          const matches = JSON.parse(input).filter((entry) => entry.name === name);
          const safe = matches.length === 0 ||
            (matches.length === 1 && matches[0].pm2_env?.pm_exec_path === script);
          process.exit(safe ? 0 : 1);
        } catch {
          process.exit(2);
        }
      });
    ' "${name}" "${script}"
}

pm2_worker_is_absent_from_json() {
  local name="$1"
  "${NODE_BIN}" -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const matches = JSON.parse(input).filter(
          (entry) => entry.name === process.argv[1]
        );
        process.exit(matches.length === 0 ? 0 : 1);
      } catch {
        process.exit(2);
      }
    });
  ' "${name}"
}

pm2_worker_is_absent() {
  local name="$1"
  pm2_existing_jlist 2>/dev/null |
    pm2_worker_is_absent_from_json "${name}" ||
    return 1
  sleep 1
  pm2_existing_jlist 2>/dev/null |
    pm2_worker_is_absent_from_json "${name}"
}

pm2_delete_and_verify_absent() {
  local name="$1"
  run_trusted_pm2 delete "${name}" >/dev/null 2>&1 ||
    pm2_worker_is_absent "${name}" ||
    return 1
  pm2_worker_is_absent "${name}"
}

pm2_worker_previous_state() {
  local name="$1"
  local script="$2"
  local lock_file="$3"
  local expected_node_bin="$4"
  local expected_node_version="$5"
  local pm2_state
  local second_pm2_state
  local first_identity
  local second_identity

  pm2_state="$(pm2_existing_jlist 2>/dev/null)" || return 1
  if printf '%s' "${pm2_state}" |
    pm2_worker_is_absent_from_json "${name}"; then
    sleep 1
    pm2_existing_jlist 2>/dev/null |
      pm2_worker_is_absent_from_json "${name}" ||
      return 1
    echo "absent"
    return 0
  fi
  printf '%s' "${pm2_state}" |
    pm2_worker_runtime_is_exact_from_json \
      "${name}" "${expected_node_bin}" "${expected_node_version}" ||
    return 1

  first_identity="$(
    printf '%s' "${pm2_state}" |
      "${NODE_BIN}" -- "${READY_PROBE}" \
        --name "${name}" \
        --script "${script}" \
        --lock-file "${lock_file}"
  )" || return 1
  [[ -n "${first_identity}" ]] || return 1
  sleep 1
  second_pm2_state="$(pm2_existing_jlist 2>/dev/null)" || return 1
  printf '%s' "${second_pm2_state}" |
    pm2_worker_runtime_is_exact_from_json \
      "${name}" "${expected_node_bin}" "${expected_node_version}" ||
    return 1
  second_identity="$(
    printf '%s' "${second_pm2_state}" |
      "${NODE_BIN}" -- "${READY_PROBE}" \
        --name "${name}" \
        --script "${script}" \
        --lock-file "${lock_file}"
  )" || return 1
  [[ "${first_identity}" == "${second_identity}" ]] || return 1
  echo "online"
}

restore_backup_atomically() {
  local backup="$1"
  local destination="$2"
  local mode="$3"
  local uid="$4"
  local gid="$5"
  local temporary

  temporary="$(mktemp "${INSTALL_DIR}/.canvas-reconciler-restore.XXXXXX")" ||
    return 1
  if ! cp -- "${backup}" "${temporary}" ||
     ! chmod "${mode}" "${temporary}" ||
     ! chown "${uid}:${gid}" "${temporary}" ||
     ! mv -f -- "${temporary}" "${destination}"; then
    rm -f -- "${temporary}" >/dev/null 2>&1 || true
    return 1
  fi
}

restore_previous_install() {
  local restore_status=0
  local pm2_restore_config=""
  local process_state_safe=0

  if ((HAD_SCRIPT == 1)); then
    restore_backup_atomically \
      "${BACKUP_SCRIPT}" "${INSTALLED_SCRIPT}" \
      "${SCRIPT_MODE}" "${SCRIPT_UID}" "${SCRIPT_GID}" ||
      restore_status=1
  else
    rm -f -- "${INSTALLED_SCRIPT}" || restore_status=1
  fi
  if ((HAD_CONFIG == 1)); then
    restore_backup_atomically \
      "${BACKUP_CONFIG}" "${PREVIOUS_CONFIG_PATH}" \
      "${CONFIG_MODE}" "${CONFIG_UID}" "${CONFIG_GID}" ||
      restore_status=1
    if ((CONFIG_WAS_LEGACY == 1)); then
      rm -f -- "${INSTALLED_CONFIG}" || restore_status=1
    else
      rm -f -- "${LEGACY_INSTALLED_CONFIG}" || restore_status=1
    fi
  else
    rm -f -- "${INSTALLED_CONFIG}" "${LEGACY_INSTALLED_CONFIG}" ||
      restore_status=1
  fi
  if ((HAD_SETTINGS == 1)); then
    restore_backup_atomically \
      "${BACKUP_SETTINGS}" "${INSTALLED_SETTINGS}" \
      "${SETTINGS_MODE}" "${SETTINGS_UID}" "${SETTINGS_GID}" ||
      restore_status=1
  else
    rm -f -- "${INSTALLED_SETTINGS}" || restore_status=1
  fi

  if ((PROCESS_UPDATED == 1)); then
    if ((restore_status != 0)); then
      if pm2_delete_and_verify_absent "${PM2_NAME}"; then
        process_state_safe=1
      else
        restore_status=1
      fi
    elif ((HAD_PROCESS == 1)); then
      if ((HAD_SCRIPT == 1 && HAD_CONFIG == 1 && HAD_SETTINGS == 1)); then
        pm2_restore_config="${PREVIOUS_CONFIG_PATH}"
        if ((CONFIG_WAS_LEGACY == 1)); then
          pm2_restore_config="$(
            mktemp "${INSTALL_DIR}/.canvas-reconciler-restore.XXXXXX.config.cjs"
          )" || restore_status=1
          if ((restore_status == 0)); then
            cp -- "${PREVIOUS_CONFIG_PATH}" "${pm2_restore_config}" ||
              restore_status=1
            chmod 0600 "${pm2_restore_config}" || restore_status=1
          fi
        fi
        if ((restore_status == 0)); then
          CANVAS_RECONCILER_SETTINGS_FILE="${INSTALLED_SETTINGS}" \
          CANVAS_NODE_BIN="${NODE_BIN}" \
            run_trusted_pm2 startOrReload "${pm2_restore_config}" \
                --only "${PM2_NAME}" --update-env >/dev/null 2>&1 ||
            restore_status=1
        fi
        if ((restore_status == 0)); then
          if pm2_worker_is_online \
            "${PM2_NAME}" "${INSTALLED_SCRIPT}" "${LOCK_FILE}" \
            "${NODE_BIN}" "${REQUIRED_NODE_VERSION}"; then
            process_state_safe=1
          else
            restore_status=1
          fi
        fi
        if ((CONFIG_WAS_LEGACY == 1 && -n "${pm2_restore_config}")); then
          rm -f -- "${pm2_restore_config}" || restore_status=1
        fi
      else
        restore_status=1
      fi
    else
      if pm2_delete_and_verify_absent "${PM2_NAME}"; then
        process_state_safe=1
      else
        restore_status=1
      fi
    fi
    if ((restore_status != 0 && process_state_safe == 0)); then
      if pm2_delete_and_verify_absent "${PM2_NAME}"; then
        process_state_safe=1
      else
        restore_status=1
      fi
    fi
    if ((process_state_safe == 1)); then
      run_trusted_pm2 save >/dev/null 2>&1 || restore_status=1
    else
      restore_status=1
    fi
  fi

  return "${restore_status}"
}

on_exit() {
  local status=$?
  trap - EXIT

  if ((status != 0 && FILES_REPLACED == 1)); then
    echo "[ROLLBACK] Restoring the previous singleton worker." >&2
    if ! restore_previous_install; then
      echo "[CRITICAL] Worker restoration failed; PM2 requires operator attention." >&2
    fi
  fi
  for staged_file in \
    "${STAGE_SCRIPT}" "${STAGE_CONFIG}" "${STAGE_SETTINGS}"; do
    if [[ -n "${staged_file}" && -e "${staged_file}" ]]; then
      rm -f -- "${staged_file}" >/dev/null 2>&1 || true
    fi
  done
  exit "${status}"
}

trap on_exit EXIT

if (($# > 0)) && [[ "$1" != --* ]]; then
  ACTION="$1"
  shift
fi

while (($# > 0)); do
  case "$1" in
    --execute)
      EXECUTE=1
      shift
      ;;
    --env-file|--url|--install-dir|--lock-file|--pm2-name|--source-script|--source-config)
      (($# >= 2)) || die "$1 requires a value"
      case "$1" in
        --env-file) ENV_FILE="$2" ;;
        --url) TARGET_URL="$2" ;;
        --install-dir) INSTALL_DIR="$2" ;;
        --lock-file) LOCK_FILE="$2" ;;
        --pm2-name) PM2_NAME="$2" ;;
        --source-script) SOURCE_SCRIPT="$2" ;;
        --source-config) SOURCE_CONFIG="$2" ;;
      esac
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown option; use --help"
      ;;
  esac
done

[[ "${ACTION}" == "plan" || "${ACTION}" == "validate" || "${ACTION}" == "install" ]] ||
  die "Action must be plan, validate, or install"
[[ "${INSTALL_DIR}" == /* && "${INSTALL_DIR}" != "/" ]] ||
  die "Install directory must be an absolute non-root path"
[[ "${LOCK_FILE}" == /* && "${LOCK_FILE}" != "/" ]] ||
  die "Lock file must be an absolute non-root path"
[[ "${PM2_NAME}" =~ ^[A-Za-z0-9._-]+$ ]] ||
  die "PM2 name contains unsupported characters"
[[ -n "${ENV_FILE}" ]] || die "--env-file is required"
[[ "${ENV_FILE}" == /* ]] || die "Env file must be absolute"
[[ -n "${TARGET_URL}" ]] || die "--url is required"

INSTALLED_SCRIPT="${INSTALL_DIR}/canvas-reconciler-worker.mjs"
INSTALLED_CONFIG="${INSTALL_DIR}/ecosystem.canvas-reconciler.config.cjs"
LEGACY_INSTALLED_CONFIG="${INSTALL_DIR}/ecosystem.canvas-reconciler.cjs"
INSTALLED_SETTINGS="${INSTALL_DIR}/canvas-reconciler.settings.json"

echo "Canvas reconciler singleton plan"
echo "  action: ${ACTION}"
echo "  mutation gate: $([[ "${EXECUTE}" == "1" ]] && echo armed || echo dry-run)"
echo "  stable PM2 name: ${PM2_NAME}"
echo "  stable install directory: ${INSTALL_DIR}"
echo "  env file: configured"
echo "  target: explicit loopback release endpoint"
echo "  lock file: ${LOCK_FILE}"

if [[ "${ACTION}" == "plan" ]]; then
  echo "[DRY RUN] No file or PM2 state was changed."
  exit 0
fi

for command in node pm2 cp mv chmod chown mkdir mktemp rm date tail sleep; do
  require_command "${command}"
done

NODE_BIN="$(resolve_trusted_root_executable node)" ||
  die "Node must resolve through a fully trusted root-owned path chain"
PM2_BIN="$(resolve_trusted_root_executable pm2)" ||
  die "PM2 must resolve through a fully trusted root-owned path chain"
for command in cp mv chmod chown mkdir mktemp rm date tail sleep; do
  pin_trusted_command "${command}" ||
    die "${command} must resolve through a fully trusted root-owned path chain"
done
NODE_VERSION="$("${NODE_BIN}" -p "process.versions.node")"
[[ "${NODE_VERSION}" == "${REQUIRED_NODE_VERSION}" ]] ||
  die "Node ${REQUIRED_NODE_VERSION} is required"
PM2_PACKAGE_ROOT="$(
  "${REALPATH_BIN}" -e -- "$("${DIRNAME_BIN}" -- "${PM2_BIN}")/.."
)" || die "Unable to resolve the PM2 package root"
[[ -d "${PM2_PACKAGE_ROOT}" && ! -L "${PM2_PACKAGE_ROOT}" ]] ||
  die "PM2 package root must be a canonical non-symlink directory"
trusted_root_path_chain "${PM2_PACKAGE_ROOT}" ||
  die "PM2 package root must have a fully trusted root-owned path chain"
PM2_DAEMON_JS="${PM2_PACKAGE_ROOT}/lib/Daemon.js"
[[ -f "${PM2_DAEMON_JS}" && ! -L "${PM2_DAEMON_JS}" ]] ||
  die "The trusted PM2 package is missing lib/Daemon.js"
trusted_root_path_chain "${PM2_DAEMON_JS}" ||
  die "PM2 Daemon.js must have a fully trusted root-owned path chain"
pm2_version="$(read_trusted_pm2_version)" ||
  die "Unable to read trusted PM2 package metadata"
[[ "${pm2_version}" == "${REQUIRED_PM2_VERSION}" ]] ||
  die "PM2 ${REQUIRED_PM2_VERSION} is required"
trusted_root_release_tree "${PM2_PACKAGE_ROOT}" ||
  die "Every PM2 package entry must be root-owned, immutable, and self-contained"
[[ "$("${REALPATH_BIN}" -e -- "${REPO_ROOT}")" == "${REPO_ROOT}" ]] ||
  die "Source release must use its canonical absolute path"
trusted_root_path_chain "${REPO_ROOT}" ||
  die "Source release must have a fully trusted root-owned path chain"
trusted_root_release_tree "${REPO_ROOT}" ||
  die "Every source release entry must be root-owned, immutable, and self-contained"

safe_absolute_file "${SOURCE_SCRIPT}" ||
  die "Worker source must be an existing absolute non-symlink file"
safe_absolute_file "${SOURCE_CONFIG}" ||
  die "PM2 config source must be an existing absolute non-symlink file"
safe_absolute_file "${READY_PROBE}" ||
  die "Reconciler readiness probe must be an existing absolute non-symlink file"
safe_absolute_file "${PM2_DAEMON_PROBE}" ||
  die "Existing-PM2-daemon identity probe must be an existing absolute non-symlink file"
safe_absolute_file "${PM2_NO_AUTOSTART_GUARD}" ||
  die "PM2 no-auto-start guard must be an existing absolute non-symlink file"
safe_absolute_file "${ENV_FILE}" ||
  die "Env file must be an existing absolute non-symlink file"
[[ "$("${STAT_BIN}" -c '%a' -- "${ENV_FILE}")" == "600" ]] ||
  die "Env file must be root-only mode 0600"
lock_parent="$("${DIRNAME_BIN}" -- "${LOCK_FILE}")"
[[ -d "${lock_parent}" && ! -L "${lock_parent}" ]] ||
  die "Lock-file parent must be an existing non-symlink directory"
[[ "$("${REALPATH_BIN}" -e -- "${lock_parent}")" == "${lock_parent}" ]] ||
  die "Lock-file parent must use its canonical absolute path"
[[ "$("${REALPATH_BIN}" -m -- "${LOCK_FILE}")" == "${LOCK_FILE}" ]] ||
  die "Lock-file path must be canonical"
trusted_root_path_chain "${lock_parent}" ||
  die "Lock-file parent must have a fully trusted root-owned path chain"

"${ENV_BIN}" -i \
  "PATH=${PATH}" \
  "HOME=${HOME}" \
  "USER=${USER}" \
  "LOGNAME=${LOGNAME}" \
  "LANG=${LANG}" \
  NODE_ENV=production \
  "${NODE_BIN}" -- "${SOURCE_SCRIPT}" \
  --dry-run \
  --env-file "${ENV_FILE}" \
  --url "${TARGET_URL}" \
  --lock-file "${LOCK_FILE}"
"${NODE_BIN}" --check "${SOURCE_SCRIPT}"
"${NODE_BIN}" --check "${READY_PROBE}"
"${NODE_BIN}" --check "${PM2_DAEMON_PROBE}"
"${NODE_BIN}" --check "${PM2_NO_AUTOSTART_GUARD}"

CANVAS_RECONCILER_PM2_NAME="${PM2_NAME}" \
CANVAS_RECONCILER_SCRIPT="${SOURCE_SCRIPT}" \
CANVAS_RECONCILER_ENV_FILE="${ENV_FILE}" \
CANVAS_RECONCILER_URL="${TARGET_URL}" \
CANVAS_RECONCILER_LOCK_FILE="${LOCK_FILE}" \
CANVAS_NODE_BIN="${NODE_BIN}" \
  "${NODE_BIN}" -e 'require(process.argv[1])' "${SOURCE_CONFIG}"

if [[ "${ACTION}" == "validate" ]]; then
  echo "[OK] Reconciler validation passed; no state was changed."
  exit 0
fi

if ((EXECUTE == 0)); then
  echo "[DRY RUN] Add --execute only after reviewing validation output."
  exit 0
fi

((EUID == 0)) ||
  die "Installation must run as the production PM2 owner (currently root)"

acquire_deploy_lock ||
  die "Another Canvas deployment is active or the deployment lock is untrusted"
[[ -d "${PM2_HOME}" && ! -L "${PM2_HOME}" ]] ||
  die "An existing trusted PM2 daemon is required; PM2_HOME is absent"
prepare_trusted_root_directory "${PM2_HOME}" 0700 ||
  die "PM2_HOME must be /root/.pm2 with a trusted root-owned 0700 path chain"
PM2_DAEMON_TOKEN="$(probe_existing_pm2_daemon token)" ||
  die "Existing PM2 daemon identity validation failed; automatic daemon startup is forbidden"
[[ -n "${PM2_DAEMON_TOKEN}" ]] ||
  die "Existing PM2 daemon identity probe returned an empty token"
prepare_trusted_root_directory "${INSTALL_DIR}" 0755 ||
  die "Install directory must be canonical, root-owned, trusted, and mode 0755"

pm2_worker_identity_is_safe "${PM2_NAME}" "${INSTALLED_SCRIPT}" ||
  die "PM2 name is duplicated or belongs to a different executable"
previous_process_state="$(
  pm2_worker_previous_state \
    "${PM2_NAME}" "${INSTALLED_SCRIPT}" "${LOCK_FILE}" \
    "${NODE_BIN}" "${REQUIRED_NODE_VERSION}"
)" ||
  die "Existing PM2 worker is neither stably absent nor one healthy online process"
if [[ "${previous_process_state}" == "online" ]]; then
  HAD_PROCESS=1
elif [[ "${previous_process_state}" != "absent" ]]; then
  die "Existing PM2 worker snapshot returned an invalid state"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -e "${INSTALLED_SCRIPT}" ]]; then
  [[ -f "${INSTALLED_SCRIPT}" && ! -L "${INSTALLED_SCRIPT}" ]] ||
    die "Installed worker path is not a trusted regular file"
  trusted_root_path_chain "${INSTALLED_SCRIPT}" ||
    die "Installed worker path has an untrusted ownership chain"
  HAD_SCRIPT=1
  SCRIPT_MODE="$("${STAT_BIN}" -c '%a' -- "${INSTALLED_SCRIPT}")"
  SCRIPT_UID="$("${STAT_BIN}" -c '%u' -- "${INSTALLED_SCRIPT}")"
  SCRIPT_GID="$("${STAT_BIN}" -c '%g' -- "${INSTALLED_SCRIPT}")"
  BACKUP_SCRIPT="$(mktemp "${INSTALL_DIR}/canvas-reconciler-worker.${timestamp}.XXXXXX.bak")"
  cp --preserve=mode,ownership,timestamps -- "${INSTALLED_SCRIPT}" "${BACKUP_SCRIPT}"
  chmod 0600 -- "${BACKUP_SCRIPT}"
fi
if [[ -e "${INSTALLED_CONFIG}" && -e "${LEGACY_INSTALLED_CONFIG}" ]]; then
  die "Both current and legacy PM2 config files exist; refusing ambiguous upgrade"
fi
if [[ -e "${INSTALLED_CONFIG}" ]]; then
  PREVIOUS_CONFIG_PATH="${INSTALLED_CONFIG}"
elif [[ -e "${LEGACY_INSTALLED_CONFIG}" ]]; then
  PREVIOUS_CONFIG_PATH="${LEGACY_INSTALLED_CONFIG}"
  CONFIG_WAS_LEGACY=1
fi
if [[ -n "${PREVIOUS_CONFIG_PATH}" ]]; then
  [[ -f "${PREVIOUS_CONFIG_PATH}" && ! -L "${PREVIOUS_CONFIG_PATH}" ]] ||
    die "Installed PM2 config path is not a trusted regular file"
  trusted_root_path_chain "${PREVIOUS_CONFIG_PATH}" ||
    die "Installed PM2 config path has an untrusted ownership chain"
  HAD_CONFIG=1
  CONFIG_MODE="$("${STAT_BIN}" -c '%a' -- "${PREVIOUS_CONFIG_PATH}")"
  CONFIG_UID="$("${STAT_BIN}" -c '%u' -- "${PREVIOUS_CONFIG_PATH}")"
  CONFIG_GID="$("${STAT_BIN}" -c '%g' -- "${PREVIOUS_CONFIG_PATH}")"
  BACKUP_CONFIG="$(mktemp "${INSTALL_DIR}/ecosystem.canvas-reconciler.${timestamp}.XXXXXX.bak")"
  cp --preserve=mode,ownership,timestamps -- "${PREVIOUS_CONFIG_PATH}" "${BACKUP_CONFIG}"
  chmod 0600 -- "${BACKUP_CONFIG}"
fi
if [[ -e "${INSTALLED_SETTINGS}" ]]; then
  [[ -f "${INSTALLED_SETTINGS}" && ! -L "${INSTALLED_SETTINGS}" ]] ||
    die "Installed settings path is not a trusted regular file"
  trusted_root_path_chain "${INSTALLED_SETTINGS}" ||
    die "Installed settings path has an untrusted ownership chain"
  HAD_SETTINGS=1
  SETTINGS_MODE="$("${STAT_BIN}" -c '%a' -- "${INSTALLED_SETTINGS}")"
  SETTINGS_UID="$("${STAT_BIN}" -c '%u' -- "${INSTALLED_SETTINGS}")"
  SETTINGS_GID="$("${STAT_BIN}" -c '%g' -- "${INSTALLED_SETTINGS}")"
  BACKUP_SETTINGS="$(mktemp "${INSTALL_DIR}/canvas-reconciler-settings.${timestamp}.XXXXXX.bak")"
  cp --preserve=mode,ownership,timestamps -- "${INSTALLED_SETTINGS}" "${BACKUP_SETTINGS}"
  chmod 0600 -- "${BACKUP_SETTINGS}"
  "${NODE_BIN}" -e '
    const fs = require("node:fs");
    const [file, expectedName, expectedScript] = process.argv.slice(1);
    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
    if (settings.name !== expectedName || settings.script !== expectedScript) {
      process.exit(1);
    }
  ' "${INSTALLED_SETTINGS}" "${PM2_NAME}" "${INSTALLED_SCRIPT}" ||
    die "Existing stable settings use a different PM2 identity"
fi
if ((HAD_PROCESS == 1)) &&
   ((HAD_SCRIPT != 1 || HAD_CONFIG != 1 || HAD_SETTINGS != 1)); then
  die "A running stable worker requires complete script, config, and settings files"
fi

STAGE_SCRIPT="$(mktemp "${INSTALL_DIR}/.canvas-reconciler.XXXXXX")"
STAGE_CONFIG="$(mktemp "${INSTALL_DIR}/.canvas-reconciler-config.XXXXXX")"
STAGE_SETTINGS="$(mktemp "${INSTALL_DIR}/.canvas-reconciler-settings.XXXXXX")"
cp -- "${SOURCE_SCRIPT}" "${STAGE_SCRIPT}"
cp -- "${SOURCE_CONFIG}" "${STAGE_CONFIG}"
"${NODE_BIN}" -e '
  const fs = require("node:fs");
  const [file, name, script, envFile, url, lockFile] = process.argv.slice(1);
  fs.writeFileSync(
    file,
    `${JSON.stringify({ name, script, envFile, url, lockFile })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
' "${STAGE_SETTINGS}" "${PM2_NAME}" "${INSTALLED_SCRIPT}" "${ENV_FILE}" "${TARGET_URL}" "${LOCK_FILE}"
chmod 0755 -- "${STAGE_SCRIPT}"
chmod 0644 -- "${STAGE_CONFIG}"
chmod 0600 -- "${STAGE_SETTINGS}"
FILES_REPLACED=1
PROCESS_UPDATED=1
mv -f -- "${STAGE_SCRIPT}" "${INSTALLED_SCRIPT}"
mv -f -- "${STAGE_CONFIG}" "${INSTALLED_CONFIG}"
mv -f -- "${STAGE_SETTINGS}" "${INSTALLED_SETTINGS}"

CANVAS_RECONCILER_SETTINGS_FILE="${INSTALLED_SETTINGS}" \
CANVAS_NODE_BIN="${NODE_BIN}" \
  run_trusted_pm2 startOrReload "${INSTALLED_CONFIG}" \
      --only "${PM2_NAME}" --update-env

pm2_worker_is_online \
  "${PM2_NAME}" "${INSTALLED_SCRIPT}" "${LOCK_FILE}" \
  "${NODE_BIN}" "${REQUIRED_NODE_VERSION}" ||
  die "PM2 did not expose exactly one healthy fork-mode reconciler"

if [[ -e "${LEGACY_INSTALLED_CONFIG}" ]]; then
  [[ -f "${LEGACY_INSTALLED_CONFIG}" && ! -L "${LEGACY_INSTALLED_CONFIG}" ]] ||
    die "Legacy PM2 config path is not a trusted regular file"
  trusted_root_path_chain "${LEGACY_INSTALLED_CONFIG}" ||
    die "Legacy PM2 config path has an untrusted ownership chain"
  rm -f -- "${LEGACY_INSTALLED_CONFIG}"
fi

run_trusted_pm2 save
FILES_REPLACED=0

echo "[OK] Stable Canvas reconciler installed and online as one PM2 process."
echo "[INFO] The bearer secret was loaded only by the worker from its env file."
