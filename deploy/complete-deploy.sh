#!/usr/bin/expect -f
# 完成剩余部署步骤
# 使用方法: expect deploy/complete-deploy.sh

set timeout 1800
set server_ip "123.56.75.68"
set server_user "root"
set server_password "Xu456123"

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

send "NEXT_PUBLIC_SUPABASE_URL=https://hfabrifuvujpdzarlbky.supabase.co\r"
expect "> "

send "NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0Njc5OTIsImV4cCI6MjA4MDA0Mzk5Mn0.EonhiMYT1AgVgqNvyHER7NBKkN629tAFatOhnnqJdIo\r"
expect "> "

send "SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDQ2Nzk5MiwiZXhwIjoyMDgwMDQzOTkyfQ.CuMexYcJZA_xTvTUwBz2uA2nBhGOx7j_6BKurQyA2JQ\r"
expect "> "

send "DOUBAO_API_KEY=1450acdb-9797-4f2c-8767-681df026a6e3\r"
expect "> "

send "DOUBAO_ENDPOINT_ID=ep-20251202180845-62hxd\r"
expect "> "

send "SORA2_API_KEY=sk-SZPEdRnAdW3Dgu9DqTE4nNcqkv1fNG3oBULwmEhw6F329JLE\r"
expect "> "

send "SUCHUANG_API_KEY=2W2tt3CnhHnWuT1nVmdgfrE9eJ\r"
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



