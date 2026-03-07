/**
 * 支付系统 — 订单服务
 * 
 * 订单号生成、订单创建、订单查询等核心逻辑
 */

import { nanoid } from 'nanoid';
import { createAdminClient } from '@/lib/supabase/admin';
import { ORDER_EXPIRE_MINUTES, MAX_PENDING_ORDERS } from './config';
import { DEFAULT_CREDIT_PACKS, type PayChannel, type CreditPack } from './types';

// ============================================================================
// 订单号生成
// ============================================================================

/**
 * 生成唯一订单号
 * 格式：TX + 年月日时分秒 + 8位随机字符
 * 示例：TX20260307143025_abcdefgh
 */
export function generateOrderNo(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  
  return `TX${dateStr}_${nanoid(8)}`;
}

// ============================================================================
// 查找积分包
// ============================================================================

export function findCreditPack(packId: string): CreditPack | undefined {
  return DEFAULT_CREDIT_PACKS.find(p => p.id === packId);
}

// ============================================================================
// 创建订单
// ============================================================================

export interface CreateOrderParams {
  userId: string;
  pack: CreditPack;
  payChannel: PayChannel;
  payUrl?: string;
}

export async function createOrder(params: CreateOrderParams) {
  const { userId, pack, payChannel, payUrl } = params;
  const adminClient = createAdminClient();

  // 1. 检查 pending 订单数量（防滥用）
  const { count } = await adminClient
    .from('payment_orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gt('expired_at', new Date().toISOString());

  if (count !== null && count >= MAX_PENDING_ORDERS) {
    return {
      success: false as const,
      error: `您有 ${count} 个未完成的订单，请先完成支付或等待过期后再创建新订单`,
    };
  }

  // 2. 生成订单号和过期时间
  const orderNo = generateOrderNo();
  const expiredAt = new Date(Date.now() + ORDER_EXPIRE_MINUTES * 60 * 1000).toISOString();

  // 3. 写入数据库
  const { data: order, error } = await adminClient
    .from('payment_orders')
    .insert({
      user_id: userId,
      order_no: orderNo,
      product_type: 'credit_pack',
      product_name: pack.name,
      credits_amount: pack.credits,
      amount_cents: pack.price_cents,
      currency: 'CNY',
      pay_channel: payChannel,
      pay_url: payUrl || null,
      status: 'pending',
      expired_at: expiredAt,
    })
    .select()
    .single();

  if (error) {
    console.error('[OrderService] Create order error:', error);
    return { success: false as const, error: '创建订单失败' };
  }

  return {
    success: true as const,
    order,
    orderNo,
    expiredAt,
  };
}

// ============================================================================
// 更新订单支付 URL
// ============================================================================

export async function updateOrderPayUrl(orderNo: string, payUrl: string) {
  const adminClient = createAdminClient();
  
  const { error } = await adminClient
    .from('payment_orders')
    .update({ pay_url: payUrl })
    .eq('order_no', orderNo);

  if (error) {
    console.error('[OrderService] Update pay_url error:', error);
  }
}

// ============================================================================
// 查询订单状态
// ============================================================================

export async function queryOrderByNo(orderNo: string, userId: string) {
  const adminClient = createAdminClient();

  const { data: order, error } = await adminClient
    .from('payment_orders')
    .select('*')
    .eq('order_no', orderNo)
    .eq('user_id', userId)
    .single();

  if (error || !order) {
    return null;
  }

  return order;
}

// ============================================================================
// 获取用户订单列表
// ============================================================================

export async function getUserOrders(userId: string, limit = 20, offset = 0) {
  const adminClient = createAdminClient();

  const { data: orders, error, count } = await adminClient
    .from('payment_orders')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[OrderService] Get user orders error:', error);
    return { orders: [], total: 0 };
  }

  return { orders: orders || [], total: count || 0 };
}
