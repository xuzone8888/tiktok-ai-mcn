# 阿里云服务器部署指南

## ✅ 可以同时部署

**是的，您可以同时将网站部署到阿里云服务器，而不会影响 Vercel 的正常运营。**

### 为什么可以同时部署？

1. **共享数据库**: 两个部署都连接到同一个 Supabase 数据库
2. **共享存储**: 都使用 Supabase Storage 存储文件
3. **独立运行**: 两个部署是完全独立的实例，互不干扰
4. **环境变量隔离**: 每个部署有自己的环境变量配置

---

## 📋 部署架构

```
┌─────────────────┐         ┌─────────────────┐
│   Vercel 部署    │         │   阿里云部署     │
│                 │         │                 │
│ www.tokfactory  │         │  aliyun-domain  │
│     ai.com      │         │      .com       │
└────────┬────────┘         └────────┬────────┘
         │                           │
         └───────────┬───────────────┘
                     │
         ┌───────────▼───────────┐
         │   Supabase 数据库      │
         │   (共享数据源)         │
         └───────────────────────┘
```

---

## ⚠️ 需要注意的事项

### 1. 域名解析（DNS）

**重要**: 两个部署需要使用不同的域名，或者使用 DNS 负载均衡/故障转移。

**方案A: 使用不同域名**
- Vercel: `www.tokfactoryai.com`
- 阿里云: `cn.tokfactoryai.com` 或 `aliyun.tokfactoryai.com`

**方案B: 使用 DNS 智能解析**
- 国内用户 → 阿里云服务器
- 海外用户 → Vercel

**方案C: 主备模式**
- 主域名指向 Vercel
- 备用域名指向阿里云

### 2. 环境变量配置

阿里云部署需要配置相同的环境变量：

```bash
# Supabase 配置（与 Vercel 相同）
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# API 密钥（与 Vercel 相同）
DOUBAO_API_KEY=your_doubao_key
DOUBAO_ENDPOINT_ID=your_endpoint_id
SORA2_API_KEY=your_sora2_key
SUCHUANG_API_KEY=your_suchuang_key

# 应用 URL（需要改为阿里云域名）
NEXT_PUBLIC_APP_URL=https://your-aliyun-domain.com

# 管理员邮箱
ADMIN_EMAIL=admin@example.com
```

### 3. 数据一致性

✅ **优势**: 
- 两个部署共享同一个 Supabase 数据库
- 用户数据、任务记录、文件存储都是同步的
- 用户在任一平台的操作都会反映到另一个平台

⚠️ **注意事项**:
- 确保两个部署使用相同的数据库连接
- 文件上传会存储到同一个 Supabase Storage
- 任务状态会实时同步

### 4. 会话管理

- Supabase Auth 的会话可以在两个平台间共享（如果使用相同的域名或配置了跨域）
- 建议为不同域名配置独立的会话管理，避免冲突

### 5. 文件存储

- 所有文件都存储在 Supabase Storage
- 两个部署访问相同的文件
- 无需担心文件同步问题

---

## 🚀 阿里云部署步骤

### 步骤 1: 准备服务器

1. **购买阿里云 ECS 实例**
   - 推荐配置: 2核4GB 或更高
   - 操作系统: Ubuntu 22.04 LTS 或 CentOS 7+
   - 带宽: 至少 5Mbps

2. **安装 Node.js**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs

   # 验证安装
   node --version  # 应该显示 v20.x.x
   npm --version
   ```

3. **安装 PM2 (进程管理器)**
   ```bash
   sudo npm install -g pm2
   ```

4. **安装 Nginx (反向代理)**
   ```bash
   sudo apt-get update
   sudo apt-get install nginx
   ```

### 步骤 2: 部署应用

1. **克隆代码**
   ```bash
   cd /var/www
   git clone https://github.com/xuzone8888/tiktok-ai-mcn.git
   cd tiktok-ai-mcn
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **配置环境变量**
   ```bash
   # 创建 .env.local 文件
   nano .env.local
   
   # 添加所有必需的环境变量（参考上面的列表）
   ```

4. **构建应用**
   ```bash
   npm run build
   ```

5. **使用 PM2 启动应用**
   ```bash
   # 创建 PM2 配置文件
   cat > ecosystem.config.js << EOF
   module.exports = {
     apps: [{
       name: 'tiktok-ai-mcn',
       script: 'npm',
       args: 'start',
       cwd: '/var/www/tiktok-ai-mcn',
       instances: 2,
       exec_mode: 'cluster',
       env: {
         NODE_ENV: 'production',
         PORT: 3000
       }
     }]
   };
   EOF
   
   # 启动应用
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

### 步骤 3: 配置 Nginx

```bash
sudo nano /etc/nginx/sites-available/tiktok-ai-mcn
```

添加以下配置：

```nginx
server {
    listen 80;
    server_name your-aliyun-domain.com;

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
    }
}
```

启用配置：
```bash
sudo ln -s /etc/nginx/sites-available/tiktok-ai-mcn /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 步骤 4: 配置 SSL 证书

使用 Let's Encrypt 免费证书：

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-aliyun-domain.com
```

### 步骤 5: 配置域名 DNS

在域名管理后台添加 A 记录：
- 类型: A
- 主机记录: @ 或 www
- 记录值: 阿里云服务器公网 IP
- TTL: 600

---

## 🔄 持续部署方案

### 方案 1: 手动部署

```bash
# 在服务器上执行
cd /var/www/tiktok-ai-mcn
git pull origin main
npm install
npm run build
pm2 restart tiktok-ai-mcn
```

### 方案 2: 使用 GitHub Actions 自动部署

创建 `.github/workflows/deploy-aliyun.yml`:

```yaml
name: Deploy to Aliyun

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to Aliyun
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.ALIYUN_HOST }}
          username: ${{ secrets.ALIYUN_USER }}
          key: ${{ secrets.ALIYUN_SSH_KEY }}
          script: |
            cd /var/www/tiktok-ai-mcn
            git pull origin main
            npm install
            npm run build
            pm2 restart tiktok-ai-mcn
```

---

## 📊 监控和维护

### 1. 监控应用状态

```bash
# 查看 PM2 状态
pm2 status

# 查看日志
pm2 logs tiktok-ai-mcn

# 查看资源使用
pm2 monit
```

### 2. 设置自动重启

PM2 已配置自动重启，服务器重启后应用会自动启动。

### 3. 日志管理

```bash
# 查看 Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# 查看应用日志
pm2 logs tiktok-ai-mcn --lines 100
```

---

## ⚡ 性能优化建议

1. **启用 Nginx 缓存**
   ```nginx
   proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=my_cache:10m max_size=10g inactive=60m;
   
   location / {
       proxy_cache my_cache;
       proxy_cache_valid 200 60m;
       # ... 其他配置
   }
   ```

2. **启用 Gzip 压缩**
   ```nginx
   gzip on;
   gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
   ```

3. **使用 CDN**
   - 静态资源使用阿里云 CDN 加速
   - 图片使用 Supabase Storage CDN

---

## 🔒 安全建议

1. **防火墙配置**
   ```bash
   # 只开放必要端口
   sudo ufw allow 22/tcp   # SSH
   sudo ufw allow 80/tcp   # HTTP
   sudo ufw allow 443/tcp  # HTTPS
   sudo ufw enable
   ```

2. **定期更新**
   ```bash
   sudo apt-get update && sudo apt-get upgrade -y
   ```

3. **备份策略**
   - 定期备份环境变量配置
   - 数据库由 Supabase 自动备份

---

## 📝 总结

✅ **可以同时部署到阿里云和 Vercel**

**优势**:
- 国内访问速度更快（阿里云）
- 海外访问速度更快（Vercel）
- 数据完全同步
- 互为备份，提高可用性

**注意事项**:
- 使用不同的域名或 DNS 智能解析
- 配置相同的环境变量（除了 NEXT_PUBLIC_APP_URL）
- 确保两个部署都连接到同一个 Supabase 实例

**推荐方案**:
- 主域名: Vercel（全球加速）
- 国内域名: 阿里云（国内访问优化）
- 或使用 DNS 智能解析自动路由

---

**需要帮助？** 如果在部署过程中遇到问题，请随时询问！



