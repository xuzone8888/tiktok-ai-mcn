#!/usr/bin/expect -f
# 检查登录错误
# 使用方法: expect deploy/check-login-error.sh

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

send "cd /var/www/tiktok-ai-mcn\r"
expect "# "

send "pm2 logs tiktok-ai-mcn --lines 50 --nostream\r"
expect "# "

send "cat .env.local | grep -E '(SUPABASE|APP_URL)'\r"
expect "# "

send "exit\r"
expect eof






