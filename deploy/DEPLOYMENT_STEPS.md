# 🚀 阿里云服务器部署步骤

## 📋 部署前准备

### 需要的信息
- [ ] 服务器公网 IP 地址
- [ ] SSH 登录用户名（通常是 `root` 或 `ubuntu`）
- [ ] SSH 密码或密钥
- [ ] 所有环境变量值（从 Vercel 获取）

---

## 步骤 1: 连接服务器

### 获取服务器信息
1. 登录阿里云控制台
2. 进入 ECS 实例列表
3. 找到您购买的服务器
4. 记录 **公网 IP 地址**

### 连接服务器
```bash
# 使用 root 用户连接（如果使用密码）
ssh root@your-server-ip

# 或使用 ubuntu 用户（如果镜像是 Ubuntu）
ssh ubuntu@your-server-ip

# 如果使用密钥文件
ssh -i /path/to/your-key.pem root@your-server-ip
```

**提示**: 首次连接会提示确认，输入 `yes` 继续。

---

## 步骤 2: 初始化服务器环境

### 创建应用目录
```bash
# 创建目录
sudo mkdir -p /var/www/tiktok-ai-mcn
sudo chown -R $USER:$USER /var/www/tiktok-ai-mcn
cd /var/www/tiktok-ai-mcn
```

### 克隆代码
```bash
# 克隆项目
git clone https://github.com/xuzone8888/tiktok-ai-mcn.git .

# 或如果目录已存在
cd /var/www
git clone https://github.com/xuzone8888/tiktok-ai-mcn.git
cd tiktok-ai-mcn
```

### 运行初始化脚本
```bash
# 运行服务器初始化脚本
bash deploy/setup-server.sh
```

这个脚本会自动安装：
- ✅ Node.js 20.x
- ✅ PM2 进程管理器
- ✅ Nginx 反向代理
- ✅ Certbot (SSL 证书工具)
- ✅ 配置防火墙规则
- ✅ 创建日志目录

**预计时间**: 5-10 分钟

---

## 步骤 3: 配置环境变量

### 创建环境变量文件
```bash
# 创建 .env.local 文件
nano .env.local
```

### 复制以下模板并填入实际值

```bash
# ==========================================
# Supabase 配置（从 Vercel 环境变量获取）
# ==========================================
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# ==========================================
# API 密钥（从 Vercel 环境变量获取）
# ==========================================
DOUBAO_API_KEY=your_doubao_key
DOUBAO_ENDPOINT_ID=your_endpoint_id
SORA2_API_KEY=your_sora2_key
SUCHUANG_API_KEY=your_suchuang_key

# ==========================================
# 应用配置
# ==========================================
# 使用服务器 IP 或域名
NEXT_PUBLIC_APP_URL=http://your-server-ip:3000
# 或使用域名: NEXT_PUBLIC_APP_URL=https://toryxai.com

# ==========================================
# 管理员配置
# ==========================================
ADMIN_EMAIL=admin@example.com
```

### 如何获取环境变量值

**从 Vercel 获取**:
1. 登录 Vercel
2. 进入项目设置: `Settings` > `Environment Variables`
3. 点击每个变量旁边的 "Click to reveal" 查看值
4. 复制到 `.env.local` 文件

**重要**: 
- `NEXT_PUBLIC_APP_URL` 应该使用阿里云服务器的 IP 或域名
- 其他变量值与 Vercel 完全相同

### 保存文件
在 nano 编辑器中：
1. 按 `Ctrl+X` 退出
2. 按 `Y` 确认保存
3. 按 `Enter` 确认文件名

### 验证环境变量
```bash
# 运行检查脚本
bash deploy/check-env.sh
```

确保所有必需的环境变量都已配置。

---

## 步骤 4: 部署应用

### 运行部署脚本
```bash
# 确保在项目根目录
cd /var/www/tiktok-ai-mcn

# 运行部署脚本
bash deploy/deploy.sh
```

这个脚本会：
1. ✅ 检查 Node.js 和 PM2
2. ✅ 拉取最新代码
3. ✅ 安装依赖包
4. ✅ 构建 Next.js 应用
5. ✅ 启动 PM2 进程

**预计时间**: 3-5 分钟

### 检查应用状态
```bash
# 查看 PM2 状态
pm2 status

# 查看日志
pm2 logs tiktok-ai-mcn --lines 50
```

应该看到应用正在运行。

---

## 步骤 5: 配置安全组（重要）

### 在阿里云控制台配置
1. 进入 ECS 控制台
2. 点击您的实例
3. 进入 **安全组** 标签
4. 点击安全组 ID
5. 点击 **入方向规则** > **添加安全组规则**

添加以下规则：

| 规则方向 | 授权策略 | 协议类型 | 端口范围 | 授权对象 |
|---------|---------|---------|---------|---------|
| 入方向 | 允许 | TCP | 22/22 | 0.0.0.0/0 (SSH) |
| 入方向 | 允许 | TCP | 80/80 | 0.0.0.0/0 (HTTP) |
| 入方向 | 允许 | TCP | 443/443 | 0.0.0.0/0 (HTTPS) |
| 入方向 | 允许 | TCP | 3000/3000 | 0.0.0.0/0 (应用端口，可选) |

---

## 步骤 6: 测试访问

### 直接访问应用
```bash
# 在浏览器中访问
http://your-server-ip:3000
```

如果能看到网站，说明部署成功！

---

## 步骤 7: 配置 Nginx（可选，推荐）

### 配置 Nginx 反向代理
```bash
# 复制配置模板
sudo cp deploy/nginx.conf.template /etc/nginx/sites-available/tiktok-ai-mcn

# 编辑配置文件
sudo nano /etc/nginx/sites-available/tiktok-ai-mcn
```

### 修改配置
将 `your-domain.com` 替换为：
- 您的域名（如果有）
- 或服务器 IP（临时测试）

### 启用配置
```bash
# 创建符号链接
sudo ln -s /etc/nginx/sites-available/tiktok-ai-mcn /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

### 访问测试
```bash
# 通过 Nginx 访问（如果配置了域名）
http://your-domain.com

# 或通过 IP 访问
http://your-server-ip
```

---

## 步骤 8: 配置 SSL 证书（推荐，生产环境必需）

### 使用 Let's Encrypt 免费证书
```bash
# 申请 SSL 证书（需要域名）
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# 按照提示操作：
# 1. 输入邮箱地址
# 2. 同意服务条款
# 3. 选择是否分享邮箱（可选）
```

证书会自动配置并设置自动续期。

### 访问 HTTPS
```bash
# 现在可以通过 HTTPS 访问
https://your-domain.com
```

---

## ✅ 部署验证

### 检查清单
- [ ] 应用可以通过 IP:3000 访问
- [ ] PM2 显示应用正在运行
- [ ] 日志中没有错误
- [ ] 可以正常登录（如果配置了）
- [ ] API 接口可以正常调用

### 常用命令
```bash
# 查看应用状态
pm2 status

# 查看实时日志
pm2 logs tiktok-ai-mcn

# 重启应用
pm2 restart tiktok-ai-mcn

# 停止应用
pm2 stop tiktok-ai-mcn

# 查看系统资源
pm2 monit
```

---

## 🔄 后续更新

当代码更新后，只需运行：
```bash
cd /var/www/tiktok-ai-mcn
bash deploy/deploy.sh
```

---

## 🐛 常见问题

### 问题 1: 无法连接服务器
```bash
# 检查安全组是否开放 22 端口
# 检查服务器是否运行
# 检查 IP 地址是否正确
```

### 问题 2: 应用无法启动
```bash
# 查看详细日志
pm2 logs tiktok-ai-mcn --lines 100

# 检查环境变量
bash deploy/check-env.sh

# 检查端口占用
sudo netstat -tlnp | grep 3000
```

### 问题 3: 无法访问网站
```bash
# 检查安全组规则
# 检查防火墙
sudo ufw status

# 检查应用是否运行
pm2 status

# 检查 Nginx 配置
sudo nginx -t
```

### 问题 4: 构建失败
```bash
# 检查 Node.js 版本
node --version  # 应该是 v20.x.x

# 清理并重新安装
rm -rf node_modules .next
npm install
npm run build
```

---

## 📞 需要帮助？

如果遇到问题，请提供：
1. 错误日志: `pm2 logs tiktok-ai-mcn`
2. 系统信息: `uname -a`
3. Node.js 版本: `node --version`
4. 具体错误信息

---

**祝部署顺利！** 🎉








