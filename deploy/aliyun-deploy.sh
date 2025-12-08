#!/bin/bash
# 阿里云自动部署脚本
# 用法: ./aliyun-deploy.sh

set -e

# 配置
APP_DIR="/var/www/tiktok-ai-mcn"
LOG_FILE="/var/log/tiktok-ai-mcn-deploy.log"

echo "========================================" | tee -a $LOG_FILE
echo "$(date): 开始部署..." | tee -a $LOG_FILE
echo "========================================" | tee -a $LOG_FILE

cd $APP_DIR

# 1. 拉取最新代码
echo "$(date): 拉取最新代码..." | tee -a $LOG_FILE
git fetch origin main
git reset --hard origin/main

# 2. 安装依赖（如果 package.json 有变化）
echo "$(date): 检查依赖..." | tee -a $LOG_FILE
if git diff HEAD~1 --name-only | grep -q "package.json"; then
    echo "$(date): package.json 已更新，安装依赖..." | tee -a $LOG_FILE
    npm install
fi

# 3. 构建项目
echo "$(date): 构建项目..." | tee -a $LOG_FILE
npm run build

# 4. 重启 PM2
echo "$(date): 重启应用..." | tee -a $LOG_FILE
pm2 restart tiktok-ai-mcn --update-env

echo "========================================" | tee -a $LOG_FILE
echo "$(date): 部署完成！" | tee -a $LOG_FILE
echo "========================================" | tee -a $LOG_FILE

# 显示应用状态
pm2 status


