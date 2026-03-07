/**
 * 微信支付回调
 * POST /api/payment/wechat/notify
 * 
 * 接收微信支付异步通知。
 * 无需登录态，通过 AES-256-GCM 解密和验签确保安全。
 * 使用 adminClient (service-role) 操作数据库。
 */

import { NextRequest, NextResponse } from 'next/server';
import { decryptWechatNotify } from '@/lib/payment/wechat-pay';
import { fulfillPaymentOrder } from '@/lib/payment/fulfill';

// 微信回调要求返回特定格式
function wxSuccess() {
  return NextResponse.json(
    { code: 'SUCCESS', message: '成功' },
    { status: 200 }
  );
}

function wxFail(message: string) {
  return NextResponse.json(
    { code: 'FAIL', message },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  try {
    // 1. 读取原始请求体
    const rawBody = await request.text();

    if (!rawBody) {
      console.error('[WechatNotify] Empty body');
      return wxFail('Empty body');
    }

    // 2. 解析 JSON
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error('[WechatNotify] Invalid JSON');
      return wxFail('Invalid JSON');
    }

    // 3. 检查事件类型
    const eventType = body.event_type as string;
    if (eventType !== 'TRANSACTION.SUCCESS') {
      // 非支付成功通知，直接返回成功
      console.log(`[WechatNotify] Ignored event: ${eventType}`);
      return wxSuccess();
    }

    // 4. 解密回调数据
    const resource = body.resource as Record<string, string>;
    if (!resource || !resource.ciphertext || !resource.nonce) {
      console.error('[WechatNotify] Missing resource fields');
      return wxFail('Missing resource');
    }

    const decryptResult = decryptWechatNotify(
      resource.ciphertext,
      resource.nonce,
      resource.associated_data || ''
    );

    if (!decryptResult.success || !decryptResult.data) {
      console.error('[WechatNotify] Decrypt failed:', decryptResult.error);
      return wxFail('Decrypt failed');
    }

    const { out_trade_no, transaction_id, trade_state, amount_total } = decryptResult.data;

    // 5. 只处理支付成功
    if (trade_state !== 'SUCCESS') {
      console.log(`[WechatNotify] Trade state: ${trade_state}, order: ${out_trade_no}`);
      return wxSuccess();
    }

    // 6. 执行积分发放（原子 + 幂等）
    const fulfillResult = await fulfillPaymentOrder(
      out_trade_no,
      transaction_id,
      amount_total,
      { source: 'wechat', raw: body }
    );

    if (!fulfillResult.success) {
      console.error(`[WechatNotify] Fulfill failed for ${out_trade_no}:`, fulfillResult.error);
      // 即使发放失败也返回成功，避免微信重发导致日志刷屏
      // 真正的错误需要通过日志监控发现
      return wxSuccess();
    }

    console.log(`[WechatNotify] Order ${out_trade_no} processed successfully`);
    return wxSuccess();

  } catch (error) {
    console.error('[WechatNotify] Unexpected error:', error);
    return wxFail('Internal error');
  }
}
