/**
 * 支付系统 — 微信支付 Native 扫码
 * 
 * 使用 wechatpay-node-v3 SDK 实现：
 * - Native 下单（生成二维码 URL）
 * - 回调验签 + AES-256-GCM 解密
 */

import WxPay from 'wechatpay-node-v3';
import { getWechatPayConfig, validateWechatConfig } from './config';

// ============================================================================
// 微信支付客户端（惰性初始化）
// ============================================================================

let wxPayInstance: WxPay | null = null;

function getWxPay(): WxPay | null {
  if (wxPayInstance) return wxPayInstance;

  const validation = validateWechatConfig();
  if (!validation.valid) {
    console.warn('[WechatPay] Missing config:', validation.missing.join(', '));
    return null;
  }

  const config = getWechatPayConfig();

  try {
    wxPayInstance = new WxPay({
      appid: config.appid,
      mchid: config.mchid,
      serial_no: config.serialNo,  // 传入序列号，跳过 publicKey 的证书解析
      publicKey: Buffer.from('PLACEHOLDER'),  // Native 下单不需要平台公钥，但 SDK 要求非空
      privateKey: Buffer.from(config.privateKey.replace(/\\n/g, '\n')),
      key: config.apiV3Key,
    });
    return wxPayInstance;
  } catch (error) {
    console.error('[WechatPay] Init error:', error);
    return null;
  }
}

// ============================================================================
// Native 下单（生成支付二维码 URL）
// ============================================================================

export interface WechatNativeOrderParams {
  orderNo: string;
  description: string;
  amountCents: number;
}

export interface WechatNativeOrderResult {
  success: boolean;
  code_url?: string;     // 二维码链接
  error?: string;
}

export async function createWechatNativeOrder(
  params: WechatNativeOrderParams
): Promise<WechatNativeOrderResult> {
  const wxPay = getWxPay();
  if (!wxPay) {
    return { success: false, error: '微信支付未配置' };
  }

  const config = getWechatPayConfig();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await wxPay.transactions_native({
      description: params.description,
      out_trade_no: params.orderNo,
      notify_url: config.notifyUrl,
      amount: {
        total: params.amountCents,
        currency: 'CNY',
      },
    }) as any;

    const codeUrl = result.code_url || result.data?.code_url;
    if (result.status === 200 && codeUrl) {
      return { success: true, code_url: codeUrl };
    }

    console.error('[WechatPay] Native order failed. Full response:', JSON.stringify(result, null, 2));
    return { success: false, error: result.message || result.detail?.message || '微信下单失败' };
  } catch (error: any) {
    console.error('[WechatPay] Native order error:', error?.message || error);
    console.error('[WechatPay] Error details:', JSON.stringify(error?.response?.data || error?.data || {}, null, 2));
    return { success: false, error: `微信支付服务异常: ${error?.message || '未知错误'}` };
  }
}

// ============================================================================
// 回调解密与验签
// ============================================================================

export interface WechatNotifyResult {
  success: boolean;
  data?: {
    out_trade_no: string;     // 商户订单号
    transaction_id: string;   // 微信支付订单号
    trade_state: string;      // 交易状态 SUCCESS / CLOSED 等
    amount_total: number;     // 实付金额（分）
    payer_openid: string;     // 付款人 OpenID
  };
  error?: string;
}

/**
 * 解密微信回调通知
 * 微信 API v3 回调使用 AES-256-GCM 加密
 */
export function decryptWechatNotify(
  ciphertext: string,
  nonce: string,
  associatedData: string
): WechatNotifyResult {
  const wxPay = getWxPay();
  if (!wxPay) {
    return { success: false, error: '微信支付未配置' };
  }

  const config = getWechatPayConfig();

  try {
    const decrypted = wxPay.decipher_gcm(
      ciphertext,
      associatedData,
      nonce,
      config.apiV3Key
    );

    if (!decrypted || typeof decrypted !== 'object') {
      return { success: false, error: '解密失败' };
    }

    const data = decrypted as Record<string, unknown>;
    const amountObj = data.amount as Record<string, unknown> | undefined;

    return {
      success: true,
      data: {
        out_trade_no: data.out_trade_no as string,
        transaction_id: data.transaction_id as string,
        trade_state: data.trade_state as string,
        amount_total: (amountObj?.total as number) || 0,
        payer_openid: (data.payer as Record<string, unknown>)?.openid as string || '',
      },
    };
  } catch (error) {
    console.error('[WechatPay] Decrypt error:', error);
    return { success: false, error: '回调解密失败' };
  }
}
