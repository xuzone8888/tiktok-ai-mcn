-- ============================================================================
-- 积分系统修复 SQL 脚本
-- 执行位置：Supabase Dashboard > SQL Editor
-- ============================================================================

-- 第一步：查看当前所有用户的积分情况
SELECT id, email, name, credits, created_at 
FROM profiles 
ORDER BY credits DESC;

-- ============================================================================
-- 第二步：清零所有用户积分（确认后执行）
-- ============================================================================

-- 记录清零操作到交易日志
INSERT INTO credit_transactions (user_id, amount, type, description, balance_before, balance_after)
SELECT 
  id, 
  -credits, 
  'admin_adjustment', 
  '系统积分清零重置 - 修复重复退款Bug', 
  credits, 
  0
FROM profiles
WHERE credits > 0;

-- 清零所有用户积分
UPDATE profiles 
SET credits = 0, updated_at = NOW();

-- ============================================================================
-- 第三步：验证清零结果
-- ============================================================================

-- 查看清零后的用户积分
SELECT id, email, name, credits FROM profiles ORDER BY created_at DESC LIMIT 10;

-- 查看交易记录
SELECT * FROM credit_transactions 
WHERE description LIKE '%清零%' 
ORDER BY created_at DESC 
LIMIT 20;

-- ============================================================================
-- 可选：给管理员账户充值积分池（用于发放给用户）
-- 将 'admin@example.com' 替换为实际管理员邮箱
-- ============================================================================

-- 给管理员账户充值 100000 积分（作为积分池）
-- UPDATE profiles 
-- SET credits = 100000 
-- WHERE email = 'admin@example.com' AND role IN ('admin', 'super_admin');
