// ============================================================================
// TikTok AI MCN - 数据库类型定义
// ============================================================================
// 此文件由 Supabase CLI 生成，或手动维护以匹配数据库结构
// ============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ============================================================================
// 枚举类型
// ============================================================================

export type ContractStatus = "active" | "expired" | "cancelled";
export type GenerationType = "video" | "image";
export type GenerationStatus = "pending" | "processing" | "completed" | "failed";
export type ProductStatus = "pending" | "processing" | "ready" | "failed";
export type RentalPeriod = "daily" | "weekly" | "monthly" | "yearly";
export type CreditTransactionType = "purchase" | "consume" | "refund" | "bonus" | "expire";

// 新增枚举类型 - 备料台和任务队列
export type AspectRatio = "9:16" | "16:9" | "1:1";

// 电商图片工厂枚举
export type EcomImageMode = "ecom_five_pack" | "white_background" | "scene_image" | "try_on" | "buyer_show";
export type EcomTaskStatus = "created" | "generating_prompts" | "generating_images" | "success" | "partial_success" | "failed";
export type TaskStatus = "draft" | "queued" | "processing" | "completed" | "failed";
export type VideoDuration = "5s" | "10s" | "15s" | "20s";

// ============================================================================
// 数据库类型定义
// ============================================================================

export interface Database {
  public: {
    Tables: {
      // -----------------------------------------------------------------------
      // Users 表
      // -----------------------------------------------------------------------
      users: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          avatar_url: string | null;
          credits: number;
          settings: Json;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name?: string | null;
          avatar_url?: string | null;
          credits?: number;
          settings?: Json;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string | null;
          avatar_url?: string | null;
          credits?: number;
          settings?: Json;
          metadata?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // AI Models 表
      // -----------------------------------------------------------------------
      ai_models: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          avatar_url: string | null;
          sample_images: Json;
          sample_videos: Json;
          preview_url: string | null;
          category: string;
          style_tags: string[];
          gender: "male" | "female" | "neutral" | null;
          age_range: string | null;
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
          capabilities: Json;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          avatar_url?: string | null;
          sample_images?: Json;
          sample_videos?: Json;
          preview_url?: string | null;
          category: string;
          style_tags?: string[];
          gender?: "male" | "female" | "neutral" | null;
          age_range?: string | null;
          price_daily?: number;
          price_weekly?: number;
          price_monthly?: number;
          price_yearly?: number;
          rating?: number;
          is_active?: boolean;
          is_featured?: boolean;
          is_trending?: boolean;
          capabilities?: Json;
          metadata?: Json;
        };
        Update: {
          name?: string;
          description?: string | null;
          avatar_url?: string | null;
          sample_images?: Json;
          sample_videos?: Json;
          preview_url?: string | null;
          category?: string;
          style_tags?: string[];
          gender?: "male" | "female" | "neutral" | null;
          age_range?: string | null;
          price_daily?: number;
          price_weekly?: number;
          price_monthly?: number;
          price_yearly?: number;
          rating?: number;
          is_active?: boolean;
          is_featured?: boolean;
          is_trending?: boolean;
          capabilities?: Json;
          metadata?: Json;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // Products 表
      // -----------------------------------------------------------------------
      products: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          category: string | null;
          original_image_url: string;
          processed_images: ProcessedImages | null;
          status: ProductStatus;
          processing_error: string | null;
          tags: string[];
          metadata: Json;
          usage_count: number;
          created_at: string;
          updated_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          category?: string | null;
          original_image_url: string;
          processed_images?: ProcessedImages | null;
          status?: ProductStatus;
          processing_error?: string | null;
          tags?: string[];
          metadata?: Json;
        };
        Update: {
          name?: string;
          description?: string | null;
          category?: string | null;
          original_image_url?: string;
          processed_images?: ProcessedImages | null;
          status?: ProductStatus;
          processing_error?: string | null;
          tags?: string[];
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "products_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Contracts 表 (核心表)
      // -----------------------------------------------------------------------
      contracts: {
        Row: {
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
          metadata: Json;
          created_at: string;
          updated_at: string;
          cancelled_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          model_id: string;
          rental_period: RentalPeriod;
          start_date?: string;
          end_date: string;
          status?: ContractStatus;
          credits_paid: number;
          generations_count?: number;
          auto_renew?: boolean;
          metadata?: Json;
        };
        Update: {
          rental_period?: RentalPeriod;
          end_date?: string;
          status?: ContractStatus;
          auto_renew?: boolean;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "contracts_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contracts_model_id_fkey";
            columns: ["model_id"];
            referencedRelation: "ai_models";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Generations 表
      // -----------------------------------------------------------------------
      generations: {
        Row: {
          id: string;
          user_id: string;
          contract_id: string;
          product_id: string | null;
          model_id: string;
          type: GenerationType;
          status: GenerationStatus;
          input_params: GenerationInputParams;
          output_url: string | null;
          output_urls: Json;
          thumbnail_url: string | null;
          duration: number | null;
          resolution: string | null;
          file_size: number | null;
          credits_used: number;
          error_message: string | null;
          progress: number;
          metadata: Json;
          created_at: string;
          updated_at: string;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          contract_id: string;
          product_id?: string | null;
          model_id: string;
          type: GenerationType;
          status?: GenerationStatus;
          input_params: GenerationInputParams;
          output_url?: string | null;
          output_urls?: Json;
          thumbnail_url?: string | null;
          duration?: number | null;
          resolution?: string | null;
          file_size?: number | null;
          credits_used?: number;
          error_message?: string | null;
          progress?: number;
          metadata?: Json;
        };
        Update: {
          status?: GenerationStatus;
          output_url?: string | null;
          output_urls?: Json;
          thumbnail_url?: string | null;
          duration?: number | null;
          resolution?: string | null;
          file_size?: number | null;
          credits_used?: number;
          error_message?: string | null;
          progress?: number;
          metadata?: Json;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "generations_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generations_contract_id_fkey";
            columns: ["contract_id"];
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generations_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generations_model_id_fkey";
            columns: ["model_id"];
            referencedRelation: "ai_models";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Credit Transactions 表
      // -----------------------------------------------------------------------
      credit_transactions: {
        Row: {
          id: string;
          user_id: string;
          type: CreditTransactionType;
          amount: number;
          balance_after: number;
          reference_type: string | null;
          reference_id: string | null;
          description: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: CreditTransactionType;
          amount: number;
          balance_after: number;
          reference_type?: string | null;
          reference_id?: string | null;
          description?: string | null;
          metadata?: Json;
        };
        Update: never; // 交易记录不允许更新
        Relationships: [
          {
            foreignKeyName: "credit_transactions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Projects 表 - 创作会话/备料台
      // -----------------------------------------------------------------------
      projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          global_settings: ProjectGlobalSettings;
          default_model_id: string | null;
          default_product_id: string | null;
          total_tasks: number;
          completed_tasks: number;
          total_credits_used: number;
          is_active: boolean;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string;
          description?: string | null;
          global_settings?: ProjectGlobalSettings;
          default_model_id?: string | null;
          default_product_id?: string | null;
          total_tasks?: number;
          completed_tasks?: number;
          total_credits_used?: number;
          is_active?: boolean;
          metadata?: Json;
        };
        Update: {
          name?: string;
          description?: string | null;
          global_settings?: ProjectGlobalSettings;
          default_model_id?: string | null;
          default_product_id?: string | null;
          is_active?: boolean;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "projects_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_default_model_id_fkey";
            columns: ["default_model_id"];
            referencedRelation: "ai_models";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_default_product_id_fkey";
            columns: ["default_product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Task Queue 表 - 生成任务队列
      // -----------------------------------------------------------------------
      task_queue: {
        Row: {
          id: string;
          user_id: string;
          project_id: string | null;
          model_id: string;
          product_id: string | null;
          contract_id: string | null;
          type: GenerationType;
          status: TaskStatus;
          aspect_ratio: AspectRatio;
          duration: VideoDuration;
          is_auto_download: boolean;
          cost_credits: number;
          credits_deducted: boolean;
          input_params: TaskInputParams;
          output_url: string | null;
          output_urls: Json;
          thumbnail_url: string | null;
          resolution: string | null;
          file_size: number | null;
          api_task_id: string | null;
          api_provider: string | null;
          progress: number;
          error_message: string | null;
          retry_count: number;
          max_retries: number;
          priority: number;
          queue_position: number | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
          queued_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          timeout_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id?: string | null;
          model_id: string;
          product_id?: string | null;
          contract_id?: string | null;
          type?: GenerationType;
          status?: TaskStatus;
          aspect_ratio?: AspectRatio;
          duration?: VideoDuration;
          is_auto_download?: boolean;
          cost_credits?: number;
          credits_deducted?: boolean;
          input_params?: TaskInputParams;
          output_url?: string | null;
          output_urls?: Json;
          thumbnail_url?: string | null;
          resolution?: string | null;
          file_size?: number | null;
          api_task_id?: string | null;
          api_provider?: string | null;
          progress?: number;
          error_message?: string | null;
          retry_count?: number;
          max_retries?: number;
          priority?: number;
          queue_position?: number | null;
          metadata?: Json;
        };
        Update: {
          project_id?: string | null;
          status?: TaskStatus;
          aspect_ratio?: AspectRatio;
          duration?: VideoDuration;
          is_auto_download?: boolean;
          cost_credits?: number;
          credits_deducted?: boolean;
          input_params?: TaskInputParams;
          output_url?: string | null;
          output_urls?: Json;
          thumbnail_url?: string | null;
          resolution?: string | null;
          file_size?: number | null;
          api_task_id?: string | null;
          api_provider?: string | null;
          progress?: number;
          error_message?: string | null;
          retry_count?: number;
          priority?: number;
          queue_position?: number | null;
          metadata?: Json;
          queued_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          timeout_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "task_queue_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_queue_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_queue_model_id_fkey";
            columns: ["model_id"];
            referencedRelation: "ai_models";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_queue_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_queue_contract_id_fkey";
            columns: ["contract_id"];
            referencedRelation: "contracts";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Credit Pricing 表 - 积分定价配置
      // -----------------------------------------------------------------------
      credit_pricing: {
        Row: {
          id: string;
          type: string;
          key: string;
          credits: number;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          type: string;
          key: string;
          credits: number;
          description?: string | null;
          is_active?: boolean;
        };
        Update: {
          type?: string;
          key?: string;
          credits?: number;
          description?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // Ecom Image Tasks 表 - 电商图片工厂任务
      // -----------------------------------------------------------------------
      ecom_image_tasks: {
        Row: {
          id: string;
          user_id: string;
          mode: EcomImageMode;
          model_type: string;
          language: string;
          ratio: string;
          resolution: string | null;
          input_image_urls: Json;
          mode_config: Json;
          prompts: Json;
          output_items: Json;
          status: EcomTaskStatus;
          current_step: number;
          error_message: string | null;
          credits_cost: number;
          credits_charged: boolean;
          credits_charged_at: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          metadata: Json;
        };
        Insert: {
          id?: string;
          user_id: string;
          mode: EcomImageMode;
          model_type: string;
          language?: string;
          ratio?: string;
          resolution?: string | null;
          input_image_urls?: Json;
          mode_config?: Json;
          prompts?: Json;
          output_items?: Json;
          status?: EcomTaskStatus;
          current_step?: number;
          error_message?: string | null;
          credits_cost?: number;
          credits_charged?: boolean;
          credits_charged_at?: string | null;
          metadata?: Json;
        };
        Update: {
          mode?: EcomImageMode;
          model_type?: string;
          language?: string;
          ratio?: string;
          resolution?: string | null;
          input_image_urls?: Json;
          mode_config?: Json;
          prompts?: Json;
          output_items?: Json;
          status?: EcomTaskStatus;
          current_step?: number;
          error_message?: string | null;
          credits_cost?: number;
          credits_charged?: boolean;
          credits_charged_at?: string | null;
          completed_at?: string | null;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "ecom_image_tasks_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
    };

    Views: {
      user_dashboard_stats: {
        Row: {
          user_id: string;
          credits: number;
          active_contracts: number;
          total_products: number;
          total_generations: number;
          video_generations: number;
          image_generations: number;
        };
      };
      user_draft_tasks: {
        Row: {
          id: string;
          user_id: string;
          project_id: string | null;
          model_id: string;
          product_id: string | null;
          type: GenerationType;
          aspect_ratio: AspectRatio;
          duration: VideoDuration;
          is_auto_download: boolean;
          cost_credits: number;
          input_params: TaskInputParams;
          created_at: string;
          model_name: string;
          model_avatar: string | null;
          product_name: string | null;
          product_image: string | null;
        };
      };
      project_stats: {
        Row: {
          project_id: string;
          user_id: string;
          name: string;
          total_tasks: number;
          completed_tasks: number;
          total_credits_used: number;
          draft_count: number;
          queued_count: number;
          processing_count: number;
          completed_count: number;
          failed_count: number;
        };
      };
    };

    Functions: {
      check_active_contract: {
        Args: {
          p_user_id: string;
          p_model_id: string;
        };
        Returns: boolean;
      };
      get_user_active_models: {
        Args: {
          p_user_id: string;
        };
        Returns: {
          contract_id: string;
          model_id: string;
          model_name: string;
          model_avatar: string;
          model_category: string;
          start_date: string;
          end_date: string;
          days_remaining: number;
        }[];
      };
      create_contract: {
        Args: {
          p_user_id: string;
          p_model_id: string;
          p_rental_period: RentalPeriod;
        };
        Returns: string;
      };
      create_generation: {
        Args: {
          p_user_id: string;
          p_model_id: string;
          p_product_id: string | null;
          p_type: GenerationType;
          p_input_params: Json;
        };
        Returns: string;
      };
      expire_contracts: {
        Args: Record<string, never>;
        Returns: number;
      };
      // 新增函数 - 备料台和任务队列
      get_video_credits: {
        Args: {
          p_duration: VideoDuration;
        };
        Returns: number;
      };
      create_draft_task: {
        Args: {
          p_user_id: string;
          p_project_id: string | null;
          p_model_id: string;
          p_product_id: string | null;
          p_type: GenerationType;
          p_aspect_ratio: AspectRatio;
          p_duration: VideoDuration;
          p_is_auto_download: boolean;
          p_input_params: Json;
        };
        Returns: string;
      };
      start_task: {
        Args: {
          p_task_id: string;
        };
        Returns: boolean;
      };
      start_tasks_batch: {
        Args: {
          p_task_ids: string[];
        };
        Returns: number;
      };
      set_task_processing: {
        Args: {
          p_task_id: string;
          p_api_task_id: string;
        };
        Returns: boolean;
      };
      complete_task: {
        Args: {
          p_task_id: string;
          p_output_url: string;
          p_thumbnail_url?: string | null;
          p_file_size?: number | null;
          p_resolution?: string | null;
        };
        Returns: boolean;
      };
      fail_task: {
        Args: {
          p_task_id: string;
          p_error_message: string;
          p_refund?: boolean;
        };
        Returns: boolean;
      };
      process_timeout_tasks: {
        Args: Record<string, never>;
        Returns: number;
      };
    };

    Enums: {
      contract_status: ContractStatus;
      generation_type: GenerationType;
      generation_status: GenerationStatus;
      product_status: ProductStatus;
      rental_period: RentalPeriod;
      // 新增枚举
      aspect_ratio: AspectRatio;
      task_status: TaskStatus;
      video_duration: VideoDuration;
    };
  };
}

// ============================================================================
// 辅助类型
// ============================================================================

// 产品处理后的图片结构
export interface ProcessedImages {
  grid_images: string[];
  processed_at: string;
  metadata?: {
    width?: number;
    height?: number;
    format?: string;
  };
}

// 生成任务输入参数
export interface GenerationInputParams {
  script?: string;           // 文案/脚本
  duration?: number;         // 时长（秒）
  style?: string;            // 风格
  voice_id?: string;         // 语音ID
  background_music?: string; // 背景音乐
  language?: string;         // 语言
  aspect_ratio?: string;     // 宽高比 16:9, 9:16, 1:1
  quality?: "standard" | "high" | "ultra";
  [key: string]: unknown;
}

// 项目全局设置
export interface ProjectGlobalSettings {
  aspect_ratio: AspectRatio;
  duration: VideoDuration;
  auto_download: boolean;
  [key: string]: unknown;
}

// 任务队列输入参数
export interface TaskInputParams {
  script?: string;           // 文案/脚本
  style?: string;            // 风格
  voice_id?: string;         // 语音ID
  background_music?: string; // 背景音乐
  language?: string;         // 语言
  template_id?: string;      // 模板ID
  quality?: "standard" | "high" | "ultra";
  [key: string]: unknown;
}

// 积分定价配置
export interface CreditPricing {
  type: string;
  key: string;
  credits: number;
  description?: string;
}

// 视频时长积分定价映射
export const VIDEO_CREDITS_PRICING: Record<VideoDuration, number> = {
  "5s": 30,
  "10s": 50,
  "15s": 80,
  "20s": 120,
};

// ============================================================================
// 便捷类型别名
// ============================================================================

export type User = Database["public"]["Tables"]["users"]["Row"];
export type UserInsert = Database["public"]["Tables"]["users"]["Insert"];
export type UserUpdate = Database["public"]["Tables"]["users"]["Update"];

export type AIModel = Database["public"]["Tables"]["ai_models"]["Row"];
export type AIModelInsert = Database["public"]["Tables"]["ai_models"]["Insert"];
export type AIModelUpdate = Database["public"]["Tables"]["ai_models"]["Update"];

export type Product = Database["public"]["Tables"]["products"]["Row"];
export type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
export type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

export type Contract = Database["public"]["Tables"]["contracts"]["Row"];
export type ContractInsert = Database["public"]["Tables"]["contracts"]["Insert"];
export type ContractUpdate = Database["public"]["Tables"]["contracts"]["Update"];

export type Generation = Database["public"]["Tables"]["generations"]["Row"];
export type GenerationInsert = Database["public"]["Tables"]["generations"]["Insert"];
export type GenerationUpdate = Database["public"]["Tables"]["generations"]["Update"];

export type CreditTransaction = Database["public"]["Tables"]["credit_transactions"]["Row"];
export type CreditTransactionInsert = Database["public"]["Tables"]["credit_transactions"]["Insert"];

// Projects 表
export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];
export type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];

// Task Queue 表
export type Task = Database["public"]["Tables"]["task_queue"]["Row"];
export type TaskInsert = Database["public"]["Tables"]["task_queue"]["Insert"];
export type TaskUpdate = Database["public"]["Tables"]["task_queue"]["Update"];

// Credit Pricing 表
export type CreditPricingRow = Database["public"]["Tables"]["credit_pricing"]["Row"];

// Ecom Image Tasks 表（电商图片工厂）
export type EcomImageTaskRow = Database["public"]["Tables"]["ecom_image_tasks"]["Row"];
export type EcomImageTaskInsert = Database["public"]["Tables"]["ecom_image_tasks"]["Insert"];
export type EcomImageTaskUpdate = Database["public"]["Tables"]["ecom_image_tasks"]["Update"];

// ============================================================================
// 扩展类型（带关联数据）
// ============================================================================

// 带模特信息的合约
export interface ContractWithModel extends Contract {
  ai_models: AIModel;
}

// 带完整信息的生成记录
export interface GenerationWithDetails extends Generation {
  ai_models: AIModel;
  products: Product | null;
  contracts: Contract;
}

// 带关联信息的任务
export interface TaskWithDetails extends Task {
  ai_models: AIModel;
  products: Product | null;
  projects: Project | null;
}

// 带任务列表的项目
export interface ProjectWithTasks extends Project {
  tasks: Task[];
}

// 用户仪表盘统计
export type UserDashboardStats = Database["public"]["Views"]["user_dashboard_stats"]["Row"];

// 用户活跃模特（函数返回类型）
export type UserActiveModel = Database["public"]["Functions"]["get_user_active_models"]["Returns"][number];

// 用户草稿任务视图
export type UserDraftTask = Database["public"]["Views"]["user_draft_tasks"]["Row"];

// 项目统计视图
export type ProjectStats = Database["public"]["Views"]["project_stats"]["Row"];



