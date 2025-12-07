#!/usr/bin/expect -f
# 完整的自动化部署脚本
# 使用方法: bash deploy/auto-deploy-full.sh

set timeout 600
set server_ip "123.56.75.68"
set server_user "root"
set server_password "Xu456123"

# 颜色输出（在expect中需要特殊处理）
puts "\033\[34m========================================\033\[0m"
puts "\033\[34m  自动化部署到阿里云服务器\033\[0m"
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
    "# " {
        # 连接成功，开始执行部署命令
    }
    "$ " {
        # 连接成功，开始执行部署命令
    }
}

# 执行部署命令
send "bash -c 'set -e && \
APP_DIR=\"/var/www/tiktok-ai-mcn\" && \
GIT_REPO=\"https://github.com/xuzone8888/tiktok-ai-mcn.git\" && \
echo \"[1/9] 更新系统...\" && \
apt-get update -qq && apt-get upgrade -y -qq && \
echo \"[2/9] 安装 Git...\" && \
command -v git >/dev/null || apt-get install -y git && \
echo \"[3/9] 安装 Node.js...\" && \
if ! command -v node >/dev/null; then curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs; fi && \
echo \"[4/9] 安装 PM2...\" && \
command -v pm2 >/dev/null || npm install -g pm2 && \
echo \"[5/9] 安装 Nginx...\" && \
command -v nginx >/dev/null || (apt-get install -y nginx && systemctl enable nginx && systemctl start nginx) && \
echo \"[6/9] 克隆代码...\" && \
mkdir -p \$APP_DIR && cd \$APP_DIR && \
if [ -d \".git\" ]; then git pull origin main || true; else git clone \$GIT_REPO .; fi && \
echo \"[7/9] 配置环境变量...\" && \
cat > .env.local << \\\"ENVEOF\\\" && \
NEXT_PUBLIC_SUPABASE_URL=https://hfabrifuvujpdzarlbky.supabase.co && \
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0Njc5OTIsImV4cCI6MjA4MDA0Mzk5Mn0.EonhiMYT1AgVgqNvyHER7NBKkN629tAFatOhnnqJdIo && \
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDQ2Nzk5MiwiZXhwIjoyMDgwMDQzOTkyfQ.CuMexYcJZA_xTvTUwBz2uA2nBhGOx7j_6BKurQyA2JQ && \
DOUBAO_API_KEY=1450acdb-9797-4f2c-8767-681df026a6e3 && \
DOUBAO_ENDPOINT_ID=ep-20251202180845-62hxd && \
SORA2_API_KEY=sk-SZPEdRnAdW3Dgu9DqTE4nNcqkv1fNG3oBULwmEhw6F329JLE && \
SUCHUANG_API_KEY=2W2tt3CnhHnWuT1nVmdgfrE9eJ && \
NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000 && \
ADMIN_EMAIL=admin@example.com && \
ENVEOF && \
echo \"[8/9] 安装依赖并构建...\" && \
npm install && npm run build && \
echo \"[9/9] 启动应用...\" && \
mkdir -p /var/log/pm2 && chmod 777 /var/log/pm2 && \
pm2 delete tiktok-ai-mcn 2>/dev/null || true && \
pm2 start ecosystem.config.js || pm2 start npm --name tiktok-ai-mcn -- start && \
pm2 save && \
pm2 startup systemd -u root --hp /root 2>/dev/null || true && \
echo \"\" && \
echo \"========================================\" && \
echo \"✨ 部署完成！\" && \
echo \"========================================\" && \
echo \"\" && \
pm2 status && \
echo \"\" && \
echo \"访问地址: http://123.56.75.68:3000\" && \
echo \"\" && \
exit 0' \r"

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








