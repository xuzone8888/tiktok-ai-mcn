#!/bin/bash

# 启动Chrome DevTools用于浏览器自动化

echo "🚀 启动 Chrome DevTools..."
echo ""

# 检查Chrome是否已安装
if [ -d "/Applications/Google Chrome.app" ]; then
    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif [ -d "/Applications/Google Chrome Canary.app" ]; then
    CHROME_PATH="/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
else
    echo "❌ 未找到Chrome浏览器"
    echo "   请安装 Google Chrome 或 Chrome Canary"
    exit 1
fi

# 关闭可能已运行的Chrome实例
echo "🔄 关闭现有Chrome实例..."
killall "Google Chrome" 2>/dev/null || true
killall "Google Chrome Canary" 2>/dev/null || true
sleep 1

# 启动Chrome并启用远程调试
echo "✅ 启动Chrome (远程调试端口: 9222)..."
"$CHROME_PATH" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug-$$ \
  --no-first-run \
  --no-default-browser-check \
  > /dev/null 2>&1 &

CHROME_PID=$!
sleep 2

# 验证是否启动成功
echo "🔍 验证Chrome DevTools..."
if curl -s http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
    echo "✅ Chrome DevTools 已成功启动！"
    echo ""
    echo "现在可以："
    echo "  1. 在Chrome中登录Vercel"
    echo "  2. 告诉我，我会使用浏览器工具检查部署状态"
    echo ""
    echo "要停止Chrome，运行: kill $CHROME_PID"
else
    echo "⚠️  Chrome已启动，但DevTools可能未就绪"
    echo "   请稍等几秒后重试"
fi








