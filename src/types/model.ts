// AI 角色相关类型定义

export interface AIModel {
  id: string;
  name: string;
  description?: string;
  avatar_url: string | null;
  sample_images: string[];
  sample_videos?: string[];
  preview_url?: string;
  category: string;
  style_tags: string[];
  gender: "male" | "female" | "neutral" | null;
  age_range?: string;
  // AI角色触发词 - 用于在视频生成时指定角色外观
  trigger_word?: string;
  price_daily: number;
  price_weekly: number;
  price_monthly: number;
  price_yearly: number;
  rating: number;
  total_rentals: number;
  total_generations: number;
  is_active: boolean;
  is_featured: boolean;
  is_trending: boolean;
  capabilities?: {
    video: boolean;
    image: boolean;
    voice: boolean;
    languages: string[];
  };
  created_at: string;
  updated_at?: string;
  // === Phase 3: 角色系统字段 ===
  source?: string;
  owner_id?: string | null;
  is_public?: boolean;
  reference_sheet_url?: string | null;
  reference_status?: string;
  publish_price?: number;
}

export type ContractStatus = "active" | "expired" | "cancelled";
export type RentalPeriod = "daily" | "weekly" | "monthly" | "yearly";

export interface Contract {
  id: string;
  user_id: string;
  model_id: string;
  rental_period: RentalPeriod;
  start_date: string;
  end_date: string;
  status: ContractStatus;
  credits_paid: number;
  generations_count: number;
  auto_renew: boolean;
  created_at: string;
  updated_at?: string;
  cancelled_at?: string;
}

export interface ContractWithModel extends Contract {
  ai_models: AIModel;
}

export interface UserCredits {
  id: string;
  credits: number;
}



