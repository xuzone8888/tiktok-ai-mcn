#!/bin/bash
set -euo pipefail

WORKER_TOKEN="${WORKER_AUTH_TOKEN:-}"
unset WORKER_AUTH_TOKEN
if [[ ! "$WORKER_TOKEN" =~ ^[0-9a-f]{64}$ ]]; then
  echo "WORKER_AUTH_TOKEN is missing or invalid" >&2
  exit 2
fi

echo "=== Step 1: Health Check ==="
printf 'Authorization: Bearer %s\n' "$WORKER_TOKEN" |
  curl -fsS -H @- http://127.0.0.1:9091/health
echo ""
echo ""
echo "=== Step 2: Render Request to Mac Worker ==="
echo "Using picsum.photos test images (3 random 1080x1920 images)"
START=$(date +%s)

RESULT=$(printf 'Authorization: Bearer %s\n' "$WORKER_TOKEN" | curl -sS -w "\n%{http_code}" --max-time 120 \
  http://127.0.0.1:9091/api/render \
  -X POST \
  -H "Content-Type: application/json" \
  -H @- \
  -d '{"images":["https://picsum.photos/1080/1920.jpg","https://picsum.photos/1080/1920.jpg","https://picsum.photos/1080/1920.jpg"],"aspectRatio":"9:16","durationPerImage":2,"transition":"fade","bgm":"random"}')

END=$(date +%s)
ELAPSED=$((END-START))

HTTP_CODE=$(echo "$RESULT" | tail -1)
BODY=$(echo "$RESULT" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "Time: ${ELAPSED}s"
echo "Response: $BODY"

if echo "$BODY" | grep -q "videoUrl"; then
  VIDEO_URL=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('videoUrl',''))" 2>/dev/null)
  if [ -n "$VIDEO_URL" ]; then
    echo ""
    echo "=== Step 3: Verify Video URL ==="
    echo "URL: $VIDEO_URL"
    curl -sI --max-time 10 "$VIDEO_URL" | head -5
    echo ""
    echo "=== FULL PIPELINE TEST PASSED ==="
  fi
else
  echo ""
  echo "=== TEST FAILED ==="
fi
