# 阿里云部署文件说明

## 📁 文件结构

```
deploy/
├── README.md                    # 本文件 - 部署文件说明
├── QUICK_START.md              # 快速开始指南（5分钟部署）
├── DEPLOYMENT_CHECKLIST.md     # 详细部署检查清单
├── setup-server.sh             # 服务器初始化脚本
├── deploy.sh                   # 应用部署脚本
├── check-env.sh                # 环境变量检查脚本
└── nginx.conf.template         # Nginx 配置模板

项目根目录/
├── ecosystem.config.js         # PM2 进程管理配置
└── ALIYUN_DEPLOYMENT_GUIDE.md  # 完整部署指南
```

---

## 🚀 快速开始

### 方式 1: 使用快速开始指南（推荐新手）
查看 `QUICK_START.md` - 5分钟快速部署

### 方式 2: 使用详细检查清单（推荐）
查看 `DEPLOYMENT_CHECKLIST.md` - 逐步检查每个步骤

### 方式 3: 查看完整指南
查看 `../ALIYUN_DEPLOYMENT_GUIDE.md` - 完整的部署文档

---

## 📋 脚本说明

### 1. setup-server.sh
**用途**: 在全新的 Ubuntu 服务器上初始化环境

**功能**:
- 安装 Node.js 20.x
- 安装 PM2 进程管理器
- 安装 Nginx 反向代理
- 安装 Certbot (SSL 证书)
- 配置防火墙规则
- 创建应用目录

**使用方法**:
```bash
bash deploy/setup-server.sh
```

---

### 2. check-env.sh
**用途**: 检查所有必需的环境变量是否已配置

**功能**:
- 检查 .env.local 文件是否存在
- 验证所有必需的环境变量
- 显示已配置的变量（隐藏值）
- 列出缺失的变量

**使用方法**:
```bash
bash deploy/check-env.sh
```

---

### 3. deploy.sh
**用途**: 部署或更新应用

**功能**:
- 拉取最新代码
- 安装依赖
- 构建应用
- 启动/重启 PM2 进程
- 显示应用状态

**使用方法**:
```bash
bash deploy/deploy.sh
```

---

### 4. nginx.conf.template
**用途**: Nginx 反向代理配置模板

**使用方法**:
1. 复制到 `/etc/nginx/sites-available/tiktok-ai-mcn`
2. 编辑文件，替换 `your-domain.com` 为实际域名
3. 创建符号链接到 `sites-enabled`
4. 测试配置并重载 Nginx

---

## 🔧 配置文件说明

### ecosystem.config.js
PM2 进程管理配置文件，包含：
- 应用名称和启动命令
- 集群模式配置（多进程）
- 日志配置
- 自动重启配置
- 内存限制

**位置**: 项目根目录

---

## 📝 部署流程

### 首次部署
1. 连接服务器
2. 运行 `setup-server.sh` 初始化
3. 克隆代码到 `/var/www/tiktok-ai-mcn`
4. 创建 `.env.local` 并配置环境变量
5. 运行 `check-env.sh` 验证环境变量
6. 运行 `deploy.sh` 部署应用
7. 配置 Nginx（可选）
8. 配置 SSL 证书（推荐）

### 更新部署
1. 运行 `deploy.sh` 即可

---

## ⚙️ 环境变量配置

必需的环境变量（从 Vercel 获取）:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DOUBAO_API_KEY`
- `DOUBAO_ENDPOINT_ID`
- `SORA2_API_KEY`
- `SUCHUANG_API_KEY`
- `NEXT_PUBLIC_APP_URL` (使用阿里云域名)

可选的环境变量:
- `ADMIN_EMAIL`
- `SUCHUANG_API_ENDPOINT`
- `DOUBAO_API_ENDPOINT`

---

## 🐛 故障排查

### 查看应用日志
```bash
pm2 logs tiktok-ai-mcn
```

### 查看 Nginx 日志
```bash
sudo tail -f /var/log/nginx/error.log
```

### 检查应用状态
```bash
pm2 status
pm2 monit
```

### 重启应用
```bash
pm2 restart tiktok-ai-mcn
```

---

## 📚 相关文档

- **快速开始**: `QUICK_START.md`
- **详细清单**: `DEPLOYMENT_CHECKLIST.md`
- **完整指南**: `../ALIYUN_DEPLOYMENT_GUIDE.md`
- **Vercel 检查报告**: `../VERCEL_CONSISTENCY_REPORT.md`

---

## ✅ 下一步

1. 准备阿里云服务器
2. 按照 `QUICK_START.md` 开始部署
3. 遇到问题查看 `DEPLOYMENT_CHECKLIST.md`

祝部署顺利！🎉







