#!/bin/bash
# 🚀 快速同步脚本 - 从 GitHub 拉取最新代码并部署到阿里云服务器
# 使用方法: bash deploy/quick-sync.sh

set -e

# 配置
SERVER_IP="123.56.75.68"
SERVER_USER="root"
SERVER_PASSWORD="Xu456123"
APP_DIR="/var/www/tiktok-ai-mcn"

echo "🚀 开始同步代码到阿里云服务器..."
echo "==========================================="

# 检查 expect 是否安装
if ! command -v expect &> /dev/null; then
    echo "❌ 需要安装 expect 工具"
    echo "   macOS: brew install expect"
    echo "   Linux: apt install expect"
    exit 1
fi

# 执行远程同步
expect << EOF
set timeout 300
spawn ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP
expect "password:"
send "$SERVER_PASSWORD\r"
expect "# "

# 进入项目目录
send "cd $APP_DIR\r"
expect "# "

# 显示当前分支
send "echo '📍 当前分支:' && git branch --show-current\r"
expect "# "

# 拉取最新代码
send "echo '📥 拉取最新代码...' && git pull origin main\r"
expect "# "

# 安装依赖
send "echo '📦 安装依赖...' && npm install\r"
expect "# "

# 构建项目
send "echo '🔨 构建项目...' && npm run build\r"
expect "# "

# 重启应用
send "echo '🔄 重启应用...' && pm2 restart tiktok-ai-mcn\r"
expect "# "

# 检查状态
send "echo '✅ 同步完成！当前状态:' && pm2 status\r"
expect "# "

send "exit\r"
expect eof
EOF

echo ""
echo "==========================================="
echo "✅ 同步完成！"
echo "🌐 访问: https://tokfactoryai.com"
echo "==========================================="
