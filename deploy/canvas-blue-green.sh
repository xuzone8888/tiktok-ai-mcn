#!/usr/bin/env bash
#
# Fail-closed blue/green release helper for StarGaze Canvas.
#
# The default is a read-only plan. An executed transition is committed only
# after the exact internal health contract, build identity, database contract,
# Nginx cutover, public Canvas page, and singleton reconciler all pass.

set -Eeuo pipefail
IFS=$'\n\t'
unset NODE_OPTIONS

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
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

BUNDLE_TOOL=""
HEALTH_PROBE=""
RECONCILER_READY_PROBE=""
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

canvas_upload_sweeper_is_stopped() {
  local timer_load_state
  local timer_active_state
  local timer_unit_file_state
  local service_load_state
  local service_active_state

  timer_load_state="$(
    systemctl show \
      --property=LoadState \
      --value \
      stargaze-canvas-upload-sweeper.timer 2>/dev/null
  )" || return 1
  timer_active_state="$(
    systemctl show \
      --property=ActiveState \
      --value \
      stargaze-canvas-upload-sweeper.timer 2>/dev/null
  )" || return 1
  service_load_state="$(
    systemctl show \
      --property=LoadState \
      --value \
      stargaze-canvas-upload-sweeper.service 2>/dev/null
  )" || return 1
  service_active_state="$(
    systemctl show \
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
    systemctl show \
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
  if ! node -e '
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
  node -e '
    try {
      const url = new URL(process.argv[1]);
      const valid =
        url.protocol === "https:" &&
        ["www.toryxai.com", "toryxai.com"].includes(url.hostname) &&
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
      curl --silent --show-error --output /dev/null \
        --connect-timeout 3 --max-time 10 \
        --header 'Cache-Control: no-cache' \
        --write-out '%{http_code}' "${url}" 2>/dev/null || true
    )"
    if [[ "${code}" =~ ^[23][0-9][0-9]$ ]]; then
      echo "[OK] ${label} responded with HTTP ${code}"
      return 0
    fi
    if ((attempt < attempts)); then
      sleep "${HEALTH_INTERVAL}"
    fi
  done

  echo "[FAIL] ${label} did not return HTTP 2xx/3xx" >&2
  return 1
}

probe_internal_health() {
  local root="$1"
  local env_file="$2"
  local port="$3"
  local attempts="${4:-${HEALTH_ATTEMPTS}}"
  NODE_ENV=production node "${HEALTH_PROBE}" \
    --root "${root}" \
    --env-file "${env_file}" \
    --url "http://127.0.0.1:${port}/api/internal/canvas/health" \
    --attempts "${attempts}" \
    --interval-ms "$((HEALTH_INTERVAL * 1000))"
}

pm2_name_is_absent() {
  local name="$1"
  pm2 jlist 2>/dev/null |
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

pm2_web_identity_for_port() {
  local port="$1"
  pm2 jlist 2>/dev/null |
    node -e '
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
            String(entry.pm2_env?.env?.PORT ?? entry.pm2_env?.PORT ?? "") === port
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
  pm2 jlist 2>/dev/null |
    node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const [name, port, cwd] = process.argv.slice(1);
        try {
          const matches = JSON.parse(input).filter((entry) =>
            entry.name === name &&
            entry.pm2_env?.status === "online" &&
            entry.pm2_env?.exec_mode === "fork_mode" &&
            String(entry.pm2_env?.env?.PORT ?? entry.pm2_env?.PORT ?? "") === port &&
            entry.pm2_env?.pm_cwd === cwd
          );
          process.exit(matches.length === 1 ? 0 : 1);
        } catch {
          process.exit(2);
        }
      });
    ' "${name}" "${port}" "${cwd}"
}

pm2_worker_is_absent_once() {
  local name="$1"
  pm2 jlist 2>/dev/null |
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

pm2_worker_state() {
  local name="$1"
  local script="$2"
  local pm2_state
  local first_identity
  local second_identity
  pm2_state="$(pm2 jlist 2>/dev/null)" || return 1
  if printf '%s' "${pm2_state}" |
    node -e '
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
  first_identity="$(
    printf '%s' "${pm2_state}" |
    node "${RECONCILER_READY_PROBE}" \
      --name "${name}" \
      --script "${script}" \
      --lock-file "${RECONCILER_LOCK_FILE}"
  )" ||
    return 1
  [[ -n "${first_identity}" ]] || return 1
  sleep 1
  second_identity="$(
    pm2 jlist 2>/dev/null |
      node "${RECONCILER_READY_PROBE}" \
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
  [[ "$(
    pm2_worker_state \
      "${RECONCILER_NAME}" \
      "${RECONCILER_INSTALL_DIR}/canvas-reconciler-worker.mjs"
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
  node "${BUNDLE_TOOL}" verify \
    --bundle-dir "${bundle}" \
    "${common[@]}"
}

load_bundle_state() {
  local bundle="$1"
  local output
  local -a common fields
  mapfile -t common < <(bundle_common_arguments)
  output="$(
    node "${BUNDLE_TOOL}" inspect \
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
      "${RECONCILER_INSTALL_DIR}/canvas-reconciler-worker.mjs"
  )" || return 1

  node "${BUNDLE_TOOL}" create \
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
    pm2 delete "${RECONCILER_NAME}" >/dev/null 2>&1 || true
  fi
  mapfile -t common < <(bundle_common_arguments)
  restored_state="$(
    node "${BUNDLE_TOOL}" restore-worker \
      --bundle-dir "${bundle}" \
      "${common[@]}"
  )" || return 1

  if [[ "${restored_state}" == "present" ]]; then
    CANVAS_RECONCILER_SETTINGS_FILE="${RECONCILER_INSTALL_DIR}/canvas-reconciler.settings.json" \
      run_pm2_with_clean_environment \
        "$(command -v pm2)" startOrReload \
        "${RECONCILER_INSTALL_DIR}/ecosystem.canvas-reconciler.config.cjs" \
        --only "${RECONCILER_NAME}" --update-env ||
      return 1
    pm2_single_worker_is_online || return 1
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
  node "${BUNDLE_TOOL}" restore-nginx \
    --bundle-dir "${bundle}" \
    "${common[@]}" ||
    return 1
  assert_single_proxy_target "${NGINX_CONFIG}" || return 1
  assert_internal_canvas_denied "${NGINX_CONFIG}" || return 1
  nginx -t || return 1
  nginx -s reload || return 1
}

restore_system_from_bundle() {
  local bundle="$1"
  if ! restore_worker_from_bundle "${bundle}"; then
    echo "[CRITICAL] Worker restoration failed." >&2
    return 1
  fi
  if ! restore_nginx_from_bundle "${bundle}"; then
    echo "[CRITICAL] Nginx restoration failed." >&2
    return 1
  fi
  if ! pm2 save >/dev/null; then
    echo "[CRITICAL] Restored PM2 state could not be saved." >&2
    return 1
  fi
}

switch_nginx_to_port() {
  local port="$1"
  local config_dir
  config_dir="$(dirname -- "${NGINX_CONFIG}")"
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
  mv -f -- "${TEMP_CONFIG}" "${NGINX_CONFIG}"
  TEMP_CONFIG=""
  nginx -t
  nginx -s reload
}

on_exit() {
  local status=$?
  trap - EXIT

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
    pm2 stop "${CANDIDATE_NAME}" >/dev/null 2>&1 || true
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
assert_public_canvas_url "${PUBLIC_HEALTH_URL}" ||
  die "--public-health-url must be an exact http(s) /canvas URL without credentials, query, or fragment"

for command in node npm curl nginx pm2 env grep sed head tail sleep mktemp cp mv chmod chown mkdir date dirname bash realpath stat systemctl; do
  require_command "${command}"
done
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 20 || minor < 12) process.exit(1);
' || die "Node >=20.12 and <21 is required"
pm2_version="$(pm2 -v | tail -n 1)"
node -e '
  const [major, minor] = process.argv[1].split(".").map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) ||
      major < 4 || (major === 4 && minor < 3)) process.exit(1);
' "${pm2_version}" || die "PM2 >=4.3 is required"

[[ -d "${CANDIDATE_DIR}" && ! -L "${CANDIDATE_DIR}" ]] ||
  die "Tooling/candidate workdir must be an existing non-symlink directory"
[[ "$(realpath -e -- "${CANDIDATE_DIR}")" == "${CANDIDATE_DIR}" ]] ||
  die "Tooling/candidate workdir must use its canonical absolute path"
[[ -f "${BUNDLE_TOOL}" && ! -L "${BUNDLE_TOOL}" ]] ||
  die "Rollback bundle helper is missing or untrusted"
[[ -f "${HEALTH_PROBE}" && ! -L "${HEALTH_PROBE}" ]] ||
  die "Internal health probe is missing or untrusted"
[[ -f "${RECONCILER_READY_PROBE}" && ! -L "${RECONCILER_READY_PROBE}" ]] ||
  die "Reconciler readiness probe is missing or untrusted"
node --check "${BUNDLE_TOOL}"
node --check "${HEALTH_PROBE}"
node --check "${RECONCILER_READY_PROBE}"

[[ -f "${NGINX_CONFIG}" && ! -L "${NGINX_CONFIG}" ]] ||
  die "Nginx config must be an existing non-symlink regular file"
assert_single_proxy_target "${NGINX_CONFIG}"
assert_internal_canvas_denied "${NGINX_CONFIG}"

mkdir -p -- "${ROLLBACK_DIR}"
[[ -d "${ROLLBACK_DIR}" && ! -L "${ROLLBACK_DIR}" ]] ||
  die "Rollback directory must be a non-symlink directory"
chmod 0700 -- "${ROLLBACK_DIR}"
chown root:root -- "${ROLLBACK_DIR}"
[[ "$(realpath -e -- "${ROLLBACK_DIR}")" == "${ROLLBACK_DIR}" ]] ||
  die "Rollback directory must use its canonical absolute path"

if [[ "${ACTION}" == "rollback" ]]; then
  if ! canvas_upload_sweeper_is_stopped; then
    die "Stop the Canvas upload sweeper service and disable its timer before rollback"
  fi
  [[ -n "${ROLLBACK_BUNDLE}" && "${ROLLBACK_BUNDLE}" == /* ]] ||
    die "--rollback-bundle is required and must be absolute"
  verify_bundle "${ROLLBACK_BUNDLE}"
  load_bundle_state "${ROLLBACK_BUNDLE}" ||
    die "Rollback bundle inspection failed"
  pm2_web_is_online \
    "${TARGET_WEB_NAME}" "${TARGET_WEB_PORT}" "${TARGET_WEB_ROOT}" ||
    die "Bundled rollback Web process identity is not exactly online"
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
    pm2_single_worker_is_online ||
      die "Rollback did not restore the bundled singleton worker"
  else
    pm2_worker_is_absent "${RECONCILER_NAME}" ||
      die "Rollback of a no-worker release did not delete the worker"
  fi
  pm2 save
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
[[ -f "${CANDIDATE_DIR}/deploy/install-canvas-reconciler.sh" ]] ||
  die "Canvas reconciler installer is missing"
[[ -f "${PM2_CONFIG}" && ! -L "${PM2_CONFIG}" ]] ||
  die "Candidate PM2 config is missing or untrusted"
[[ -f "${ENV_FILE}" && ! -L "${ENV_FILE}" ]] ||
  die "Candidate .env.local must be an existing non-symlink regular file"
[[ "$(stat -c '%u' -- "${ENV_FILE}")" == "0" ]] ||
  die "Candidate .env.local must be root-owned"
env_mode="$(stat -c '%a' -- "${ENV_FILE}")"
[[ "${env_mode}" =~ ^[0-7]{3,4}$ ]] ||
  die "Candidate .env.local permissions are invalid"
(( (8#${env_mode} & 077) == 0 )) ||
  die "Candidate .env.local must not grant group or other permissions"
[[ -n "${RECONCILER_ENV_FILE}" && "${RECONCILER_ENV_FILE}" == /* ]] ||
  die "--reconciler-env-file is required and must be absolute"
[[ -f "${RECONCILER_ENV_FILE}" && ! -L "${RECONCILER_ENV_FILE}" ]] ||
  die "Reconciler env file must be an existing non-symlink regular file"

current_port="$(proxy_target_port "${NGINX_CONFIG}")"
[[ "${current_port}" != "${CANDIDATE_PORT}" ]] ||
  die "Candidate port equals the active Nginx port"
pm2_name_is_absent "${CANDIDATE_NAME}" ||
  die "Candidate PM2 name already exists; use a unique immutable release name"

(
  cd -- "${CANDIDATE_DIR}"
  NODE_ENV=production node scripts/check-canvas-production-env.mjs \
    --root "${CANDIDATE_DIR}" \
    --env-file "${ENV_FILE}"
)
if ((RUN_BUILD == 1)); then
  (
    cd -- "${CANDIDATE_DIR}"
    env -i \
      "PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" \
      "HOME=${HOME:-/root}" \
      "USER=${USER:-root}" \
      "LOGNAME=${LOGNAME:-root}" \
      "LANG=${LANG:-C.UTF-8}" \
      "$(command -v npm)" ci --include=dev
    node scripts/run-canvas-build.mjs \
      --root "${CANDIDATE_DIR}" \
      --env-file "${ENV_FILE}"
  )
fi
(
  cd -- "${CANDIDATE_DIR}"
  NODE_ENV=production node scripts/check-canvas-production-env.mjs \
    --root "${CANDIDATE_DIR}" \
    --env-file "${ENV_FILE}" \
    --require-build
)

node --check "${CANDIDATE_DIR}/server.js"
node --check "${CANDIDATE_DIR}/scripts/canvas-exact-env.mjs"
node --check "${CANDIDATE_DIR}/scripts/start-canvas-web.mjs"
node --check "${CANDIDATE_DIR}/scripts/run-canvas-build.mjs"
node --check "${PM2_CONFIG}"
CANVAS_PM2_NAME="${CANDIDATE_NAME}" \
CANVAS_APP_DIR="${CANDIDATE_DIR}" \
CANVAS_PORT="${CANDIDATE_PORT}" \
CANVAS_ENV_FILE="${ENV_FILE}" \
  run_pm2_with_clean_environment \
    "$(command -v pm2)" startOrReload "${PM2_CONFIG}" \
      --only "${CANDIDATE_NAME}" --update-env
CANDIDATE_STARTED=1
pm2_web_is_online \
  "${CANDIDATE_NAME}" "${CANDIDATE_PORT}" "${CANDIDATE_DIR}" ||
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

SYSTEM_STATE_CHANGED=1
switch_nginx_to_port "${CANDIDATE_PORT}"
page_is_healthy "${PUBLIC_HEALTH_URL}" "${HEALTH_ATTEMPTS}" "public cutover" ||
  die "Public Canvas page failed after cutover"

bash "${CANDIDATE_DIR}/deploy/install-canvas-reconciler.sh" install \
  --execute \
  --env-file "${RECONCILER_ENV_FILE}" \
  --url "http://127.0.0.1:${CANDIDATE_PORT}/api/internal/canvas/reconcile" \
  --install-dir "${RECONCILER_INSTALL_DIR}" \
  --lock-file "${RECONCILER_LOCK_FILE}" \
  --pm2-name "${RECONCILER_NAME}"
pm2_single_worker_is_online ||
  die "Cutover did not expose exactly one online singleton reconciler"
probe_internal_health \
  "${CANDIDATE_DIR}" "${ENV_FILE}" "${CANDIDATE_PORT}" ||
  die "Post-worker candidate internal health failed"

pm2 save
CUTOVER_COMMITTED=1
echo "[OK] Canvas Web and singleton worker now target candidate port ${CANDIDATE_PORT}."
echo "[INFO] Complete rollback bundle: ${RESTORE_BUNDLE}"
echo "[INFO] Previous Web process remains online for verified rollback."
