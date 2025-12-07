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
NEXT_PUBLIC_SUPABASE_URL=https://hfabrifuvujpdzarlbky.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0Njc5OTIsImV4cCI6MjA4MDA0Mzk5Mn0.EonhiMYT1AgVgqNvyHER7NBKkN629tAFatOhnnqJdIo
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDQ2Nzk5MiwiZXhwIjoyMDgwMDQzOTkyfQ.CuMexYcJZA_xTvTUwBz2uA2nBhGOx7j_6BKurQyA2JQ

# ------------------------------------------
# 2. 豆包 (Doubao) API 配置
# ------------------------------------------
DOUBAO_API_KEY=1450acdb-9797-4f2c-8767-681df026a6e3
DOUBAO_ENDPOINT_ID=ep-20251202180845-62hxd

# ------------------------------------------
# 3. Sora2 视频生成 API 配置
# ------------------------------------------
SORA2_API_KEY=sk-SZPEdRnAdW3Dgu9DqTE4nNcqkv1fNG3oBULwmEhw6F329JLE
SUCHUANG_API_KEY=2W2tt3CnhHnWuT1nVmdgfrE9eJ

# ------------------------------------------
# 4. 应用配置
# ------------------------------------------
NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000

# ------------------------------------------
# 5. 管理员配置
# ------------------------------------------
ADMIN_EMAIL=admin@example.com
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






