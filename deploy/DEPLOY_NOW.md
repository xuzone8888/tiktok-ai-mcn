# 🚀 立即开始部署

## ✅ 服务器信息已获取

- **公网IP**: `123.56.75.68`
- **操作系统**: Ubuntu 24.04 64位
- **实例规格**: 2核4GB
- **带宽**: 5 Mbps
- **状态**: 运行中

---

## 📋 部署步骤

### 第一步：连接服务器

在您的终端运行：

```bash
ssh root@123.56.75.68
```

**提示**: 
- 如果是 Ubuntu 镜像，可能需要使用 `ssh ubuntu@123.56.75.68`
- 首次连接会提示确认，输入 `yes`
- 输入服务器密码

---

### 第二步：运行自动部署脚本

连接成功后，运行：

```bash
# 下载并运行部署脚本
curl -fsSL https://raw.githubusercontent.com/xuzone8888/tiktok-ai-mcn/main/deploy/auto-deploy.sh | bash

# 或者手动克隆代码后运行
cd /var/www
sudo mkdir -p tiktok-ai-mcn
sudo chown -R $USER:$USER tiktok-ai-mcn
cd tiktok-ai-mcn
git clone https://github.com/xuzone8888/tiktok-ai-mcn.git .
bash deploy/auto-deploy.sh
```

---

### 第三步：配置环境变量

脚本会提示您创建 `.env.local` 文件。运行：

```bash
cd /var/www/tiktok-ai-mcn
nano .env.local
```

**从 Vercel 获取环境变量值**:

1. 打开 Vercel 环境变量页面（已在浏览器中打开）
2. 点击每个变量旁边的 "Click to reveal" 查看值
3. 复制到 `.env.local` 文件

**环境变量模板**:

```bash
# Supabase 配置
NEXT_PUBLIC_SUPABASE_URL=从Vercel获取
NEXT_PUBLIC_SUPABASE_ANON_KEY=从Vercel获取
SUPABASE_SERVICE_ROLE_KEY=从Vercel获取

# API 密钥
DOUBAO_API_KEY=从Vercel获取
DOUBAO_ENDPOINT_ID=从Vercel获取
SORA2_API_KEY=从Vercel获取
SUCHUANG_API_KEY=从Vercel获取

# 应用 URL（使用服务器 IP）
NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000

# 管理员邮箱
ADMIN_EMAIL=admin@example.com
```

**保存文件**: `Ctrl+X` → `Y` → `Enter`

---

### 第四步：继续部署

配置完环境变量后，继续运行部署脚本：

```bash
bash deploy/auto-deploy.sh
```

脚本会自动：
- ✅ 初始化服务器环境
- ✅ 安装依赖
- ✅ 构建应用
- ✅ 启动应用

---

### 第五步：配置安全组

在阿里云控制台配置安全组规则：

1. 进入 ECS 控制台
2. 点击实例 `i-2ze6lo7hpqlhqfx52ggw`
3. 点击 **安全组** 标签
4. 点击安全组 ID
5. 添加以下规则：

| 端口 | 协议 | 授权对象 | 说明 |
|------|------|---------|------|
| 22 | TCP | 0.0.0.0/0 | SSH |
| 80 | TCP | 0.0.0.0/0 | HTTP |
| 443 | TCP | 0.0.0.0/0 | HTTPS |
| 3000 | TCP | 0.0.0.0/0 | 应用端口 |

---

### 第六步：测试访问

在浏览器访问：

```
http://123.56.75.68:3000
```

如果能看到网站，说明部署成功！🎉

---

## 🔄 如果遇到问题

### 查看日志
```bash
pm2 logs tiktok-ai-mcn --lines 100
```

### 检查环境变量
```bash
bash deploy/check-env.sh
```

### 重启应用
```bash
pm2 restart tiktok-ai-mcn
```

### 查看应用状态
```bash
pm2 status
```

---

## 📚 详细文档

- **完整部署步骤**: `deploy/DEPLOYMENT_STEPS.md`
- **快速开始**: `deploy/QUICK_START.md`
- **服务器信息**: `deploy/SERVER_INFO.md`

---

**开始部署吧！** 🚀




