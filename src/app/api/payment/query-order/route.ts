/**
 * 查询订单状态
 * GET /api/payment/query-order?order_no=xxx
 * 
 * 需要用户登录态。前端用来轮询订单是否支付成功。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { queryOrderByNo } from '@/lib/payment/order-service';

export async function GET(request: NextRequest) {
  try {
    // 1. 验证用户
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    // 2. 获取订单号
    const { searchParams } = new URL(request.url);
    const orderNo = searchParams.get('order_no');

    if (!orderNo) {
      return NextResponse.json(
        { success: false, error: '缺少订单号' },
        { status: 400 }
      );
    }

    // 3. 查询订单（会验证 user_id 匹配）
    const order = await queryOrderByNo(orderNo, user.id);

    if (!order) {
      return NextResponse.json(
        { success: false, error: '订单不存在' },
        { status: 404 }
      );
    }

    // 4. 检查是否过期
    const orderData = order as Record<string, unknown>;
    let status = orderData.status as string;
    
    if (status === 'pending' && orderData.expired_at) {
      const expiredAt = new Date(orderData.expired_at as string);
      if (expiredAt < new Date()) {
        status = 'expired';
      }
    }

    return NextResponse.json({
      success: true,
      order: {
        order_no: orderData.order_no,
        status,
        product_name: orderData.product_name,
        credits_amount: orderData.credits_amount,
        amount_display: `¥${((orderData.amount_cents as number) / 100).toFixed(2)}`,
        pay_channel: orderData.pay_channel,
        created_at: orderData.created_at,
        paid_at: orderData.paid_at || null,
      },
    });

  } catch (error) {
    console.error('[Payment API] Query order error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
