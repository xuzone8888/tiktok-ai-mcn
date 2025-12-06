#!/bin/bash

# Vercel部署检查脚本
# 使用方法: ./scripts/check-vercel-deployment.sh [项目URL]

echo "🔍 Vercel 部署检查工具"
echo "======================"
echo ""

# 检查是否提供了URL
if [ -z "$1" ]; then
    echo "❌ 请提供Vercel项目URL"
    echo ""
    echo "使用方法:"
    echo "  ./scripts/check-vercel-deployment.sh https://your-project.vercel.app"
    echo ""
    echo "或者运行Node.js检查脚本:"
    echo "  node scripts/check-server-consistency.js https://your-project.vercel.app"
    exit 1
fi

PROJECT_URL="$1"

echo "📡 检查项目: $PROJECT_URL"
echo ""

# 检查服务器是否可访问
echo "1️⃣ 检查服务器可访问性..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$PROJECT_URL")

if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ 服务器可访问 (HTTP $HTTP_CODE)"
else
    echo "   ⚠️  服务器返回 HTTP $HTTP_CODE"
fi

echo ""

# 检查关键页面
echo "2️⃣ 检查关键页面..."
PAGES=("/" "/dashboard" "/quick-gen" "/models" "/auth/login")

for page in "${PAGES[@]}"; do
    FULL_URL="${PROJECT_URL}${page}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$FULL_URL")
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "308" ]; then
        echo "   ✅ $page (HTTP $HTTP_CODE)"
    else
        echo "   ❌ $page (HTTP $HTTP_CODE)"
    fi
done

echo ""

# 检查API路由
echo "3️⃣ 检查API路由..."
APIS=("/api/models/public" "/api/tasks")

for api in "${APIS[@]}"; do
    FULL_URL="${PROJECT_URL}${api}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$FULL_URL")
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
        echo "   ✅ $api (HTTP $HTTP_CODE)"
    else
        echo "   ❌ $api (HTTP $HTTP_CODE)"
    fi
done

echo ""
echo "✨ 检查完成！"
echo ""
echo "💡 提示:"
echo "   - 如果页面返回404，可能是路由配置问题"
echo "   - 如果API返回401/403，这是正常的（需要认证）"
echo "   - 建议访问Vercel Dashboard查看详细部署日志"



