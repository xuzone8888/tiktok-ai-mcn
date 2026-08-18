#!/usr/bin/env bash
#
# Install the Canvas upload lifecycle as a hardened systemd timer.
# Validation is read-only; installation requires both `install` and --execute.

set -Eeuo pipefail
IFS=$'\n\t'

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

for command in cat chmod chown cmp cp flock mktemp mv node realpath rm rmdir stat systemctl; do
  command -v "${command}" >/dev/null 2>&1 ||
    die "Required command is unavailable: ${command}"
done

RELEASE_DIR="${RELEASE_DIR%/}"
[[ -d "${RELEASE_DIR}" && ! -L "${RELEASE_DIR}" ]] ||
  die "Release directory must be an existing non-symlink directory"
[[ "$(realpath -e -- "${RELEASE_DIR}")" == "${RELEASE_DIR}" ]] ||
  die "Release directory must use its canonical path"

SWEEPER="${RELEASE_DIR}/scripts/sweep-canvas-upload-reservations.mjs"
[[ -f "${SWEEPER}" && ! -L "${SWEEPER}" ]] ||
  die "Upload sweeper is missing or is a symlink"
node --check "${SWEEPER}"

[[ -f "${ENV_FILE}" && ! -L "${ENV_FILE}" ]] ||
  die "Environment file must be an existing non-symlink regular file"
[[ "$(realpath -e -- "${ENV_FILE}")" == "${ENV_FILE}" ]] ||
  die "Environment file must use its canonical path"
[[ "$(stat -c '%u' -- "${ENV_FILE}")" == "0" ]] ||
  die "Environment file must be root-owned"
ENV_MODE="$(stat -c '%a' -- "${ENV_FILE}")"
[[ "${ENV_MODE}" =~ ^[0-7]{3,4}$ ]] ||
  die "Environment file permissions are invalid"
(( (8#${ENV_MODE} & 077) == 0 )) ||
  die "Environment file must not grant group or other permissions"

NODE_BIN="$(realpath -e -- "$(command -v node)")"
NODE_VERSION="$("${NODE_BIN}" -p "process.versions.node")"
"${NODE_BIN}" -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 20 || minor < 12) process.exit(1);
' || die "Node >=20.12 and <21 is required"

"${NODE_BIN}" "${SWEEPER}" --env-file "${ENV_FILE}" --dry-run

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
umask 077

TEST_MODE=0
if [[ -n "${CANVAS_SWEEPER_TEST_UNIT_DIR:-}" ]]; then
  [[ "${CANVAS_SWEEPER_INSTALL_TEST_MODE:-0}" == "1" ]] ||
    die "The test unit directory override requires explicit test mode"
  TEST_MODE=1
  [[ "${CANVAS_SWEEPER_TEST_UNIT_DIR}" == /* && "${CANVAS_SWEEPER_TEST_UNIT_DIR}" != "/" ]] ||
    die "The test unit directory must be an absolute non-root path"
  [[ "${CANVAS_SWEEPER_TEST_UNIT_DIR}" =~ ^/[A-Za-z0-9_./-]+$ ]] ||
    die "The test unit directory contains unsupported path characters"
  UNIT_DIR="${CANVAS_SWEEPER_TEST_UNIT_DIR%/}"
fi

[[ -d "${UNIT_DIR}" && ! -L "${UNIT_DIR}" ]] ||
  die "systemd unit directory is unavailable"
[[ "$(realpath -e -- "${UNIT_DIR}")" == "${UNIT_DIR}" ]] ||
  die "systemd unit directory must use its canonical path"

LOCK_FILE="/run/lock/${SERVICE_NAME}.install.lock"
if [[ "${TEST_MODE}" == "1" ]]; then
  [[ "${UNIT_DIR}" != "/etc/systemd/system" ]] ||
    die "The test unit directory must not be the production systemd directory"
  [[ "$(systemctl --canvas-sweeper-test-probe 2>/dev/null)" == "canvas-sweeper-isolated-systemctl-v1" ]] ||
    die "The test unit override requires the isolated fake systemctl"
  LOCK_FILE="${UNIT_DIR}/.${SERVICE_NAME}.install.lock"
fi
if [[ -e "${LOCK_FILE}" || -L "${LOCK_FILE}" ]]; then
  [[ -f "${LOCK_FILE}" && ! -L "${LOCK_FILE}" ]] ||
    die "Installer lock must be a non-symlink regular file"
fi
exec {LOCK_FD}>>"${LOCK_FILE}" || die "Unable to open the installer lock"
[[ -f "${LOCK_FILE}" && ! -L "${LOCK_FILE}" ]] ||
  die "Installer lock did not remain a non-symlink regular file"
chown root:root "${LOCK_FILE}" || die "Unable to secure the installer lock owner"
chmod 0600 "${LOCK_FILE}" || die "Unable to secure the installer lock mode"
flock -n "${LOCK_FD}" || die "Another Canvas upload sweeper installation is in progress"

SERVICE_PATH="${UNIT_DIR}/${SERVICE_NAME}.service"
TIMER_PATH="${UNIT_DIR}/${SERVICE_NAME}.timer"
TEMP_SERVICE=""
TEMP_TIMER=""
BACKUP_DIR=""
BACKUP_SERVICE=""
BACKUP_TIMER=""
SERVICE_EXISTED=0
TIMER_EXISTED=0
SERVICE_MODE=""
SERVICE_UID=""
SERVICE_GID=""
TIMER_MODE=""
TIMER_UID=""
TIMER_GID=""
TIMER_UNIT_FILE_STATE=""
TIMER_ACTIVE_STATE=""
SERVICE_ACTIVE_STATE=""
TRANSACTION_ARMED=0
TRANSACTION_COMMITTED=0
PRESERVE_BACKUP=0

cleanup() {
  local cleanup_failed=0

  if [[ -n "${TEMP_SERVICE:-}" ]] && ! rm -f -- "${TEMP_SERVICE}"; then
    echo "[CRITICAL] Failed to remove installer temporary file: ${TEMP_SERVICE}" >&2
    cleanup_failed=1
  fi
  if [[ -n "${TEMP_TIMER:-}" ]] && ! rm -f -- "${TEMP_TIMER}"; then
    echo "[CRITICAL] Failed to remove installer temporary file: ${TEMP_TIMER}" >&2
    cleanup_failed=1
  fi
  if [[ -n "${BACKUP_DIR:-}" && "${PRESERVE_BACKUP}" != "1" ]]; then
    if [[ -n "${BACKUP_SERVICE:-}" ]] && ! rm -f -- "${BACKUP_SERVICE}"; then
      echo "[CRITICAL] Failed to remove installer backup file: ${BACKUP_SERVICE}" >&2
      cleanup_failed=1
    fi
    if [[ -n "${BACKUP_TIMER:-}" ]] && ! rm -f -- "${BACKUP_TIMER}"; then
      echo "[CRITICAL] Failed to remove installer backup file: ${BACKUP_TIMER}" >&2
      cleanup_failed=1
    fi
    if ! rmdir -- "${BACKUP_DIR}"; then
      echo "[CRITICAL] Failed to remove installer backup directory: ${BACKUP_DIR}" >&2
      cleanup_failed=1
    fi
  fi

  return "${cleanup_failed}"
}

snapshot_unit() {
  local path="$1"
  local backup="$2"
  local prefix="$3"
  local mode=""
  local uid=""
  local gid=""

  if [[ -e "${path}" || -L "${path}" ]]; then
    [[ -f "${path}" && ! -L "${path}" ]] ||
      die "Existing systemd unit must be a non-symlink regular file"
    cp -- "${path}" "${backup}" || die "Unable to snapshot an existing systemd unit"
    mode="$(stat -c '%a' -- "${path}")" || die "Unable to read existing unit mode"
    uid="$(stat -c '%u' -- "${path}")" || die "Unable to read existing unit owner"
    gid="$(stat -c '%g' -- "${path}")" || die "Unable to read existing unit group"
    printf -v "${prefix}_EXISTED" '%s' "1"
    printf -v "${prefix}_MODE" '%s' "${mode}"
    printf -v "${prefix}_UID" '%s' "${uid}"
    printf -v "${prefix}_GID" '%s' "${gid}"
  fi
}

restore_unit() {
  local path="$1"
  local backup="$2"
  local existed="$3"
  local mode="$4"
  local uid="$5"
  local gid="$6"
  local restore_temp=""

  if [[ "${existed}" == "1" ]]; then
    restore_temp="$(mktemp "${UNIT_DIR}/.${SERVICE_NAME}.restore.XXXXXX")" || return 1
    if ! cp -- "${backup}" "${restore_temp}" ||
       ! chown "${uid}:${gid}" "${restore_temp}" ||
       ! chmod "${mode}" "${restore_temp}" ||
       ! mv -f -- "${restore_temp}" "${path}"; then
      rm -f -- "${restore_temp}" 2>/dev/null || true
      return 1
    fi
  else
    rm -f -- "${path}" || return 1
  fi
}

unit_snapshot_matches() {
  local path="$1"
  local backup="$2"
  local existed="$3"
  local mode="$4"
  local uid="$5"
  local gid="$6"

  if [[ "${existed}" == "1" ]]; then
    [[ -f "${path}" && ! -L "${path}" ]] || return 1
    cmp -s -- "${backup}" "${path}" || return 1
    [[ "$(stat -c '%a' -- "${path}")" == "${mode}" ]] || return 1
    [[ "$(stat -c '%u' -- "${path}")" == "${uid}" ]] || return 1
    [[ "$(stat -c '%g' -- "${path}")" == "${gid}" ]] || return 1
  else
    [[ ! -e "${path}" && ! -L "${path}" ]] || return 1
  fi
}

read_active_state() {
  local unit="$1"
  local value=""

  value="$(systemctl show "${unit}" --property=ActiveState --value 2>/dev/null)" || return 1
  [[ "${value}" == "active" || "${value}" == "inactive" ]] || return 1
  printf '%s' "${value}"
}

read_timer_unit_file_state() {
  local load_state=""
  local unit_file_state=""

  load_state="$(systemctl show "${SERVICE_NAME}.timer" --property=LoadState --value 2>/dev/null)" ||
    return 1
  if [[ "${load_state}" == "not-found" ]]; then
    printf '%s' "not-found"
    return 0
  fi
  [[ "${load_state}" == "loaded" ]] || return 1

  unit_file_state="$(systemctl show "${SERVICE_NAME}.timer" --property=UnitFileState --value 2>/dev/null)" ||
    return 1
  [[ "${unit_file_state}" == "enabled" || "${unit_file_state}" == "disabled" ]] ||
    return 1
  printf '%s' "${unit_file_state}"
}

read_invocation_id() {
  local value=""

  value="$(systemctl show "${SERVICE_NAME}.service" --property=InvocationID --value 2>/dev/null)" || return 1
  [[ -z "${value}" || "${value}" =~ ^[0-9a-f]{32}$ ]] || return 1
  printf '%s' "${value}"
}

rollback_transaction() {
  local rollback_failed=0
  local actual_timer_unit_file_state=""
  local actual_timer_active_state=""
  local actual_service_active_state=""

  echo "[ROLLBACK] Restoring the previous Canvas upload sweeper installation." >&2

  # These may legitimately fail when the corresponding old unit was absent.
  # Final byte, metadata, and state verification below is authoritative.
  systemctl stop "${SERVICE_NAME}.timer" >/dev/null 2>&1 || true
  systemctl disable "${SERVICE_NAME}.timer" >/dev/null 2>&1 || true
  systemctl stop "${SERVICE_NAME}.service" >/dev/null 2>&1 || true

  restore_unit \
    "${SERVICE_PATH}" "${BACKUP_SERVICE}" "${SERVICE_EXISTED}" \
    "${SERVICE_MODE}" "${SERVICE_UID}" "${SERVICE_GID}" || rollback_failed=1
  restore_unit \
    "${TIMER_PATH}" "${BACKUP_TIMER}" "${TIMER_EXISTED}" \
    "${TIMER_MODE}" "${TIMER_UID}" "${TIMER_GID}" || rollback_failed=1

  systemctl daemon-reload >/dev/null 2>&1 || rollback_failed=1

  if [[ "${TIMER_UNIT_FILE_STATE}" == "enabled" ]]; then
    systemctl enable "${SERVICE_NAME}.timer" >/dev/null 2>&1 || rollback_failed=1
  elif [[ "${TIMER_UNIT_FILE_STATE}" == "disabled" ]]; then
    systemctl disable "${SERVICE_NAME}.timer" >/dev/null 2>&1 || rollback_failed=1
  fi

  systemctl stop "${SERVICE_NAME}.service" >/dev/null 2>&1 || true

  if [[ "${TIMER_ACTIVE_STATE}" == "active" ]]; then
    systemctl start "${SERVICE_NAME}.timer" >/dev/null 2>&1 || rollback_failed=1
  else
    systemctl stop "${SERVICE_NAME}.timer" >/dev/null 2>&1 || true
  fi

  unit_snapshot_matches \
    "${SERVICE_PATH}" "${BACKUP_SERVICE}" "${SERVICE_EXISTED}" \
    "${SERVICE_MODE}" "${SERVICE_UID}" "${SERVICE_GID}" || rollback_failed=1
  unit_snapshot_matches \
    "${TIMER_PATH}" "${BACKUP_TIMER}" "${TIMER_EXISTED}" \
    "${TIMER_MODE}" "${TIMER_UID}" "${TIMER_GID}" || rollback_failed=1
  actual_timer_unit_file_state="$(read_timer_unit_file_state)" || rollback_failed=1
  actual_timer_active_state="$(read_active_state "${SERVICE_NAME}.timer")" || rollback_failed=1
  actual_service_active_state="$(read_active_state "${SERVICE_NAME}.service")" || rollback_failed=1
  [[ "${actual_timer_unit_file_state}" == "${TIMER_UNIT_FILE_STATE}" ]] || rollback_failed=1
  [[ "${actual_timer_active_state}" == "${TIMER_ACTIVE_STATE}" ]] || rollback_failed=1
  [[ "${actual_service_active_state}" == "${SERVICE_ACTIVE_STATE}" ]] || rollback_failed=1

  if [[ "${rollback_failed}" != "0" ]]; then
    PRESERVE_BACKUP=1
    chmod 0700 "${BACKUP_DIR}" 2>/dev/null || true
    echo "[CRITICAL] Canvas upload sweeper rollback verification failed; root-only backup retained at ${BACKUP_DIR}." >&2
    return 1
  fi

  echo "[ROLLBACK] Previous Canvas upload sweeper installation restored." >&2
}

on_exit() {
  local status=$?
  local rollback_status=0
  local cleanup_status=0
  trap - EXIT INT TERM
  set +e

  if [[ "${TRANSACTION_ARMED}" == "1" && "${TRANSACTION_COMMITTED}" != "1" ]]; then
    rollback_transaction || rollback_status=1
  fi
  cleanup || cleanup_status=1

  if [[ "${rollback_status}" != "0" || "${cleanup_status}" != "0" ]]; then
    exit 1
  fi
  exit "${status}"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

BACKUP_DIR="$(mktemp -d "${UNIT_DIR}/.${SERVICE_NAME}.rollback.XXXXXX")"
chmod 0700 "${BACKUP_DIR}"
BACKUP_SERVICE="${BACKUP_DIR}/${SERVICE_NAME}.service"
BACKUP_TIMER="${BACKUP_DIR}/${SERVICE_NAME}.timer"
snapshot_unit "${SERVICE_PATH}" "${BACKUP_SERVICE}" SERVICE
snapshot_unit "${TIMER_PATH}" "${BACKUP_TIMER}" TIMER
[[ "${SERVICE_EXISTED}" == "${TIMER_EXISTED}" ]] ||
  die "Sweeper service and timer must either both exist or both be absent"

TIMER_UNIT_FILE_STATE="$(read_timer_unit_file_state)" ||
  die "Unable to read a supported timer unit-file state"
TIMER_ACTIVE_STATE="$(read_active_state "${SERVICE_NAME}.timer")" ||
  die "Unable to read an exact timer active state"
SERVICE_ACTIVE_STATE="$(read_active_state "${SERVICE_NAME}.service")" ||
  die "Unable to read an exact sweeper service active state"

[[ "${SERVICE_ACTIVE_STATE}" == "inactive" ]] ||
  die "Existing sweeper service must be exactly inactive before installation"
if [[ "${TIMER_EXISTED}" == "1" ]]; then
  [[ "${TIMER_UNIT_FILE_STATE}" == "enabled" || "${TIMER_UNIT_FILE_STATE}" == "disabled" ]] ||
    die "Existing timer has an unsupported unit-file state"
else
  [[ "${TIMER_UNIT_FILE_STATE}" == "not-found" ]] ||
    die "Absent timer has an inconsistent systemd unit-file state"
  [[ "${TIMER_ACTIVE_STATE}" == "inactive" ]] ||
    die "Absent timer must be exactly inactive"
fi

TEMP_SERVICE="$(mktemp "${UNIT_DIR}/.${SERVICE_NAME}.service.XXXXXX")"
TEMP_TIMER="$(mktemp "${UNIT_DIR}/.${SERVICE_NAME}.timer.XXXXXX")"

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
WorkingDirectory=${RELEASE_DIR}
ExecStart=${NODE_BIN} ${SWEEPER} --env-file ${ENV_FILE} --limit 100
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
Persistent=true
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
EOF

chown root:root "${TEMP_SERVICE}" "${TEMP_TIMER}"
chmod 0644 "${TEMP_SERVICE}" "${TEMP_TIMER}"

# From this point onward every failure must restore both units and their
# pre-install systemd state before the process exits.
TRANSACTION_ARMED=1

# Quiesce any prior schedule before replacing its unit files. The captured
# state is restored by the exit trap if any command below fails.
if [[ "${TIMER_UNIT_FILE_STATE}" != "not-found" ]]; then
  systemctl stop "${SERVICE_NAME}.timer"
fi
if [[ "${TIMER_UNIT_FILE_STATE}" == "enabled" ]]; then
  systemctl disable "${SERVICE_NAME}.timer"
fi
if [[ "${SERVICE_EXISTED}" == "1" ]]; then
  systemctl stop "${SERVICE_NAME}.service"
fi

[[ "$(read_active_state "${SERVICE_NAME}.timer")" == "inactive" ]] ||
  die "Timer did not reach the exact inactive state before replacement"
[[ "$(read_active_state "${SERVICE_NAME}.service")" == "inactive" ]] ||
  die "Sweeper service did not remain exactly inactive before replacement"
if [[ "${TIMER_UNIT_FILE_STATE}" == "not-found" ]]; then
  [[ "$(read_timer_unit_file_state)" == "not-found" ]] ||
    die "Absent timer changed state before replacement"
else
  [[ "$(read_timer_unit_file_state)" == "disabled" ]] ||
    die "Timer did not reach the exact disabled state before replacement"
fi

mv -f -- "${TEMP_SERVICE}" "${SERVICE_PATH}"
TEMP_SERVICE=""
mv -f -- "${TEMP_TIMER}" "${TIMER_PATH}"
TEMP_TIMER=""

systemctl daemon-reload
SERVICE_INVOCATION_BEFORE="$(read_invocation_id)" ||
  die "Unable to read the pre-start sweeper invocation ID"
systemctl start "${SERVICE_NAME}.service"
SERVICE_INVOCATION_AFTER="$(read_invocation_id)" ||
  die "Unable to read the post-start sweeper invocation ID"
[[ -n "${SERVICE_INVOCATION_AFTER}" && "${SERVICE_INVOCATION_AFTER}" != "${SERVICE_INVOCATION_BEFORE}" ]] ||
  die "Upload sweeper did not prove a new one-shot invocation"
[[ "$(systemctl show "${SERVICE_NAME}.service" --property=Result --value)" == "success" ]] ||
  die "Upload sweeper initial cycle did not complete successfully"

# Never schedule periodic retries until the first real one-shot has passed.
systemctl enable "${SERVICE_NAME}.timer"
systemctl start "${SERVICE_NAME}.timer"
[[ "$(read_timer_unit_file_state)" == "enabled" ]] ||
  die "Upload sweeper timer is not enabled"
[[ "$(read_active_state "${SERVICE_NAME}.timer")" == "active" ]] ||
  die "Upload sweeper timer is not active"

TRANSACTION_COMMITTED=1

echo "[OK] Canvas upload sweeper timer is installed and its initial cycle passed."
