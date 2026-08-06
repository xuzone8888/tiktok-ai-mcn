#!/bin/bash

# 一键部署脚本 - 在服务器上直接运行
# 使用方法: 复制此脚本到服务器，然后运行: bash one-click-deploy.sh

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Tok Factory - 一键部署脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 配置
APP_DIR="/var/www/tiktok-ai-mcn"
GIT_REPO="https://github.com/xuzone8888/tiktok-ai-mcn.git"
SERVER_IP="123.56.75.68"

# 步骤 1: 更新系统
echo -e "${BLUE}[1/8] 更新系统包...${NC}"
sudo apt-get update -qq
sudo apt-get upgrade -y -qq
echo -e "${GREEN}✅ 系统更新完成${NC}"
echo ""

# 步骤 2: 安装 Node.js
echo -e "${BLUE}[2/8] 安装 Node.js 20.x...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo -e "${GREEN}✅ Node.js 安装完成${NC}"
else
    NODE_VERSION=$(node --version)
    echo -e "${YELLOW}⚠️  Node.js 已安装: ${NODE_VERSION}${NC}"
fi
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo ""

# 步骤 3: 安装 PM2
echo -e "${BLUE}[3/8] 安装 PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo -e "${GREEN}✅ PM2 安装完成${NC}"
else
    echo -e "${YELLOW}⚠️  PM2 已安装${NC}"
fi
echo "  PM2: $(pm2 --version)"
echo ""

# 步骤 4: 安装 Nginx
echo -e "${BLUE}[4/8] 安装 Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    sudo apt-get install -y nginx
    sudo systemctl enable nginx
    sudo systemctl start nginx
    echo -e "${GREEN}✅ Nginx 安装完成${NC}"
else
    echo -e "${YELLOW}⚠️  Nginx 已安装${NC}"
fi
echo ""

# 步骤 5: 安装 Certbot
echo -e "${BLUE}[5/8] 安装 Certbot...${NC}"
if ! command -v certbot &> /dev/null; then
    sudo apt-get install -y certbot python3-certbot-nginx
    echo -e "${GREEN}✅ Certbot 安装完成${NC}"
else
    echo -e "${YELLOW}⚠️  Certbot 已安装${NC}"
fi
echo ""

# 步骤 6: 创建目录并克隆代码
echo -e "${BLUE}[6/8] 克隆代码...${NC}"
sudo mkdir -p ${APP_DIR}
sudo chown -R $USER:$USER ${APP_DIR}
cd ${APP_DIR}

if [ -d ".git" ]; then
    echo -e "${YELLOW}⚠️  代码已存在，拉取最新更新...${NC}"
    git pull origin main || echo -e "${YELLOW}⚠️  Git pull 失败，继续使用当前代码${NC}"
else
    git clone ${GIT_REPO} .
fi
echo -e "${GREEN}✅ 代码克隆完成${NC}"
echo ""

# 步骤 7: 配置环境变量
echo -e "${BLUE}[7/8] 配置环境变量...${NC}"
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}⚠️  未找到 .env.local 文件${NC}"
    echo -e "${YELLOW}正在创建环境变量模板...${NC}"
    
    cat > .env.local << 'EOF'
# ==========================================
# 阿里云服务器环境变量配置
# ==========================================
# 请从密码管理器或对应服务控制台获取实际值并替换

# Supabase 配置
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# API 密钥
DOUBAO_API_KEY=your_doubao_key
DOUBAO_ENDPOINT_ID=your_endpoint_id
SORA2_API_KEY=your_sora2_key
SUCHUANG_API_KEY=your_suchuang_key

# 应用 URL
NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000

# 管理员邮箱
ADMIN_EMAIL=admin@example.com
EOF
    
    echo -e "${GREEN}✅ 环境变量模板已创建${NC}"
    echo ""
    echo -e "${YELLOW}⚠️  请编辑 .env.local 文件并填入实际值:${NC}"
    echo "  nano .env.local"
    echo ""
    echo -e "${YELLOW}从安全来源获取所有值并替换模板中的占位符${NC}"
    echo ""
    read -p "是否已配置环境变量? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}❌ 请先配置环境变量${NC}"
        echo "运行: nano .env.local"
        exit 1
    fi
else
    echo -e "${GREEN}✅ 环境变量文件已存在${NC}"
fi

# 检查环境变量
if [ -f "deploy/check-env.sh" ]; then
    bash deploy/check-env.sh
fi
echo ""

# 步骤 8: 安装依赖并构建
echo -e "${BLUE}[8/8] 安装依赖并构建应用...${NC}"
npm ci --production=false
npm run build

if [ ! -d ".next" ]; then
    echo -e "${RED}❌ 构建失败: .next 目录不存在${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 构建完成${NC}"
echo ""

# 步骤 9: 启动应用
echo -e "${BLUE}[9/9] 启动应用...${NC}"
sudo mkdir -p /var/log/pm2
sudo chown -R $USER:$USER /var/log/pm2

if pm2 list | grep -q "tiktok-ai-mcn"; then
    pm2 restart tiktok-ai-mcn
    echo -e "${GREEN}✅ 应用已重启${NC}"
else
    pm2 start ecosystem.config.js
    pm2 save
    pm2 startup systemd -u $USER --hp /home/$USER || true
    echo -e "${GREEN}✅ 应用已启动${NC}"
fi

# 显示状态
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✨ 部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "📊 应用状态:"
pm2 status
echo ""
echo "🌐 访问地址:"
echo "  http://${SERVER_IP}:3000"
echo ""
echo "📝 常用命令:"
echo "  pm2 status                    - 查看应用状态"
echo "  pm2 logs tiktok-ai-mcn       - 查看日志"
echo "  pm2 restart tiktok-ai-mcn    - 重启应用"
echo ""
echo "⚠️  下一步:"
echo "  1. 在阿里云控制台配置安全组（开放 22, 80, 443, 3000 端口）"
echo "  2. 访问 http://${SERVER_IP}:3000 测试应用"
echo "  3. 配置 Nginx 反向代理（可选）"
echo "  4. 配置 SSL 证书（推荐）"








