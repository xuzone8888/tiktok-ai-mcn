#!/usr/bin/env bash
#
# Installs one release-independent Canvas reconciliation worker. The worker
# secret remains in the caller-selected root-owned env file; it is never put
# in PM2 metadata, command arguments, or this installation directory.

set -Eeuo pipefail
IFS=$'\n\t'
unset NODE_OPTIONS

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

ACTION="plan"
EXECUTE=0
SOURCE_SCRIPT="${REPO_ROOT}/scripts/canvas-reconciler-worker.mjs"
SOURCE_CONFIG="${REPO_ROOT}/deploy/ecosystem.canvas-reconciler.config.cjs"
READY_PROBE="${REPO_ROOT}/scripts/probe-canvas-reconciler-readiness.mjs"
INSTALL_DIR="${CANVAS_RECONCILER_INSTALL_DIR:-/opt/stargaze-canvas-reconciler}"
ENV_FILE="${CANVAS_RECONCILER_ENV_FILE:-}"
TARGET_URL="${CANVAS_RECONCILER_URL:-}"
LOCK_FILE="${CANVAS_RECONCILER_LOCK_FILE:-/run/stargaze-canvas-reconciler.lock}"
PM2_NAME="${CANVAS_RECONCILER_PM2_NAME:-stargaze-canvas-reconciler}"

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

run_pm2_with_clean_environment() {
  local pm2_home="${PM2_HOME:-${HOME:-/root}/.pm2}"
  local variable_name
  local -a pm2_environment_command=(
    env -i
    "PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" \
    "HOME=${HOME:-/root}" \
    "USER=${USER:-root}" \
    "LOGNAME=${LOGNAME:-root}" \
    "LANG=${LANG:-C.UTF-8}" \
    "PM2_HOME=${pm2_home}"
  )
  for variable_name in \
    CANVAS_PM2_NAME CANVAS_APP_DIR CANVAS_PORT CANVAS_ENV_FILE \
    CANVAS_RECONCILER_SETTINGS_FILE; do
    if [[ -v "${variable_name}" && -n "${!variable_name}" ]]; then
      pm2_environment_command+=("${variable_name}=${!variable_name}")
    fi
  done
  "${pm2_environment_command[@]}" "$@"
}

safe_absolute_file() {
  local candidate="$1"
  [[ "${candidate}" == /* && -f "${candidate}" && ! -L "${candidate}" ]]
}

pm2_worker_is_online() {
  local name="$1"
  local script="$2"
  local lock_file="$3"
  local first_identity
  local second_identity
  first_identity="$(
    pm2 jlist 2>/dev/null |
      node "${READY_PROBE}" \
        --name "${name}" \
        --script "${script}" \
        --lock-file "${lock_file}"
  )" || return 1
  [[ -n "${first_identity}" ]] || return 1
  sleep 1
  second_identity="$(
    pm2 jlist 2>/dev/null |
      node "${READY_PROBE}" \
        --name "${name}" \
        --script "${script}" \
        --lock-file "${lock_file}"
  )" || return 1
  [[ "${first_identity}" == "${second_identity}" ]]
}

pm2_worker_identity_is_safe() {
  local name="$1"
  local script="$2"
  pm2 jlist 2>/dev/null |
    node -e '
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
  node -e '
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
  pm2 jlist 2>/dev/null |
    pm2_worker_is_absent_from_json "${name}" ||
    return 1
  sleep 1
  pm2 jlist 2>/dev/null |
    pm2_worker_is_absent_from_json "${name}"
}

pm2_delete_and_verify_absent() {
  local name="$1"
  pm2 delete "${name}" >/dev/null 2>&1 ||
    pm2_worker_is_absent "${name}" ||
    return 1
  pm2_worker_is_absent "${name}"
}

pm2_worker_previous_state() {
  local name="$1"
  local script="$2"
  local lock_file="$3"
  local pm2_state
  local first_identity
  local second_identity

  pm2_state="$(pm2 jlist 2>/dev/null)" || return 1
  if printf '%s' "${pm2_state}" |
    pm2_worker_is_absent_from_json "${name}"; then
    sleep 1
    pm2 jlist 2>/dev/null |
      pm2_worker_is_absent_from_json "${name}" ||
      return 1
    echo "absent"
    return 0
  fi

  first_identity="$(
    printf '%s' "${pm2_state}" |
      node "${READY_PROBE}" \
        --name "${name}" \
        --script "${script}" \
        --lock-file "${lock_file}"
  )" || return 1
  [[ -n "${first_identity}" ]] || return 1
  sleep 1
  second_identity="$(
    pm2 jlist 2>/dev/null |
      node "${READY_PROBE}" \
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
            run_pm2_with_clean_environment \
              "$(command -v pm2)" startOrReload "${pm2_restore_config}" \
                --only "${PM2_NAME}" --update-env >/dev/null 2>&1 ||
            restore_status=1
        fi
        if ((restore_status == 0)); then
          if pm2_worker_is_online \
            "${PM2_NAME}" "${INSTALLED_SCRIPT}" "${LOCK_FILE}"; then
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
      pm2 save >/dev/null 2>&1 || restore_status=1
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

for command in node pm2 env cp mv chmod chown mkdir mktemp dirname rm date stat tail sleep; do
  require_command "${command}"
done

pm2_version="$(pm2 -v | tail -n 1)"
node -e '
  const [major, minor] = process.argv[1].split(".").map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) ||
      major < 4 || (major === 4 && minor < 3)) process.exit(1);
' "${pm2_version}" || die "PM2 >=4.3 is required"

safe_absolute_file "${SOURCE_SCRIPT}" ||
  die "Worker source must be an existing absolute non-symlink file"
safe_absolute_file "${SOURCE_CONFIG}" ||
  die "PM2 config source must be an existing absolute non-symlink file"
safe_absolute_file "${READY_PROBE}" ||
  die "Reconciler readiness probe must be an existing absolute non-symlink file"
safe_absolute_file "${ENV_FILE}" ||
  die "Env file must be an existing absolute non-symlink file"

env -i \
  "PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" \
  "HOME=${HOME:-/root}" \
  "USER=${USER:-root}" \
  "LOGNAME=${LOGNAME:-root}" \
  "LANG=${LANG:-C.UTF-8}" \
  NODE_ENV=production \
  "$(command -v node)" "${SOURCE_SCRIPT}" \
  --dry-run \
  --env-file "${ENV_FILE}" \
  --url "${TARGET_URL}" \
  --lock-file "${LOCK_FILE}"
node --check "${SOURCE_SCRIPT}"
node --check "${READY_PROBE}"

CANVAS_RECONCILER_PM2_NAME="${PM2_NAME}" \
CANVAS_RECONCILER_SCRIPT="${SOURCE_SCRIPT}" \
CANVAS_RECONCILER_ENV_FILE="${ENV_FILE}" \
CANVAS_RECONCILER_URL="${TARGET_URL}" \
CANVAS_RECONCILER_LOCK_FILE="${LOCK_FILE}" \
  node -e 'require(process.argv[1])' "${SOURCE_CONFIG}"

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

mkdir -p -- "${INSTALL_DIR}"
chmod 0755 -- "${INSTALL_DIR}"

pm2_worker_identity_is_safe "${PM2_NAME}" "${INSTALLED_SCRIPT}" ||
  die "PM2 name is duplicated or belongs to a different executable"
previous_process_state="$(
  pm2_worker_previous_state "${PM2_NAME}" "${INSTALLED_SCRIPT}" "${LOCK_FILE}"
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
  HAD_SCRIPT=1
  SCRIPT_MODE="$(stat -c '%a' -- "${INSTALLED_SCRIPT}")"
  SCRIPT_UID="$(stat -c '%u' -- "${INSTALLED_SCRIPT}")"
  SCRIPT_GID="$(stat -c '%g' -- "${INSTALLED_SCRIPT}")"
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
  HAD_CONFIG=1
  CONFIG_MODE="$(stat -c '%a' -- "${PREVIOUS_CONFIG_PATH}")"
  CONFIG_UID="$(stat -c '%u' -- "${PREVIOUS_CONFIG_PATH}")"
  CONFIG_GID="$(stat -c '%g' -- "${PREVIOUS_CONFIG_PATH}")"
  BACKUP_CONFIG="$(mktemp "${INSTALL_DIR}/ecosystem.canvas-reconciler.${timestamp}.XXXXXX.bak")"
  cp --preserve=mode,ownership,timestamps -- "${PREVIOUS_CONFIG_PATH}" "${BACKUP_CONFIG}"
  chmod 0600 -- "${BACKUP_CONFIG}"
fi
if [[ -e "${INSTALLED_SETTINGS}" ]]; then
  [[ -f "${INSTALLED_SETTINGS}" && ! -L "${INSTALLED_SETTINGS}" ]] ||
    die "Installed settings path is not a trusted regular file"
  HAD_SETTINGS=1
  SETTINGS_MODE="$(stat -c '%a' -- "${INSTALLED_SETTINGS}")"
  SETTINGS_UID="$(stat -c '%u' -- "${INSTALLED_SETTINGS}")"
  SETTINGS_GID="$(stat -c '%g' -- "${INSTALLED_SETTINGS}")"
  BACKUP_SETTINGS="$(mktemp "${INSTALL_DIR}/canvas-reconciler-settings.${timestamp}.XXXXXX.bak")"
  cp --preserve=mode,ownership,timestamps -- "${INSTALLED_SETTINGS}" "${BACKUP_SETTINGS}"
  chmod 0600 -- "${BACKUP_SETTINGS}"
  node -e '
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
node -e '
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
  run_pm2_with_clean_environment \
    "$(command -v pm2)" startOrReload "${INSTALLED_CONFIG}" \
      --only "${PM2_NAME}" --update-env

pm2_worker_is_online "${PM2_NAME}" "${INSTALLED_SCRIPT}" "${LOCK_FILE}" ||
  die "PM2 did not expose exactly one healthy fork-mode reconciler"

if [[ -e "${LEGACY_INSTALLED_CONFIG}" ]]; then
  [[ -f "${LEGACY_INSTALLED_CONFIG}" && ! -L "${LEGACY_INSTALLED_CONFIG}" ]] ||
    die "Legacy PM2 config path is not a trusted regular file"
  rm -f -- "${LEGACY_INSTALLED_CONFIG}"
fi

pm2 save
FILES_REPLACED=0

echo "[OK] Stable Canvas reconciler installed and online as one PM2 process."
echo "[INFO] The bearer secret was loaded only by the worker from its env file."
