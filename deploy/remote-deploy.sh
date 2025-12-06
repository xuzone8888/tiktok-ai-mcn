#!/bin/bash
# 在服务器上执行的部署脚本
# 这个脚本会被上传到服务器并执行

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_DIR="/var/www/tiktok-ai-mcn"
GIT_REPO="https://github.com/xuzone8888/tiktok-ai-mcn.git"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  开始部署 Tok Factory${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 1. 更新系统
echo -e "${BLUE}[1/9] 更新系统...${NC}"
apt-get update -qq
apt-get upgrade -y -qq
echo -e "${GREEN}✅ 系统更新完成${NC}"
echo ""

# 2. 安装 Git
echo -e "${BLUE}[2/9] 检查 Git...${NC}"
if ! command -v git &> /dev/null; then
    apt-get install -y git
fi
echo -e "${GREEN}✅ Git 已就绪${NC}"
echo ""

# 3. 安装 Node.js
echo -e "${BLUE}[3/9] 安装 Node.js 20.x...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo -e "${GREEN}✅ Node.js 安装完成${NC}"
echo ""

# 4. 安装 PM2
echo -e "${BLUE}[4/9] 安装 PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi
echo -e "${GREEN}✅ PM2 安装完成${NC}"
echo ""

# 5. 安装 Nginx
echo -e "${BLUE}[5/9] 安装 Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    apt-get install -y nginx
    systemctl enable nginx
    systemctl start nginx
fi
echo -e "${GREEN}✅ Nginx 安装完成${NC}"
echo ""

# 6. 创建目录并克隆代码
echo -e "${BLUE}[6/9] 克隆代码...${NC}"
mkdir -p "$APP_DIR"
cd "$APP_DIR"
if [ -d ".git" ]; then
    echo "代码已存在，更新中..."
    git pull origin main || true
else
    echo "克隆新代码..."
    git clone "$GIT_REPO" .
fi
echo -e "${GREEN}✅ 代码已就绪${NC}"
echo ""

# 7. 创建环境变量文件
echo -e "${BLUE}[7/9] 配置环境变量...${NC}"
cat > "$APP_DIR/.env.local" << 'ENV_EOF'
NEXT_PUBLIC_SUPABASE_URL=https://hfabrifuvujpdzarlbky.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0Njc5OTIsImV4cCI6MjA4MDA0Mzk5Mn0.EonhiMYT1AgVgqNvyHER7NBKkN629tAFatOhnnqJdIo
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDQ2Nzk5MiwiZXhwIjoyMDgwMDQzOTkyfQ.CuMexYcJZA_xTvTUwBz2uA2nBhGOx7j_6BKurQyA2JQ
DOUBAO_API_KEY=1450acdb-9797-4f2c-8767-681df026a6e3
DOUBAO_ENDPOINT_ID=ep-20251202180845-62hxd
SORA2_API_KEY=sk-SZPEdRnAdW3Dgu9DqTE4nNcqkv1fNG3oBULwmEhw6F329JLE
SUCHUANG_API_KEY=2W2tt3CnhHnWuT1nVmdgfrE9eJ
NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000
ADMIN_EMAIL=admin@example.com
ENV_EOF
echo -e "${GREEN}✅ 环境变量已配置${NC}"
echo ""

# 8. 安装依赖并构建
echo -e "${BLUE}[8/9] 安装依赖并构建应用...${NC}"
cd "$APP_DIR"
npm install
npm run build
echo -e "${GREEN}✅ 构建完成${NC}"
echo ""

# 9. 启动 PM2
echo -e "${BLUE}[9/9] 启动应用...${NC}"
mkdir -p /var/log/pm2
chmod 777 /var/log/pm2

# 停止旧进程
pm2 delete tiktok-ai-mcn 2>/dev/null || true

# 启动新进程
cd "$APP_DIR"
if [ -f "ecosystem.config.js" ]; then
    pm2 start ecosystem.config.js
else
    pm2 start npm --name "tiktok-ai-mcn" -- start
fi
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo -e "${GREEN}✅ 应用已启动${NC}"
echo ""

# 显示状态
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✨ 部署完成！${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "应用状态:"
pm2 status
echo ""
echo "访问地址: http://123.56.75.68:3000"
echo ""
echo "查看日志: pm2 logs tiktok-ai-mcn"
echo ""



