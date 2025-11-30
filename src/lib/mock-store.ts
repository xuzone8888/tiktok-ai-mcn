// 内存存储用于模拟（当 Supabase 不可用时）

export interface MockProductData {
  name?: string;
  original_image_url?: string;
  status: "pending" | "processing" | "ready" | "failed";
  processed_images: {
    grid_images: string[];
    processed_at: string;
    metadata: {
      width: number;
      height: number;
      format: string;
    };
  } | null;
  created_at?: string;
  updated_at?: string;
}

export const mockProductStore = new Map<string, MockProductData>();

// 生成任务存储
export interface GenerationData {
  id: string;
  user_id: string;
  model_id: string;
  product_id: string | null;
  type: "video" | "image";
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  output_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
  completed_at: string | null;
}

export const generationStore = new Map<string, GenerationData>();
