#!/usr/bin/expect -f
# 完整的自动化部署脚本
# 使用方法: bash deploy/auto-deploy-full.sh

set timeout 600
set server_ip "123.56.75.68"
set server_user "root"
set server_password "your-server-password"

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
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co && \
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key && \
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key && \
DOUBAO_API_KEY=your-doubao-api-key && \
DOUBAO_ENDPOINT_ID=your-doubao-endpoint-id && \
SORA2_API_KEY=your-sora2-api-key && \
SUCHUANG_API_KEY=your-suchuang-api-key && \
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








