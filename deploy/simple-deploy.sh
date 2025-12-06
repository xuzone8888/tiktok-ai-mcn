#!/usr/bin/expect -f
# 简单部署脚本 - 直接在SSH中执行所有命令
# 使用方法: expect deploy/simple-deploy.sh

set timeout 1800
set server_ip "123.56.75.68"
set server_user "root"
set server_password "Xu456123"

puts "\033\[34m========================================\033\[0m"
puts "\033\[34m  开始自动化部署\033\[0m"
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

# 执行部署命令
puts "\n步骤 1/9: 更新系统..."
send "apt-get update -qq && apt-get upgrade -y -qq\r"
expect "# "

puts "\n步骤 2/9: 安装 Git..."
send "command -v git >/dev/null || apt-get install -y git\r"
expect "# "

puts "\n步骤 3/9: 安装 Node.js..."
send "if ! command -v node >/dev/null; then curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs; fi\r"
expect "# "

puts "\n步骤 4/9: 安装 PM2..."
send "command -v pm2 >/dev/null || npm install -g pm2\r"
expect "# "

puts "\n步骤 5/9: 安装 Nginx..."
send "command -v nginx >/dev/null || (apt-get install -y nginx && systemctl enable nginx && systemctl start nginx)\r"
expect "# "

puts "\n步骤 6/9: 克隆代码..."
send "mkdir -p /var/www/tiktok-ai-mcn && cd /var/www/tiktok-ai-mcn && if test -d .git; then git pull origin main || true; else git clone https://github.com/xuzone8888/tiktok-ai-mcn.git .; fi\r"
expect "# "

puts "\n步骤 7/9: 配置环境变量..."
send "cat > /var/www/tiktok-ai-mcn/.env.local << 'ENVEOF'\r"
expect "# "
send "NEXT_PUBLIC_SUPABASE_URL=https://hfabrifuvujpdzarlbky.supabase.co\r"
expect "# "
send "NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0Njc5OTIsImV4cCI6MjA4MDA0Mzk5Mn0.EonhiMYT1AgVgqNvyHER7NBKkN629tAFatOhnnqJdIo\r"
expect "# "
send "SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDQ2Nzk5MiwiZXhwIjoyMDgwMDQzOTkyfQ.CuMexYcJZA_xTvTUwBz2uA2nBhGOx7j_6BKurQyA2JQ\r"
expect "# "
send "DOUBAO_API_KEY=1450acdb-9797-4f2c-8767-681df026a6e3\r"
expect "# "
send "DOUBAO_ENDPOINT_ID=ep-20251202180845-62hxd\r"
expect "# "
send "SORA2_API_KEY=sk-SZPEdRnAdW3Dgu9DqTE4nNcqkv1fNG3oBULwmEhw6F329JLE\r"
expect "# "
send "SUCHUANG_API_KEY=2W2tt3CnhHnWuT1nVmdgfrE9eJ\r"
expect "# "
send "NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000\r"
expect "# "
send "ADMIN_EMAIL=admin@example.com\r"
expect "# "
send "ENVEOF\r"
expect "# "

puts "\n步骤 8/9: 安装依赖并构建..."
send "cd /var/www/tiktok-ai-mcn && npm install && npm run build\r"
expect "# "

puts "\n步骤 9/9: 启动应用..."
send "mkdir -p /var/log/pm2 && chmod 777 /var/log/pm2 && cd /var/www/tiktok-ai-mcn && pm2 delete tiktok-ai-mcn 2>/dev/null || true && (pm2 start ecosystem.config.js || pm2 start npm --name tiktok-ai-mcn -- start) && pm2 save && pm2 startup systemd -u root --hp /root 2>/dev/null || true\r"
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

