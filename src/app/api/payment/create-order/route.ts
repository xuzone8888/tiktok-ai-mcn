/**
 * 创建支付订单
 * POST /api/payment/create-order
 * 
 * 需要用户登录态。
 * 接收积分包ID和支付渠道，创建订单并调用支付平台下单，返回二维码URL。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { findCreditPack, createOrder, updateOrderPayUrl } from '@/lib/payment/order-service';
import { createWechatNativeOrder } from '@/lib/payment/wechat-pay';
import { createAlipayQROrder } from '@/lib/payment/alipay';
import type { CreateOrderRequest, PayChannel } from '@/lib/payment/types';

export async function POST(request: NextRequest) {
  try {
    // 1. 验证用户登录态
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    // 2. 解析请求体
    const body: CreateOrderRequest = await request.json();
    const { pack_id, pay_channel } = body;

    if (!pack_id || !pay_channel) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 3. 验证支付渠道
    const validChannels: PayChannel[] = ['wechat_native', 'alipay_qr'];
    if (!validChannels.includes(pay_channel)) {
      return NextResponse.json(
        { success: false, error: '不支持的支付方式' },
        { status: 400 }
      );
    }

    // 4. 查找积分包
    const pack = findCreditPack(pack_id);
    if (!pack) {
      return NextResponse.json(
        { success: false, error: '积分包不存在' },
        { status: 400 }
      );
    }

    // 5. 创建订单（写入数据库）
    const orderResult = await createOrder({
      userId: user.id,
      pack,
      payChannel: pay_channel,
    });

    if (!orderResult.success) {
      return NextResponse.json(
        { success: false, error: orderResult.error },
        { status: 400 }
      );
    }

    const { orderNo } = orderResult;

    // 6. 调用支付平台下单
    let payUrl: string | undefined;

    if (pay_channel === 'wechat_native') {
      const wxResult = await createWechatNativeOrder({
        orderNo,
        description: `Star Gaze - ${pack.name}`,
        amountCents: pack.price_cents,
      });

      if (!wxResult.success) {
        return NextResponse.json(
          { success: false, error: wxResult.error || '微信下单失败' },
          { status: 500 }
        );
      }

      payUrl = wxResult.code_url;
    } else if (pay_channel === 'alipay_qr') {
      // 支付宝金额单位是元（字符串）
      const amountYuan = (pack.price_cents / 100).toFixed(2);
      
      const alipayResult = await createAlipayQROrder({
        orderNo,
        subject: `Star Gaze - ${pack.name}`,
        totalAmountYuan: amountYuan,
      });

      if (!alipayResult.success) {
        return NextResponse.json(
          { success: false, error: alipayResult.error || '支付宝下单失败' },
          { status: 500 }
        );
      }

      payUrl = alipayResult.qr_code;
    }

    // 7. 更新订单的 pay_url
    if (payUrl) {
      await updateOrderPayUrl(orderNo, payUrl);
    }

    // 8. 返回
    return NextResponse.json({
      success: true,
      order_no: orderNo,
      pay_url: payUrl,
      amount_display: pack.price_display,
      expires_in: 30 * 60,  // 30 分钟
    });

  } catch (error) {
    console.error('[Payment API] Create order error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
