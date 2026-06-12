#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/tiktok-ai-mcn}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.local}"
LOG_FILE="${LOG_FILE:-/var/log/image-generation-worker.log}"
LOCK_FILE="${LOCK_FILE:-/tmp/tiktok-image-generation-worker.lock}"
WORKER_URL="${WORKER_URL:-http://127.0.0.1:3000/api/cron/process-image-generation?maxRuntimeMs=220000&maxGenerationItems=3&maxEcomItems=0}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "$(date -Is) CRON_SECRET is not configured" >> "$LOG_FILE"
  exit 1
fi

run_worker() {
  echo "$(date -Is) image worker tick" >> "$LOG_FILE"
  curl -sS --max-time 240 -X POST \
    -H "x-cron-secret: ${CRON_SECRET}" \
    "$WORKER_URL" >> "$LOG_FILE" 2>&1
  echo >> "$LOG_FILE"
}

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || exit 0
fi

run_worker
