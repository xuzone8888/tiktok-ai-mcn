# ⚡ 快速部署 - 3步完成

## 🎯 服务器信息
- **IP**: `123.56.75.68`
- **用户**: `root` 或 `ubuntu`

---

## 📋 部署步骤

### 方法一：一键部署（推荐）

#### 步骤 1: 连接服务器
```bash
ssh root@123.56.75.68
```

#### 步骤 2: 运行一键部署脚本
```bash
curl -fsSL https://raw.githubusercontent.com/xuzone8888/tiktok-ai-mcn/main/deploy/one-click-deploy.sh | bash
```

脚本会自动：
- ✅ 安装 Node.js, PM2, Nginx
- ✅ 克隆代码
- ✅ 创建环境变量模板
- ✅ 安装依赖并构建
- ✅ 启动应用

#### 步骤 3: 配置环境变量
脚本会提示您编辑 `.env.local` 文件：

```bash
nano .env.local
```

**从 Vercel 获取环境变量值并填入**，然后继续运行脚本。

---

### 方法二：手动部署

#### 步骤 1: 连接服务器
```bash
ssh root@123.56.75.68
```

#### 步骤 2: 执行以下命令
```bash
# 创建目录
sudo mkdir -p /var/www/tiktok-ai-mcn
sudo chown -R $USER:$USER /var/www/tiktok-ai-mcn
cd /var/www/tiktok-ai-mcn

# 克隆代码
git clone https://github.com/xuzone8888/tiktok-ai-mcn.git .

# 初始化服务器
bash deploy/setup-server.sh

# 创建环境变量文件
nano .env.local
# 从 Vercel 复制环境变量值并填入

# 检查环境变量
bash deploy/check-env.sh

# 部署应用
bash deploy/deploy.sh
```

---

## 🔑 环境变量配置

在 `.env.local` 文件中填入以下内容（从 Vercel 获取实际值）：

```bash
NEXT_PUBLIC_SUPABASE_URL=从Vercel获取
NEXT_PUBLIC_SUPABASE_ANON_KEY=从Vercel获取
SUPABASE_SERVICE_ROLE_KEY=从Vercel获取
DOUBAO_API_KEY=从Vercel获取
DOUBAO_ENDPOINT_ID=从Vercel获取
SORA2_API_KEY=从Vercel获取
SUCHUANG_API_KEY=从Vercel获取
NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000
ADMIN_EMAIL=admin@example.com
```

---

## 🔒 配置安全组

在阿里云控制台配置安全组规则：

1. 进入 ECS 实例详情
2. 点击"网络与安全组"标签
3. 添加规则：
   - 端口 22 (SSH)
   - 端口 80 (HTTP)
   - 端口 443 (HTTPS)
   - 端口 3000 (应用端口)

---

## ✅ 验证部署

访问: `http://123.56.75.68:3000`

如果能看到网站，说明部署成功！🎉

---

## 📝 常用命令

```bash
# 查看应用状态
pm2 status

# 查看日志
pm2 logs tiktok-ai-mcn

# 重启应用
pm2 restart tiktok-ai-mcn

# 停止应用
pm2 stop tiktok-ai-mcn
```

---

**开始部署吧！** 🚀







