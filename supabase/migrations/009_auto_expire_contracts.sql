-- ============================================================================
-- 合约自动过期机制
-- 
-- 功能：
-- 1. 创建函数自动将过期合约标记为 expired
-- 2. 创建定时任务每小时执行一次
-- 3. 创建索引优化查询性能
-- ============================================================================

-- 1. 创建自动过期合约的函数
CREATE OR REPLACE FUNCTION auto_expire_contracts()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  -- 将所有已过期但状态仍为 active 的合约标记为 expired
  UPDATE public.contracts
  SET 
    status = 'expired',
    updated_at = NOW()
  WHERE 
    status = 'active' 
    AND end_date < NOW();
  
  -- 获取更新的行数
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  
  -- 记录日志（可选）
  IF expired_count > 0 THEN
    RAISE NOTICE 'Auto-expired % contracts', expired_count;
  END IF;
  
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. 创建索引以优化过期合约查询
CREATE INDEX IF NOT EXISTS idx_contracts_status_end_date 
ON public.contracts(status, end_date) 
WHERE status = 'active';

-- 3. 创建索引优化用户合约查询
CREATE INDEX IF NOT EXISTS idx_contracts_user_model_status 
ON public.contracts(user_id, model_id, status);

-- 4. 手动执行一次，清理现有过期合约
SELECT auto_expire_contracts();

-- ============================================================================
-- 注意：Supabase 的 pg_cron 扩展需要在项目设置中启用
-- 如果需要定时任务，请在 Supabase Dashboard 中：
-- 1. 进入 Database -> Extensions
-- 2. 启用 pg_cron 扩展
-- 3. 然后执行以下命令设置定时任务：
-- 
-- SELECT cron.schedule(
--   'auto-expire-contracts',  -- 任务名称
--   '0 * * * *',              -- 每小时执行一次
--   'SELECT auto_expire_contracts()'
-- );
-- ============================================================================

-- 授权执行函数
GRANT EXECUTE ON FUNCTION auto_expire_contracts() TO service_role;

-- 创建一个可以手动调用的 RPC 函数（通过 API 调用）
CREATE OR REPLACE FUNCTION public.cleanup_expired_contracts()
RETURNS JSON AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  SELECT auto_expire_contracts() INTO expired_count;
  
  RETURN json_build_object(
    'success', true,
    'expired_count', expired_count,
    'executed_at', NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_contracts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_contracts() TO service_role;
