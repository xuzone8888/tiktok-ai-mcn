# 环境变量值 - 用于阿里云服务器

## 📋 完整环境变量配置

在服务器上创建 `.env.local` 文件，复制以下内容：

```bash
# ==========================================
# 阿里云服务器环境变量配置
# ==========================================

# ------------------------------------------
# 1. Supabase 配置
# ------------------------------------------
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ------------------------------------------
# 2. 豆包 (Doubao) API 配置
# ------------------------------------------
DOUBAO_API_KEY=your-doubao-api-key
DOUBAO_ENDPOINT_ID=your-doubao-endpoint-id

# ------------------------------------------
# 3. Sora2 视频生成 API 配置
# ------------------------------------------
SORA2_API_KEY=your-sora2-api-key
SUCHUANG_API_KEY=your-suchuang-api-key

# ------------------------------------------
# 4. 应用配置
# ------------------------------------------
NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000

# ------------------------------------------
# 5. 管理员配置
# ------------------------------------------
ADMIN_EMAIL=admin@example.com

# ------------------------------------------
# 6. TikTok Content API
# ------------------------------------------
TIKTOK_CLIENT_KEY=从 TikTok Developer Portal 获取
TIKTOK_CLIENT_SECRET=从 TikTok Developer Portal 获取
TIKTOK_REDIRECT_URI=https://www.toryxai.com/api/tiktok/auth/callback

# ------------------------------------------
# 7. TikTok Shop OAuth (Partner Center)
# ------------------------------------------
TIKTOK_SHOP_APP_KEY=从 TikTok Shop Partner Center 获取
TIKTOK_SHOP_APP_SECRET=从 TikTok Shop Partner Center 获取
TIKTOK_SHOP_REDIRECT_URI=https://www.toryxai.com/api/tiktok-shop/auth/callback
TIKTOK_SHOP_SERVICE_ID=从 TikTok Shop Partner Center 获取
```

## 🚀 使用方法

### 方法1：在服务器上直接创建

连接服务器后，运行：

```bash
cd /var/www/tiktok-ai-mcn
nano .env.local
```

然后粘贴上面的内容，保存（`Ctrl+X` → `Y` → `Enter`）

### 方法2：使用一键部署脚本

运行 `deploy/one-click-deploy.sh` 脚本，它会自动创建模板文件并提示您编辑。

## ✅ 验证配置

创建文件后，运行：

```bash
bash deploy/check-env.sh
```

确保所有环境变量都已正确配置。








