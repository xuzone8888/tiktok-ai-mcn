#!/bin/bash
# 直接部署脚本 - 通过SSH直接执行部署命令
# 使用方法: bash deploy/direct-deploy.sh

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
    exit 1
fi

# 读取remote-deploy.sh内容
DEPLOY_SCRIPT_PATH="deploy/remote-deploy.sh"
if [ ! -f "$DEPLOY_SCRIPT_PATH" ]; then
    echo -e "${RED}❌ 找不到部署脚本: $DEPLOY_SCRIPT_PATH${NC}"
    exit 1
fi

# 创建expect脚本
TMP_EXPECT=$(mktemp)
cat > "$TMP_EXPECT" << 'EXPECT_EOF'
#!/usr/bin/expect -f
set timeout 600
set server_ip [lindex $argv 0]
set server_user [lindex $argv 1]
set server_password [lindex $argv 2]
set deploy_script [lindex $argv 3]

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

# 上传并执行部署脚本
send "cat > /tmp/deploy.sh << 'SCRIPT_EOF'\r"
expect {
    "# " {}
    "$ " {}
}

# 读取并发送部署脚本内容
set fp [open $deploy_script r]
set script_content [read $fp]
close $fp

send "$script_content"
send "\rSCRIPT_EOF\r"

expect {
    "# " {}
    "$ " {}
}

# 执行部署脚本
send "bash /tmp/deploy.sh\r"

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

expect "$TMP_EXPECT" "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD" "$DEPLOY_SCRIPT_PATH"

# 清理
rm -f "$TMP_EXPECT"

echo ""
echo -e "${GREEN}✅ 部署脚本执行完成${NC}"








