#!/bin/bash
# 简化的自动化部署脚本 - 使用expect
# 使用方法: bash deploy/deploy-now.sh

set -e

# 配置
SERVER_IP="123.56.75.68"
SERVER_USER="root"
SERVER_PASSWORD="Xu456123"

echo "=========================================="
echo "  开始自动化部署到阿里云服务器"
echo "=========================================="
echo ""

# 创建expect脚本
cat > /tmp/deploy-expect.exp << 'EXPECT_SCRIPT'
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

# 执行部署命令
send "cd /tmp && curl -fsSL https://raw.githubusercontent.com/xuzone8888/tiktok-ai-mcn/main/deploy/remote-deploy.sh | bash\r"

expect {
    "# " {
        send "exit\r"
    }
    "$ " {
        send "exit\r"
    }
    timeout {
        send "exit\r"
    }
}

expect eof
EXPECT_SCRIPT

chmod +x /tmp/deploy-expect.exp

# 执行expect脚本
expect /tmp/deploy-expect.exp "$SERVER_IP" "$SERVER_USER" "$SERVER_PASSWORD"

# 清理
rm -f /tmp/deploy-expect.exp

echo ""
echo "✅ 部署脚本执行完成"




