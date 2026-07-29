#!/bin/bash -p
#
# Fail-closed blue/green release helper for StarGaze Canvas.
#
# The default is a read-only plan. An executed transition is committed only
# after the exact internal health contract, build identity, database contract,
# Nginx cutover, public Canvas page, and singleton reconciler all pass.

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

case "$-" in
  *p*) ;;
  *)
    echo "[FAIL] Deployer must run via its privileged /bin/bash -p entrypoint." >&2
    exit 1
    ;;
esac

declare -rx PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"
readonly STAT_BIN="/usr/bin/stat"
readonly DIRNAME_BIN="/usr/bin/dirname"
readonly REALPATH_BIN="/usr/bin/realpath"
readonly SYSTEMCTL_BIN="/usr/bin/systemctl"
readonly ENV_BIN="/usr/bin/env"
readonly FLOCK_BIN="/usr/bin/flock"
readonly READLINK_BIN="/usr/bin/readlink"
readonly NPM_USER_CONFIG="/dev/null"
readonly NPM_GLOBAL_CONFIG="/run/stargaze-canvas/npm-globalconfig-disabled"
for helper in \
  "${STAT_BIN}" "${DIRNAME_BIN}" "${REALPATH_BIN}" \
  "${SYSTEMCTL_BIN}" "${ENV_BIN}" "${FLOCK_BIN}" "${READLINK_BIN}"; do
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
RUN_BUILD=1
ALLOW_LEGACY_ACTIVE=0
CANDIDATE_PORT="${CANVAS_CANDIDATE_PORT:-3004}"
CANDIDATE_NAME="${CANVAS_CANDIDATE_NAME:-stargaze-canvas-candidate}"
CANDIDATE_DIR="${CANVAS_CANDIDATE_DIR:-${REPO_ROOT}}"
NGINX_CONFIG="${CANVAS_NGINX_CONFIG:-/etc/nginx/sites-available/toryxai.com}"
ROLLBACK_DIR="${CANVAS_ROLLBACK_DIR:-/var/backups/stargaze-canvas}"
HEALTH_ATTEMPTS="${CANVAS_HEALTH_ATTEMPTS:-30}"
HEALTH_INTERVAL="${CANVAS_HEALTH_INTERVAL:-2}"
ENV_FILE="${CANVAS_ENV_FILE:-.env.local}"
PM2_CONFIG=""
PUBLIC_HEALTH_URL="${CANVAS_PUBLIC_HEALTH_URL:-}"
ROLLBACK_BUNDLE=""
RECONCILER_ENV_FILE="${CANVAS_RECONCILER_ENV_FILE:-}"
RECONCILER_INSTALL_DIR="${CANVAS_RECONCILER_INSTALL_DIR:-/opt/stargaze-canvas-reconciler}"
RECONCILER_LOCK_FILE="${CANVAS_RECONCILER_LOCK_FILE:-/run/stargaze-canvas-reconciler.lock}"
RECONCILER_NAME="${CANVAS_RECONCILER_PM2_NAME:-stargaze-canvas-reconciler}"
REQUIRED_NODE_VERSION="24.18.0"
REQUIRED_NPM_VERSION="12.0.1"
REQUIRED_PM2_VERSION="6.0.14"
NODE_BIN=""
NPM_CLI=""
PM2_BIN=""
PM2_PACKAGE_ROOT=""
PM2_DAEMON_JS=""
PM2_DAEMON_PROBE=""
PM2_NO_AUTOSTART_GUARD=""
PM2_DAEMON_TOKEN=""
GIT_BIN=""
CURL_BIN=""
NGINX_BIN=""
readonly DEPLOY_LOCK_FILE="/run/stargaze-canvas/deploy.lock"
DEPLOY_LOCK_FD=""

BUNDLE_TOOL=""
HEALTH_PROBE=""
RECONCILER_READY_PROBE=""
BROKER_TLS_PROBE=""
SUPPLY_CHAIN_CHECK=""
TEMP_CONFIG=""
RESTORE_BUNDLE=""
SYSTEM_STATE_CHANGED=0
CUTOVER_COMMITTED=0
AUTO_RESTORE_SUCCEEDED=0
CANDIDATE_STARTED=0

TARGET_WEB_NAME=""
TARGET_WEB_PORT=""
TARGET_WEB_ROOT=""
TARGET_WEB_ENV_FILE=""
TARGET_WEB_BUILD_ID=""
TARGET_WEB_HEALTH_CONTRACT=""
TARGET_WORKER_PRESENT=""

usage() {
  cat <<'USAGE'
Usage:
  deploy/canvas-blue-green.sh [plan|deploy|rollback] [options]

Actions:
  plan       Print the resolved plan without changing state (default).
  deploy     Build and validate a candidate, then switch Web + worker.
  rollback   Restore Web + worker from one verified rollback bundle.

Mutation gate:
  --execute                 Required for deploy or rollback mutations.

Candidate/tooling options:
  --candidate-port <port>   Candidate listener port (default: 3004).
  --candidate-name <name>   Unique candidate PM2 process name.
  --workdir <absolute-dir>  Immutable candidate/tooling release directory.
  --env-file <path>         Must resolve exactly to <workdir>/.env.local.
  --pm2-config <path>       PM2 config, relative to workdir unless absolute.
  --reconciler-env-file <absolute>
                            Stable root-owned worker secret file.
  --reconciler-install-dir <absolute>
                            Stable worker installation directory.
  --reconciler-lock-file <absolute>
                            Stable singleton lock path.
  --reconciler-name <name>  Stable singleton worker PM2 name.
  --skip-build              Reuse an existing verified .next build.
  --allow-legacy-active     One-time bootstrap only: permit the currently
                            active pre-health release as rollback target when
                            it has no reconciler. The bundle is permanently
                            marked legacy-bootstrap.

Transition options:
  --nginx-config <absolute> Active Nginx site file.
  --rollback-dir <absolute> Root-only parent for complete rollback bundles.
  --health-attempts <n>     Internal/public health attempts (default: 30).
  --health-interval <sec>   Delay between attempts (default: 2).
  --public-health-url <url> Public /canvas URL; required when executed.

Rollback option:
  --rollback-bundle <path>  Complete bundle emitted by an earlier transition.
  --rollback-file <path>    Backward-compatible alias; it must now be a bundle
                            directory, not a legacy .conf file.

No option accepts a bearer value. Internal probes load the exact release
.env.local without printing secret values.
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

assert_disabled_npm_config_paths() {
  local user_config_parent
  local global_config_parent

  [[ -c "${NPM_USER_CONFIG}" && ! -L "${NPM_USER_CONFIG}" ]] || return 1
  [[ "$("${REALPATH_BIN}" -e -- "${NPM_USER_CONFIG}")" == "${NPM_USER_CONFIG}" ]] ||
    return 1
  [[ "$("${STAT_BIN}" -c '%u:%g' -- "${NPM_USER_CONFIG}")" == "0:0" ]] ||
    return 1
  user_config_parent="$("${DIRNAME_BIN}" -- "${NPM_USER_CONFIG}")" || return 1
  trusted_root_path_chain "${user_config_parent}" || return 1

  global_config_parent="$("${DIRNAME_BIN}" -- "${NPM_GLOBAL_CONFIG}")" ||
    return 1
  [[ -d "${global_config_parent}" && ! -L "${global_config_parent}" ]] ||
    return 1
  [[ "$("${REALPATH_BIN}" -e -- "${global_config_parent}")" == \
    "${global_config_parent}" ]] || return 1
  [[ "$("${REALPATH_BIN}" -m -- "${NPM_GLOBAL_CONFIG}")" == \
    "${NPM_GLOBAL_CONFIG}" ]] || return 1
  trusted_root_path_chain "${global_config_parent}" || return 1
  [[ ! -e "${NPM_GLOBAL_CONFIG}" && ! -L "${NPM_GLOBAL_CONFIG}" ]]
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

canvas_upload_sweeper_is_stopped() {
  local timer_load_state
  local timer_active_state
  local timer_unit_file_state
  local service_load_state
  local service_active_state

  timer_load_state="$(
    "${SYSTEMCTL_BIN}" show \
      --property=LoadState \
      --value \
      stargaze-canvas-upload-sweeper.timer 2>/dev/null
  )" || return 1
  timer_active_state="$(
    "${SYSTEMCTL_BIN}" show \
      --property=ActiveState \
      --value \
      stargaze-canvas-upload-sweeper.timer 2>/dev/null
  )" || return 1
  service_load_state="$(
    "${SYSTEMCTL_BIN}" show \
      --property=LoadState \
      --value \
      stargaze-canvas-upload-sweeper.service 2>/dev/null
  )" || return 1
  service_active_state="$(
    "${SYSTEMCTL_BIN}" show \
      --property=ActiveState \
      --value \
      stargaze-canvas-upload-sweeper.service 2>/dev/null
  )" || return 1

  if [[ "${timer_load_state}" == "not-found" ]]; then
    [[ "${service_load_state}" == "not-found" ]] || return 1
    return 0
  fi
  [[ "${timer_load_state}" == "loaded" ]] || return 1
  [[ "${timer_active_state}" =~ ^(inactive|failed)$ ]] || return 1
  timer_unit_file_state="$(
    "${SYSTEMCTL_BIN}" show \
      --property=UnitFileState \
      --value \
      stargaze-canvas-upload-sweeper.timer 2>/dev/null
  )" || return 1
  [[ "${timer_unit_file_state}" == "disabled" ]] || return 1

  [[ "${service_load_state}" == "loaded" ]] || return 1
  [[ "${service_active_state}" =~ ^(inactive|failed)$ ]]
}

is_unsigned_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

absolute_from_workdir() {
  local path="$1"
  if [[ "${path}" == /* ]]; then
    printf '%s\n' "${path}"
  else
    printf '%s\n' "${CANDIDATE_DIR}/${path}"
  fi
}

proxy_target_count() {
  local file="$1"
  grep -Ec 'proxy_pass[[:space:]]+http://127\.0\.0\.1:[0-9]+;' "${file}" || true
}

proxy_target_port() {
  local file="$1"
  sed -nE \
    's#.*proxy_pass[[:space:]]+http://127\.0\.0\.1:([0-9]+);.*#\1#p' \
    "${file}" |
    head -n 1
}

assert_single_proxy_target() {
  local file="$1"
  local count
  count="$(proxy_target_count "${file}")"
  if [[ "${count}" != "1" ]]; then
    echo "[FAIL] ${file} must contain exactly one loopback proxy target; found ${count}" >&2
    return 1
  fi
}

assert_internal_canvas_denied() {
  local file="$1"
  if ! "${NODE_BIN}" -e '
    const fs = require("node:fs");
    const source = fs.readFileSync(process.argv[1], "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*/, ""))
      .join("\n");
    const deny = /location\s+\^~\s+\/api\/internal\/canvas\/\s*\{\s*return\s+(?:403|404)\s*;\s*\}/s;
    const proxy = /proxy_pass\s+http:\/\/127\.0\.0\.1:[0-9]+\s*;/g;
    const blocks = [];
    const server = /\bserver\s*\{/g;
    let match;
    while ((match = server.exec(source)) !== null) {
      const opening = source.indexOf("{", match.index);
      let depth = 0;
      let quote = "";
      let escaped = false;
      for (let index = opening; index < source.length; index += 1) {
        const character = source[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (character === "\\\\") {
          escaped = true;
          continue;
        }
        if (quote) {
          if (character === quote) quote = "";
          continue;
        }
        if (character === "\"" || character === "'\''") {
          quote = character;
          continue;
        }
        if (character === "{") depth += 1;
        if (character === "}") depth -= 1;
        if (depth === 0) {
          blocks.push(source.slice(opening + 1, index));
          server.lastIndex = index + 1;
          break;
        }
      }
    }
    const valid = blocks.filter((block) => {
      proxy.lastIndex = 0;
      return (block.match(proxy) ?? []).length === 1 && deny.test(block);
    });
    process.exit(valid.length === 1 ? 0 : 1);
  ' "${file}"; then
    echo "[FAIL] ${file} must deny /api/internal/canvas/ in the same server block as the unique proxy" >&2
    return 1
  fi
}

assert_public_canvas_url() {
  local value="$1"
  "${NODE_BIN}" -e '
    try {
      const url = new URL(process.argv[1]);
      const valid =
        url.protocol === "https:" &&
        url.hostname === "www.toryxai.com" &&
        url.port === "" &&
        url.pathname === "/canvas" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash;
      process.exit(valid ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "${value}"
}

page_is_healthy() {
  local url="$1"
  local attempts="$2"
  local label="$3"
  local code=""

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    code="$(
      "${ENV_BIN}" -i \
        "PATH=${PATH}" \
        "HOME=${HOME}" \
        "USER=${USER}" \
        "LOGNAME=${LOGNAME}" \
        "LANG=${LANG}" \
        "${CURL_BIN}" --disable --noproxy '*' \
          --silent --show-error --output /dev/null \
          --connect-timeout 3 --max-time 10 \
          --header 'Cache-Control: no-cache' \
          --write-out '%{http_code}' "${url}" 2>/dev/null || true
    )"
    if [[ "${code}" == "200" ]]; then
      echo "[OK] ${label} responded with HTTP 200"
      return 0
    fi
    if ((attempt < attempts)); then
      sleep "${HEALTH_INTERVAL}"
    fi
  done

  echo "[FAIL] ${label} did not return HTTP 200" >&2
  return 1
}

probe_internal_health() {
  local root="$1"
  local env_file="$2"
  local port="$3"
  local attempts="${4:-${HEALTH_ATTEMPTS}}"
  NODE_ENV=production "${NODE_BIN}" -- "${HEALTH_PROBE}" \
    --root "${root}" \
    --env-file "${env_file}" \
    --url "http://127.0.0.1:${port}/api/internal/canvas/health" \
    --attempts "${attempts}" \
    --interval-ms "$((HEALTH_INTERVAL * 1000))"
}

pm2_name_is_absent() {
  local name="$1"
  pm2_existing_jlist 2>/dev/null |
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

pm2_web_identity_for_port() {
  local port="$1"
  pm2_existing_jlist 2>/dev/null |
    "${NODE_BIN}" -e '
      const path = require("node:path");
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        try {
          const port = process.argv[1];
          const matches = JSON.parse(input).filter((entry) =>
            entry.pm2_env?.status === "online" &&
            entry.pm2_env?.exec_mode === "fork_mode" &&
            String(entry.pm2_env?.env?.PORT ?? entry.pm2_env?.PORT ?? "") === port &&
            path.isAbsolute(entry.pm2_env?.env?.NODE_EXTRA_CA_CERTS ?? "")
          );
          if (matches.length !== 1) process.exit(1);
          const name = matches[0].name;
          const cwd = matches[0].pm2_env?.pm_cwd;
          if (
            !/^[A-Za-z0-9._-]+$/.test(name ?? "") ||
            typeof cwd !== "string" ||
            !path.isAbsolute(cwd) ||
            /[\u0000-\u001f\u007f]/u.test(cwd)
          ) process.exit(2);
          process.stdout.write(`${name}\n${cwd}\n`);
        } catch {
          process.exit(2);
        }
      });
    ' "${port}"
}

pm2_web_is_online() {
  local name="$1"
  local port="$2"
  local cwd="$3"
  local expected_node_bin="${4:-}"
  local expected_node_version="${5:-}"
  pm2_existing_jlist 2>/dev/null |
    "${NODE_BIN}" -e '
      const path = require("node:path");
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const [name, port, cwd, expectedNodeBin, expectedNodeVersion] =
          process.argv.slice(1);
        try {
          const matches = JSON.parse(input).filter((entry) =>
            entry.name === name &&
            entry.pm2_env?.status === "online" &&
            entry.pm2_env?.exec_mode === "fork_mode" &&
            String(entry.pm2_env?.env?.PORT ?? entry.pm2_env?.PORT ?? "") === port &&
            entry.pm2_env?.pm_cwd === cwd &&
            path.isAbsolute(entry.pm2_env?.env?.NODE_EXTRA_CA_CERTS ?? "") &&
            ((!expectedNodeBin && !expectedNodeVersion) ||
              (entry.pm2_env?.exec_interpreter === expectedNodeBin &&
                entry.pm2_env?.node_version === expectedNodeVersion &&
                Array.isArray(entry.pm2_env?.node_args) &&
                JSON.stringify(entry.pm2_env.node_args) === "[\"--\"]"))
          );
          process.exit(matches.length === 1 ? 0 : 1);
        } catch {
          process.exit(2);
        }
      });
    ' "${name}" "${port}" "${cwd}" \
      "${expected_node_bin}" "${expected_node_version}"
}

pm2_worker_is_absent_once() {
  local name="$1"
  pm2_existing_jlist 2>/dev/null |
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

pm2_worker_state() {
  local name="$1"
  local script="$2"
  local expected_node_bin="${3:-}"
  local expected_node_version="${4:-}"
  local pm2_state
  local second_pm2_state
  local first_identity
  local second_identity
  pm2_state="$(pm2_existing_jlist 2>/dev/null)" || return 1
  if printf '%s' "${pm2_state}" |
    "${NODE_BIN}" -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const [name] = process.argv.slice(1);
        try {
          const matches = JSON.parse(input).filter((entry) => entry.name === name);
          if (matches.length === 0) {
            process.exit(0);
          }
          process.exit(1);
        } catch {
          process.exit(2);
        }
      });
    ' "${name}"; then
    sleep 1
    pm2_worker_is_absent_once "${name}" || return 1
    echo "absent"
    return 0
  fi
  if [[ -n "${expected_node_bin}" || -n "${expected_node_version}" ]]; then
    [[ -n "${expected_node_bin}" && -n "${expected_node_version}" ]] ||
      return 1
    printf '%s' "${pm2_state}" |
      pm2_worker_runtime_is_exact_from_json \
        "${name}" "${expected_node_bin}" "${expected_node_version}" ||
      return 1
  fi
  first_identity="$(
    printf '%s' "${pm2_state}" |
    "${NODE_BIN}" -- "${RECONCILER_READY_PROBE}" \
      --name "${name}" \
      --script "${script}" \
      --lock-file "${RECONCILER_LOCK_FILE}"
  )" ||
    return 1
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
      "${NODE_BIN}" -- "${RECONCILER_READY_PROBE}" \
        --name "${name}" \
        --script "${script}" \
        --lock-file "${RECONCILER_LOCK_FILE}"
  )" ||
    return 1
  [[ "${first_identity}" == "${second_identity}" ]] || return 1
  echo "present"
}

pm2_worker_is_absent() {
  local name="$1"
  pm2_worker_is_absent_once "${name}" || return 1
  sleep 1
  pm2_worker_is_absent_once "${name}"
}

pm2_single_worker_is_online() {
  local expected_node_bin="${1:-}"
  local expected_node_version="${2:-}"
  [[ "$(
    pm2_worker_state \
      "${RECONCILER_NAME}" \
      "${RECONCILER_INSTALL_DIR}/canvas-reconciler-worker.mjs" \
      "${expected_node_bin}" \
      "${expected_node_version}"
  )" == "present" ]]
}

bundle_common_arguments() {
  printf '%s\n' \
    "--rollback-dir" "${ROLLBACK_DIR}" \
    "--expected-nginx-config" "${NGINX_CONFIG}" \
    "--expected-worker-name" "${RECONCILER_NAME}" \
    "--expected-worker-install-dir" "${RECONCILER_INSTALL_DIR}"
}

verify_bundle() {
  local bundle="$1"
  local -a common
  mapfile -t common < <(bundle_common_arguments)
  "${NODE_BIN}" -- "${BUNDLE_TOOL}" verify \
    --bundle-dir "${bundle}" \
    "${common[@]}"
}

load_bundle_state() {
  local bundle="$1"
  local output
  local -a common fields
  mapfile -t common < <(bundle_common_arguments)
  output="$(
    "${NODE_BIN}" -- "${BUNDLE_TOOL}" inspect \
      --bundle-dir "${bundle}" \
      "${common[@]}"
  )" || return 1
  mapfile -t fields <<<"${output}"
  [[ "${#fields[@]}" == "7" ]] || return 1
  TARGET_WEB_NAME="${fields[0]}"
  TARGET_WEB_PORT="${fields[1]}"
  TARGET_WEB_ROOT="${fields[2]}"
  TARGET_WEB_ENV_FILE="${fields[3]}"
  TARGET_WEB_BUILD_ID="${fields[4]}"
  TARGET_WEB_HEALTH_CONTRACT="${fields[5]}"
  TARGET_WORKER_PRESENT="${fields[6]}"
}

create_state_bundle() {
  local bundle="$1"
  local web_name="$2"
  local web_port="$3"
  local web_root="$4"
  local web_env_file="$5"
  local web_health_contract="$6"
  local worker_state

  worker_state="$(
    pm2_worker_state \
      "${RECONCILER_NAME}" \
      "${RECONCILER_INSTALL_DIR}/canvas-reconciler-worker.mjs" \
      "${NODE_BIN}" \
      "${REQUIRED_NODE_VERSION}"
  )" || return 1

  "${NODE_BIN}" -- "${BUNDLE_TOOL}" create \
    --bundle-dir "${bundle}" \
    --rollback-dir "${ROLLBACK_DIR}" \
    --nginx-config "${NGINX_CONFIG}" \
    --web-name "${web_name}" \
    --web-port "${web_port}" \
    --web-root "${web_root}" \
    --web-env-file "${web_env_file}" \
    --web-health-contract "${web_health_contract}" \
    --worker-name "${RECONCILER_NAME}" \
    --worker-install-dir "${RECONCILER_INSTALL_DIR}" \
    --worker-process-present "$([[ "${worker_state}" == "present" ]] && echo true || echo false)" ||
    return 1

  verify_bundle "${bundle}" || return 1
}

restore_worker_from_bundle() {
  local bundle="$1"
  local restored_state
  local expected_process_state
  local -a common
  load_bundle_state "${bundle}" || return 1
  expected_process_state="${TARGET_WORKER_PRESENT}"
  if [[ "${expected_process_state}" == "false" ]]; then
    run_trusted_pm2 delete "${RECONCILER_NAME}" >/dev/null 2>&1 || true
  fi
  mapfile -t common < <(bundle_common_arguments)
  restored_state="$(
    "${NODE_BIN}" -- "${BUNDLE_TOOL}" restore-worker \
      --bundle-dir "${bundle}" \
      "${common[@]}"
  )" || return 1

  if [[ "${restored_state}" == "present" ]]; then
    CANVAS_RECONCILER_SETTINGS_FILE="${RECONCILER_INSTALL_DIR}/canvas-reconciler.settings.json" \
    CANVAS_NODE_BIN="${NODE_BIN}" \
      run_trusted_pm2 startOrReload \
        "${RECONCILER_INSTALL_DIR}/ecosystem.canvas-reconciler.config.cjs" \
        --only "${RECONCILER_NAME}" --update-env ||
      return 1
    pm2_single_worker_is_online "${NODE_BIN}" "${REQUIRED_NODE_VERSION}" ||
      return 1
  elif [[ "${restored_state}" == "absent" ]]; then
    pm2_worker_is_absent "${RECONCILER_NAME}"
  else
    echo "[FAIL] Bundle helper returned an invalid worker state" >&2
    return 1
  fi
}

restore_nginx_from_bundle() {
  local bundle="$1"
  local -a common
  mapfile -t common < <(bundle_common_arguments)
  "${NODE_BIN}" -- "${BUNDLE_TOOL}" restore-nginx \
    --bundle-dir "${bundle}" \
    "${common[@]}" ||
    return 1
  assert_single_proxy_target "${NGINX_CONFIG}" || return 1
  assert_internal_canvas_denied "${NGINX_CONFIG}" || return 1
  "${NGINX_BIN}" -t || return 1
  "${NGINX_BIN}" -s reload || return 1
}

restore_system_from_bundle() {
  local bundle="$1"
  local restore_status=0

  if ! restore_nginx_from_bundle "${bundle}"; then
    echo "[CRITICAL] Nginx restoration failed." >&2
    restore_status=1
  fi
  if ! restore_worker_from_bundle "${bundle}"; then
    echo "[CRITICAL] Worker restoration failed." >&2
    restore_status=1
  fi
  return "${restore_status}"
}

switch_nginx_to_port() {
  local port="$1"
  local config_dir
  config_dir="$("${DIRNAME_BIN}" -- "${NGINX_CONFIG}")"
  TEMP_CONFIG="$(mktemp "${config_dir}/.canvas-cutover.XXXXXX")"
  sed -E \
    "s#(proxy_pass[[:space:]]+http://127\\.0\\.0\\.1:)[0-9]+;#\\1${port};#" \
    "${NGINX_CONFIG}" >"${TEMP_CONFIG}"
  chmod --reference="${NGINX_CONFIG}" "${TEMP_CONFIG}"
  chown --reference="${NGINX_CONFIG}" "${TEMP_CONFIG}"
  assert_single_proxy_target "${TEMP_CONFIG}"
  assert_internal_canvas_denied "${TEMP_CONFIG}"
  [[ "$(proxy_target_port "${TEMP_CONFIG}")" == "${port}" ]] ||
    die "Generated Nginx config does not target the requested port"
  SYSTEM_STATE_CHANGED=1
  mv -f -- "${TEMP_CONFIG}" "${NGINX_CONFIG}"
  TEMP_CONFIG=""
  "${NGINX_BIN}" -t
  "${NGINX_BIN}" -s reload
}

on_exit() {
  local status=$?
  local candidate_cleanup_ok=1
  trap - EXIT
  set +e

  if [[ -n "${TEMP_CONFIG}" && -e "${TEMP_CONFIG}" ]]; then
    rm -f -- "${TEMP_CONFIG}"
  fi

  if ((
    status != 0 &&
    SYSTEM_STATE_CHANGED == 1 &&
    CUTOVER_COMMITTED == 0
  )); then
    echo "[ROLLBACK] Restoring Web and worker from ${RESTORE_BUNDLE}." >&2
    if ! restore_system_from_bundle "${RESTORE_BUNDLE}"; then
      echo "[CRITICAL] Automatic forward restoration failed; keep all processes running and restore ${RESTORE_BUNDLE} manually." >&2
    else
      AUTO_RESTORE_SUCCEEDED=1
    fi
  fi

  if ((
    status != 0 &&
    CANDIDATE_STARTED == 1 &&
    (SYSTEM_STATE_CHANGED == 0 || AUTO_RESTORE_SUCCEEDED == 1)
  )); then
    run_trusted_pm2 delete "${CANDIDATE_NAME}" >/dev/null 2>&1 ||
      pm2_name_is_absent "${CANDIDATE_NAME}" >/dev/null 2>&1
    if ! pm2_name_is_absent "${CANDIDATE_NAME}" >/dev/null 2>&1; then
      echo "[CRITICAL] Failed candidate could not be deleted from PM2." >&2
      candidate_cleanup_ok=0
    fi
  fi
  if ((
    status != 0 &&
    candidate_cleanup_ok == 1 &&
    (
      (SYSTEM_STATE_CHANGED == 1 && AUTO_RESTORE_SUCCEEDED == 1) ||
      (SYSTEM_STATE_CHANGED == 0 && CANDIDATE_STARTED == 1)
    )
  )); then
    if ! run_trusted_pm2 save >/dev/null 2>&1; then
      echo "[CRITICAL] Final restored PM2 state could not be saved." >&2
    fi
  fi
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
    --skip-build)
      RUN_BUILD=0
      shift
      ;;
    --allow-legacy-active)
      ALLOW_LEGACY_ACTIVE=1
      shift
      ;;
    --candidate-port|--candidate-name|--workdir|--env-file|--pm2-config|--reconciler-env-file|--reconciler-install-dir|--reconciler-lock-file|--reconciler-name|--nginx-config|--rollback-dir|--health-attempts|--health-interval|--public-health-url|--rollback-bundle|--rollback-file)
      (($# >= 2)) || die "$1 requires a value"
      case "$1" in
        --candidate-port) CANDIDATE_PORT="$2" ;;
        --candidate-name) CANDIDATE_NAME="$2" ;;
        --workdir) CANDIDATE_DIR="$2" ;;
        --env-file) ENV_FILE="$2" ;;
        --pm2-config) PM2_CONFIG="$2" ;;
        --reconciler-env-file) RECONCILER_ENV_FILE="$2" ;;
        --reconciler-install-dir) RECONCILER_INSTALL_DIR="$2" ;;
        --reconciler-lock-file) RECONCILER_LOCK_FILE="$2" ;;
        --reconciler-name) RECONCILER_NAME="$2" ;;
        --nginx-config) NGINX_CONFIG="$2" ;;
        --rollback-dir) ROLLBACK_DIR="$2" ;;
        --health-attempts) HEALTH_ATTEMPTS="$2" ;;
        --health-interval) HEALTH_INTERVAL="$2" ;;
        --public-health-url) PUBLIC_HEALTH_URL="$2" ;;
        --rollback-bundle|--rollback-file) ROLLBACK_BUNDLE="$2" ;;
      esac
      shift 2
      ;;
    --health-path)
      (($# >= 2)) || die "--health-path requires a value"
      [[ "$2" == "/canvas" ]] ||
        die "The supplemental page gate is fixed to /canvas"
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

[[ "${ACTION}" == "plan" || "${ACTION}" == "deploy" || "${ACTION}" == "rollback" ]] ||
  die "Action must be plan, deploy, or rollback"
if [[ "${ACTION}" == "rollback" && "${ALLOW_LEGACY_ACTIVE}" == "1" ]]; then
  die "--allow-legacy-active only applies to a deploy bootstrap"
fi
is_unsigned_integer "${CANDIDATE_PORT}" ||
  die "Candidate port must be an integer"
((CANDIDATE_PORT >= 1024 && CANDIDATE_PORT <= 65535)) ||
  die "Candidate port must be between 1024 and 65535"
[[ "${CANDIDATE_NAME}" =~ ^[A-Za-z0-9._-]+$ ]] ||
  die "Candidate PM2 name contains unsupported characters"
[[ "${RECONCILER_NAME}" =~ ^[A-Za-z0-9._-]+$ ]] ||
  die "Reconciler PM2 name contains unsupported characters"
[[ "${CANDIDATE_DIR}" == /* && "${CANDIDATE_DIR}" != "/" ]] ||
  die "Candidate workdir must be an absolute non-root Linux path"
[[ "${NGINX_CONFIG}" == /* && "${NGINX_CONFIG}" != "/" ]] ||
  die "Nginx config must be an absolute non-root Linux path"
[[ "${ROLLBACK_DIR}" == /* && "${ROLLBACK_DIR}" != "/" ]] ||
  die "Rollback directory must be an absolute non-root Linux path"
[[ "${RECONCILER_INSTALL_DIR}" == /* && "${RECONCILER_INSTALL_DIR}" != "/" ]] ||
  die "Reconciler install directory must be an absolute non-root path"
[[ "${RECONCILER_LOCK_FILE}" == /* && "${RECONCILER_LOCK_FILE}" != "/" ]] ||
  die "Reconciler lock file must be an absolute non-root path"
is_unsigned_integer "${HEALTH_ATTEMPTS}" ||
  die "Health attempts must be an integer"
((HEALTH_ATTEMPTS >= 1 && HEALTH_ATTEMPTS <= 120)) ||
  die "Health attempts must be between 1 and 120"
is_unsigned_integer "${HEALTH_INTERVAL}" ||
  die "Health interval must be an integer"
((HEALTH_INTERVAL >= 1 && HEALTH_INTERVAL <= 30)) ||
  die "Health interval must be between 1 and 30 seconds"

CANDIDATE_DIR="${CANDIDATE_DIR%/}"
ENV_FILE="$(absolute_from_workdir "${ENV_FILE}")"
EXPECTED_ENV_FILE="${CANDIDATE_DIR}/.env.local"
if [[ "${ACTION}" == "deploy" && "${ENV_FILE}" != "${EXPECTED_ENV_FILE}" ]]; then
  die "--env-file must equal the candidate release's exact .env.local"
fi
if [[ -z "${PM2_CONFIG}" ]]; then
  PM2_CONFIG="${CANDIDATE_DIR}/deploy/ecosystem.canvas.config.cjs"
else
  PM2_CONFIG="$(absolute_from_workdir "${PM2_CONFIG}")"
fi
BUNDLE_TOOL="${CANDIDATE_DIR}/scripts/canvas-rollback-bundle.mjs"
HEALTH_PROBE="${CANDIDATE_DIR}/scripts/probe-canvas-internal-health.mjs"
RECONCILER_READY_PROBE="${CANDIDATE_DIR}/scripts/probe-canvas-reconciler-readiness.mjs"
BROKER_TLS_PROBE="${CANDIDATE_DIR}/scripts/probe-oauth-broker-tls.mjs"
SUPPLY_CHAIN_CHECK="${CANDIDATE_DIR}/scripts/verify-production-supply-chain.mjs"
PM2_DAEMON_PROBE="${CANDIDATE_DIR}/scripts/probe-existing-pm2-daemon.mjs"
PM2_NO_AUTOSTART_GUARD="${CANDIDATE_DIR}/scripts/pm2-existing-daemon-only.cjs"

echo "Canvas blue/green release plan"
echo "  action: ${ACTION}"
echo "  mutation gate: $([[ "${EXECUTE}" == "1" ]] && echo armed || echo dry-run)"
echo "  tooling/candidate workdir: ${CANDIDATE_DIR}"
echo "  candidate PM2 name: ${CANDIDATE_NAME}"
echo "  candidate port: ${CANDIDATE_PORT}"
echo "  exact candidate env: $([[ "${ENV_FILE}" == "${EXPECTED_ENV_FILE}" ]] && echo yes || echo no)"
echo "  build candidate: $([[ "${RUN_BUILD}" == "1" ]] && echo yes || echo no)"
echo "  legacy active bootstrap: $([[ "${ALLOW_LEGACY_ACTIVE}" == "1" ]] && echo explicitly-armed || echo disabled)"
echo "  Nginx config: ${NGINX_CONFIG}"
echo "  rollback directory: ${ROLLBACK_DIR}"
echo "  singleton reconciler: ${RECONCILER_NAME}"
echo "  reconciler env file: $([[ -n "${RECONCILER_ENV_FILE}" ]] && echo configured || echo missing)"
echo "  public /canvas gate: $([[ -n "${PUBLIC_HEALTH_URL}" ]] && echo configured || echo missing)"
if [[ "${ACTION}" == "rollback" ]]; then
  echo "  rollback bundle: ${ROLLBACK_BUNDLE:-missing}"
fi

if [[ "${ACTION}" == "plan" ]]; then
  echo "[DRY RUN] No process, file, build, Nginx, or PM2 state was changed."
  exit 0
fi
if ((EXECUTE == 0)); then
  echo "[DRY RUN] Add --execute only after reviewing this resolved plan."
  exit 0
fi

((EUID == 0)) ||
  die "Executed transitions must run as the production root PM2/Nginx owner"

for command in node npm curl nginx git pm2 grep sed head tail sleep mktemp cp mv chmod chown mkdir date rm; do
  require_command "${command}"
done
NODE_BIN="$(resolve_trusted_root_executable node)" ||
  die "Node must resolve through a fully trusted root-owned path chain"
NPM_CLI="$(resolve_trusted_root_executable npm)" ||
  die "npm must resolve through a fully trusted root-owned path chain"
PM2_BIN="$(resolve_trusted_root_executable pm2)" ||
  die "PM2 must resolve through a fully trusted root-owned path chain"
GIT_BIN="$(resolve_trusted_root_executable git)" ||
  die "Git must resolve through a fully trusted root-owned path chain"
CURL_BIN="$(resolve_trusted_root_executable curl)" ||
  die "curl must resolve through a fully trusted root-owned path chain"
NGINX_BIN="$(resolve_trusted_root_executable nginx)" ||
  die "Nginx must resolve through a fully trusted root-owned path chain"
for command in grep sed head tail sleep mktemp cp mv chmod chown mkdir date rm; do
  pin_trusted_command "${command}" ||
    die "${command} must resolve through a fully trusted root-owned path chain"
done
NODE_VERSION="$("${NODE_BIN}" -p "process.versions.node")"
[[ "${NODE_VERSION}" == "${REQUIRED_NODE_VERSION}" ]] ||
  die "Node ${REQUIRED_NODE_VERSION} is required"
NPM_VERSION="$("${NODE_BIN}" -- "${NPM_CLI}" --version)"
[[ "${NPM_VERSION}" == "${REQUIRED_NPM_VERSION}" ]] ||
  die "npm ${REQUIRED_NPM_VERSION} is required"
assert_public_canvas_url "${PUBLIC_HEALTH_URL}" ||
  die "--public-health-url must be an exact http(s) /canvas URL without credentials, query, or fragment"
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
acquire_deploy_lock ||
  die "Another Canvas deployment is active or the deployment lock is untrusted"
assert_disabled_npm_config_paths ||
  die "npm user/global configuration suppression paths are not trustworthy"

[[ -d "${CANDIDATE_DIR}" && ! -L "${CANDIDATE_DIR}" ]] ||
  die "Tooling/candidate workdir must be an existing non-symlink directory"
[[ "$("${REALPATH_BIN}" -e -- "${CANDIDATE_DIR}")" == "${CANDIDATE_DIR}" ]] ||
  die "Tooling/candidate workdir must use its canonical absolute path"
trusted_root_path_chain "${CANDIDATE_DIR}" ||
  die "Tooling/candidate workdir must have a fully trusted root-owned path chain"
trusted_root_release_tree "${CANDIDATE_DIR}" ||
  die "Every candidate release entry must be root-owned, immutable, and self-contained"
[[ -f "${BUNDLE_TOOL}" && ! -L "${BUNDLE_TOOL}" ]] ||
  die "Rollback bundle helper is missing or untrusted"
[[ -f "${HEALTH_PROBE}" && ! -L "${HEALTH_PROBE}" ]] ||
  die "Internal health probe is missing or untrusted"
[[ -f "${RECONCILER_READY_PROBE}" && ! -L "${RECONCILER_READY_PROBE}" ]] ||
  die "Reconciler readiness probe is missing or untrusted"
[[ -f "${BROKER_TLS_PROBE}" && ! -L "${BROKER_TLS_PROBE}" ]] ||
  die "OAuth Broker TLS probe is missing or untrusted"
[[ -f "${SUPPLY_CHAIN_CHECK}" && ! -L "${SUPPLY_CHAIN_CHECK}" ]] ||
  die "Production supply-chain verifier is missing or untrusted"
[[ -f "${PM2_DAEMON_PROBE}" && ! -L "${PM2_DAEMON_PROBE}" ]] ||
  die "Existing-PM2-daemon identity probe is missing or untrusted"
[[ -f "${PM2_NO_AUTOSTART_GUARD}" && ! -L "${PM2_NO_AUTOSTART_GUARD}" ]] ||
  die "PM2 no-auto-start guard is missing or untrusted"
"${NODE_BIN}" --check "${BUNDLE_TOOL}"
"${NODE_BIN}" --check "${HEALTH_PROBE}"
"${NODE_BIN}" --check "${RECONCILER_READY_PROBE}"
"${NODE_BIN}" --check "${BROKER_TLS_PROBE}"
"${NODE_BIN}" --check "${SUPPLY_CHAIN_CHECK}"
"${NODE_BIN}" --check "${PM2_DAEMON_PROBE}"
"${NODE_BIN}" --check "${PM2_NO_AUTOSTART_GUARD}"
[[ -d "${PM2_HOME}" && ! -L "${PM2_HOME}" ]] ||
  die "An existing trusted PM2 daemon is required; PM2_HOME is absent"
prepare_trusted_root_directory "${PM2_HOME}" 0700 ||
  die "PM2_HOME must be /root/.pm2 with a trusted root-owned 0700 path chain"
PM2_DAEMON_TOKEN="$(probe_existing_pm2_daemon token)" ||
  die "Existing PM2 daemon identity validation failed; automatic daemon startup is forbidden"
[[ -n "${PM2_DAEMON_TOKEN}" ]] ||
  die "Existing PM2 daemon identity probe returned an empty token"

[[ -f "${NGINX_CONFIG}" && ! -L "${NGINX_CONFIG}" ]] ||
  die "Nginx config must be an existing non-symlink regular file"
[[ "$("${REALPATH_BIN}" -e -- "${NGINX_CONFIG}")" == "${NGINX_CONFIG}" ]] ||
  die "Nginx config must use its canonical absolute path"
trusted_root_path_chain "${NGINX_CONFIG}" ||
  die "Nginx config must have a fully trusted root-owned path chain"
assert_single_proxy_target "${NGINX_CONFIG}"
assert_internal_canvas_denied "${NGINX_CONFIG}"

prepare_trusted_root_directory "${ROLLBACK_DIR}" 0700 ||
  die "Rollback directory must be canonical, root-owned, trusted, and mode 0700"
prepare_trusted_root_directory "${RECONCILER_INSTALL_DIR}" 0755 ||
  die "Reconciler install directory must be canonical, root-owned, trusted, and mode 0755"
reconciler_lock_parent="$("${DIRNAME_BIN}" -- "${RECONCILER_LOCK_FILE}")"
[[ -d "${reconciler_lock_parent}" && ! -L "${reconciler_lock_parent}" ]] ||
  die "Reconciler lock parent must be an existing non-symlink directory"
[[ "$("${REALPATH_BIN}" -e -- "${reconciler_lock_parent}")" == "${reconciler_lock_parent}" ]] ||
  die "Reconciler lock parent must use its canonical absolute path"
[[ "$("${REALPATH_BIN}" -m -- "${RECONCILER_LOCK_FILE}")" == "${RECONCILER_LOCK_FILE}" ]] ||
  die "Reconciler lock path must be canonical"
trusted_root_path_chain "${reconciler_lock_parent}" ||
  die "Reconciler lock parent must have a fully trusted root-owned path chain"

if [[ "${ACTION}" == "rollback" ]]; then
  if ! canvas_upload_sweeper_is_stopped; then
    die "Stop the Canvas upload sweeper service and disable its timer before rollback"
  fi
  [[ -n "${ROLLBACK_BUNDLE}" && "${ROLLBACK_BUNDLE}" == /* ]] ||
    die "--rollback-bundle is required and must be absolute"
  verify_bundle "${ROLLBACK_BUNDLE}"
  load_bundle_state "${ROLLBACK_BUNDLE}" ||
    die "Rollback bundle inspection failed"
  if [[ "${TARGET_WEB_HEALTH_CONTRACT}" == "exact" ]]; then
    pm2_web_is_online \
      "${TARGET_WEB_NAME}" "${TARGET_WEB_PORT}" "${TARGET_WEB_ROOT}" \
      "${NODE_BIN}" "${REQUIRED_NODE_VERSION}" ||
      die "Bundled rollback Web process runtime identity is not exact"
  else
    pm2_web_is_online \
      "${TARGET_WEB_NAME}" "${TARGET_WEB_PORT}" "${TARGET_WEB_ROOT}" ||
      die "Bundled legacy rollback Web process identity is not exactly online"
  fi
  if [[ "${TARGET_WEB_HEALTH_CONTRACT}" == "exact" ]]; then
    probe_internal_health \
      "${TARGET_WEB_ROOT}" "${TARGET_WEB_ENV_FILE}" "${TARGET_WEB_PORT}" ||
      die "Rollback target failed the exact internal health/build/DB contract"
  elif [[
    "${TARGET_WEB_HEALTH_CONTRACT}" == "legacy-bootstrap" &&
    "${TARGET_WORKER_PRESENT}" == "false"
  ]]; then
    echo "[WARN] Rollback target is an explicitly recorded pre-health bootstrap release with no worker."
  else
    die "Rollback bundle health/worker contract is invalid"
  fi
  page_is_healthy \
    "http://127.0.0.1:${TARGET_WEB_PORT}/canvas" \
    "${HEALTH_ATTEMPTS}" \
    "direct rollback Canvas page" ||
    die "Rollback target Canvas page is unhealthy"

  current_port="$(proxy_target_port "${NGINX_CONFIG}")"
  active_identity="$(
    pm2_web_identity_for_port "${current_port}"
  )" || die "Current Nginx target does not map to exactly one online PM2 Web process"
  mapfile -t active_fields <<<"${active_identity}"
  [[ "${#active_fields[@]}" == "2" ]] ||
    die "Current Web process identity is malformed"
  current_name="${active_fields[0]}"
  current_root="${active_fields[1]}"
  current_env_file="${current_root}/.env.local"
  pm2_web_is_online \
    "${current_name}" "${current_port}" "${current_root}" \
    "${NODE_BIN}" "${REQUIRED_NODE_VERSION}" ||
    die "Current release cannot be captured with an exact Node runtime"
  probe_internal_health \
    "${current_root}" "${current_env_file}" "${current_port}" ||
    die "Current release cannot be captured as forward recovery"

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  RESTORE_BUNDLE="${ROLLBACK_DIR}/canvas-forward-${timestamp}-port-${current_port}-${BASHPID}"
  create_state_bundle \
    "${RESTORE_BUNDLE}" \
    "${current_name}" \
    "${current_port}" \
    "${current_root}" \
    "${current_env_file}" \
    "exact" ||
    die "Forward-recovery bundle creation failed; no state was changed"

  SYSTEM_STATE_CHANGED=1
  restore_worker_from_bundle "${ROLLBACK_BUNDLE}" ||
    die "Bundled worker restoration failed"
  restore_nginx_from_bundle "${ROLLBACK_BUNDLE}" ||
    die "Bundled Nginx restoration failed"

  [[ "$(proxy_target_port "${NGINX_CONFIG}")" == "${TARGET_WEB_PORT}" ]] ||
    die "Restored Nginx target does not match the rollback manifest"
  if [[ "${TARGET_WEB_HEALTH_CONTRACT}" == "exact" ]]; then
    probe_internal_health \
      "${TARGET_WEB_ROOT}" "${TARGET_WEB_ENV_FILE}" "${TARGET_WEB_PORT}" ||
      die "Post-rollback target internal health failed"
  else
    probe_internal_health \
      "${current_root}" "${current_env_file}" "${current_port}" ||
      die "Shared DB contract failed after legacy-bootstrap rollback"
  fi
  page_is_healthy \
    "http://127.0.0.1:${TARGET_WEB_PORT}/canvas" \
    "${HEALTH_ATTEMPTS}" \
    "post-rollback direct Canvas page" ||
    die "Restored rollback Web page is unhealthy"
  page_is_healthy "${PUBLIC_HEALTH_URL}" "${HEALTH_ATTEMPTS}" "public rollback" ||
    die "Public rollback Canvas page failed"
  if [[ "${TARGET_WORKER_PRESENT}" == "true" ]]; then
    pm2_single_worker_is_online "${NODE_BIN}" "${REQUIRED_NODE_VERSION}" ||
      die "Rollback did not restore the bundled singleton worker"
  else
    pm2_worker_is_absent "${RECONCILER_NAME}" ||
      die "Rollback of a no-worker release did not delete the worker"
  fi
  run_trusted_pm2 save
  CUTOVER_COMMITTED=1
  echo "[OK] Canvas Web and worker rolled back atomically to the verified bundle."
  echo "[INFO] Forward-recovery bundle: ${RESTORE_BUNDLE}"
  exit 0
fi

[[ -f "${CANDIDATE_DIR}/package.json" ]] ||
  die "Candidate package.json is missing"
[[ -f "${CANDIDATE_DIR}/server.js" ]] ||
  die "Candidate server.js is missing"
[[ -f "${CANDIDATE_DIR}/scripts/start-canvas-web.mjs" ]] ||
  die "Candidate exact-environment Web bootstrap is missing"
[[ -f "${CANDIDATE_DIR}/scripts/run-canvas-build.mjs" ]] ||
  die "Candidate exact-environment build runner is missing"
[[ -f "${CANDIDATE_DIR}/scripts/check-canvas-production-env.mjs" ]] ||
  die "Canvas production preflight script is missing"
[[ -f "${SUPPLY_CHAIN_CHECK}" && ! -L "${SUPPLY_CHAIN_CHECK}" ]] ||
  die "Production supply-chain verifier is missing or untrusted"
[[ -f "${BROKER_TLS_PROBE}" && ! -L "${BROKER_TLS_PROBE}" ]] ||
  die "OAuth broker TLS preflight script is missing or untrusted"
[[ -f "${CANDIDATE_DIR}/deploy/install-canvas-reconciler.sh" ]] ||
  die "Canvas reconciler installer is missing"
[[ -f "${PM2_CONFIG}" && ! -L "${PM2_CONFIG}" ]] ||
  die "Candidate PM2 config is missing or untrusted"
[[ -f "${ENV_FILE}" && ! -L "${ENV_FILE}" ]] ||
  die "Candidate .env.local must be an existing non-symlink regular file"
[[ "$("${REALPATH_BIN}" -e -- "${ENV_FILE}")" == "${ENV_FILE}" ]] ||
  die "Candidate .env.local must use its canonical absolute path"
trusted_root_path_chain "${ENV_FILE}" ||
  die "Candidate .env.local must have a fully trusted root-owned path chain"
[[ "$("${STAT_BIN}" -c '%u' -- "${ENV_FILE}")" == "0" ]] ||
  die "Candidate .env.local must be root-owned"
env_mode="$("${STAT_BIN}" -c '%a' -- "${ENV_FILE}")"
[[ "${env_mode}" =~ ^[0-7]{3,4}$ ]] ||
  die "Candidate .env.local permissions are invalid"
(( (8#${env_mode} & 077) == 0 )) ||
  die "Candidate .env.local must not grant group or other permissions"
[[ -n "${RECONCILER_ENV_FILE}" && "${RECONCILER_ENV_FILE}" == /* ]] ||
  die "--reconciler-env-file is required and must be absolute"
[[ -f "${RECONCILER_ENV_FILE}" && ! -L "${RECONCILER_ENV_FILE}" ]] ||
  die "Reconciler env file must be an existing non-symlink regular file"
[[ "$("${REALPATH_BIN}" -e -- "${RECONCILER_ENV_FILE}")" == "${RECONCILER_ENV_FILE}" ]] ||
  die "Reconciler env file must use its canonical absolute path"
trusted_root_path_chain "${RECONCILER_ENV_FILE}" ||
  die "Reconciler env file must have a fully trusted root-owned path chain"
[[ "$("${STAT_BIN}" -c '%a' -- "${RECONCILER_ENV_FILE}")" == "600" ]] ||
  die "Reconciler env file must be root-only mode 0600"

current_port="$(proxy_target_port "${NGINX_CONFIG}")"
[[ "${current_port}" != "${CANDIDATE_PORT}" ]] ||
  die "Candidate port equals the active Nginx port"
pm2_name_is_absent "${CANDIDATE_NAME}" ||
  die "Candidate PM2 name already exists; use a unique immutable release name"

(
  cd -- "${CANDIDATE_DIR}"
  NODE_ENV=production "${NODE_BIN}" -- scripts/check-canvas-production-env.mjs \
    --root "${CANDIDATE_DIR}" \
    --env-file "${ENV_FILE}"
)
if ((RUN_BUILD == 1)); then
  (
    cd -- "${CANDIDATE_DIR}"
    "${ENV_BIN}" -i \
      "PATH=${PATH}" \
      "HOME=${HOME}" \
      "USER=${USER}" \
      "LOGNAME=${LOGNAME}" \
      "LANG=${LANG}" \
      "NPM_CONFIG_USERCONFIG=${NPM_USER_CONFIG}" \
      "NPM_CONFIG_GLOBALCONFIG=${NPM_GLOBAL_CONFIG}" \
      "${NODE_BIN}" -- "${NPM_CLI}" ci \
        --include=dev \
        --ignore-scripts \
        --allow-remote=root \
        --allow-git=none \
        --allow-file=none \
        --allow-directory=none
  )
fi
(
  cd -- "${CANDIDATE_DIR}"
  "${ENV_BIN}" -i \
    "PATH=${PATH}" \
    "HOME=${HOME}" \
    "USER=${USER}" \
    "LOGNAME=${LOGNAME}" \
    "LANG=${LANG}" \
    "NPM_CONFIG_USERCONFIG=${NPM_USER_CONFIG}" \
    "NPM_CONFIG_GLOBALCONFIG=${NPM_GLOBAL_CONFIG}" \
    "STARGAZE_NPM_CLI=${NPM_CLI}" \
    "STARGAZE_GIT_BIN=${GIT_BIN}" \
    "${NODE_BIN}" -- "${SUPPLY_CHAIN_CHECK}"
)
if ((RUN_BUILD == 1)); then
  (
    cd -- "${CANDIDATE_DIR}"
    "${NODE_BIN}" -- scripts/run-canvas-build.mjs \
      --root "${CANDIDATE_DIR}" \
      --env-file "${ENV_FILE}"
  )
fi
trusted_root_release_tree "${CANDIDATE_DIR}" ||
  die "Build or dependency installation produced an untrusted release entry"
(
  cd -- "${CANDIDATE_DIR}"
  NODE_ENV=production "${NODE_BIN}" -- scripts/check-canvas-production-env.mjs \
    --root "${CANDIDATE_DIR}" \
    --env-file "${ENV_FILE}" \
    --require-build
)

"${NODE_BIN}" --check "${CANDIDATE_DIR}/server.js"
"${NODE_BIN}" --check "${CANDIDATE_DIR}/scripts/canvas-exact-env.mjs"
"${NODE_BIN}" --check "${CANDIDATE_DIR}/scripts/start-canvas-web.mjs"
"${NODE_BIN}" --check "${CANDIDATE_DIR}/scripts/run-canvas-build.mjs"
"${NODE_BIN}" --check "${BROKER_TLS_PROBE}"
"${NODE_BIN}" --check "${SUPPLY_CHAIN_CHECK}"
"${NODE_BIN}" --check "${PM2_CONFIG}"
"${NODE_BIN}" -- "${BROKER_TLS_PROBE}" \
  --root "${CANDIDATE_DIR}" \
  --env-file "${ENV_FILE}"
CANDIDATE_STARTED=1
CANVAS_PM2_NAME="${CANDIDATE_NAME}" \
CANVAS_APP_DIR="${CANDIDATE_DIR}" \
CANVAS_PORT="${CANDIDATE_PORT}" \
CANVAS_ENV_FILE="${ENV_FILE}" \
CANVAS_NODE_BIN="${NODE_BIN}" \
  run_trusted_pm2 startOrReload "${PM2_CONFIG}" \
      --only "${CANDIDATE_NAME}" --update-env
pm2_web_is_online \
  "${CANDIDATE_NAME}" "${CANDIDATE_PORT}" "${CANDIDATE_DIR}" \
  "${NODE_BIN}" "${REQUIRED_NODE_VERSION}" ||
  die "Candidate PM2 identity/status validation failed"

probe_internal_health \
  "${CANDIDATE_DIR}" "${ENV_FILE}" "${CANDIDATE_PORT}" ||
  die "Candidate failed the exact internal health/build/DB contract"
page_is_healthy \
  "http://127.0.0.1:${CANDIDATE_PORT}/canvas" \
  "${HEALTH_ATTEMPTS}" \
  "direct candidate Canvas page" ||
  die "Candidate Canvas page failed; active traffic was not changed"

active_identity="$(
  pm2_web_identity_for_port "${current_port}"
)" || die "Current Nginx target does not map to exactly one online PM2 Web process"
mapfile -t active_fields <<<"${active_identity}"
[[ "${#active_fields[@]}" == "2" ]] ||
  die "Current Web process identity is malformed"
active_name="${active_fields[0]}"
active_root="${active_fields[1]}"
active_env_file="${active_root}/.env.local"
active_health_contract="exact"
active_probe_attempts="${HEALTH_ATTEMPTS}"
if ((ALLOW_LEGACY_ACTIVE == 1)); then
  active_probe_attempts=1
fi
if ! probe_internal_health \
  "${active_root}" \
  "${active_env_file}" \
  "${current_port}" \
  "${active_probe_attempts}"; then
  ((ALLOW_LEGACY_ACTIVE == 1)) ||
    die "Current release is not an exact-health rollback target; only a reviewed first-release bootstrap may use --allow-legacy-active"
  active_worker_state="$(
    pm2_worker_state \
      "${RECONCILER_NAME}" \
      "${RECONCILER_INSTALL_DIR}/canvas-reconciler-worker.mjs"
  )" || die "Could not prove the legacy active worker state"
  [[ "${active_worker_state}" == "absent" ]] ||
    die "Legacy bootstrap is forbidden when a reconciler already exists"
  page_is_healthy \
    "http://127.0.0.1:${current_port}/canvas" \
    "${HEALTH_ATTEMPTS}" \
    "legacy active Canvas baseline" ||
    die "Legacy active release failed its Canvas baseline"
  active_health_contract="legacy-bootstrap"
  echo "[WARN] One-time legacy bootstrap armed; rollback will restore Web and delete the newly installed worker."
else
  pm2_web_is_online \
    "${active_name}" "${current_port}" "${active_root}" \
    "${NODE_BIN}" "${REQUIRED_NODE_VERSION}" ||
    die "Current exact-health release does not use the required Node runtime"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
RESTORE_BUNDLE="${ROLLBACK_DIR}/canvas-rollback-${timestamp}-port-${current_port}-${BASHPID}"
create_state_bundle \
  "${RESTORE_BUNDLE}" \
  "${active_name}" \
  "${current_port}" \
  "${active_root}" \
  "${active_env_file}" \
  "${active_health_contract}" ||
  die "Rollback bundle creation failed; active state was not changed"

switch_nginx_to_port "${CANDIDATE_PORT}"
page_is_healthy "${PUBLIC_HEALTH_URL}" "${HEALTH_ATTEMPTS}" "public cutover" ||
  die "Public Canvas page failed after cutover"

CANVAS_DEPLOY_LOCK_FD="${DEPLOY_LOCK_FD}" \
  /bin/bash -p "${CANDIDATE_DIR}/deploy/install-canvas-reconciler.sh" install \
  --execute \
  --env-file "${RECONCILER_ENV_FILE}" \
  --url "http://127.0.0.1:${CANDIDATE_PORT}/api/internal/canvas/reconcile" \
  --install-dir "${RECONCILER_INSTALL_DIR}" \
  --lock-file "${RECONCILER_LOCK_FILE}" \
  --pm2-name "${RECONCILER_NAME}"
pm2_single_worker_is_online "${NODE_BIN}" "${REQUIRED_NODE_VERSION}" ||
  die "Cutover did not expose exactly one online singleton reconciler"
probe_internal_health \
  "${CANDIDATE_DIR}" "${ENV_FILE}" "${CANDIDATE_PORT}" ||
  die "Post-worker candidate internal health failed"

run_trusted_pm2 save
CUTOVER_COMMITTED=1
echo "[OK] Canvas Web and singleton worker now target candidate port ${CANDIDATE_PORT}."
echo "[INFO] Complete rollback bundle: ${RESTORE_BUNDLE}"
echo "[INFO] Previous Web process remains online for verified rollback."
