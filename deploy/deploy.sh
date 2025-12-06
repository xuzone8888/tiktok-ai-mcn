#!/bin/bash

# 阿里云服务器部署脚本
# 使用方法: ./deploy/deploy.sh

set -e  # 遇到错误立即退出

echo "🚀 开始部署 tiktok-ai-mcn 到阿里云服务器..."
echo ""

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ 错误: 请在项目根目录运行此脚本${NC}"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ 错误: 未安装 Node.js${NC}"
    echo "请先安装 Node.js: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}✅ Node.js 版本: ${NODE_VERSION}${NC}"

# 检查 PM2
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}⚠️  PM2 未安装，正在安装...${NC}"
    sudo npm install -g pm2
fi

PM2_VERSION=$(pm2 --version)
echo -e "${GREEN}✅ PM2 版本: ${PM2_VERSION}${NC}"

# 检查环境变量文件
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}⚠️  未找到 .env.local 文件${NC}"
    echo "请创建 .env.local 文件并配置所有必需的环境变量"
    echo "参考 env.template 文件"
    read -p "是否继续? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 拉取最新代码
echo ""
echo "📥 拉取最新代码..."
git pull origin main || echo "⚠️  Git pull 失败，继续使用当前代码"

# 安装依赖
echo ""
echo "📦 安装依赖..."
npm ci --production=false

# 构建应用
echo ""
echo "🔨 构建应用..."
npm run build

# 检查构建是否成功
if [ ! -d ".next" ]; then
    echo -e "${RED}❌ 构建失败: .next 目录不存在${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 构建成功${NC}"

# 重启 PM2 应用
echo ""
echo "🔄 重启应用..."
if pm2 list | grep -q "tiktok-ai-mcn"; then
    pm2 restart tiktok-ai-mcn
    echo -e "${GREEN}✅ 应用已重启${NC}"
else
    # 创建日志目录
    sudo mkdir -p /var/log/pm2
    sudo chown $USER:$USER /var/log/pm2
    
    # 启动应用
    pm2 start ecosystem.config.js
    pm2 save
    echo -e "${GREEN}✅ 应用已启动${NC}"
fi

# 显示状态
echo ""
echo "📊 应用状态:"
pm2 status

echo ""
echo -e "${GREEN}✨ 部署完成！${NC}"
echo ""
echo "有用的命令:"
echo "  pm2 status          - 查看应用状态"
echo "  pm2 logs            - 查看日志"
echo "  pm2 restart tiktok-ai-mcn - 重启应用"
echo "  pm2 stop tiktok-ai-mcn     - 停止应用"




