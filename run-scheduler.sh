#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/tiktok-ai-mcn}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.local}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not configured" >> /var/log/publish-scheduler.log
  exit 1
fi

curl -s -H "x-cron-secret: ${CRON_SECRET}" http://localhost:3000/api/publish/process-scheduled >> /var/log/publish-scheduler.log 2>&1
