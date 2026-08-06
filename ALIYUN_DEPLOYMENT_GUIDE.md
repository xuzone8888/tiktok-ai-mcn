# 阿里云服务器部署指南

> **⚠️ 生产架构已变更（2026-08-06 更新）**
>
> **本项目已完全迁移到阿里云，不再使用 Vercel。** 仓库中的 Vercel 集成（`vercel.json`、相关脚本与环境变量说明）已移除。
>
> 若你在其它文档或旧对话里看到「主域名指向 Vercel」「海外用户走 Vercel」之类的说法，**那些都已过时，不要照做**。生产环境的唯一事实以本文件为准。

## 📋 当前生产架构

```
                    toryxai.com
                         │
                         ▼
        ┌────────────────────────────────┐
        │   阿里云 ECS  123.56.75.68      │
        │   nginx  →  127.0.0.1:3010     │
        │   pm2 进程（蓝绿部署）           │
        └───────────┬────────────────────┘
                    │
        ┌───────────┼───────────────┐
        ▼                           ▼
┌───────────────┐           ┌───────────────┐
│  Supabase     │           │  阿里云 OSS    │
│  （数据库）    │           │  （媒体存储）   │
└───────────────┘           └───────────────┘
```

**要点**：

1. **单一部署**：只有阿里云一个生产实例，没有第二个对外站点
2. **蓝绿发布**：新版本先在另一个端口起进程，验证通过后切 nginx 转发，旧进程保留作回滚目标
3. **release 目录**：每次发布在 `/var/www/tiktok-ai-mcn-releases/<完整commit>/` 下建独立目录
4. **手工发布**：**推 main 不会自动上线**，发布全程手工。注意这是靠一个环境变量开关（`LEGACY_WEBHOOK_DEPLOY_ENABLED=false`）实现的——webhook 本身仍在活跃接收 GitHub 推送，**开关一旦打开就会恢复自动部署**。详见下方「关于自动部署」

---

## ⚠️ 需要注意的事项

### 1. 域名解析（DNS）

`toryxai.com` 直接解析到阿里云 ECS，由 nginx 反向代理到本机端口。

**不需要**做 DNS 智能解析或多地域分流——只有一个部署实例。

切换线上版本的方式是**改 nginx 的 `proxy_pass` 端口**，不是改 DNS。

### 2. 环境变量配置

生产环境变量位于服务器上的 `.env*` 文件，**不在仓库里**：

```bash
# Supabase 配置
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# API 密钥
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

## 🔄 发布流程

> **⚠️ 本节原有的两个「方案」已废弃，务必不要照做。**
>
> 旧文档写的是「在服务器上 `git pull` + `npm run build` + `pm2 restart`」以及一份「用 GitHub Actions 推 main 自动部署」的模板。这两种做法在当前架构下**都是错的**：
>
> 1. 它们操作的是 `/var/www/tiktok-ai-mcn`（端口 3000 的**遗留实例**），**那不是线上服务**。线上是 `/var/www/tiktok-ai-mcn-releases/<commit>/` 下的蓝绿 release。
> 2. 直接 `pm2 restart` 是**原地覆盖**，一旦新版有问题**没有回滚余地**。
> 3. 在服务器上 `npm run build` 会**卡内存**（可用内存约 2.1G，不够构建）。
> 4. 自动部署会**绕过人工审核**——本项目刻意关掉了这条路（见下）。

### 当前发布方式：手工蓝绿

用画布线自带的 `deploy/canvas-blue-green.sh`：

1. **建新 release 目录**：`/var/www/tiktok-ai-mcn-releases/<完整commit>/`，不覆盖任何现有目录
2. **在新端口起进程**：旧进程继续服务，线上不受影响
3. **验证新端口**：健康检查通过后才动 nginx
4. **切 nginx 的 `proxy_pass`** 到新端口，`nginx -s reload`
5. **旧进程和旧 release 目录保留**，作为回滚目标

回滚 = 把 nginx 切回旧端口。**所以旧 release 目录在确认稳定前不要删。**

### ⚠️ 关于自动部署（重要）

**当前状态：GitHub push 到 main 不会自动上线。** 但这不是"功能不存在"，而是"功能被一个开关关着"：

- GitHub 仓库上的 webhook **仍然是活跃的**，指向 `http://<服务器IP>:3001`，每次 push 都会送达
- 服务器上的 webhook 服务收到 main push 后，会检查环境变量 `LEGACY_WEBHOOK_DEPLOY_ENABLED`
- 该变量当前为 **`false`**，于是返回 503 并拒绝部署（`runDeploy` 内部还有第二道同样的检查）

**谁把这个变量改成 `true` 并重启 webhook 进程，推 main 就会立刻自动部署生产。**

这条路是被刻意关掉的（代码注释称其为 "legacy escape hatch"），原因就是上面列的四点。**除非经过明确评审，不要打开它，也不要新建 GitHub Actions 做同样的事**（仓库当前没有任何 workflow，这是有意为之）。

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

✅ **生产环境 = 阿里云单实例，Vercel 已完全退出**

**当前形态**:
- `toryxai.com` → 阿里云 ECS → nginx → 本机端口
- 数据在 Supabase，媒体在阿里云 OSS
- 蓝绿发布：新版起在另一端口，验证通过再切 nginx，旧进程留作回滚

**发布纪律**:
- **发布是手工的**。推 main 不会自动上线——但这靠的是 `LEGACY_WEBHOOK_DEPLOY_ENABLED=false` 这个开关，webhook 本身仍活跃，**开关打开即恢复自动部署，不要随手开**
- 切换版本靠改 nginx 的 `proxy_pass` 端口，不靠改 DNS
- **旧 release 目录不要急着删**——它是回滚的唯一依据，确认新版稳定后再清
- 数据库迁移需在 Supabase 控制台手工执行，**合并 PR ≠ 功能生效**

**不要做的事**:
- 不要按旧文档去配 Vercel，或做「国内走阿里云、海外走 Vercel」的 DNS 分流——已无 Vercel 实例
- 不要把 `.env*` 或证书提交进仓库（本仓库为 PUBLIC）

---

**需要帮助？** 如果在部署过程中遇到问题，请随时询问！








