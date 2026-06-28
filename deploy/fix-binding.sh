#!/usr/bin/expect -f
# 修复应用绑定地址
# 使用方法: expect deploy/fix-binding.sh

set timeout 30
set server_ip "123.56.75.68"
set server_user "root"
set server_password "your-server-password"

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

send "netstat -tlnp | grep 3000\r"
expect "# "

send "pm2 stop tiktok-ai-mcn\r"
expect "# "

send "cat > .env.local << 'ENVEOF'\r"
expect "> "

send "NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co\r"
expect "> "

send "NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key\r"
expect "> "

send "SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\r"
expect "> "

send "DOUBAO_API_KEY=your-doubao-api-key\r"
expect "> "

send "DOUBAO_ENDPOINT_ID=your-doubao-endpoint-id\r"
expect "> "

send "SORA2_API_KEY=your-sora2-api-key\r"
expect "> "

send "SUCHUANG_API_KEY=your-suchuang-api-key\r"
expect "> "

send "NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000\r"
expect "> "

send "ADMIN_EMAIL=admin@example.com\r"
expect "> "

send "HOSTNAME=0.0.0.0\r"
expect "> "

send "PORT=3000\r"
expect "> "

send "ENVEOF\r"
expect "# "

send "pm2 start npm --name tiktok-ai-mcn -- start -- -H 0.0.0.0\r"
expect "# "

send "pm2 save\r"
expect "# "

send "sleep 3\r"
expect "# "

send "netstat -tlnp | grep 3000\r"
expect "# "

send "curl -I http://0.0.0.0:3000\r"
expect "# "

send "exit\r"
expect eof








