#!/bin/bash
# ==========================================
# 同步完整环境变量到服务器
# ==========================================
# 使用方法: bash deploy/sync-env-to-server.sh

set -e

SERVER_IP="123.56.75.68"
SERVER_USER="root"
REMOTE_PATH="/var/www/tiktok-ai-mcn"
LOCAL_ENV="deploy/env.local.server.complete"

echo "=========================================="
echo "同步环境变量到阿里云服务器"
echo "=========================================="

# 检查本地文件
if [ ! -f "$LOCAL_ENV" ]; then
    echo "❌ 错误: 找不到 $LOCAL_ENV"
    exit 1
fi

echo "📤 正在上传环境变量配置..."
scp "$LOCAL_ENV" "${SERVER_USER}@${SERVER_IP}:${REMOTE_PATH}/.env.local"

echo "🔄 正在重启应用..."
ssh "${SERVER_USER}@${SERVER_IP}" "cd ${REMOTE_PATH} && pm2 restart all"

echo ""
echo "=========================================="
echo "✅ 环境变量同步完成!"
echo "=========================================="
echo ""
echo "已更新的配置包括:"
echo "  - TikTok API 配置"
echo "  - 阿里云 OSS 配置 (视频上传)"
echo "  - VEO3 API 配置"
echo "  - Gemini Image API 配置"
echo ""
echo "请重新测试视频上传功能！"
