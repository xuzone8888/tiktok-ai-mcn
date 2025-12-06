// 产品相关类型定义

export interface ProcessedImages {
  grid_images: string[];
  processed_at: string;
  metadata?: {
    width?: number;
    height?: number;
    format?: string;
  };
}

export type ProductStatus = "pending" | "processing" | "ready" | "failed";

export interface Product {
  id: string;
  user_id?: string;
  name: string;
  description?: string | null;
  original_image_url: string;
  processed_images: ProcessedImages | null;
  status: ProductStatus;
  processing_error?: string | null;
  category?: string | null;
  tags?: string[];
  usage_count?: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  processed_at?: string | null;
}



