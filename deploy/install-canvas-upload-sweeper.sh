#!/bin/bash -p
#
# Install the Canvas upload lifecycle as a hardened systemd timer.
# Validation is read-only; installation requires both `install` and --execute.

set -Eeuo pipefail
IFS=$'\n\t'

case "$-" in
  *p*) ;;
  *)
    echo "[FAIL] Installer must run via its privileged /bin/bash -p entrypoint." >&2
    exit 1
    ;;
esac

# Root automation must never inherit executable resolution from the caller.
declare -rx PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"
readonly STAT_BIN="/usr/bin/stat"
readonly DIRNAME_BIN="/usr/bin/dirname"
readonly REALPATH_BIN="/usr/bin/realpath"
readonly SYSTEMCTL_BIN="/usr/bin/systemctl"

# Never let caller-controlled Node flags affect interpreter validation or work.
unset BASH_ENV ENV CDPATH GLOBIGNORE NODE_OPTIONS
declare -rx BASH_ENV=""
declare -rx ENV=""
declare -rx NODE_OPTIONS=""

ACTION="${1:-validate}"
if (($# > 0)); then shift; fi
EXECUTE=0
RELEASE_DIR=""
ENV_FILE=""
INTERVAL_MINUTES=15
SERVICE_NAME="stargaze-canvas-upload-sweeper"
UNIT_DIR="/etc/systemd/system"

usage() {
  cat <<'USAGE'
Usage:
  deploy/install-canvas-upload-sweeper.sh validate|install [options]

Required:
  --release-dir <absolute>  Immutable release containing the sweeper script
  --env-file <absolute>     Root-owned, non-symlink production .env.local

Options:
  --interval-minutes <n>    5..1440 (default: 15)
  --execute                 Required for installation
  --help                    Show this help

No option accepts a credential. Validation never prints environment values.
USAGE
}

die() {
  echo "[FAIL] $*" >&2
  exit 1
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
  command_parent="$("${REALPATH_BIN}" -e -- "$("${DIRNAME_BIN}" -- "${command_path}")")" ||
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

while (($# > 0)); do
  case "$1" in
    --release-dir|--env-file|--interval-minutes)
      (($# >= 2)) || die "$1 requires a value"
      case "$1" in
        --release-dir) RELEASE_DIR="$2" ;;
        --env-file) ENV_FILE="$2" ;;
        --interval-minutes) INTERVAL_MINUTES="$2" ;;
      esac
      shift 2
      ;;
    --execute)
      EXECUTE=1
      shift
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

[[ "${ACTION}" == "validate" || "${ACTION}" == "install" ]] ||
  die "Action must be validate or install"
[[ "${RELEASE_DIR}" == /* && "${RELEASE_DIR}" != "/" ]] ||
  die "--release-dir must be an absolute non-root path"
[[ "${ENV_FILE}" == /* && "${ENV_FILE}" != "/" ]] ||
  die "--env-file must be an absolute non-root path"
[[ "${RELEASE_DIR}" =~ ^/[A-Za-z0-9_./-]+$ ]] ||
  die "--release-dir contains unsupported systemd path characters"
[[ "${ENV_FILE}" =~ ^/[A-Za-z0-9_./-]+$ ]] ||
  die "--env-file contains unsupported systemd path characters"
[[ "${INTERVAL_MINUTES}" =~ ^[0-9]+$ ]] ||
  die "--interval-minutes must be an integer"
((INTERVAL_MINUTES >= 5 && INTERVAL_MINUTES <= 1440)) ||
  die "--interval-minutes must be between 5 and 1440"

for helper in "${STAT_BIN}" "${DIRNAME_BIN}" "${REALPATH_BIN}" "${SYSTEMCTL_BIN}"; do
  [[ -f "${helper}" && ! -L "${helper}" && -x "${helper}" ]] ||
    die "A required bootstrap helper is unavailable"
done
for command in node; do
  command -v "${command}" >/dev/null 2>&1 ||
    die "Required command is unavailable: ${command}"
done

RELEASE_DIR="${RELEASE_DIR%/}"
[[ -d "${RELEASE_DIR}" && ! -L "${RELEASE_DIR}" ]] ||
  die "Release directory must be an existing non-symlink directory"
[[ "$("${REALPATH_BIN}" -e -- "${RELEASE_DIR}")" == "${RELEASE_DIR}" ]] ||
  die "Release directory must use its canonical path"

SWEEPER="${RELEASE_DIR}/scripts/sweep-canvas-upload-reservations.mjs"
[[ -f "${SWEEPER}" && ! -L "${SWEEPER}" ]] ||
  die "Upload sweeper is missing or is a symlink"
trusted_root_path_chain "${RELEASE_DIR}" ||
  die "Release directory must be root-owned with a trusted path chain"
trusted_root_path_chain "${SWEEPER}" ||
  die "Upload sweeper must be root-owned with a trusted path chain"

RUNTIME_MODULES="${RELEASE_DIR}/node_modules"
[[ -d "${RUNTIME_MODULES}" && ! -L "${RUNTIME_MODULES}" ]] ||
  die "Runtime dependency tree must be an existing non-symlink directory"
[[ "$("${REALPATH_BIN}" -e -- "${RUNTIME_MODULES}")" == "${RUNTIME_MODULES}" ]] ||
  die "Runtime dependency tree must use its canonical path"
trusted_root_path_chain "${RUNTIME_MODULES}" ||
  die "Runtime dependency tree root must have a trusted path chain"

[[ -f "${ENV_FILE}" && ! -L "${ENV_FILE}" ]] ||
  die "Environment file must be an existing non-symlink regular file"
[[ "$("${REALPATH_BIN}" -e -- "${ENV_FILE}")" == "${ENV_FILE}" ]] ||
  die "Environment file must use its canonical path"
trusted_root_path_chain "${ENV_FILE}" ||
  die "Environment file must have a fully trusted root-owned path chain"
[[ "$("${STAT_BIN}" -c '%u' -- "${ENV_FILE}")" == "0" ]] ||
  die "Environment file must be root-owned"
ENV_MODE="$("${STAT_BIN}" -c '%a' -- "${ENV_FILE}")"
[[ "${ENV_MODE}" =~ ^[0-7]{3,4}$ ]] ||
  die "Environment file permissions are invalid"
(( (8#${ENV_MODE} & 077) == 0 )) ||
  die "Environment file must not grant group or other permissions"

NODE_BIN="$(resolve_trusted_root_executable node)" ||
  die "Node must resolve through a fully trusted root-owned path chain"
[[ "${NODE_BIN}" =~ ^/[A-Za-z0-9_./-]+$ ]] ||
  die "Node path contains unsupported systemd characters"
NODE_VERSION="$("${NODE_BIN}" -p "process.versions.node")"
[[ "${NODE_VERSION}" == "24.18.0" ]] ||
  die "Node 24.18.0 is required"
"${NODE_BIN}" -e '
  const { lstatSync, readdirSync, realpathSync } = require("node:fs");
  const { join, sep } = require("node:path");
  try {
    const root = realpathSync(process.argv[1]);
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    const pending = [root];
    while (pending.length > 0) {
      const current = pending.pop();
      const entry = lstatSync(current);
      if (entry.isSymbolicLink()) {
        const target = realpathSync(current);
        if (entry.uid !== 0 || (target !== root && !target.startsWith(prefix))) {
          process.exit(1);
        }
        continue;
      }
      if (entry.uid !== 0 || (entry.mode & 0o022) !== 0) process.exit(1);
      if (entry.isDirectory()) {
        for (const name of readdirSync(current)) pending.push(join(current, name));
      } else if (!entry.isFile()) {
        process.exit(1);
      }
    }
  } catch {
    process.exit(1);
  }
' "${RUNTIME_MODULES}" ||
  die "Runtime dependency tree must be root-owned, immutable, and self-contained"
"${NODE_BIN}" --check "${SWEEPER}"

"${NODE_BIN}" -- "${SWEEPER}" --env-file "${ENV_FILE}" --dry-run

echo "Canvas upload sweeper plan"
echo "  action: ${ACTION}"
echo "  mutation gate: $([[ "${EXECUTE}" == "1" ]] && echo armed || echo dry-run)"
echo "  release: ${RELEASE_DIR}"
echo "  environment file: protected"
echo "  Node.js: ${NODE_VERSION}"
echo "  interval minutes: ${INTERVAL_MINUTES}"

if [[ "${ACTION}" == "validate" || "${EXECUTE}" == "0" ]]; then
  echo "[DRY RUN] No systemd state was changed."
  exit 0
fi

((EUID == 0)) || die "Installation must run as root"
[[ -d "${UNIT_DIR}" && ! -L "${UNIT_DIR}" ]] ||
  die "systemd unit directory is unavailable"
trusted_root_path_chain "${UNIT_DIR}" ||
  die "systemd unit directory must have a fully trusted root-owned path chain"

SERVICE_PATH="${UNIT_DIR}/${SERVICE_NAME}.service"
TIMER_PATH="${UNIT_DIR}/${SERVICE_NAME}.timer"
TEMP_SERVICE=""
TEMP_TIMER=""
BACKUP_DIR=""
SERVICE_PATH_EXISTED=0
TIMER_PATH_EXISTED=0
SERVICE_ENABLE_STATE="not-found"
TIMER_ENABLE_STATE="not-found"
SERVICE_LOAD_STATE="not-found"
TIMER_LOAD_STATE="not-found"
SERVICE_ACTIVE_STATE="inactive"
TIMER_ACTIVE_STATE="inactive"
SERVICE_UNIT_EXISTS=0
TIMER_UNIT_EXISTS=0
TXN_ACTIVE=0
TXN_COMMITTED=0
FILES_REPLACED=0
SERVICE_START_ATTEMPTED=0
TIMER_ENABLE_ATTEMPTED=0

state_is_enabled() {
  case "$1" in
    enabled|enabled-runtime) return 0 ;;
    *) return 1 ;;
  esac
}

state_is_active() {
  case "$1" in
    active) return 0 ;;
    *) return 1 ;;
  esac
}

capture_enabled_state() {
  local unit="$1"
  local state=""
  state="$("${SYSTEMCTL_BIN}" is-enabled "${unit}" 2>/dev/null)" || :
  case "${state}" in
    enabled|enabled-runtime|linked|linked-runtime|alias|masked|masked-runtime|\
static|indirect|disabled|generated|transient|bad|not-found)
      printf '%s' "${state}"
      ;;
    *)
      return 1
      ;;
  esac
}

capture_active_state() {
  local unit="$1"
  local state=""
  state="$(
    "${SYSTEMCTL_BIN}" show "${unit}" --property=ActiveState --value 2>/dev/null
  )" || return 1
  case "${state}" in
    active|inactive)
      printf '%s' "${state}"
      ;;
    *)
      return 1
      ;;
  esac
}

capture_load_state() {
  local unit="$1"
  local state=""
  state="$(
    "${SYSTEMCTL_BIN}" show "${unit}" --property=LoadState --value 2>/dev/null
  )" || return 1
  case "${state}" in
    loaded|not-found)
      printf '%s' "${state}"
      ;;
    *)
      return 1
      ;;
  esac
}

disable_enabled_state() {
  local unit="$1"
  local state="$2"
  case "${state}" in
    enabled-runtime)
      "${SYSTEMCTL_BIN}" disable --runtime "${unit}"
      ;;
    enabled)
      "${SYSTEMCTL_BIN}" disable "${unit}"
      ;;
  esac
}

restore_enabled_state() {
  local unit="$1"
  local state="$2"
  case "${state}" in
    enabled-runtime)
      "${SYSTEMCTL_BIN}" enable --runtime "${unit}"
      ;;
    enabled)
      "${SYSTEMCTL_BIN}" enable "${unit}"
      ;;
  esac
}

cleanup_install_artifacts() {
  local preserve_backup="${1:-0}"
  local failed=0
  if [[ -n "${TEMP_SERVICE}" ]] && ! rm -f -- "${TEMP_SERVICE}"; then
    failed=1
  fi
  if [[ -n "${TEMP_TIMER}" ]] && ! rm -f -- "${TEMP_TIMER}"; then
    failed=1
  fi
  if [[ -n "${BACKUP_DIR}" ]]; then
    case "${BACKUP_DIR}" in
      "${UNIT_DIR}/.${SERVICE_NAME}.rollback."*)
        if ((preserve_backup == 1)); then
          echo "[RECOVERY] Root-only rollback backup retained at: ${BACKUP_DIR}" >&2
          echo "[RECOVERY] Reconcile systemd state manually before retrying." >&2
        else
          rm -rf -- "${BACKUP_DIR}" || failed=1
        fi
        ;;
      *)
        echo "[FAIL] Unexpected rollback path retained for manual recovery." >&2
        failed=1
        ;;
    esac
  fi
  return "${failed}"
}

rollback_installation() {
  local failed=0
  local restore_files_ok=1
  local reload_ok=1

  echo "[ROLLBACK] Restoring the previous Canvas upload sweeper installation." >&2

  if ((TIMER_ENABLE_ATTEMPTED == 1)); then
    "${SYSTEMCTL_BIN}" disable --now "${SERVICE_NAME}.timer" >/dev/null 2>&1 ||
      failed=1
  elif ((TIMER_UNIT_EXISTS == 1)); then
    "${SYSTEMCTL_BIN}" stop "${SERVICE_NAME}.timer" >/dev/null 2>&1 ||
      failed=1
  fi
  if ((SERVICE_START_ATTEMPTED == 1)); then
    "${SYSTEMCTL_BIN}" stop "${SERVICE_NAME}.service" >/dev/null 2>&1 ||
      failed=1
  elif ((SERVICE_UNIT_EXISTS == 1)); then
    "${SYSTEMCTL_BIN}" stop "${SERVICE_NAME}.service" >/dev/null 2>&1 ||
      failed=1
  fi

  if ((FILES_REPLACED == 1)); then
    if ! rm -f -- "${SERVICE_PATH}" "${TIMER_PATH}"; then
      restore_files_ok=0
      failed=1
    fi
    if ((restore_files_ok == 1 && SERVICE_PATH_EXISTED == 1)); then
      if ! cp -a -- "${BACKUP_DIR}/service" "${SERVICE_PATH}"; then
        restore_files_ok=0
        failed=1
      fi
    fi
    if ((restore_files_ok == 1 && TIMER_PATH_EXISTED == 1)); then
      if ! cp -a -- "${BACKUP_DIR}/timer" "${TIMER_PATH}"; then
        restore_files_ok=0
        failed=1
      fi
    fi
    if ((restore_files_ok == 1)); then
      if ! "${SYSTEMCTL_BIN}" daemon-reload; then
        reload_ok=0
        failed=1
      fi
    else
      reload_ok=0
    fi
  fi

  if ((restore_files_ok == 1 && reload_ok == 1)); then
    restore_enabled_state "${SERVICE_NAME}.service" "${SERVICE_ENABLE_STATE}" ||
      failed=1
    restore_enabled_state "${SERVICE_NAME}.timer" "${TIMER_ENABLE_STATE}" ||
      failed=1

    if state_is_active "${SERVICE_ACTIVE_STATE}"; then
      "${SYSTEMCTL_BIN}" start "${SERVICE_NAME}.service" || failed=1
    fi
    if state_is_active "${TIMER_ACTIVE_STATE}"; then
      "${SYSTEMCTL_BIN}" start "${SERVICE_NAME}.timer" || failed=1
    fi
  else
    echo \
      "[RECOVERY] Unit files or daemon state are unsafe; previous units were not restarted." \
      >&2
  fi

  if ((failed == 0)); then
    echo "[ROLLBACK] Previous unit files and enabled/active state restored." >&2
  else
    echo "[FAIL] Rollback was incomplete; manual recovery is required." >&2
  fi
  return "${failed}"
}

on_exit() {
  local status=$?
  local rollback_status=0
  local cleanup_status=0
  local preserve_backup=0
  trap - EXIT
  set +e

  if ((TXN_ACTIVE == 1 && TXN_COMMITTED == 0)); then
    if ((status == 0)); then
      echo "[FAIL] Installation exited before the transaction committed." >&2
      status=1
    fi
    rollback_installation
    rollback_status=$?
    if ((rollback_status != 0)); then
      preserve_backup=1
    fi
  fi
  cleanup_install_artifacts "${preserve_backup}"
  cleanup_status=$?

  if ((rollback_status != 0 || cleanup_status != 0)); then
    status=1
  fi
  exit "${status}"
}
trap on_exit EXIT

TEMP_SERVICE="$(mktemp "${UNIT_DIR}/.${SERVICE_NAME}.service.XXXXXX")"
TEMP_TIMER="$(mktemp "${UNIT_DIR}/.${SERVICE_NAME}.timer.XXXXXX")"
BACKUP_DIR="$(mktemp -d "${UNIT_DIR}/.${SERVICE_NAME}.rollback.XXXXXX")"
chown root:root "${BACKUP_DIR}"
chmod 0700 "${BACKUP_DIR}"

cat >"${TEMP_SERVICE}" <<EOF
[Unit]
Description=StarGaze Canvas upload reservation and orphan cleanup
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
Group=root
UMask=0077
Environment=NODE_OPTIONS=
UnsetEnvironment=NODE_OPTIONS
WorkingDirectory=${RELEASE_DIR}
ExecStartPre=${NODE_BIN} -e 'process.exit(process.versions.node==="24.18.0"?0:1)'
ExecStart=${NODE_BIN} -- ${SWEEPER} --env-file ${ENV_FILE} --limit 100
TimeoutStartSec=20min
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=read-only
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
EOF

cat >"${TEMP_TIMER}" <<EOF
[Unit]
Description=Run StarGaze Canvas upload cleanup periodically

[Timer]
OnBootSec=5min
OnUnitActiveSec=${INTERVAL_MINUTES}min
RandomizedDelaySec=60
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
EOF

chown root:root "${TEMP_SERVICE}" "${TEMP_TIMER}"
chmod 0644 "${TEMP_SERVICE}" "${TEMP_TIMER}"

if [[ -e "${SERVICE_PATH}" || -L "${SERVICE_PATH}" ]]; then
  [[ -f "${SERVICE_PATH}" || -L "${SERVICE_PATH}" ]] ||
    die "Existing service unit path has an unsupported file type"
  SERVICE_PATH_EXISTED=1
  cp -a -- "${SERVICE_PATH}" "${BACKUP_DIR}/service"
fi
if [[ -e "${TIMER_PATH}" || -L "${TIMER_PATH}" ]]; then
  [[ -f "${TIMER_PATH}" || -L "${TIMER_PATH}" ]] ||
    die "Existing timer unit path has an unsupported file type"
  TIMER_PATH_EXISTED=1
  cp -a -- "${TIMER_PATH}" "${BACKUP_DIR}/timer"
fi

SERVICE_ENABLE_STATE="$(
  capture_enabled_state "${SERVICE_NAME}.service"
)" || die "Unable to snapshot the existing service enablement state"
TIMER_ENABLE_STATE="$(
  capture_enabled_state "${SERVICE_NAME}.timer"
)" || die "Unable to snapshot the existing timer enablement state"
SERVICE_LOAD_STATE="$(
  capture_load_state "${SERVICE_NAME}.service"
)" || die "Unable to snapshot the existing service load state"
TIMER_LOAD_STATE="$(
  capture_load_state "${SERVICE_NAME}.timer"
)" || die "Unable to snapshot the existing timer load state"
if [[ "${SERVICE_LOAD_STATE}" == "loaded" ]]; then
  SERVICE_UNIT_EXISTS=1
  SERVICE_ACTIVE_STATE="$(
    capture_active_state "${SERVICE_NAME}.service"
  )" || die "Unable to snapshot the existing service activity state"
fi
if [[ "${TIMER_LOAD_STATE}" == "loaded" ]]; then
  TIMER_UNIT_EXISTS=1
  TIMER_ACTIVE_STATE="$(
    capture_active_state "${SERVICE_NAME}.timer"
  )" || die "Unable to snapshot the existing timer activity state"
fi
if [[
  ("${SERVICE_LOAD_STATE}" == "not-found" &&
    "${SERVICE_ENABLE_STATE}" != "not-found") ||
  ("${SERVICE_LOAD_STATE}" != "not-found" &&
    "${SERVICE_ENABLE_STATE}" == "not-found")
]]; then
  die "Service load and unit-file state are inconsistent"
fi
if [[
  ("${TIMER_LOAD_STATE}" == "not-found" &&
    "${TIMER_ENABLE_STATE}" != "not-found") ||
  ("${TIMER_LOAD_STATE}" != "not-found" &&
    "${TIMER_ENABLE_STATE}" == "not-found")
]]; then
  die "Timer load and unit-file state are inconsistent"
fi

TXN_ACTIVE=1
if ((TIMER_UNIT_EXISTS == 1)); then
  "${SYSTEMCTL_BIN}" stop "${SERVICE_NAME}.timer"
fi
if state_is_enabled "${TIMER_ENABLE_STATE}"; then
  disable_enabled_state "${SERVICE_NAME}.timer" "${TIMER_ENABLE_STATE}"
fi
if ((SERVICE_UNIT_EXISTS == 1)); then
  "${SYSTEMCTL_BIN}" stop "${SERVICE_NAME}.service"
fi
if state_is_enabled "${SERVICE_ENABLE_STATE}"; then
  disable_enabled_state "${SERVICE_NAME}.service" "${SERVICE_ENABLE_STATE}"
fi
if ((TIMER_UNIT_EXISTS == 1)); then
  [[ "$(capture_active_state "${SERVICE_NAME}.timer")" == "inactive" ]] ||
    die "Existing upload sweeper timer could not be quiesced"
fi
if ((SERVICE_UNIT_EXISTS == 1)); then
  [[ "$(capture_active_state "${SERVICE_NAME}.service")" == "inactive" ]] ||
    die "Existing upload sweeper service could not be quiesced"
fi

FILES_REPLACED=1
mv -f -- "${TEMP_SERVICE}" "${SERVICE_PATH}"
TEMP_SERVICE=""
mv -f -- "${TEMP_TIMER}" "${TIMER_PATH}"
TEMP_TIMER=""

"${SYSTEMCTL_BIN}" daemon-reload
[[ "$(capture_load_state "${SERVICE_NAME}.service")" == "loaded" ]] ||
  die "New upload sweeper service was not loaded"
[[ "$(capture_active_state "${SERVICE_NAME}.service")" == "inactive" ]] ||
  die "New upload sweeper service was not inactive before its first cycle"
SERVICE_START_ATTEMPTED=1
"${SYSTEMCTL_BIN}" start "${SERVICE_NAME}.service"

TIMER_ENABLE_ATTEMPTED=1
"${SYSTEMCTL_BIN}" enable --now "${SERVICE_NAME}.timer"
"${SYSTEMCTL_BIN}" is-active --quiet "${SERVICE_NAME}.timer" ||
  die "Upload sweeper timer is not active"

TXN_COMMITTED=1
echo "[OK] Canvas upload sweeper timer is installed and its initial cycle passed."
