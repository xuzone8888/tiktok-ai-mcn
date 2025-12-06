# 已获取的环境变量值

## ✅ 已从 Vercel 获取的值

1. **NEXT_PUBLIC_APP_URL**: `https://www.tokfactoryai.com`
2. **NEXT_PUBLIC_SUPABASE_URL**: `https://hfabrifuvujpdzarlbky.supabase.co`
3. **NEXT_PUBLIC_SUPABASE_ANON_KEY**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0Njc5OTIsImV4cCI6MjA4MDA0Mzk5Mn0.EonhiMYT1AgVgqNvyHER7NBKkN629tAFatOhnnqJdIo`
4. **SORA2_API_KEY**: `sk-SZPEdRnAdW3Dgu9DqTE4nNcqkv1fNG3oBULwmEhw6F329JLE`

## ⚠️ 需要手动获取的值

由于 Vercel 的安全限制，以下值需要您手动从 Vercel 环境变量页面点击 "Click to reveal" 获取：

1. **SUPABASE_SERVICE_ROLE_KEY** - 点击对应行的 "Click to reveal" 按钮
2. **DOUBAO_API_KEY** - 点击对应行的 "Click to reveal" 按钮
3. **DOUBAO_ENDPOINT_ID** - 点击对应行的 "Click to reveal" 按钮
4. **SUCHUANG_API_KEY** - 点击对应行的 "Click to reveal" 按钮

## 📝 使用方法

1. 在 Vercel 环境变量页面，逐个点击上述变量的 "Click to reveal" 按钮
2. 复制值到 `deploy/.env.local.aliyun` 文件中
3. 将文件复制到服务器: `scp deploy/.env.local.aliyun root@123.56.75.68:/var/www/tiktok-ai-mcn/.env.local`

## 🔄 或者直接在服务器上创建

连接服务器后，运行：
```bash
nano /var/www/tiktok-ai-mcn/.env.local
```

然后复制以下内容并填入缺失的值：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://hfabrifuvujpdzarlbky.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWJyaWZ1dnVqcGR6YXJsYmt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0Njc5OTIsImV4cCI6MjA4MDA0Mzk5Mn0.EonhiMYT1AgVgqNvyHER7NBKkN629tAFatOhnnqJdIo
SUPABASE_SERVICE_ROLE_KEY=从Vercel获取
DOUBAO_API_KEY=从Vercel获取
DOUBAO_ENDPOINT_ID=从Vercel获取
SORA2_API_KEY=sk-SZPEdRnAdW3Dgu9DqTE4nNcqkv1fNG3oBULwmEhw6F329JLE
SUCHUANG_API_KEY=从Vercel获取
NEXT_PUBLIC_APP_URL=http://123.56.75.68:3000
ADMIN_EMAIL=admin@example.com
```




