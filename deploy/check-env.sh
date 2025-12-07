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

# 加载环境变量
set -a
source "$ENV_FILE"
set +a

# 检查必需变量
MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
        echo -e "${RED}❌ 缺失: $var${NC}"
    else
        # 显示变量名但不显示值（安全）
        value_length=${#!var}
        masked_value=$(printf '*%.0s' $(seq 1 $value_length))
        echo -e "${GREEN}✅ $var = $masked_value${NC}"
    fi
done

echo ""

# 检查可选变量
echo "可选环境变量:"
for var in "${OPTIONAL_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${YELLOW}⚠️  未设置: $var (可选)${NC}"
    else
        value_length=${#!var}
        masked_value=$(printf '*%.0s' $(seq 1 $value_length))
        echo -e "${GREEN}✅ $var = $masked_value${NC}"
    fi
done

echo ""

# 总结
if [ ${#MISSING_VARS[@]} -eq 0 ]; then
    echo -e "${GREEN}✨ 所有必需的环境变量已配置！${NC}"
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







