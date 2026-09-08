#!/bin/bash

# 环境变量检查脚本
# 检查所有必需的环境变量是否已配置

set -e

echo "🔍 检查环境变量配置..."
echo ""

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 必需的环境变量列表
REQUIRED_VARS=(
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "SUPABASE_SERVICE_ROLE_KEY"
    "DOUBAO_API_KEY"
    "DOUBAO_ENDPOINT_ID"
    "SORA2_API_KEY"
    "SUCHUANG_API_KEY"
    "NEXT_PUBLIC_APP_URL"
    "TIKTOK_CLIENT_KEY"
    "TIKTOK_CLIENT_SECRET"
    "TIKTOK_REDIRECT_URI"
)

# 可选的环境变量
OPTIONAL_VARS=(
    "ADMIN_EMAIL"
    "SUCHUANG_API_ENDPOINT"
    "DOUBAO_API_ENDPOINT"
)

# 检查 .env.local 文件
ENV_FILE=".env.local"
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}❌ 错误: 未找到 $ENV_FILE 文件${NC}"
    echo "请创建 $ENV_FILE 文件并配置环境变量"
    echo "参考 env.template 文件"
    exit 1
fi

echo -e "${GREEN}✅ 找到 $ENV_FILE 文件${NC}"
echo ""

# Never source an env file here. Deployment validation treats it as data so
# shell commands, expansions, and `set -x` inside the file cannot execute.
env_has_value() {
    node -e 'const { loadEffectiveEnv } = require("./scripts/tiktok-production-readiness.cjs"); const name = process.argv[2]; const value = loadEffectiveEnv(process.argv[1], "app", process.env)[name]; process.exit(String(value || "").trim() ? 0 : 1)' "$ENV_FILE" "$1"
}

# 检查必需变量
MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if ! env_has_value "$var"; then
        MISSING_VARS+=("$var")
        echo -e "${RED}❌ 缺失: $var${NC}"
    else
        echo -e "${GREEN}✅ $var 已配置${NC}"
    fi
done

echo ""

# 检查可选变量
echo "可选环境变量:"
for var in "${OPTIONAL_VARS[@]}"; do
    if ! env_has_value "$var"; then
        echo -e "${YELLOW}⚠️  未设置: $var (可选)${NC}"
    else
        echo -e "${GREEN}✅ $var 已配置${NC}"
    fi
done

echo ""

# 总结
if [ ${#MISSING_VARS[@]} -eq 0 ]; then
    echo -e "${GREEN}✨ 所有必需的环境变量已配置！${NC}"
    echo ""
    echo "检查 TikTok 生产开关与 Broker 依赖..."
    node scripts/tiktok-production-readiness.cjs --role=app --env="$ENV_FILE"
    exit 0
else
    echo -e "${RED}❌ 缺少以下必需的环境变量:${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    echo ""
    echo "请在 $ENV_FILE 文件中添加这些变量"
    exit 1
fi



