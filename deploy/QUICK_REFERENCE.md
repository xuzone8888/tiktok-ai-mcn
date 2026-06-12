# 📚 快速参考指南

## 🌐 配置新域名

### 快速步骤

1. **DNS 配置**（域名管理平台）
   - 添加 A 记录：`@` → `123.56.75.68`
   - 添加 A 记录：`www` → `123.56.75.68`
   - 等待 5-30 分钟生效

2. **Nginx 配置**（服务器上）
   ```bash
   ssh root@123.56.75.68
   cd /var/www/tiktok-ai-mcn
   sudo cp deploy/nginx.conf.template /etc/nginx/sites-available/tiktok-ai-mcn
   sudo nano /etc/nginx/sites-available/tiktok-ai-mcn
   # 替换 your-domain.com 为实际域名
   sudo ln -s /etc/nginx/sites-available/tiktok-ai-mcn /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. **SSL 证书**（服务器上）
   ```bash
   sudo certbot --nginx -d your-domain.com -d www.your-domain.com
   ```

4. **更新环境变量**（服务器上）
   ```bash
   nano .env.local
   # 修改 NEXT_PUBLIC_APP_URL=https://your-domain.com
   pm2 restart tiktok-ai-mcn
   ```

5. **配置 Supabase**（Supabase 控制台）
   - Authentication > URL Configuration
   - 添加 Site URL 和 Redirect URLs

**详细文档**: `deploy/DOMAIN_SETUP_GUIDE.md`

---

## ⚡ 快速同步代码到服务器

### 方法 1: 使用快速同步脚本（推荐）

```bash
# 1. 提交代码
git add .
git commit -m "更新描述"
git push origin main

# 2. 运行同步脚本
bash deploy/quick-sync.sh
```

### 方法 2: 手动部署（服务器上）

```bash
ssh root@123.56.75.68
cd /var/www/tiktok-ai-mcn
git fetch origin main
git reset --hard origin/main
npm ci && npm run build
pm2 restart tiktok-ai-mcn
```

**详细文档**: `deploy/QUICK_SYNC_GUIDE.md`

---

## 🔍 常用命令

### 查看应用状态
```bash
ssh root@123.56.75.68 "pm2 status"
```

### 查看日志
```bash
ssh root@123.56.75.68 "pm2 logs tiktok-ai-mcn --lines 50"
```

### 重启应用
```bash
ssh root@123.56.75.68 "pm2 restart tiktok-ai-mcn"
```

### 检查 Nginx 配置
```bash
ssh root@123.56.75.68 "sudo nginx -t"
```

### 重载 Nginx
```bash
ssh root@123.56.75.68 "sudo systemctl reload nginx"
```

---

## 📝 服务器信息

- **IP 地址**: `123.56.75.68`
- **用户名**: `root`
- **应用目录**: `/var/www/tiktok-ai-mcn`
- **应用端口**: `3000`
- **PM2 应用名**: `tiktok-ai-mcn`

---

## 🔗 相关文档

- 域名配置指南: `deploy/DOMAIN_SETUP_GUIDE.md`
- 快速同步指南: `deploy/QUICK_SYNC_GUIDE.md`
- 完整部署指南: `ALIYUN_DEPLOYMENT_GUIDE.md`
- 环境变量配置: `deploy/ENV_VALUES_FOR_SERVER.md`






