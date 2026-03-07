/**
 * 支付系统 — 积分发放
 * 
 * 调用 PostgreSQL 存储过程 fulfill_payment_order 实现：
 * - 原子性：订单状态 + 积分余额 + 交易流水在一个事务里完成
 * - 幂等性：重复回调不会重复发放积分
 * - 安全性：金额校验防篡改
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type { FulfillResult } from './types';

/**
 * 执行支付成功后的积分发放
 * 
 * @param orderNo    - 内部订单号
 * @param tradeNo    - 第三方交易流水号
 * @param paidAmountCents - 实际支付金额（分），用于校验
 * @param notifyData - 回调原始数据（存档用）
 */
export async function fulfillPaymentOrder(
  orderNo: string,
  tradeNo: string,
  paidAmountCents: number,
  notifyData: Record<string, unknown>
): Promise<FulfillResult> {
  const adminClient = createAdminClient();

  try {
    const { data, error } = await adminClient.rpc(
      'fulfill_payment_order' as never,
      {
        p_order_no: orderNo,
        p_trade_no: tradeNo,
        p_paid_amount_cents: paidAmountCents,
        p_notify_data: notifyData,
      } as never
    );

    if (error) {
      console.error('[Fulfill] RPC error:', error);
      return { success: false, error: 'RPC 调用失败: ' + error.message };
    }

    // RPC 返回的是 JSONB
    const result = data as unknown as FulfillResult;

    if (result.success) {
      if (result.already_paid) {
        console.log(`[Fulfill] Order ${orderNo} already paid (idempotent)`);
      } else {
        console.log(`[Fulfill] Order ${orderNo} fulfilled: +${result.credits_added} credits, new balance: ${result.new_balance}`);
      }
    } else {
      console.error(`[Fulfill] Order ${orderNo} failed:`, result.error);
    }

    return result;
  } catch (error) {
    console.error('[Fulfill] Unexpected error:', error);
    return { success: false, error: '积分发放服务异常' };
  }
}
