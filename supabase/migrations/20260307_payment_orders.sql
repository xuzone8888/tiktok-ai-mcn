-- ============================================================================
-- 支付订单系统 — 数据库迁移
-- 2026-03-07
-- ============================================================================

-- 1. 创建 payment_orders 表
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 订单标识
  order_no VARCHAR(64) NOT NULL UNIQUE,
  trade_no VARCHAR(128),

  -- 商品信息（灵活，不绑死套餐）
  product_type VARCHAR(50) NOT NULL DEFAULT 'credit_pack',
  product_name VARCHAR(200) NOT NULL,
  credits_amount INT NOT NULL CHECK (credits_amount > 0),

  -- 金额（单位：分，避免浮点精度问题）
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'CNY',

  -- 支付渠道
  pay_channel VARCHAR(30) NOT NULL,

  -- 状态机
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','failed','refunded','closed','expired')),

  -- 支付凭证
  pay_url TEXT,

  -- 时间戳
  paid_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,

  -- 回调原始数据（审计对账用）
  notify_data JSONB,

  -- 元数据
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. 索引
CREATE INDEX IF NOT EXISTS idx_po_user_id ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON payment_orders(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_po_order_no ON payment_orders(order_no);
CREATE INDEX IF NOT EXISTS idx_po_created ON payment_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_expired ON payment_orders(expired_at) WHERE status = 'pending';

-- 3. RLS
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_orders" ON payment_orders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_full_access" ON payment_orders
  FOR ALL USING (auth.role() = 'service_role');

-- 4. 自动更新 updated_at 触发器
CREATE OR REPLACE FUNCTION update_payment_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_orders_updated_at
  BEFORE UPDATE ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION update_payment_orders_updated_at();

-- 5. 原子性积分发放存储过程（幂等 + 事务安全）
CREATE OR REPLACE FUNCTION fulfill_payment_order(
  p_order_no VARCHAR,
  p_trade_no VARCHAR,
  p_paid_amount_cents INT,
  p_notify_data JSONB
) RETURNS JSONB AS $$
DECLARE
  v_order RECORD;
  v_balance_before INT;
  v_balance_after INT;
BEGIN
  -- 1. 锁定订单行（FOR UPDATE 防止并发竞争）
  SELECT * INTO v_order
  FROM payment_orders
  WHERE order_no = p_order_no
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  -- 2. 幂等检查：已支付的订单直接返回成功
  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'already_paid', true);
  END IF;

  -- 3. 只处理 pending 状态
  IF v_order.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status', 'current_status', v_order.status);
  END IF;

  -- 4. 金额校验（防篡改，回调金额必须与订单金额一致）
  IF p_paid_amount_cents != v_order.amount_cents THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'amount_mismatch',
      'expected', v_order.amount_cents,
      'received', p_paid_amount_cents
    );
  END IF;

  -- 5. 锁定用户积分行
  SELECT credits INTO v_balance_before
  FROM profiles
  WHERE id = v_order.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  v_balance_after := v_balance_before + v_order.credits_amount;

  -- 6. 更新订单状态为已支付
  UPDATE payment_orders SET
    status = 'paid',
    trade_no = p_trade_no,
    paid_at = NOW(),
    notify_data = p_notify_data
  WHERE order_no = p_order_no;

  -- 7. 发放积分
  UPDATE profiles SET
    credits = v_balance_after,
    updated_at = NOW()
  WHERE id = v_order.user_id;

  -- 8. 写入交易流水
  INSERT INTO credit_transactions (
    user_id, type, amount, balance_before, balance_after,
    reference_type, reference_id, description
  ) VALUES (
    v_order.user_id, 'purchase', v_order.credits_amount,
    v_balance_before, v_balance_after,
    'payment_order', v_order.id,
    '在线支付充值 - ' || v_order.product_name
  );

  RETURN jsonb_build_object(
    'success', true,
    'credits_added', v_order.credits_amount,
    'new_balance', v_balance_after
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 添加注释
COMMENT ON TABLE payment_orders IS '支付订单表 - 微信支付/支付宝在线收款';
COMMENT ON COLUMN payment_orders.order_no IS '平台内部唯一订单号';
COMMENT ON COLUMN payment_orders.trade_no IS '第三方支付平台交易流水号';
COMMENT ON COLUMN payment_orders.amount_cents IS '支付金额（单位：分）';
COMMENT ON COLUMN payment_orders.pay_channel IS '支付渠道: wechat_native / alipay_qr';
COMMENT ON COLUMN payment_orders.pay_url IS '支付二维码URL';
COMMENT ON FUNCTION fulfill_payment_order IS '原子性积分发放：验证订单→校验金额→发放积分→记录流水，支持幂等';
