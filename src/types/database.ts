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
          trigger_word: string | null;
          capabilities: Json;
          metadata: Json;
          created_at: string;
          updated_at: string;
          // === Phase 1: 角色系统字段 ===
          source: string;
          owner_id: string | null;
          reference_images: Json;
          character_type: string;
          dna_config: Json;
          reference_sheet_url: string | null;
          reference_status: string;
          reference_task_id: string | null;
          preview_video_url: string | null;
          is_public: boolean;
          publish_price: number;
          forge_type: string | null;
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
          trigger_word?: string | null;
          capabilities?: Json;
          metadata?: Json;
          // === Phase 1: 角色系统字段 ===
          source?: string;
          owner_id?: string | null;
          reference_images?: Json;
          character_type?: string;
          dna_config?: Json;
          reference_sheet_url?: string | null;
          reference_status?: string;
          reference_task_id?: string | null;
          preview_video_url?: string | null;
          is_public?: boolean;
          publish_price?: number;
          forge_type?: string | null;
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
          trigger_word?: string | null;
          total_rentals?: number;
          total_generations?: number;
          capabilities?: Json;
          metadata?: Json;
          // === Phase 1: 角色系统字段 ===
          source?: string;
          owner_id?: string | null;
          reference_images?: Json;
          character_type?: string;
          dna_config?: Json;
          reference_sheet_url?: string | null;
          reference_status?: string;
          reference_task_id?: string | null;
          preview_video_url?: string | null;
          is_public?: boolean;
          publish_price?: number;
          forge_type?: string | null;
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
          task_id: string | null;
          type: string;
          source: string;
          prompt: string | null;
          model: string | null;
          duration: number | null;
          aspect_ratio: string | null;
          quality: string | null;
          source_image_url: string | null;
          status: string;
          result_url: string | null;
          video_url: string | null;
          image_url: string | null;
          thumbnail_url: string | null;
          error_message: string | null;
          credit_cost: number;
          use_pro: boolean;
          metadata: Json;
          created_at: string;
          completed_at: string | null;
          group_name: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_id?: string | null;
          type: string;
          source?: string;
          prompt?: string | null;
          model?: string | null;
          duration?: number | null;
          aspect_ratio?: string | null;
          quality?: string | null;
          source_image_url?: string | null;
          status?: string;
          result_url?: string | null;
          video_url?: string | null;
          image_url?: string | null;
          thumbnail_url?: string | null;
          error_message?: string | null;
          credit_cost?: number;
          use_pro?: boolean;
          metadata?: Json;
          group_name?: string | null;
        };
        Update: {
          task_id?: string | null;
          type?: string;
          source?: string;
          status?: string;
          result_url?: string | null;
          video_url?: string | null;
          image_url?: string | null;
          thumbnail_url?: string | null;
          error_message?: string | null;
          credit_cost?: number;
          metadata?: Json;
          group_name?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "generations_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
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
          balance_before: number;
          balance_after: number;
          reference_type: string | null;
          reference_id: string | null;
          description: string | null;
          created_by: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: CreditTransactionType | string;
          amount: number;
          balance_before?: number;
          balance_after: number;
          reference_type?: string | null;
          reference_id?: string | null;
          description?: string | null;
          created_by?: string | null;
          metadata?: Json;
        };
        Update: Record<string, never>; // 交易记录不允许更新
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
      // Profiles 表 (用户扩展信息，与 auth.users 关联)
      // -----------------------------------------------------------------------
      profiles: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          avatar_url: string | null;
          role: string;
          credits: number;
          status: string;
          banned_at: string | null;
          banned_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name?: string | null;
          avatar_url?: string | null;
          role?: string;
          credits?: number;
          status?: string;
          banned_at?: string | null;
          banned_reason?: string | null;
        };
        Update: {
          email?: string;
          name?: string | null;
          avatar_url?: string | null;
          role?: string;
          credits?: number;
          status?: string;
          banned_at?: string | null;
          banned_reason?: string | null;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // Payment Orders 表 (支付订单)
      // -----------------------------------------------------------------------
      payment_orders: {
        Row: {
          id: string;
          user_id: string;
          order_no: string;
          trade_no: string | null;
          product_type: string;
          product_name: string;
          credits_amount: number;
          amount_cents: number;
          currency: string;
          pay_channel: string;
          status: string;
          pay_url: string | null;
          paid_at: string | null;
          expired_at: string | null;
          notify_data: Json | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          order_no: string;
          trade_no?: string | null;
          product_type?: string;
          product_name: string;
          credits_amount: number;
          amount_cents: number;
          currency?: string;
          pay_channel: string;
          status?: string;
          pay_url?: string | null;
          paid_at?: string | null;
          expired_at?: string | null;
          notify_data?: Json | null;
          metadata?: Json;
        };
        Update: {
          trade_no?: string | null;
          status?: string;
          pay_url?: string | null;
          paid_at?: string | null;
          notify_data?: Json | null;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "payment_orders_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // System Settings 表 (键值对配置存储)
      // -----------------------------------------------------------------------
      system_settings: {
        Row: {
          id: string;
          key: string;
          value: Json;
          description: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          key: string;
          value: Json;
          description?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          key?: string;
          value?: Json;
          description?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // TikTok Accounts 表
      // -----------------------------------------------------------------------
      tiktok_account_groups: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          color: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          color?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          name?: string;
          color?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tiktok_account_groups_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };

      tiktok_accounts: {
        Row: {
          id: string;
          user_id: string;
          group_id: string | null;
          open_id: string;
          union_id: string | null;
          display_name: string | null;
          avatar_url: string | null;
          follower_count: number;
          following_count: number;
          likes_count: number;
          video_count: number;
          access_token: string;
          refresh_token: string;
          access_token_expires_at: string | null;
          token_expires_at: string | null;
          refresh_token_expires_at: string | null;
          creator_info_cache: Json | null;
          creator_info_cached_at: string | null;
          scopes: Json;
          account_type: string;
          status: string;
          created_at: string;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          group_id?: string | null;
          open_id: string;
          union_id?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          follower_count?: number;
          following_count?: number;
          likes_count?: number;
          video_count?: number;
          access_token: string;
          refresh_token: string;
          access_token_expires_at?: string | null;
          token_expires_at?: string | null;
          refresh_token_expires_at?: string | null;
          creator_info_cache?: Json | null;
          creator_info_cached_at?: string | null;
          scopes?: Json;
          account_type?: string;
          status?: string;
          username?: string | null;
        };
        Update: {
          group_id?: string | null;
          open_id?: string;
          union_id?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          follower_count?: number;
          following_count?: number;
          likes_count?: number;
          video_count?: number;
          access_token?: string;
          refresh_token?: string;
          access_token_expires_at?: string | null;
          token_expires_at?: string | null;
          refresh_token_expires_at?: string | null;
          creator_info_cache?: Json | null;
          creator_info_cached_at?: string | null;
          scopes?: Json;
          account_type?: string;
          status?: string;
          username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tiktok_accounts_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tiktok_accounts_group_id_fkey";
            columns: ["group_id"];
            referencedRelation: "tiktok_account_groups";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Publish Tasks 表
      // -----------------------------------------------------------------------
      publish_tasks: {
        Row: {
          id: string;
          user_id: string;
          task_name: string | null;
          name: string | null;
          workflow: string;
          source_account_group_id: string | null;
          plan_config: Json;
          idempotency_key: string | null;
          publish_type: string;
          title_template: string | null;
          privacy_level: string;
          allow_comment: boolean;
          allow_duet: boolean;
          allow_stitch: boolean;
          brand_content_toggle: boolean;
          brand_organic_toggle: boolean;
          is_aigc: boolean;
          scheduled_at: string | null;
          batch_interval_seconds: number;
          status: string;
          total_items: number;
          success_count: number;
          failed_count: number;
          published_count: number;
          pending_count: number;
          total_views: number;
          total_likes: number;
          product_info: Json | null;
          created_at: string;
          updated_at: string;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_name?: string | null;
          name?: string | null;
          workflow?: string;
          source_account_group_id?: string | null;
          plan_config?: Json;
          idempotency_key?: string | null;
          publish_type?: string;
          title_template?: string | null;
          privacy_level?: string;
          allow_comment?: boolean;
          allow_duet?: boolean;
          allow_stitch?: boolean;
          brand_content_toggle?: boolean;
          brand_organic_toggle?: boolean;
          is_aigc?: boolean;
          scheduled_at?: string | null;
          batch_interval_seconds?: number;
          status?: string;
          total_items?: number;
          product_info?: Json | null;
        };
        Update: {
          task_name?: string | null;
          name?: string | null;
          workflow?: string;
          source_account_group_id?: string | null;
          plan_config?: Json;
          idempotency_key?: string | null;
          scheduled_at?: string | null;
          title_template?: string | null;
          privacy_level?: string;
          allow_comment?: boolean;
          allow_duet?: boolean;
          allow_stitch?: boolean;
          brand_content_toggle?: boolean;
          brand_organic_toggle?: boolean;
          is_aigc?: boolean;
          batch_interval_seconds?: number;
          status?: string;
          total_items?: number;
          success_count?: number;
          failed_count?: number;
          published_count?: number;
          pending_count?: number;
          total_views?: number;
          total_likes?: number;
          product_info?: Json | null;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "publish_tasks_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Publish Task Items 表 (发布任务子项)
      // -----------------------------------------------------------------------
      publish_task_items: {
        Row: {
          id: string;
          task_id: string;
          account_id: string;
          video_url: string;
          video_source: string;
          source_asset_id: string | null;
          title: string | null;
          tiktok_publish_id: string | null;
          tiktok_share_id: string | null;
          tiktok_video_id: string | null;
          status: string;
          error_code: string | null;
          error_message: string | null;
          scheduled_at: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
          cover_timestamp_ms: number | null;
          plan_sequence: number | null;
          plan_round: number | null;
          plan_account_position: number | null;
          source_video_id: string | null;
          source_video_name: string | null;
          dedupe_key: string | null;
          view_count: number;
          like_count: number;
          comment_count: number;
          share_count: number;
          stats_updated_at: string | null;
          processing_started_at: string | null;
          publish_init_started_at: string | null;
          last_status_check_at: string | null;
          publish_attempt_count: number;
        };
        Insert: {
          id?: string;
          task_id: string;
          account_id: string;
          video_url: string;
          video_source?: string;
          source_asset_id?: string | null;
          title?: string | null;
          tiktok_publish_id?: string | null;
          tiktok_share_id?: string | null;
          tiktok_video_id?: string | null;
          status?: string;
          error_code?: string | null;
          error_message?: string | null;
          scheduled_at?: string | null;
          cover_timestamp_ms?: number | null;
          plan_sequence?: number | null;
          plan_round?: number | null;
          plan_account_position?: number | null;
          source_video_id?: string | null;
          source_video_name?: string | null;
          dedupe_key?: string | null;
          processing_started_at?: string | null;
          publish_init_started_at?: string | null;
          last_status_check_at?: string | null;
          publish_attempt_count?: number;
        };
        Update: {
          account_id?: string;
          video_url?: string;
          video_source?: string;
          source_asset_id?: string | null;
          title?: string | null;
          status?: string;
          tiktok_publish_id?: string | null;
          tiktok_share_id?: string | null;
          tiktok_video_id?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          scheduled_at?: string | null;
          published_at?: string | null;
          cover_timestamp_ms?: number | null;
          plan_sequence?: number | null;
          plan_round?: number | null;
          plan_account_position?: number | null;
          source_video_id?: string | null;
          source_video_name?: string | null;
          dedupe_key?: string | null;
          view_count?: number;
          like_count?: number;
          comment_count?: number;
          share_count?: number;
          stats_updated_at?: string | null;
          processing_started_at?: string | null;
          publish_init_started_at?: string | null;
          last_status_check_at?: string | null;
          publish_attempt_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "publish_task_items_task_id_fkey";
            columns: ["task_id"];
            referencedRelation: "publish_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "publish_task_items_account_id_fkey";
            columns: ["account_id"];
            referencedRelation: "tiktok_accounts";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Link Video Jobs 表 (链接解析视频生成)
      // -----------------------------------------------------------------------
      link_video_jobs: {
        Row: {
          id: string;
          user_id: string;
          product_link_id: string | null;
          ai_model_id: string | null;
          manual_product_info: Json | null;
          video_config: Json | null;
          selected_main_image_url: string | null;
          selected_image_urls: Json | null;
          script_text: string | null;
          script_versions: Json | null;
          grid_image_url: string | null;
          final_video_url: string | null;
          thumbnail_url: string | null;
          grid_task_id: string | null;
          video_task_id: string | null;
          status: string;
          current_step: number;
          progress: number;
          error_message: string | null;
          credits_estimated: number;
          credits_used: number;
          credits_refunded: number;
          script_rewrite_count: number;
          grid_retry_count: number;
          video_retry_count: number;
          created_at: string;
          updated_at: string;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_link_id?: string | null;
          ai_model_id?: string | null;
          manual_product_info?: Json | null;
          video_config?: Json | null;
          selected_main_image_url?: string | null;
          selected_image_urls?: Json | null;
          script_text?: string | null;
          script_versions?: Json | null;
          status?: string;
          current_step?: number;
          credits_estimated?: number;
        };
        Update: {
          product_link_id?: string | null;
          ai_model_id?: string | null;
          manual_product_info?: Json | null;
          video_config?: Json | null;
          selected_main_image_url?: string | null;
          selected_image_urls?: Json | null;
          script_text?: string | null;
          script_versions?: Json | null;
          grid_image_url?: string | null;
          final_video_url?: string | null;
          thumbnail_url?: string | null;
          grid_task_id?: string | null;
          video_task_id?: string | null;
          status?: string;
          current_step?: number;
          progress?: number;
          error_message?: string | null;
          credits_estimated?: number;
          credits_used?: number;
          credits_refunded?: number;
          script_rewrite_count?: number;
          grid_retry_count?: number;
          video_retry_count?: number;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "link_video_jobs_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "link_video_jobs_ai_model_id_fkey";
            columns: ["ai_model_id"];
            referencedRelation: "ai_models";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "link_video_jobs_product_link_id_fkey";
            columns: ["product_link_id"];
            referencedRelation: "product_link_cache";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Product Link Cache 表 (商品链接解析缓存)
      // -----------------------------------------------------------------------
      product_link_cache: {
        Row: {
          id: string;
          url: string;
          url_hash: string;
          platform: string;
          raw_title: string | null;
          raw_description: string | null;
          raw_price: string | null;
          raw_promo_info: string | null;
          raw_images: Json;
          parsed_data: Json | null;
          parse_status: string;
          parse_error: string | null;
          created_at: string;
          updated_at: string;
          last_fetched_at: string | null;
        };
        Insert: {
          id?: string;
          url: string;
          url_hash: string;
          platform?: string;
          raw_title?: string | null;
          raw_description?: string | null;
          raw_price?: string | null;
          raw_promo_info?: string | null;
          raw_images?: Json;
          parsed_data?: Json | null;
          parse_status?: string;
          parse_error?: string | null;
          last_fetched_at?: string | null;
          updated_at?: string;
        };
        Update: {
          url?: string;
          platform?: string;
          raw_title?: string | null;
          raw_description?: string | null;
          raw_price?: string | null;
          raw_promo_info?: string | null;
          raw_images?: Json;
          parsed_data?: Json | null;
          parse_status?: string;
          parse_error?: string | null;
          last_fetched_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };

      // -----------------------------------------------------------------------
      // Creative Templates 表 (创意模板)
      // -----------------------------------------------------------------------
      creative_templates: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          type: string;
          config: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          type: string;
          config: Json;
        };
        Update: {
          name?: string;
          description?: string | null;
          type?: string;
          config?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "creative_templates_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // TikTok Auth States 表 (OAuth 状态管理)
      // -----------------------------------------------------------------------
      tiktok_auth_states: {
        Row: {
          id: string;
          state: string;
          code_verifier: string | null;
          user_id: string;
          expires_at: string;
          flow_type: string;
          status: string;
          ip_hash: string | null;
          user_agent_hash: string | null;
          client_ticket: string | null;
          qr_token: string | null;
          last_checked_at: string | null;
          completed_at: string | null;
          error_code: string | null;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          state: string;
          code_verifier?: string | null;
          user_id: string;
          expires_at: string;
          flow_type?: string;
          status?: string;
          ip_hash?: string | null;
          user_agent_hash?: string | null;
          client_ticket?: string | null;
          qr_token?: string | null;
          last_checked_at?: string | null;
          completed_at?: string | null;
          error_code?: string | null;
          error_message?: string | null;
        };
        Update: {
          state?: string;
          code_verifier?: string | null;
          user_id?: string;
          expires_at?: string;
          flow_type?: string;
          status?: string;
          ip_hash?: string | null;
          user_agent_hash?: string | null;
          client_ticket?: string | null;
          qr_token?: string | null;
          last_checked_at?: string | null;
          completed_at?: string | null;
          error_code?: string | null;
          error_message?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tiktok_auth_states_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Quick Gen History 表 (快速生成历史记录)
      // -----------------------------------------------------------------------
      quick_gen_history: {
        Row: {
          id: string;
          user_id: string;
          mode: string;
          input_images: Json;
          prompt: string | null;
          image_model: string | null;
          image_quality_tier: string | null;
          image_aspect_ratio: string | null;
          image_resolution: string | null;
          video_model: string | null;
          video_aspect_ratio: string | null;
          video_use_ai_model: boolean;
          video_ai_model_id: string | null;
          output_url: string | null;
          thumbnail_url: string | null;
          status: string;
          credits_cost: number;
          created_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          mode: string;
          input_images?: Json;
          prompt?: string | null;
          image_model?: string | null;
          image_quality_tier?: string | null;
          image_aspect_ratio?: string | null;
          image_resolution?: string | null;
          video_model?: string | null;
          video_aspect_ratio?: string | null;
          video_use_ai_model?: boolean;
          video_ai_model_id?: string | null;
          output_url?: string | null;
          thumbnail_url?: string | null;
          status?: string;
          credits_cost?: number;
          expires_at?: string | null;
        };
        Update: {
          mode?: string;
          output_url?: string | null;
          thumbnail_url?: string | null;
          status?: string;
          credits_cost?: number;
          expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "quick_gen_history_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };

      // -----------------------------------------------------------------------
      // Ecom Image Tasks 表 (电商图片工厂任务)
      // -----------------------------------------------------------------------
      ecom_image_tasks: {
        Row: {
          id: string;
          user_id: string;
          mode: string;
          model_type: string;
          language: string;
          ratio: string;
          resolution: string | null;
          input_image_urls: Json;
          mode_config: Json;
          prompts: Json;
          output_items: Json;
          status: string;
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
          mode: string;
          model_type?: string;
          language?: string;
          ratio?: string;
          resolution?: string | null;
          input_image_urls: Json;
          mode_config?: Json;
          prompts?: Json;
          output_items?: Json;
          status?: string;
          current_step?: number;
          credits_cost?: number;
          credits_charged?: boolean;
          metadata?: Json;
        };
        Update: {
          mode?: string;
          model_type?: string;
          status?: string;
          current_step?: number;
          error_message?: string | null;
          prompts?: Json;
          output_items?: Json;
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
            referencedRelation: "profiles";
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
        Relationships: [];
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
        Relationships: [];
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
        Relationships: [];
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
      create_tiktok_account_group: {
        Args: {
          p_name: string;
          p_account_ids: string[];
        };
        Returns: {
          id: string;
          user_id: string;
          name: string;
          color: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
      };
      rename_tiktok_account_group: {
        Args: {
          p_group_id: string;
          p_name: string;
        };
        Returns: {
          id: string;
          user_id: string;
          name: string;
          color: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
      };
      add_tiktok_accounts_to_group: {
        Args: {
          p_group_id: string;
          p_account_ids: string[];
        };
        Returns: number;
      };
      remove_tiktok_account_from_group: {
        Args: {
          p_group_id: string;
          p_account_id: string;
        };
        Returns: number;
      };
      delete_tiktok_account_group: {
        Args: {
          p_group_id: string;
        };
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
