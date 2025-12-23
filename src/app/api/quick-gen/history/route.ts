/**
 * 即时造片台操作历史 API
 * 
 * GET /api/quick-gen/history - 获取用户最近 7 天的操作历史
 * POST /api/quick-gen/history - 保存新的操作历史
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// 类型定义
// ============================================================================

export interface QuickGenHistoryItem {
  id: string;
  mode: "video" | "image";
  
  // 输入参数
  input_images: string[];
  prompt: string | null;
  
  // 图片参数
  image_model: string | null;
  image_quality_tier: string | null;
  image_aspect_ratio: string | null;
  image_resolution: string | null;
  
  // 视频参数
  video_model: string | null;
  video_aspect_ratio: string | null;
  video_use_ai_model: boolean;
  video_ai_model_id: string | null;
  
  // 输出
  output_url: string | null;
  thumbnail_url: string | null;
  status: "completed" | "failed";
  credits_cost: number;
  
  // 时间
  created_at: string;
  expires_at: string;
}

export interface SaveHistoryRequest {
  mode: "video" | "image";
  input_images?: string[];
  prompt?: string;
  
  // 图片参数
  image_model?: string;
  image_quality_tier?: string;
  image_aspect_ratio?: string;
  image_resolution?: string;
  
  // 视频参数
  video_model?: string;
  video_aspect_ratio?: string;
  video_use_ai_model?: boolean;
  video_ai_model_id?: string;
  
  // 输出
  output_url?: string;
  thumbnail_url?: string;
  status?: "completed" | "failed";
  credits_cost?: number;
}

// ============================================================================
// GET - 获取操作历史
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 验证用户身份
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode"); // 可选：video | image | all
    const limit = parseInt(searchParams.get("limit") || "50");

    // 使用 admin client 查询（绕过 RLS 以防万一表还没配置好）
    const adminClient = createAdminClient();
    
    let query = adminClient
      .from("quick_gen_history")
      .select("*")
      .eq("user_id", user.id)
      .gt("expires_at", new Date().toISOString()) // 只返回未过期的
      .order("created_at", { ascending: false })
      .limit(limit);

    // 过滤模式
    if (mode && mode !== "all") {
      query = query.eq("mode", mode);
    }

    const { data: histories, error } = await query;

    if (error) {
      console.error("[Quick Gen History] Query error:", error);
      // 如果表不存在，返回空数组
      if (error.code === "42P01") {
        return NextResponse.json({
          success: true,
          data: [],
          message: "历史记录表尚未创建",
        });
      }
      return NextResponse.json(
        { success: false, error: "获取历史记录失败" },
        { status: 500 }
      );
    }

    console.log("[Quick Gen History] Fetched", histories?.length || 0, "records for user:", user.id);

    return NextResponse.json({
      success: true,
      data: histories || [],
    });

  } catch (error) {
    console.error("[Quick Gen History] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - 保存操作历史
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 验证用户身份
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    // 解析请求体
    const body: SaveHistoryRequest = await request.json();

    // 验证必需字段
    if (!body.mode || !["video", "image"].includes(body.mode)) {
      return NextResponse.json(
        { success: false, error: "无效的模式" },
        { status: 400 }
      );
    }

    // 构建插入数据
    const historyData = {
      user_id: user.id,
      mode: body.mode,
      input_images: body.input_images || [],
      prompt: body.prompt || null,
      
      // 图片参数
      image_model: body.image_model || null,
      image_quality_tier: body.image_quality_tier || null,
      image_aspect_ratio: body.image_aspect_ratio || null,
      image_resolution: body.image_resolution || null,
      
      // 视频参数
      video_model: body.video_model || null,
      video_aspect_ratio: body.video_aspect_ratio || null,
      video_use_ai_model: body.video_use_ai_model || false,
      video_ai_model_id: body.video_ai_model_id || null,
      
      // 输出
      output_url: body.output_url || null,
      thumbnail_url: body.thumbnail_url || null,
      status: body.status || "completed",
      credits_cost: body.credits_cost || 0,
    };

    // 使用 admin client 插入
    const adminClient = createAdminClient();
    const { data: inserted, error } = await adminClient
      .from("quick_gen_history")
      .insert(historyData)
      .select()
      .single();

    if (error) {
      console.error("[Quick Gen History] Insert error:", error);
      // 如果表不存在，静默失败（不影响主流程）
      if (error.code === "42P01") {
        console.warn("[Quick Gen History] Table does not exist yet");
        return NextResponse.json({
          success: true,
          data: null,
          message: "历史记录表尚未创建，跳过保存",
        });
      }
      return NextResponse.json(
        { success: false, error: "保存历史记录失败" },
        { status: 500 }
      );
    }

    console.log("[Quick Gen History] Saved history:", inserted.id);

    return NextResponse.json({
      success: true,
      data: inserted,
    });

  } catch (error) {
    console.error("[Quick Gen History] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}




