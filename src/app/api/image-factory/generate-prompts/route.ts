/**
 * POST /api/image-factory/generate-prompts
 * 
 * 为电商图片任务生成 AI 提示词
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { generateEcomPrompts } from "@/lib/ecom-doubao";
import type { EcomImageMode } from "@/types/ecom-image";

// Vercel 函数配置
export const maxDuration = 120;

interface GeneratePromptsRequest {
  task_id: string;
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
    const body: GeneratePromptsRequest = await request.json();
    const { task_id } = body;

    if (!task_id) {
      return NextResponse.json(
        { success: false, error: "任务ID不能为空" },
        { status: 400 }
      );
    }

    // 3. 获取任务信息
    const adminClient = createAdminClient();
    const { data: task, error: taskError } = await adminClient
      .from("ecom_image_tasks")
      .select("*")
      .eq("id", task_id)
      .eq("user_id", user.id)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { success: false, error: "任务不存在或无权访问" },
        { status: 404 }
      );
    }

    // 4. 检查任务状态
    if (task.status !== "created" && task.status !== "failed") {
      return NextResponse.json(
        { success: false, error: "任务状态不正确，无法生成提示词" },
        { status: 400 }
      );
    }

    // 5. 白底图模式不需要生成提示词
    if (task.mode === "white_background") {
      // 使用固定模板
      const fixedPrompts = {
        white_bg: "Clean studio product photo on a pure white background. Keep the original product shape, color and details. Soft even lighting, no harsh shadows, no extra objects, no text, no watermark."
      };

      await adminClient
        .from("ecom_image_tasks")
        .update({
          prompts: { original: fixedPrompts, modified: fixedPrompts },
          status: "generating_images",
          current_step: 3,
        })
        .eq("id", task_id);

      return NextResponse.json({
        success: true,
        prompts: fixedPrompts,
        message: "白底图模式使用固定模板",
      });
    }

    // 6. 更新任务状态为"生成提示词中"
    await adminClient
      .from("ecom_image_tasks")
      .update({
        status: "generating_prompts",
        current_step: 2,
        error_message: null,
      })
      .eq("id", task_id);

    // 7. 调用豆包 API 生成提示词
    const mode = task.mode as EcomImageMode;
    const language = task.language as "zh" | "en";
    const modeConfig = task.mode_config || {};
    const inputImages = task.input_image_urls as string[];

    console.log("[Generate Prompts] Calling Doubao API:", {
      taskId: task_id,
      mode,
      language,
      imageCount: inputImages.length,
    });

    const result = await generateEcomPrompts({
      mode,
      language,
      inputImageUrls: inputImages,
      modeConfig,
    });

    if (!result.success || !result.prompts) {
      // 更新任务为失败状态
      await adminClient
        .from("ecom_image_tasks")
        .update({
          status: "failed",
          error_message: result.error || "提示词生成失败",
        })
        .eq("id", task_id);

      return NextResponse.json(
        { success: false, error: result.error || "提示词生成失败" },
        { status: 500 }
      );
    }

    // 8. 更新任务，保存生成的提示词
    const { error: updateError } = await adminClient
      .from("ecom_image_tasks")
      .update({
        prompts: {
          original: result.prompts,
          modified: result.prompts, // 初始时 modified 等于 original
        },
        status: "generating_images", // 准备进入下一步
        current_step: 3,
      })
      .eq("id", task_id);

    if (updateError) {
      console.error("[Generate Prompts] Failed to update task:", updateError);
      return NextResponse.json(
        { success: false, error: "保存提示词失败" },
        { status: 500 }
      );
    }

    console.log("[Generate Prompts] Success:", {
      taskId: task_id,
      promptCount: Object.keys(result.prompts).length,
    });

    return NextResponse.json({
      success: true,
      prompts: result.prompts,
      message: "提示词生成成功",
    });

  } catch (error) {
    console.error("[Generate Prompts] Error:", error);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}

