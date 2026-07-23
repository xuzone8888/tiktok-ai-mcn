#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/tiktok-ai-mcn}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.local}"
LOG_FILE="${LOG_FILE:-/var/log/youtube-data-retention.log}"
LOCK_FILE="${LOCK_FILE:-/tmp/youtube-data-retention.lock}"
RETENTION_URL="${RETENTION_URL:-http://127.0.0.1:3000/api/youtube/data-retention}"

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

run_retention() {
  echo "$(date -Is) YouTube data retention tick" >> "$LOG_FILE"
  if curl -sS --fail --max-time 290 \
    -H "x-cron-secret: ${CRON_SECRET}" \
    "$RETENTION_URL" >> "$LOG_FILE" 2>&1; then
    echo >> "$LOG_FILE"
  else
    status=$?
    echo "$(date -Is) YouTube data retention failed exit=${status}" >> "$LOG_FILE"
    echo >> "$LOG_FILE"
    exit "$status"
  fi
}

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || exit 0
fi

run_retention
