# 🚀 快速同步指南

本指南介绍如何快速将本地代码更新同步到阿里云服务器。

---

## 📋 前提条件

1. 本地安装了 `expect` 工具
   - macOS: `brew install expect`
   - Linux: `apt install expect`

2. 代码已推送到 GitHub
   ```bash
   git add .
   git commit -m "your commit message"
   git push origin main
   ```

---

## 🎯 快速同步（推荐）

### 方法一：使用同步脚本

```bash
# 在项目根目录运行
bash deploy/quick-sync.sh
```

脚本会自动执行以下步骤：
1. 连接到服务器
2. 拉取最新代码 (`git pull`)
3. 安装依赖 (`npm install`)
4. 构建项目 (`npm run build`)
5. 重启应用 (`pm2 restart`)

### 方法二：手动 SSH 执行

```bash
# 1. 连接到服务器
ssh root@123.56.75.68

# 2. 输入密码后，执行以下命令
cd /var/www/tiktok-ai-mcn
git pull origin main
npm install
npm run build
pm2 restart tiktok-ai-mcn
```

---

## 🔧 常用命令

### 在服务器上执行

```bash
# 查看应用状态
pm2 status

# 查看应用日志
pm2 logs tiktok-ai-mcn

# 查看最近 100 行日志
pm2 logs tiktok-ai-mcn --lines 100

# 重启应用
pm2 restart tiktok-ai-mcn

# 停止应用
pm2 stop tiktok-ai-mcn

# 查看 Nginx 状态
systemctl status nginx

# 重启 Nginx
systemctl restart nginx

# 查看 Nginx 错误日志
tail -50 /var/log/nginx/error.log
```

---

## 📁 服务器目录结构

```
/var/www/tiktok-ai-mcn/
├── .env.local          # 环境变量配置
├── .next/              # Next.js 构建输出
├── node_modules/       # 依赖包
├── src/                # 源代码
├── public/             # 静态资源
└── package.json        # 项目配置
```

---

## ⚠️ 注意事项

1. **只同步代码变更**：同步脚本只拉取代码并重新构建，不会修改环境变量
2. **环境变量修改**：如需修改 `.env.local`，请手动 SSH 到服务器编辑
3. **数据库迁移**：如有数据库结构变更，需要手动执行 SQL

---

## 🔗 相关链接

- 网站地址: https://tokfactoryai.com
- 服务器 IP: 123.56.75.68
- 项目目录: /var/www/tiktok-ai-mcn

---

## 📞 遇到问题？

1. 检查服务器是否可连接: `ping 123.56.75.68`
2. 检查应用是否运行: `pm2 status`
3. 查看错误日志: `pm2 logs tiktok-ai-mcn`
4. 检查端口是否开放: `netstat -tlnp | grep 3000`
