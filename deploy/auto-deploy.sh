#!/bin/bash

# 阿里云服务器自动部署脚本
# 使用方法: 在服务器上运行此脚本

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Tok Factory - 阿里云自动部署脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 服务器信息
SERVER_IP="123.56.75.68"
APP_DIR="/var/www/tiktok-ai-mcn"
GIT_REPO="https://github.com/xuzone8888/tiktok-ai-mcn.git"

echo -e "${GREEN}📋 服务器信息:${NC}"
echo "  公网IP: ${SERVER_IP}"
echo "  应用目录: ${APP_DIR}"
echo ""

# 检查是否以 root 或 sudo 运行
if [ "$EUID" -ne 0 ] && ! sudo -n true 2>/dev/null; then
    echo -e "${YELLOW}⚠️  需要 root 权限，请使用 sudo 运行${NC}"
    exit 1
fi

# 步骤 1: 创建目录
echo -e "${BLUE}[1/7] 创建应用目录...${NC}"
sudo mkdir -p ${APP_DIR}
sudo chown -R $USER:$USER ${APP_DIR}
echo -e "${GREEN}✅ 目录创建完成${NC}"
echo ""

# 步骤 2: 克隆代码
echo -e "${BLUE}[2/7] 克隆代码...${NC}"
cd ${APP_DIR}
if [ -d ".git" ]; then
    echo -e "${YELLOW}⚠️  代码已存在，拉取最新更新...${NC}"
    git pull origin main || echo -e "${YELLOW}⚠️  Git pull 失败，继续使用当前代码${NC}"
else
    git clone ${GIT_REPO} .
fi
echo -e "${GREEN}✅ 代码克隆完成${NC}"
echo ""

# 步骤 3: 初始化服务器环境
echo -e "${BLUE}[3/7] 初始化服务器环境...${NC}"
if [ -f "deploy/setup-server.sh" ]; then
    bash deploy/setup-server.sh
else
    echo -e "${RED}❌ 未找到 setup-server.sh 脚本${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 服务器环境初始化完成${NC}"
echo ""

# 步骤 4: 检查环境变量
echo -e "${BLUE}[4/7] 检查环境变量...${NC}"
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}⚠️  未找到 .env.local 文件${NC}"
    echo -e "${YELLOW}请创建 .env.local 文件并配置所有必需的环境变量${NC}"
    echo ""
    echo "运行以下命令创建环境变量文件:"
    echo "  nano .env.local"
    echo ""
    echo "然后复制以下内容并填入实际值:"
    echo ""
    cat deploy/env.local.template
    echo ""
    read -p "是否已创建 .env.local 文件? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}❌ 请先创建 .env.local 文件${NC}"
        exit 1
    fi
fi

# 检查环境变量
if [ -f "deploy/check-env.sh" ]; then
    bash deploy/check-env.sh
fi
echo -e "${GREEN}✅ 环境变量检查完成${NC}"
echo ""

# 步骤 5: 安装依赖
echo -e "${BLUE}[5/7] 安装依赖...${NC}"
npm ci --production=false
echo -e "${GREEN}✅ 依赖安装完成${NC}"
echo ""

# 步骤 6: 构建应用
echo -e "${BLUE}[6/7] 构建应用...${NC}"
npm run build
if [ ! -d ".next" ]; then
    echo -e "${RED}❌ 构建失败: .next 目录不存在${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 构建完成${NC}"
echo ""

# 步骤 7: 启动应用
echo -e "${BLUE}[7/7] 启动应用...${NC}"
if pm2 list | grep -q "tiktok-ai-mcn"; then
    pm2 restart tiktok-ai-mcn
    echo -e "${GREEN}✅ 应用已重启${NC}"
else
    # 创建日志目录
    sudo mkdir -p /var/log/pm2
    sudo chown -R $USER:$USER /var/log/pm2
    
    # 启动应用
    pm2 start ecosystem.config.js
    pm2 save
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
echo "  pm2 stop tiktok-ai-mcn       - 停止应用"
echo ""
echo "⚠️  下一步:"
echo "  1. 在阿里云控制台配置安全组（开放 22, 80, 443, 3000 端口）"
echo "  2. 访问 http://${SERVER_IP}:3000 测试应用"
echo "  3. 配置 Nginx 反向代理（可选）"
echo "  4. 配置 SSL 证书（推荐）"







