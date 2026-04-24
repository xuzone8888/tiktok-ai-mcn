#!/bin/bash
echo "=== 测试 VEO 路由 (localhost) ==="
curl -s http://localhost:3000/api/video-batch/generate-veo-video \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"aiVideoPrompt":"A cat walking on grass with sunlight","aspectRatio":"9:16","modelType":"veo3-fast","taskId":"debug-test-001"}' \
  -w "\nHTTP: %{http_code} | Time: %{time_total}s\n" 2>&1

echo ""
echo "=== 查看最近 PM2 日志 ==="
pm2 logs tiktok-ai-mcn --lines 10 --nostream 2>&1 | grep -i "VEO\|gaorui\|error" | tail -10
