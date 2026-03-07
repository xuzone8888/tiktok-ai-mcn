/**
 * 用户订单列表
 * GET /api/payment/orders?limit=20&offset=0
 * 
 * 需要用户登录态。返回当前用户的支付订单历史。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUserOrders } from '@/lib/payment/order-service';

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

    // 2. 解析分页参数
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // 3. 查询订单
    const { orders, total } = await getUserOrders(user.id, limit, offset);

    // 4. 格式化返回
    const formattedOrders = orders.map((order: Record<string, unknown>) => ({
      id: order.id,
      order_no: order.order_no,
      product_name: order.product_name,
      credits_amount: order.credits_amount,
      amount_display: `¥${((order.amount_cents as number) / 100).toFixed(2)}`,
      pay_channel: order.pay_channel,
      status: order.status,
      created_at: order.created_at,
      paid_at: order.paid_at || null,
    }));

    return NextResponse.json({
      success: true,
      orders: formattedOrders,
      total,
      limit,
      offset,
    });

  } catch (error) {
    console.error('[Payment API] Orders list error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
