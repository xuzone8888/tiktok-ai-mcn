/**
 * 支付系统 — 支付宝当面付
 * 
 * 使用 alipay-sdk 实现：
 * - 当面付预下单（alipay.trade.precreate）生成二维码 URL
 * - 异步回调验签
 */

import { AlipaySdk } from 'alipay-sdk';
import { getAlipayConfig, validateAlipayConfig } from './config';

// ============================================================================
// 支付宝客户端（惰性初始化）
// ============================================================================

let alipayInstance: AlipaySdk | null = null;

function getAlipay(): AlipaySdk | null {
  if (alipayInstance) return alipayInstance;

  const validation = validateAlipayConfig();
  if (!validation.valid) {
    console.warn('[Alipay] Missing config:', validation.missing.join(', '));
    return null;
  }

  const config = getAlipayConfig();

  try {
    alipayInstance = new AlipaySdk({
      appId: config.appId,
      privateKey: config.privateKey,
      alipayPublicKey: config.alipayPublicKey,
      signType: 'RSA2',
    });
    return alipayInstance;
  } catch (error) {
    console.error('[Alipay] Init error:', error);
    return null;
  }
}

// ============================================================================
// 当面付预下单（生成二维码 URL）
// ============================================================================

export interface AlipayPrecreateParams {
  orderNo: string;
  subject: string;          // 商品标题
  totalAmountYuan: string;  // 金额（元，字符串，如 "9.90"）
}

export interface AlipayPrecreateResult {
  success: boolean;
  qr_code?: string;         // 二维码链接
  error?: string;
}

export async function createAlipayQROrder(
  params: AlipayPrecreateParams
): Promise<AlipayPrecreateResult> {
  const alipay = getAlipay();
  if (!alipay) {
    return { success: false, error: '支付宝未配置' };
  }

  const config = getAlipayConfig();

  try {
    const result = await alipay.exec('alipay.trade.precreate', {
      notify_url: config.notifyUrl,
      bizContent: {
        out_trade_no: params.orderNo,
        total_amount: params.totalAmountYuan,
        subject: params.subject,
      },
    });

    // alipay-sdk v4 返回格式
    const response = result as Record<string, unknown>;

    if (response.qrCode || response.qr_code) {
      return {
        success: true,
        qr_code: (response.qrCode || response.qr_code) as string,
      };
    }

    // 检查错误
    const subCode = response.subCode || response.sub_code;
    const subMsg = response.subMsg || response.sub_msg;
    console.error('[Alipay] Precreate failed:', { subCode, subMsg, response });
    return {
      success: false,
      error: (subMsg as string) || '支付宝下单失败',
    };
  } catch (error) {
    console.error('[Alipay] Precreate error:', error);
    return { success: false, error: '支付宝服务异常' };
  }
}

// ============================================================================
// 回调验签
// ============================================================================

export interface AlipayNotifyData {
  out_trade_no: string;       // 商户订单号
  trade_no: string;           // 支付宝交易号
  trade_status: string;       // 交易状态
  total_amount: string;       // 交易金额（元）
  buyer_id: string;           // 买家支付宝用户号
  [key: string]: string;      // 其他字段
}

/**
 * 验证支付宝回调签名
 */
export function verifyAlipayNotify(
  notifyParams: Record<string, string>
): boolean {
  const alipay = getAlipay();
  if (!alipay) {
    console.error('[Alipay] Cannot verify: SDK not initialized');
    return false;
  }

  try {
    // alipay-sdk 内置验签方法
    const result = alipay.checkNotifySign(notifyParams);
    return result;
  } catch (error) {
    console.error('[Alipay] Verify sign error:', error);
    return false;
  }
}

/**
 * 将金额从"元"转换为"分"
 */
export function yuanToCents(yuan: string): number {
  return Math.round(parseFloat(yuan) * 100);
}
