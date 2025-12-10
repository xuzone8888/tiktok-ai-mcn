/**
 * POST /api/image-factory/create-task
 * 
 * 创建电商图片工厂任务
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { getEcomImageCost } from "@/lib/credits";
import type { 
  EcomImageMode, 
  ImageModelType,
  EcomLanguage,
  EcomAspectRatio,
  EcomResolution,
  ModeConfig,
} from "@/types/ecom-image";

// Vercel 函数配置
export const maxDuration = 30;

interface CreateTaskRequest {
  mode: EcomImageMode;
  model_type: ImageModelType;
  language: EcomLanguage;
  ratio: EcomAspectRatio;
  resolution?: EcomResolution;
  input_image_urls: string[];
  mode_config?: ModeConfig;
  is_one_click?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    // 1. 验证用户身份
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "请先登录" },
        { status: 401 }
      );
    }

    // 2. 解析请求参数
    const body: CreateTaskRequest = await request.json();
    const {
      mode,
      model_type,
      language = "zh",
      ratio = "auto",
      resolution,
      input_image_urls,
      mode_config = {},
      is_one_click = true,
    } = body;

    // 3. 参数验证
    if (!mode) {
      return NextResponse.json(
        { success: false, error: "请选择任务模式" },
        { status: 400 }
      );
    }

    const validModes: EcomImageMode[] = [
      "ecom_five_pack",
      "white_background", 
      "scene_image",
      "try_on",
      "buyer_show"
    ];
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        { success: false, error: "无效的任务模式" },
        { status: 400 }
      );
    }

    if (!model_type || !["nano-banana", "nano-banana-pro"].includes(model_type)) {
      return NextResponse.json(
        { success: false, error: "请选择有效的图片模型" },
        { status: 400 }
      );
    }

    if (!input_image_urls || input_image_urls.length === 0) {
      return NextResponse.json(
        { success: false, error: "请上传至少一张图片" },
        { status: 400 }
      );
    }

    // 试穿模式需要选择模特
    if (mode === "try_on") {
      const tryOnConfig = mode_config as { model_id?: string };
      if (!tryOnConfig?.model_id) {
        return NextResponse.json(
          { success: false, error: "试穿模式需要选择AI模特" },
          { status: 400 }
        );
      }
    }

    // 4. 计算积分消耗
    const imageCount = mode === "ecom_five_pack" ? 5 : input_image_urls.length;
    const creditsCost = getEcomImageCost(mode, model_type, imageCount);

    // 5. 检查用户积分
    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("[Create Task] Failed to get user credits:", profileError);
      return NextResponse.json(
        { success: false, error: "获取用户信息失败" },
        { status: 500 }
      );
    }

    if (profile.credits < creditsCost) {
      return NextResponse.json(
        { 
          success: false, 
          error: `积分不足，本次任务需要 ${creditsCost} 积分，当前余额 ${profile.credits} 积分`,
          credits_required: creditsCost,
          credits_current: profile.credits,
        },
        { status: 400 }
      );
    }

    // 6. 创建任务记录
    const taskData = {
      user_id: user.id,
      mode,
      model_type,
      language,
      ratio,
      resolution: model_type === "nano-banana-pro" ? (resolution || "1k") : null,
      input_image_urls,
      mode_config,
      prompts: {},
      output_items: [],
      status: "created" as const,
      current_step: 1,
      credits_cost: creditsCost,
      credits_charged: false,
      metadata: {
        is_one_click,
        created_from: "web",
      },
    };

    const { data: task, error: insertError } = await adminClient
      .from("ecom_image_tasks")
      .insert(taskData)
      .select()
      .single();

    if (insertError || !task) {
      console.error("[Create Task] Failed to create task:", insertError);
      return NextResponse.json(
        { success: false, error: "创建任务失败，请稍后重试" },
        { status: 500 }
      );
    }

    console.log("[Create Task] Task created:", {
      taskId: task.id,
      mode,
      model_type,
      imageCount: input_image_urls.length,
      creditsCost,
    });

    // 7. 返回成功响应
    return NextResponse.json({
      success: true,
      task_id: task.id,
      task,
      credits_required: creditsCost,
      message: "任务创建成功",
    });

  } catch (error) {
    console.error("[Create Task] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

