#!/bin/bash

# 阿里云服务器初始化脚本
# 在全新的 Ubuntu 服务器上运行此脚本进行初始化配置
# 使用方法: bash deploy/setup-server.sh

set -e

echo "🔧 开始初始化阿里云服务器..."
echo ""

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 更新系统
echo "📦 更新系统包..."
sudo apt-get update
sudo apt-get upgrade -y

# 安装 Node.js
echo ""
echo "📦 安装 Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo -e "${GREEN}✅ Node.js 安装完成${NC}"
else
    echo -e "${YELLOW}⚠️  Node.js 已安装，跳过${NC}"
fi

NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
echo "  Node.js: ${NODE_VERSION}"
echo "  npm: ${NPM_VERSION}"

# 安装 PM2
echo ""
echo "📦 安装 PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo -e "${GREEN}✅ PM2 安装完成${NC}"
else
    echo -e "${YELLOW}⚠️  PM2 已安装，跳过${NC}"
fi

# 安装 Nginx
echo ""
echo "📦 安装 Nginx..."
if ! command -v nginx &> /dev/null; then
    sudo apt-get install -y nginx
    sudo systemctl enable nginx
    sudo systemctl start nginx
    echo -e "${GREEN}✅ Nginx 安装完成${NC}"
else
    echo -e "${YELLOW}⚠️  Nginx 已安装，跳过${NC}"
fi

# 安装 Certbot (用于 SSL 证书)
echo ""
echo "📦 安装 Certbot..."
if ! command -v certbot &> /dev/null; then
    sudo apt-get install -y certbot python3-certbot-nginx
    echo -e "${GREEN}✅ Certbot 安装完成${NC}"
else
    echo -e "${YELLOW}⚠️  Certbot 已安装，跳过${NC}"
fi

# 配置防火墙
echo ""
echo "🔥 配置防火墙..."
if command -v ufw &> /dev/null; then
    sudo ufw allow 22/tcp   # SSH
    sudo ufw allow 80/tcp   # HTTP
    sudo ufw allow 443/tcp  # HTTPS
    echo -e "${GREEN}✅ 防火墙规则已配置${NC}"
    echo -e "${YELLOW}⚠️  请手动运行 'sudo ufw enable' 启用防火墙${NC}"
else
    echo -e "${YELLOW}⚠️  UFW 未安装，跳过防火墙配置${NC}"
fi

# 创建应用目录
echo ""
echo "📁 创建应用目录..."
sudo mkdir -p /var/www/tiktok-ai-mcn
sudo mkdir -p /var/log/pm2
sudo chown -R $USER:$USER /var/www/tiktok-ai-mcn
sudo chown -R $USER:$USER /var/log/pm2
echo -e "${GREEN}✅ 目录创建完成${NC}"

# 配置 PM2 开机自启
echo ""
echo "⚙️  配置 PM2 开机自启..."
pm2 startup systemd -u $USER --hp /home/$USER || echo -e "${YELLOW}⚠️  PM2 startup 配置失败，请手动运行: pm2 startup${NC}"

echo ""
echo -e "${GREEN}✨ 服务器初始化完成！${NC}"
echo ""
echo "下一步:"
echo "1. 将代码克隆到 /var/www/tiktok-ai-mcn"
echo "2. 创建 .env.local 文件并配置环境变量"
echo "3. 运行部署脚本: ./deploy/deploy.sh"
echo "4. 配置 Nginx: 复制 deploy/nginx.conf.template 到 /etc/nginx/sites-available/tiktok-ai-mcn"
echo "5. 配置域名 DNS 解析"




