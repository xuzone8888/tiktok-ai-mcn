#!/bin/bash
# ============================================================================
# TikTok AI MCN - 生产定时任务配置脚本
# 
# 用途:
#   1. 每分钟检查并执行到期的预约发布任务
#   2. 每小时执行 YouTube 授权验证、数据保留和撤销重试
# 
# 使用方法:
#   1. 上传此脚本到服务器: scp scripts/cron_setup.sh root@YOUR_SERVER:/tmp/
#   2. 登录服务器: ssh root@YOUR_SERVER
#   3. 执行脚本: bash /tmp/cron_setup.sh
#
# ============================================================================

set -e

# 配置项
APP_DIR="${APP_DIR:-/var/www/tiktok-ai-mcn}"
PUBLISH_LOG_FILE="/var/log/publish-scheduler.log"
YOUTUBE_RETENTION_LOG_FILE="/var/log/youtube-data-retention.log"

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
touch "$PUBLISH_LOG_FILE" "$YOUTUBE_RETENTION_LOG_FILE"
chmod 644 "$PUBLISH_LOG_FILE" "$YOUTUBE_RETENTION_LOG_FILE"
echo "✅ 日志文件已创建"

# 生成 Cron 任务内容
PUBLISH_CRON_CMD="* * * * * $APP_DIR/run-scheduler.sh"
YOUTUBE_RETENTION_CRON_CMD="17 * * * * $APP_DIR/run-youtube-data-retention.sh"

CURRENT_CRONTAB="$(crontab -l 2>/dev/null || true)"
FILTERED_CRONTAB="$(
  printf '%s\n' "$CURRENT_CRONTAB" \
    | grep -v "process-scheduled" \
    | grep -v "$APP_DIR/run-scheduler.sh" \
    | grep -v "$APP_DIR/run-youtube-data-retention.sh" \
    || true
)"

{
  printf '%s\n' "$FILTERED_CRONTAB"
  echo "$PUBLISH_CRON_CMD"
  echo "$YOUTUBE_RETENTION_CRON_CMD"
} | awk 'NF && !seen[$0]++' | crontab -

echo ""
echo "✅ Cron Job 配置完成！"
echo ""
echo "📋 当前 Cron 任务摘要（参数已隐藏）:"
crontab -l \
  | awk 'NF && $1 !~ /^#/ { print $1, $2, $3, $4, $5, $6 }' \
  | head -10
echo ""
echo "📊 发布日志: tail -f $PUBLISH_LOG_FILE"
echo "📊 YouTube 数据治理日志: tail -f $YOUTUBE_RETENTION_LOG_FILE"
echo ""
echo "================================================"
echo "🎉 配置完成！预约发布和 YouTube 数据治理任务已启用。"
echo "================================================"
