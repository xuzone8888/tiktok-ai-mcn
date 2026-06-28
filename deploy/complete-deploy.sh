#!/usr/bin/expect -f
# 完成剩余部署步骤
# 使用方法: expect deploy/complete-deploy.sh

set timeout 1800
set server_ip "123.56.75.68"
set server_user "root"
set server_password "your-server-password"

puts "\033\[34m========================================\033\[0m"
puts "\033\[34m  完成剩余部署步骤\033\[0m"
puts "\033\[34m========================================\033\[0m"
puts ""

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

# 步骤 7: 配置环境变量
puts "\n步骤 7/9: 配置环境变量..."
send "cd /var/www/tiktok-ai-mcn\r"
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

send "ENVEOF\r"
expect "# "

puts "\n步骤 8/9: 安装依赖并构建..."
send "npm install\r"
expect "# "

send "npm run build\r"
expect "# "

puts "\n步骤 9/9: 启动应用..."
send "mkdir -p /var/log/pm2 && chmod 777 /var/log/pm2\r"
expect "# "

send "pm2 delete tiktok-ai-mcn 2>/dev/null || true\r"
expect "# "

send "pm2 start ecosystem.config.js || pm2 start npm --name tiktok-ai-mcn -- start\r"
expect "# "

send "pm2 save\r"
expect "# "

send "pm2 startup systemd -u root --hp /root 2>/dev/null || true\r"
expect "# "

puts "\n========================================"
puts "✨ 部署完成！"
puts "========================================"
puts ""

send "pm2 status\r"
expect "# "

puts "\n访问地址: http://123.56.75.68:3000"
puts ""

send "exit\r"
expect eof








