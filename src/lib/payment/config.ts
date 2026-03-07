/**
 * 支付系统 — 环境变量配置
 * 
 * 统一读取和校验所有支付相关环境变量。
 * 在服务端首次引用时会校验必需变量是否存在。
 */

// ============================================================================
// 微信支付配置
// ============================================================================

export function getWechatPayConfig() {
  const config = {
    mchid: process.env.WECHAT_PAY_MCHID || '',
    appid: process.env.WECHAT_PAY_APPID || '',
    apiV3Key: process.env.WECHAT_PAY_API_V3_KEY || '',
    serialNo: process.env.WECHAT_PAY_SERIAL_NO || '',
    privateKey: process.env.WECHAT_PAY_PRIVATE_KEY || '',  // 私钥内容直接存环境变量
    notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || 'https://www.toryxai.com/api/payment/wechat/notify',
  };

  return config;
}

// ============================================================================
// 支付宝配置
// ============================================================================

export function getAlipayConfig() {
  const config = {
    appId: process.env.ALIPAY_APP_ID || '',
    privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || '',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || 'https://www.toryxai.com/api/payment/alipay/notify',
    returnUrl: process.env.ALIPAY_RETURN_URL || 'https://www.toryxai.com/dashboard?payment=success',
  };

  return config;
}

// ============================================================================
// 通用支付配置
// ============================================================================

/** 订单过期时间（分钟） */
export const ORDER_EXPIRE_MINUTES = parseInt(process.env.PAYMENT_ORDER_EXPIRE_MINUTES || '30', 10);

/** 每个用户最多允许的 pending 订单数 */
export const MAX_PENDING_ORDERS = 5;

// ============================================================================
// 配置校验
// ============================================================================

export function validateWechatConfig(): { valid: boolean; missing: string[] } {
  const config = getWechatPayConfig();
  const missing: string[] = [];

  if (!config.mchid) missing.push('WECHAT_PAY_MCHID');
  if (!config.appid) missing.push('WECHAT_PAY_APPID');
  if (!config.apiV3Key) missing.push('WECHAT_PAY_API_V3_KEY');
  if (!config.serialNo) missing.push('WECHAT_PAY_SERIAL_NO');
  if (!config.privateKey) missing.push('WECHAT_PAY_PRIVATE_KEY');

  return { valid: missing.length === 0, missing };
}

export function validateAlipayConfig(): { valid: boolean; missing: string[] } {
  const config = getAlipayConfig();
  const missing: string[] = [];

  if (!config.appId) missing.push('ALIPAY_APP_ID');
  if (!config.privateKey) missing.push('ALIPAY_PRIVATE_KEY');
  if (!config.alipayPublicKey) missing.push('ALIPAY_PUBLIC_KEY');

  return { valid: missing.length === 0, missing };
}
