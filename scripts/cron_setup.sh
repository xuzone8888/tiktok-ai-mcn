#!/bin/bash
# ============================================================================
# TikTok AI MCN - 定时发布任务配置脚本
# 
# 用途: 在服务器上配置 Cron Job，每分钟检查并执行到期的预约发布任务
# 
# 使用方法:
#   1. 上传此脚本到服务器: scp scripts/cron_setup.sh root@YOUR_SERVER:/tmp/
#   2. 登录服务器: ssh root@YOUR_SERVER
#   3. 执行脚本: bash /tmp/cron_setup.sh
#
# ============================================================================

set -e

# 配置项
APP_URL="${APP_URL:-http://127.0.0.1:3000}"
CRON_SECRET="${CRON_SECRET:-your-secret-key-here}"
LOG_FILE="/var/log/tiktok-publisher.log"

echo "================================================"
echo "📦 TikTok AI MCN - Cron Job 配置向导"
echo "================================================"
echo ""

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  请使用 root 用户运行此脚本"
    exit 1
fi

# 创建日志文件
touch "$LOG_FILE"
chmod 644 "$LOG_FILE"
echo "✅ 日志文件已创建: $LOG_FILE"

# 生成 Cron 任务内容
CRON_CMD="* * * * * curl -s -H \"x-cron-secret: $CRON_SECRET\" \"$APP_URL/api/publish/process-scheduled\" >> $LOG_FILE 2>&1"

# 检查是否已存在
if crontab -l 2>/dev/null | grep -q "process-scheduled"; then
    echo "⚠️  检测到已存在的定时任务，正在更新..."
    (crontab -l 2>/dev/null | grep -v "process-scheduled"; echo "$CRON_CMD") | crontab -
else
    echo "📝 添加新的定时任务..."
    (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
fi

echo ""
echo "✅ Cron Job 配置完成！"
echo ""
echo "📋 当前 Cron 任务列表:"
crontab -l | grep -v "^#" | head -10
echo ""
echo "📊 监控日志命令: tail -f $LOG_FILE"
echo ""
echo "================================================"
echo "🎉 配置完成！预约发布功能现在可以 24/7 稳定运行。"
echo "================================================"
