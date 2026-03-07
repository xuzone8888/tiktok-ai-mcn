/**
 * 支付系统 — 类型定义
 */

// ============================================================================
// 支付渠道
// ============================================================================

export type PayChannel = 'wechat_native' | 'alipay_qr';

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'closed' | 'expired';

// ============================================================================
// 积分包商品（灵活配置，不绑死套餐）
// ============================================================================

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  price_cents: number;       // 价格（分）
  price_display: string;     // 显示价格 "¥39"
  badge?: string;            // "热卖" / "推荐" 等角标
  highlight?: boolean;       // 是否高亮推荐
}

// 默认积分包列表（后续可改为从数据库/配置读取）
export const DEFAULT_CREDIT_PACKS: CreditPack[] = [
  { id: 'pack_10',  name: '体验包',   credits: 100,  price_cents: 1000,  price_display: '¥10' },
  { id: 'pack_39',  name: '创作者包', credits: 200,  price_cents: 3900,  price_display: '¥39',  badge: '入门' },
  { id: 'pack_99',  name: '专业包',   credits: 1000, price_cents: 9900,  price_display: '¥99',  badge: '推荐', highlight: true },
  { id: 'pack_299', name: '企业包',   credits: 5000, price_cents: 29900, price_display: '¥299', badge: '最划算' },
];

// ============================================================================
// 创建订单请求/响应
// ============================================================================

export interface CreateOrderRequest {
  pack_id: string;           // 积分包 ID
  pay_channel: PayChannel;   // 支付渠道
}

export interface CreateOrderResponse {
  success: boolean;
  order_no?: string;
  pay_url?: string;          // 用于生成二维码的 URL
  amount_display?: string;   // 显示金额
  expires_in?: number;       // 过期秒数
  error?: string;
}

// ============================================================================
// 查询订单
// ============================================================================

export interface OrderQueryResponse {
  success: boolean;
  order?: {
    order_no: string;
    status: OrderStatus;
    product_name: string;
    credits_amount: number;
    amount_display: string;
    pay_channel: PayChannel;
    created_at: string;
    paid_at: string | null;
  };
  error?: string;
}

// ============================================================================
// 订单列表
// ============================================================================

export interface OrderListItem {
  id: string;
  order_no: string;
  product_name: string;
  credits_amount: number;
  amount_cents: number;
  pay_channel: PayChannel;
  status: OrderStatus;
  created_at: string;
  paid_at: string | null;
}

// ============================================================================
// 回调处理结果
// ============================================================================

export interface FulfillResult {
  success: boolean;
  already_paid?: boolean;
  credits_added?: number;
  new_balance?: number;
  error?: string;
}
