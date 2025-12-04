# 🚀 Tok Factory 部署指南

## 📋 部署前准备清单

### 1. 确认所有 API 服务正常
- [ ] Supabase 项目已创建且数据库表已建立
- [ ] 豆包 (Doubao) API 密钥有效
- [ ] Sora2 API 密钥有效
- [ ] NanoBanana API 密钥有效

### 2. 环境变量准备
从各平台获取以下密钥：

| 变量名 | 获取位置 | 说明 |
|--------|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard > Settings > API | 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard > Settings > API | 匿名密钥 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard > Settings > API | 服务角色密钥 |
| `DOUBAO_API_KEY` | 火山引擎 ARK 平台 | API 密钥 |
| `DOUBAO_ENDPOINT_ID` | 火山引擎 ARK 平台 | 模型端点 ID |
| `SORA2_API_KEY` | 数创科技平台 | Sora2 API 密钥 |
| `SUCHUANG_API_KEY` | 数创科技平台 | 图片处理 API 密钥 |
| `NEXT_PUBLIC_APP_URL` | 部署后获取 | 生产环境 URL |
| `ADMIN_EMAIL` | 自定义 | 管理员邮箱 |

---

## 🌐 Vercel 部署步骤

### 步骤 1: 连接 GitHub 仓库

1. 访问 [Vercel](https://vercel.com) 并登录
2. 点击 "Add New..." > "Project"
3. 选择 "Import Git Repository"
4. 授权并选择 `xuzone8888/TIKTOK-AI` 仓库
5. 点击 "Import"

### 步骤 2: 配置环境变量

在 "Configure Project" 页面：

1. 展开 "Environment Variables" 部分
2. 逐个添加以下变量：

```
NEXT_PUBLIC_SUPABASE_URL = [你的 Supabase URL]
NEXT_PUBLIC_SUPABASE_ANON_KEY = [你的 Supabase 匿名密钥]
SUPABASE_SERVICE_ROLE_KEY = [你的 Supabase 服务角色密钥]
DOUBAO_API_KEY = [你的豆包 API 密钥]
DOUBAO_ENDPOINT_ID = [你的豆包端点 ID]
SORA2_API_KEY = [你的 Sora2 API 密钥]
SUCHUANG_API_KEY = [你的数创 API 密钥]
ADMIN_EMAIL = [管理员邮箱]
```

3. `NEXT_PUBLIC_APP_URL` 先留空，部署后再添加

### 步骤 3: 部署

1. 点击 "Deploy" 按钮
2. 等待构建完成 (约 2-3 分钟)
3. 部署成功后获取 Vercel 分配的域名

### 步骤 4: 更新 APP URL

1. 进入项目 Settings > Environment Variables
2. 添加 `NEXT_PUBLIC_APP_URL` = `https://your-project.vercel.app`
3. 触发重新部署：Deployments > 最新部署 > Redeploy

---

## 🌏 国内访问优化 (Cloudflare + 自定义域名)

### 步骤 1: 购买域名 (如果还没有)

推荐平台：
- **Cloudflare Registrar**: 无加价，约 $9/年 (.com)
- **Namecheap**: 首年优惠，约 $6/年 (.com)
- **阿里云/腾讯云**: 国内备案方便

### 步骤 2: 配置 Cloudflare

1. 注册 [Cloudflare](https://cloudflare.com) 账号
2. 添加您的域名
3. 按提示修改域名的 DNS 服务器为 Cloudflare 提供的地址
4. 等待 DNS 生效 (通常几分钟到几小时)

### 步骤 3: 添加 DNS 记录

在 Cloudflare DNS 设置中添加：

| 类型 | 名称 | 内容 | 代理状态 |
|------|------|------|----------|
| CNAME | @ | cname.vercel-dns.com | 已代理 (橙色云朵) |
| CNAME | www | cname.vercel-dns.com | 已代理 (橙色云朵) |

### 步骤 4: Vercel 添加自定义域名

1. 进入 Vercel 项目 > Settings > Domains
2. 添加您的域名 (例如 `tokfactory.com`)
3. Vercel 会自动验证 DNS 配置

### 步骤 5: Cloudflare SSL 设置

1. 进入 Cloudflare > SSL/TLS
2. 选择 "Full (strict)" 加密模式
3. 启用 "Always Use HTTPS"

### 步骤 6: 更新环境变量

更新 Vercel 中的 `NEXT_PUBLIC_APP_URL` 为您的自定义域名

---

## ⚡ Cloudflare 性能优化 (可选)

在 Cloudflare 控制台中：

### 缓存设置
- Caching > Configuration > Browser Cache TTL: 4 hours
- 启用 Rocket Loader (加速 JavaScript)

### 速度优化
- Speed > Optimization:
  - ✅ Auto Minify (HTML, CSS, JS)
  - ✅ Brotli 压缩
  - ✅ Early Hints

### 安全设置
- Security > Settings:
  - Security Level: Medium
  - ✅ Browser Integrity Check
  - ✅ Email Address Obfuscation

---

## 📊 部署后验证

### 功能测试清单
- [ ] 首页正常加载
- [ ] 用户登录/注册正常
- [ ] 管理员后台可访问
- [ ] 模特市场数据显示正确
- [ ] 快速生成 (单视频) 正常
- [ ] 快速生成 (单图片) 正常
- [ ] 批量视频生成正常
- [ ] 批量图片处理正常
- [ ] 任务日志显示记录
- [ ] 积分扣除/显示正常

### 国内访问测试
- [ ] 直接访问域名速度可接受
- [ ] 无需 VPN 可正常使用
- [ ] 图片/视频加载正常

---

## 🔧 常见问题

### Q: 部署后 API 调用失败
A: 检查环境变量是否正确配置，特别是 `SUPABASE_SERVICE_ROLE_KEY`

### Q: 国内访问慢
A: 确保 Cloudflare 代理已开启 (橙色云朵)，并启用了 Rocket Loader

### Q: Serverless 函数超时
A: Vercel Hobby 计划超时为 10 秒，如需更长时间，升级到 Pro 计划 ($20/月)

### Q: 图片/视频无法显示
A: 检查 `next.config.mjs` 中的 `images.remotePatterns` 是否包含所有外部图片域名

---

## 📞 支持

如遇问题，请检查：
1. Vercel 部署日志
2. 浏览器开发者工具控制台
3. Supabase 日志

