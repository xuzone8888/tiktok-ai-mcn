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

for command in node realpath stat systemctl; do
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
[[ -d "${UNIT_DIR}" && ! -L "${UNIT_DIR}" ]] ||
  die "systemd unit directory is unavailable"

SERVICE_PATH="${UNIT_DIR}/${SERVICE_NAME}.service"
TIMER_PATH="${UNIT_DIR}/${SERVICE_NAME}.timer"
TEMP_SERVICE="$(mktemp "${UNIT_DIR}/.${SERVICE_NAME}.service.XXXXXX")"
TEMP_TIMER="$(mktemp "${UNIT_DIR}/.${SERVICE_NAME}.timer.XXXXXX")"
cleanup() {
  [[ -z "${TEMP_SERVICE:-}" ]] || rm -f -- "${TEMP_SERVICE}"
  [[ -z "${TEMP_TIMER:-}" ]] || rm -f -- "${TEMP_TIMER}"
}
trap cleanup EXIT

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
mv -f -- "${TEMP_SERVICE}" "${SERVICE_PATH}"
TEMP_SERVICE=""
mv -f -- "${TEMP_TIMER}" "${TIMER_PATH}"
TEMP_TIMER=""

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.timer"
systemctl start "${SERVICE_NAME}.service"
systemctl is-active --quiet "${SERVICE_NAME}.timer" ||
  die "Upload sweeper timer is not active"
[[ "$(systemctl show "${SERVICE_NAME}.service" --property=Result --value)" == "success" ]] ||
  die "Upload sweeper initial cycle did not complete successfully"

echo "[OK] Canvas upload sweeper timer is installed and its initial cycle passed."
