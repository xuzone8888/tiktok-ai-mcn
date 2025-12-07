# 🚀 快速开始 - 阿里云部署

## 5 分钟快速部署指南

### 前提条件
- ✅ 已购买阿里云 ECS 实例
- ✅ 已获取服务器 IP 和 SSH 访问权限
- ✅ 已准备域名（可选，可以先使用 IP 访问）

---

## 📝 快速部署步骤

### 1️⃣ 连接服务器
```bash
ssh root@your-server-ip
# 或使用您的用户名
ssh your-username@your-server-ip
```

### 2️⃣ 克隆代码
```bash
cd /var/www
git clone https://github.com/xuzone8888/tiktok-ai-mcn.git
cd tiktok-ai-mcn
```

### 3️⃣ 初始化服务器（首次部署）
```bash
bash deploy/setup-server.sh
```

这个脚本会自动安装：
- Node.js 20.x
- PM2 进程管理器
- Nginx 反向代理
- Certbot (SSL 证书工具)

### 4️⃣ 配置环境变量
```bash
# 创建环境变量文件
nano .env.local
```

**复制以下内容并填入实际值**：
```bash
# Supabase 配置（从 Vercel 环境变量中获取）
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# API 密钥（从 Vercel 环境变量中获取）
DOUBAO_API_KEY=your_doubao_key
DOUBAO_ENDPOINT_ID=your_endpoint_id
SORA2_API_KEY=your_sora2_key
SUCHUANG_API_KEY=your_suchuang_key

# 应用 URL（使用阿里云域名或 IP）
NEXT_PUBLIC_APP_URL=http://your-server-ip:3000
# 或使用域名: NEXT_PUBLIC_APP_URL=https://cn.tokfactoryai.com

# 管理员邮箱
ADMIN_EMAIL=admin@example.com
```

**保存文件**: `Ctrl+X`, 然后 `Y`, 然后 `Enter`

### 5️⃣ 检查环境变量
```bash
bash deploy/check-env.sh
```

确保所有必需的环境变量都已配置。

### 6️⃣ 部署应用
```bash
bash deploy/deploy.sh
```

这个脚本会：
- 拉取最新代码
- 安装依赖
- 构建应用
- 启动/重启 PM2 进程

### 7️⃣ 配置 Nginx（可选，用于域名访问）
```bash
# 复制配置模板
sudo cp deploy/nginx.conf.template /etc/nginx/sites-available/tiktok-ai-mcn

# 编辑配置，替换域名
sudo nano /etc/nginx/sites-available/tiktok-ai-mcn
# 将 your-domain.com 替换为您的实际域名

# 启用配置
sudo ln -s /etc/nginx/sites-available/tiktok-ai-mcn /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 8️⃣ 配置 SSL 证书（推荐）
```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

---

## ✅ 验证部署

### 检查应用状态
```bash
pm2 status
pm2 logs tiktok-ai-mcn
```

### 访问网站
- 直接访问: `http://your-server-ip:3000`
- 通过域名: `http://your-domain.com` (如果配置了 Nginx)

---

## 🔄 更新部署

当代码更新后，只需运行：
```bash
cd /var/www/tiktok-ai-mcn
bash deploy/deploy.sh
```

---

## 🆘 遇到问题？

### 应用无法启动
```bash
# 查看日志
pm2 logs tiktok-ai-mcn --lines 100

# 检查环境变量
bash deploy/check-env.sh
```

### 无法访问网站
```bash
# 检查应用是否运行
pm2 status

# 检查端口
sudo netstat -tlnp | grep 3000

# 检查防火墙
sudo ufw status
```

### 查看详细文档
- 完整部署指南: `ALIYUN_DEPLOYMENT_GUIDE.md`
- 部署检查清单: `deploy/DEPLOYMENT_CHECKLIST.md`

---

## 📞 需要帮助？

检查以下文件获取更多信息：
- `deploy/DEPLOYMENT_CHECKLIST.md` - 详细检查清单
- `ALIYUN_DEPLOYMENT_GUIDE.md` - 完整部署指南








