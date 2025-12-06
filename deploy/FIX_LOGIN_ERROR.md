# 🔧 修复登录错误 - invalid_credentials

## 问题诊断

浏览器控制台显示错误：
```
Login error: {"__isAuthError":true,"name":"AuthApiError","status":400,"code":"invalid_credentials"}
```

**错误原因**: Supabase 返回 `invalid_credentials`，表示用户名或密码不正确。

---

## ✅ 解决方案

### 方案 1: 检查账号密码（推荐）

1. **确认账号密码是否正确**
   - 在 Vercel 部署的网站上测试登录
   - 如果 Vercel 上可以登录，说明账号密码正确
   - 如果 Vercel 上也不能登录，说明账号密码可能错误

2. **尝试注册新账号**
   - 访问：http://123.56.75.68:3000/auth/register
   - 注册一个新账号进行测试

### 方案 2: 配置 Supabase 重定向 URL（如果需要）

虽然 `signInWithPassword` 通常不需要重定向 URL，但为了确保兼容性，建议在 Supabase 中配置：

1. **登录 Supabase 控制台**
   - 访问：https://supabase.com/dashboard
   - 选择项目：`hfabrifuvujpdzarlbky`

2. **配置重定向 URL**
   - 进入 **Authentication** > **URL Configuration**
   - 在 **Site URL** 中添加：
     ```
     http://123.56.75.68:3000
     ```
   - 在 **Redirect URLs** 中添加：
     ```
     http://123.56.75.68:3000/**
     http://123.56.75.68:3000/auth/callback
     ```

3. **保存配置**

### 方案 3: 检查 Supabase 用户表

如果账号确实存在但无法登录，可能是：
- 用户账号被禁用
- 邮箱未验证（如果启用了邮箱验证）
- 密码已过期

---

## 🔍 验证步骤

### 1. 测试注册功能

访问注册页面，尝试注册新账号：
```
http://123.56.75.68:3000/auth/register
```

如果注册成功，说明 Supabase 连接正常，问题在于登录凭据。

### 2. 检查服务器日志

在服务器上查看应用日志：
```bash
ssh root@123.56.75.68
pm2 logs tiktok-ai-mcn --lines 50
```

### 3. 检查环境变量

确认环境变量配置正确：
```bash
cd /var/www/tiktok-ai-mcn
cat .env.local | grep SUPABASE
```

应该显示：
```
NEXT_PUBLIC_SUPABASE_URL=https://hfabrifuvujpdzarlbky.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

---

## 📝 常见问题

### Q: 为什么 Vercel 上可以登录，但阿里云上不能？

A: 这通常是因为：
1. 账号密码输入错误
2. Supabase 的重定向 URL 配置问题（虽然 `signInWithPassword` 不需要）
3. 浏览器缓存问题

**解决方法**：
- 清除浏览器缓存
- 尝试使用无痕模式
- 确认账号密码正确

### Q: 如何重置密码？

A: 访问忘记密码页面：
```
http://123.56.75.68:3000/auth/forgot-password
```

---

## 🚀 快速测试

1. **测试注册**：
   ```
   访问: http://123.56.75.68:3000/auth/register
   注册一个新账号
   ```

2. **测试登录**：
   ```
   使用新注册的账号登录
   ```

3. **如果注册和登录都失败**：
   - 检查 Supabase 配置
   - 检查网络连接
   - 查看服务器日志

---

## ✅ 验证成功标志

登录成功后应该：
- 跳转到 `/dashboard` 页面
- 显示用户信息
- 可以正常使用应用功能

---

## 📞 需要帮助？

如果问题仍然存在：
1. 查看浏览器控制台完整错误信息
2. 查看服务器日志：`pm2 logs tiktok-ai-mcn`
3. 检查 Supabase 控制台的 Authentication 日志



