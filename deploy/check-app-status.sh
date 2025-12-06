#!/usr/bin/expect -f
# 检查应用详细状态
# 使用方法: expect deploy/check-app-status.sh

set timeout 30
set server_ip "123.56.75.68"
set server_user "root"
set server_password "Xu456123"

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

send "pm2 status\r"
expect "# "

send "pm2 logs tiktok-ai-mcn --lines 30 --nostream\r"
expect "# "

send "curl -I http://localhost:3000\r"
expect "# "

send "ps aux | grep node\r"
expect "# "

send "exit\r"
expect eof




