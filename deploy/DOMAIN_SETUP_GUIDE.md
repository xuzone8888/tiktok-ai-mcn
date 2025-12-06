# 🌐 域名配置指南 - 阿里云服务器

## 📋 概述

本指南将帮助您为阿里云服务器配置自定义域名，包括：
1. DNS 配置
2. Nginx 反向代理配置
3. SSL 证书配置（HTTPS）
4. 环境变量更新

---

## 🚀 快速开始

### 前提条件

- ✅ 已购买域名（例如：`tokfactoryai.com`）
- ✅ 域名已解析到阿里云服务器 IP：`123.56.75.68`
- ✅ 服务器已安装 Nginx
- ✅ 服务器已安装 Certbot（用于 SSL 证书）

---

## 📝 步骤 1: 配置 DNS 解析

### 1.1 登录域名管理平台

根据您的域名注册商（阿里云、腾讯云、Cloudflare 等），登录相应的控制台。

### 1.2 添加 A 记录

在 DNS 解析设置中添加以下记录：

| 类型 | 主机记录 | 记录值 | TTL |
|------|---------|--------|-----|
| A | @ | 123.56.75.68 | 600 |
| A | www | 123.56.75.68 | 600 |

**说明**：
- `@` 表示根域名（例如：`tokfactoryai.com`）
- `www` 表示 www 子域名（例如：`www.tokfactoryai.com`）
- `123.56.75.68` 是您的阿里云服务器 IP

### 1.3 等待 DNS 生效

DNS 解析通常需要 **5-30 分钟** 生效。可以使用以下命令检查：

```bash
# 检查 DNS 解析
nslookup your-domain.com
# 或
dig your-domain.com
```

---

## 🔧 步骤 2: 配置 Nginx

### 2.1 创建 Nginx 配置文件

在服务器上执行：

```bash
ssh root@123.56.75.68
cd /var/www/tiktok-ai-mcn
```

复制 Nginx 配置模板：

```bash
sudo cp deploy/nginx.conf.template /etc/nginx/sites-available/tiktok-ai-mcn
```

### 2.2 编辑配置文件

```bash
sudo nano /etc/nginx/sites-available/tiktok-ai-mcn
```

**将 `your-domain.com` 替换为您的实际域名**，例如：

```nginx
server {
    listen 80;
    server_name tokfactoryai.com www.tokfactoryai.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

保存文件：`Ctrl+X` → `Y` → `Enter`

### 2.3 启用配置

```bash
# 创建符号链接
sudo ln -s /etc/nginx/sites-available/tiktok-ai-mcn /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 如果测试通过，重载 Nginx
sudo systemctl reload nginx
```

---

## 🔒 步骤 3: 配置 SSL 证书（HTTPS）

### 3.1 安装 Certbot

如果尚未安装：

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
```

### 3.2 获取 SSL 证书

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

**按照提示操作**：
1. 输入邮箱地址（用于证书到期提醒）
2. 同意服务条款：输入 `A` 同意
3. 是否分享邮箱：输入 `N` 或 `Y`（可选）
4. 等待证书申请完成

### 3.3 验证证书

Certbot 会自动修改 Nginx 配置并启用 HTTPS。验证：

```bash
# 检查证书状态
sudo certbot certificates

# 测试 HTTPS 访问
curl -I https://your-domain.com
```

### 3.4 自动续期

Certbot 会自动配置证书续期。验证自动续期任务：

```bash
sudo systemctl status certbot.timer
```

---

## 🔄 步骤 4: 更新环境变量

### 4.1 更新服务器环境变量

```bash
ssh root@123.56.75.68
cd /var/www/tiktok-ai-mcn
nano .env.local
```

**更新 `NEXT_PUBLIC_APP_URL`**：

```bash
# 从
NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000

# 改为
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

保存文件：`Ctrl+X` → `Y` → `Enter`

### 4.2 重启应用

```bash
pm2 restart tiktok-ai-mcn
```

---

## ✅ 步骤 5: 验证配置

### 5.1 测试 HTTP 访问

```bash
curl -I http://your-domain.com
```

应该返回 `301` 重定向到 HTTPS。

### 5.2 测试 HTTPS 访问

```bash
curl -I https://your-domain.com
```

应该返回 `200 OK`。

### 5.3 浏览器访问

在浏览器中访问：
- `https://your-domain.com`
- `https://www.your-domain.com`

应该能正常打开网站。

---

## 🔧 步骤 6: 配置 Supabase 重定向 URL（重要）

### 6.1 登录 Supabase 控制台

访问：https://supabase.com/dashboard
选择项目：`hfabrifuvujpdzarlbky`

### 6.2 配置重定向 URL

1. 进入 **Authentication** > **URL Configuration**
2. 在 **Site URL** 中添加：
   ```
   https://your-domain.com
   ```
3. 在 **Redirect URLs** 中添加：
   ```
   https://your-domain.com/**
   https://your-domain.com/auth/callback
   https://www.your-domain.com/**
   https://www.your-domain.com/auth/callback
   ```
4. **保存配置**

---

## 📝 完整 Nginx 配置示例（HTTPS）

配置 SSL 后，Nginx 配置应该类似这样：

```nginx
# HTTP 重定向到 HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com www.your-domain.com;
    return 301 https://$host$request_uri;
}

# HTTPS 配置
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL 证书（Certbot 自动配置）
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # SSL 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 代理到 Next.js 应用
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # 静态文件缓存
    location /_next/static {
        proxy_pass http://localhost:3000;
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## 🆘 常见问题

### Q: DNS 解析不生效？

A: 
1. 检查 DNS 记录是否正确
2. 等待 5-30 分钟
3. 清除本地 DNS 缓存：
   ```bash
   # macOS
   sudo dscacheutil -flushcache
   
   # Windows
   ipconfig /flushdns
   ```

### Q: SSL 证书申请失败？

A:
1. 确保 DNS 解析已生效
2. 确保 80 端口已开放（安全组）
3. 确保 Nginx 正在运行
4. 检查域名是否正确

### Q: 访问域名显示 502 Bad Gateway？

A:
1. 检查应用是否运行：`pm2 status`
2. 检查 Nginx 配置：`sudo nginx -t`
3. 查看 Nginx 错误日志：`sudo tail -f /var/log/nginx/error.log`

### Q: HTTPS 访问显示不安全？

A:
1. 检查 SSL 证书是否有效：`sudo certbot certificates`
2. 确保证书未过期
3. 清除浏览器缓存

---

## 📚 相关文档

- Nginx 配置模板：`deploy/nginx.conf.template`
- 环境变量配置：`deploy/ENV_VALUES_FOR_SERVER.md`
- 部署指南：`ALIYUN_DEPLOYMENT_GUIDE.md`

---

## ✅ 配置检查清单

- [ ] DNS 解析已配置
- [ ] DNS 解析已生效（`nslookup` 测试通过）
- [ ] Nginx 配置文件已创建并编辑
- [ ] Nginx 配置测试通过（`nginx -t`）
- [ ] Nginx 已重载（`systemctl reload nginx`）
- [ ] SSL 证书已申请（`certbot`）
- [ ] 环境变量已更新（`NEXT_PUBLIC_APP_URL`）
- [ ] 应用已重启（`pm2 restart`）
- [ ] Supabase 重定向 URL 已配置
- [ ] HTTP 访问测试通过（返回 301）
- [ ] HTTPS 访问测试通过（返回 200）
- [ ] 浏览器访问正常

---

## 🎉 完成！

配置完成后，您的网站应该可以通过以下地址访问：
- `https://your-domain.com`
- `https://www.your-domain.com`

所有 HTTP 请求会自动重定向到 HTTPS。



