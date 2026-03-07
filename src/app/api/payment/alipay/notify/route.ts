/**
 * 支付宝回调
 * POST /api/payment/alipay/notify
 * 
 * 接收支付宝异步通知。
 * 无需登录态，通过 RSA2 签名验证确保安全。
 * 使用 adminClient (service-role) 操作数据库。
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAlipayNotify, yuanToCents } from '@/lib/payment/alipay';
import { fulfillPaymentOrder } from '@/lib/payment/fulfill';

export async function POST(request: NextRequest) {
  try {
    // 1. 支付宝回调是 application/x-www-form-urlencoded 格式
    const formData = await request.formData();
    const params: Record<string, string> = {};
    
    formData.forEach((value, key) => {
      params[key] = value.toString();
    });

    if (!params.out_trade_no) {
      console.error('[AlipayNotify] Missing out_trade_no');
      return new NextResponse('fail', { status: 200 });
    }

    // 2. 验签（RSA2）
    const isValid = verifyAlipayNotify(params);
    if (!isValid) {
      console.error('[AlipayNotify] Signature verification failed');
      return new NextResponse('fail', { status: 200 });
    }

    // 3. 检查交易状态
    const tradeStatus = params.trade_status;
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      console.log(`[AlipayNotify] Trade status: ${tradeStatus}, order: ${params.out_trade_no}`);
      return new NextResponse('success', { status: 200 });
    }

    // 4. 金额转换（支付宝回调的金额单位是元）
    const paidAmountCents = yuanToCents(params.total_amount || '0');

    // 5. 执行积分发放（原子 + 幂等）
    const fulfillResult = await fulfillPaymentOrder(
      params.out_trade_no,
      params.trade_no || '',
      paidAmountCents,
      { source: 'alipay', raw: params }
    );

    if (!fulfillResult.success) {
      console.error(`[AlipayNotify] Fulfill failed for ${params.out_trade_no}:`, fulfillResult.error);
    } else {
      console.log(`[AlipayNotify] Order ${params.out_trade_no} processed successfully`);
    }

    // 6. 返回 "success" 告诉支付宝已收到（纯文本）
    return new NextResponse('success', { status: 200 });

  } catch (error) {
    console.error('[AlipayNotify] Unexpected error:', error);
    return new NextResponse('fail', { status: 200 });
  }
}
