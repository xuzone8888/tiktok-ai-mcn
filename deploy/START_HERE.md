# 🚀 开始部署 - 第一步

## ✅ 您已完成
- [x] 购买阿里云服务器 (c9ae 实例，2核4GB)
- [x] 服务器已创建

## 📋 现在需要做的

### 第一步：获取服务器信息

1. **登录阿里云控制台**
   - 访问: https://ecs.console.aliyun.com/
   - 找到您刚购买的服务器

2. **记录以下信息**:
   - ✅ 公网 IP 地址: `_________________`
   - ✅ 登录用户名: `root` 或 `ubuntu`
   - ✅ 登录密码: `_________________`（或密钥文件路径）

---

### 第二步：连接服务器

打开终端（Mac）或 PowerShell（Windows），运行：

```bash
# 替换 your-server-ip 为您的实际 IP
ssh root@your-server-ip

# 或如果是 Ubuntu 镜像
ssh ubuntu@your-server-ip
```

**首次连接提示**: 输入 `yes` 确认

---

### 第三步：在服务器上执行以下命令

```bash
# 1. 创建目录并克隆代码
sudo mkdir -p /var/www/tiktok-ai-mcn
sudo chown -R $USER:$USER /var/www/tiktok-ai-mcn
cd /var/www/tiktok-ai-mcn
git clone https://github.com/xuzone8888/tiktok-ai-mcn.git .

# 2. 初始化服务器环境
bash deploy/setup-server.sh

# 3. 创建环境变量文件
nano .env.local
```

---

### 第四步：配置环境变量

在 nano 编辑器中，粘贴以下内容并填入实际值：

```bash
# Supabase 配置（从 Vercel 获取）
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# API 密钥（从 Vercel 获取）
DOUBAO_API_KEY=your_doubao_key
DOUBAO_ENDPOINT_ID=your_endpoint_id
SORA2_API_KEY=your_sora2_key
SUCHUANG_API_KEY=your_suchuang_key

# 应用 URL（使用服务器 IP）
NEXT_PUBLIC_APP_URL=http://your-server-ip:3000

# 管理员邮箱
ADMIN_EMAIL=admin@example.com
```

**保存**: `Ctrl+X` → `Y` → `Enter`

---

### 第五步：部署应用

```bash
# 检查环境变量
bash deploy/check-env.sh

# 部署应用
bash deploy/deploy.sh
```

---

### 第六步：配置安全组

在阿里云控制台：
1. 进入 ECS 实例
2. 点击 **安全组** 标签
3. 添加规则：
   - 端口 22 (SSH)
   - 端口 80 (HTTP)
   - 端口 443 (HTTPS)
   - 端口 3000 (应用端口)

---

### 第七步：测试访问

在浏览器访问：
```
http://your-server-ip:3000
```

如果能看到网站，说明部署成功！🎉

---

## 📚 详细文档

- **完整部署步骤**: `deploy/DEPLOYMENT_STEPS.md`
- **快速开始**: `deploy/QUICK_START.md`
- **环境变量说明**: `env.template`

---

## 🆘 遇到问题？

查看 `deploy/DEPLOYMENT_STEPS.md` 中的"常见问题"部分。

**开始部署吧！** 🚀








