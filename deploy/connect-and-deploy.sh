#!/bin/bash

# 本地脚本 - 连接到服务器并执行部署
# 使用方法: bash deploy/connect-and-deploy.sh

SERVER_IP="123.56.75.68"
SCRIPT_URL="https://raw.githubusercontent.com/xuzone8888/tiktok-ai-mcn/main/deploy/one-click-deploy.sh"

echo "🚀 开始部署到阿里云服务器..."
echo ""
echo "服务器IP: ${SERVER_IP}"
echo ""
echo "请选择连接方式:"
echo "1. 使用密码连接"
echo "2. 使用SSH密钥连接"
echo "3. 手动连接（推荐）"
echo ""
read -p "请选择 (1/2/3): " choice

case $choice in
    1)
        echo ""
        echo "正在连接服务器..."
        ssh root@${SERVER_IP} "bash -s" < deploy/one-click-deploy.sh
        ;;
    2)
        echo ""
        read -p "请输入SSH密钥路径: " key_path
        echo "正在连接服务器..."
        ssh -i "$key_path" root@${SERVER_IP} "bash -s" < deploy/one-click-deploy.sh
        ;;
    3)
        echo ""
        echo "请手动执行以下步骤:"
        echo ""
        echo "1. 连接服务器:"
        echo "   ssh root@${SERVER_IP}"
        echo ""
        echo "2. 在服务器上运行以下命令:"
        echo "   curl -fsSL ${SCRIPT_URL} | bash"
        echo ""
        echo "或者:"
        echo "   git clone https://github.com/xuzone8888/tiktok-ai-mcn.git /tmp/tiktok-ai-mcn"
        echo "   bash /tmp/tiktok-ai-mcn/deploy/one-click-deploy.sh"
        ;;
    *)
        echo "无效选择"
        exit 1
        ;;
esac







