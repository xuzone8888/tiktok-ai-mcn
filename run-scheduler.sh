#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/tiktok-ai-mcn}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.local}"
LOG_FILE="${LOG_FILE:-/var/log/publish-scheduler.log}"
LOCK_FILE="${LOCK_FILE:-/tmp/tiktok-publish-scheduler.lock}"
SCHEDULER_URL="${SCHEDULER_URL:-http://127.0.0.1:3000/api/publish/process-scheduled}"

if [ -z "${CRON_SECRET:-}" ] && [ -f "$ENV_FILE" ]; then
  CRON_SECRET_LINE="$(grep -m1 '^CRON_SECRET=' "$ENV_FILE" || true)"
  CRON_SECRET="${CRON_SECRET_LINE#CRON_SECRET=}"
  CRON_SECRET="${CRON_SECRET%$'\r'}"
  CRON_SECRET="${CRON_SECRET%\"}"
  CRON_SECRET="${CRON_SECRET#\"}"
  CRON_SECRET="${CRON_SECRET%\'}"
  CRON_SECRET="${CRON_SECRET#\'}"
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "$(date -Is) CRON_SECRET is not configured" >> "$LOG_FILE"
  exit 1
fi

run_scheduler() {
  echo "$(date -Is) publish scheduler tick" >> "$LOG_FILE"
  if curl -sS --fail --max-time 290 \
    -H "x-cron-secret: ${CRON_SECRET}" \
    "$SCHEDULER_URL" >> "$LOG_FILE" 2>&1; then
    echo >> "$LOG_FILE"
  else
    status=$?
    echo "$(date -Is) publish scheduler failed exit=${status}" >> "$LOG_FILE"
    echo >> "$LOG_FILE"
    exit "$status"
  fi
}

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || exit 0
fi

run_scheduler
