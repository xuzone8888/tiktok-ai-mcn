#!/bin/bash
# 最终部署脚本 - 使用expect自动化SSH登录和部署
# 使用方法: bash deploy/final-deploy.sh

set -e

# 配置
SERVER_IP="123.56.75.68"
SERVER_USER="root"
SERVER_PASSWORD="Xu456123"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  自动化部署到阿里云服务器${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查expect
if ! command -v expect &> /dev/null; then
    echo -e "${RED}❌ expect 未安装${NC}"
    echo "请安装: brew install expect (macOS) 或 sudo apt-get install expect (Linux)"
    exit 1
fi

# 创建expect脚本文件
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 600
set server_ip [lindex $argv 0]
set server_user [lindex $argv 1]
set server_password [lindex $argv 2]

spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${server_user}@${server_ip}

expect {
    "password:" {
        send "${server_password}\r"
        exp_continue
    }
    "yes/no" {
        send "yes\r"
        exp_continue
    }
    "# " {}
    "$ " {}
}

# 执行部署命令 - 使用单行命令避免转义问题
send "cd /tmp && curl -fsSL https://raw.githubusercontent.com/xuzone8888/tiktok-ai-mcn/main/deploy/remote-deploy.sh -o deploy.sh && bash deploy.sh\r"

expect {
    "# " {
        send "exit\r"
    }
    "$ " {
        send "exit\r"
    }
    timeout {
        puts "\n⚠️  部署可能仍在进行中，请稍后检查服务器状态"
        send "exit\r"
    }
}

expect eof
EXPECT_EOF

chmod +x "$TMP_EXPECT"

# 执行expect脚本
echo -e "${BLUE}正在连接服务器并执行部署...${NC}"
echo ""

expect "$TMP_EXPECT" "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD"

# 清理
rm -f "$TMP_EXPECT"

echo ""
echo -e "${GREEN}✅ 部署脚本执行完成${NC}"
echo ""
echo -e "${YELLOW}提示: 如果部署过程中出现错误，请手动SSH到服务器检查：${NC}"
echo "  ssh ${SERVER_USER}@${SERVER_IP}"
echo ""
echo -e "${YELLOW}查看应用状态：${NC}"
echo "  pm2 status"
echo "  pm2 logs tiktok-ai-mcn"






